# Supabase setup

## 1. Create the tables
Supabase Dashboard → **SQL Editor** → New query → paste all of
[`schema.sql`](schema.sql) → **Run**. It is idempotent, so re-running is safe.

Tables created:

| Table | Replaces (in `src/data.js` / `App.jsx`) |
|---|---|
| `variants` | `INITIAL_VARIANTS` — weights / rates / milestones as JSONB |
| `certifications` | `INITIAL_CERTIFICATIONS` |
| `education_formats` | `INITIAL_EDUCATION_FORMATS` |
| `education_levels` | `INITIAL_EDUCATION_LEVELS` |
| `coaches` | `INITIAL_COACHES` |
| `performance_records` | `INITIAL_HISTORIC_MONTHS` + `INITIAL_CURRENT_MONTH` (split by `record_type`) |
| `org_work` | `INITIAL_ORG_WORK` |
| `penalty_matrix` | `PENALTY_MATRIX`, flattened to one row per occurrence step |
| `violations` | `INITIAL_VIOLATIONS` |
| `appeals` | `appeals` state |
| `audit_log` | `auditLog` state (insert + select only, no update/delete) |
| `payroll_cycles` | the `payrollLocked` boolean, now per period |
| `app_users` | new — maps an `auth.users` row to a role and a coach/RM id |

## 2. Sign-in

**Google only, restricted to `@hbplus.fit`.** There is no password form. The
restriction is enforced in three places, and only the last one is a real
control:

| Layer | What it does | Bypassable? |
|---|---|---|
| `hd=hbplus.fit` on the OAuth request | Google shows only workspace accounts | Yes — a URL edit |
| `AuthGate` signs out a foreign account | Clear "Wrong account" screen | Yes — it's client code |
| **`is_allowed_domain()` in every RLS policy** | Outside accounts read and write nothing | **No** |

The signup trigger also refuses to create an `app_users` profile for an address
outside the domain, so a stray Google account maps to nothing.

### Configure the redirect

**Authentication → URL Configuration → Redirect URLs** must list every origin
the app runs on, or Google refuses the round-trip:

```
http://localhost:5173        <- vite dev
https://your-app.vercel.app  <- production
```

Set **Site URL** to the production origin.

> **Optional, and the strongest gate available:** in Google Cloud Console set
> the OAuth consent screen for this client to **Internal**. Google then refuses
> non-workspace accounts before Supabase is ever reached.

### Assign a role

Signing in creates a row in `public.app_users` automatically (trigger
`on_auth_user_created`). It defaults to role `Coach`, except that an address
matching a `coaches.email` is linked to that coach record automatically.
Anyone with role `Coach` and no linked coach sees an **"Access pending"**
screen rather than the dashboard.

**Roles are assigned in the app.** Once you are an admin, open
**User Access** in the sidebar: it lists everyone who has signed in, badges the
accounts still waiting on a role, and lets you set the role and its binding from
a dropdown. Behind it are two RPCs (`admin_list_users`, `admin_set_access`) that
re-check permissions server-side and write to the audit trail.

Only the very first admin has to be made in SQL, since there is nobody to grant
it yet. After your own first sign-in:

```sql
update public.app_users
   set role = 'Super Admin', full_name = 'Your Name'
 where email = 'you@hbplus.fit';
```

Sign out and back in, and User Access appears. Everyone else you grant from
there. [`roles.sql`](roles.sql) still has the equivalent SQL if you would rather
work in the editor, or need to fix something without a working login.

Valid roles: `Super Admin`, `HR Manager`, `Finance`, `Operations`,
`Reporting Manager`, `Coach`. Two need a binding as well as a role — a `Coach`
must be linked to a coach record, a `Reporting Manager` to a squad — and the
screen will not let you save without it. Only `Super Admin` sees the header role
switcher; everyone else is pinned to their own role.

Guardrails enforced in `admin_set_access`, not just the UI: an HR Manager cannot
grant or revoke `Super Admin`, and the last `Super Admin` cannot be demoted.

To change the allowed domain you must edit it in **both** places — it is
compiled into the SQL policies as well as the client:
`VITE_ALLOWED_EMAIL_DOMAIN` in `.env`, and the two `'%@hbplus.fit'` literals in
`schema.sql` (`is_allowed_domain()` and `handle_new_auth_user()`).

> **Already ran `schema.sql` before these were added?** Run
> [`google-auth.sql`](google-auth.sql) for the domain gate and the upgraded
> signup trigger, and [`role-management.sql`](role-management.sql) for the
> User Access RPCs. A fresh `schema.sql` run already includes both.

## 3. Get your keys
Dashboard → **Project Settings → API**. Copy `.env.example` to `.env` and fill in
the Project URL, the `anon` key (browser) and the `service_role` key (seed script
only — it bypasses RLS, never put it in client code).

## 4. Load the seed data
Optional — **the app seeds itself**: the first time someone signs in against an
empty `coaches` table, it pushes the reference data from `src/data.js` and says
so in a toast. To load it up front instead:

```bash
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed.mjs
```
Expected: 5 variants, 14 certifications, 3 study formats, 12 education levels, 18 coaches, 21 performance records,
1 org-work row, 2 violations, 164 penalty-matrix rows, 1 payroll cycle.

## 5. Row Level Security
RLS is ON for every table with a single `authenticated` policy, so nothing is
readable without a signed-in session. Tighten later with the included helper:

```sql
drop policy "authenticated_all" on public.coaches;

create policy "hr_writes_coaches" on public.coaches
  for all to authenticated
  using (public.current_app_role() in ('Super Admin','HR'))
  with check (public.current_app_role() in ('Super Admin','HR'));

create policy "coach_reads_own" on public.coaches
  for select to authenticated
  using (id = (select coach_id from public.app_users where id = auth.uid()));
```

## 6. Common queries

```sql
-- Open cycle scorecards with coach details (view ships in schema.sql)
select * from public.v_current_scorecards where period_month = 'June 2026';

-- Penalty total per coach for a period
select coach_id, sum(penalty_amount) as penalties
from public.violations
where incident_date between '2026-05-16' and '2026-06-15'
group by coach_id;

-- Next occurrence number for a progressive penalty
select coalesce(max(occurrence_no), 0) + 1
from public.violations
where coach_id = 'HB+_023' and type = 'Late Arrival (<5 min)';

-- Close a period: current -> historic, then open the next one
update public.performance_records
   set record_type = 'historic', status = 'FINANCE_LOCKED'
 where record_type = 'current' and period_month = 'June 2026';

update public.payroll_cycles
   set locked = true, locked_by = 'Finance', locked_at = now()
 where period_month = 'June 2026';
```
