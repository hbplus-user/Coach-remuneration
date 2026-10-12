# HB+ Coach Remuneration & Performance — Product Requirements

**What this is.** A specification of the system as it stands, not a plan for one
to be built. Every rule below was read out of the code rather than from
memory, and where a rule exists only partly, or contradicts another, it says so.

**Who it is for.** Someone inheriting this system, and the HR and payroll
people who need to confirm the rules are the ones they asked for.

**Companion:** [TRD.md](TRD.md) — how it is built. [README.md](../README.md) —
how to run it.

---

## Contents

1. [Purpose](#1-purpose)
2. [Roles and what each may do](#2-roles-and-what-each-may-do)
3. [The pay cycle](#3-the-pay-cycle)
4. [The HB+ score](#4-the-hb-score)
5. [Pay](#5-pay)
6. [Penalties](#6-penalties)
7. [Attendance](#7-attendance)
8. [Leave](#8-leave)
9. [Payslips and payroll](#9-payslips-and-payroll)
10. [Bulk entry](#10-bulk-entry)
11. [Audit](#11-audit)
12. [Screens](#12-screens)
13. [Rules that are not written anywhere else](#13-rules-that-are-not-written-anywhere-else)
14. [Known gaps](#14-known-gaps)

---

## 1. Purpose

Score coaches monthly against seven weighted criteria, work out what each is
paid under one of three pay models, record disciplinary incidents and
attendance, and produce payslips — with every figure traceable to what caused
it.

It replaces a spreadsheet that held the HB+ benchmark score and the
compensation tables separately from the penalty record, which meant a
deduction on a payslip could not be traced back.

---

## 2. Roles and what each may do

Access is Google sign-in restricted to one Workspace domain. A new account has
no permissions until a Super Admin assigns a role.

| | Super Admin | HR Manager | Finance | Reporting Manager | Showrunner | Coach |
|---|---|---|---|---|---|---|
| Record scores | ✅ | ✅ | ✅ | ✅ | ✅ | — |
| Lock / unlock a month | ✅ | ✅ | ✅ | ✅ | — | — |
| Profile & pay | ✅ | ✅ | ✅ | — | — | — |
| See pay at all | ✅ | ✅ | ✅ | ✅ | **hidden** | own only |
| Decide leave | ✅ | ✅ | — | ✅ own squad | — | — |
| Attendance & Leave | ✅ | ✅ | ✅ | ✅ own squad | ✅ | own only |
| Certifications | ✅ | — | ✅ | ✅ | — | — |
| User Access | ✅ | — | — | — | — | — |

**Showrunner** is operations: they record what happened but never see bank
details, salary or payslips, and cannot settle a month.

**Reporting Manager** is scoped to their own squad — one roster backs the
picker, register, login log, photo batch, cover check and all four reports, so
the limit cannot hold in one place and not another.

**Coach** sees their own month only: hours, leave, score, incidents, payslips.

---

## 3. The pay cycle

Runs **16th to 15th**, named for the month it pays in.

```
May 2026    16 Apr – 15 May
June 2026   16 May – 15 Jun
July 2026   16 Jun – 15 Jul
```

It rolls over on its own once the calendar passes the end date. **Closing does
not lock.** Locking is deliberate, because data arrives after the calendar
moves on.

A **locked** month is read-only for everyone including Super Admin. The way
back in is the padlock on Record Status, which writes an audit entry.

Months missing from the sequence are rebuilt on load, per coach, only between
that coach's earliest record and the open period.

---

## 4. The HB+ score

Seven criteria weighted to 100. Weights are per policy variant; S&C shown.

| Criterion | Weight | Source |
|---|---|---|
| Core Performance | **28%** | six cells rated by hand each month |
| Elevate+ Attendance | **25%** | meetings attended ÷ scheduled |
| Org Reliability (tenure) | **15%** | joining date, capped at 5 years |
| Technical Certification | **15%** | highest certification held |
| Coaching Experience | **8%** | post-joining plus documented freelance |
| Non-Tech Education | **5%** | qualification × study format |
| Non-Coaching Experience | **4%** | years, halved, capped at 10 |

**Bands:** `0–30 Non-Functional`, `30–40 Weak`, `40–50 Basic`, `50–60 Stable`,
`60–70 Good`, `70–80 High-Quality`, `80–90 Exceptional`.

**Variants:** V1 S&C Internal, V2 S&C External, V3 Yoga Internal, V4 Yoga
External, V5 S&C Internal (HOP), V6 Yoga Internal. Only V1, V3, V5, V6 are
offered on forms.

Masters behind it: **14** technical certifications, **12** education levels,
**3** study formats — all maintained by HR and Finance.

A calculated cell may be overridden by hand. It asks first, and stops
following the calculation until reset.

---

## 5. Pay

### Models

| Model | Base | Per session |
|---|---|---|
| **Fixed** | monthly salary | only beyond the threshold (156 S&C, 117 Yoga) |
| **Flexi** | none | every session |
| **Flexi-Fixed** | small base | every session, and eligible for org work |

### Where the figures come from

Pay does **not** follow the band. The score forecasts; what is paid is stored,
resolved in this order:

```
1. the month's own figure
2. carried from the most recent earlier month that has one
3. the coach profile
4. the band rate — only where nothing has ever been set
```

Carry-forward looks **backwards only**, so setting August cannot change May.
Each field carries independently. Every screen says which of the four a figure
came from.

### Derived rates

```
Fixed per-session (pay)      monthly pay ÷ 26 ÷ 6,  floored at ₹200
Fixed per-session (penalty)  monthly pay ÷ 26 ÷ 5,  floored at ₹200
Loss of Pay, one day         base pay ÷ 26
```

The penalty rate is deliberately higher: five sessions a day, not six, so a
missed session costs more than a worked one earns.

### On top

- **Night sessions** — ₹60 each, Flexi and Flexi-Fixed only
- **Milestone** — Fixed 156 → ₹1,000, 182 → ₹2,000; Flexi 96 → ₹1,152, 135 → ₹2,025, 186 → ₹3,640
- **Consistency bonus** — ₹500 at ≥95% attendance, no violations, no no-shows, **no unplanned Loss of Pay**
- **5-star streak** — ₹200 per 10 consecutive (₹500 per 15 on Yoga)
- **Org work** — approved items, Flexi and Flexi-Fixed only

### Deductions, in order

```
earnings
  − Loss of Pay          days × base ÷ 26
  − penalties            incidents + missed sessions
  = taxable
  − TDS u/s 194J  10%    whole rupees
  = net
```

Loss of Pay comes off **before** tax and appears as its own payslip line,
apart from penalties: one is time not worked, the other a charge for conduct.

---

## 6. Penalties

### Two matrices

**Annexure 1B** — online and remote: **57 violations** across eight
categories (Punctuality & Session Attendance, Attendance & Punctuality,
Technical Readiness, Roster & Responsiveness, Programme Quality & Data,
Conduct & Client Interaction, Commercial/Data/IP Integrity, Safety & Scope).
Up to four progressive steps each, with a severity of Minor, Moderate, Major
or Critical.

**Per-variant rules** — the original five per discipline. Where a variant has
its own rule for a violation, it wins; otherwise 1B applies.

Consequences are stored in the annexure's own wording, because most of a
consequence is not money. Only the rupee figure inside it is deducted.

### Occurrence and windows

The step charged depends on how many times it has happened inside a window:

- **Monthly** — most technical and punctuality faults
- **Quarterly** — appearance, roster refusals, unapproved leave
- **Lifetime** — conduct, safety, commercial and data integrity

Past the last step defined, the last step stands. Several violations end at
termination with no fourth step, and a missing step must not read as a free
pass.

### Status

`Pending_Acknowledge` → `Acknowledged` → `Appeal_Raised` → `Upheld` / `Waived`.
**Only Waived and a successful appeal stop the money.** Everything else is
charged.

### Missed sessions

Charged at a multiple that rises with the count, applied to the **whole** count:

| Missed | × | At ₹200 |
|---|---|---|
| 1–5 | 1 | 3 → ₹600 |
| 6–10 | 1.5 | 8 → ₹2,400 |
| 11+ | 2 | 12 → ₹4,800 |

---

## 7. Attendance

### The working day

**4 AM to 2 AM** the following morning, IST. A coach logs in and out as often
as the day needs; an evening session past midnight belongs to the day it
started in.

A period shorter than **5 minutes** does not count.

### Logging in

Both are **mandatory**: location first, then a photograph. Three failures in a
row — refused camera, dark frame, failed upload, unavailable location — earn
the way past, and a clean login resets the count.

- Dark frames are refused as "no face detected". There is no face matching.
- Photographs go to a private bucket, kept **180 days**, downloadable in batches as a ZIP.
- Centre coaches must be within **200 m**; remote coaches may be anywhere.
- Location is recorded at both ends and shown to managers.

### Expected hours

From the availability system; where it gives nothing, the standard stands in:
**Fixed and Flexi-Fixed 9 h, Flexi 6 h**.

### Settling a day

Nothing is charged until someone settles it. Available to Super Admin, HR and
Reporting Manager; refused while anyone is still logged in, or where a leave
application for that day is undecided.

| Logged | Outcome |
|---|---|
| Within 15 min of expected | nothing owed |
| Short by up to half the day | punctuality violation, at its occurrence |
| Short by more than half, or no login | **1 day Loss of Pay** |
| Weekly off, holiday, approved leave | nothing |
| Availability system down | flagged for review, nothing charged |

Hours beyond availability are **not** paid by the hour; sessions in that time
are paid under the session rules.

---

## 8. Leave

**Leave year: 16 January to 15 December**, so accrual lines up with payroll.

| Type | Entitlement | Notice | Half day | Carry forward |
|---|---|---|---|---|
| **Paid** | 1 day / cycle | 3 days | ✅ | up to 5, excess encashed |
| **Sick** | 1 day / cycle | none — same day, or within 2 days of returning | ✅ | lapses |
| **Holiday** | the published list | none | ✅ | n/a |
| **Period** | 0.5 day / cycle, female only | none | ✅ | lapses |
| **Maternity** | 182 days, female only | 30 days | — | n/a |
| **Paternity** | 5 days, male only | 3 days | — | n/a |
| **Loss of Pay** | unlimited, unpaid | none | ✅ | n/a |

> ⚠️ Paid, Sick and Period accruals are **placeholders**. HR has not confirmed them.

**Half a day** is 4.5 h for Fixed and Flexi-Fixed. Flexi coaches have none.

### Rules

- **A reason is required** on every application, every type, every user.
- A **weekly off or published holiday inside a span** is not charged as leave.
- **Holiday Leave** is the inverse: it claims only published holidays, and a span containing any other date is refused, naming which.
- Balance is **debited when applied for**, returned if refused.
- Paid and Holiday Leave are **blocked without notice** — the coach is told to apply as Loss of Pay instead.
- An approver may **grant beyond balance**; a coach may not.
- Sick leave past 2 consecutive days needs a certificate.

### Decisions

Reporting Manager for their squad; HR and Super Admin stand in. Due within **3
working days** — shown, not sent. Nothing is marked Loss of Pay while an
application waits.

An approver may **approve in full, approve in part** (rest returned, comment
required), **approve as a different type** (comment required), or **reject**
(reason required, appealable).

Cancellation returns only days not yet taken.

### Loss of Pay

| Model | Deduction |
|---|---|
| Fixed | base ÷ 26 per day |
| Flexi-Fixed | small base ÷ 26 per day |
| Flexi | **recorded only, nothing deducted** |

**Unplanned** Loss of Pay costs the consistency bonus; approved leave does not.
Days are editable only by Super Admin and HR, and the correction is named in
the audit entry.

---

## 9. Payslips and payroll

A payroll run is computed per period from each coach's recorded score card,
exportable as CSV. Lines that rest on no recorded data are marked.

A payslip shows earnings split by Basic / HRA / allowances, then deductions —
Loss of Pay, penalties, TDS — and net in words. Available once a month is
locked; Super Admin may view earlier. A coach may open **their own only**;
Showrunner none.

---

## 10. Bulk entry

| What | Template carries | Preview |
|---|---|---|
| Score card, per tab | what is recorded | editable grid, errors per cell, bypass |
| Holiday list | what is published | per line: add / already there / why not |
| Leave balances | what is held | per row, with `was` values |

Nothing is written until the preview is accepted.

---

## 11. Audit

Fifty-one distinct events are recorded, among them: score card edits, locks
and unlocks, pay overrides, violations logged and waived, leave applied,
approved, partially approved, rejected, cancelled, type-changed and granted
beyond balance, balance adjustments, logins and logouts with coordinates,
photograph downloads and purges, holiday changes, role switches.

The audit table is **insert-only** — readable and writable, never editable.

---

## 12. Screens

Grouped by when they are used.

**Every day** — Dashboard · Coach Master · Score Tracker · Attendance & Leave
**Each month** — Payroll Calculator
**Set up** — User Access · Penalties · Certifications

Each screen declares what it does to data: **Records**, **Works it out**, or
**Read only**. The Payroll Calculator is a model — only the two pay fields
write, and it names any input that has drifted from what is recorded.

Attendance & Leave is split into four tasks: **Leave**, **On the floor**, **a
coach**, **Setup & reports**.

---

## 13. Rules that are not written anywhere else

These exist only in the code. **A rebuild that does not know them will silently
drop them.**

1. Three login failures in a row before the camera may be skipped; a clean login resets the count.
2. Saving a month with nothing entered asks first — it would otherwise record all-zeros, which reads as recorded and scores as zero.
3. A pending leave application blocks settling that day.
4. Holiday Leave counts the opposite days from every other type.
5. Pay precedence is backwards-only; a later month cannot change an earlier one.
6. Auto-save refuses anything needing a decision — an override, or an empty month.
7. A score card draft is kept per coach and month, and survives switching away.
8. A waived incident still counts towards occurrence history, but is not charged.
9. Band 0–30 earns **no** per-session pay, whatever the rate (Reference Table A).
10. A blank record is skipped on rollover rather than overwriting a recorded one.
11. Two month arrays share one table; deletions are judged across both.
12. TDS is withheld in whole rupees, after Loss of Pay.
13. Unscored months are passed over in band-movement detection, not read as a fall.
14. A locked month is read-only for everyone, Super Admin included.

---

## 14. Known gaps

**Blocked externally**

- **Availability API** — every day takes the outage path: standard hours, flagged, nothing charged. The shortfall rules therefore never fire in anger.

**Needs a scheduler, which this stack has no**

- Auto-logout an hour after availability ends
- The 10-minute late grace (`late_by_minutes` is never computed)
- Year-end carry-forward and encashment — rules written and tested, nothing runs them
- Photograph deletion at 180 days — manual button only
- Daily settlement — a button someone presses, per coach, per day

**Not built**

- Notifications of any kind — in-app, Slack, email
- Configurable roles and permissions; they are lists in the source
- Medical certificate upload; maternity and paternity windows; period leave by work mode; per-week off override
- Coach stage transitions (Training → Probation → Confirmed)
- Post-lock adjustments rolling into the next open month
- Login attendance feeding the HB+ score under punctuality
- Minimum cover per discipline — `leave_minimums` is an empty table nothing reads
- Trial mode — penalties shown but not charged
- Manual login and logout, deliberately: it is regularisation, which policy forbids

**Data problems**

- Coaches with **no policy variant** (Nutrition, Physio, Mental Health) read as unscored and unpaid
- Coaches with **no joining date** score full tenure marks — 15% of the score, free
- Misfiled violations from a period when the incident form defaulted to the first coach

**Security**

- Row Level Security is **domain-wide**: any signed-in account on the company domain can read and write every table through the API. Who sees what is enforced in the browser only.
- `v_current_scorecard` is unrestricted and unused
- `penalty_matrix` exists in the database and is read by nothing

**Inconsistencies in the reference data**

- Band *variation* is listed as 15% → 1% narrowing by band, but every band's actual range is a flat ±10%. The ranges are what the app uses.
- Two definitions of per-session rate disagree: derived from pay for Fixed, the band's own column for Flexi. The derived range never contains the column value.
