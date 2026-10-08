/**
 * Attendance and Leave — the rules.
 *
 * Kept apart from calculations.js, which owns scoring and pay, because these
 * rules are answerable to the leave policy rather than to the compensation
 * tables. Pay only learns the outcome: how many days were lost.
 *
 * Two clocks run here and they are not the same. The PAY cycle is the 16th to
 * the 15th and names the month it pays in. The LEAVE year also runs 16th to
 * 15th, from 16 January to 15 December, so that a month of leave accrual lines
 * up exactly with a month of payroll.
 */

// ---------------------------------------------------------------------------
// The working day
// ---------------------------------------------------------------------------

/**
 * A working day runs 4 AM to 2 AM the following morning, India Standard Time.
 * A coach may log in and out any number of times inside that window, and a
 * late-evening session continuing past midnight still belongs to the day it
 * started in — which is why the day cannot simply be read off the date.
 */
export const WORKING_DAY_START_HOUR = 4;
export const WORKING_DAY_END_HOUR = 2; // of the following morning

/** A logged-in period shorter than this does not count towards the day. */
export const MIN_LOGIN_MINUTES = 5;

/** A login later than this past the start of availability is late. */
export const LATE_GRACE_MINUTES = 10;

/** A shortfall smaller than this is ignored rather than charged. */
export const SHORTFALL_TOLERANCE_MINUTES = 15;

/** How long after availability ends an open session is closed automatically. */
export const AUTO_LOGOUT_AFTER_HOURS = 1;

/** Login photographs are evidence for a limited time, then they are deleted. */
export const PHOTO_RETENTION_DAYS = 180;

/** A coach attached to a centre must be within this many metres of it. */
export const CENTRE_RADIUS_METRES = 200;

/**
 * Hours a coach is expected to be available for, where the availability system
 * gives nothing. Availability may never be set below these.
 */
export const STANDARD_DAILY_HOURS = {
  'Fixed': 9,
  'Flexi-Fixed': 9,
  'Flexi': 6
};

export const standardDailyHours = (category) => STANDARD_DAILY_HOURS[category] ?? 9;

/**
 * The working day a moment belongs to, as an ISO date.
 *
 * Anything before 4 AM belongs to the previous day, so a session running from
 * 11 PM to 1 AM counts once, against the day it began.
 */
