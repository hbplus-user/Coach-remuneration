-- =====================================================================
-- Google-only sign-in, restricted to @hbplus.fit
--
-- Run this ONLY if you already ran schema.sql before this restriction was
-- added. A fresh schema.sql run already contains everything below.
-- Idempotent: safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Profile columns Google fills in
-- ---------------------------------------------------------------------
alter table public.app_users add column if not exists avatar_url text;

-- ---------------------------------------------------------------------
-- 2. The domain gate. Every policy below is built on it, so an account
--    outside the workspace gets a valid session and zero rows.
-- ---------------------------------------------------------------------
create or replace function public.is_allowed_domain()
returns boolean
language sql
stable
as $$
  select coalesce(
    lower(coalesce(
      auth.jwt() -> 'user_metadata' ->> 'email',
      auth.jwt() ->> 'email'
    )) like '%@hbplus.fit',
    false
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Signup trigger: read Google's metadata, link a coach by email, and
--    refuse to mint a profile for anyone outside the workspace.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta          jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  matched_coach text;
begin
  -- Outside the workspace: create no profile at all. The account may exist in
  -- auth.users (Google let them through) but it maps to nothing and RLS gives
  -- it nothing.
  if lower(new.email) not like '%@hbplus.fit' then
    return new;
  end if;

  -- Google sign-ins carry no role, so link them to a coach record by email
  -- when one matches. Anything else lands as an unassigned Coach and the app
  -- shows an "access pending" screen until an admin sets the role.
  select c.id into matched_coach
  from public.coaches c
  where lower(c.email) = lower(new.email)
  limit 1;

  insert into public.app_users (id, email, full_name, avatar_url, role, coach_id, rm_id)
  values (
    new.id,
    new.email,
    coalesce(meta->>'full_name', meta->>'name', new.email),
    nullif(coalesce(meta->>'avatar_url', meta->>'picture'), ''),
    coalesce(meta->>'role', 'Coach'),
    coalesce(nullif(meta->>'coach_id', ''), matched_coach),
    nullif(meta->>'rm_id', '')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- 4. Re-issue every policy with the domain check
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'variants','certifications','coaches','performance_records','org_work',
    'penalty_matrix','violations','appeals','audit_log','payroll_cycles','app_users'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "authenticated_all" on public.%I', t);
    execute format('drop policy if exists "hbplus_domain_all" on public.%I', t);
    execute format(
      'create policy "hbplus_domain_all" on public.%I
         for all to authenticated
         using (public.is_allowed_domain())
         with check (public.is_allowed_domain())', t);
  end loop;
end $$;

drop policy if exists "authenticated_all"  on public.audit_log;
drop policy if exists "hbplus_domain_all"  on public.audit_log;
drop policy if exists "audit_read"         on public.audit_log;
drop policy if exists "audit_insert"       on public.audit_log;
create policy "audit_read" on public.audit_log
  for select to authenticated using (public.is_allowed_domain());
create policy "audit_insert" on public.audit_log
  for insert to authenticated with check (public.is_allowed_domain());

drop policy if exists "authenticated_all"   on public.app_users;
drop policy if exists "hbplus_domain_all"   on public.app_users;
drop policy if exists "app_users_read_own"  on public.app_users;
drop policy if exists "app_users_admin_all" on public.app_users;
create policy "app_users_read_own" on public.app_users
  for select to authenticated
  using (id = auth.uid() and public.is_allowed_domain());
create policy "app_users_admin_all" on public.app_users
  for all to authenticated
  using (public.is_allowed_domain() and public.current_app_role() in ('Super Admin','HR Manager'))
  with check (public.is_allowed_domain() and public.current_app_role() in ('Super Admin','HR Manager'));

-- ---------------------------------------------------------------------
-- 5. Backfill accounts that signed in before this ran
--
--    The trigger only fires on INSERT into auth.users, so anyone who signed
--    in earlier has no profile at all. Create those first, then top up the
--    details on profiles that already exist.
-- ---------------------------------------------------------------------
insert into public.app_users (id, email, full_name, avatar_url, role, coach_id)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'name', u.email),
  nullif(coalesce(u.raw_user_meta_data->>'avatar_url',
                  u.raw_user_meta_data->>'picture'), ''),
  'Coach',
  (select c.id from public.coaches c
    where lower(c.email) = lower(u.email) limit 1)
from auth.users u
left join public.app_users a on a.id = u.id
where a.id is null
  and lower(u.email) like '%@hbplus.fit'
on conflict (id) do nothing;

update public.app_users a
   set coach_id   = coalesce(a.coach_id, c.id),
       full_name  = coalesce(a.full_name, u.raw_user_meta_data->>'full_name',
                             u.raw_user_meta_data->>'name', a.email),
       avatar_url = coalesce(a.avatar_url, u.raw_user_meta_data->>'avatar_url',
                             u.raw_user_meta_data->>'picture')
  from auth.users u
  left join public.coaches c on lower(c.email) = lower(u.email)
 where a.id = u.id;

-- Any profile that predates the restriction and is outside the workspace is
-- now dead weight — RLS ignores it. Remove it so the user list stays honest.
delete from public.app_users where lower(email) not like '%@hbplus.fit';

-- ---------------------------------------------------------------------
-- 6. Promote your admin (edit the address, then run)
-- ---------------------------------------------------------------------
-- update public.app_users
--    set role = 'Super Admin'
--  where email = 'you@hbplus.fit';
