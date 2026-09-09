-- =====================================================================
-- In-app role management
--
-- Lets a Super Admin assign roles from the dashboard's "User Access" screen
-- instead of running UPDATEs by hand.
--
-- Run this ONLY if you already ran schema.sql before the User Access screen
-- was added. A fresh schema.sql run already contains everything below.
-- Idempotent: safe to re-run.
--
-- Two RPCs, both SECURITY DEFINER with the permission check in the body:
--   admin_list_users()  - everyone who has signed in, + their access
--   admin_set_access()  - assign a role and its binding
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Who has signed in, and what access do they have?
--    SECURITY DEFINER because auth.users is not readable by `authenticated`;
--    the caller check below is what keeps that safe.
-- ---------------------------------------------------------------------
create or replace function public.admin_list_users()
returns table (
  id               uuid,
  email            text,
  full_name        text,
  avatar_url       text,
  role             text,
  coach_id         text,
  coach_name       text,
  rm_id            text,
  last_sign_in_at  timestamptz,
  created_at       timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_app_role() not in ('Super Admin','HR Manager') then
    raise exception 'Not permitted: only a Super Admin or HR Manager may list users'
      using errcode = '42501';
  end if;

  return query
  select
    a.id, a.email, a.full_name, a.avatar_url, a.role, a.coach_id,
    c.name as coach_name, a.rm_id,
    u.last_sign_in_at, a.created_at
  from public.app_users a
  join auth.users       u on u.id = a.id
  left join public.coaches c on c.id = a.coach_id
  order by (a.role = 'Coach' and a.coach_id is null) desc,  -- pending first
           u.last_sign_in_at desc nulls last;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Assign a role.
--
--    Guards, in order:
--      - caller must be Super Admin or HR Manager
--      - only a Super Admin may grant or revoke Super Admin
--      - the role must be one of the six the app understands
--      - Reporting Manager needs an rm_id; Coach needs a coach_id
--      - the last Super Admin cannot be demoted (nobody could undo it)
-- ---------------------------------------------------------------------
create or replace function public.admin_set_access(
  target_id       uuid,
  new_role        text,
  new_coach_id    text default null,
  new_rm_id       text default null
)
returns public.app_users
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.current_app_role();
  old_role    text;
  updated     public.app_users;
begin
  if caller_role not in ('Super Admin','HR Manager') then
    raise exception 'Not permitted: only a Super Admin or HR Manager may assign roles'
      using errcode = '42501';
  end if;

  select role into old_role from public.app_users where id = target_id;
  if old_role is null then
    raise exception 'No such user' using errcode = 'P0002';
  end if;

  -- Admin-making is reserved to admins, so an HR Manager cannot promote
  -- themselves or anyone else past their own level.
  if (new_role = 'Super Admin' or old_role = 'Super Admin')
     and caller_role <> 'Super Admin' then
    raise exception 'Not permitted: only a Super Admin may grant or revoke Super Admin'
      using errcode = '42501';
  end if;

  if new_role not in ('Super Admin','HR Manager','Finance','Operations',
                      'Reporting Manager','Coach') then
    raise exception 'Unknown role: %', new_role using errcode = '22023';
  end if;

  if new_role = 'Reporting Manager' and coalesce(new_rm_id, '') = '' then
    raise exception 'A Reporting Manager needs an RM id (RM_01, RM_02, RM_03)'
      using errcode = '22023';
  end if;

  if new_role = 'Coach' and coalesce(new_coach_id, '') = '' then
    raise exception 'A Coach needs to be linked to a coach record'
      using errcode = '22023';
  end if;

  -- Never leave the system without an admin.
  if old_role = 'Super Admin' and new_role <> 'Super Admin'
     and (select count(*) from public.app_users where role = 'Super Admin') <= 1 then
    raise exception 'Cannot demote the last Super Admin'
      using errcode = '23514';
  end if;

  update public.app_users
     set role     = new_role,
         coach_id = case when new_role = 'Coach' then new_coach_id else nullif(new_coach_id, '') end,
         rm_id    = case when new_role = 'Reporting Manager' then new_rm_id else nullif(new_rm_id, '') end
   where id = target_id
  returning * into updated;

  -- Access changes belong in the same trail as everything else.
  insert into public.audit_log (id, actor, action, details, ip, user_agent)
  values (
    'AUD_ACL_' || extract(epoch from now())::bigint || '_' || substr(target_id::text, 1, 8),
    coalesce((select email from public.app_users where id = auth.uid()), 'unknown'),
    'Access Changed',
    format('%s: %s -> %s%s', updated.email, old_role, new_role,
           case
             when new_role = 'Coach' then ' (coach ' || coalesce(updated.coach_id, '-') || ')'
             when new_role = 'Reporting Manager' then ' (' || coalesce(updated.rm_id, '-') || ')'
             else ''
           end),
    null,
    'role-management'
  );

  return updated;
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Expose them to signed-in callers. The permission checks live in the
--    function bodies, not here.
-- ---------------------------------------------------------------------
revoke all on function public.admin_list_users()                       from public, anon;
revoke all on function public.admin_set_access(uuid, text, text, text) from public, anon;
grant execute on function public.admin_list_users()                       to authenticated;
grant execute on function public.admin_set_access(uuid, text, text, text) to authenticated;