export function workingDayOf(when) {
  const d = new Date(when);
  if (d.getHours() < WORKING_DAY_START_HOUR) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Total hours logged across every period of a day.
 *
 * Periods under five minutes are dropped before summing, so a mistaken login
 * and immediate logout adds nothing. An open period — logged in, not yet out —
 * counts up to `now`, so the figure on screen is live.
 */
export function loggedHoursForDay(periods, now = new Date()) {
  let minutes = 0;
  for (const p of periods || []) {
    if (!p.logged_in_at) continue;
    const start = new Date(p.logged_in_at);
    const end = p.logged_out_at ? new Date(p.logged_out_at) : new Date(now);
    const mins = (end - start) / 60000;
    if (mins < MIN_LOGIN_MINUTES) continue;
    minutes += mins;
  }
  return Math.round((minutes / 60) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Shortfall
// ---------------------------------------------------------------------------

/**
 * What a day's attendance comes to.
 *
 * Deliberately graded rather than proportional: a small shortfall is a conduct
 * matter and goes to the violation matrix, a large one is time not worked and
 * comes off pay. The boundary is half the day's expected hours.
 *
 *   no login at all          -> a full day of Loss of Pay
 *   short by more than half  -> a full day of Loss of Pay
 *   short by up to half      -> a punctuality violation
 *   short by under 15 min    -> ignored
 *
 * `availabilityMissing` means the availability system gave nothing, in which
 * case the standard hours stand in, the day is flagged for review, and nothing
 * is charged — a system outage is not the coach's failure.
 */
export function assessAttendanceDay({
  category,
  availabilityHours,
  loggedHours,
  onApprovedLeave = false,
  isWeeklyOff = false,
  isHoliday = false,
  availabilityMissing = false
}) {
  if (isWeeklyOff) return { outcome: 'weekly-off', shortfallHours: 0, lopDays: 0 };
  if (isHoliday) return { outcome: 'holiday', shortfallHours: 0, lopDays: 0 };
  if (onApprovedLeave) return { outcome: 'leave', shortfallHours: 0, lopDays: 0 };

  const expected = Number(availabilityHours) > 0
    ? Number(availabilityHours)
    : standardDailyHours(category);
  const logged = Math.max(0, Number(loggedHours) || 0);
  const shortfall = Math.max(0, expected - logged);

  if (availabilityMissing) {
    return { outcome: 'review', shortfallHours: shortfall, lopDays: 0, expected, logged };
  }
  if (logged === 0) {
    return { outcome: 'lop', shortfallHours: expected, lopDays: 1, expected, logged };
  }
  if (shortfall * 60 <= SHORTFALL_TOLERANCE_MINUTES) {
    return { outcome: 'ok', shortfallHours: 0, lopDays: 0, expected, logged };
  }
  if (shortfall > expected / 2) {
    return { outcome: 'lop', shortfallHours: shortfall, lopDays: 1, expected, logged };
  }
  return { outcome: 'violation', shortfallHours: shortfall, lopDays: 0, expected, logged };
}

/** Hours worked beyond availability are not paid by the hour — only sessions are. */
export const EXTRA_HOURS_ARE_PAID = false;

/** The violation a shortfall is recorded as, so attendance and conduct meet. */
export const SHORTFALL_VIOLATION = 'Logged-in Hours Short of Availability';

// ---------------------------------------------------------------------------
// Leave types
// ---------------------------------------------------------------------------

/**
 * `accrual` is days credited per pay cycle; `annual` is a fixed entitlement
 * that is not accrued. `gender` restricts who may hold the type at all.
 *
 * The numbers Human Resources have yet to confirm are marked, so that a
 * placeholder is never mistaken for policy.
 */
export const LEAVE_TYPES = [
  {
    id: 'PAID', label: 'Paid Leave', accrual: 1, carryForwardMax: 5,
    encashBeyondCarry: true, noticeDays: 3, halfDayAllowed: true,
    paid: true, note: 'Up to 5 days carry forward; beyond that is encashed at year end.'
  },
  {
    id: 'SICK', label: 'Sick Leave', accrual: 1, carryForwardMax: 0,
    noticeDays: 0, sameDayAllowed: true, backdateDays: 2,
    certificateAfterDays: 2, halfDayAllowed: true, paid: true,
    note: 'No notice needed. Same day before hours start, or within 2 days of returning.'
  },
  {
    // Not applied for. A published holiday is already excluded from attendance
    // and from any leave span crossing it, so an application would either be a
    // no-op on a real holiday or — as it was until now — a way to take paid
    // leave on a day that is not one. It stays as a type so the year's
    // holidays can be counted and shown, and is kept off the form.
    id: 'HOLIDAY', label: 'Holiday Leave', fromHolidayList: true, carryForwardMax: 0,
    notApplicable: true,
    noticeDays: 0, halfDayAllowed: false, paid: true,
    note: 'Taken automatically. A published holiday is not counted against anyone.'
  },
  {
    id: 'PERIOD', label: 'Period Leave', accrual: 0.5, carryForwardMax: 0,
    noticeDays: 0, gender: 'Female', halfDayAllowed: true, paid: true,
    note: 'One day, or half a day, per month by nature of employment. Does not carry over.'
  },
  {
    id: 'MATERNITY', label: 'Maternity Leave', annualDays: 182, carryForwardMax: 0,
    gender: 'Female', noticeDays: 30, halfDayAllowed: false, paid: true,
    splittable: true, beforeEventDays: 56,
    note: '26 weeks paid; up to 8 weeks may be taken before delivery.'
  },
  {
    id: 'PATERNITY', label: 'Paternity Leave', annualDays: 5, carryForwardMax: 0,
    gender: 'Male', noticeDays: 3, halfDayAllowed: false, paid: true,
    splittable: true, withinMonthsOfEvent: 3,
    note: '5 working days, paid, within 3 months of the birth. May be split.'
  },
  {
    id: 'LOP', label: 'Loss of Pay', accrual: 0, carryForwardMax: 0,
    noticeDays: 0, halfDayAllowed: true, paid: false, unlimited: true,
    note: 'Always available. Deducted from pay, and shown as its own payslip line.'
  }
];

export const leaveType = (id) => LEAVE_TYPES.find(t => t.id === id) || null;

/** The leave types a coach may hold, which depends on their gender. */
export function leaveTypesFor(coach) {
  return LEAVE_TYPES.filter(t => !t.gender || t.gender === coach?.gender);
}

/** The types that can actually be applied for. */
export function applicableLeaveTypes(coach) {
  return leaveTypesFor(coach).filter(t => !t.notApplicable);
}

/** Half a day, in hours. Flexi coaches have no half day. */
export function halfDayHours(category) {
  if (category === 'Flexi') return null;
  return standardDailyHours(category) / 2;
}

// ---------------------------------------------------------------------------
// The leave year, and accrual
// ---------------------------------------------------------------------------

/**
 * The leave year runs 16 January to 15 December, so that each month of accrual
 * lines up with a pay cycle rather than straddling two.
 */
export function leaveYearFor(date) {
  const d = new Date(date);
  const year = (d.getMonth() === 0 && d.getDate() < 16) ? d.getFullYear() - 1 : d.getFullYear();
  return { year, start: `${year}-01-16`, end: `${year}-12-15` };
}

/**
 * Days credited so far this leave year.
 *
 * Credit begins the month AFTER the coach becomes eligible, and runs to the
 * cycle being asked about — so a coach who joins mid-year is credited in
 * proportion to the months they were here, without that needing to be worked
 * out separately.
 */
export function accruedDays(type, { eligibleFrom, asOf }) {
  const policy = typeof type === 'string' ? leaveType(type) : type;
  if (!policy || !policy.accrual) return 0;

  const { start } = leaveYearFor(asOf);
  const from = new Date(Math.max(new Date(start), new Date(eligibleFrom || start)));
  const to = new Date(asOf);
  if (to < from) return 0;

  // Whole cycles elapsed, counting from the cycle after eligibility begins.
  const months = (to.getFullYear() - from.getFullYear()) * 12
    + (to.getMonth() - from.getMonth())
    + (to.getDate() >= 16 ? 1 : 0);
  return Math.max(0, Math.round(months * policy.accrual * 10) / 10);
}

/**
 * What crosses into the new leave year, and what is paid out instead.
 * Only Paid Leave carries, and only to its cap; the excess is encashed and
 * every other type lapses.
 */
export function yearEndCarry(typeId, closingBalance) {
  const policy = leaveType(typeId);
  const balance = Math.max(0, Number(closingBalance) || 0);
  if (!policy || !policy.carryForwardMax) return { carried: 0, encashed: 0, lapsed: balance };

  const carried = Math.min(balance, policy.carryForwardMax);
  const rest = balance - carried;
  return policy.encashBeyondCarry
    ? { carried, encashed: rest, lapsed: 0 }
    : { carried, encashed: 0, lapsed: rest };
}

// ---------------------------------------------------------------------------
// Notice, and whether an application may be made at all
// ---------------------------------------------------------------------------

/**
 * Whether an application can be submitted as it stands.
 *
 * Paid Leave and Holiday Leave are blocked without their notice — the coach is
 * told to apply for those days as Loss of Pay instead, rather than the system
 * quietly converting them, which would hide a decision that is theirs to make.
 */
export function checkLeaveApplication({ typeId, coach, from, days, balance, appliedOn = new Date() }) {
  const policy = leaveType(typeId);
  const problems = [];
  if (!policy) return { ok: false, problems: ['Unknown leave type.'] };

  if (policy.gender && coach?.gender !== policy.gender) {
    problems.push(`${policy.label} does not apply to this coach.`);
  }

  if (policy.notApplicable) {
    problems.push(
      `${policy.label} is not applied for. Published holidays are already not ` +
      `counted against anyone — there is nothing to claim.`);
  }

  const noticeGiven = Math.floor((new Date(from) - new Date(appliedOn)) / 86400000);
  if (policy.noticeDays && noticeGiven < policy.noticeDays && !policy.sameDayAllowed) {
    problems.push(
      `${policy.label} needs ${policy.noticeDays} days' notice and has ${Math.max(0, noticeGiven)}. ` +
      `Apply for these days as Loss of Pay instead.`
    );
  }

  if (!policy.unlimited && !policy.fromHolidayList) {
    const available = Number(balance) || 0;
    if (days > available) {
      problems.push(
        `Only ${available} day${available === 1 ? '' : 's'} of ${policy.label} left, and ${days} applied for. ` +
        `Apply for the extra ${Math.round((days - available) * 10) / 10} as Loss of Pay, ` +
        `or ask the Reporting Manager to grant beyond the balance.`
      );
    }
  }

  if (policy.certificateAfterDays && days > policy.certificateAfterDays) {
    problems.push(
      `A medical certificate is required for more than ${policy.certificateAfterDays} days in a row.`
    );
  }

  return { ok: problems.length === 0, problems, policy };
}

// ---------------------------------------------------------------------------
// Loss of Pay
// ---------------------------------------------------------------------------

/**
 * What one day of Loss of Pay costs.
 *
 * Divided by 26 — the same divisor the session rate uses, so a day off and a
 * day's sessions are valued consistently. A Flexi coach has no base pay, so
 * their Loss of Pay is a record of absence and nothing is deducted.
 */
export const LOP_WORKING_DAYS = 26;

export function lopPerDay(category, basePay) {
  if (category === 'Flexi') return 0;
  const base = Number(basePay) || 0;
  return Math.round((base / LOP_WORKING_DAYS) * 100) / 100;
}

export function lopDeduction(category, basePay, lopDays) {
  const days = Math.max(0, Number(lopDays) || 0);
  if (days === 0) return 0;
  return Math.round(lopPerDay(category, basePay) * days * 100) / 100;
}

/**
 * Loss of Pay that was not planned costs the consistency bonus for the cycle.
 * Leave that was applied for and approved does not, because the point of the
 * bonus is reliability rather than attendance for its own sake.
 */
export function unplannedLopBreaksConsistency(lopEntries) {
  return (lopEntries || []).some(e => !e.planned);
}
