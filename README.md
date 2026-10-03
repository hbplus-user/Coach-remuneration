# HB+ Coach Remuneration & Performance Management

An internal web application for scoring coaches each month, working out what
they are paid, recording disciplinary incidents, and producing payslips.

It replaces the spreadsheet that used to carry the HB+ benchmark score and the
compensation tables, and keeps the score, the pay and the penalty record in one
place so that a figure on a payslip can be traced back to what caused it.

---

## Contents

- [What it does](#what-it-does)
- [Who uses it](#who-uses-it)
- [The pay cycle](#the-pay-cycle)
- [The HB+ score](#the-hb-score)
- [How pay is worked out](#how-pay-is-worked-out)
- [Penalties](#penalties)
- [Screen by screen](#screen-by-screen)
- [Recording and saving](#recording-and-saving)
- [Running it](#running-it)
- [Known gaps](#known-gaps)

---

## What it does

| | |
|---|---|
| **Scores** | Each coach, each month, against seven weighted criteria totalling 100 |
| **Pays** | Fixed, Flexi and Flexi-Fixed models, with incentives, bonuses and org work |
| **Penalises** | A 56-violation matrix with progressive consequences, plus missed-session charges |
| **Produces** | Payslips with statutory TDS, and a payroll run exportable as CSV |
| **Records** | An audit trail of every score edit, lock, penalty and pay change |

---

## Who uses it

Access is by Google sign-in, restricted to one Google Workspace domain. A new
sign-in has no permissions until a Super Admin assigns a role.

| Role | Scores | Lock / unlock | Profile & pay | Sees pay | Certifications | User access |
|---|---|---|---|---|---|---|
| **Super Admin** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **HR Manager** | ✅ | ✅ | ✅ | ✅ | — | — |
| **Finance** | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| **Reporting Manager** | ✅ | ✅ | — | ✅ | ✅ | — |
| **Showrunner** | ✅ | — | — | **hidden** | — | — |

**Showrunner** is the operations role. They record what happened during the
month but never see bank details, salary or payslips, and cannot settle a month
by locking it.

---

## The pay cycle

A cycle runs from the **16th of one month to the 15th of the next**, and is
named for the month it pays in.

```
May 2026        16 Apr – 15 May
June 2026       16 May – 15 Jun
July 2026       16 Jun – 15 Jul
```

The cycle rolls over on its own once the calendar passes the end date. Closing a
cycle does **not** lock it — locking is always a deliberate act, because data
often arrives after the calendar has moved on.

A **locked** month is read-only for everyone, Super Admin included. The way back
in is the padlock on Record Status, which writes an audit entry naming who
reopened it.

---

## The HB+ score

Seven criteria, weighted to 100. The weights below are the S&C policy; each
policy variant carries its own.

| Criterion | Weight | Where it comes from |
|---|---|---|
| Core Performance | **28%** | Six cells rated by hand each month |
| Elevate+ Attendance | **25%** | Meetings attended ÷ scheduled |
| Org Reliability (tenure) | **15%** | Joining date, capped at five years |
| Technical Certification | **15%** | Highest certification on the profile |
| Coaching Experience | **8%** | Post-joining plus documented freelance |
| Non-Tech Education | **5%** | Qualification × study format |
| Non-Coaching Experience | **4%** | Years, halved, capped at ten |

The score places the coach in one of seven **bands**, from `0–30 Non-Functional`
to `80–90 Exceptional`.

Most cells are calculated. The six Core Performance cells and the session counts
are keyed in. A calculated cell can be overridden by hand, but it asks first and
stops following the calculation until it is reset.

---

## How pay is worked out

### Three models

| Model | Base | Per session |
|---|---|---|
| **Fixed** | Monthly salary | Only on sessions beyond the threshold (156 for S&C, 117 for Yoga) |
| **Flexi** | None | Every session |
| **Flexi-Fixed** | Small base | Every session, plus eligible for org work |

### Where the figures come from

Pay does **not** follow the band. The benchmark score forecasts what the band
would pay; what is actually paid is a stored figure, resolved in this order:

```
1. the month's own figure          ← set on that month
2. carried from an earlier month   ← the last month that had one
3. the coach profile               ← set when the coach was created
4. the band rate                   ← only where nothing has ever been set
```

Carry-forward only ever looks **backwards**, so setting August's pay cannot
change May. Each screen says which of the four a figure came from.

### The Fixed per-session rate

```
monthly pay ÷ 26 days ÷ 6 sessions,  floored at ₹200
```

So ₹32,947 gives ₹211. Flexi and Flexi-Fixed use the band's own session rate.

### On top of base pay

- **Night sessions** — ₹60 each, Flexi and Flexi-Fixed only
- **Milestone incentive** — by session count: Fixed 156 → ₹1,000, 182 → ₹2,000
- **Consistency bonus** — ₹500 at 95%+ attendance with no violations or no-shows
- **5-star streak** — ₹200 per 10 consecutive (₹500 per 15 on Yoga)
- **Org work** — approved items, Flexi and Flexi-Fixed only

### Deductions

- **Penalties** — recorded incidents, plus missed sessions
- **TDS u/s 194J** — 10% of gross, withheld in whole rupees

---

## Penalties

### Violation matrix

**Annexure 1B** covers online and remote delivery: 56 violations across seven
categories — punctuality, technical readiness, roster responsiveness, programme
quality, conduct, commercial integrity, and safety. Each has up to four
progressive steps and its own severity.

Consequences are recorded in the annexure's own wording, because most of a
consequence is not money — warnings, makeup sessions, leave deductions, slot
reassignment, termination review. Only the rupee figure inside it is deducted.

Each violation also carries a **tracking window** that decides when the count
starts again:

- **Monthly** — most technical and punctuality faults
- **Quarterly** — appearance, roster refusals, unapproved leave
- **Lifetime** — conduct, safety, commercial and data integrity

Past the last step defined, the last step stands. A violation whose third step
is termination has no fourth step, and does not fall back to a warning.

Where a coach's policy variant has its own rule for a violation, that wins;
otherwise Annexure 1B applies.

### Missed sessions

Charged at a multiple that rises with the count, applied to the **whole** count:

| Missed | Multiplier | At ₹200 |
|---|---|---|
| 1–5 | 1× | 3 missed → ₹600 |
| 6–10 | 1.5× | 8 missed → ₹2,400 |
| 11+ | 2× | 12 missed → ₹4,800 |

For a Fixed coach the rate is **monthly pay ÷ 26 ÷ 5**, floored at ₹200 — five
sessions a day, not the six that pay uses, so a missed session costs more than a
worked one earns.

A waived incident stays on the record and still counts toward the occurrence
history, but is not charged.

---

## Screen by screen

**Dashboard** — evaluations done, pending review, risk watchlist, and band
movement. The band movement card names who moved and which way, and opens the
Score Tracker.

**Coach Master** — the roster, with band and joining date. Click through for the
full profile: bank details, certifications, education, org work, the month-by-
month score card, the pay calculator and payslips.

**Score Tracker** — every coach × every month, one tab per criterion group, with
the working shown. Band cells are tinted green or red where the band moved.
Template download and bulk upload work per tab.

**Payroll Calculator** — the payroll run for a period, plus a calculator that
loads a coach's recorded figures and lets any input be modelled. Shows the
benchmark range and whether the coach is actually paid within it.

**Penalties** — the matrix, the recorded incidents, and the form for logging
one. The form is built from the matrix, so nothing can be logged that has no
rule behind it.

**Certifications** — the masters that points are looked up from: technical
certifications, education levels and study formats.

**User Access** — Super Admin only. Assigns roles and reporting-manager scope.

---

## Recording and saving

**Score cards save themselves** a couple of seconds after typing stops. The bar
above the table says whether they have. Pressing **Save** closes the row and
writes the audit entry.

Auto-save deliberately refuses two things and leaves them to the button:
overriding a calculated cell, which is a decision a timer should not make, and
saving a month with nothing in it, which would record it as all zeros.

**An edit in progress is never lost.** Opening another month sets the current
draft aside and hands it back when that month is reopened. An amber dot marks a
row holding unsaved work.

**Bulk upload** is per tab. Download the template for the tab you are on, fill
it, and upload it against a chosen month. An editable preview appears, errors
are flagged cell by cell, and nothing is written until it is accepted. Errors
can be bypassed, which applies everything valid and leaves the bad cells out.

**Locks reach every open tab** within fifteen seconds, and immediately on
returning to the tab, so a padlock set by one person is not stale for anyone
else.

---

## Running it

**Stack** — React 18, Vite 5, Supabase (Postgres, Row Level Security, Google
OAuth), deployed on Vercel.

```bash
npm install
npm run dev      # local, port 5173
npm run build    # production bundle
```

### Environment

Copy `.env.example` to `.env`:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_ALLOWED_EMAIL_DOMAIN=hbplus.fit
```

The anon key is safe in the browser — Row Level Security is what enforces
access. The service role key is for the seed script only and must never be
exposed.

### Database

The schema is 13 tables. `supabase/schema.sql` creates them; the numbered
migrations in `supabase/` are applied in order after it. **SQL files are
gitignored**, so they are not distributed with the repository.

A migration must be run **before** the code that depends on it is deployed.
Several add columns that the app sends on every write, and until the column
exists that write is rejected — which shows up as a red *"Not saved to
Supabase"* banner and nothing saving.

### Data model

| Table | Holds |
|---|---|
| `coaches` | Profiles, bank details, certifications, education, pay overrides |
| `performance_records` | One row per coach per month — the score card |
| `violations` | Recorded disciplinary incidents |
| `org_work` | Org work items and their approval |
| `variants` | Policy weights and rate cards |
| `payroll_cycles` | Which cycle is open, and its lock |
| `certifications`, `education_levels`, `education_formats` | The points masters |
| `appeals`, `audit_log`, `app_users` | Appeals, the audit trail, role assignments |

---

## Known gaps

Worth knowing before relying on the numbers.

**Coaches with no policy variant.** Nutrition, Physio and Mental Health have no
variant, so those coaches read as unscored and unpaid rather than being scored
on another discipline's rules. They need a variant, or new variants need
creating with their own thresholds.

**Coaches with no joining date** score full marks for tenure — 15% of the
score — because a missing date reads as 1970 against a five-year cap. Coach
Master shows these as **Not set**.

**Permissions are enforced in the browser.** Role gating decides what is shown
and what can be edited, but Row Level Security does not yet cover the score card
tables. Anyone who can reach the API with a valid session could read more than
their role shows them.

**`penalty_matrix` in the database is unused.** Every penalty amount comes from
the matrix in the code. Editing that table changes nothing.

**`v_current_scorecard` is unrestricted.** A view without RLS reads through to
the tables beneath it. Nothing in the app uses it.

**Two definitions of per-session rate disagree.** A Fixed coach's rate is
derived from their pay; the band's own `per_session` column is used by Flexi.
The derived range never contains the column value, so the reference tables read
as though one number serves both when it does not.

**Band variation is inconsistent.** The band table lists a variation narrowing
from 15% to 1% as performance improves, but every band's actual salary range is
a flat ±10%. The ranges are what the app uses.
