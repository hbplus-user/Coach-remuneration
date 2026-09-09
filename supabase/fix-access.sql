-- =====================================================================
-- "No profile row exists in app_users for this account"
--
-- The app calls: select * from app_users where id = <you> -- and got nothing.
-- That has two possible causes, which need different fixes:
--
--   A. The row was never created. The signup trigger only fires on INSERT
--      into auth.users, so anyone who signed in BEFORE schema.sql was run
--      already existed and never triggered it.
--   B. The row exists but RLS is hiding it from you.
--
-- Run section 1 to tell them apart, then the matching fix.
-- Everything here runs as postgres in the SQL Editor, which bypasses RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DIAGNOSE  — run this whole section and read the three results
-- ---------------------------------------------------------------------

-- 1a. Who exists in auth, and do they have a profile?
--     "MISSING PROFILE" = cause A.  "has profile" = cause B.
select
  u.email,
  u.created_at            as signed_up,
  u.last_sign_in_at,
  case when a.id is null then 'MISSING PROFILE' else 'has profile' end as status,
  a.role,
  a.coach_id
from auth.users u
left join public.app_users a on a.id = u.id
order by u.created_at;

-- 1b. Is the signup trigger actually installed?
--     Expect one row: on_auth_user_created
select tgname as trigger_name
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

-- 1c. Did the account predate the trigger? If signed_up is EARLIER than
--     trigger_created, the trigger never had a chance to fire -> cause A.
select
  u.email,
  u.created_at as signed_up,
  (select max(pd.description) is not null
     from pg_description pd where pd.objoid = 'public.handle_new_auth_user'::regproc)
             as trigger_fn_exists
from auth.users u
order by u.created_at;

-- ---------------------------------------------------------------------
-- 2. FIX FOR CAUSE A  — backfill every missing profile
--
--    Safe to run regardless: it only inserts rows that are absent, skips
--    anyone outside the domain, and links a coach record when the email
--    matches one.
-- ---------------------------------------------------------------------
insert into public.app_users (id, email, full_name, avatar_url, role, coach_id)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name',
           u.raw_user_meta_data->>'name',
           u.email),
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

-- ---------------------------------------------------------------------
-- 3. MAKE YOURSELF ADMIN  — edit the address first
-- ---------------------------------------------------------------------
update public.app_users
   set role = 'Super Admin'
 where email = 'subit.pradhan@hbplus.fit';

-- ---------------------------------------------------------------------
-- 4. CONFIRM  — this is what the app will see for you
-- ---------------------------------------------------------------------
select email, role, coach_id, rm_id,
       case
         when role = 'Coach' and coach_id is null
           then 'BLOCKED: shows "Access pending"'
         else 'OK: dashboard loads'
       end as app_result
from public.app_users
where email = 'subit.pradhan@hbplus.fit';

-- ---------------------------------------------------------------------
-- 5. IF SECTION 1a SAID "has profile" (cause B: RLS is hiding it)
--
--    The read policy requires the JWT's email to end in @hbplus.fit.
--    Check what your token actually carries — run this from the app's
--    browser console while signed in:
--
--      const { data } = await window.supabase.auth.getSession();
--      JSON.parse(atob(data.session.access_token.split('.')[1]));
--
--    If the `email` claim is absent or spelled differently, that is why
--    is_allowed_domain() returns false and the row stays invisible.
--    As a temporary unblock you can widen the check to the profile table:
--
--      create or replace function public.is_allowed_domain()
--      returns boolean language sql stable as $fn$
--        select coalesce(
--          lower(coalesce(auth.jwt() -> 'user_metadata' ->> 'email',
--                         auth.jwt() ->> 'email',
--                         (select email from public.app_users
--                           where id = auth.uid())))
--          like '%@hbplus.fit', false);
--      $fn$;
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- 6. DID THE SEED LAND COMPLETELY?
--
--    The app seeds itself on the first sign-in against an empty database.
--    If any table failed, the screens that read it break later, far from
--    the cause. Expected counts are in the right-hand column.
-- ---------------------------------------------------------------------
select 'variants'            as table_name, count(*) as rows, 5   as expected from public.variants
union all select 'certifications',      count(*), 14  from public.certifications
union all select 'coaches',             count(*), 18  from public.coaches
union all select 'performance_records', count(*), 21  from public.performance_records
union all select 'org_work',            count(*), 1   from public.org_work
union all select 'violations',          count(*), 2   from public.violations
union all select 'penalty_matrix',      count(*), 164 from public.penalty_matrix
union all select 'payroll_cycles',      count(*), 1   from public.payroll_cycles
order by table_name;

-- Any coach pointing at a variant that is not there? This is what blanks
-- the coach profile page. Expect zero rows.
select c.id, c.name, c.variant_id
from public.coaches c
left join public.variants v on v.id = c.variant_id
where v.id is null;
