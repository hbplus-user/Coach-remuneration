-- =====================================================================
-- HB+ Coach Remuneration & Performance Management
-- Supabase / Postgres schema
--
-- Run this whole file once in the Supabase SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- It is idempotent: safe to re-run.
--
-- Design notes
--  * Business IDs from the app ("V1", "HB+_023", "SC9", "VIO_01") are kept
--    as text primary keys so nothing in src/ has to change its id logic.
--  * Deeply nested config (variant weights / rates / milestones, a coach's
--    attached certifications, per-period overrides) stays JSONB so the
--    shapes in src/data.js round-trip exactly.
--  * historicMonths + currentMonth live in ONE table, separated by
--    record_type, so the period-rollover logic is a single UPDATE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Extensions + shared helpers
-- ---------------------------------------------------------------------
create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- 1. VARIANTS  (src/data.js -> INITIAL_VARIANTS)
-- ---------------------------------------------------------------------
create table if not exists public.variants (
  id            text primary key,                    -- "V1"
  name          text not null,                       -- "S&C"
  discipline    text not null,                       -- "S&C" | "Yoga" | "HOP"
  audience      text not null,                       -- "Internal" | "External"
  property      text,                                -- "HB+ Studio"
  is_active     boolean not null default true,
  weights       jsonb  not null default '{}'::jsonb, -- { coaching_exp: 8, ... }
  rates         jsonb  not null default '{}'::jsonb, -- { Fixed: { "50–60 Stable": {...} } }
  milestones    jsonb  not null default '{}'::jsonb, -- { Fixed: [ { threshold, amount } ] }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists variants_active_idx on public.variants (is_active);

-- ---------------------------------------------------------------------
-- 2. CERTIFICATIONS master list  (INITIAL_CERTIFICATIONS)
-- ---------------------------------------------------------------------
create table if not exists public.certifications (
  id            text primary key,                    -- "SC9"
  variant_type  text not null,                       -- "S&C" | "Yoga"
  authority     text not null,                       -- "NSCA"
  course_name   text not null,
  level         text not null check (level in ('Gold','Silver','Bronze')),
  score         numeric(4,2) not null check (score >= 0 and score <= 10),
  pdf_name      text,
  pdf_data      text,                                -- base64 blob written by the upload form
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists certifications_variant_type_idx
  on public.certifications (variant_type);

-- ---------------------------------------------------------------------
-- 3. COACHES  (INITIAL_COACHES)
-- ---------------------------------------------------------------------
create table if not exists public.coaches (
  id                                  text primary key,   -- "HB+_023"
  name                                text not null,
  email                               text,
  phone                               text,
  gender                              text,
  variant_id                          text references public.variants (id) on update cascade,
  coach_type                          text,               -- "Strength" | "Yoga" | "HOP"
  coach_category                      text not null       -- pay model
                                        check (coach_category in ('Fixed','Flexi-Fixed','Flexi')),
  internal_designation                text,               -- "Crew" | "Lancer" | "Coach"
  date_of_joining                     date,
  date_of_first_relevant_certification date,
  freelance_past_exp_with_document     numeric(5,2) not null default 0,
  freelance_past_exp_without_document  numeric(5,2) not null default 0,
  non_coaching_exp_years               numeric(5,2) not null default 0,
  education_score_override             numeric(4,2),
  education_qualification              text,
  education_type                       text,              -- online_global | offline_india | offline_outside
  reporting_manager_id                 text,              -- "RM_01"
  assigned_property                    text,
  status                               text not null default 'Active'
                                         check (status in ('Active','Inactive','Suspended','Exited')),
  bank_account                         text,
  fixed_salary_override                numeric(12,2),     -- overrides std_fixed for Fixed coaches
  flexi_fixed_base_salary              numeric(12,2),     -- overrides min_fixed for Flexi-Fixed
  certifications                       jsonb not null default '[]'::jsonb,
                                       -- [{ id, authority, course_name, score }]
  five_star_streak                     integer not null default 0,
  pdf_name                             text,
  pdf_data                             text,
  created_at                           timestamptz not null default now(),
  updated_at                           timestamptz not null default now()
);

create index if not exists coaches_variant_idx  on public.coaches (variant_id);
create index if not exists coaches_status_idx   on public.coaches (status);
create index if not exists coaches_rm_idx       on public.coaches (reporting_manager_id);

-- ---------------------------------------------------------------------
-- 4. PERFORMANCE RECORDS
--    One row per coach per period. record_type splits the app's two arrays:
--      'current'  -> INITIAL_CURRENT_MONTH   (the open cycle)
--      'historic' -> INITIAL_HISTORIC_MONTHS (closed cycles)
-- ---------------------------------------------------------------------
create table if not exists public.performance_records (
  id                         uuid primary key default gen_random_uuid(),
  coach_id                   text not null references public.coaches (id) on delete cascade on update cascade,
  record_type                text not null default 'current'
                               check (record_type in ('current','historic')),
  period_month               text not null,          -- "June 2026"
  period_start               date not null,
  period_end                 date not null,

  -- Manual scorecard cells (nullable: blank until an RM records them)
  prof_appearance            numeric(5,2),
  client_engagement          numeric(5,2),
  safety                     numeric(5,2),
  punctuality                numeric(5,2),
  team_conduct               numeric(5,2),
  communication              numeric(5,2),
  meetings_scheduled         integer,
  meetings_attended          integer,
  attendance_pct             numeric(5,2),

  -- Volume
  sessions_completed         numeric(8,2),
  night_sessions             integer default 0,
  ooh_sessions_completed     integer default 0,
  pt_home_sessions_completed integer default 0,
  five_star_streak           integer default 0,

  -- Derived + workflow
  hb_score                   numeric(6,2),
  band                       text,                   -- "50–60 Stable"
  status                     text not null default 'DRAFT'
                               check (status in ('DRAFT','SUBMITTED','RM_APPROVED','HR_APPROVED','FINANCE_LOCKED')),
  overrides                  jsonb not null default '{}'::jsonb,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),

  constraint performance_records_unique_period unique (coach_id, period_month)
);

create index if not exists perf_coach_idx   on public.performance_records (coach_id);
create index if not exists perf_type_idx    on public.performance_records (record_type);
create index if not exists perf_month_idx   on public.performance_records (period_month);
create index if not exists perf_status_idx  on public.performance_records (status);

-- ---------------------------------------------------------------------
-- 5. ORG WORK PAY  (INITIAL_ORG_WORK)
-- ---------------------------------------------------------------------
create table if not exists public.org_work (
  id            text primary key,                    -- "OW_01"
  coach_id      text not null references public.coaches (id) on delete cascade on update cascade,
  period_month  text not null,
  work_type     text not null,
  amount        numeric(12,2) not null default 0,
  approved_by   text,
  status        text not null default 'Pending'
                  check (status in ('Pending','Approved','Rejected','Paid')),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists org_work_coach_month_idx on public.org_work (coach_id, period_month);

-- ---------------------------------------------------------------------
-- 6. PENALTY MATRIX  (PENALTY_MATRIX — one row per variant + type + step)
-- ---------------------------------------------------------------------
create table if not exists public.penalty_matrix (
  id             uuid primary key default gen_random_uuid(),
  -- Plain text, not an FK: PENALTY_MATRIX also carries a "default" fallback
  -- bucket that is not a real variant.
  variant_id     text not null,                      -- "V1" | "default"
  violation_type text not null,                      -- "Late Arrival (<5 min)"
  occurrence_no  integer not null check (occurrence_no >= 1),
  consequence    text not null,                      -- "₹150 Fine"
  amount         numeric(12,2) not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint penalty_matrix_unique_step unique (variant_id, violation_type, occurrence_no)
);

create index if not exists penalty_matrix_lookup_idx
  on public.penalty_matrix (variant_id, violation_type);

-- ---------------------------------------------------------------------
-- 7. VIOLATIONS REGISTER  (INITIAL_VIOLATIONS)
-- ---------------------------------------------------------------------
create table if not exists public.violations (
  id             text primary key,                   -- "VIO_01"
  coach_id       text not null references public.coaches (id) on delete cascade on update cascade,
  type           text not null,
  occurrence_no  integer not null default 1,
  consequence    text,
  penalty_amount numeric(12,2) not null default 0,
  incident_date  date not null,
  incident_time  text,
  reported_by    text,
  evidence       text,
  status         text not null default 'Pending_Acknowledge'
                   check (status in ('Pending_Acknowledge','Acknowledged','Appeal_Raised','Waived','Upheld')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists violations_coach_idx  on public.violations (coach_id);
create index if not exists violations_date_idx   on public.violations (incident_date);
create index if not exists violations_status_idx on public.violations (status);

-- ---------------------------------------------------------------------
-- 8. APPEALS
-- ---------------------------------------------------------------------
create table if not exists public.appeals (
  id            text primary key,                    -- "APP_1234567"
  coach_id      text not null references public.coaches (id) on delete cascade on update cascade,
  target_type   text not null check (target_type in ('Violation','Score','Payslip','Other')),
  target_id     text,
  reason        text not null,
  raised_at     timestamptz not null default now(),
  status        text not null default 'PENDING_RM'
                  check (status in ('PENDING_RM','PENDING_HR','APPROVED','REJECTED','WITHDRAWN')),
  rm_remark     text,
  hr_remark     text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists appeals_coach_idx  on public.appeals (coach_id);
create index if not exists appeals_status_idx on public.appeals (status);

-- ---------------------------------------------------------------------
-- 9. AUDIT LOG (append-only)
-- ---------------------------------------------------------------------
create table if not exists public.audit_log (
  id          text primary key,                      -- "AUD_1717..."
  timestamp   timestamptz not null default now(),
  actor       text not null,                         -- "Super Admin" | "Coach (Name)"
  action      text not null,
  details     text,
  ip          text,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create index if not exists audit_log_ts_idx on public.audit_log (timestamp desc);

-- ---------------------------------------------------------------------
-- 10. PAYROLL CYCLES  (replaces the single `payrollLocked` boolean)
-- ---------------------------------------------------------------------
create table if not exists public.payroll_cycles (
  period_month  text primary key,                    -- "June 2026"
  period_start  date not null,
  period_end    date not null,
  locked        boolean not null default false,
  locked_by     text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 11. APP USERS / ROLES  (who may sign in and as what)
-- ---------------------------------------------------------------------
create table if not exists public.app_users (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  full_name  text,
  avatar_url text,
  role       text not null default 'Coach'
               check (role in ('Super Admin','HR Manager','Finance','Operations',
                               'Reporting Manager','Coach')),
  coach_id   text references public.coaches (id) on delete set null on update cascade,
  rm_id      text,                                   -- "RM_01" when role = Reporting Manager
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- New auth.users rows get an app_users profile automatically. Role/coach_id
-- come from the signup metadata when present, else default to an unlinked
-- Coach that an admin promotes.
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
  -- Google sign-ins carry no role, so link them to a coach record by email
  -- when one matches. Anything else lands as an unassigned Coach and the app
  -- shows an "access pending" screen until an admin sets the role.
  select c.id into matched_coach
  from public.coaches c
  where lower(c.email) = lower(new.email)
  limit 1;

  -- Outside the workspace: create no profile at all. The account may exist in
  -- auth.users (Google let them through) but it maps to nothing and RLS gives
  -- it nothing.
  if lower(new.email) not like '%@hbplus.fit' then
    return new;
  end if;

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
-- 12. updated_at triggers
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'variants','certifications','coaches','performance_records','org_work',
    'penalty_matrix','violations','appeals','payroll_cycles','app_users'
  ]
  loop
    execute format('drop trigger if exists set_updated_at on public.%I', t);
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- Role of the signed-in user, read from app_users (defined here: after the
-- app_users table it reads, before the policies that reference it). security definer so it can read the table
-- without recursing through that table's own policies.
create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.app_users where id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- 13. ROW LEVEL SECURITY
--     Every table requires a session AND an @hbplus.fit identity. Tighten
--     further per role from here.
-- ---------------------------------------------------------------------
-- The workspace allowed to sign in. Every RLS policy below is gated on this,
-- so a Google account outside the domain gets a valid session and zero rows —
-- the client-side checks are convenience, this is the control.
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

-- The audit trail must not be editable after the fact.
drop policy if exists "authenticated_all"  on public.audit_log;
drop policy if exists "hbplus_domain_all"  on public.audit_log;
drop policy if exists "audit_read"         on public.audit_log;
drop policy if exists "audit_insert"       on public.audit_log;
create policy "audit_read" on public.audit_log
  for select to authenticated using (public.is_allowed_domain());
create policy "audit_insert" on public.audit_log
  for insert to authenticated with check (public.is_allowed_domain());

-- app_users is the one table already tightened: you may read your own profile,
-- and admins manage everyone's. (current_app_role() is security definer, so it
-- reads the table without tripping these policies.)
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

-- Tighten any other table the same way, e.g.
--   using (public.is_allowed_domain()
--          and public.current_app_role() in ('Super Admin','HR Manager'))

-- ---------------------------------------------------------------------
-- 13b. IN-APP ROLE MANAGEMENT
--      Two RPCs behind the dashboard's "User Access" screen, so an admin
--      assigns roles there instead of running UPDATEs by hand. Both are
--      SECURITY DEFINER with the permission check in the body.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 14. Convenience view: current open cycle with the coach joined in
-- ---------------------------------------------------------------------
create or replace view public.v_current_scorecards as
select
  p.*,
  c.name            as coach_name,
  c.variant_id,
  c.coach_category,
  c.assigned_property,
  c.reporting_manager_id
from public.performance_records p
join public.coaches c on c.id = p.coach_id
where p.record_type = 'current';

-- ---------------------------------------------------------------------
-- 15. Realtime (so two HR users see each other's edits live)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'coaches','performance_records','violations','appeals','org_work',
    'audit_log','payroll_cycles'
  ]
  loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
