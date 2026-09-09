-- =====================================================================
-- Granting role access
--
-- Signing in only creates an account. It does NOT grant access: the trigger
-- inserts an app_users row with role 'Coach' and no coach_id, which the app
-- shows as "Access pending". These queries are how you actually let someone in.
--
-- Run them in the Supabase SQL Editor. They run as the postgres role, which
-- bypasses RLS, so you can bootstrap the first admin from here.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. WHO HAS SIGNED IN?  Run this first — you need the exact email.
-- ---------------------------------------------------------------------
select
  a.email,
  a.full_name,
  a.role,
  a.coach_id,
  a.rm_id,
  c.name as linked_coach_name,
  u.last_sign_in_at
from public.app_users a
left join auth.users     u on u.id = a.id
left join public.coaches c on c.id = a.coach_id
order by u.last_sign_in_at desc nulls last;

-- Signed in but got no profile? They are outside @hbplus.fit — the trigger
-- deliberately skips them, and RLS gives them nothing.
select u.email, u.created_at
from auth.users u
left join public.app_users a on a.id = u.id
where a.id is null;

-- ---------------------------------------------------------------------
-- 2. PROMOTE YOURSELF  (do this first, after your own first sign-in)
-- ---------------------------------------------------------------------
update public.app_users
   set role = 'Super Admin'
 where email = 'you@hbplus.fit';

-- ---------------------------------------------------------------------
-- 3. GRANT A ROLE TO SOMEONE ELSE
--
--    Roles: 'Super Admin' | 'HR Manager' | 'Finance' | 'Operations'
--           | 'Reporting Manager' | 'Coach'
--
--    Two roles need a binding as well as a role:
--      Reporting Manager -> rm_id    ('RM_01' S&C, 'RM_02' Yoga, 'RM_03' HOP)
--      Coach             -> coach_id (the HB+_### id, drives self-service)
-- ---------------------------------------------------------------------

-- Office roles: role alone is enough
update public.app_users set role = 'HR Manager' where email = 'hr@hbplus.fit';
update public.app_users set role = 'Finance'    where email = 'payroll@hbplus.fit';
update public.app_users set role = 'Operations' where email = 'ops@hbplus.fit';

-- Reporting manager: scope them to the squad they review
update public.app_users
   set role = 'Reporting Manager', rm_id = 'RM_01'
 where email = 'rm.sc@hbplus.fit';

-- Coach: bind to the coach record, or self-service has nothing to show
update public.app_users
   set role = 'Coach', coach_id = 'HB+_023'
 where email = 'ankush.c@hbplus.fit';

-- ---------------------------------------------------------------------
-- 4. BULK-LINK COACHES
--    The trigger already links on an exact email match. Use this when the
--    login domain and the coach record's domain differ (e.g. the seed data
--    uses @hbplus.com while people sign in with @hbplus.fit): it matches on
--    the part before the @ instead.
--
--    Preview first. Only run the update if the pairs look right.
-- ---------------------------------------------------------------------
select a.email as login, c.id as would_link_to, c.name
from public.app_users a
join public.coaches   c
  on split_part(lower(c.email), '@', 1) = split_part(lower(a.email), '@', 1)
where a.coach_id is null;

-- update public.app_users a
--    set coach_id = c.id, role = 'Coach'
--   from public.coaches c
--  where split_part(lower(c.email), '@', 1) = split_part(lower(a.email), '@', 1)
--    and a.coach_id is null;

-- ---------------------------------------------------------------------
-- 5. REVOKE ACCESS
-- ---------------------------------------------------------------------
-- Demote (they keep the login, lose the powers, land on "Access pending")
update public.app_users
   set role = 'Coach', coach_id = null, rm_id = null
 where email = 'former.admin@hbplus.fit';

-- Remove the login entirely. Deleting the auth user cascades to app_users.
-- delete from auth.users where email = 'leaver@hbplus.fit';

-- ---------------------------------------------------------------------
-- 6. VERIFY  — what the app will see for one person
-- ---------------------------------------------------------------------
select email, role, coach_id, rm_id,
       case
         when role = 'Coach' and coach_id is null then 'BLOCKED: shows "Access pending"'
         when role = 'Reporting Manager' and rm_id is null then 'BLOCKED: no squad scoped'
         else 'OK: dashboard loads'
       end as app_result
from public.app_users
where email = 'you@hbplus.fit';
