import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { 
  INITIAL_VARIANTS, 
  INITIAL_CERTIFICATIONS, 
  INITIAL_COACHES, 
  INITIAL_VIOLATIONS, 
  INITIAL_HISTORIC_MONTHS, 
  INITIAL_CURRENT_MONTH, 
  INITIAL_ORG_WORK, 
  INITIAL_EDUCATION_LEVELS,
  INITIAL_EDUCATION_FORMATS,
  PENALTY_MATRIX,
  ONLINE_PENALTY_MATRIX,
  ONLINE_VIOLATION_CATEGORIES,
  VIOLATION_TRACKING
} from './data.js';

import {
  LEAVE_TYPES, leaveTypesFor, applicableLeaveTypes, leaveType, leaveYearFor, accruedDays,
  checkLeaveApplication, assessAttendanceDay, loggedHoursForDay, workingDayOf,
  standardDailyHours, halfDayHours, lopPerDay, MIN_LOGIN_MINUTES, SHORTFALL_VIOLATION,
  PHOTO_RETENTION_DAYS, CENTRE_RADIUS_METRES
} from './leave.js';
import {
  supabase, isSupabaseConfigured, loadState, loadLockState, syncState, isDatabaseEmpty,
  listAppUsers, setUserAccess, APP_ROLES, RM_SCOPES,
  uploadAttendancePhoto, signedPhotoUrls, deleteAttendancePhotos
} from './supabaseClient.js';
import { buildZip, downloadBlob } from './zip.js';

import { 
  computeHBPlusScore, 
  getPerformanceBand, 
  computeMonthlyPay, 
  getViolationOccurrenceNumber, 
  getPenaltyConsequence,
  isPenaltyChargeable,
  getQuarterLabel,
  calculateTenureYears,
  getEducationScore,
  setEducationScores,
  EDUCATION_TIERS,
  getHighestEducationEntry,
  amountInWords,
  fixedPerSessionRate,
  payslipEarnings,
  getPeriodForDate,
  getNextPeriod
} from './calculations.js';

// Phase 1 scope: only these modules are exposed in the UI.
// Add a view key back to this list to re-enable its nav item and its view section.
// A coach whose variant_id is null or points at a variant that is not loaded
// has no policy to be scored or paid on. Every screen read `vConfig.weights`
// or `vConfig.rates` straight off the lookup, so one such coach blanked the
// whole page with "Cannot read properties of undefined".
//
// The lookup now always returns a variant shape. The placeholder carries zero
// weights and no rates, so the coach reads as unscored and unpaid rather than
// being quietly scored on some other discipline's rules — the numbers stay
// honest, and the screens keep rendering.
const UNASSIGNED_VARIANT = {
  id: null,
  name: "No policy variant",
  discipline: "Unassigned",
  audience: "—",
  property: "—",
  is_active: false,
  placeholder: true,
  weights: {
    coaching_exp: 0, non_coaching_exp: 0, education: 0, technical_cert: 0,
    core_performance: 0, tenure: 0, attendance: 0
  },
  rates: { "Fixed": {}, "Flexi": {}, "Flexi-Fixed": {} }
};

const findVariant = (variants, variantId) =>
  (variants || []).find(v => v.id === variantId) || UNASSIGNED_VARIANT;

const ENABLED_VIEWS = ["dashboard", "coaches", "score-tracker", "pay-calculator", "attendance", "certifications", "penalties", "user-access"];
const isViewEnabled = (view) => ENABLED_VIEWS.includes(view);

// Coach disciplines offered on the Add Coach form, mapped to the policy variant
// whose weights/rates drive their remuneration. Pilates scores on the Yoga
// policy, Physio on the S&C policy, until dedicated variants exist.
const COACH_TYPES = [
  { value: "Strength", variant_id: "V1", reporting_manager_id: "RM_01" },
  { value: "Yoga", variant_id: "V3", reporting_manager_id: "RM_02" },
  { value: "Pilates", variant_id: "V3", reporting_manager_id: "RM_02" },
  { value: "Physio", variant_id: "V1", reporting_manager_id: "RM_01" }
];

const GENDER_OPTIONS = ["Male", "Female", "Other"];

const COACH_STATUSES = ["Active", "Suspended", "Exited"];
// Organisational work a coach can be put on, with the band each pays within.
// Flexi-Fixed and Flexi are org-work eligible; a Fixed coach's salary already
// covers work off the floor.
const ORG_WORK_TYPES = [
  { value: "Workout Planning / Programming", min: 3000, max: 4000 },
  { value: "Hiring Support",                 min: 1500, max: 2500 },
  { value: "Course Development",             min: 3500, max: 5500 },
  { value: "Coach Training / Mentoring",     min: 3500, max: 5500 }
];

const orgWorkBand = (type) => ORG_WORK_TYPES.find(t => t.value === type) || null;

/** What a coach's selected org work is worth at the band minimum. */
const ORG_WORK_CATEGORIES = ['Flexi-Fixed', 'Flexi'];
const isOrgWorkEligible = (category) => ORG_WORK_CATEGORIES.includes(category);

const orgWorkRate = (types) => (Array.isArray(types) ? types : [])
  .reduce((sum, t) => sum + (orgWorkBand(t)?.min || 0), 0);

const BANK_ACCOUNT_TYPES = ["Savings", "Current"];
const REPORTING_MANAGERS = ["RM_01", "RM_02", "RM_03"];

// Pay structures; each maps to a rates/milestones table on the policy variant.
// A variant is its discipline and the property it runs at. Dropping the
// property made V1 and V5 render identically — both "S&C (Internal)" — so it
// belongs in every label a user picks from.
// The policies offered when assigning or modelling: HB+ S&C, HB+ Yoga,
// HOP S&C and HOP Yoga. The others stay in the data — a coach already on one keeps scoring
// against it, and its rate card is untouched — they are simply not on the menu.
// Showrunner runs scheduling and performance, not payroll: everything a
// Super Admin sees except what a coach is paid and where it is paid to.
const HIDES_PAY = (role) => role === 'Showrunner';

// Who may record a score card. Everyone who works a pay cycle enters
// performance data; locking it, and everything to do with a coach's profile
// or pay, stays with Super Admin and HR Manager.
const SCORE_EDIT_ROLES = [
  'Super Admin', 'HR Manager', 'Reporting Manager', 'Finance', 'Showrunner'
];

// Attendance and leave. Every role sees it; a Showrunner sees days worked and
// days off but never what a day of Loss of Pay costs, which is pay.
const ATTENDANCE_ROLES = [
  'Super Admin', 'HR Manager', 'Finance', 'Reporting Manager', 'Showrunner', 'Coach'
];
// Deciding a leave application. A Reporting Manager approves for their own
// coaches; Super Admin and HR stand in when they are away.
const LEAVE_APPROVER_ROLES = ['Super Admin', 'HR Manager', 'Reporting Manager'];

// Settling a period: who may lock a score card, and unlock one again.
const LOCK_ROLES = ['Super Admin', 'HR Manager', 'Finance', 'Reporting Manager'];

// A coach's own record and what they are paid — profile, bank details,
// payslips, and overriding a rate. Narrower than locking on purpose.
const PROFILE_PAY_ROLES = ['Super Admin', 'HR Manager', 'Finance'];

const OFFERED_VARIANT_IDS = ['V1', 'V3', 'V5', 'V6'];

/**
 * The offered policies, plus whichever one is currently selected. Keeping the
 * current value means a coach on a retired policy still shows it rather than
 * silently reading as something they are not.
 */
const offeredVariants = (list, currentId) => {
  const all = Array.isArray(list) ? list : [];
  const offered = all.filter(v => OFFERED_VARIANT_IDS.includes(v.id));
  const current = all.find(v => v.id === currentId);
  return current && !offered.some(v => v.id === current.id)
    ? [...offered, current]
    : offered;
};

const variantProperty = (v) => /HOP/i.test(v?.property || '') ? 'HOP' : 'HB+';
const variantLabel = (v) => `${v?.name ?? ''} ${variantProperty(v)}`.trim();

const COACH_CATEGORIES = ["Fixed", "Flexi-Fixed", "Flexi"];

// Column groups of the Monthly Score Records sheet, in sheet order. `weightKeys`
// names the variant weights that roll up into that group, so the banner can show
// the group weight (and say "varies" when the filtered variants disagree).
// Column groups of the score tracker, in sheet order. Experience and Technical
// Knowledge expand into the raw inputs behind their weighted score, the way the
// remuneration sheet lays them out; `weightOf` names the variant weight a column
// carries, so the header can print it (or "varies" across mixed variants).
const SCORE_TRACKER_GROUPS = [
  {
    key: "info", label: "Coach Info", tone: "slate",
    columns: [
      { key: "month", label: "Month", sortable: true },
      { key: "coach_id", label: "Coach ID", sticky: true, sortable: true },
      { key: "coach_name", label: "Coach Name", sticky: true, sortable: true },
      { key: "category", label: "Category", sortable: true },
      { key: "range", label: "Period" },
      { key: "status", label: "Record Status" }
    ]
  },
  {
    key: "experience", label: "Experience", tone: "blue",
    weightKeys: ["coaching_exp", "non_coaching_exp"],
    columns: [
      { key: "exp_doc", label: "Freelancing / Past Experience With Document", decimals: 1 },
      { key: "exp_nodoc", label: "Freelancing / Past Experience Without Documents", decimals: 1 },
      { key: "exp_post_doj", label: "Post DOJ Experience (Years)", decimals: 1 },
      { key: "exp_coach_score", label: "Coach Exp Score", weightOf: "coaching_exp", decimals: 2 },
      { key: "exp_non_coach_years", label: "Non-Coach Exp (Years 0-10)", decimals: 1 },
      { key: "exp_non_coach_score", label: "Non-Coach Score", weightOf: "non_coaching_exp", decimals: 2 },
      { key: "experience", label: "Total", decimals: 2, emphasis: true, sortable: true }
    ]
  },
  {
    key: "technical", label: "Technical Knowledge", tone: "amber",
    weightKeys: ["education", "technical_cert"],
    columns: [
      { key: "edu_raw", label: "Non-Tech Educational Score", decimals: 2 },
      { key: "edu_score", label: "Non-Tech Score", weightOf: "education", decimals: 2 },
      { key: "cert_raw", label: "Technical Certification Score", decimals: 2 },
      { key: "cert_score", label: "Tech Cert Score", weightOf: "technical_cert", decimals: 2 },
      { key: "technical", label: "Total", decimals: 2, emphasis: true, sortable: true }
    ]
  },
  {
    key: "performance", label: "Performance & Reliability", tone: "violet",
    columns: [
      { key: "prof_appearance", label: "Professional Appearance", decimals: 0 },
      { key: "client_engagement", label: "Client Rating", decimals: 0 },
      { key: "safety", label: "Safety & Cleanliness", decimals: 0 },
      { key: "punctuality", label: "Punctuality & Documentation", decimals: 0 },
      { key: "team_conduct", label: "Team Conduct", decimals: 0 },
      { key: "communication", label: "Communication & Responsiveness", decimals: 0 },
      { key: "core_total", label: "Core Total", decimals: 0 },
      { key: "core", label: "Core Performance", weightOf: "core_performance", decimals: 2 },
      { key: "tenure_years", label: "HB+ Tenure (Yrs)", decimals: 1 },
      { key: "org", label: "Org Reliability", weightOf: "tenure", decimals: 2 },
      { key: "meetings_scheduled", label: "Meetings Scheduled", decimals: 0 },
      { key: "meetings_attended", label: "Meetings Attended", decimals: 0 },
      { key: "attendance_pct", label: "Attendance %", decimals: 1 },
      { key: "attendance", label: "Elevate+ Attendance", weightOf: "attendance", decimals: 2 }
    ]
  },
  {
    key: "total", label: "Total & Band", tone: "teal",
    columns: [
      { key: "hb_score", label: "HB+ Score", decimals: 2, emphasis: true, sortable: true },
      { key: "band", label: "Performance Band" }
    ]
  },
  {
    key: "incentive", label: "Incentive", tone: "green",
    columns: [
      { key: "sessions", label: "Sessions Completed", decimals: 0, sortable: true },
      { key: "night_sessions", label: "Night Sessions", decimals: 0 },
      { key: "streak", label: "5-Star Streak", decimals: 0 },
      { key: "missed_sessions", label: "Missed Sessions", decimals: 0 },
      { key: "missed_penalty", label: "Missed Session Penalty", money: true },
      { key: "threshold", label: "Threshold", decimals: 0 },
      { key: "extra_sessions", label: "Extra Sessions", decimals: 0, emphasis: true },
      { key: "violations", label: "Violations in Period", decimals: 0 }
    ]
  },
  {
    key: "violations", label: "Violations", tone: "red",
    columns: [
      { key: "late_count", label: "Late Arrival Count", decimals: 0 },
      { key: "noshow_count", label: "No-Show Count", decimals: 0 }
    ]
  },
  {
    key: "bonuses", label: "Bonuses", tone: "indigo",
    columns: [
      { key: "milestone", label: "Milestone Incentive", money: true },
      { key: "consistency", label: "Consistency Bonus", money: true }
    ]
  }
];

// A record carries its cell overrides in `overrides`, keyed by column.
// Underscore-prefixed keys are reserved for record state rather than a cell, so
// everything that counts or lists cell overrides skips them.
const overrideKeys = (overrides) => Object.keys(overrides || {}).filter(k => !k.startsWith('__'));

const SCORE_TRACKER_COLUMNS = SCORE_TRACKER_GROUPS.flatMap(g => g.columns);

// A few columns carry the same field under a different key.
const TRACKER_META_ALIASES = {
  attendance: 'attendance_score',
  edu_raw: 'edu_raw',
  cert_raw: 'cert_raw'
};

const trackerColumnMeta = (col) => {
  const key = TRACKER_META_ALIASES[col.key] || col.key;
  return COACH_SCORECARD_COLUMNS.find(c => c.key === key) || null;
};

// Score Management on the coach profile: one row per evaluated period, laid out
// like the Calculator sheet. `entry` mirrors that sheet's row 20/21 annotations —
// "manual" is keyed per period, "profile" is the coach's one-time entry, and
// "derived" is calculated. Only manual and profile cells become inputs on edit.
const COACH_SCORECARD_GROUPS = [
  {
    key: "period", label: "Period", tone: "slate",
    columns: [
      { key: "month", label: "Performance Month", sticky: true },
      { key: "range", label: "Period" },
      { key: "status", label: "Status" }
    ]
  },
  {
    key: "experience", label: "Experience", tone: "blue", weightKeys: ["coaching_exp", "non_coaching_exp"],
    columns: [
      { key: "exp_doc", label: "Freelancing / Past Experience With Document", entry: "profile", source: "One-time", decimals: 1, step: 0.5 },
      { key: "exp_nodoc", label: "Freelancing / Past Experience Without Documents", entry: "profile", source: "One-time", decimals: 1, step: 0.5 },
      { key: "exp_post_doj", label: "Post DOJ Experience (Years)", entry: "derived", decimals: 1 },
      { key: "exp_coach_score", label: "Coach Exp Score", entry: "derived", weightKeys: ["coaching_exp"], decimals: 2 },
      { key: "exp_non_coach_years", label: "Non-Coach Exp (Yrs 0-10)", entry: "profile", source: "One-time", decimals: 1, step: 0.5, max: 10 },
      { key: "exp_non_coach_score", label: "Non-Coach Score", entry: "derived", weightKeys: ["non_coaching_exp"], decimals: 2 },
      { key: "experience", label: "Total", entry: "derived", decimals: 2, emphasis: true }
    ]
  },
  {
    key: "technical", label: "Technical Knowledge", tone: "amber", weightKeys: ["education", "technical_cert"],
    columns: [
      { key: "edu_raw", label: "Non-Tech Educational Score", entry: "profile", source: "One-time", decimals: 2, step: 0.5, max: 10 },
      { key: "edu_score", label: "Non-Tech Score", entry: "derived", weightKeys: ["education"], decimals: 2 },
      { key: "cert_raw", label: "Technical Cert Score", entry: "derived", note: "From certs", decimals: 2 },
      { key: "cert_score", label: "Tech Cert Score", entry: "derived", weightKeys: ["technical_cert"], decimals: 2 },
      { key: "technical", label: "Total", entry: "derived", decimals: 2, emphasis: true }
    ]
  },
  {
    key: "core", label: "Core Performance", tone: "violet", weightKeys: ["core_performance"],
    columns: [
      { key: "prof_appearance", label: "Professional Appearance", entry: "manual", source: "By RM", max: 20, decimals: 0 },
      { key: "client_engagement", label: "Client Rating", entry: "manual", source: "From App", max: 20, decimals: 0 },
      { key: "safety", label: "Safety & Cleanliness", entry: "manual", source: "By RM", max: 15, decimals: 0 },
      { key: "punctuality", label: "Punctuality & Documentation", entry: "manual", source: "By RM", max: 10, decimals: 0 },
      { key: "team_conduct", label: "Team Conduct", entry: "manual", source: "By RM", max: 15, decimals: 0 },
      { key: "communication", label: "Communication & Responsiveness", entry: "manual", source: "By RM", max: 20, decimals: 0 },
      { key: "core_total", label: "Core Total", entry: "derived", scale: "/ 100", decimals: 0 },
      { key: "core", label: "Core Perf Score", entry: "derived", weightKeys: ["core_performance"], decimals: 2, emphasis: true }
    ]
  },
  {
    key: "org", label: "Org Reliability", tone: "indigo", weightKeys: ["tenure"],
    columns: [
      { key: "tenure_years", label: "HB+ Tenure (Yrs 0-5)", entry: "derived", note: "From date of joining", decimals: 1 },
      { key: "org", label: "Tenure Score", entry: "derived", weightKeys: ["tenure"], decimals: 2, emphasis: true }
    ]
  },
  {
    key: "attendance", label: "Elevate+ Attendance", tone: "red", weightKeys: ["attendance"],
    columns: [
      { key: "meetings_scheduled", label: "Meeting Scheduled", entry: "manual", source: "By SRS", max: 999, decimals: 0 },
      { key: "meetings_attended", label: "Attended", entry: "manual", source: "By SRS", max: 999, decimals: 0 },
      { key: "attendance_pct", label: "Attendance", entry: "derived", scale: "%", decimals: 1 },
      { key: "attendance_score", label: "Attendance Score", entry: "derived", weightKeys: ["attendance"], decimals: 2, emphasis: true }
    ]
  },
  {
    key: "final", label: "Final Score", tone: "teal",
    columns: [
      { key: "experience", label: "Experience", entry: "derived", weightKeys: ["coaching_exp", "non_coaching_exp"], decimals: 2 },
      { key: "technical", label: "Technical Knowledge", entry: "derived", weightKeys: ["education", "technical_cert"], decimals: 2 },
      { key: "core", label: "Core Performance", entry: "derived", weightKeys: ["core_performance"], decimals: 2 },
      { key: "org", label: "Org Reliability", entry: "derived", weightKeys: ["tenure"], decimals: 2 },
      { key: "attendance_score", label: "Elevate+ Attendance", entry: "derived", weightKeys: ["attendance"], decimals: 2 },
      { key: "hb_score", label: "HB+ Score", entry: "derived", scale: "Total / 100", decimals: 2, emphasis: true },
      { key: "band", label: "Performance Band", entry: "derived" }
    ]
  },
  {
    key: "incentive", label: "Incentive", tone: "green",
    columns: [
      { key: "sessions", label: "Sessions Completed", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "night_sessions", label: "Night Sessions", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "streak", label: "5-Star Streak", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "missed_sessions", label: "Missed Sessions", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "threshold", label: "Threshold", entry: "derived", decimals: 0 },
      { key: "extra_sessions", label: "Extra Sessions", entry: "derived", decimals: 0 },
      { key: "violations", label: "Violations in Period", entry: "derived", decimals: 0 }
    ]
  }
];

// Some columns appear in both their own group and the Final Score summary, so
// this flat list is deduped by key — override lists must not double-count them.
const COACH_SCORECARD_COLUMNS = [...new Map(
  COACH_SCORECARD_GROUPS.flatMap(g => g.columns).map(c => [c.key, c])
).values()];

// Dynamic cells that may be overridden by hand. Overriding one re-drives the
// cells below it in the same chain, so a row always stays internally consistent.
// The most a hand-entered value can legitimately be. A weighted score can never
// exceed its own weight, so a typo like 200 in a 28%-weighted cell is caught.
const overrideCeiling = (col, weights) => {
  if (col.weightKeys) return col.weightKeys.reduce((sum, k) => sum + (weights[k] || 0), 0);
  switch (col.key) {
    case "core_total":
    case "attendance_pct":
    case "hb_score": return 100;
    case "tenure_years": return 5;
    case "exp_post_doj": return 60;
    case "cert_raw": return 10;
    case "threshold": return 400;
    case "extra_sessions": return 999;
    case "violations": return 99;
    default: return null;
  }
};

const OVERRIDABLE_KEYS = [
  "exp_post_doj", "exp_coach_score", "exp_non_coach_score", "experience",
  "edu_score", "cert_raw", "cert_score", "technical",
  "core_total", "core", "tenure_years", "org",
  "attendance_pct", "attendance_score", "hb_score",
  // Incentive inputs. They drive pay, not the HB+ score.
  "threshold", "extra_sessions", "violations"
];

// The subset of the above that actually feeds the HB+ score. Overriding an
// incentive cell must not make a locked month's stored score recompute.
const SCORE_DRIVING_OVERRIDES = OVERRIDABLE_KEYS.filter(
  k => !["threshold", "extra_sessions", "violations"].includes(k)
);

// Fields an RM / the app keys in each period. A rolled-over period starts with
// these null so the row reads empty until someone actually records the month.
// The six cells that make up Core Performance, worth 28% of the score. All
// zero means nobody has rated the month — either it was never filled in, or a
// blank save wrote zeros over it — and the score is then held down by the
// largest single weighting with nothing on screen to say why.
const CORE_PERFORMANCE_FIELDS = ['prof_appearance', 'client_engagement', 'safety',
  'punctuality', 'team_conduct', 'communication'];
const hasCorePerformance = (record) => CORE_PERFORMANCE_FIELDS
  .some(f => Number(record?.[f]) > 0);

// True once anything has actually been recorded against the month.
const isRecorded = (record) => MANUAL_PERIOD_FIELDS
  .some(f => record?.[f] !== null && record?.[f] !== undefined);

/**
 * Collapse period records that share a coach and month.
 *
 * Two rows for one coach and month must never both survive: on the way to the
 * database the later one wins, so a blank sitting behind a recorded row would
 * silently overwrite it. Where they collide the recorded one is kept.
 */
const dedupePeriodRecords = (records) => {
  const byKey = new Map();
  for (const r of records || []) {
    const key = `${r.coach_id}|${r.period_month}`;
    const held = byKey.get(key);
    if (!held || (!isRecorded(held) && isRecorded(r))) byKey.set(key, r);
  }
  return [...byKey.values()];
};

const MANUAL_PERIOD_FIELDS = [
  "prof_appearance", "client_engagement", "safety", "punctuality",
  "team_conduct", "communication", "meetings_scheduled", "meetings_attended",
  "sessions_completed", "night_sessions", "five_star_streak", "missed_sessions"
];

const blankPeriodRecord = (coachId, period) => ({
  coach_id: coachId,
  ...period,
  ...Object.fromEntries(MANUAL_PERIOD_FIELDS.map(f => [f, null])),
  attendance_pct: null,
  status: "DRAFT",
  overrides: {}
});

// Bands in the order the Pay Reference Tables list them, with the two columns
// the sheet carries that the rates tables do not.
const PAY_BANDS = [
  { label: "0–30 Non-Functional", short: "0 – 30", variation: "15%", meaning: "Non-Functional", note: "No per-session pay. Only Fixed Pay" },
  { label: "30–40 Weak", short: "30 – 40", variation: "10%", meaning: "Weak Delivery", note: "" },
  { label: "40–50 Basic", short: "40 – 50", variation: "7.50%", meaning: "Basic Acceptable", note: "" },
  { label: "50–60 Stable", short: "50 – 60", variation: "4%", meaning: "Stable Performer", note: "" },
  { label: "60–70 Good", short: "60 – 70", variation: "3%", meaning: "Good Performer", note: "" },
  { label: "70–80 High-Quality", short: "70 – 80", variation: "2%", meaning: "High-Quality", note: "" },
  { label: "80–90 Exceptional", short: "80 – 90", variation: "1%", meaning: "Exceptional", note: "" }
];

const ORG_WORK_REFERENCE = [
  { type: "Workout Planning / Programming", effort: "Medium", knowledge: "Medium", min: 3000, max: 4000, note: "" },
  { type: "Hiring Support", effort: "Low", knowledge: "Medium", min: 1500, max: 2500, note: "" },
  { type: "Blog Writing / Content", effort: "Low", knowledge: "Medium", min: 0, max: 0, note: "Currently Unpaid" },
  { type: "Course Development", effort: "Medium", knowledge: "High", min: 3500, max: 5500, note: "" },
  { type: "Coach Training / Mentoring", effort: "High", knowledge: "High", min: 3500, max: 5500, note: "" }
];

const rupees = (n) => `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;

/**
 * A period's settled score for a coach: the stored value (which the score card
 * editor keeps in step, overrides included) falling back to a fresh calculation.
 */
const resolvePeriodScore = (coach, record, vConfig) => {
  const score = record.hb_score !== undefined && record.hb_score !== null
    ? record.hb_score
    : computeHBPlusScore(coach, record, vConfig).hbScore;
  return { score, band: record.band || getPerformanceBand(score).label };
};

/**
 * Monthly Pay Calculator — the sheet's "fill yellow cells only" form. Inputs are
 * editable; the breakdown below is driven by computeMonthlyPay so it can never
 * drift from the payroll the rest of the app produces.
 */
function PayCalculator({ variants, seed, onSeedChange, coachOptions, selectedCoachId, onCoachChange, lockCoach, periodOptions, onPeriodChange, canOverridePay = false, onSavePayOverrides }) {
  const [coachName, setCoachName] = useState(seed?.coachName ?? "");
  const [variantId, setVariantId] = useState(seed?.variantId ?? "V1");
  const [category, setCategory] = useState(seed?.category ?? "Fixed");
  const [score, setScore] = useState(seed?.score ?? 0);
  const [sessions, setSessions] = useState(seed?.sessions ?? 0);
  const [nightSessions, setNightSessions] = useState(seed?.nightSessions ?? 0);
  const [streak, setStreak] = useState(seed?.streak ?? 0);
  const [consistency, setConsistency] = useState(seed?.consistency ?? "NO");
  const [orgWorkPay, setOrgWorkPay] = useState(seed?.orgWorkPay ?? 0);
  const [penalties, setPenalties] = useState(seed?.penalties ?? 0);
  const [missedSessions, setMissedSessions] = useState(seed?.missedSessions ?? 0);
  const [baseOverride, setBaseOverride] = useState(seed?.baseOverride ?? "");
  // Blank means "use the band's rate"; a number overrides it for this model.
  const [rateOverride, setRateOverride] = useState(seed?.rateOverride ?? "");
  // Both pay fields start locked. Taking one over is a deliberate act, as it is
  // for a calculated cell on the score card.
  const [unlockedPay, setUnlockedPay] = useState({ rate: false, base: false });
  // The incidents behind the penalty figure. Derived from the seed rather than
  // held in state, so they follow the coach and period without a second sync.
  const [penaltyOpen, setPenaltyOpen] = useState(false);

  // Re-seed when the caller points the calculator somewhere new — a different
  // coach or period — AND when the record it is already showing changes. Keying
  // this on the coach/period alone left the calculator holding stale figures
  // after a score card was edited underneath it, since the key never moved.
  const seedSignature = seed
    ? [
        seed.key, seed.coachName, seed.variantId, seed.category, seed.score,
        seed.sessions, seed.nightSessions, seed.streak, seed.consistency,
        seed.orgWorkPay, seed.penalties, seed.missedSessions, seed.baseOverride, seed.rateOverride
      ].join('|')
    : '';
  useEffect(() => {
    if (!seed) return;
    setCoachName(seed.coachName ?? "");
    setVariantId(seed.variantId ?? "V1");
    setCategory(seed.category ?? "Fixed");
    setScore(seed.score ?? 0);
    setSessions(seed.sessions ?? 0);
    setNightSessions(seed.nightSessions ?? 0);
    setStreak(seed.streak ?? 0);
    setConsistency(seed.consistency ?? "NO");
    setOrgWorkPay(seed.orgWorkPay ?? 0);
    setPenalties(seed.penalties ?? 0);
    setMissedSessions(seed.missedSessions ?? 0);
    setBaseOverride(seed.baseOverride ?? "");
    setRateOverride(seed.rateOverride ?? "");
    // A different coach or period is a different pay decision, so both lock again.
    setUnlockedPay({ rate: false, base: false });
  }, [seedSignature]);

  const vConfig = variants.find(v => v.id === variantId) || variants[0];
  if (!vConfig) return null;

  const numericScore = Math.min(90, Math.max(0, Number(score) || 0));
  const band = getPerformanceBand(numericScore);
  const rates = vConfig.rates[category]?.[band.label] || {};

  // A synthetic coach + month record: consistency is a yes/no input here rather
  // than something derived, so attendance is forced to match the choice and the
  // penalty total is applied at the end instead of through a violations list.
  // The override travels on the coach, so every category honours it the same
  // way — including Fixed, whose rate is otherwise derived from its own pay.
  const bandLabels = PAY_BANDS.map(b => b.label);
  const nextBandLabel = (() => {
    const i = bandLabels.indexOf(band.label);
    return i >= 0 && i < bandLabels.length - 1 ? bandLabels[i + 1] : null;
  })();
  const forecastFor = (label) => {
    const r = label ? vConfig.rates[category]?.[label] : null;
    if (!r) return null;
    const base = category === 'Fixed' ? r.std_fixed : r.min_fixed;
    // A Fixed coach's session rate comes from their own monthly pay, not the
    // band's column, so the forecast has to be derived the same way.
    const rate = category === 'Fixed' ? fixedPerSessionRate(base) : r.per_session;
    // The band is a range, not a point. For a Fixed coach the session rate
    // follows the salary, so its range is derived from the salary's ends;
    // Flexi and Flexi-Fixed are paid the band's own column, which is a point.
    const lo = r.min_fixed ?? 0;
    const hi = r.max_fixed ?? lo;
    return {
      label,
      base: base ?? 0,
      rate: rate ?? 0,
      salaryLo: lo,
      salaryHi: hi,
      rateLo: category === 'Fixed' ? fixedPerSessionRate(lo) : (r.per_session ?? 0),
      rateHi: category === 'Fixed' ? fixedPerSessionRate(hi) : (r.per_session ?? 0)
    };
  };
  const forecastNow = forecastFor(band.label);
  const against = (actual, lo, hi) => {
    const v = Number(actual) || 0;
    if (!lo && !hi) return null;
    if (v < lo) return { state: 'under', label: `${rupees(lo - v)} below` };
    if (v > hi) return { state: 'over', label: `${rupees(v - hi)} above` };
    return { state: 'within', label: 'within range' };
  };
  const forecastNext = forecastFor(nextBandLabel);

  const rateOverrideNum = rateOverride !== "" && Number.isFinite(Number(rateOverride))
    ? Math.max(0, Number(rateOverride))
    : null;

  const syntheticCoach = {
    id: "CALC",
    coach_category: category,
    variant_id: vConfig.id,
    ...(baseOverride !== "" && category === "Fixed" ? { fixed_salary_override: Number(baseOverride) } : {}),
    ...(baseOverride !== "" && category === "Flexi-Fixed" ? { flexi_fixed_base_salary: Number(baseOverride) } : {}),
    ...(rateOverrideNum !== null ? { per_session_override: rateOverrideNum } : {})
  };
  const syntheticMonth = {
    missed_sessions: Number(missedSessions) || 0,
    sessions_completed: Number(sessions) || 0,
    night_sessions: Number(nightSessions) || 0,
    five_star_streak: Number(streak) || 0,
    attendance_pct: consistency === "YES" ? 100 : 0
  };
  const orgItems = isOrgWorkEligible(category) && Number(orgWorkPay) > 0
    ? [{ amount: Number(orgWorkPay) }]
    : [];

  const pay = computeMonthlyPay(syntheticCoach, syntheticMonth, { hbScore: numericScore }, [], vConfig, orgItems);
  const penaltyTotal = Number(penalties) || 0;
  const grossPay = Math.round((pay.grossPay - penaltyTotal) * 100) / 100;
  // Section 194J: TDS on professional or technical fees, withheld at source.
  // Withheld in whole rupees, as on the payslip.
  const incomeTax = Math.round(grossPay * TDS_194J_RATE);
  const netPay = Math.round((grossPay - incomeTax) * 100) / 100;

  const requestPayEdit = (key, label, standard) => {
    if (unlockedPay[key]) return;
    const proceed = window.confirm(
      `"${label}" comes from the band rate (${standard}).\n\n` +
      `Overriding it changes what this coach is paid for the month. Do you want to edit it?`
    );
    if (!proceed) return;
    setUnlockedPay(prev => ({ ...prev, [key]: true }));
  };

  // Where a pay figure came from. Three figures look identical on screen — one
  // set for this month, one carried from an earlier month, and the band's own
  // — and which it is decides whether editing here changes anything.
  const paySourceHint = (from, unlocked) => {
    if (unlocked) return "leave blank to fall back to the band rate";
    if (!from || from === 'band') {
      return canOverridePay ? "band rate — click to set" : "band rate, nothing set";
    }
    if (from === 'month') {
      return canOverridePay ? "set for this month — click to change" : "set for this month";
    }
    if (from === 'profile') {
      return canOverridePay ? "set on the coach profile — click to change" : "set on the coach profile";
    }
    return canOverridePay ? `carried from ${from} — click to change` : `carried from ${from}`;
  };

  const payLock = (key, label, standard, current) => (
    <button
      type="button"
      className="dynamic-lock-btn"
      title={`From the band rate — click to override (${standard})`}
      onClick={() => requestPayEdit(key, label, standard)}
    >
      <span>{current}</span>
      <i className="bx bx-lock-alt"></i>
    </button>
  );

  const inputRow = (label, control, hint) => (
    <tr key={label}>
      <td className="calc-label">{label}{hint && <span className="calc-hint">{hint}</span>}</td>
      <td className="calc-input-cell">{control}</td>
    </tr>
  );

  const outputRow = (label, value, hint, strong) => (
    <tr key={label} className={strong ? 'calc-total-row' : ''}>
      <td className="calc-label">{label}{hint && <span className="calc-hint">{hint}</span>}</td>
      <td className="calc-output-cell">{value}</td>
    </tr>
  );

  const num = (value, setter, max) => (
    <input
      type="number" min="0" max={max} step="any"
      className="calc-input"
      value={value}
      onChange={(e) => { setter(e.target.value); onSeedChange?.(); }}
    />
  );

  // A deduction with no explanation is the one line on a payslip people
  // dispute, so the Penalty row opens into the incidents it is made of: the
  // date, what happened, which occurrence it was, and what each one cost.
  const penaltyItems = seed?.penaltyItems ?? [];
  const penaltyOtherCount = seed?.penaltyOtherCount ?? 0;
  const recordedPenalty = penaltyItems
    .filter(isPenaltyChargeable)
    .reduce((sum, v) => sum + (Number(v.penalty_amount) || 0), 0);
  // Penalty is an editable input, so the figure on screen can be moved away
  // from what the incidents add up to. Saying so beats quietly disagreeing.
  const penaltyEdited = penaltyItems.length > 0
    && Math.round(penaltyTotal) !== Math.round(recordedPenalty);

  const penaltyRow = () => {
    const rows = [
      <tr key="penalty">
        <td className="calc-label">
          {penaltyItems.length > 0 ? (
            <button
              type="button"
              className="calc-penalty-toggle"
              aria-expanded={penaltyOpen}
              onClick={() => setPenaltyOpen(open => !open)}
            >
              <i className={`bx ${penaltyOpen ? 'bx-chevron-down' : 'bx-chevron-right'}`}></i>
              Penalty (₹)
              <span className="calc-hint">
                {penaltyItems.length} incident{penaltyItems.length === 1 ? '' : 's'} — click to see {penaltyItems.length === 1 ? 'it' : 'them'}
              </span>
            </button>
          ) : (
            <>
              Penalty (₹)
              <span className="calc-hint">
                {seed?.periodRange
                  ? `no incidents dated ${seed.periodRange}`
                  : 'not seeded from a coach — key a figure in on the left'}
                {penaltyOtherCount > 0 && ` · this coach has ${penaltyOtherCount} incident${penaltyOtherCount === 1 ? '' : 's'} outside these dates`}
              </span>
            </>
          )}
        </td>
        <td className="calc-output-cell">− {rupees(penaltyTotal)}</td>
      </tr>
    ];

    if (!penaltyOpen || penaltyItems.length === 0) return rows;

    rows.push(
      <tr key="penalty-head" className="calc-penalty-detail calc-penalty-detail-head">
        <td colSpan={2}>
          <div className="calc-penalty-line">
            <span>Incident</span><span>Occurrence</span><span>Status</span><span>Amount</span>
          </div>
        </td>
      </tr>
    );

    penaltyItems.forEach((v, i) => {
      const waived = !isPenaltyChargeable(v);
      rows.push(
        <tr key={`penalty-${v.id ?? i}`} className="calc-penalty-detail">
          <td colSpan={2}>
            <div className="calc-penalty-line">
              <span>
                <strong>{v.type}</strong>
                <small>
                  {v.incident_date
                    ? new Date(v.incident_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'}
                  {v.incident_time ? ` · ${v.incident_time}` : ''}
                </small>
                {v.consequence && <small>{v.consequence}</small>}
              </span>
              <span>#{v.occurrence_no ?? 1}</span>
              <span>{String(v.status || '').replace(/_/g, ' ')}</span>
              <span className={waived ? 'calc-penalty-waived' : ''}>
                {waived ? 'Waived' : `− ${rupees(v.penalty_amount)}`}
              </span>
            </div>
          </td>
        </tr>
      );
    });

    rows.push(
      <tr key="penalty-foot" className="calc-penalty-detail calc-penalty-detail-foot">
        <td colSpan={2}>
          <div className="calc-penalty-line">
            <span>Recorded incidents total</span><span></span><span></span>
            <span>− {rupees(recordedPenalty)}</span>
          </div>
          {penaltyEdited && (
            <p className="calc-penalty-note">
              <i className="bx bx-error"></i>
              The Penalty input has been changed to {rupees(penaltyTotal)}, so this
              breakdown no longer matches what is being deducted. Clear the input to
              go back to the recorded incidents.
            </p>
          )}
        </td>
      </tr>
    );

    return rows;
  };

  return (
    <div className="pay-calc-grid">
      <div className="pay-calc-col">
        <div className="calc-section-title calc-section-input">Input Parameters <span>Fill these cells only</span></div>
        {seed?.coachId && seed.coreRecorded === false && (
          <div className="calc-unrated-note">
            <i className="bx bx-error"></i>
            <span>
              <strong>{seed.periodMonth} has no Core Performance ratings.</strong>
              <small>
                Those six cells carry 28% of the score, so it sits at {seed.score ?? 0} and
                the band pays accordingly. They are not entered here — this screen only reads
                the score card. Open {seed.periodMonth} on the Coach Master score card,
                Core Performance tab, and record them there.
              </small>
            </span>
          </div>
        )}
        <table className="data-table calc-table">
          <tbody>
            {/* Which period the figures below belong to. Read-only: it follows
                the period picker above rather than being keyed in here, so the
                inputs and the score card can never drift apart silently. */}
            {seed?.periodMonth && inputRow(
              "Performance Period",
              periodOptions?.length && onPeriodChange ? (
                // Changing it re-seeds every figure below from that month's
                // score card, so the pay recalculates for the month chosen.
                <select
                  className="calc-input"
                  value={seed.periodMonth}
                  onChange={(e) => onPeriodChange(e.target.value)}
                >
                  {periodOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <span className="calc-static">{seed.periodMonth}</span>
              ),
              seed.periodRange
            )}
            {inputRow("Coach Name", coachOptions ? (
              <select
                className="calc-input calc-input-text"
                value={selectedCoachId ?? ""}
                disabled={lockCoach}
                onChange={(e) => onCoachChange?.(e.target.value)}
              >
                {!lockCoach && <option value="">— Manual entry —</option>}
                {coachOptions.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                ))}
              </select>
            ) : (
              <input type="text" className="calc-input calc-input-text" value={coachName} placeholder="Enter coach name" onChange={(e) => setCoachName(e.target.value)} />
            ), coachOptions && !lockCoach ? "picking a coach loads their recorded figures" : undefined)}
            {inputRow("Policy Variant", (
              <select className="calc-input" value={variantId} onChange={(e) => setVariantId(e.target.value)}>
                {offeredVariants(variants, variantId).map(v => (
                  <option key={v.id} value={v.id}>{variantLabel(v)}</option>
                ))}
              </select>
            ))}
            {inputRow("Coach Category", (
              <select className="calc-input" value={category} onChange={(e) => setCategory(e.target.value)}>
                {COACH_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            ), "Fixed / Flexi / Flexi-Fixed")}
            {inputRow("HB+ Benchmark Score", num(score, setScore, 90), "0 – 90")}
            {inputRow("Sessions Completed This Month", num(sessions, setSessions))}
            {inputRow("Night Sessions Count", num(nightSessions, setNightSessions), "10 PM – 4 AM")}
            {inputRow("5-Star Streak Count", num(streak, setStreak), "consecutive")}
            {inputRow("Consistency Bonus Eligible?", (
              <select className="calc-input" value={consistency} onChange={(e) => setConsistency(e.target.value)}>
                <option value="NO">NO</option>
                <option value="YES">YES</option>
              </select>
            ), "zero violations and zero no-shows")}
            {inputRow("Org Work Pay This Month (₹)", num(orgWorkPay, setOrgWorkPay), "Flexi & Flexi-Fixed only")}
            {inputRow("Missed Sessions", num(missedSessions, setMissedSessions),
              "charged at 1x up to 5, 1.5x up to 10, 2x above")}
            {inputRow("Total Penalty (₹)", num(penalties, setPenalties), "recorded incidents; missed sessions are charged separately")}
            {/* Per-session rate applies to every category: Flexi and Flexi-Fixed
                pay it on all sessions, Fixed on the ones beyond its threshold. */}
            {/* Overriding what a coach is paid is a pay decision, not a
                modelling one, so it is left to the roles that own the rate card.
                Everyone else sees the band rate, stated rather than editable. */}
            {inputRow("Per-Session Rate (₹)", (
              !canOverridePay
                ? <span className="calc-static">{rupees(pay.perSessionRate)}</span>
                : unlockedPay.rate
                  ? (
                    <input
                      type="number" min="0" step="any" className="calc-input" value={rateOverride}
                      placeholder={`Std ${rupees(pay.perSessionRate)}`}
                      autoFocus
                      onChange={(e) => setRateOverride(e.target.value)}
                    />
                  )
                  : payLock('rate', 'Per-Session Rate', rupees(pay.perSessionRate),
                      rateOverride !== "" ? rupees(rateOverride) : rupees(pay.perSessionRate))
            ), paySourceHint(seed?.payFrom?.rateFrom, unlockedPay.rate))}
            {/* A Flexi coach has no fixed component — they are paid per session
                alone — so the field is not offered for that category. */}
            {category !== "Flexi" && inputRow("Base / Fixed Pay (₹)", (
              !canOverridePay
                ? <span className="calc-static">{rupees(pay.basePay)}</span>
                : unlockedPay.base
                  ? (
                    <input
                      type="number" min="0" step="any" className="calc-input" value={baseOverride}
                      placeholder={`Std ${rupees(category === 'Fixed' ? rates.std_fixed : rates.min_fixed)}`}
                      autoFocus
                      onChange={(e) => setBaseOverride(e.target.value)}
                    />
                  )
                  : payLock('base', 'Base / Fixed Pay',
                      rupees(category === 'Fixed' ? rates.std_fixed : rates.min_fixed),
                      baseOverride !== "" ? rupees(baseOverride)
                        : rupees(category === 'Fixed' ? rates.std_fixed : rates.min_fixed))
            ), paySourceHint(seed?.payFrom?.fixedFrom, unlockedPay.base))}
          </tbody>
        </table>
        {canOverridePay && onSavePayOverrides && seed?.coachId && (() => {
          const savedBase = seed.baseOverride === "" || seed.baseOverride == null
            ? null : Number(seed.baseOverride);
          const savedRate = seed.rateOverride === "" || seed.rateOverride == null
            ? null : Number(seed.rateOverride);
          const nextBase = baseOverride === "" ? null : Number(baseOverride);
          const nextRate = rateOverride === "" ? null : Number(rateOverride);
          if (nextBase === savedBase && nextRate === savedRate) return null;

          const describe = (value, what) => value === null
            ? `${what} back to the band rate`
            : `${what} ${rupees(value)}`;
          const changes = [
            nextBase !== savedBase ? describe(nextBase, 'base pay') : null,
            nextRate !== savedRate ? describe(nextRate, 'per-session rate') : null
          ].filter(Boolean);

          return (
            <div className="calc-save-override">
              <i className="bx bx-lock-open-alt"></i>
              <span>
                <strong>Not saved yet</strong>
                <small>
                  This only models {seed.periodMonth} until it is saved —
                  setting {changes.join(' and ')} for {seed.coachName || 'this coach'}.
                  {seed.periodMonth} and the months after it carry these figures;
                  earlier months are untouched.
                </small>
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => onSavePayOverrides(seed.coachId, seed.periodMonth, { base: nextBase, rate: nextRate })}
              >
                Save {seed.periodMonth}
              </button>
            </div>
          );
        })()}
      </div>

      <div className="pay-calc-col">
        <div className="calc-section-title calc-section-output">Computed Pay Breakdown <span>{band.label}</span></div>
        <table className="data-table calc-table">
          <tbody>
            {outputRow("Base / Fixed Pay (₹)", rupees(pay.basePay),
              category === 'Flexi' ? "not paid to Flexi" : (baseOverride !== "" ? "entered above" : null))}
            {outputRow("Per-Session Rate (₹)", rupees(pay.perSessionRate),
              rateOverrideNum !== null ? "entered above" : null)}
            {outputRow("Sessions for the month", Number(sessions) || 0)}
            {outputRow("Session Threshold", rates.threshold ?? (category === 'Fixed' ? (vConfig.discipline === 'Yoga' ? 117 : 156) : 96))}
            {outputRow("Extra Sessions (beyond threshold)", pay.extraSessions)}
            {outputRow("Extra Session Pay (₹)", rupees(pay.extraSessionPay))}
            {/* Only Flexi and Flexi-Fixed are paid per session on every session;
                for Fixed the row is always ₹0, so it is not shown. */}
            {category !== "Fixed" && outputRow("Per-Session Pay (₹)", rupees(pay.sessionPay))}
            {outputRow("Night Session Premium (₹)", rupees(pay.nightSessionPay), "₹60/session, Flexi & Flexi-Fixed only")}
            {outputRow("Milestone Incentive (₹)", rupees(pay.milestoneIncentive))}
            {outputRow("Consistency Bonus (₹)", rupees(pay.consistencyBonus))}
            {outputRow("5-Star Streak Bonus (₹)", rupees(pay.streakBonusPay), `₹${vConfig.id === 'V3' ? 500 : 200} per ${vConfig.id === 'V3' ? 15 : 10} consecutive`)}
            {outputRow("Org Work Pay (₹)", rupees(pay.orgWorkPay), "Flexi & Flexi-Fixed only")}
            {Number(missedSessions) > 0 && outputRow(
              "Missed Session Penalty (₹)",
              `− ${rupees(pay.missedSessionDeduction)}`,
              `${pay.missedSessionMultiplier}× × ${pay.missedSessions} × ${rupees(pay.missedSessionRate)}` +
                (category === 'Fixed' ? ' — fixed pay ÷ 26 ÷ 5' : '')
            )}
            {penaltyRow()}
            {outputRow("Gross Monthly Pay (₹)", rupees(grossPay), null, true)}
            {outputRow("Income Tax u/s 194J (₹)", `− ${rupees(incomeTax)}`, "10% TDS on professional fees")}
            {outputRow("Net Monthly Pay (₹)", rupees(netPay), "what reaches the coach", true)}
          </tbody>
        </table>
        {forecastNow && (
          <div className="calc-forecast">
            <div className="calc-forecast-head">
              Benchmark &amp; Forecast <span>does not affect pay</span>
            </div>
            <table className="data-table calc-table">
              <tbody>
                {(() => {
                  const m = category === 'Flexi'
                    ? null : against(pay.basePay, forecastNow.salaryLo, forecastNow.salaryHi);
                  return (
                    <tr className={m ? `bench-row bench-${m.state}` : ''}>
                      <td className="calc-label">
                        Benchmark Salary (₹)
                        <span className="calc-hint">
                          the band's range — {band.label}
                          {m && <> · paid {rupees(pay.basePay)}, <strong>{m.label}</strong></>}
                        </span>
                      </td>
                      <td className="calc-output-cell">
                        {forecastNow.salaryHi > forecastNow.salaryLo
                          ? `${rupees(forecastNow.salaryLo)} – ${rupees(forecastNow.salaryHi)}`
                          : rupees(forecastNow.salaryLo)}
                      </td>
                    </tr>
                  );
                })()}
                {(() => {
                  const m = against(pay.perSessionRate, forecastNow.rateLo, forecastNow.rateHi);
                  return (
                    <tr className={m ? `bench-row bench-${m.state}` : ''}>
                      <td className="calc-label">
                        Benchmark Per Session (₹)
                        <span className="calc-hint">
                          {category === 'Fixed'
                            ? 'across that range, ÷ 26 ÷ 6, floored at ₹200'
                            : "the band's session rate"}
                          {m && <> · paid {rupees(pay.perSessionRate)}, <strong>{m.label}</strong></>}
                        </span>
                      </td>
                      <td className="calc-output-cell">
                        {forecastNow.rateHi > forecastNow.rateLo
                          ? `${rupees(forecastNow.rateLo)} – ${rupees(forecastNow.rateHi)}`
                          : rupees(forecastNow.rateLo)}
                      </td>
                    </tr>
                  );
                })()}
                <tr>
                  <td className="calc-label">
                    Forecast Fixed Pay (₹)
                    <span className="calc-hint">on this month's score — {band.label}</span>
                  </td>
                  <td className="calc-output-cell">{rupees(forecastNow.base)}</td>
                </tr>
                <tr>
                  <td className="calc-label">
                    Forecast Per-Session Rate (₹)
                    <span className="calc-hint">
                      {category === 'Fixed' ? 'forecast fixed pay ÷ 26 ÷ 6' : `band rate for ${band.label}`}
                    </span>
                  </td>
                  <td className="calc-output-cell">{rupees(forecastNow.rate)}</td>
                </tr>
                {forecastNext ? (
                  <>
                    <tr>
                      <td className="calc-label">
                        Next Band Fixed Pay (₹)
                        <span className="calc-hint">if the score reaches {forecastNext.label}</span>
                      </td>
                      <td className="calc-output-cell">{rupees(forecastNext.base)}</td>
                    </tr>
                    <tr>
                      <td className="calc-label">
                        Next Band Per-Session Rate (₹)
                        <span className="calc-hint">
                          + {rupees(forecastNext.base - forecastNow.base)} a month on the fixed component
                        </span>
                      </td>
                      <td className="calc-output-cell">{rupees(forecastNext.rate)}</td>
                    </tr>
                  </>
                ) : (
                  <tr>
                    <td className="calc-label" colSpan={2}>
                      <span className="calc-hint">Already in the top band — nothing above this one.</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="calc-notes">
          Night premium is ₹60/session for Flexi &amp; Flexi-Fixed only. Milestone slabs: Fixed 156 → ₹1,000, 182 → ₹2,000; Flexi / Flexi-Fixed 96 → ₹1,152, 135 → ₹2,025, 186 → ₹3,640.
          Consistency bonus is ₹500 with zero violations and zero no-shows. The 5-star streak resets on any violation or no-show.
        </p>
      </div>
    </div>
  );
}

/** Compensation reference tables A–E, rendered from the selected policy variant. */
function PayReferenceTables({ vConfig, penaltyMatrix }) {
  if (!vConfig) return null;
  const rateFor = (category, band) => vConfig.rates[category]?.[band.label] || {};
  const milestones = vConfig.milestones || {};
  const rules = penaltyMatrix[vConfig.id] || penaltyMatrix['default'] || {};

  const milestoneRow = (category) => {
    const list = milestones[category] || [];
    return (
      <tr key={category}>
        <td><strong>{category}</strong></td>
        {[0, 1, 2].flatMap(i => [
          <td key={`s${i}`} className="num-col">{list[i] ? list[i].threshold : '—'}</td>,
          <td key={`p${i}`} className="num-col">{list[i] ? rupees(list[i].amount) : '—'}</td>
        ])}
      </tr>
    );
  };

  return (
    <>
      <div className="card">
        <div className="card-header-row"><h3>A — Fixed Coaches</h3></div>
        <div className="table-container">
          <table className="data-table reference-table">
            <thead>
              <tr>
                <th>HB+ Benchmark</th><th className="num-col">Per-Session (₹)</th><th className="num-col">Band Variation %</th>
                <th className="num-col">Std Fixed Salary (₹)</th><th className="num-col">Min Salary (₹)</th><th className="num-col">Max Salary (₹)</th>
                <th>Performance Meaning</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {PAY_BANDS.map(b => {
                const r = rateFor("Fixed", b);
                return (
                  <tr key={b.label}>
                    <td><strong>{b.short}</strong></td>
                    <td className="num-col">{rupees(r.per_session)}</td>
                    <td className="num-col">{b.variation}</td>
                    <td className="num-col">{rupees(r.std_fixed)}</td>
                    <td className="num-col">{rupees(r.min_fixed)}</td>
                    <td className="num-col">{rupees(r.max_fixed)}</td>
                    <td>{b.meaning}</td>
                    <td className="text-muted">{b.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header-row"><h3>B — Flexi Coaches <span className="text-muted">(per-session + milestone only)</span></h3></div>
        <div className="table-container">
          <table className="data-table reference-table">
            <thead>
              <tr>
                <th>HB+ Benchmark</th><th className="num-col">Per-Session (₹)</th><th className="num-col">Session Threshold</th>
                <th className="num-col">Night Premium (₹)</th><th>Performance Meaning</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {PAY_BANDS.map(b => {
                const r = rateFor("Flexi", b);
                return (
                  <tr key={b.label}>
                    <td><strong>{b.short}</strong></td>
                    <td className="num-col">{rupees(r.per_session)}</td>
                    <td className="num-col">{r.threshold ?? 96}</td>
                    <td className="num-col">₹60</td>
                    <td>{b.meaning}</td>
                    <td className="text-muted">{b.label === PAY_BANDS[0].label ? 'No fixed pay; per session only' : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header-row"><h3>C — Flexi-Fixed Coaches <span className="text-muted">(fixed pay + per-session)</span></h3></div>
        <div className="table-container">
          <table className="data-table reference-table">
            <thead>
              <tr>
                <th>HB+ Benchmark</th><th className="num-col">Per-Session (₹)</th><th className="num-col">Fixed Pay Min (₹)</th>
                <th className="num-col">Fixed Pay Max (₹)</th><th className="num-col">Session Threshold</th>
                <th className="num-col">Night Premium (₹)</th><th>Performance Meaning</th><th>Org Work Eligible</th>
              </tr>
            </thead>
            <tbody>
              {PAY_BANDS.map(b => {
                const r = rateFor("Flexi-Fixed", b);
                return (
                  <tr key={b.label}>
                    <td><strong>{b.short}</strong></td>
                    <td className="num-col">{rupees(r.per_session)}</td>
                    <td className="num-col">{rupees(r.min_fixed)}</td>
                    <td className="num-col">{rupees(r.max_fixed)}</td>
                    <td className="num-col">{r.threshold ?? 96}</td>
                    <td className="num-col">₹60</td>
                    <td>{b.meaning}</td>
                    <td><span className="badge badge-success">Yes</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header-row"><h3>Organizational Work Pay <span className="text-muted">(Flexi &amp; Flexi-Fixed only)</span></h3></div>
        <div className="table-container">
          <table className="data-table reference-table">
            <thead>
              <tr><th>Work Type</th><th>Effort</th><th>Knowledge</th><th className="num-col">Min (₹)</th><th className="num-col">Max (₹)</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {ORG_WORK_REFERENCE.map(w => (
                <tr key={w.type}>
                  <td><strong>{w.type}</strong></td>
                  <td>{w.effort}</td>
                  <td>{w.knowledge}</td>
                  <td className="num-col">{rupees(w.min)}</td>
                  <td className="num-col">{rupees(w.max)}</td>
                  <td className="text-muted">{w.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header-row"><h3>D — Milestone Rewards <span className="text-muted">(session-based)</span></h3></div>
        <div className="table-container">
          <table className="data-table reference-table">
            <thead>
              <tr>
                <th>Category</th><th className="num-col">MS1 Sessions</th><th className="num-col">MS1 Pay (₹)</th>
                <th className="num-col">MS2 Sessions</th><th className="num-col">MS2 Pay (₹)</th>
                <th className="num-col">MS3 Sessions</th><th className="num-col">MS3 Pay (₹)</th>
              </tr>
            </thead>
            <tbody>{COACH_CATEGORIES.map(milestoneRow)}</tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header-row"><h3>E — Annexure-1 Violation Penalties</h3></div>
        <div className="table-container">
          <table className="data-table reference-table">
            <thead>
              <tr><th>Violation Type</th><th>1st</th><th>2nd</th><th>3rd</th><th>4th / Final</th></tr>
            </thead>
            <tbody>
              {Object.entries(rules).map(([type, tiers]) => (
                <tr key={type}>
                  <td><strong>{type}</strong></td>
                  {[0, 1, 2, 3].map(i => (
                    <td key={i}>{tiers[i] ? tiers[i].consequence : '—'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

// Brand-guideline colours. These sit behind white pill text, so each is taken
// at a depth that still carries the label — the lighter cream, tan and sage
// from the palette are used elsewhere, not here.
// The coach page reads as three separate records — who they are, where they
// are paid, and what they bring — so it is tabbed rather than stacked.
const COACH_DETAIL_TABS = [
  { key: 'profile',    label: 'Profile',                tone: 'teal' },
  { key: 'bank',       label: 'Bank Details',           tone: 'blue', pay: true },
  { key: 'experience', label: 'Experience & Education', tone: 'violet' }
];

// Section 194J of the Income Tax Act: 10% withheld at source on professional
// and technical fees, which is how a coach's remuneration is treated.
const TDS_194J_RATE = 0.10;

const TAB_TONE_COLORS = {
  blue: "#344161",   // navy (secondary)
  amber: "#a9674d",  // terracotta (primary)
  violet: "#53372b", // brown (primary)
  indigo: "#414e6d", // navy, one step up
  red: "#9f4022",    // rust (primary)
  teal: "#747440",   // olive (primary)
  green: "#5c7a68"   // sage, deepened for white text
};

/**
 * Score Management tab bar. A single highlight slides between tabs and morphs
 * colour rather than snapping, so moving across groups reads as one continuous
 * motion instead of seven separate buttons lighting up.
 */
function ScorecardTabs({ groups, active, onChange, weights }) {
  const listRef = useRef(null);
  const tabRefs = useRef({});
  const [pill, setPill] = useState(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = tabRefs.current[active];
      const list = listRef.current;
      if (!el || !list) return;
      setPill({
        left: el.offsetLeft - list.scrollLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight
      });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [active, groups.length]);

  const tone = groups.find(g => g.key === active)?.tone;

  return (
    <div className="scorecard-tabs" role="tablist" ref={listRef}>
      {pill && (
        <span
          className="scorecard-tab-pill"
          aria-hidden="true"
          style={{
            transform: `translate(${pill.left}px, ${pill.top}px)`,
            width: `${pill.width}px`,
            height: `${pill.height}px`,
            backgroundColor: TAB_TONE_COLORS[tone] || 'var(--accent-teal)'
          }}
        />
      )}
      {groups.map(group => {
        const hasWeights = weights && Object.keys(weights).length > 0;
        const gw = group.weightKeys && hasWeights
          ? group.weightKeys.reduce((sum, k) => sum + (weights[k] || 0), 0)
          : null;
        return (
          <button
            key={group.key}
            ref={(el) => { tabRefs.current[group.key] = el; }}
            role="tab"
            aria-selected={active === group.key}
            className={`scorecard-tab ${active === group.key ? 'active' : ''}`}
            onClick={() => onChange(group.key)}
          >
            {group.label}
            {gw !== null && <span className="scorecard-tab-weight">Wt {gw}%</span>}
          </button>
        );
      })}
    </div>
  );
}

const VIEW_TITLES = {
  dashboard: "Dashboard",
  coaches: "Coach Master",
  "score-tracker": "Score Tracker",
  "pay-calculator": "Payroll Calculator",
  evaluations: "Evaluations",
  violations: "Violation Register",
  payroll: "Payroll Ledger",
  appeals: "Appeals",
  settings: "Settings",
  audit: "Audit Trails"
};
const SCORE_TRACKER_PAGE_SIZES = [10, 25, 50, 100];

// The compact Add Coach form captures identity only. These are the remaining
// profile fields the remuneration engine reads; HR completes them from the
// coach record afterwards, and these defaults keep a new coach calculable.
const NEW_COACH_DEFAULTS = {
  internal_designation: "Coach",
  date_of_joining: "2026-06-25",
  date_of_first_relevant_certification: "2024-01-01",
  freelance_past_exp_with_document: 1.0,
  freelance_past_exp_without_document: 0.0,
  non_coaching_exp_years: 0,
  education_qualification: "3-Year Bachelor's",
  education_type: "offline_india",
  assigned_property: "HB+ Studio HSR",
  status: "Active",
  bank_account: "XXXX XXXX 8899",
  phone: "",
  certifications: [],
  five_star_streak: 0,
  pdfData: "",
  pdfName: ""
};

// A fresh copy of the reference data, in the shape the app state holds it.
// Used both by "Restore Seed" and by the first sign-in against an empty database.
// Policy variants are reference data the app ships with. A variant defined
// here but absent from stored state — one added after that state was written —
// is folded in, so a new policy does not stay invisible in every picker until
// the database is migrated by hand. Stored variants always win on id, so an
// edited policy is never overwritten by the seed.
const withSeedVariants = (loaded) => {
  const list = Array.isArray(loaded) ? loaded : [];
  const have = new Set(list.map(v => v.id));
  const missing = INITIAL_VARIANTS.filter(v => !have.has(v.id));
  return missing.length ? [...list, ...JSON.parse(JSON.stringify(missing))] : list;
};

const seedSnapshot = () => ({
  variants: JSON.parse(JSON.stringify(INITIAL_VARIANTS)),
  certifications: JSON.parse(JSON.stringify(INITIAL_CERTIFICATIONS)),
  educationLevels: JSON.parse(JSON.stringify(INITIAL_EDUCATION_LEVELS)),
  educationFormats: JSON.parse(JSON.stringify(INITIAL_EDUCATION_FORMATS)),
  coaches: JSON.parse(JSON.stringify(INITIAL_COACHES)),
  historicMonths: JSON.parse(JSON.stringify(INITIAL_HISTORIC_MONTHS)),
  currentMonth: JSON.parse(JSON.stringify(INITIAL_CURRENT_MONTH)),
  orgWork: JSON.parse(JSON.stringify(INITIAL_ORG_WORK)),
  violations: JSON.parse(JSON.stringify(INITIAL_VIOLATIONS)),
  appeals: [],
  auditLog: [{
    id: "AUD_SEED",
    timestamp: new Date().toLocaleString('en-IN'),
    actor: "System",
    action: "Database Reseed",
    details: "Application databases reset to initial frameworks.",
    ip: "127.0.0.1",
    userAgent: "Server Engine"
  }],
  payrollLocked: false,
  openPeriodMonth: INITIAL_CURRENT_MONTH[0]?.period_month ?? null
});

export default function App({ session = null, profile = null, onSignOut = null }) {
  // App States
  const [variants, setVariants] = useState([]);
  const [certifications, setCertifications] = useState([]);
  // The education scoring matrix, owned by HR/Admin rather than the engine.
  const [educationLevels, setEducationLevels] = useState([]);
  // Study formats, also HR/Admin-owned. `value` is what coach records store.
  const [educationFormats, setEducationFormats] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [historicMonths, setHistoricMonths] = useState([]);
  const [currentMonth, setCurrentMonth] = useState([]);
  const [orgWork, setOrgWork] = useState([]);
  // Attendance & Leave
  const [attendanceLogs, setAttendanceLogs] = useState([]);
  const [attendanceDays, setAttendanceDays] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState([]);
  const [leaveApplications, setLeaveApplications] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [attendanceCoachId, setAttendanceCoachId] = useState("");
  const [leaveForm, setLeaveForm] = useState({ type: 'PAID', from: '', to: '', halfDay: false, reason: '' });
  // The camera, open only while a login is being taken.
  const [photoCapture, setPhotoCapture] = useState(null); // { coach, resolve, attempts }
  // Failures in a row on this login — a refused camera, a dark frame, an
  // upload that did not land, a location that could not be read. Three of them
  // and the coach may go on without, because at that point the obstacle is the
  // equipment rather than the person.
  const loginFailures = useRef(0);
  const LOGIN_FAILURES_BEFORE_SKIP = 3;
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  // The photo archive an administrator pulls down.
  const [photoBatch, setPhotoBatch] = useState({ coach: 'All', from: '', to: '' });
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '', centre: '' });
  const [holidayPreview, setHolidayPreview] = useState(null);
  const [leaveRegister, setLeaveRegister] = useState({ status: 'All', coach: 'All', from: '', to: '' });
  const [photoBusy, setPhotoBusy] = useState("");
  // Ticks only while someone is logged in. An open period counts up to now, so
  // without this the figure would sit still until something else redrew it.
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [violations, setViolations] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [payrollLocked, setPayrollLocked] = useState(false);
  const [isStateLoaded, setIsStateLoaded] = useState(false);

  // View & Context Navigation. The role comes from the signed-in app_users row;
  // only a Super Admin may impersonate another role from the header switcher.
  const [currentRole, setCurrentRole] = useState(profile?.role ?? "Super Admin");
  const [currentCoachContext, setCurrentCoachContext] = useState(profile?.coach_id ?? "");
  const [currentRmContext, setCurrentRmContext] = useState(profile?.rm_id ?? "RM_01");
  const canSwitchRole = (profile?.role ?? "Super Admin") === "Super Admin";
  const [syncError, setSyncError] = useState("");

  // User Access screen: the app_users rows, loaded on demand from the
  // admin_list_users RPC (auth.users is not readable directly).
  const [appUsers, setAppUsers] = useState([]);
  const [appUsersLoading, setAppUsersLoading] = useState(false);
  const [appUsersError, setAppUsersError] = useState("");
  const [savingUserId, setSavingUserId] = useState(null);
  const [userDrafts, setUserDrafts] = useState({});
  const [activeView, setActiveView] = useState("dashboard");
  const [sidebarActive, setSidebarActive] = useState(false);

  // Toasts State
  const [toasts, setToasts] = useState([]);

  // Modal States
  const [activeModal, setActiveModal] = useState(null); // 'add-coach', 'eval-form', 'log-violation', 'bulk-sessions', 'payslip-preview', 'org-work', 'appeal'
  const [selectedCoachId, setSelectedCoachId] = useState(""); // context for modals

  // Form Field States
  // 1. Add Coach Form
  const [newCoachName, setNewCoachName] = useState("");
  const [newCoachUhid, setNewCoachUhid] = useState("");
  const [newCoachEmail, setNewCoachEmail] = useState("");
  const [newCoachGender, setNewCoachGender] = useState("");
  const [newCoachType, setNewCoachType] = useState("");
  const [newCoachCategory, setNewCoachCategory] = useState("");
  // Starting pay. Pre-filled from the bottom of the entry band's range, which
  // is what a coach with no performance history benchmarks to, and editable —
  // a new hire is rarely on the floor of the lowest band.
  const [newCoachSalary, setNewCoachSalary] = useState("");
  const [newCoachRate, setNewCoachRate] = useState("");
  const [newCoachErrors, setNewCoachErrors] = useState({});

  // 2. Evaluation Form
  const [evalAppearance, setEvalAppearance] = useState(16);
  const [evalEngagement, setEvalEngagement] = useState(15);
  const [evalSafety, setEvalSafety] = useState(12);
  const [evalPunctuality, setEvalPunctuality] = useState(8);
  const [evalConduct, setEvalConduct] = useState(12);
  const [evalCommunication, setEvalCommunication] = useState(15);
  const [evalAttendance, setEvalAttendance] = useState(95);
  const [evalSessionsCompleted, setEvalSessionsCompleted] = useState(156);
  const [evalNightSessions, setEvalNightSessions] = useState(0);
  const [evalStreak, setEvalStreak] = useState(0);
  // HOP inputs
  const [evalOohSessions, setEvalOohSessions] = useState(0);
  const [evalPtHomeSessions, setEvalPtHomeSessions] = useState(0);
  const [evalCredits, setEvalCredits] = useState(0);
  // Flexi inputs
  const [evalTrialSessions, setEvalTrialSessions] = useState(0);
  const [evalHalfEvents, setEvalHalfEvents] = useState(0);
  const [evalFullEvents, setEvalFullEvents] = useState(0);
  const [evalCoachCategory, setEvalCoachCategory] = useState("Fixed");

  // 3. Log Violation Form
  const [vioCoachId, setVioCoachId] = useState("");
  const [vioType, setVioType] = useState("Late Arrival (<5 min)");
  const [vioDate, setVioDate] = useState("");
  const [vioTime, setVioTime] = useState("");
  const [vioEvidence, setVioEvidence] = useState("");

  // 4. Org Work Form
  const [owWorkType, setOwWorkType] = useState("Workout Planning / Programming");
  const [owAmount, setOwAmount] = useState(3000);

  // 5. File Appeal Form
  const [appealTargetId, setAppealTargetId] = useState("");
  const [appealTargetType, setAppealTargetType] = useState("");
  const [appealReason, setAppealReason] = useState("");

  // 6. Bulk CSV area
  const [bulkCSV, setBulkCSV] = useState("");

  // 8. Add Certification Form
  const [newCertAuthority, setNewCertAuthority] = useState("");
  const [newCertCourseName, setNewCertCourseName] = useState("");
  const [newCertVariantType, setNewCertVariantType] = useState("S&C");
  const [newCertLevel, setNewCertLevel] = useState("Gold");
  const [newEduQualification, setNewEduQualification] = useState("");
  const [newEduFormat, setNewEduFormat] = useState("offline_india");
  const [newEduScore, setNewEduScore] = useState(3.0);
  const [newEduFormatLabel, setNewEduFormatLabel] = useState("");
  const [newCertScore, setNewCertScore] = useState(8.0);
  const [newCertPdfData, setNewCertPdfData] = useState("");
  const [newCertPdfName, setNewCertPdfName] = useState("");

  // 9. Add Coach PDF Form

  // 7. Payslip Preview Period
  const [payslipPeriod, setPayslipPeriod] = useState(getPeriodForDate(new Date()).period_month);

  // Filters State
  const [coachesSearch, setCoachesSearch] = useState("");
  const [coachesVariantFilter, setCoachesVariantFilter] = useState("All");
  const [coachesCategoryFilter, setCoachesCategoryFilter] = useState("All");
  const [coachesStatusFilter, setCoachesStatusFilter] = useState("All");

  // Coach Master drill-down: null shows the directory, an id shows that coach's page
  const [coachDetailId, setCoachDetailId] = useState(null);
  // Score Management inline editing: which period is open, and its draft values.
  const [editingScorePeriod, setEditingScorePeriod] = useState(null);
  // The score card renders as two tables (the tabbed one and Incentive).
  // Both list the same periods, so the open period alone is not enough to say
  // which table the user clicked edit on — this pins it to one of them.
  const [editingScorePane, setEditingScorePane] = useState(null);
  const [scoreDraft, setScoreDraft] = useState({});
  // Dynamic columns the user has explicitly confirmed they want to hand-enter.
  const [unlockedDynamicKeys, setUnlockedDynamicKeys] = useState([]);
  // Score Management shows one column group at a time so the row stays readable.
  const [scorecardTab, setScorecardTab] = useState("core");
  const [penaltyVariant, setPenaltyVariant] = useState("V1");
  const [trackerTab, setTrackerTab] = useState("experience");
  // Bulk upload: the month/file dialog, then the preview that must be accepted.
  const [bulkDialog, setBulkDialog] = useState(null);   // { mode, tab, month }
  const [bulkPreview, setBulkPreview] = useState(null); // { tab, month, scope, fileName, changes, skipped, rejected }
  // Which period a template is drawn for and an upload is applied to. Blank
  // means the open payroll period, so it always starts on the live month.
  // Org work decides what a coach is put on and what it is worth, so it is
  // locked until deliberately taken over — as a calculated cell is.
  const [orgWorkUnlocked, setOrgWorkUnlocked] = useState(false);
  const [coachDetailTab, setCoachDetailTab] = useState("profile");
  // Which pay cycles the score card tables show. Blank means the full span,
  // so a coach with only a few periods needs no filtering at all.
  const [scorecardFrom, setScorecardFrom] = useState("");
  const [scorecardTo, setScorecardTo] = useState("");
  // Inline editing of the coach's profile and experience cards.
  const [editingCoachCard, setEditingCoachCard] = useState(null); // 'profile' | 'experience'
  const [coachDraft, setCoachDraft] = useState({});

  const [scoreSearch, setScoreSearch] = useState("");
  const [scoreMonthFilter, setScoreMonthFilter] = useState("All");
  const [scoreCategoryFilter, setScoreCategoryFilter] = useState("All");
  const [payrollCategoryFilter, setPayrollCategoryFilter] = useState("All");
  const [scoreVariantFilter, setScoreVariantFilter] = useState("All");
  const [payCalcVariant, setPayCalcVariant] = useState("V1");
  const [payCalcPeriod, setPayCalcPeriod] = useState("");
  const [payrollRunPeriod, setPayrollRunPeriod] = useState("");
  const [payCalcCoachId, setPayCalcCoachId] = useState("");
  const [scoreSort, setScoreSort] = useState({ key: "coach_id", dir: "asc" });
  const [scorePage, setScorePage] = useState(1);
  const [scoreRowsPerPage, setScoreRowsPerPage] = useState(25);

  const [evalMonthFilter, setEvalMonthFilter] = useState(getPeriodForDate(new Date()).period_month);
  const [evalVariantFilter, setEvalVariantFilter] = useState("All");
  const [evalStatusFilter, setEvalStatusFilter] = useState("All");

  const getFileIcon = (fileName) => {
    if (!fileName) return "bx bx-file text-muted";
    const ext = fileName.split('.').pop().toLowerCase();
    if (ext === 'pdf') return "bx bxs-file-pdf text-red";
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return "bx bxs-file-image text-blue";
    if (['doc', 'docx'].includes(ext)) return "bx bxs-file text-teal";
    return "bx bx-file text-muted";
  };

  const [vioSearch, setVioSearch] = useState("");
  const [vioTypeFilter, setVioTypeFilter] = useState("All");
  const [vioStatusFilter, setVioStatusFilter] = useState("All");

  const [payrollMonthFilter, setPayrollMonthFilter] = useState(getPeriodForDate(new Date()).period_month);
  const [payrollVariantFilter, setPayrollVariantFilter] = useState("All");

  // Where the data lives. `openPeriodMonth` is the payroll_cycles row the lock
  // flag belongs to; `lastSynced` is the snapshot syncState() diffs against.
  const [openPeriodMonth, setOpenPeriodMonth] = useState(null);
  const lastSynced = useRef(null);
  // True while a local write is queued or in flight, so the lock poller does
  // not read the pre-write value and undo it.
  const pendingWrite = useRef(false);
  // The row open in the score card editor, read by the lock poller without
  // making it a dependency and tearing the timer down on every keystroke.
  const editingRef = useRef(null);
  // Score card edits that have been started but not yet saved, keyed
  // "<coach_id>|<period_month>". Switching rows, tabs or coaches sets the
  // current one aside here instead of discarding it, and opening that month
  // again hands it straight back.
  const [pendingDrafts, setPendingDrafts] = useState({});
  // "", "saving" or the time of the last automatic save, for the line that
  // tells the person whether what they typed is safe yet.
  const [autoSaveAt, setAutoSaveAt] = useState("");
  const draftKey = (coachId, periodMonth) => `${coachId}|${periodMonth}`;
  // The live draft, mirrored so it can be read outside a render without
  // reaching into a state updater to do it.
  const scoreDraftRef = useRef({});

  const applyState = (next) => {
    setVariants(withSeedVariants(next.variants));
    setCertifications(next.certifications || []);
    setEducationLevels(next.educationLevels?.length ? next.educationLevels : INITIAL_EDUCATION_LEVELS);
    setEducationFormats(next.educationFormats?.length ? next.educationFormats : INITIAL_EDUCATION_FORMATS);
    setCoaches(next.coaches || []);
    setHistoricMonths(dedupePeriodRecords(next.historicMonths));
    setCurrentMonth(dedupePeriodRecords(next.currentMonth));
    setOrgWork(next.orgWork || []);
    setAttendanceLogs(next.attendanceLogs || []);
    setAttendanceDays(next.attendanceDays || []);
    setLeaveBalances(next.leaveBalances || []);
    setLeaveApplications(next.leaveApplications || []);
    setHolidays(next.holidays || []);
    setViolations(next.violations || []);
    setAppeals(next.appeals || []);
    setAuditLog(next.auditLog || []);
    setPayrollLocked(next.payrollLocked || false);
    if (next.openPeriodMonth !== undefined) setOpenPeriodMonth(next.openPeriodMonth);
    if (!profile?.coach_id && next.coaches?.length > 0) {
      setCurrentCoachContext(next.coaches[0].id);
    }
  };

  // Load state: Supabase when configured, else the old localStorage cache.
  useEffect(() => {
    let alive = true;

    const loadFromCache = () => {
      const cached = localStorage.getItem('hb_remuneration_state');
      if (!cached) { resetToSeed(); return; }
      try {
        const parsed = JSON.parse(cached);
        // Backfill seed score records the cached state predates (e.g. the full
        // May 2026 sheet), without discarding anything the user has entered.
        const cachedHistoric = parsed.historicMonths || [];
        const cachedKeys = new Set(cachedHistoric.map(r => `${r.coach_id}|${r.period_month}`));
        const missingSeed = INITIAL_HISTORIC_MONTHS.filter(r => !cachedKeys.has(`${r.coach_id}|${r.period_month}`));
        applyState({ ...parsed, historicMonths: [...cachedHistoric, ...missingSeed] });
      } catch (e) {
        console.error("Failed to parse cached state, resetting to seed", e);
        resetToSeed();
      }
    };

    (async () => {
      if (!isSupabaseConfigured || !session) {
        loadFromCache();
        if (alive) setIsStateLoaded(true);
        return;
      }
      try {
        const empty = await isDatabaseEmpty();
        if (empty) {
          // Schema is up but nothing seeded yet — push the seed once so the
          // first admin to sign in gets a working dashboard.
          const seeded = seedSnapshot();
          const seedErrors = await syncState(null, seeded);
          if (!alive) return;
          applyState(seeded);
          if (seedErrors.length) {
            // A partial seed is worse than none: the screens that read the
            // missing table break later, far from the cause.
            lastSynced.current = null;
            setSyncError(`Seeding was incomplete — ${seedErrors.join(' | ')}`);
            showToast("Seeding failed for some tables. See the banner.", "danger");
          } else {
            lastSynced.current = seeded;
            showToast("Supabase was empty — seeded the reference data.", "info");
          }
        } else {
          const remote = await loadState();
          if (!alive) return;
          applyState(remote);
          lastSynced.current = remote;
        }
      } catch (e) {
        console.error("Supabase load failed, falling back to local cache", e);
        if (alive) {
          setSyncError(e.message || String(e));
          loadFromCache();
        }
      }
      if (alive) setIsStateLoaded(true);
    })();

    return () => { alive = false; };
  }, [session?.user?.id]);

  // Calendar rollover: once today passes the open period's end date, close that
  // period into history and open the next one. Every active coach gets a fresh
  // row whose dynamic cells compute straight away and whose manual cells are
  // empty until an RM records them.
  useEffect(() => {
    if (!isStateLoaded || currentMonth.length === 0 || coaches.length === 0) return;

    const today = new Date();
    const openPeriod = currentMonth[0];
    if (new Date(openPeriod.period_end) >= today) return;

    const livePeriod = getPeriodForDate(today);
    const closed = [];
    let cursor = openPeriod;

    // Walk forward one period at a time so no month is skipped in the history.
    while (cursor.period_month !== livePeriod.period_month) {
      const next = getNextPeriod(cursor.period_end);
      if (next.period_month === livePeriod.period_month) break;
      closed.push(next);
      cursor = next;
      if (closed.length > 60) break; // guard against a bad clock
    }

    const activeCoaches = coaches.filter(c => c.status === "Active");

    // A blank is only ever filling a gap. Writing one over a coach/month that
    // already has a record would wipe whatever was recorded there — and since
    // a later duplicate wins on the way to the database, it wiped it there too.
    const existing = new Set(
      [...historicMonths, ...currentMonth].map(r => draftKey(r.coach_id, r.period_month))
    );
    const blanksFor = (period) => activeCoaches
      .filter(c => !existing.has(draftKey(c.id, period.period_month)))
      .map(c => blankPeriodRecord(c.id, period));

    // Closing a cycle does not lock anything. Locking is a deliberate act on
    // Record Status, so a month that has rolled over can still be completed —
    // data often arrives after the calendar has moved on.
    const rolledIntoHistory = [
      ...currentMonth,
      ...closed.flatMap(blanksFor)
    ];

    // The period being opened may already have records — the calendar can pass
    // an end date more than once across sessions. Those are kept as they are
    // and only the coaches without one get a blank, so nothing is overwritten
    // and nobody is left off the new cycle.
    const liveAlready = [...historicMonths, ...currentMonth]
      .filter(r => r.period_month === livePeriod.period_month);
    const liveCovered = new Set(liveAlready.map(r => r.coach_id));

    setHistoricMonths(prev => [
      ...prev.filter(r => r.period_month !== livePeriod.period_month),
      ...rolledIntoHistory.filter(r => r.period_month !== livePeriod.period_month)
    ]);
    setCurrentMonth([
      ...liveAlready,
      ...activeCoaches
        .filter(c => !liveCovered.has(c.id))
        .map(c => blankPeriodRecord(c.id, livePeriod))
    ]);
    setPayrollLocked(false);

    const opened = closed.length + 1;
    logAudit(
      "Period Rolled Over",
      `Calendar advanced past ${openPeriod.period_month}. Opened ${livePeriod.period_month} (${opened} period${opened > 1 ? 's' : ''} created) with blank score cards for ${activeCoaches.length} active coaches. Closed periods are left unlocked — locking is manual.`
    );
    showToast(`New performance period opened: ${livePeriod.period_month}.`, "info");
  }, [isStateLoaded, coaches.length]);

  // The scoring engine keeps the education matrix in module scope, so it has to
  // be handed the master rows. useMemo runs during render, which means an edit
  // to the points is reflected in the same pass rather than one render later.
  useMemo(() => setEducationScores(educationLevels), [educationLevels]);

  // The qualifications offered on the coach profile are whatever the education
  // master defines, so adding one there makes it selectable here. "None" always
  // stays on the list and scores nothing.
  const educationQualifications = [...new Set(educationLevels.map(l => l.qualification))];
  const educationQualificationOptions = ["None", ...educationQualifications];

  // Two of the Score Tracker's columns are rupee amounts. A role that does not
  // see pay does not see those, and everything that counts columns — the group
  // header spans, the empty-row colspan and the CSV — reads from here.
  const trackerVisible = HIDES_PAY(currentRole)
    ? SCORE_TRACKER_GROUPS
        .map(g => ({ ...g, columns: g.columns.filter(c => !c.money) }))
        .filter(g => g.columns.length > 0)
    : SCORE_TRACKER_GROUPS;

  // One group at a time, the way the score card reads, so the table stops
  // running off the side. The coach identity group always stays.
  const trackerIdentity = trackerVisible.find(g => g.key === 'info');
  const trackerTabs = trackerVisible.filter(g => g.key !== 'info');
  const trackerActive = trackerTabs.find(g => g.key === trackerTab) || trackerTabs[0];
  const trackerGroups = [trackerIdentity, trackerActive].filter(Boolean);
  const trackerColumns = trackerGroups.flatMap(g => g.columns);

  // Write-through. Supabase gets a debounced diff of whatever changed;
  // localStorage keeps a mirror so a dropped connection is not data loss.
  useEffect(() => {
    if (!isStateLoaded) return;

    const STATE = {
      variants,
      certifications,
      educationLevels,
      educationFormats,
      coaches,
      historicMonths,
      currentMonth,
      orgWork,
      attendanceLogs,
      attendanceDays,
      leaveBalances,
      leaveApplications,
      holidays,
      violations,
      appeals,
      auditLog,
      payrollLocked,
      openPeriodMonth
    };

    localStorage.setItem('hb_remuneration_state', JSON.stringify(STATE));

    if (!isSupabaseConfigured || !session) return;

    pendingWrite.current = true;
    const timer = setTimeout(async () => {
      try {
        const errors = await syncState(lastSynced.current, STATE);
        if (errors.length) {
          setSyncError(errors.join(' | '));
          console.error("Supabase sync errors", errors);
        } else {
          setSyncError("");
          lastSynced.current = STATE;
        }
      } catch (e) {
        setSyncError(e.message || String(e));
        console.error("Supabase sync failed", e);
      } finally {
        pendingWrite.current = false;
      }
    }, 700);

    return () => clearTimeout(timer);
  }, [variants, certifications, educationLevels, educationFormats, coaches, historicMonths, currentMonth, orgWork, attendanceLogs, attendanceDays, leaveBalances, leaveApplications, holidays, violations, appeals, auditLog, payrollLocked, openPeriodMonth, isStateLoaded, session]);

  // -------------------------------------------------------------------------
  // -------------------------------------------------------------------------
  // Backfill missing periods.
  //
  // The pay cycle runs 16th to 15th, and each month must be there to be paid:
  // "May 2026" is 16 Apr – 15 May and is paid in May. A month can go missing —
  // an earlier defect deleted whichever month was open when the calendar
  // rolled, which is why June and September could be absent while July and
  // August were not — and a gap in the cycle is invisible until someone looks
  // for a payslip that was never there.
  //
  // Gaps are filled per coach, only between that coach's earliest record and
  // the open period, so nobody is given history from before they joined.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isStateLoaded || coaches.length === 0 || currentMonth.length === 0) return;

    const openMonth = currentMonth[0].period_month;
    const all = [...historicMonths, ...currentMonth];
    if (all.length === 0) return;

    const earliest = all.reduce((min, r) =>
      (!min || new Date(r.period_start) < new Date(min.period_start)) ? r : min, null);

    // Every period from the earliest on record up to the open one, in order.
    const chain = [{
      period_month: earliest.period_month,
      period_start: earliest.period_start,
      period_end: earliest.period_end
    }];
    while (chain[chain.length - 1].period_month !== openMonth && chain.length < 120) {
      chain.push(getNextPeriod(chain[chain.length - 1].period_end));
    }
    if (chain[chain.length - 1].period_month !== openMonth) return; // bad clock

    const held = new Set(all.map(r => draftKey(r.coach_id, r.period_month)));
    const missing = [];
    for (const coach of coaches.filter(c => c.status === "Active")) {
      const firstIdx = chain.findIndex(p => held.has(draftKey(coach.id, p.period_month)));
      if (firstIdx === -1) continue; // no history at all — the rollover owns this
      for (const period of chain.slice(firstIdx)) {
        if (period.period_month === openMonth) continue;
        if (held.has(draftKey(coach.id, period.period_month))) continue;
        missing.push(blankPeriodRecord(coach.id, period));
      }
    }
    if (missing.length === 0) return;

    setHistoricMonths(prev => [...prev, ...missing]);
    const months = [...new Set(missing.map(r => r.period_month))];
    logAudit("Missing Periods Restored",
      `Created ${missing.length} blank score card${missing.length === 1 ? '' : 's'} for ${months.join(', ')}, which had no record.`);
    showToast(`${months.join(', ')} ${months.length === 1 ? 'was' : 'were'} missing from the cycle — blank score cards added.`, "warning");
  }, [isStateLoaded, coaches.length, currentMonth.length]);

  // Lock state follows the database without a reload. Locking is how one person
  // tells everyone else a month is settled, so a stale padlock is the one piece
  // of state worth re-reading on a timer. Only `status` is taken, so an edit in
  // progress on the same row is untouched.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!isStateLoaded || !isSupabaseConfigured || !session) return;

    let alive = true;

    const pull = async () => {
      if (!alive || pendingWrite.current || document.hidden) return;
      let remote;
      try {
        remote = await loadLockState();
      } catch (e) {
        // A failed poll is not worth a banner — the next one may well succeed.
        console.error("Lock poll failed", e);
        return;
      }
      if (!alive || !remote || pendingWrite.current) return;

      // Applying the remote status would otherwise look like a local edit and
      // be written straight back, so the sync baseline moves with it.
      const rebase = (list, key) => {
        let changed = false;
        const next = list.map(r => {
          const status = remote.statuses.get(`${r.coach_id}|${r.period_month}`);
          if (status === undefined || status === r.status) return r;
          changed = true;
          return { ...r, status };
        });
        if (changed && lastSynced.current) lastSynced.current[key] = next;
        return changed ? next : list;
      };

      // Someone else locking the row under an open editor would otherwise let
      // it save into a settled month, so the editor closes and the draft goes.
      const editing = editingRef.current;
      if (editing && remote.statuses.get(editing) === 'FINANCE_LOCKED') {
        cancelScoreRowEdit();
        showToast("That month was just locked by someone else — your edit was not saved.", "warning");
      }

      setCurrentMonth(prev => rebase(prev, 'currentMonth'));
      setHistoricMonths(prev => rebase(prev, 'historicMonths'));
      setPayrollLocked(prev => {
        if (remote.payrollLocked === prev) return prev;
        if (lastSynced.current) lastSynced.current.payrollLocked = remote.payrollLocked;
        return remote.payrollLocked;
      });
    };

    const timer = setInterval(pull, 15000);
    // Coming back to the tab is when a stale padlock is most likely, and most
    // noticeable, so that pulls straight away rather than waiting out the timer.
    const onVisible = () => { if (!document.hidden) pull(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isStateLoaded, session]);

  // Moving to another coach leaves the editor pointing at a row that is no
  // longer on screen, so it closes — with the draft set aside, not dropped.
  useEffect(() => {
    if (!editingRef.current) return;
    stashOpenDraft();
    editingRef.current = null;
    setEditingScorePeriod(null);
    setEditingScorePane(null);
    setScoreDraft({});
    setUnlockedDynamicKeys([]);
  }, [currentCoachContext]);

  // A draft only lives in this tab, so closing it would take the work with it.
  useEffect(() => {
    const open = editingRef.current ? 1 : 0;
    const count = Object.keys(pendingDrafts).length + open;
    if (count === 0) return;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [pendingDrafts, editingScorePeriod]);

  // -------------------------------------------------------------------------
  // Coaches whose band moved between the last cycle and the open one.
  //
  // Pay no longer follows the band, which is what makes this worth surfacing:
  // a coach who has moved up or down is not automatically paid differently,
  // so somebody has to decide whether their figure should change. Silent
  // movement is how a coach ends up a band away from what they are paid.
  // -------------------------------------------------------------------------
  const bandMoveIndex = useMemo(() => {
    const order = PAY_BANDS.map(b => b.label);
    const byCoach = new Map();
    for (const r of [...historicMonths, ...currentMonth]) {
      if (!byCoach.has(r.coach_id)) byCoach.set(r.coach_id, []);
      byCoach.get(r.coach_id).push(r);
    }

    const index = new Map();
    for (const [coachId, records] of byCoach) {
      const sorted = [...records].sort((a, b) => new Date(a.period_start) - new Date(b.period_start));
      let prev = null;
      for (const r of sorted) {
        // An unscored month is not a band, so it is passed over rather than
        // read as a fall to the bottom — which is what a null score would do.
        if (r.hb_score == null) continue;
        const band = r.band || getPerformanceBand(r.hb_score).label;
        if (prev && band !== prev.band) {
          index.set(`${coachId}|${r.period_month}`, {
            up: order.indexOf(band) > order.indexOf(prev.band),
            from: prev.band,
            fromMonth: prev.month,
            to: band
          });
        }
        prev = { band, month: r.period_month };
      }
    }
    return index;
  }, [historicMonths, currentMonth]);

  const bandMoveFor = (coachId, periodMonth) =>
    bandMoveIndex.get(`${coachId}|${periodMonth}`) ?? null;

  // Raised once per sign-in, not on every render: a band move is news the
  // first time it is seen, and noise every time after. Held in sessionStorage
  // so it does not fire again on each navigation within the same session.
  const bandAlertShown = useRef(false);

  const bandMovements = useMemo(() => {
    const openMonth = currentMonth[0]?.period_month
      ?? getPeriodForDate(new Date()).period_month;
    return coaches
      .filter(c => c.status === 'Active')
      .map(c => {
        const move = bandMoveIndex.get(`${c.id}|${openMonth}`);
        return move ? { coachId: c.id, name: c.name, ...move } : null;
      })
      .filter(Boolean)
      .sort((a, b) => Number(a.up) - Number(b.up) || a.name.localeCompare(b.name));
  }, [bandMoveIndex, coaches, currentMonth]);

  useEffect(() => {
    if (!isStateLoaded || bandAlertShown.current) return;
    if (!PROFILE_PAY_ROLES.includes(currentRole)) return;
    if (bandMovements.length === 0) return;

    const openMonth = currentMonth[0]?.period_month ?? '';
    const stamp = `${currentRole}|${openMonth}|${bandMovements.map(m => m.coachId).sort().join(',')}`;
    let seen = null;
    try { seen = sessionStorage.getItem('hb_band_alert'); } catch { /* private mode */ }
    if (seen === stamp) { bandAlertShown.current = true; return; }

    bandAlertShown.current = true;
    try { sessionStorage.setItem('hb_band_alert', stamp); } catch { /* private mode */ }

    const up = bandMovements.filter(m => m.up).length;
    const down = bandMovements.length - up;
    const parts = [up ? `${up} up` : null, down ? `${down} down` : null].filter(Boolean).join(', ');
    showToast(
      `${bandMovements.length} coach${bandMovements.length === 1 ? '' : 'es'} changed band this cycle (${parts}) — ` +
      `${bandMovements.slice(0, 3).map(m => m.name).join(', ')}${bandMovements.length > 3 ? ' and others' : ''}. ` +
      `Pay does not follow the band, so it needs a decision.`,
      down > 0 ? "warning" : "info"
    );
  }, [isStateLoaded, currentRole, bandMovements, currentMonth]);

  // Helper to match coach type across filters
  const matchesCoachType = (coach, filterValue) => {
    if (!filterValue || filterValue === "All") return true;
    const vConfig = variants.find(v => v.id === coach?.variant_id);
    const coachType = coach?.coach_type || (vConfig ? (vConfig.discipline === 'S&C' ? 'Strength' : vConfig.discipline) : 'Strength');
    if (filterValue === "Strength" || filterValue === "S&C") {
      return coachType === "Strength" || coachType === "S&C" || ["V1", "V2", "V5"].includes(coach?.variant_id);
    }
    if (filterValue === "Yoga") {
      return coachType === "Yoga" || ["V3", "V4"].includes(coach?.variant_id);
    }
    if (filterValue === "Pilates") {
      return coachType === "Pilates";
    }
    if (filterValue === "Physio") {
      return coachType === "Physio";
    }
    return coachType === filterValue;
  };

  // Setup Mathematical verification suite on window for testing
  useEffect(() => {
    if (isStateLoaded) {
      window.runScoringVerificationTests = () => {
        console.log("=== STARTING MATHEMATICAL VERIFICATION TESTS ===");
        
        const v1 = variants.find(v => v.id === 'V1'); // S&C Internal
        const v3 = variants.find(v => v.id === 'V3'); // Yoga Internal
        
        const mockCoachSC = {
          freelance_past_exp_with_document: 0,
          freelance_past_exp_without_document: 0,
          date_of_joining: "2026-06-25", // 0 tenure
          non_coaching_exp_years: 0,
          education_qualification: "3-Year Bachelor's",
          education_type: "offline_india", // 3.0 points
          certifications: [{ score: 8.0 }] // 8.0 points
        };
        
        const mockEval = {
          prof_appearance: 16, client_engagement: 16, safety: 12, punctuality: 8, team_conduct: 13, communication: 15, // core 80
          attendance_pct: 90,
          period_end: "2026-06-25"
        };

        const scScore = computeHBPlusScore(mockCoachSC, mockEval, v1).hbScore;
        const yogaScore = computeHBPlusScore(mockCoachSC, mockEval, v3).hbScore;
        
        console.log(`Test 1 (Variant Isolation): S&C Score = ${scScore}, Yoga Score = ${yogaScore}`);
        const t1Passed = scScore !== yogaScore;
        console.log(t1Passed ? "✅ Test 1 Passed" : "❌ Test 1 Failed: Scores are identical");

        const b59 = getPerformanceBand(59.99);
        const b60 = getPerformanceBand(60.00);
        console.log(`Test 2 (Band Boundaries): 59.99 -> ${b59.label}, 60.00 -> ${b60.label}`);
        const t2Passed = b59.label.includes("50–60") && b60.label.includes("60–70");
        console.log(t2Passed ? "✅ Test 2 Passed" : "❌ Test 2 Failed: Boundaries incorrect");

        const akash = coaches.find(c => c.id === 'HB+_023');
        const akashEval = historicMonths.find(hm => hm.coach_id === 'HB+_023' && hm.period_month === 'May 2026');
        const akashCalc = computeHBPlusScore(akash, akashEval, v1);
        console.log(`Test 3 (Seed matching): Akash calculated score = ${akashCalc.hbScore} (Target ~53.39)`);
        const t3Passed = Math.abs(akashCalc.hbScore - 53.39) < 0.5;
        console.log(t3Passed ? "✅ Test 3 Passed" : "❌ Test 3 Failed: Score mismatch");

        return {
          t1: t1Passed,
          t2: t2Passed,
          t3: t3Passed,
          passedAll: t1Passed && t2Passed && t3Passed
        };
      };
    }
  }, [variants, coaches, historicMonths, isStateLoaded]);

  // Toast Handler
  const showToast = (message, type = "success") => {
    const id = Date.now() + Math.random();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4300);
  };

  // Audit Logger
  const logAudit = (action, details, nextAuditLog = null) => {
    const activeCoach = coaches.find(c => c.id === currentCoachContext);
    const actorName = currentRole === "Coach" 
      ? `Coach (${activeCoach ? activeCoach.name : currentCoachContext})` 
      : currentRole;

    const logEntry = {
      id: 'AUD_' + Date.now() + Math.floor(Math.random() * 100),
      timestamp: new Date().toLocaleString('en-IN'),
      actor: actorName,
      action,
      details,
      ip: "192.168.1.105",
      userAgent: navigator.userAgent.substring(0, 50)
    };

    if (nextAuditLog) {
      nextAuditLog(prev => [logEntry, ...prev]);
    } else {
      setAuditLog(prev => [logEntry, ...prev]);
    }
  };

  // Seed Reset. The sync effect picks the new state up and pushes it to
  // Supabase, so this resets the remote database too, not just this browser.
  const resetToSeed = () => {
    applyState(seedSnapshot());
    showToast("Database restored to default seed state.");
  };

  // Access check
  const verifyAccess = (permittedRoles) => {
    if (!permittedRoles) return true;
    return permittedRoles.split(",").includes(currentRole);
  };

  // Navigate view with permissions
  const handleNavClick = (view, permittedRoles) => {
    if (!isViewEnabled(view)) {
      showToast("This module is not available yet.", "info");
      return;
    }
    if (!verifyAccess(permittedRoles)) {
      showToast("Access Denied: Your current role is not authorized.", "danger");
      return;
    }
    setActiveView(view);
    setCoachDetailId(null);
    setSidebarActive(false);
  };

  // Handle active coach selection change
  const handleCoachSelectChange = (coachId) => {
    setCurrentCoachContext(coachId);
  };

  /**
   * The violations that can be logged against a coach, grouped by where the
   * rule comes from. Their own variant's rules lead, since a rule written for
   * a discipline should be reached for first; Annexure 1B follows, grouped by
   * its own categories so fifty-six entries stay navigable.
   */
  const violationOptions = (coach) => {
    const own = Object.keys(PENALTY_MATRIX[coach?.variant_id] || {});
    const groups = [];
    if (own.length) groups.push({ label: `${coach?.variant_id || 'Variant'} rules`, types: own });

    const byCategory = new Map();
    for (const type of Object.keys(ONLINE_PENALTY_MATRIX)) {
      if (own.includes(type)) continue;
      const cat = ONLINE_VIOLATION_CATEGORIES[type]?.category || 'Other';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat).push(type);
    }
    for (const [label, types] of byCategory) groups.push({ label, types });
    return groups;
  };

  // Open Log Violation Modal
  const handleOpenViolationModal = (coachId = "") => {
    setVioCoachId(coachId);
    setVioType("Late Arrival (<5 min)");
    setVioDate(new Date().toISOString().substring(0, 10));
    setVioTime(new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }));
    setVioEvidence("");
    setActiveModal("log-violation");
  };

  // Open Evaluation Card Edit
  const handleOpenEvalModal = (coachId) => {
    const coach = coaches.find(c => c.id === coachId);
    const evalData = currentMonth.find(m => m.coach_id === coachId);
    if (!coach || !evalData) return;
    // The score card table is not the only way in, so the lock is enforced
    // here too rather than only on the button that opens this.
    if (evalData.status === 'FINANCE_LOCKED') {
      showToast(`${evalData.period_month} is locked. Unlock it on Record Status to edit.`, "error");
      return;
    }

    setSelectedCoachId(coachId);
    setEvalCoachCategory(coach.coach_category);
    setEvalAppearance(evalData.prof_appearance);
    setEvalEngagement(evalData.client_engagement);
    setEvalSafety(evalData.safety);
    setEvalPunctuality(evalData.punctuality);
    setEvalConduct(evalData.team_conduct);
    setEvalCommunication(evalData.communication);
    setEvalAttendance(evalData.attendance_pct);
    setEvalSessionsCompleted(evalData.sessions_completed);
    setEvalNightSessions(evalData.night_sessions);
    setEvalStreak(evalData.five_star_streak);

    setEvalOohSessions(evalData.ooh_sessions_completed || 0);
    setEvalPtHomeSessions(evalData.pt_home_sessions_completed || 0);
    setEvalCredits(evalData.performance_credits_points || 0);

    setEvalTrialSessions(evalData.trial_sessions_completed || 0);
    setEvalHalfEvents(evalData.half_day_events || 0);
    setEvalFullEvents(evalData.full_day_events || 0);

    setActiveModal("eval-form");
  };

  // Open Org Work Modal
  const handleOpenOrgWorkModal = (coachId) => {
    setSelectedCoachId(coachId);
    setOwWorkType("Workout Planning / Programming");
    setOwAmount(3000);
    setActiveModal("org-work");
  };

  // Open Appeal Modal
  const handleOpenAppealModal = (targetId, type) => {
    setAppealTargetId(targetId);
    setAppealTargetType(type);
    setAppealReason("");
    setActiveModal("appeal");
  };

  /**
   * Fill in a month's pay from the last month that had it set.
   *
   * Pay is set on a month, but it is not re-entered every month: a figure set
   * in May is what June and July are on until something replaces it. So a
   * month without its own figure inherits from the most recent earlier month
   * that has one.
   *
   * It only ever looks backwards, which is what keeps a settled month settled
   * — setting July's pay cannot reach back and change May.
   */
  const resolvePay = (record) => {
    const out = {
      fixed: record?.fixed_pay_override ?? null,
      rate: record?.per_session_override ?? null,
      fixedFrom: record?.fixed_pay_override != null ? 'month' : 'band',
      rateFrom: record?.per_session_override != null ? 'month' : 'band'
    };
    if (!record || (out.fixed != null && out.rate != null)) return out;

    const earlier = [...historicMonths, ...currentMonth]
      .filter(r => r.coach_id === record.coach_id
        && new Date(r.period_start) < new Date(record.period_start))
      .sort((a, b) => new Date(b.period_start) - new Date(a.period_start));

    for (const r of earlier) {
      if (out.fixed == null && r.fixed_pay_override != null) {
        out.fixed = r.fixed_pay_override;
        out.fixedFrom = r.period_month;
      }
      if (out.rate == null && r.per_session_override != null) {
        out.rate = r.per_session_override;
        out.rateFrom = r.period_month;
      }
      if (out.fixed != null && out.rate != null) break;
    }

    const coach = coaches.find(c => c.id === record.coach_id);
    const profileBase = coach?.coach_category === 'Flexi-Fixed'
      ? coach?.flexi_fixed_base_salary
      : coach?.fixed_salary_override;
    if (out.fixed == null && profileBase != null) {
      out.fixed = profileBase;
      out.fixedFrom = 'profile';
    }
    if (out.rate == null && coach?.per_session_override != null) {
      out.rate = coach.per_session_override;
      out.rateFrom = 'profile';
    }
    return out;
  };

  const carryPay = (record) => {
    if (!record) return record;
    const { fixed, rate } = resolvePay(record);
    if (fixed === (record.fixed_pay_override ?? null)
      && rate === (record.per_session_override ?? null)) return record;
    return { ...record, fixed_pay_override: fixed, per_session_override: rate };
  };

  /**
   * Commit a pay override from the calculator onto the coach.
   *
   * Until now the calculator could only model a different rate: nothing wrote
   * it back, so a rate set for a coach reverted to the band rate and the coach
   * carried on being paid the band. This is what makes it stick.
   */
  /**
   * Pin a month's pay for every coach, in one go.
   *
   * A month with no figures of its own is paid from its band, which means the
   * number on screen is computed rather than stored — there is nothing for a
   * later month to inherit. This writes what that month currently works out to
   * onto its own records, so it becomes the figure the months after it carry.
   *
   * Existing figures are left alone: this fills in what was never set, rather
   * than overwriting decisions someone has already made.
   */
  const pinMonthPayForAll = (periodMonth) => {
    if (!PROFILE_PAY_ROLES.includes(currentRole)) {
      showToast("Your role cannot change what coaches are paid.", "error");
      return;
    }

    const records = [...currentMonth, ...historicMonths]
      .filter(r => r.period_month === periodMonth);
    const updates = new Map();
    let locked = 0;
    let already = 0;

    for (const record of records) {
      const coach = coaches.find(c => c.id === record.coach_id);
      if (!coach || coach.status !== 'Active') continue;
      if (record.status === 'FINANCE_LOCKED') { locked += 1; continue; }
      if (record.fixed_pay_override != null && record.per_session_override != null) {
        already += 1;
        continue;
      }
      const vConfig = findVariant(variants, coach.variant_id);
      const { score } = resolvePeriodScore(coach, record, vConfig);
      const pay = computeMonthlyPay(coach, carryPay(record), { hbScore: score }, [], vConfig, []);
      updates.set(record.coach_id, {
        fixed_pay_override: record.fixed_pay_override ?? pay.basePay,
        per_session_override: record.per_session_override ?? pay.perSessionRate
      });
    }

    if (updates.size === 0) {
      showToast(already > 0
        ? `Every ${periodMonth} record already has its pay set.`
        : `No ${periodMonth} records to set pay on.`, "info");
      return;
    }

    const proceed = window.confirm(
      `Fix ${periodMonth}'s pay for ${updates.size} coach${updates.size === 1 ? '' : 'es'}?\n\n` +
      `Each one's ${periodMonth} fixed pay and per-session rate are written onto ` +
      `${periodMonth} as they stand today. Every later month without figures of ` +
      `its own then carries them, and the benchmark score stops moving them.\n\n` +
      `Months before ${periodMonth} are untouched` +
      `${already ? `, and ${already} record${already === 1 ? '' : 's'} already set ${already === 1 ? 'is' : 'are'} left alone` : ''}` +
      `${locked ? `. ${locked} locked record${locked === 1 ? ' is' : 's are'} skipped` : ''}.`
    );
    if (!proceed) return;

    const applyTo = (list) => list.map(r =>
      (r.period_month === periodMonth && updates.has(r.coach_id))
        ? { ...r, ...updates.get(r.coach_id) }
        : r);
    setCurrentMonth(applyTo);
    setHistoricMonths(applyTo);

    logAudit("Month Pay Fixed For All",
      `Wrote ${periodMonth} pay onto ${updates.size} coach record(s); later months without their own figures now carry them.`);
    showToast(`${periodMonth} pay fixed for ${updates.size} coach${updates.size === 1 ? '' : 'es'} — later months now carry it.`, "success");
  };

  const savePayOverrides = (coachId, periodMonth, { base, rate }) => {
    const coach = coaches.find(c => c.id === coachId);
    if (!coach) return;
    if (!PROFILE_PAY_ROLES.includes(currentRole)) {
      showToast("Your role cannot change what a coach is paid.", "error");
      return;
    }
    const record = [...currentMonth, ...historicMonths]
      .find(r => r.coach_id === coachId && r.period_month === periodMonth);
    if (!record) {
      showToast("That month has no score card to set pay against.", "error");
      return;
    }
    if (record.status === 'FINANCE_LOCKED') {
      showToast(`${periodMonth} is locked — unlock it to change what it pays.`, "error");
      return;
    }

    const lines = [
      `Fixed pay: ${base === null ? 'band rate' : `₹${base.toLocaleString('en-IN')}`}`,
      `Per-session rate: ${rate === null ? 'band rate' : `₹${rate.toLocaleString('en-IN')}`}`
    ].join('\n');
    const proceed = window.confirm(
      `Set what ${coach.name} is paid for ${periodMonth}?\n\n${lines}\n\n` +
      `${periodMonth} and every month after it carry these figures, until a ` +
      `later month is given its own. Months before ${periodMonth} are untouched.`
    );
    if (!proceed) return;

    const applyTo = (list) => list.map(r =>
      (r.coach_id === coachId && r.period_month === periodMonth)
        ? { ...r, fixed_pay_override: base, per_session_override: rate }
        : r);
    setCurrentMonth(applyTo);
    setHistoricMonths(applyTo);

    logAudit("Month Pay Set",
      `Set ${periodMonth} pay for ${coach.name} (${coach.id}) — ${lines.replace(/\n/g, '; ')}`);
    showToast(`Saved. ${coach.name}'s ${periodMonth} pay is set.`, "success");
  };

  /**
   * The bottom of the benchmark range a coach with no score starts against.
   * A new coach has no performance, so they benchmark into the entry band.
   */
  const entryBenchmark = (variantId, category) => {
    const vConfig = findVariant(variants, variantId);
    const rates = vConfig.rates?.[category]?.[PAY_BANDS[0].label];
    if (!rates) return { salary: null, rate: null };
    const salary = rates.min_fixed ?? null;
    const rate = category === 'Fixed'
      ? (salary != null ? fixedPerSessionRate(salary) : null)
      : (rates.per_session ?? null);
    return { salary, rate };
  };

  // -------------------------------------------------------------------------
  // Attendance & Leave
  // -------------------------------------------------------------------------

  /**
   * Which coach the signed-in person IS.
   *
   * Their linked coach record, normally. A Super Admin previewing the Coach
   * role has none, so one stands in — otherwise the preview only ever shows
   * the "not linked" message and there is no way to see what a coach sees.
   */
  const isPreviewingCoach = currentRole === 'Coach' && canSwitchRole && !profile?.coach_id;
  const selfCoachId = profile?.coach_id
    ?? (isPreviewingCoach ? (currentCoachContext || coaches[0]?.id || null) : null);

  /**
   * The coach whose attendance is on screen.
   *
   * A coach only ever sees their own. Everyone else opens one deliberately —
   * from the leave register, or the picker — rather than arriving on whichever
   * coach happened to be in context from another screen, which made the page
   * look like it was about that one person when it is about all of them.
   */
  const attendanceCoach = coaches.find(c => c.id === (
    currentRole === 'Coach' ? selfCoachId : attendanceCoachId
  )) || null;

  const todayWorkingDay = workingDayOf(new Date());

  const someoneLoggedIn = attendanceLogs.some(l => !l.logged_out_at);
  useEffect(() => {
    if (!someoneLoggedIn) return;
    const timer = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [someoneLoggedIn]);

  /** Hours as a clock — what is left of a day reads better counted down. */
  const asClock = (hours) => {
    const total = Math.max(0, Math.round((Number(hours) || 0) * 3600));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const sec = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  const logsFor = (coachId, day) => attendanceLogs
    .filter(l => l.coach_id === coachId && l.working_day === day)
    .sort((a, b) => new Date(a.logged_in_at) - new Date(b.logged_in_at));

  const openLogFor = (coachId) => attendanceLogs
    .find(l => l.coach_id === coachId && !l.logged_out_at) || null;

  const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /**
   * The coach's weekly off.
   *
   * A Flexi coach has none — any day with no availability is already an off
   * day for them, so a fixed one would be meaningless.
   */
  const isWeeklyOffFor = (coach, day) => {
    if (!coach || coach.coach_category === 'Flexi') return false;
    if (coach.weekly_off_day == null) return false;
    return new Date(`${day}T12:00:00`).getDay() === Number(coach.weekly_off_day);
  };

  /**
   * A published holiday falling on this day.
   *
   * A holiday with no centre applies to everyone; one naming a centre applies
   * only there, which is how a local holiday is added for a single place.
   */
  const holidayOn = (coach, day) => holidays.find(h =>
    h.holiday_date === day && (!h.centre_name || h.centre_name === coach?.centre_name)) || null;

  const availabilityHoursFor = (coach, day) => {
    // Nothing from the scheduling system yet, so the standard hours stand in
    // and the day is flagged rather than charged. This is the same path a real
    // outage takes, which is why it is not a special case.
    void day;
    return { hours: standardDailyHours(coach?.coach_category), missing: true };
  };

  /**
   * Distance between two points on the ground, in metres. The haversine
   * formula, because at a 200 metre radius the curvature matters less than
   * getting the latitude scaling right.
   */
  const metresBetween = (a, b) => {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  };

  /**
   * Whether this coach may log in from where they are.
   *
   * A remote coach may log in from anywhere. A centre coach must be within
   * 200 metres of their centre — but only when both the centre's position and
   * the coach's are known. A refused or unavailable location does not block
   * the login; it is recorded as unverified, because a coach standing in their
   * own studio with location switched off is not committing a violation.
   */
  const checkCentreProximity = (coach, pos) => {
    if (coach?.work_mode !== 'Centre') return { allowed: true, verified: true, metres: null };
    if (coach.centre_lat == null || coach.centre_lng == null) {
      return { allowed: true, verified: false, metres: null, why: 'no centre position on file' };
    }
    if (!pos) return { allowed: true, verified: false, metres: null, why: 'location not available' };
    const metres = metresBetween(pos, { lat: Number(coach.centre_lat), lng: Number(coach.centre_lng) });
    return {
      allowed: metres <= CENTRE_RADIUS_METRES,
      verified: true,
      metres,
      why: metres <= CENTRE_RADIUS_METRES ? null
        : `${metres} m from ${coach.centre_name || 'the centre'}, and the limit is ${CENTRE_RADIUS_METRES} m`
    };
  };

  /**
   * Take the login photograph.
   *
   * Opens the camera and waits for the shot. Resolves to null if the camera is
   * refused or unavailable, and the login carries on without one — a coach
   * whose webcam is broken still has to be able to start work. Whether that
   * matters is for the Reporting Manager reviewing the day, not for the login.
   *
   * A frame that is almost entirely dark is refused, which is the "no face
   * detected" check: there is no face matching here, only a test that the
   * lens was not covered.
   */
  const capturePhoto = (coach) => new Promise((resolve) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      resolve({ failed: 'This browser cannot reach a camera' });
      return;
    }
    setPhotoCapture({ coach, resolve });
  });

  const closeCapture = (result) => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    photoCapture?.resolve?.(result ?? { cancelled: true });
    setPhotoCapture(null);
  };

  useEffect(() => {
    if (!photoCapture) return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 } })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
      })
      .catch(() => {
        closeCapture({ failed: 'The camera could not be opened — check the browser has permission' });
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoCapture]);

  const takeShot = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Mean brightness. A covered lens or an unlit room reads near zero, and a
    // photograph of nothing is not a record of anything.
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let total = 0;
    for (let i = 0; i < data.length; i += 4 * 64) {
      total += (data[i] + data[i + 1] + data[i + 2]) / 3;
    }
    const mean = total / (data.length / (4 * 64));
    if (mean < 18) {
      loginFailures.current += 1;
      setPhotoCapture(c => c && { ...c, attempts: loginFailures.current });
      showToast(
        `No face detected — the frame is too dark. Try again in better light.` +
        `${loginFailures.current >= LOGIN_FAILURES_BEFORE_SKIP
          ? ' You can now log in without one.' : ''}`, "error");
      return;
    }

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.75));
    closeCapture({ blob });
  };

  /** Where the browser says we are. Refused or unavailable is not an error. */
  const readPosition = () => new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { timeout: 8000, maximumAge: 60000 }
    );
  });

  const handleAttendanceLogin = async (coach) => {
    if (!coach) return;
    if (openLogFor(coach.id)) {
      showToast("Already logged in — log out first.", "warning");
      return;
    }

    const mayGoWithout = () => loginFailures.current >= LOGIN_FAILURES_BEFORE_SKIP;

    // Location first: it is cheaper to obtain than a photograph, and there is
    // no sense taking one only to be turned away for being in the wrong place.
    const pos = await readPosition();
    if (!pos && !mayGoWithout()) {
      loginFailures.current += 1;
      showToast(
        `Location is required to log in. Allow it for this site and try again.` +
        ` (${loginFailures.current} of ${LOGIN_FAILURES_BEFORE_SKIP} — after that you can log in without it.)`,
        "error");
      return;
    }

    const shot = await capturePhoto(coach);
    if (shot?.failed) {
      loginFailures.current += 1;
      showToast(
        `${shot.failed}.` +
        ` (${loginFailures.current} of ${LOGIN_FAILURES_BEFORE_SKIP} — after that you can log in without one.)`,
        "error");
      return;
    }
    // Closing the camera is only allowed to mean "go on without" once the
    // failures have earned it; otherwise it is a cancelled login.
    if (shot?.cancelled && !mayGoWithout()) {
      showToast("A photograph is required to log in.", "warning");
      return;
    }
    const blob = shot?.blob ?? null;

    const proximity = checkCentreProximity(coach, pos);
    if (!proximity.allowed) {
      showToast(`Cannot log in — ${proximity.why}.`, "error");
      logAudit("Attendance Login Refused",
        `${coach.name} (${coach.id}) tried to log in ${proximity.why}.`);
      return;
    }
    const now = new Date();
    const expiry = new Date(now);
    expiry.setDate(expiry.getDate() + PHOTO_RETENTION_DAYS);

    // The image goes to the bucket; only its path is kept on the row. A failed
    // upload does not fail the login — the attendance matters more than the
    // evidence of it.
    let photoPath = null;
    if (blob) {
      try {
        photoPath = await uploadAttendancePhoto(coach.id, now, blob);
      } catch (e) {
        console.error("Photo upload failed", e);
        // A photograph that did not reach the bucket is a failure like any
        // other, and the login does not go through on it unless the coach has
        // already run out of attempts.
        if (!mayGoWithout()) {
          loginFailures.current += 1;
          showToast(
            `The photograph could not be saved — ${e.message}.` +
            ` (${loginFailures.current} of ${LOGIN_FAILURES_BEFORE_SKIP} — after that you can log in without one.)`,
            "error");
          return;
        }
        showToast("Logged in, but the photograph could not be saved.", "warning");
      }
    }

    // A clean login resets the count, so the allowance is three failures in a
    // row rather than three across the week.
    loginFailures.current = 0;

    setAttendanceLogs(prev => [{
      id: (crypto?.randomUUID?.() || `ATT_${Date.now()}`),
      coach_id: coach.id,
      working_day: workingDayOf(now),
      logged_in_at: now.toISOString(),
      logged_out_at: null,
      login_lat: pos?.lat ?? null,
      login_lng: pos?.lng ?? null,
      within_centre: proximity.verified ? proximity.allowed : null,
      photo_path: photoPath,
      photo_expires_at: photoPath ? expiry.toISOString().slice(0, 10) : null,
      auto_logged_out: false
    }, ...prev]);

    logAudit("Attendance Login",
      `${coach.name} (${coach.id}) logged in` +
      (pos ? ` at ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : ' with no location') +
      (proximity.metres != null ? ` — ${proximity.metres} m from the centre` : '') +
      (photoPath ? '' : ' — no photograph') + '.');
    showToast(
      `Logged in at ${now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}` +
      (photoPath && pos ? '.' : ` — ${[!photoPath && 'no photograph', !pos && 'no location'].filter(Boolean).join(', ')}.`),
      photoPath && pos ? "success" : "warning");
  };

  const handleAttendanceLogout = async (coach) => {
    const open = openLogFor(coach?.id);
    if (!open) {
      showToast("Not logged in.", "warning");
      return;
    }
    const pos = await readPosition();
    if (!pos && loginFailures.current < LOGIN_FAILURES_BEFORE_SKIP) {
      loginFailures.current += 1;
      showToast(
        `Location is required to log out. Allow it for this site and try again.` +
        ` (${loginFailures.current} of ${LOGIN_FAILURES_BEFORE_SKIP} — after that you can log out without it.)`,
        "error");
      return;
    }
    loginFailures.current = 0;
    const now = new Date();
    const minutes = (now - new Date(open.logged_in_at)) / 60000;

    setAttendanceLogs(prev => prev.map(l => l.id === open.id
      ? { ...l, logged_out_at: now.toISOString(), logout_lat: pos?.lat ?? null, logout_lng: pos?.lng ?? null }
      : l));

    logAudit("Attendance Logout",
      `${coach.name} (${coach.id}) logged out after ${Math.round(minutes)} minutes` +
      (pos ? ` at ${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}` : ' with no location') + '.');
    showToast(minutes < MIN_LOGIN_MINUTES
      ? `Logged out. Under ${MIN_LOGIN_MINUTES} minutes, so this period does not count.`
      : `Logged out. ${(minutes / 60).toFixed(2)} hours recorded.`,
      minutes < MIN_LOGIN_MINUTES ? "warning" : "info");
  };

  /**
   * Settle a day's attendance.
   *
   * Assessment on its own changes nothing — this is what writes the outcome
   * down. A small shortfall becomes a punctuality violation, charged by the
   * matrix at whichever occurrence it is this month; a large one becomes a day
   * of Loss of Pay on the score card, which payroll reads. The two never both
   * happen for one day, because they answer the same failure at different
   * sizes.
   *
   * A day flagged for review is settled as nothing: an availability outage is
   * not the coach's failure, and charging for it would make the system's own
   * unreliability expensive for them.
   */
  const settleAttendanceDay = (coach, workingDay) => {
    if (!coach) return;
    const already = attendanceDays.find(d => d.coach_id === coach.id && d.working_day === workingDay);
    if (already) {
      showToast(`${workingDay} has already been settled.`, "info");
      return;
    }

    const periods = logsFor(coach.id, workingDay);
    if (periods.some(l => !l.logged_out_at)) {
      showToast("Still logged in — log out before settling the day.", "warning");
      return;
    }

    const avail = availabilityHoursFor(coach, workingDay);
    const logged = loggedHoursForDay(periods);
    const covering = leaveApplications.filter(a =>
      a.coach_id === coach.id &&
      new Date(a.from_date) <= new Date(workingDay) && new Date(a.to_date) >= new Date(workingDay));
    const onLeave = covering.some(a => a.status === 'Approved');

    // A day with an undecided application on it is not settled at all. The
    // policy is explicit that a coach is not marked Loss of Pay while their
    // application waits — charging them for a delay that is the approver's
    // would make the deadline the coach's problem.
    const awaiting = covering.find(a => a.status === 'Pending');
    if (awaiting && !onLeave) {
      showToast(
        `${workingDay} has a ${leaveType(awaiting.type_id)?.label} application still waiting on a ` +
        `decision. Decide it first — nothing is charged until then.`, "warning");
      return;
    }

    // A weekly off or a published holiday is not a day anybody failed to work,
    // so it is settled as neither a violation nor Loss of Pay. Without this,
    // every weekend would read as an absence.
    const day = assessAttendanceDay({
      category: coach.coach_category,
      availabilityHours: avail.hours,
      loggedHours: logged,
      onApprovedLeave: onLeave,
      isWeeklyOff: isWeeklyOffFor(coach, workingDay),
      isHoliday: !!holidayOn(coach, workingDay),
      availabilityMissing: avail.missing
    });

    setAttendanceDays(prev => [...prev, {
      coach_id: coach.id, working_day: workingDay,
      expected_hours: day.expected ?? avail.hours,
      logged_hours: logged,
      shortfall_hours: day.shortfallHours,
      outcome: day.outcome,
      lop_days: day.lopDays,
      // Leave that was applied for is planned; simply not turning up is not.
      planned: onLeave,
      disputed: false
    }]);

    if (day.outcome === 'violation') {
      const occurrence = getViolationOccurrenceNumber(
        coach.id, SHORTFALL_VIOLATION, workingDay, violations) + 1;
      const consequence = getPenaltyConsequence(
        coach.variant_id, SHORTFALL_VIOLATION, occurrence, PENALTY_MATRIX);

      setViolations(prev => [...prev, {
        id: `VIO_${Date.now().toString().substring(7)}`,
        coach_id: coach.id,
        type: SHORTFALL_VIOLATION,
        occurrence_no: occurrence,
        consequence: consequence.consequence,
        penalty_amount: consequence.amount,
        incident_date: workingDay,
        incident_time: null,
        reported_by: 'System — attendance',
        evidence: `Logged ${logged} h against ${day.expected} h available; short by ${day.shortfallHours} h.`,
        status: 'Pending_Acknowledge'
      }]);

      logAudit("Attendance Shortfall Recorded",
        `${coach.name} (${coach.id}) short ${day.shortfallHours} h on ${workingDay} — ` +
        `occurrence #${occurrence}, ${consequence.consequence}.`);
      showToast(`Short by ${day.shortfallHours} h — recorded as occurrence #${occurrence}: ${consequence.consequence}.`, "warning");
      return;
    }

    if (day.lopDays > 0) {
      // Onto the cycle the day falls in, which payroll already reads from.
      const patch = (list) => list.map(r => {
        if (r.coach_id !== coach.id) return r;
        if (new Date(workingDay) < new Date(r.period_start) || new Date(workingDay) > new Date(r.period_end)) return r;
        return {
          ...r,
          lop_days: (Number(r.lop_days) || 0) + day.lopDays,
          unplanned_lop_days: (Number(r.unplanned_lop_days) || 0) + (onLeave ? 0 : day.lopDays)
        };
      });
      setCurrentMonth(patch);
      setHistoricMonths(patch);

      logAudit("Loss of Pay Recorded",
        `${coach.name} (${coach.id}) — ${day.lopDays} day Loss of Pay on ${workingDay} ` +
        `(logged ${logged} h of ${day.expected} h)${onLeave ? ', approved leave' : ', unplanned'}.`);
      showToast(`${day.lopDays} day of Loss of Pay recorded for ${workingDay}.`, "danger");
      return;
    }

    showToast(`${workingDay} settled — ${day.outcome === 'review' ? 'flagged for review, nothing charged' : 'nothing owed'}.`, "success");
  };

  /**
   * Who is away on a given day, and whether that leaves enough cover.
   *
   * The minimum is per discipline, because a day with four strength coaches
   * off and none of the yoga ones is not the same shortage as the reverse.
   * It warns rather than blocks — whether cover is adequate is the approver's
   * judgement, and the system does not have the context to overrule it.
   */
  const awayOn = (isoDay) => leaveApplications
    .filter(a => (a.status === 'Approved' || a.status === 'Pending' || a.status === 'Partially_Approved'))
    .filter(a => a.from_date <= isoDay && a.to_date >= isoDay)
    .map(a => ({ app: a, coach: coaches.find(c => c.id === a.coach_id) }))
    .filter(x => x.coach);

  const coverCheck = (isoDay) => {
    const away = awayOn(isoDay);
    const byDiscipline = new Map();
    for (const c of coaches.filter(x => x.status === 'Active')) {
      const d = c.coach_type || findVariant(variants, c.variant_id).discipline || 'Unassigned';
      if (!byDiscipline.has(d)) byDiscipline.set(d, { total: 0, off: 0 });
      byDiscipline.get(d).total += 1;
      if (away.some(a => a.coach.id === c.id)) byDiscipline.get(d).off += 1;
    }
    return [...byDiscipline.entries()].map(([discipline, n]) => ({
      discipline,
      working: n.total - n.off,
      off: n.off,
      total: n.total
    }));
  };

  /**
   * Open a coach from a row elsewhere on the screen.
   *
   * Selects them in the picker and brings their card into view, so a decision
   * made in the register can be followed straight into the attendance and
   * balance behind it, without hunting through the dropdown.
   */
  const openCoachOnAttendance = (coachId) => {
    setAttendanceCoachId(coachId);
    // After the re-render, or the card being scrolled to is the previous one.
    setTimeout(() => {
      document.getElementById('attendance-coach-card')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  /** Set or move a coach's weekly off. */
  const setWeeklyOff = (coach, dayIndex) => {
    if (!LEAVE_APPROVER_ROLES.includes(currentRole) && currentRole !== 'Showrunner') {
      showToast("Your role cannot change a coach's weekly off.", "error");
      return;
    }
    const value = dayIndex === '' ? null : Number(dayIndex);
    setCoaches(prev => prev.map(c => c.id === coach.id ? { ...c, weekly_off_day: value } : c));
    logAudit("Weekly Off Set",
      `${coach.name} (${coach.id}) weekly off ${value == null ? 'cleared' : `set to ${WEEKDAYS[value]}`}.`);
    showToast(value == null
      ? `${coach.name} has no weekly off.`
      : `${coach.name}'s weekly off is now ${WEEKDAYS[value]}.`, "success");
  };

  const addHoliday = () => {
    if (!PROFILE_PAY_ROLES.includes(currentRole)) {
      showToast("Only Human Resources publishes the holiday list.", "error");
      return;
    }
    const { date, name, centre } = holidayForm;
    if (!date || !name.trim()) {
      showToast("A holiday needs a date and a name.", "error");
      return;
    }
    if (holidays.some(h => h.holiday_date === date && (h.centre_name || '') === (centre || ''))) {
      showToast("That day is already on the list.", "warning");
      return;
    }
    const { year } = leaveYearFor(date);
    setHolidays(prev => [...prev, {
      id: (crypto?.randomUUID?.() || `HOL_${Date.now()}`),
      leave_year: year, holiday_date: date, name: name.trim(),
      centre_name: centre || null
    }]);
    logAudit("Holiday Published",
      `${name.trim()} on ${date}${centre ? ` for ${centre}` : ' for everyone'}.`);
    showToast(`${name.trim()} added.`, "success");
    setHolidayForm({ date: '', name: '', centre: '' });
  };

  /**
   * A template for the year's holidays.
   *
   * Pre-filled with whatever is already published, so the file is edited
   * rather than retyped — the same way the score card templates work. The two
   * example rows show both shapes: one for everybody, one for a single centre.
   */
  const downloadHolidayTemplate = () => {
    const { year } = leaveYearFor(new Date());
    const existing = holidays
      .filter(h => h.leave_year === year)
      .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date))
      .map(h => [h.holiday_date, h.name, h.centre_name || '']);

    const rows = existing.length ? existing : [
      [`${year}-01-26`, 'Republic Day', ''],
      [`${year}-08-15`, 'Independence Day', ''],
      [`${year}-04-14`, 'Local Holiday — example', 'HB+ Studio Indiranagar']
    ];

    const csv = [
      ['Date (YYYY-MM-DD)', 'Holiday name', 'Centre (blank = everyone)'],
      ...rows
    ].map(r => r.map(csvCell).join(',')).join('\n');

    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `holiday-list_${year}.csv`);
    showToast(existing.length
      ? `Template carries the ${existing.length} already published — edit and upload it back.`
      : 'Template downloaded with example rows. Replace them with the real list.', "info");
  };

  /**
   * Read an uploaded list and say what it would do before doing it.
   *
   * Nothing is written until it is accepted. A row already on the list is
   * marked as such rather than refused, because a template carries what is
   * published — re-uploading an edited file should not be an error.
   */
  const readHolidayFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      showToast("That file has a header and nothing else.", "error");
      return;
    }

    const { year } = leaveYearFor(new Date());
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const [rawDate, rawName, rawCentre] = parseCsvLine(lines[i]);
      const date = (rawDate || '').trim();
      const name = (rawName || '').trim();
      const centre = (rawCentre || '').trim();
      if (!date && !name) continue;

      let problem = null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) problem = 'Date must be YYYY-MM-DD';
      else if (Number.isNaN(new Date(`${date}T12:00:00`).getTime())) problem = 'Not a real date';
      else if (!name) problem = 'Needs a name';

      const duplicate = !problem && holidays.some(h =>
        h.holiday_date === date && (h.centre_name || '') === centre);
      const inFile = !problem && rows.some(r =>
        r.date === date && r.centre === centre);

      rows.push({
        line: i + 1, date, name, centre,
        problem,
        duplicate: duplicate || inFile,
        year: problem ? null : leaveYearFor(date).year
      });
    }

    setHolidayPreview({ fileName: file.name, rows, year });
  };

  const applyHolidayPreview = () => {
    const pv = holidayPreview;
    if (!pv) return;
    const adding = pv.rows.filter(r => !r.problem && !r.duplicate);
    if (adding.length === 0) {
      showToast("Nothing new in that file.", "info");
      setHolidayPreview(null);
      return;
    }

    setHolidays(prev => [...prev, ...adding.map(r => ({
      id: (crypto?.randomUUID?.() || `HOL_${Date.now()}_${r.line}`),
      leave_year: r.year,
      holiday_date: r.date,
      name: r.name,
      centre_name: r.centre || null
    }))]);

    const skipped = pv.rows.length - adding.length;
    logAudit("Holiday List Imported",
      `${adding.length} holiday(s) added from ${pv.fileName}` +
      `${skipped ? `; ${skipped} skipped` : ''}.`);
    showToast(`${adding.length} holiday${adding.length === 1 ? '' : 's'} added` +
      `${skipped ? `, ${skipped} skipped` : ''}.`, "success");
    setHolidayPreview(null);
  };

  const removeHoliday = (holiday) => {
    if (!PROFILE_PAY_ROLES.includes(currentRole)) return;
    if (!window.confirm(`Remove ${holiday.name} on ${holiday.holiday_date}?\n\nDays already settled against it are not revisited.`)) return;
    setHolidays(prev => prev.filter(h => h.id !== holiday.id));
    logAudit("Holiday Removed", `${holiday.name} on ${holiday.holiday_date} removed from the list.`);
    showToast("Removed.", "info");
  };

  /**
   * The four reports a cycle needs. CSV rather than a screen, because they are
   * read in a spreadsheet alongside figures from elsewhere — and a figure that
   * cannot leave the system is a figure nobody checks.
   */
  const downloadAttendanceReport = (kind) => {
    const { year } = leaveYearFor(new Date());
    const period = currentMonth[0];
    const inCycle = (d) => period && d >= period.period_start && d <= period.period_end;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    let rows = [];
    let name = '';

    if (kind === 'attendance') {
      name = `attendance-summary_${currentPeriodMonth}`;
      rows.push(['Coach ID', 'Name', 'Category', 'Days logged', 'Hours logged',
        'Days short', 'LOP days', 'Logins without a photo', 'Logins outside the centre']);
      for (const c of coaches.filter(x => x.status === 'Active')) {
        const days = attendanceDays.filter(d => d.coach_id === c.id && inCycle(d.working_day));
        const logs = attendanceLogs.filter(l => l.coach_id === c.id && inCycle(l.working_day));
        const hours = [...new Set(logs.map(l => l.working_day))]
          .reduce((sum, d) => sum + loggedHoursForDay(logsFor(c.id, d)), 0);
        rows.push([c.id, c.name, c.coach_category,
          new Set(logs.map(l => l.working_day)).size,
          hours.toFixed(2),
          days.filter(d => d.outcome === 'violation').length,
          days.reduce((s, d) => s + (Number(d.lop_days) || 0), 0),
          logs.filter(l => !l.photo_path).length,
          logs.filter(l => l.within_centre === false).length]);
      }
    }

    if (kind === 'balances') {
      name = `leave-balances_${year}`;
      rows.push(['Coach ID', 'Name', 'Leave type', 'Opening', 'Accrued', 'Used', 'Adjusted', 'Available']);
      for (const c of coaches.filter(x => x.status === 'Active')) {
        for (const t of leaveTypesFor(c).filter(x => x.id !== 'LOP')) {
          const b = leaveBalanceFor(c, t.id);
          rows.push([c.id, c.name, t.label, b.opening, b.accrued, b.used, b.adjusted, b.available]);
        }
      }
    }

    if (kind === 'lop') {
      name = `loss-of-pay_${currentPeriodMonth}`;
      rows.push(['Coach ID', 'Name', 'Date', 'Outcome', 'Expected h', 'Logged h', 'LOP days', 'Planned']);
      for (const d of attendanceDays.filter(x => inCycle(x.working_day) && Number(x.lop_days) > 0)) {
        const c = coaches.find(x => x.id === d.coach_id);
        rows.push([d.coach_id, c?.name || '', d.working_day, d.outcome,
          d.expected_hours, d.logged_hours, d.lop_days, d.planned ? 'Planned' : 'Unplanned']);
      }
    }

    if (kind === 'penalties') {
      name = `attendance-penalties_${currentPeriodMonth}`;
      rows.push(['Coach ID', 'Name', 'Date', 'Violation', 'Occurrence', 'Consequence', 'Charged']);
      for (const v of violations.filter(x => x.reported_by === 'System — attendance' && inCycle(x.incident_date))) {
        const c = coaches.find(x => x.id === v.coach_id);
        rows.push([v.coach_id, c?.name || '', v.incident_date, v.type,
          v.occurrence_no, v.consequence, isPenaltyChargeable(v) ? v.penalty_amount : 0]);
      }
    }

    if (rows.length <= 1) {
      showToast("Nothing to report for this cycle yet.", "info");
      return;
    }
    const csv = rows.map(r => r.map(esc).join(',')).join('\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${name}.csv`);
    logAudit("Attendance Report Downloaded", `${name} — ${rows.length - 1} row(s).`);
    showToast(`${rows.length - 1} row${rows.length === 2 ? '' : 's'} downloaded.`, "success");
  };

  /** The photographs a chosen batch covers. */
  const photoBatchLogs = () => attendanceLogs
    .filter(l => l.photo_path)
    .filter(l => photoBatch.coach === 'All' || l.coach_id === photoBatch.coach)
    .filter(l => !photoBatch.from || l.working_day >= photoBatch.from)
    .filter(l => !photoBatch.to || l.working_day <= photoBatch.to)
    .sort((a, b) => new Date(a.logged_in_at) - new Date(b.logged_in_at));

  /**
   * Download a batch of login photographs as one archive.
   *
   * Signed in blocks rather than all at once, because a batch may run to
   * hundreds and a single request for all of them is refused. Anything that
   * cannot be fetched is named in the result instead of being left out
   * silently — an archive quietly short of what was asked for is worse than
   * one that says what is missing.
   */
  const downloadPhotoBatch = async () => {
    if (!PROFILE_PAY_ROLES.includes(currentRole) && currentRole !== 'Reporting Manager') {
      showToast("Your role cannot download attendance photographs.", "error");
      return;
    }
    const logs = photoBatchLogs();
    if (logs.length === 0) {
      showToast("No photographs in that batch.", "info");
      return;
    }

    setPhotoBusy(`Preparing ${logs.length} photograph${logs.length === 1 ? '' : 's'}…`);
    try {
      const files = [];
      const missing = [];
      const BLOCK = 50;

      for (let i = 0; i < logs.length; i += BLOCK) {
        const block = logs.slice(i, i + BLOCK);
        setPhotoBusy(`Fetching ${Math.min(i + BLOCK, logs.length)} of ${logs.length}…`);
        const urls = await signedPhotoUrls(block.map(l => l.photo_path));

        await Promise.all(urls.map(async (url, n) => {
          const log = block[n];
          const coach = coaches.find(c => c.id === log.coach_id);
          if (!url) { missing.push(log.photo_path); return; }
          try {
            const res = await fetch(url);
            if (!res.ok) { missing.push(log.photo_path); return; }
            const bytes = new Uint8Array(await res.arrayBuffer());
            const when = new Date(log.logged_in_at);
            const safe = (coach?.name || log.coach_id).replace(/[^\w .-]/g, '');
            files.push({
              // Foldered by coach so an archive of several is navigable, and
              // named by the moment it was taken so order survives extraction.
              name: `${log.coach_id} ${safe}/${log.working_day}_` +
                `${String(when.getHours()).padStart(2, '0')}${String(when.getMinutes()).padStart(2, '0')}.jpg`,
              data: bytes,
              date: when
            });
          } catch { missing.push(log.photo_path); }
        }));
      }

      if (files.length === 0) {
        showToast("None of those photographs could be fetched. Check that the storage bucket exists.", "error");
        return;
      }

      setPhotoBusy('Building the archive…');
      const label = photoBatch.coach === 'All' ? 'all-coaches' : photoBatch.coach;
      const span = [photoBatch.from || 'start', photoBatch.to || 'today'].join('_to_');
      downloadBlob(buildZip(files), `attendance-photos_${label}_${span}.zip`);

      logAudit("Attendance Photos Downloaded",
        `Downloaded ${files.length} login photograph(s) — ${label}, ${span}` +
        `${missing.length ? `; ${missing.length} could not be fetched` : ''}.`);
      showToast(
        `${files.length} photograph${files.length === 1 ? '' : 's'} downloaded` +
        `${missing.length ? `, ${missing.length} could not be fetched` : ''}.`,
        missing.length ? "warning" : "success");
    } catch (e) {
      console.error("Photo batch failed", e);
      showToast(`Could not build the archive — ${e.message}`, "error");
    } finally {
      setPhotoBusy("");
    }
  };

  /** Remove photographs past their keep-until date, which is 180 days. */
  const purgeExpiredPhotos = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const stale = attendanceLogs.filter(l => l.photo_path && l.photo_expires_at && l.photo_expires_at < today);
    if (stale.length === 0) {
      showToast(`Nothing past its ${PHOTO_RETENTION_DAYS} days.`, "info");
      return;
    }
    const proceed = window.confirm(
      `Delete ${stale.length} photograph${stale.length === 1 ? '' : 's'} kept longer than ` +
      `${PHOTO_RETENTION_DAYS} days?\n\nThe attendance records stay; only the images go, and they cannot be recovered.`
    );
    if (!proceed) return;

    try {
      await deleteAttendancePhotos(stale.map(l => l.photo_path));
      const ids = new Set(stale.map(l => l.id));
      setAttendanceLogs(prev => prev.map(l =>
        ids.has(l.id) ? { ...l, photo_path: null, photo_expires_at: null } : l));
      logAudit("Attendance Photos Purged",
        `Deleted ${stale.length} login photograph(s) past ${PHOTO_RETENTION_DAYS} days.`);
      showToast(`${stale.length} photograph${stale.length === 1 ? '' : 's'} deleted.`, "success");
    } catch (e) {
      showToast(`Could not delete — ${e.message}`, "error");
    }
  };

  /** Balance for one leave type: opening, plus accrued, less what is spent. */
  const leaveBalanceFor = (coach, typeId) => {
    const { year } = leaveYearFor(new Date());
    const row = leaveBalances.find(b =>
      b.coach_id === coach?.id && b.leave_year === year && b.type_id === typeId) || {};
    const eligibleFrom = coach?.probation_end_date || coach?.date_of_joining || null;

    // Holiday Leave is not accrued — the published list is the entitlement, so
    // what a coach may take is simply how many holidays apply to them. Updating
    // the list changes it for everyone at once, which is the point of it.
    const holidaysForCoach = holidays.filter(h => h.leave_year === year
      && (!h.centre_name || h.centre_name === coach?.centre_name)).length;

    const accrued = leaveType(typeId)?.holidayOnly
      ? holidaysForCoach
      : (row.accrued != null
        ? Number(row.accrued)
        : accruedDays(typeId, { eligibleFrom, asOf: new Date() }));
    const opening = Number(row.opening) || 0;
    const used = Number(row.used) || 0;
    const adjusted = Number(row.adjusted) || 0;
    return {
      year, opening, accrued, used, adjusted,
      available: Math.round((opening + accrued + adjusted - used) * 10) / 10
    };
  };

  /**
   * Leave days between two dates, for this coach.
   *
   * A weekly off or a published holiday inside the span is not leave — the
   * coach was not due to work it, so spending a day's balance on it would
   * charge them for a day nobody expected them. Counting the plain calendar
   * span is what makes a Friday-to-Monday absence cost four days instead of
   * two.
   */
  const leaveDaysFor = (coach, from, to, typeId = null) => {
    if (!from || !to) return { days: 0, skipped: [], nonHolidayDates: [] };
    const start = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    if (end < start) return { days: 0, skipped: [], nonHolidayDates: [] };

    // Holiday Leave is the inverse of every other type: it claims the holidays
    // in the span, where the rest claim the working days around them.
    const holidayOnly = Boolean(leaveType(typeId)?.holidayOnly);

    let days = 0;
    const skipped = [];
    const nonHolidayDates = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const holiday = holidayOn(coach, iso);

      if (holidayOnly) {
        if (holiday) days += 1;
        else nonHolidayDates.push(iso);
        continue;
      }

      if (isWeeklyOffFor(coach, iso)) { skipped.push(`${iso} (weekly off)`); continue; }
      if (holiday) { skipped.push(`${iso} (${holiday.name})`); continue; }
      days += 1;
    }
    return { days, skipped, nonHolidayDates };
  };

  const daysBetween = (from, to) => {
    if (!from || !to) return 0;
    const d = Math.floor((new Date(to) - new Date(from)) / 86400000) + 1;
    return d > 0 ? d : 0;
  };

  const handleLeaveApply = (coach) => {
    if (!coach) return;
    const { type, from, to, halfDay, reason } = leaveForm;
    if (!from || !to) {
      showToast("Choose the dates the leave runs from and to.", "error");
      return;
    }
    const counted = leaveDaysFor(coach, from, to, type);
    const days = halfDay ? 0.5 : counted.days;
    if (days === 0) {
      showToast(leaveType(type)?.holidayOnly
        ? "None of those dates is a published holiday."
        : "Every day in that span is a weekly off or a holiday — there is no leave to apply for.",
        "warning");
      return;
    }
    const balance = leaveBalanceFor(coach, type).available;
    const check = checkLeaveApplication({
      typeId: type, coach, from, days, balance, nonHolidayDates: counted.nonHolidayDates
    });

    if (!check.ok) {
      // A Reporting Manager may grant beyond the balance where they judge it
      // right; the coach cannot grant it to themselves, which is the whole
      // point of the limit.
      const overBalanceOnly = check.problems.length === 1 && check.problems[0].includes('left, and');
      if (overBalanceOnly && LEAVE_APPROVER_ROLES.includes(currentRole)) {
        const grant = window.confirm(
          `${check.problems[0]}\n\nGrant it beyond the balance anyway? ` +
          `This is recorded against you in the audit log.`);
        if (!grant) return;
        logAudit("Leave Granted Beyond Balance",
          `${currentRole} granted ${days} day(s) ${leaveType(type)?.label} to ${coach.name} ` +
          `(${coach.id}) beyond a balance of ${balance}.`);
      } else {
        showToast(check.problems[0], "error");
        return;
      }
    }

    // Clashes do not block the application; they warn, because cover is the
    // approver's decision rather than the system's.
    const clash = leaveApplications.filter(a =>
      a.status !== 'Rejected' && a.status !== 'Cancelled' &&
      a.coach_id !== coach.id &&
      new Date(a.from_date) <= new Date(to) && new Date(a.to_date) >= new Date(from)
    );
    if (clash.length > 0) {
      const names = clash.map(a => coaches.find(c => c.id === a.coach_id)?.name || a.coach_id);
      const proceed = window.confirm(
        `${clash.length} other coach${clash.length === 1 ? ' is' : 'es are'} on leave over these dates:\n\n` +
        `${[...new Set(names)].join(', ')}\n\nApply anyway?`
      );
      if (!proceed) return;
    }

    // Debited now, returned if it is refused, so a pending application cannot
    // be spent twice over.
    const { year } = leaveYearFor(new Date());
    setLeaveBalances(prev => {
      const i = prev.findIndex(b => b.coach_id === coach.id && b.leave_year === year && b.type_id === type);
      if (i === -1) {
        return [...prev, { coach_id: coach.id, leave_year: year, type_id: type,
          opening: 0, accrued: leaveBalanceFor(coach, type).accrued, used: days, adjusted: 0 }];
      }
      return prev.map((b, n) => n === i ? { ...b, used: (Number(b.used) || 0) + days } : b);
    });

    setLeaveApplications(prev => [{
      id: (crypto?.randomUUID?.() || `LV_${Date.now()}`),
      coach_id: coach.id, type_id: type,
      from_date: from, to_date: to, days, half_day: halfDay,
      reason: reason || null, status: 'Pending',
      applied_at: new Date().toISOString(),
      applied_by: currentRole === 'Coach' ? null : currentRole
    }, ...prev]);

    logAudit("Leave Applied",
      `${coach.name} (${coach.id}) applied for ${days} day(s) ${leaveType(type)?.label} from ${from} to ${to}` +
      `${counted.skipped.length ? `; not counted: ${counted.skipped.join(', ')}` : ''}.`);
    showToast(
      `Applied for ${days} day${days === 1 ? '' : 's'}` +
      `${counted.skipped.length ? ` — ${counted.skipped.length} day(s) in the span not counted` : ''}` +
      ` — waiting on the Reporting Manager.`, "success");
    setLeaveForm({ type: 'PAID', from: '', to: '', halfDay: false, reason: '' });
  };

  /**
   * Approve part of an application and refuse the rest.
   *
   * The days not approved come back to the balance, and the comment is
   * required: a coach told that four of their six days were refused is owed
   * the reason more than one refused outright, because the decision looks
   * arbitrary without it.
   */
  const handlePartialApproval = (application) => {
    if (!LEAVE_APPROVER_ROLES.includes(currentRole)) return;
    const coach = coaches.find(c => c.id === application.coach_id);

    const raw = window.prompt(
      `${coach?.name || application.coach_id} asked for ${application.days} day(s) ` +
      `${leaveType(application.type_id)?.label}, ${application.from_date} to ${application.to_date}.\n\n` +
      `How many days are you approving?`,
      String(application.days));
    if (raw === null) return;

    const approved = Number(raw);
    if (!Number.isFinite(approved) || approved <= 0 || approved > Number(application.days)) {
      showToast(`Enter a number between 0.5 and ${application.days}.`, "error");
      return;
    }
    if (approved === Number(application.days)) {
      handleLeaveDecision(application, 'Approved');
      return;
    }

    const note = window.prompt(
      `Why are the other ${Math.round((application.days - approved) * 10) / 10} day(s) refused? ` +
      `The coach sees this.`);
    if (!note || !note.trim()) {
      showToast("Refusing part of an application needs a reason.", "error");
      return;
    }

    const returned = Math.round((Number(application.days) - approved) * 10) / 10;
    setLeaveApplications(prev => prev.map(a => a.id === application.id
      ? { ...a, status: 'Partially_Approved', approved_days: approved,
          decided_by: currentRole, decided_at: new Date().toISOString(), decision_note: note.trim() }
      : a));
    setLeaveBalances(prev => prev.map(b =>
      (b.coach_id === application.coach_id && b.type_id === application.type_id)
        ? { ...b, used: Math.max(0, (Number(b.used) || 0) - returned) }
        : b));

    logAudit("Leave Partially Approved",
      `${approved} of ${application.days} day(s) ${leaveType(application.type_id)?.label} approved for ` +
      `${coach?.name || application.coach_id}; ${returned} returned — ${note.trim()}`);
    showToast(`${approved} day(s) approved, ${returned} returned to the balance.`, "info");
  };

  /**
   * Change what kind of leave this is, which is how a refused Paid Leave
   * becomes Loss of Pay rather than a flat no. The old type's balance is
   * returned and the new one charged, so neither is left wrong.
   */
  const handleLeaveTypeChange = (application) => {
    if (!LEAVE_APPROVER_ROLES.includes(currentRole)) return;
    const coach = coaches.find(c => c.id === application.coach_id);
    const options = applicableLeaveTypes(coach).filter(t => t.id !== application.type_id);

    const raw = window.prompt(
      `Change ${leaveType(application.type_id)?.label} to which type?\n\n` +
      options.map((t, i) => `${i + 1}. ${t.label}`).join('\n') +
      `\n\nEnter a number.`);
    if (raw === null) return;
    const picked = options[Number(raw) - 1];
    if (!picked) { showToast("That is not one of the options.", "error"); return; }

    const note = window.prompt(
      `Why is this becoming ${picked.label}? The coach is told, and sees this.`);
    if (!note || !note.trim()) {
      showToast("Changing the leave type needs a reason.", "error");
      return;
    }

    const days = Number(application.days);
    setLeaveBalances(prev => {
      // Back to the type it came from, charged to the one it became.
      let next = prev.map(b => (b.coach_id === application.coach_id && b.type_id === application.type_id)
        ? { ...b, used: Math.max(0, (Number(b.used) || 0) - days) } : b);
      const { year } = leaveYearFor(new Date());
      const i = next.findIndex(b => b.coach_id === application.coach_id
        && b.leave_year === year && b.type_id === picked.id);
      if (i === -1) {
        next = [...next, { coach_id: application.coach_id, leave_year: year, type_id: picked.id,
          opening: 0, accrued: leaveBalanceFor(coach, picked.id).accrued, used: days, adjusted: 0 }];
      } else {
        next = next.map((b, n) => n === i ? { ...b, used: (Number(b.used) || 0) + days } : b);
      }
      return next;
    });

    setLeaveApplications(prev => prev.map(a => a.id === application.id
      ? { ...a, type_id: picked.id, status: 'Approved', approved_days: days,
          decided_by: currentRole, decided_at: new Date().toISOString(),
          decision_note: `Changed from ${leaveType(application.type_id)?.label} — ${note.trim()}` }
      : a));

    logAudit("Leave Type Changed",
      `${coach?.name || application.coach_id}: ${leaveType(application.type_id)?.label} → ${picked.label} ` +
      `for ${days} day(s) — ${note.trim()}`);
    showToast(`Approved as ${picked.label}. The coach is told why.`, "info");
  };

  const handleLeaveDecision = (application, decision) => {
    if (!LEAVE_APPROVER_ROLES.includes(currentRole)) {
      showToast("Your role cannot decide leave applications.", "error");
      return;
    }
    // A refusal has to be explained — it is the one decision the coach cannot
    // see the reasoning behind, and it can be appealed.
    let note = null;
    if (decision === 'Rejected') {
      note = window.prompt("Why is this being rejected? The coach sees this, and may appeal it.");
      if (!note || !note.trim()) {
        showToast("A rejection needs a reason.", "error");
        return;
      }
    }

    const coach = coaches.find(c => c.id === application.coach_id);
    setLeaveApplications(prev => prev.map(a => a.id === application.id
      ? { ...a, status: decision, decided_by: currentRole, decided_at: new Date().toISOString(),
          decision_note: note, approved_days: decision === 'Approved' ? a.days : 0 }
      : a));

    // Refused days go back to the balance they were taken from.
    if (decision === 'Rejected') {
      setLeaveBalances(prev => prev.map(b =>
        (b.coach_id === application.coach_id && b.type_id === application.type_id)
          ? { ...b, used: Math.max(0, (Number(b.used) || 0) - Number(application.days)) }
          : b));
    }

    logAudit(`Leave ${decision}`,
      `${decision} ${application.days} day(s) ${leaveType(application.type_id)?.label} for ` +
      `${coach?.name || application.coach_id}${note ? ` — ${note}` : ''}.`);
    showToast(`Leave ${decision.toLowerCase()}.`, decision === 'Approved' ? "success" : "warning");
  };

  /**
   * Correct a balance by hand.
   *
   * Opening balances come from a sheet and sheets are wrong sometimes; so is
   * accrual when someone's eligibility date was keyed late. The adjustment is
   * kept as its own figure rather than folded into `accrued`, so the balance
   * still shows what the policy gave and what a person changed, separately.
   */
  const adjustLeaveBalance = (coach, typeId) => {
    if (!PROFILE_PAY_ROLES.includes(currentRole)) {
      showToast("Only Human Resources adjusts a balance.", "error");
      return;
    }
    const current = leaveBalanceFor(coach, typeId);
    const raw = window.prompt(
      `${coach.name} — ${leaveType(typeId)?.label}\n\n` +
      `Opening ${current.opening}, accrued ${current.accrued}, used ${current.used}` +
      `${current.adjusted ? `, adjusted ${current.adjusted}` : ''} — available ${current.available}.\n\n` +
      `Adjust by how many days? A negative number takes days away.`,
      '0');
    if (raw === null) return;
    const delta = Number(raw);
    if (!Number.isFinite(delta) || delta === 0) {
      showToast("Enter a number of days, positive or negative.", "error");
      return;
    }

    const reason = window.prompt("Why? This is required, and goes on the audit log.");
    if (!reason || !reason.trim()) {
      showToast("An adjustment needs a reason.", "error");
      return;
    }

    const { year } = leaveYearFor(new Date());
    setLeaveBalances(prev => {
      const i = prev.findIndex(b => b.coach_id === coach.id && b.leave_year === year && b.type_id === typeId);
      if (i === -1) {
        return [...prev, { coach_id: coach.id, leave_year: year, type_id: typeId,
          opening: 0, accrued: current.accrued, used: 0, adjusted: delta, adjust_reason: reason.trim() }];
      }
      return prev.map((b, n) => n === i
        ? { ...b, adjusted: Math.round(((Number(b.adjusted) || 0) + delta) * 10) / 10,
            adjust_reason: reason.trim() }
        : b);
    });

    logAudit("Leave Balance Adjusted",
      `${coach.name} (${coach.id}) ${leaveType(typeId)?.label} adjusted by ${delta > 0 ? '+' : ''}${delta} ` +
      `day(s) — ${reason.trim()}`);
    showToast(`${leaveType(typeId)?.label} adjusted by ${delta > 0 ? '+' : ''}${delta}.`, "success");
  };

  /** Raise a rejected leave decision as an appeal, through the existing route. */
  const appealLeaveDecision = (application) => {
    const coach = coaches.find(c => c.id === application.coach_id);
    const grounds = window.prompt(
      `Appeal the decision on ${leaveType(application.type_id)?.label}, ` +
      `${application.from_date} to ${application.to_date}.\n\n` +
      `Reason given: ${application.decision_note || '—'}\n\nWhy should it be looked at again?`);
    if (!grounds || !grounds.trim()) return;

    setAppeals(prev => [{
      id: `APL_${Date.now().toString().substring(7)}`,
      coach_id: application.coach_id,
      violation_id: null,
      reason: `Leave decision — ${leaveType(application.type_id)?.label} ` +
        `${application.from_date} to ${application.to_date}: ${grounds.trim()}`,
      status: 'PENDING_RM',
      raised_at: new Date().toISOString()
    }, ...prev]);

    logAudit("Leave Decision Appealed",
      `${coach?.name || application.coach_id} appealed the ${leaveType(application.type_id)?.label} ` +
      `decision of ${application.from_date} — ${grounds.trim()}`);
    showToast("Appeal raised. It goes to the Reporting Manager.", "info");
  };

  const handleLeaveCancel = (application) => {
    const started = new Date(application.from_date) <= new Date();
    if (started && application.status === 'Approved' && !LEAVE_APPROVER_ROLES.includes(currentRole)) {
      showToast("This leave has started — only the Reporting Manager can cancel the rest of it.", "error");
      return;
    }
    const note = window.prompt("Why is this being cancelled?");
    if (note === null) return;

    // Only days not yet taken come back.
    const today = new Date();
    const from = new Date(application.from_date);
    const remaining = started
      ? Math.max(0, Math.floor((new Date(application.to_date) - today) / 86400000))
      : Number(application.days);

    setLeaveApplications(prev => prev.map(a => a.id === application.id
      ? { ...a, status: 'Cancelled', cancelled_at: new Date().toISOString(), cancel_note: note || null }
      : a));
    setLeaveBalances(prev => prev.map(b =>
      (b.coach_id === application.coach_id && b.type_id === application.type_id)
        ? { ...b, used: Math.max(0, (Number(b.used) || 0) - remaining) }
        : b));

    void from;
    logAudit("Leave Cancelled",
      `Cancelled ${leaveType(application.type_id)?.label} for ${application.coach_id}; ` +
      `${remaining} day(s) returned${note ? ` — ${note}` : ''}.`);
    showToast(`Cancelled. ${remaining} day${remaining === 1 ? '' : 's'} returned.`, "info");
  };

  // Open Payslip Modal
  const handleOpenPayslipModal = (coachId, period) => {
    // A coach may see their own payslip and no one else's. Showrunner sees none
    // at all, since the whole role is built to keep pay out of view.
    if (currentRole === 'Showrunner') {
      showToast("Payslips are not available to this role.", "error");
      return;
    }
    if (currentRole === 'Coach' && coachId !== profile?.coach_id) {
      showToast("You can only open your own payslip.", "error");
      return;
    }
    setSelectedCoachId(coachId);
    setPayslipPeriod(period);
    setActiveModal("payslip-preview");
    logAudit("Payslip Viewed", `Generated payslip PDF preview for ${coaches.find(c => c.id === coachId)?.name || coachId} for ${period}`);
  };

  // ----------------------------------------------------
  // Form submissions
  // ----------------------------------------------------

  const handlePdfUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 500 * 1024) {
        showToast("Error: File size must be less than 500 KB.", "danger");
        e.target.value = "";
        return;
      }
      const ext = file.name.split('.').pop().toLowerCase();
      const allowed = ["pdf", "png", "jpg", "jpeg", "gif", "webp", "doc", "docx"];
      if (!allowed.includes(ext)) {
        showToast("Error: Only PDF, Images, and Word files (.doc, .docx) are allowed.", "danger");
        e.target.value = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setNewCertPdfData(reader.result);
        setNewCertPdfName(file.name);
        showToast(`Selected File: ${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  const resetAddCoachForm = () => {
    setNewCoachName("");
    setNewCoachUhid("");
    setNewCoachEmail("");
    setNewCoachGender("");
    setNewCoachType("");
    setNewCoachCategory("");
    setNewCoachSalary("");
    setNewCoachRate("");
    setNewCoachErrors({});
  };

  // Profile / Experience cards: edit in place against a draft of the coach record.
  const beginCoachCardEdit = (coach, card) => {
    setEditingCoachCard(card);
    setOrgWorkUnlocked(false);
    const draft = { ...coach };
    // Coaches recorded before education became a list open with their existing
    // qualification/format pair as the first row, so nothing has to be re-keyed.
    if (card === 'education' && !(coach.education || []).length && coach.education_qualification) {
      const master = educationLevels.find(
        l => l.qualification === coach.education_qualification && l.format === coach.education_type
      );
      draft.education = [{
        id: `EDU_${coach.id}_1`,
        level: "higher",
        institution: "",
        qualification: coach.education_qualification,
        format: coach.education_type || "",
        score: master ? master.score : "",
        pdfName: "",
        pdfData: ""
      }];
    }
    setCoachDraft(draft);
  };

  const cancelCoachCardEdit = () => {
    setEditingCoachCard(null);
    setOrgWorkUnlocked(false);
    setCoachDraft({});
  };

  const setCoachField = (key, value) => setCoachDraft(prev => ({ ...prev, [key]: value }));

  // Leaving a tab mid-edit would hide an open editor and its draft, so say so
  // rather than losing the changes quietly.
  const switchCoachDetailTab = (tab) => {
    if (tab === coachDetailTab) return;
    if (editingCoachCard && !window.confirm('Discard the changes you are editing?')) return;
    if (editingCoachCard) cancelCoachCardEdit();
    setCoachDetailTab(tab);
  };

  // Certifications are an array on the coach record, so they need their own
  // add/edit/remove rather than the single-field setter above. Rows carry a
  // local id only so React can key them; it is kept on save.
  // Certifications are an array on the coach record, so they need their own
  // add/edit/remove rather than the single-field setter above. Rows carry a
  // local id only so React can key them; it is kept on save.
  const setCertField = (index, key, value) =>
    setCoachDraft(prev => ({
      ...prev,
      certifications: (prev.certifications || []).map((c, i) =>
        i === index ? { ...c, [key]: value } : c)
    }));

  const addCertRow = () =>
    setCoachDraft(prev => ({
      ...prev,
      certifications: [
        ...(prev.certifications || []),
        { id: `CERT_${Date.now()}${Math.floor(Math.random() * 100)}`, authority: "", course_name: "", format: "", score: "" }
      ]
    }));

  // Education certificates work like technical ones: a list on the coach, with
  // the best of them scoring. The points are not typed in — they come from the
  // qualification/format pairing in the Education Master.
  const setEduField = (index, key, value) =>
    setCoachDraft(prev => ({
      ...prev,
      education: (prev.education || []).map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, [key]: value };
        if (key === 'qualification' || key === 'format') {
          const master = educationLevels.find(
            l => l.qualification === next.qualification && l.format === next.format
          );
          next.score = master ? master.score : "";
        }
        return next;
      })
    }));

  const addEduRow = () =>
    setCoachDraft(prev => ({
      ...prev,
      education: [
        ...(prev.education || []),
        { id: `EDU_${Date.now()}${Math.floor(Math.random() * 100)}`, level: "", institution: "", qualification: "", format: "", score: "", pdfName: "", pdfData: "" }
      ]
    }));

  const removeEduRow = (index) =>
    setCoachDraft(prev => ({
      ...prev,
      education: (prev.education || []).filter((_, i) => i !== index)
    }));

  // Certificates are stored on the row as a base64 data URL, the same way the
  // certifications master stores its attachment.
  const setEduDocument = (index, file) => {
    if (!file) return;
    if (file.size > 500 * 1024) {
      showToast("Error: File size must be less than 500 KB.", "danger");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCoachDraft(prev => ({
        ...prev,
        education: (prev.education || []).map((row, i) =>
          i === index ? { ...row, pdfName: file.name, pdfData: reader.result } : row)
      }));
    };
    reader.readAsDataURL(file);
  };

  const removeCertRow = (index) =>
    setCoachDraft(prev => ({
      ...prev,
      certifications: (prev.certifications || []).filter((_, i) => i !== index)
    }));

  const saveCoachCardEdit = (coach, card) => {
    const numeric = ["freelance_past_exp_with_document", "freelance_past_exp_without_document", "non_coaching_exp_years"];
    const updated = { ...coach, ...coachDraft };
    numeric.forEach(k => { updated[k] = Number(updated[k]) || 0; });

    if (card === 'experience') {
      // A fresh qualification must drive the education score again, so an older
      // hand-entered override is dropped rather than silently outranking it.
      const changedEducation = updated.education_qualification !== coach.education_qualification
        || updated.education_type !== coach.education_type;
      if (changedEducation) delete updated.education_score_override;
    }

    if (card === 'bank') {
      // IFSC codes are upper case by convention and are matched exactly by
      // banks, so store them that way rather than however they were typed.
      updated.bank_ifsc = (updated.bank_ifsc || "").trim().toUpperCase();
      for (const key of ['bank_holder_name', 'bank_name', 'bank_account', 'bank_branch', 'bank_upi']) {
        updated[key] = (updated[key] || "").trim();
      }
      // PAN is quoted upper case on returns and payslips.
      updated.pan_number = (updated.pan_number || "").trim().toUpperCase();
    }

    if (card === 'education') {
      // A row needs at least a qualification to mean anything; the score is
      // stored as a number so the engine never has to parse it.
      updated.education = (updated.education || [])
        .filter(e => (e.qualification || "").trim())
        .map(e => ({
          ...e,
          institution: (e.institution || "").trim(),
          score: e.score === "" || e.score === null || e.score === undefined ? "" : Number(e.score)
        }));
      // Keep the legacy single pair in step with the best row, so anything
      // still reading those two fields stays correct.
      const best = getHighestEducationEntry(updated);
      if (best) {
        updated.education_qualification = best.qualification;
        updated.education_type = best.format;
      }
    }

    if (card === 'certifications') {
      // Drop rows left blank, and store the score as a number — the scoring
      // engine takes the highest cert score, and "" would read as 0.
      updated.certifications = (updated.certifications || [])
        .filter(c => (c.authority || "").trim() || (c.course_name || "").trim())
        .map(c => ({
          ...c,
          authority: (c.authority || "").trim(),
          course_name: (c.course_name || "").trim(),
          score: Number(c.score) || 0
        }));
    }

    if (card === 'profile' && updated.coach_type !== coach.coach_type) {
      const typeConfig = COACH_TYPES.find(t => t.value === updated.coach_type);
      if (typeConfig && updated.variant_id === coach.variant_id) {
        updated.variant_id = typeConfig.variant_id;
      }
    }

    const cardLabel = card === 'profile' ? 'Profile'
      : card === 'certifications' ? 'Technical certifications'
      : 'Experience & education';

    setCoaches(prev => prev.map(c => (c.id === coach.id ? updated : c)));
    logAudit(
      card === 'profile' ? "Coach Profile Edited"
        : card === 'certifications' ? "Coach Certifications Edited"
        : "Coach Experience Edited",
      card === 'certifications'
        ? `Updated certifications for ${updated.name} (${coach.id}): ${
            updated.certifications.length
              ? updated.certifications.map(c => `${c.course_name || c.authority} @ ${c.score}`).join('; ')
              : 'none'}`
        : `Updated ${card === 'profile' ? 'profile' : 'experience & education'} details for ${updated.name} (${coach.id})`
    );
    showToast(`${cardLabel} saved for ${updated.name}.`);
    cancelCoachCardEdit();
  };

  // Score Management: open one period's row for editing, seeded from the record
  // plus the coach's one-time profile entries.
  const beginScoreRowEdit = (coach, run, pane = 'main') => {
    const key = draftKey(run.coach_id, run.period_month);
    // Whatever was open goes to the side rather than over the side.
    stashOpenDraft();

    editingRef.current = key;
    setEditingScorePeriod(run.period_month);
    setEditingScorePane(pane);

    const pending = pendingDrafts[key];
    if (pending) {
      setScoreDraft(pending);
      setUnlockedDynamicKeys(overrideKeys(pending.overrides));
      showToast(`Picked up where you left off on ${run.period_month}.`, "info");
      return;
    }

    setScoreDraft({
      prof_appearance: run.prof_appearance ?? 0,
      client_engagement: run.client_engagement ?? 0,
      safety: run.safety ?? 0,
      punctuality: run.punctuality ?? 0,
      team_conduct: run.team_conduct ?? 0,
      communication: run.communication ?? 0,
      meetings_scheduled: run.meetings_scheduled ?? 0,
      meetings_attended: run.meetings_attended ?? 0,
      sessions: run.sessions_completed ?? 0,
      night_sessions: run.night_sessions ?? 0,
      streak: run.five_star_streak ?? 0,
      missed_sessions: run.missed_sessions ?? 0,
      exp_doc: coach.freelance_past_exp_with_document ?? 0,
      exp_nodoc: coach.freelance_past_exp_without_document ?? 0,
      exp_non_coach_years: coach.non_coaching_exp_years ?? 0,
      edu_raw: coach.education_score_override != null
        ? coach.education_score_override
        : getEducationScore(coach.education_qualification, coach.education_type),
      overrides: { ...(run.overrides || {}) }
    });
    // Cells already carrying an override stay open; the rest re-lock.
    setUnlockedDynamicKeys(overrideKeys(run.overrides));
  };

  // Clicking a calculated cell asks before handing control over to the user.
  const requestDynamicEdit = (col, ceiling) => {
    if (unlockedDynamicKeys.includes(col.key)) return;
    const limit = ceiling !== null ? `\n\nValid range: 0 to ${ceiling}.` : '';
    const proceed = window.confirm(
      `"${col.label}" is a dynamic field — it is calculated automatically and re-drives the values below it.${limit}\n\n` +
      `Do you want to edit it?`
    );
    if (!proceed) return;
    setUnlockedDynamicKeys(prev => [...prev, col.key]);
    showToast(`${col.label} unlocked for manual entry.`, "warning");
  };

  // Drop every hand-entered dynamic value on the open row, back to calculated.
  const clearScoreRowOverrides = () => {
    setScoreDraft(prev => ({
      ...prev,
      overrides: Object.fromEntries(
        Object.entries(prev.overrides || {}).filter(([k]) => k.startsWith('__'))
      )
    }));
    setUnlockedDynamicKeys([]);
    showToast("Every dynamic cell is back to its calculated value.", "info");
  };

  // Taking over a calculated cell is the easiest way to introduce a wrong number,
  // so say so the first time it happens and range-check every keystroke after.
  const applyScoreOverride = (col, rawValue, ceiling) => {
    setScoreDraft(prev => ({
      ...prev,
      overrides: { ...(prev.overrides || {}), [col.key]: rawValue }
    }));

    if (rawValue === "") return;
    const value = Number(rawValue);

    if (Number.isNaN(value) || value < 0) {
      showToast(`${col.label} must be a positive number.`, "danger");
      return;
    }
    if (ceiling !== null && value > ceiling) {
      showToast(`${col.label} cannot exceed ${ceiling}. Check the entry before saving.`, "danger");
      return;
    }
  };

  // Lock or unlock one period's score card by hand, from the Record Status
  // cell. handleLockCycle() locks a whole month at once; this is the per-row
  // equivalent, for the cases that need correcting after the fact.
  const toggleRecordLock = (coach, run) => {
    if (!LOCK_ROLES.includes(currentRole)) {
      showToast("Your role cannot lock or unlock a score card.", "error");
      return;
    }

    const locking = run.status !== 'FINANCE_LOCKED';
    const what = `the ${run.period_month} score card for ${coach.name}`;
    const proceed = window.confirm(locking
      ? `Lock ${what}?\n\nIt can no longer be edited, and payroll treats it as final.`
      : `Unlock ${what}?\n\nIt becomes editable again and payroll stops treating it as final.`);
    if (!proceed) return;

    const nextStatus = locking ? 'FINANCE_LOCKED' : 'DRAFT';
    // The record lives in whichever list holds its period, so both are mapped.
    const apply = (list) => list.map(r =>
      (r.coach_id === run.coach_id && r.period_month === run.period_month)
        ? { ...r, status: nextStatus }
        : r);
    setCurrentMonth(prev => apply(prev));
    setHistoricMonths(prev => apply(prev));

    // Locking a row that is open for editing would leave an editor on a record
    // nobody may edit, so close it and drop the draft.
    if (locking && editingScorePeriod === run.period_month) cancelScoreRowEdit();

    logAudit(
      locking ? "Score Card Locked" : "Score Card Unlocked",
      `${locking ? 'Locked' : 'Unlocked'} the ${run.period_month} score card for ${coach.name} (${coach.id}) by hand`
    );
    showToast(
      `${run.period_month} score card ${locking ? 'locked' : 'unlocked'}.`,
      locking ? "info" : "warning"
    );
  };

  useEffect(() => { scoreDraftRef.current = scoreDraft; }, [scoreDraft]);

  // -------------------------------------------------------------------------
  // Auto-save. Typing into a score card and walking away should not lose it,
  // so a pause in typing commits what is there. It runs silently and refuses
  // anything that would need a decision — an override, or a month with nothing
  // in it — leaving those to the Save button, which still confirms as before.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const key = editingRef.current;
    if (!key || !editingScorePeriod) return;
    if (!scoreDraft || Object.keys(scoreDraft).length === 0) return;

    const [coachId, periodMonth] = key.split('|');
    const coach = coaches.find(c => c.id === coachId);
    const run = [...currentMonth, ...historicMonths]
      .find(r => r.coach_id === coachId && r.period_month === periodMonth);
    if (!coach || !run || run.status === 'FINANCE_LOCKED') return;
    if (!SCORE_EDIT_ROLES.includes(currentRole)) return;

    const timer = setTimeout(() => {
      setAutoSaveAt("saving");
      const saved = saveScoreRowEdit(coach, run, scoreDraftRef.current,
        { quiet: true, auto: true, keepOpen: true });
      setAutoSaveAt(saved
        ? new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : "");
    }, 2000);

    return () => clearTimeout(timer);
  }, [scoreDraft, editingScorePeriod]);

  // Park the open draft under its own row, so it survives moving away.
  const stashOpenDraft = () => {
    const key = editingRef.current;
    const draft = scoreDraftRef.current;
    if (!key || !draft || Object.keys(draft).length === 0) return;
    setPendingDrafts(prev => ({ ...prev, [key]: draft }));
  };

  // Cancel is the deliberate "throw this away", so it drops the stash too.
  const cancelScoreRowEdit = () => {
    const key = editingRef.current;
    if (key) {
      setPendingDrafts(prev => {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
    editingRef.current = null;
    setEditingScorePeriod(null);
    setEditingScorePane(null);
    setScoreDraft({});
    setUnlockedDynamicKeys([]);
  };

  // Apply a draft: monthly fields to the period record, one-time fields to the coach.
  // `draftArg` lets a queued draft be saved without it being the one on
  // screen, which is what "Save all" needs.
  const saveScoreRowEdit = (coach, run, draftArg = null, opts = {}) => {
    const draft = draftArg || scoreDraft;
    const vCfg = findVariant(variants, coach.variant_id);
    const overrides = draft.overrides || {};
    const overriddenCols = COACH_SCORECARD_COLUMNS.filter(c => {
      const v = overrides[c.key];
      return v !== undefined && v !== null && v !== "";
    });

    // Block anything outside its legitimate range rather than storing a bad score.
    const invalid = overriddenCols.filter(c => {
      const value = Number(overrides[c.key]);
      const ceiling = overrideCeiling(c, vCfg.weights);
      return Number.isNaN(value) || value < 0 || (ceiling !== null && value > ceiling);
    });
    if (invalid.length > 0) {
      if (!opts.auto) {
        showToast(`Cannot save — ${invalid.map(c => c.label).join(', ')} ${invalid.length > 1 ? 'are' : 'is'} out of range.`, "danger");
      }
      return;
    }

    // Taking over a calculated cell is a decision, and a decision cannot be
    // made by a timer, so auto-save leaves those to the Save button.
    if (opts.auto && overriddenCols.length > 0) return;

    if (overriddenCols.length > 0) {
      const list = overriddenCols.map(c => `• ${c.label}: ${overrides[c.key]}`).join('\n');
      const proceed = window.confirm(
        `${overriddenCols.length} calculated cell${overriddenCols.length > 1 ? 's are' : ' is'} being replaced by a hand-entered value on ${run.period_month}:\n\n${list}\n\n` +
        `These will stop following the calculation until you reset them. Save anyway?`
      );
      if (!proceed) return;
    }

    // Every manual cell is coerced to a number below, so an untouched draft
    // saves a month as all zeros — which then reads as recorded, scores as
    // zero, and is indistinguishable from figures somebody meant to enter.
    // Saving a month into that state is almost always an accident.
    const manualDraftKeys = ['prof_appearance', 'client_engagement', 'safety', 'punctuality',
      'team_conduct', 'communication', 'meetings_scheduled', 'meetings_attended',
      'sessions', 'night_sessions', 'streak', 'missed_sessions'];
    const allBlank = manualDraftKeys.every(k => {
      const v = draft[k];
      return v === null || v === undefined || v === '' || Number(v) === 0;
    });
    if (allBlank && !opts.quiet) {
      const proceed = window.confirm(
        `Nothing has been entered on ${run.period_month}.\n\n` +
        `Saving now records every figure as zero, which scores the month at 0 ` +
        `rather than leaving it unrecorded. Save it as zeros anyway?`
      );
      if (!proceed) return;
    }
    if (allBlank && opts.quiet && !isRecorded(run)) return;

    const scheduled = Number(draft.meetings_scheduled) || 0;
    const attended = Math.min(Number(draft.meetings_attended) || 0, scheduled);
    const attendancePct = scheduled > 0 ? (attended / scheduled) * 100 : 0;

    const updatedRecord = {
      ...run,
      prof_appearance: Number(draft.prof_appearance) || 0,
      client_engagement: Number(draft.client_engagement) || 0,
      safety: Number(draft.safety) || 0,
      punctuality: Number(draft.punctuality) || 0,
      team_conduct: Number(draft.team_conduct) || 0,
      communication: Number(draft.communication) || 0,
      meetings_scheduled: scheduled,
      meetings_attended: attended,
      attendance_pct: Math.round(attendancePct * 100) / 100,
      sessions_completed: Number(draft.sessions) || 0,
      night_sessions: Number(draft.night_sessions) || 0,
      five_star_streak: Number(draft.streak) || 0,
      missed_sessions: Number(draft.missed_sessions) || 0,
      overrides: { ...(draft.overrides || {}) }
    };

    const updatedCoach = {
      ...coach,
      freelance_past_exp_with_document: Number(draft.exp_doc) || 0,
      freelance_past_exp_without_document: Number(draft.exp_nodoc) || 0,
      non_coaching_exp_years: Number(draft.exp_non_coach_years) || 0,
      education_score_override: Number(draft.edu_raw) || 0
    };

    // Re-score the period with the new inputs so the stored total stays in step.
    // A hand-entered HB+ Score wins; any other override is re-applied on read.
    const vConfig = findVariant(variants, coach.variant_id);
    const rescored = computeHBPlusScore(updatedCoach, updatedRecord, vConfig);
    const scoreOverride = updatedRecord.overrides.hb_score;
    const finalScore = (scoreOverride !== undefined && scoreOverride !== null)
      ? Number(scoreOverride)
      : rescored.hbScore;
    updatedRecord.hb_score = finalScore;
    updatedRecord.band = getPerformanceBand(finalScore).label;

    const applyTo = (list) => list.map(r =>
      r.coach_id === coach.id && r.period_month === run.period_month ? updatedRecord : r
    );
    if (currentMonth.some(r => r.coach_id === coach.id && r.period_month === run.period_month)) {
      setCurrentMonth(applyTo);
    } else {
      setHistoricMonths(applyTo);
    }
    setCoaches(prev => prev.map(c => (c.id === coach.id ? updatedCoach : c)));

    // An automatic save fires on every pause in typing, so logging each one
    // would bury the audit trail in its own noise. The entry is written when
    // the edit is finished by hand, which is the act worth recording.
    const overrideCount = overrideKeys(updatedRecord.overrides).length;
    if (!opts.auto) {
      logAudit("Score Card Edited", `Updated ${run.period_month} score card for ${coach.name} (${coach.id}) — HB+ Score now ${finalScore}${overrideCount ? `, ${overrideCount} manual override(s)` : ''}`);
    }
    if (!opts.quiet) showToast(`${run.period_month} score card saved. HB+ Score: ${finalScore}`);

    const key = draftKey(coach.id, run.period_month);
    setPendingDrafts(prev => {
      if (!(key in prev)) return prev;
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
    if (editingRef.current === key && !opts.keepOpen) {
      editingRef.current = null;
      setEditingScorePeriod(null);
      setEditingScorePane(null);
      setScoreDraft({});
      setUnlockedDynamicKeys([]);
    }
    return true;
  };

  // Commit every draft that has been set aside, plus the one on screen.
  const saveAllPendingDrafts = (coach, runs) => {
    stashOpenDraft();
    const queued = { ...pendingDrafts };
    const openKey = editingRef.current;
    if (openKey) queued[openKey] = scoreDraftRef.current;

    let saved = 0;
    for (const [key, draft] of Object.entries(queued)) {
      const [coachId, periodMonth] = key.split('|');
      if (coachId !== coach.id) continue;
      const run = runs.find(r => r.period_month === periodMonth);
      if (!run || run.status === 'FINANCE_LOCKED') continue;
      if (saveScoreRowEdit(coach, run, draft, { quiet: true })) saved += 1;
    }
    showToast(saved > 0
      ? `Saved ${saved} score card${saved === 1 ? '' : 's'}.`
      : "Nothing to save.", saved > 0 ? "success" : "info");
  };

  // Create coach
  const handleCreateCoachSubmit = (e) => {
    e.preventDefault();

    const errors = {};
    if (!newCoachName.trim()) errors.name = "Required field";
    const uhid = newCoachUhid.trim().toUpperCase();
    if (!uhid) {
      errors.uhid = "Required field";
    } else if (coaches.some(c => c.id.toUpperCase() === uhid)) {
      errors.uhid = "This UHID is already in use";
    }
    if (!newCoachEmail.trim()) {
      errors.email = "Required field";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCoachEmail.trim())) {
      errors.email = "Enter a valid email address";
    }
    if (!newCoachGender) errors.gender = "This field is required";
    if (!newCoachType) errors.type = "This field is required";
    if (!newCoachCategory) errors.category = "This field is required";

    setNewCoachErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const typeConfig = COACH_TYPES.find(t => t.value === newCoachType);
    const newId = uhid;

    // Pay is stored on the coach from the outset rather than left to fall
    // through to the band, so the figure never moves on its own when the score
    // does. Blank takes the floor of the entry band; Flexi has no salary.
    const entry = entryBenchmark(typeConfig.variant_id, newCoachCategory);
    const chosenSalary = newCoachSalary === "" ? entry.salary : Number(newCoachSalary);
    const chosenRate = newCoachRate === "" ? entry.rate : Number(newCoachRate);
    const startingPay = newCoachCategory === 'Flexi'
      ? { per_session_override: chosenRate ?? null }
      : {
          ...(newCoachCategory === 'Flexi-Fixed'
            ? { flexi_fixed_base_salary: chosenSalary ?? null }
            : { fixed_salary_override: chosenSalary ?? null }),
          per_session_override: chosenRate ?? null
        };

    const newCoach = {
      ...NEW_COACH_DEFAULTS,
      id: newId,
      name: newCoachName.trim(),
      email: newCoachEmail.trim(),
      gender: newCoachGender,
      coach_type: newCoachType,
      coach_category: newCoachCategory,
      variant_id: typeConfig.variant_id,
      reporting_manager_id: typeConfig.reporting_manager_id,
      ...startingPay
    };

    setCoaches(prev => [...prev, newCoach]);

    // Seed evaluation scorecard
    setCurrentMonth(prev => [...prev, {
      coach_id: newId,
      period_month: currentPeriodMonth,
      period_start: "2026-05-16",
      period_end: "2026-06-15",
      prof_appearance: 15,
      client_engagement: 15,
      safety: 12,
      punctuality: 8,
      team_conduct: 12,
      communication: 14,
      attendance_pct: 90,
      sessions_completed: 0,
      night_sessions: 0,
      five_star_streak: 0,
      status: "DRAFT"
    }]);

    logAudit("Coach Created", `Created ${newCoachCategory} ${newCoachType} coach ${newCoach.name} (${newId}) registered to variant ${typeConfig.variant_id}`);
    showToast(`Coach Profile ${newId} created successfully.`);
    setActiveModal(null);
    resetAddCoachForm();
  };

  const handleAddEducationFormat = () => {
    if (currentRole !== "Super Admin" && currentRole !== "HR Manager") {
      showToast("Only Super Admin and HR Manager can add study formats.", "error");
      return;
    }
    const label = newEduFormatLabel.trim();
    if (!label) return;

    // Coach records store the value, so it is derived once from the label and
    // then left alone — renaming a format later must not orphan those records.
    const value = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!value) {
      showToast("That name has no letters or numbers to build a key from.", "error");
      return;
    }

    const clash = educationFormats.find(f => f.value === value);
    if (clash) {
      showToast(`"${clash.label}" already uses that key.`, "error");
      return;
    }

    setEducationFormats(prev => [...prev, { value, label }]);
    logAudit("Education Format Added", `Added study format "${label}" (${value}) to the education master`);
    showToast(`Study format "${label}" added.`);
    setNewEduFormatLabel("");
  };

  const handleRemoveEducationFormat = (format) => {
    if (currentRole !== "Super Admin" && currentRole !== "HR Manager") {
      showToast("Only Super Admin and HR Manager can change study formats.", "error");
      return;
    }
    // A format still carrying points or coaches cannot go — removing it would
    // strand those rows on a format that no longer exists.
    const pairings = educationLevels.filter(l => l.format === format.value).length;
    const holders = coaches.filter(c => c.education_type === format.value).length;
    if (pairings || holders) {
      const parts = [];
      if (pairings) parts.push(`${pairings} scoring row${pairings > 1 ? 's' : ''}`);
      if (holders) parts.push(`${holders} coach${holders > 1 ? 'es' : ''}`);
      showToast(`"${format.label}" is still used by ${parts.join(' and ')}.`, "error");
      return;
    }
    if (!window.confirm(`Remove the study format "${format.label}"?`)) return;

    setEducationFormats(prev => prev.filter(f => f.value !== format.value));
    logAudit("Education Format Removed", `Removed study format "${format.label}" (${format.value})`);
    showToast(`Study format "${format.label}" removed.`);
  };

  const handleAddEducationLevel = () => {
    // Same rule as the certifications master: these points feed every coach's
    // score, so only the roles that own scoring policy may set them.
    if (currentRole !== "Super Admin" && currentRole !== "HR Manager") {
      showToast("Only Super Admin and HR Manager can set education points.", "error");
      return;
    }
    const qualification = newEduQualification.trim();
    if (!qualification) return;

    const clash = educationLevels.find(
      l => l.qualification.toLowerCase() === qualification.toLowerCase() && l.format === newEduFormat
    );
    const formatLabel = educationFormats.find(f => f.value === newEduFormat)?.label || newEduFormat;

    if (clash) {
      // One pair can only carry one score, so a repeat is an edit, not a second row.
      setEducationLevels(prev => prev.map(l =>
        l.id === clash.id ? { ...l, score: Number(newEduScore) } : l));
      logAudit("Education Points Updated",
        `${qualification} (${formatLabel}) repointed from ${clash.score} to ${newEduScore}`);
      showToast(`${qualification} — ${formatLabel} updated to ${newEduScore} pts.`);
    } else {
      const nextNum = educationLevels.reduce((max, l) => {
        const n = Number(String(l.id).replace(/\D/g, ""));
        return Number.isFinite(n) && n > max ? n : max;
      }, 0) + 1;
      const row = {
        id: `ED${String(nextNum).padStart(2, "0")}`,
        qualification,
        format: newEduFormat,
        score: Number(newEduScore)
      };
      setEducationLevels(prev => [...prev, row]);
      logAudit("Education Level Added",
        `Added ${qualification} (${formatLabel}) scoring ${newEduScore} to the education master`);
      showToast(`${qualification} — ${formatLabel} added at ${newEduScore} pts.`);
    }

    setNewEduQualification("");
    setNewEduFormat("offline_india");
    setNewEduScore(3.0);
  };

  const handleRemoveEducationLevel = (row) => {
    if (currentRole !== "Super Admin" && currentRole !== "HR Manager") {
      showToast("Only Super Admin and HR Manager can change education points.", "error");
      return;
    }
    // Coaches already carrying this qualification would silently drop to zero,
    // so say how many before the row goes.
    const affected = coaches.filter(
      c => c.education_qualification === row.qualification && c.education_type === row.format
    ).length;
    const formatLabel = educationFormats.find(f => f.value === row.format)?.label || row.format;
    const warning = affected
      ? `\n\n${affected} coach${affected > 1 ? 'es' : ''} currently score on this pairing and would fall to 0.`
      : '';
    if (!window.confirm(`Remove "${row.qualification} — ${formatLabel}" from the education master?${warning}`)) return;

    setEducationLevels(prev => prev.filter(l => l.id !== row.id));
    logAudit("Education Level Removed", `Removed ${row.qualification} (${formatLabel}) from the education master`);
    showToast(`${row.qualification} — ${formatLabel} removed.`);
  };

  const handleAddCertification = () => {
    // Defining a certification sets the points every coach holding it will
    // score, so it stays with the roles that own scoring policy. Settings is
    // already gated to these two — this is the second lock on the action.
    if (currentRole !== "Super Admin" && currentRole !== "HR Manager") {
      showToast("Only Super Admin and HR Manager can add certifications.", "error");
      return;
    }
    const prefix = newCertVariantType === "S&C" ? "SC" : "YG";
    const existingCount = certifications.filter(c => c.id && c.id.startsWith(prefix)).length;
    const newId = `${prefix}${existingCount + 1}`;

    const newCert = {
      id: newId,
      variant_type: newCertVariantType,
      authority: newCertAuthority,
      course_name: newCertCourseName,
      level: newCertLevel,
      score: Number(newCertScore),
      pdfData: newCertPdfData,
      pdfName: newCertPdfName
    };

    setCertifications(prev => [...prev, newCert]);
    logAudit("Certification Added", `Added new technical certification: ${newCertCourseName} (${newId}) under ${newCertAuthority} scored ${newCertScore}`);
    showToast(`Certification ${newCertCourseName} added to master list.`);

    // Reset fields
    setNewCertAuthority("");
    setNewCertCourseName("");
    setNewCertVariantType("S&C");
    setNewCertLevel("Gold");
    setNewCertScore(8.0);
    setNewCertPdfData("");
    setNewCertPdfName("");
  };

  // Submit evaluation scorecard
  const handleEvalSubmit = (e) => {
    e.preventDefault();
    if (payrollLocked) {
      showToast("Evaluation locked: The current payroll cycle has already been closed by Finance.", "danger");
      return;
    }
    // The card may have been locked after this form was opened.
    const openRecord = currentMonth.find(m => m.coach_id === selectedCoachId);
    if (openRecord?.status === 'FINANCE_LOCKED') {
      showToast(`${openRecord.period_month} is locked. Unlock it on Record Status to edit.`, "danger");
      return;
    }

    const coach = coaches.find(c => c.id === selectedCoachId);
    const vConfig = findVariant(variants, coach.variant_id);

    // Update coach category permanently
    setCoaches(prev => prev.map(c => {
      if (c.id === selectedCoachId) {
        return { ...c, coach_category: evalCoachCategory };
      }
      return c;
    }));

    setCurrentMonth(prev => prev.map(item => {
      if (item.coach_id === selectedCoachId && item.period_month === currentPeriodMonth) {
        const updated = {
          ...item,
          prof_appearance: Number(evalAppearance),
          client_engagement: Number(evalEngagement),
          safety: Number(evalSafety),
          punctuality: Number(evalPunctuality),
          team_conduct: Number(evalConduct),
          communication: Number(evalCommunication),
          attendance_pct: Number(evalAttendance),
          sessions_completed: Number(evalSessionsCompleted),
          night_sessions: Number(evalNightSessions),
          five_star_streak: Number(evalStreak),
        };

        const updatedCoach = { ...coach, coach_category: evalCoachCategory };

        if (coach.variant_id === 'V5') {
          updated.ooh_sessions_completed = Number(evalOohSessions);
          updated.pt_home_sessions_completed = Number(evalPtHomeSessions);
          updated.performance_credits_points = Number(evalCredits);
        }

        if (evalCoachCategory === 'Flexi') {
          updated.trial_sessions_completed = Number(evalTrialSessions);
          updated.half_day_events = Number(evalHalfEvents);
          updated.full_day_events = Number(evalFullEvents);
        }

        const calc = computeHBPlusScore(updatedCoach, updated, vConfig);
        updated.hb_score = calc.hbScore;
        updated.band = getPerformanceBand(calc.hbScore).label;
        updated.status = currentRole === 'Super Admin' ? 'HR_REVIEWED' : 'RM_SUBMITTED';

        logAudit("Scorecard Submitted", `Logged score card for ${coach.name} (${selectedCoachId}) - Score: ${updated.hb_score}`);
        return updated;
      }
      return item;
    }));

    showToast(`Evaluation scorecard submitted for ${coach.name}.`);
    setActiveModal(null);
  };

  // Submit log violation incident
  const handleLogViolationSubmit = (e) => {
    e.preventDefault();
    if (payrollLocked) {
      showToast("Violations locked: Cycle is closed.", "danger");
      return;
    }

    const coach = coaches.find(c => c.id === vioCoachId);
    // The select is `required` with an empty first option, so this is only
    // reachable if that is bypassed — but recording an incident against nobody
    // would fail with a blank screen rather than a message.
    if (!coach) {
      showToast("Choose the coach this incident is being recorded against.", "error");
      return;
    }
    const occurrence = getViolationOccurrenceNumber(vioCoachId, vioType, vioDate, violations) + 1;
    const consequenceObj = getPenaltyConsequence(coach.variant_id, vioType, occurrence, PENALTY_MATRIX);

    let finalAmount = consequenceObj.amount;
    if (consequenceObj.consequence.includes("Deduct") && consequenceObj.consequence.includes("Session")) {
      const activeE = currentMonth.find(cm => cm.coach_id === vioCoachId);
      const score = activeE ? (activeE.hb_score || 50) : 50;
      const band = getPerformanceBand(score).label;
      const vConfig = findVariant(variants, coach.variant_id);
      const sessionRate = vConfig.rates[coach.coach_category]?.[band]?.per_session || 250;
      const sessionCount = consequenceObj.consequence.includes("1") ? 1 : (consequenceObj.consequence.includes("2") ? 2 : 4);
      finalAmount = sessionRate * sessionCount;
    }

    const newVio = {
      id: `VIO_${Date.now().toString().substring(7)}`,
      coach_id: vioCoachId,
      type: vioType,
      occurrence_no: occurrence,
      consequence: consequenceObj.consequence,
      penalty_amount: finalAmount,
      incident_date: vioDate,
      incident_time: vioTime,
      reported_by: currentRole,
      evidence: vioEvidence,
      status: "Pending_Acknowledge"
    };

    setViolations(prev => [...prev, newVio]);

    // Reset 5-star streak to 0 dynamically on violation
    setCoaches(prev => prev.map(c => {
      if (c.id === vioCoachId) {
        return { ...c, five_star_streak: 0 };
      }
      return c;
    }));
    setCurrentMonth(prev => prev.map(m => {
      if (m.coach_id === vioCoachId) {
        return { ...m, five_star_streak: 0 };
      }
      return m;
    }));

    logAudit("Violation Logged", `Logged ${vioType} (Occur #${occurrence}) for ${coach.name}. Consequence: ${consequenceObj.consequence}. Fined: ₹${finalAmount}`);
    showToast(`Incident logged for ${coach.name}. Streak reset to 0.`);
    setActiveModal(null);
  };

  // Submit bulk sessions CSV simulator
  const handleBulkSessionsSubmit = () => {
    const lines = bulkCSV.split("\n");
    let successCount = 0;
    let errorCount = 0;

    setCurrentMonth(prev => prev.map(evalRecord => {
      const matchLine = lines.find(l => l.startsWith(evalRecord.coach_id + ",") || l.startsWith(evalRecord.coach_id + " "));
      if (matchLine) {
        const parts = matchLine.split(",").map(s => s.trim());
        if (parts.length >= 2) {
          const sessions = Number(parts[1]) || 0;
          const night = Number(parts[2]) || 0;
          const attendance = Number(parts[3]) || 100;

          const coach = coaches.find(c => c.id === evalRecord.coach_id);
          const vConfig = findVariant(variants, coach.variant_id);

          const updated = {
            ...evalRecord,
            sessions_completed: sessions,
            night_sessions: night,
            attendance_pct: attendance
          };

          const calc = computeHBPlusScore(coach, updated, vConfig);
          updated.hb_score = calc.hbScore;
          updated.band = getPerformanceBand(calc.hbScore).label;

          successCount++;
          return updated;
        }
      }
      return evalRecord;
    }));

    // Count mismatch/missing lines
    lines.forEach((l, idx) => {
      if (idx === 0 && l.includes("coach_id")) return;
      if (!l.trim()) return;
      const parts = l.split(",");
      const coachId = parts[0]?.trim();
      if (!coaches.some(c => c.id === coachId)) {
        errorCount++;
      }
    });

    logAudit("Bulk Import", `Parsed operational data. Success: ${successCount}, Failed/Not found: ${errorCount}`);
    showToast(`Bulk sessions parsing complete. Import summary: ${successCount} successful patches.`);
    setActiveModal(null);
    setBulkCSV("");
  };

  // Submit Org Work
  const handleOrgWorkSubmit = (e) => {
    e.preventDefault();

    // Verify limit rules
    const band = orgWorkBand(owWorkType) || { min: 3000, max: 4000 };
    const { min, max } = band;
    
    if (owAmount < min || owAmount > max) {
      showToast(`Amount outside permitted guidelines. Permitted range: ₹${min} to ₹${max}`, "warning");
      return;
    }

    const newItem = {
      id: `OW_${Date.now().toString().substring(8)}`,
      coach_id: selectedCoachId,
      period_month: currentPeriodMonth,
      work_type: owWorkType,
      amount: owAmount,
      approved_by: currentRole,
      status: "Approved"
    };

    setOrgWork(prev => [...prev, newItem]);
    logAudit("Org Work Pay Approved", `Approved ₹${owAmount} for ${selectedCoachId} under category ${owWorkType}`);
    showToast(`Org Work item approved.`);
    setActiveModal(null);
  };

  // File Appeal
  const handleFileAppealSubmit = (e) => {
    e.preventDefault();

    const newAppeal = {
      id: `APP_${Date.now().toString().substring(7)}`,
      coach_id: currentCoachContext,
      target_type: appealTargetType,
      target_id: appealTargetId,
      reason: appealReason,
      raised_at: new Date().toLocaleDateString('en-IN'),
      status: "PENDING_RM"
    };

    setAppeals(prev => [...prev, newAppeal]);

    if (appealTargetType === 'Violation') {
      setViolations(prev => prev.map(v => {
        if (v.id === appealTargetId) {
          return { ...v, status: "Appeal_Raised" };
        }
        return v;
      }));
    }

    logAudit("Appeal Raised", `Coach raised appeal against ${appealTargetType} id: ${appealTargetId}`);
    showToast("Appeal filed successfully. Under Review.");
    setActiveModal(null);
  };

  // ----------------------------------------------------
  // Interactive operations
  // ----------------------------------------------------

  // Suspend/Exit coach
  const handleExitCoach = (coachId) => {
    const coach = coaches.find(c => c.id === coachId);
    if (window.confirm(`Do you want to process exit/suspension for ${coach.name}?`)) {
      const reason = window.prompt("Enter exit/suspension justification notes:");
      if (reason === null) return;
      
      setCoaches(prev => prev.map(c => {
        if (c.id === coachId) {
          return {
            ...c,
            status: "Exited",
            exit_date: new Date().toISOString().substring(0, 10),
            exit_reason: reason
          };
        }
        return c;
      }));

      logAudit("Coach Exited", `Marked ${coach.name} as Exited. Justification: ${reason}`);
      showToast("Coach status set to Exited.");
    }
  };

  // HR validate evaluation
  const handleHRApproveEval = (coachId) => {
    setCurrentMonth(prev => prev.map(item => {
      if (item.coach_id === coachId && item.period_month === currentPeriodMonth) {
        logAudit("Evaluation Validated", `HR approved scorecard for coach ${coachId}`);
        showToast("Evaluation approved and pushed to payroll ledger.");
        return { ...item, status: 'HR_REVIEWED' };
      }
      return item;
    }));
  };

  // RM decision on appeal
  const handleRMAppealDecision = (appealId, action) => {
    const notes = window.prompt(`Enter Reporting Manager ${action} justification notes:`);
    if (notes === null) return;

    setAppeals(prev => prev.map(a => {
      if (a.id === appealId) {
        return {
          ...a,
          rm_decision_notes: notes,
          status: action === 'Approve' ? 'RESOLVED' : 'RM_DECIDED'
        };
      }
      return a;
    }));

    const targetAppeal = appeals.find(ap => ap.id === appealId);
    if (targetAppeal && targetAppeal.target_type === 'Violation') {
      setViolations(prev => prev.map(vio => {
        if (vio.id === targetAppeal.target_id) {
          return {
            ...vio,
            status: action === 'Approve' ? "Appeal_Approved" : "Appeal_Rejected",
            penalty_amount: action === 'Approve' ? 0 : vio.penalty_amount
          };
        }
        return vio;
      }));
    }

    logAudit("Appeal RM Decision", `RM ${action}d appeal ${appealId}. Notes: ${notes}`);
    showToast(`Appeal decision recorded.`);
  };

  // RM Escalate appeal to HR
  const handleRMEscalateAppeal = (appealId) => {
    setAppeals(prev => prev.map(a => {
      if (a.id === appealId) {
        return { ...a, status: "ESCALATED_HR" };
      }
      return a;
    }));
    logAudit("Appeal Escalated", `Appeal ${appealId} escalated to HR department`);
    showToast("Appeal escalated to HR Manager.");
  };

  // HR decision on appeal
  const handleHRAppealDecision = (appealId, action) => {
    const notes = window.prompt(`Enter HR Manager final ${action} justification notes:`);
    if (notes === null) return;

    setAppeals(prev => prev.map(a => {
      if (a.id === appealId) {
        return {
          ...a,
          hr_decision_notes: notes,
          status: "RESOLVED"
        };
      }
      return a;
    }));

    const targetAppeal = appeals.find(ap => ap.id === appealId);
    if (targetAppeal && targetAppeal.target_type === 'Violation') {
      setViolations(prev => prev.map(vio => {
        if (vio.id === targetAppeal.target_id) {
          return {
            ...vio,
            status: action === 'Approve' ? "Appeal_Approved" : "Appeal_Rejected",
            penalty_amount: action === 'Approve' ? 0 : vio.penalty_amount
          };
        }
        return vio;
      }));
    }

    logAudit("Appeal HR Decision", `HR finalized appeal ${appealId} as ${action}d.`);
    showToast("Appeal resolved and finalized.");
  };

  // Delete violation
  const handleDeleteViolation = (vioId) => {
    if (window.confirm("Are you sure you want to delete this violation record? This removes the payroll deduction.")) {
      setViolations(prev => prev.filter(v => v.id !== vioId));
      logAudit("Violation Deleted", `Removed violation incident ${vioId}`);
      showToast("Violation deleted.");
    }
  };

  // Acknowledge violation (by Coach)
  const handleAcknowledgeViolation = (vioId) => {
    setViolations(prev => prev.map(v => {
      if (v.id === vioId) {
        logAudit("Violation Acknowledged", `Coach acknowledged violation ${vioId}`);
        showToast("Incident acknowledged.");
        return { ...v, status: "Acknowledged" };
      }
      return v;
    }));
  };

  // Save weights settings & recalculate scores
  const handleSaveWeights = (discipline, newWeights) => {
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      showToast(`Warning: Weights sum to ${sum}%. Weights should ideally equal 100% to normalize score out of 100.`, "warning");
    }

    setVariants(prev => prev.map(v => {
      if (v.discipline === discipline) {
        return { ...v, weights: newWeights };
      }
      return v;
    }));

    // Trigger recalculation of current month scorecard values using updated weights
    setCurrentMonth(prev => prev.map(evalRecord => {
      const coach = coaches.find(c => c.id === evalRecord.coach_id);
      if (coach) {
        const v = variants.find(x => x.id === coach.variant_id);
        if (v && v.discipline === discipline) {
          const activeWeightsVariant = { ...v, weights: newWeights };
          const calc = computeHBPlusScore(coach, evalRecord, activeWeightsVariant);
          return {
            ...evalRecord,
            hb_score: calc.hbScore,
            band: getPerformanceBand(calc.hbScore).label
          };
        }
      }
      return evalRecord;
    }));

    logAudit("Weights Adjusted", `Updated evaluation weights for discipline: ${discipline}`);
    showToast(`Weights updated and scores recalculated.`);
  };

  // Lock current cycle (Finance)
  const handleLockCycle = () => {
    const nextLocked = !payrollLocked;
    setPayrollLocked(nextLocked);

    // Update statuses of current month to FINANCE_LOCKED or rollback
    setCurrentMonth(prev => prev.map(e => {
      if (nextLocked) {
        if (e.status !== 'DRAFT') return { ...e, status: 'FINANCE_LOCKED' };
      } else {
        if (e.status === 'FINANCE_LOCKED') return { ...e, status: 'HR_REVIEWED' };
      }
      return e;
    }));

    logAudit(nextLocked ? "Payroll Lock" : "Payroll Unlock", `Manually toggled performance metrics lock for ${currentPeriodMonth} cycle.`);
    showToast(nextLocked ? "Current month payroll is now locked." : "Payroll unlocked for edits.", nextLocked ? "info" : "warning");
  };

  // Build one Monthly Score Records row per coach per evaluated month.
  const buildScoreTrackerRows = () => {
    const query = scoreSearch.trim().toLowerCase();

    return [...historicMonths, ...currentMonth]
      .map(record => {
        const coach = coaches.find(c => c.id === record.coach_id);
        if (!coach) return null;

        const vConfig = findVariant(variants, coach.variant_id);

        const inPeriod = violations.filter(v =>
          v.coach_id === coach.id &&
          v.status !== 'Appeal_Approved' &&
          new Date(v.incident_date) >= new Date(record.period_start) &&
          new Date(v.incident_date) <= new Date(record.period_end)
        );
        const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === record.period_month && o.status === 'Approved');

        const calc = computeHBPlusScore(coach, record, vConfig);
        const hbScore = record.hb_score != null ? record.hb_score : calc.hbScore;
        const band = record.band || getPerformanceBand(hbScore).label;
        const pay = computeMonthlyPay(coach, carryPay(record), { hbScore }, inPeriod, vConfig, coachOrgWork);
        const threshold = vConfig.rates[coach.coach_category]?.[band]?.threshold
          ?? (coach.coach_category === 'Fixed' ? (vConfig.discipline === 'Yoga' ? 117 : 156) : 96);

        return {
          id: `${coach.id}-${record.period_month}`,
          coachId: coach.id,
          variantId: coach.variant_id,
          weights: vConfig.weights,
          month: record.period_month,
          coach_id: coach.id,
          coach_name: coach.name,
          category: coach.coach_category || '—',
          designation: coach.internal_designation || 'Coach',
          exp_doc: Number(coach.freelance_past_exp_with_document) || 0,
          exp_nodoc: Number(coach.freelance_past_exp_without_document) || 0,
          exp_post_doj: calculateTenureYears(coach.date_of_joining, record.period_end),
          exp_coach_score: calc.breakdown.coachingExpYears * vConfig.weights.coaching_exp / 10,
          exp_non_coach_years: Number(coach.non_coaching_exp_years) || 0,
          exp_non_coach_score: calc.breakdown.nonCoachingExpYears * vConfig.weights.non_coaching_exp / 10,
          experience: calc.breakdown.expScore,
          edu_raw: calc.breakdown.eduScore,
          edu_score: calc.breakdown.eduScore * vConfig.weights.education / 10,
          cert_raw: calc.breakdown.certScore,
          cert_score: calc.breakdown.techScore - (calc.breakdown.eduScore * vConfig.weights.education / 10),
          technical: calc.breakdown.techScore,
          prof_appearance: record.prof_appearance,
          client_engagement: record.client_engagement,
          safety: record.safety,
          punctuality: record.punctuality,
          team_conduct: record.team_conduct,
          communication: record.communication,
          core_total: calc.breakdown.coreTotal,
          core: calc.breakdown.coreScore,
          tenure_years: calc.breakdown.tenureYears,
          org: calc.breakdown.tenureScore,
          meetings_scheduled: record.meetings_scheduled,
          meetings_attended: record.meetings_attended,
          attendance_pct: calc.breakdown.attendancePct,
          attendance: calc.breakdown.attendanceScore,
          hb_score: hbScore,
          band,
          coach_type: coach.coach_type || (vConfig ? (vConfig.discipline === 'S&C' ? 'Strength' : vConfig.discipline) : 'Strength'),
          range: `${new Date(record.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(record.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
          status: record.status,
          sessions: Number(record.sessions_completed) || 0,
          night_sessions: record.night_sessions,
          threshold,
          extra_sessions: pay.extraSessions,
          violations: inPeriod.length,
          late_count: inPeriod.filter(v => v.type && v.type.includes('Late Arrival')).length,
          noshow_count: inPeriod.filter(v => v.type && v.type.includes('No-Show')).length,
          milestone: pay.milestoneIncentive,
          consistency: pay.consistencyBonus,
          streak: Number(record.five_star_streak) || 0,
          missed_sessions: Number(record.missed_sessions) || 0,
          missed_penalty: pay.missedSessionDeduction
        };
      })
      .filter(Boolean)
      .filter(row => {
        const matchesSearch = !query || row.coach_name.toLowerCase().includes(query) || row.coach_id.toLowerCase().includes(query);
        const matchesMonth = scoreMonthFilter === "All" || row.month === scoreMonthFilter;
        const matchesCategory = scoreCategoryFilter === "All" || row.category === scoreCategoryFilter;
        const matchesVariant = matchesCoachType({ variant_id: row.variantId, coach_type: row.coach_type }, scoreVariantFilter);
        return matchesSearch && matchesMonth && matchesCategory && matchesVariant;
      })
      .sort((a, b) => {
        const av = a[scoreSort.key];
        const bv = b[scoreSort.key];
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return scoreSort.dir === 'asc' ? cmp : -cmp;
      });
  };

  // Each column declares how it renders: rupees, fixed decimals, or plain text.
  const formatScoreCell = (col, row) => {
    const value = row[col.key];
    if (col.money) return `\u20b9${Number(value).toLocaleString('en-IN')}`;
    if (col.decimals !== undefined) return Number(value).toFixed(col.decimals);
    return value;
  };

  const toggleScoreSort = (key) => {
    setScoreSort(prev => prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: 'asc' });
    setScorePage(1);
  };

  // ---------------------------------------------------------------------
  // Bulk upload. Tab-aware: each Score Tracker tab owns a set of manual
  // fields, and a template or upload covers exactly that set. Two scopes:
  //   period  — keyed in per month on the score card
  //   profile — one-time values on the coach record, which re-score every
  //             unlocked month, so they take no month
  // Nothing is written until the preview is accepted.
  // ---------------------------------------------------------------------
  const BULK_TABS = {
    experience: { scope: 'profile', fields: [
      { key: 'freelance_past_exp_with_document',    label: 'Past Experience With Document (yrs)' },
      { key: 'freelance_past_exp_without_document', label: 'Past Experience Without Document (yrs)' },
      { key: 'non_coaching_exp_years',              label: 'Non-Coaching Experience (yrs)', max: 10 }
    ]},
    technical: { scope: 'profile', fields: [
      { key: 'education_score_override', label: 'Non-Tech Educational Score (max 10)', max: 10 }
    ]},
    performance: { scope: 'period', fields: [
      { key: 'prof_appearance',    label: 'Professional Appearance (max 20)', max: 20 },
      { key: 'client_engagement',  label: 'Client Rating (max 20)', max: 20 },
      { key: 'safety',             label: 'Safety & Cleanliness (max 15)', max: 15 },
      { key: 'punctuality',        label: 'Punctuality & Documentation (max 10)', max: 10 },
      { key: 'team_conduct',       label: 'Team Conduct (max 15)', max: 15 },
      { key: 'communication',      label: 'Communication & Responsiveness (max 20)', max: 20 },
      { key: 'meetings_scheduled', label: 'Meetings Scheduled' },
      { key: 'meetings_attended',  label: 'Meetings Attended' }
    ]},
    incentive: { scope: 'period', fields: [
      { key: 'sessions_completed', label: 'Sessions Completed' },
      { key: 'night_sessions',     label: 'Night Sessions' },
      { key: 'five_star_streak',   label: '5-Star Streak' },
      { key: 'missed_sessions',    label: 'Missed Sessions' }
    ]}
  };

  const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

  // Quoted cells may contain commas, so split on commas outside quotes.
  const parseCsvLine = (line) => (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [])
    .slice(0, -1)
    .map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"').trim());

  const bulkPeriods = () => [...new Set([
    currentPeriodMonth,
    ...[...historicMonths, ...currentMonth].map(r => r.period_month)
  ])];

  const openBulkDialog = (mode, tabKey) => {
    const tab = BULK_TABS[tabKey];
    if (!tab) {
      showToast("This tab has no manual fields to enter — its values are calculated.", "warning");
      return;
    }
    setBulkDialog({ mode, tab: tabKey, month: currentPeriodMonth });
  };

  // A template pre-filled with what is already recorded, so people edit
  // numbers rather than type from blank.
  const downloadBulkTemplate = ({ tab: tabKey, month }) => {
    const tab = BULK_TABS[tabKey];
    const rows = [...coaches]
      .filter(c => c.status !== 'Exited')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(coach => {
        if (tab.scope === 'profile') {
          return [coach.id, coach.name, ...tab.fields.map(f => coach[f.key] ?? '')];
        }
        const rec = [...historicMonths, ...currentMonth]
          .find(r => r.coach_id === coach.id && r.period_month === month);
        if (!rec) return null;
        return [coach.id, coach.name, ...tab.fields.map(f => rec[f.key] ?? '')];
      })
      .filter(Boolean);

    if (rows.length === 0) {
      showToast(`No score cards exist for ${month}.`, "warning");
      return;
    }
    const header = ['Coach ID', 'Coach Name', ...tab.fields.map(f => f.label)];
    const csv = [header, ...rows].map(line => line.map(csvCell).join(',')).join('\n');
    const label = tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
    const suffix = tab.scope === 'profile' ? 'Profile' : month.replace(' ', '_');
    const link = document.createElement('a');
    link.setAttribute('href', encodeURI(`data:text/csv;charset=utf-8,${csv}`));
    link.setAttribute('download', `HB_${label}_Template_${suffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    logAudit("Bulk Template Downloaded",
      `Downloaded the ${label} template${tab.scope === 'profile' ? '' : ` for ${month}`} (${rows.length} coaches)`);
    setBulkDialog(null);
  };

  /**
   * A cell's value as typed, checked against its field. Empty means "leave it
   * as it is"; anything else must be a non-negative number within the max.
   */
  const checkBulkCell = (field, raw) => {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    if (text === '') return { value: null, error: null };
    const n = Number(text);
    if (!Number.isFinite(n)) return { value: null, error: `"${text}" is not a number` };
    if (n < 0) return { value: null, error: `${n} is below 0` };
    if (field.max !== undefined && n > field.max) return { value: null, error: `${n} is above max ${field.max}` };
    return { value: n, error: null };
  };

  /**
   * Read a file into an editable grid: one row per coach, one column per
   * field, as the template is laid out. A row that cannot take values (locked
   * month, no card for the month) is shown but not editable. Writes nothing.
   */
  const buildBulkPreview = (file, { tab: tabKey, month }) => {
    if (!file) return;
    const tab = BULK_TABS[tabKey];
    const reader = new FileReader();
    reader.onload = () => {
      const lines = String(reader.result).split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) {
        showToast("That file has no rows under its header.", "error");
        return;
      }
      const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
      const colIndex = {};
      tab.fields.forEach(f => {
        const i = header.indexOf(f.label.toLowerCase());
        if (i >= 0) colIndex[f.key] = i;
      });
      if (Object.keys(colIndex).length === 0) {
        showToast("None of this tab's columns are in that file — download this tab's template and edit that.", "error");
        return;
      }

      const rows = [], unknown = [];
      for (const cols of lines.slice(1).map(parseCsvLine)) {
        const coachId = cols[0];
        if (!coachId) continue;
        const coach = coaches.find(c => c.id === coachId);
        if (!coach) { unknown.push(coachId); continue; }

        let target = coach, skip = null;
        if (tab.scope === 'period') {
          target = [...historicMonths, ...currentMonth]
            .find(r => r.coach_id === coachId && r.period_month === month);
          if (!target) skip = `no score card for ${month}`;
          else if (target.status === 'FINANCE_LOCKED') skip = `${month} is locked`;
        }

        const cells = {};
        for (const f of tab.fields) {
          const current = target ? target[f.key] : null;
          const fromFile = colIndex[f.key] !== undefined ? cols[colIndex[f.key]] : undefined;
          cells[f.key] = {
            current: current === '' || current === undefined ? null : current,
            raw: fromFile !== undefined && fromFile !== '' ? fromFile : (current ?? '')
          };
        }
        rows.push({ coachId, name: coach.name, skip, cells });
      }

      setBulkDialog(null);
      setBulkPreview({ tab: tabKey, month, scope: tab.scope, fileName: file.name, fields: tab.fields, rows, unknown });
    };
    reader.readAsText(file);
  };

  const editBulkCell = (rowIndex, key, raw) =>
    setBulkPreview(pv => ({
      ...pv,
      rows: pv.rows.map((r, i) => i !== rowIndex ? r : {
        ...r, cells: { ...r.cells, [key]: { ...r.cells[key], raw } }
      })
    }));

  // Everything the grid currently says: what would change, and what is wrong.
  const summariseBulkPreview = (pv) => {
    let changes = 0, errors = 0;
    const patches = new Map();
    for (const row of pv.rows) {
      if (row.skip) continue;
      for (const f of pv.fields) {
        const cell = row.cells[f.key];
        const { value, error } = checkBulkCell(f, cell.raw);
        if (error) { errors++; continue; }
        if (value === null) continue;
        if (cell.current !== null && Number(cell.current) === value) continue;
        changes++;
        patches.set(row.coachId, { ...(patches.get(row.coachId) || {}), [f.key]: value });
      }
    }
    return { changes, errors, patches };
  };

  const rescore = (coach, record) => {
    const vCfg = variants.find(v => v.id === coach?.variant_id);
    if (!coach || !vCfg) return record;
    const calc = computeHBPlusScore(coach, record, vCfg);
    return { ...record, hb_score: calc.hbScore, band: getPerformanceBand(calc.hbScore).label };
  };

  /**
   * Apply the grid. With errors present this refuses unless bypassed; a
   * bypass applies every valid change and leaves the error cells out.
   */
  const applyBulkPreview = (bypass = false) => {
    const pv = bulkPreview;
    if (!pv) return;
    const { changes, errors, patches } = summariseBulkPreview(pv);
    if (errors && !bypass) {
      showToast(`${errors} cell${errors === 1 ? ' has' : 's have'} an error — fix ${errors === 1 ? 'it' : 'them'}, or bypass to apply the rest.`, "error");
      return;
    }
    if (changes === 0) {
      // Nothing differs from what is recorded, so there is nothing to write —
      // but the upload is valid and is accepted as such.
      logAudit("Bulk Upload Applied",
        `${pv.tab}: ${pv.fileName} matched what is recorded — no changes needed`);
      showToast("Saved — every value already matches what is recorded.");
      setBulkPreview(null);
      return;
    }

    if (pv.scope === 'profile') {
      const updatedCoaches = coaches.map(c => patches.has(c.id) ? { ...c, ...patches.get(c.id) } : c);
      setCoaches(updatedCoaches);
      // Profile values feed every month's score. Re-score the unlocked ones;
      // a locked month is settled and keeps the score it was locked with.
      const reScoreList = (list) => list.map(r => {
        if (!patches.has(r.coach_id) || r.status === 'FINANCE_LOCKED') return r;
        return rescore(updatedCoaches.find(c => c.id === r.coach_id), r);
      });
      setCurrentMonth(prev => reScoreList(prev));
      setHistoricMonths(prev => reScoreList(prev));
    } else {
      const patchList = (list) => list.map(r => {
        if (r.period_month !== pv.month || !patches.has(r.coach_id) || r.status === 'FINANCE_LOCKED') return r;
        const updated = { ...r, ...patches.get(r.coach_id) };
        const scheduled = Number(updated.meetings_scheduled) || 0;
        if (scheduled > 0) {
          updated.attendance_pct = Math.round(((Number(updated.meetings_attended) || 0) / scheduled) * 10000) / 100;
        }
        return rescore(coaches.find(c => c.id === r.coach_id), updated);
      });
      setCurrentMonth(prev => patchList(prev));
      setHistoricMonths(prev => patchList(prev));
    }

    const skipped = pv.rows.filter(r => r.skip).length;
    const where = pv.scope === 'profile' ? 'coach profiles' : pv.month;
    logAudit(bypass ? "Bulk Upload Applied (errors bypassed)" : "Bulk Upload Applied",
      `${pv.tab}: ${changes} change${changes === 1 ? '' : 's'} across ${patches.size} coach${patches.size === 1 ? '' : 'es'} → ${where} from ${pv.fileName}` +
      (skipped ? `; ${skipped} row${skipped === 1 ? '' : 's'} skipped` : '') +
      (errors ? `; ${errors} error cell${errors === 1 ? '' : 's'} bypassed and not applied` : '') +
      (pv.unknown.length ? `; ${pv.unknown.length} unknown coach ID${pv.unknown.length === 1 ? '' : 's'}` : ''));
    showToast(`${changes} change${changes === 1 ? '' : 's'} applied to ${where}` +
      (errors ? ` — ${errors} error cell${errors === 1 ? '' : 's'} left out.` : '.'));
    setBulkPreview(null);
  };

  const cancelBulkPreview = () => {
    if (bulkPreview) {
      logAudit("Bulk Upload Discarded", `Discarded ${bulkPreview.fileName} for ${bulkPreview.tab} without applying it`);
    }
    setBulkPreview(null);
  };

  const handleExportScoreTracker = () => {
    const rows = buildScoreTrackerRows();
    // Export what the role can see: a download must not carry columns the
    // screen withheld.
    const cols = SCORE_TRACKER_COLUMNS.filter(c => !(c.money && HIDES_PAY(currentRole)));
    const header = cols.map(c => `"${c.label}"`).join(",");
    const body = rows.map(row => cols.map(c => `"${row[c.key]}"`).join(",")).join("\n");

    const encodedUri = encodeURI(`data:text/csv;charset=utf-8,${header}\n${body}`);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `HB_Monthly_Score_Records_${scoreMonthFilter.replace(' ', '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    logAudit("Score Records Exported", `Exported ${rows.length} monthly score records (${scoreMonthFilter}) to CSV`);
    showToast("Monthly score records CSV downloaded.");
  };

  // Payroll runs straight off the score cards: no pay input is keyed in here,
  // every line is derived from the period's recorded HB+ Score.
  const buildPayrollRun = (periodMonth) => {
    const records = [...historicMonths, ...currentMonth].filter(r => r.period_month === periodMonth);

    return records.map(record => {
      const coach = coaches.find(c => c.id === record.coach_id);
      if (!coach) return null;
      const vConfig = findVariant(variants, coach.variant_id);

      const { score, band } = resolvePeriodScore(coach, record, vConfig);
      const coachVios = violations.filter(v => v.coach_id === coach.id && v.status !== 'Appeal_Approved');
      const periodVios = coachVios.filter(v =>
        new Date(v.incident_date) >= new Date(record.period_start) &&
        new Date(v.incident_date) <= new Date(record.period_end)
      );
      const periodOrgWork = orgWork.filter(o =>
        o.coach_id === coach.id && o.period_month === periodMonth && o.status === 'Approved'
      );
      const pay = computeMonthlyPay(coach, carryPay(record), { hbScore: score }, periodVios, vConfig, periodOrgWork);

      return {
        coach, record, vConfig, score, band, pay, periodVios, coachVios,
        recorded: MANUAL_PERIOD_FIELDS.some(f => record[f] !== null && record[f] !== undefined)
      };
    }).filter(Boolean).sort((a, b) => a.coach.id.localeCompare(b.coach.id));
  };

  const handleExportPayrollRun = (periodMonth) => {
    // Export what is on screen: the run is filtered by category in the view,
    // so a download taken while filtered must carry the same rows.
    const rows = buildPayrollRun(periodMonth).filter(
      r => payrollCategoryFilter === "All" || r.coach.coach_category === payrollCategoryFilter
    );
    const header = ["Coach ID", "Coach Name", "Category", "Score Card", "HB+ Score", "Band", "Per-Session Rate",
      "Base Pay", "Extra Sessions", "Extra Session Pay", "Session Pay", "Night Premium",
      "Milestone", "Consistency", "Streak Bonus", "Org Work", "Penalty", "Gross Pay"];
    const body = rows.map(r => [
      r.coach.id, r.coach.name, r.coach.coach_category,
      r.recorded ? "Recorded" : "NOT RECORDED — fixed points only",
      r.score, r.recorded ? r.band : "Awaiting entry", r.pay.perSessionRate,
      r.pay.basePay, r.pay.extraSessions, r.pay.extraSessionPay, r.pay.sessionPay, r.pay.nightSessionPay,
      r.pay.milestoneIncentive, r.pay.consistencyBonus, r.pay.streakBonusPay, r.pay.orgWorkPay,
      r.pay.penaltyDeductions, r.pay.grossPay
    ].map(v => `"${v}"`).join(","));

    const encodedUri = encodeURI(`data:text/csv;charset=utf-8,${header.map(h => `"${h}"`).join(",")}\n${body.join("\n")}`);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const categoryTag = payrollCategoryFilter === "All" ? '' : `_${payrollCategoryFilter.replace('-', '')}`;
    link.setAttribute("download", `HB_Payroll_Run_${periodMonth.replace(' ', '_')}${categoryTag}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    const unrecorded = rows.filter(r => !r.recorded).length;
    logAudit(
      "Payroll Run Exported",
      `Exported the ${periodMonth} payroll run (${rows.length} coaches` +
      (payrollCategoryFilter === "All" ? '' : `, ${payrollCategoryFilter} only`) + `) to CSV` +
      (unrecorded ? ` — ${unrecorded} score card${unrecorded > 1 ? 's' : ''} not recorded, paid on fixed points only` : '')
    );
    showToast(`${periodMonth} payroll run downloaded.`);
  };

  // Export CSV
  const handleExportCSV = () => {
    const dataset = payrollMonthFilter === currentPeriodMonth ? currentMonth : historicMonths;
    let csvContent = "data:text/csv;charset=utf-8,Coach ID,Name,Category,HB+ Score,Band,Base Pay,Session Pay,Incentives,Penalty,Gross Pay,Status\n";

    dataset.forEach(e => {
      const coach = coaches.find(c => c.id === e.coach_id);
      if (!coach) return;
      const matchesV = matchesCoachType(coach, payrollVariantFilter);
      if (!matchesV) return;

      const vConfig = findVariant(variants, coach.variant_id);
      const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
      const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

      const calcScoreObj = e.hb_score != null ? e : computeHBPlusScore(coach, e, vConfig);
      const pay = computeMonthlyPay(coach, carryPay(e), calcScoreObj, activeVio, vConfig, coachOrgWork);

      const scoreVal = calcScoreObj.hbScore || calcScoreObj.hb_score;
      const bandVal = calcScoreObj.band || getPerformanceBand(scoreVal).label;
      const incSum = pay.milestoneIncentive + pay.consistencyBonus + pay.streakBonusPay + pay.orgWorkPay + pay.trialIncentive + pay.eventIncentive + pay.hopOohPremium + pay.hopPtHomePremium + pay.hopPerformanceCreditsPay;

      csvContent += `"${coach.id}","${coach.name}","${coach.coach_category}",${scoreVal},"${bandVal}",${pay.basePay},${pay.extraSessionPay + pay.sessionPay},${incSum},${pay.penaltyDeductions},${pay.grossPay},"${e.status}"\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `HB_Payroll_${payrollMonthFilter.replace(' ', '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    logAudit("Payroll Exported", `Exported payroll data ledger CSV for ${payrollMonthFilter}`);
    showToast("Payroll ledger CSV generated & downloaded.");
  };

  // ---------------------------------------------------------------
  // User Access: assign roles to people who have signed in
  // ---------------------------------------------------------------
  const refreshAppUsers = async () => {
    if (!isSupabaseConfigured || !session) return;
    setAppUsersLoading(true);
    setAppUsersError("");
    try {
      const rows = await listAppUsers();
      setAppUsers(rows);
      // Seed the per-row drafts so the selects are controlled from the start.
      setUserDrafts(Object.fromEntries(rows.map(u => [
        u.id, { role: u.role, coachId: u.coach_id || "", rmId: u.rm_id || "" }
      ])));
    } catch (e) {
      setAppUsersError(e.message || String(e));
    }
    setAppUsersLoading(false);
  };

  // Admins get the list up front so the sidebar can badge accounts waiting on
  // a role; everyone else never pays for the round trip.
  const isAccessAdmin = ["Super Admin", "HR Manager"].includes(profile?.role);

  useEffect(() => {
    if (!isAccessAdmin) return;
    if (activeView === 'user-access' || appUsers.length === 0) refreshAppUsers();
  }, [activeView, session?.user?.id, isAccessAdmin]);

  const pendingAccessCount = appUsers.filter(u => u.role === 'Coach' && !u.coach_id).length;

  const updateUserDraft = (id, patch) =>
    setUserDrafts(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const handleSaveUserAccess = async (user) => {
    const draft = userDrafts[user.id];
    if (!draft) return;

    // Mirror the checks the RPC enforces, so the user gets told before the
    // round trip rather than after it.
    if (draft.role === 'Coach' && !draft.coachId) {
      showToast("Pick the coach record this account belongs to.", "danger");
      return;
    }
    if (draft.role === 'Reporting Manager' && !draft.rmId) {
      showToast("Pick which squad this manager reviews.", "danger");
      return;
    }

    setSavingUserId(user.id);
    try {
      const updated = await setUserAccess({
        id: user.id,
        role: draft.role,
        coachId: draft.coachId,
        rmId: draft.rmId
      });
      setAppUsers(prev => prev.map(u => u.id === user.id
        ? { ...u, role: updated.role, coach_id: updated.coach_id, rm_id: updated.rm_id,
            coach_name: coaches.find(c => c.id === updated.coach_id)?.name ?? null }
        : u));
      // No logAudit here: admin_set_access already writes the audit row
      // server-side, where it cannot be skipped by a client that never runs.
      showToast(`${user.full_name || user.email} is now ${draft.role}.`);
    } catch (e) {
      showToast(e.message || String(e), "danger");
    }
    setSavingUserId(null);
  };

  const userAccessDirty = (u) => {
    const d = userDrafts[u.id];
    if (!d) return false;
    return d.role !== u.role
      || (d.coachId || "") !== (u.coach_id || "")
      || (d.rmId || "") !== (u.rm_id || "");
  };

  // Switch Active role context handler
  const handleRoleSelectChange = (role) => {
    setCurrentRole(role);
    if (role === "Coach" && coaches.length > 0 && !currentCoachContext) {
      setCurrentCoachContext(coaches[0].id);
    }
    
    // Auto redirection if the active view is blocked for this role
    const items = [
      { view: "dashboard", roles: null },
      { view: "coaches", roles: "Super Admin,HR Manager,Finance,Reporting Manager,Showrunner,Auditor" },
      { view: "score-tracker", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor" },
      { view: "pay-calculator", roles: "Super Admin,HR Manager,Finance,Reporting Manager,Auditor" },
      { view: "evaluations", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor" },
      { view: "violations", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor" },
      { view: "payroll", roles: "Super Admin,HR Manager,Finance,Reporting Manager,Auditor" },
      { view: "appeals", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Coach,Auditor" },
      { view: "certifications", roles: "Super Admin,HR Manager" },
      { view: "penalties", roles: "Super Admin,HR Manager,Finance,Reporting Manager,Showrunner" },
      { view: "settings", roles: "Super Admin,HR Manager,Finance,Reporting Manager" },
      { view: "audit", roles: "Super Admin,Auditor" }
    ];

    if (!isViewEnabled(activeView)) {
      setActiveView("dashboard");
    }

    const activeDef = items.find(item => item.view === activeView);
    if (activeDef && activeDef.roles) {
      const isAllowed = activeDef.roles.split(",").includes(role);
      if (!isAllowed) {
        setActiveView("dashboard");
      }
    }
    logAudit("Role Switched", `Switched interface view context to: ${role}`);
  };

  // If initial load hasn't occurred, show a placeholder loading screen
  if (!isStateLoaded) {
    return <div style={{ background: '#f5f2e9', color: '#1a1a1a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>Loading Remuneration Workspace...</div>;
  }

  // Active coach state reference
  const currentSelectedCoach = coaches.find(c => c.id === currentCoachContext);

  // The open performance period, derived from state rather than hardcoded, so
  // the calendar rollover carries through every view.
  const openPeriod = currentMonth[0] || getPeriodForDate(new Date());
  const currentPeriodMonth = openPeriod.period_month;
  const currentPeriodRange = `${new Date(openPeriod.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} - ${new Date(openPeriod.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;

  return (
    <div className="app-container">
      {/* Toast Notification Mount */}
      <div id="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast-msg toast-${t.type}`} style={{ opacity: 1, transform: 'translateX(0)' }}>
            <i className={`bx bx-${t.type === 'danger' ? 'error' : (t.type === 'warning' ? 'error-circle' : (t.type === 'info' ? 'info-circle' : 'check-circle'))}`}></i>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      {/* Sidebar Navigation */}
      <aside className={`sidebar ${sidebarActive ? 'active-sidebar' : ''}`}>
        <div className="brand">
          <div className="brand-logo">
            <i className="bx bx-pulse brand-icon"></i>
          </div>
          <div className="brand-text">
            <h2>HB<span>+</span></h2>
            <p>Remuneration &amp; Performance</p>
          </div>
        </div>

        <nav className="nav-menu">
          <ul>
            <li className={`nav-item ${activeView === 'dashboard' ? 'active' : ''}`} onClick={() => handleNavClick('dashboard')}>
              <a href="#dashboard"><i className="bx bxs-dashboard nav-icon"></i><span>Dashboard</span></a>
            </li>
            {verifyAccess("Super Admin,HR Manager,Finance,Reporting Manager,Showrunner,Auditor") && (
              <li className={`nav-item ${activeView === 'coaches' ? 'active' : ''}`} onClick={() => handleNavClick('coaches', "Super Admin,HR Manager,Finance,Reporting Manager,Showrunner,Auditor")}>
                <a href="#coaches"><i className="bx bxs-group nav-icon"></i><span>Coach Master</span></a>
              </li>
            )}
            {isViewEnabled('score-tracker') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor") && (
              <li className={`nav-item ${activeView === 'score-tracker' ? 'active' : ''}`} onClick={() => handleNavClick('score-tracker', "Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor")}>
                <a href="#score-tracker"><i className="bx bxs-spreadsheet nav-icon"></i><span>Score Tracker</span></a>
              </li>
            )}
            {isViewEnabled('pay-calculator') && verifyAccess("Super Admin,HR Manager,Finance,Reporting Manager,Auditor") && (
              <li className={`nav-item ${activeView === 'pay-calculator' ? 'active' : ''}`} onClick={() => handleNavClick('pay-calculator', "Super Admin,HR Manager,Finance,Reporting Manager,Auditor")}>
                <a href="#pay-calculator"><i className="bx bxs-calculator nav-icon"></i><span>Payroll Calculator</span></a>
              </li>
            )}
            {isViewEnabled('attendance') && verifyAccess(ATTENDANCE_ROLES.join(',')) && (
              <li className={`nav-item ${activeView === 'attendance' ? 'active' : ''}`} onClick={() => handleNavClick('attendance', ATTENDANCE_ROLES.join(','))}>
                <a href="#attendance"><i className="bx bxs-time-five nav-icon"></i><span>Attendance &amp; Leave</span></a>
              </li>
            )}
            {isViewEnabled('evaluations') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor") && (
              <li className={`nav-item ${activeView === 'evaluations' ? 'active' : ''}`} onClick={() => handleNavClick('evaluations', "Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor")}>
                <a href="#evaluations"><i className="bx bxs-medal nav-icon"></i><span>Evaluations</span></a>
              </li>
            )}
            {isViewEnabled('violations') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor") && (
              <li className={`nav-item ${activeView === 'violations' ? 'active' : ''}`} onClick={() => handleNavClick('violations', "Super Admin,HR Manager,Reporting Manager,Finance,Showrunner,Auditor")}>
                <a href="#violations"><i className="bx bxs-error-circle nav-icon"></i><span>Violation Register</span></a>
              </li>
            )}
            {isViewEnabled('payroll') && verifyAccess("Super Admin,HR Manager,Finance,Reporting Manager,Auditor") && (
              <li className={`nav-item ${activeView === 'payroll' ? 'active' : ''}`} onClick={() => handleNavClick('payroll', "Super Admin,HR Manager,Finance,Reporting Manager,Auditor")}>
                <a href="#payroll"><i className="bx bx-rupee nav-icon"></i><span>Payroll &amp; Incentives</span></a>
              </li>
            )}
            {isViewEnabled('appeals') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Coach,Auditor") && (
              <li className={`nav-item ${activeView === 'appeals' ? 'active' : ''}`} onClick={() => handleNavClick('appeals', "Super Admin,HR Manager,Reporting Manager,Finance,Coach,Auditor")}>
                <a href="#appeals"><i className="bx bxs-conversation nav-icon"></i><span>Appeals Panel</span></a>
              </li>
            )}
            {isViewEnabled('user-access') && verifyAccess("Super Admin") && (
              <li className={`nav-item ${activeView === 'user-access' ? 'active' : ''}`} onClick={() => handleNavClick('user-access', "Super Admin")}>
                <a href="#user-access">
                  <i className="bx bxs-shield nav-icon"></i><span>User Access</span>
                  {pendingAccessCount > 0 && <span className="nav-pill">{pendingAccessCount}</span>}
                </a>
              </li>
            )}
            {isViewEnabled('penalties') && verifyAccess("Super Admin,HR Manager,Finance,Reporting Manager,Showrunner") && (
              <li className={`nav-item ${activeView === 'penalties' ? 'active' : ''}`} onClick={() => handleNavClick('penalties', "Super Admin,HR Manager,Finance,Reporting Manager,Showrunner")}>
                <a href="#penalties"><i className="bx bx-error-circle nav-icon"></i><span>Penalties</span></a>
              </li>
            )}
            {isViewEnabled('certifications') && verifyAccess("Super Admin,HR Manager") && (
              <li className={`nav-item ${activeView === 'certifications' ? 'active' : ''}`} onClick={() => handleNavClick('certifications', "Super Admin,HR Manager")}>
                <a href="#certifications"><i className="bx bxs-medal nav-icon"></i><span>Certifications</span></a>
              </li>
            )}
            {isViewEnabled('settings') && verifyAccess("Super Admin,HR Manager,Finance,Reporting Manager") && (
              <li className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => handleNavClick('settings', "Super Admin,HR Manager,Finance,Reporting Manager")}>
                <a href="#settings"><i className="bx bxs-cog nav-icon"></i><span>Settings &amp; Variants</span></a>
              </li>
            )}
            {isViewEnabled('audit') && verifyAccess("Super Admin,Auditor") && (
              <li className={`nav-item ${activeView === 'audit' ? 'active' : ''}`} onClick={() => handleNavClick('audit', "Super Admin,Auditor")}>
                <a href="#audit"><i className="bx bx-history nav-icon"></i><span>Audit Trails</span></a>
              </li>
            )}
          </ul>
        </nav>

        {/* Sidebar Profile Card footer context */}
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar" id="avatar-icon" style={{
              background: currentRole === "Super Admin" ? "linear-gradient(135deg, var(--accent-violet), var(--accent-blue))" :
                          currentRole === "HR Manager" ? "linear-gradient(135deg, var(--accent-teal), var(--accent-blue))" :
                          currentRole === "Finance" ? "linear-gradient(135deg, var(--accent-violet), var(--accent-teal))" :
                          currentRole === "Showrunner" ? "linear-gradient(135deg, var(--accent-amber), var(--accent-teal))" :
                          currentRole === "Reporting Manager" ? "linear-gradient(135deg, var(--accent-blue), var(--accent-teal))" :
                          "linear-gradient(135deg, var(--accent-teal), var(--accent-amber))"
            }}>
              {currentRole === "Super Admin" ? "SA" :
               currentRole === "HR Manager" ? "HR" :
               currentRole === "Finance" ? "FN" :
               currentRole === "Showrunner" ? "SR" :
               currentRole === "Reporting Manager" ? "RM" :
               (currentSelectedCoach ? currentSelectedCoach.name.substring(0, 2).toUpperCase() : "CH")}
            </div>
            <div className="user-details">
              <h4 id="user-display-name">
                {currentRole === "Super Admin" ? "Super Admin" :
                 currentRole === "HR Manager" ? "HR Manager" :
                 currentRole === "Finance" ? "Finance Officer" :
                 currentRole === "Showrunner" ? "Showrunner" :
                 currentRole === "Reporting Manager" ? 
                   (currentRmContext === "RM_01" ? "S&C RM (Lead)" : currentRmContext === "RM_02" ? "Yoga RM (Lead)" : "HOP RM (Lead)") :
                 (currentSelectedCoach ? currentSelectedCoach.name : "Coach Profile")}
              </h4>
              <span id="user-display-role">
                {currentRole === "Super Admin" ? "System Root" :
                 currentRole === "HR Manager" ? "HR Department" :
                 currentRole === "Finance" ? "Accounts & Payroll" :
                 currentRole === "Showrunner" ? "Scheduling & Roster" :
                 currentRole === "Reporting Manager" ? "Reporting Manager" :
                 `Coach ID: ${currentCoachContext}`}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="main-content">
        {/* A failed write means the screen and the database disagree — say so
            loudly rather than letting the user keep typing into a void. Lives
            inside the content column: .app-container is a row, so a banner
            placed there would sit beside the page rather than above it. */}
        {syncError && (
          <div className="sync-banner">
            <i className="bx bx-cloud-off"></i>
            <span><strong>Not saved to Supabase:</strong> {syncError}</span>
            <button type="button" onClick={() => setSyncError("")}>Dismiss</button>
          </div>
        )}
        <header className="top-header">
          <div className="header-left">
            <div className="menu-toggle" onClick={() => setSidebarActive(!sidebarActive)}>
              <i className="bx bx-menu" id="btn-sidebar-toggle"></i>
            </div>
            <div className="header-title">
              <h1 id="page-title">{VIEW_TITLES[activeView] || (activeView.charAt(0).toUpperCase() + activeView.slice(1))}</h1>
              <p id="header-period-info">Performance Period: <strong className="text-teal">{currentPeriodMonth}</strong> ({currentPeriodRange}) — <span className={`badge ${payrollLocked ? 'badge-danger' : 'badge-warning'}`} id="calendar-lock-status">{payrollLocked ? 'LOCKED' : 'Active (Unlocked)'}</span></p>
            </div>
          </div>

          {/* Role Switching & Selector contexts */}
          <div className="header-right">
            <div className="control-group">
              <label htmlFor="role-select">
                <i className="bx bxs-user-badge"></i> {canSwitchRole ? "View Role" : "Signed In As"}
              </label>
              {canSwitchRole ? (
                <select id="role-select" className="header-select" value={currentRole} onChange={(e) => handleRoleSelectChange(e.target.value)}>
                  <option value="Super Admin">Super Admin</option>
                  <option value="HR Manager">HR Manager</option>
                  <option value="Reporting Manager">Reporting Manager</option>
                  <option value="Finance">Finance / Payroll</option>
                  <option value="Showrunner">Showrunner</option>
                  {/* Coaches sign in for attendance and leave, so the role has
                      to be previewable — a Super Admin needs to see what a
                      coach sees before telling one to use it. */}
                  <option value="Coach">Coach</option>
                </select>
              ) : (
                /* Non-admins get their app_users role, not a picker — RLS would
                   reject the writes another role's screens allow anyway. */
                <span className="header-role-fixed">{currentRole}</span>
              )}
            </div>

            {onSignOut && (
              <div className="control-group">
                <label><i className="bx bx-user-circle"></i> Account</label>
                <button type="button" className="header-signout" onClick={onSignOut}
                        title={session?.user?.email || ''}>
                  <i className="bx bx-log-out"></i> Sign Out
                </button>
              </div>
            )}

            {currentRole === "Reporting Manager" && (
              <div className="control-group" id="rm-context-group">
                <label htmlFor="rm-select"><i className="bx bx-user"></i> Active RM</label>
                <select id="rm-select" className="header-select" value={currentRmContext} onChange={(e) => setCurrentRmContext(e.target.value)}>
                  <option value="RM_01">RM 01 (S&amp;C Manager)</option>
                  <option value="RM_02">RM 02 (Yoga Manager)</option>
                  <option value="RM_03">RM 03 (HOP Manager)</option>
                </select>
              </div>
            )}

            {currentRole === "Coach" && (
              <div className="control-group" id="coach-context-group">
                <label htmlFor="coach-select"><i className="bx bxs-user-detail"></i> Select Coach</label>
                <select id="coach-select" className="header-select" value={currentCoachContext} onChange={(e) => handleCoachSelectChange(e.target.value)}>
                  {coaches.map(c => (
                    <option key={c.id} value={c.id}>{c.id} - {c.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </header>

        {/* Dynamic Inner views */}
        <div className="view-content-wrapper">
          {/* Dashboard View */}
          {activeView === 'dashboard' && (
            <section id="view-dashboard" className="content-view active-view">
              {/* A coach sees their own month and nothing else: what they have
                  worked, what leave they hold, how they scored, what has been
                  charged, and what they were paid. Everything here is read-only
                  — recording happens on Attendance & Leave. */}
              {currentRole === 'Coach' && (() => {
                const me = coaches.find(c => c.id === selfCoachId);
                if (!me) {
                  return (
                    <div className="card">
                      <h3>Your account is not linked to a coach profile yet</h3>
                      <p className="text-muted">
                        Ask Human Resources to link {profile?.email || 'this account'} to your
                        Coach Master record. Until then there is nothing to show.
                      </p>
                    </div>
                  );
                }

                const myRecord = currentMonth.find(r => r.coach_id === me.id);
                const vCfg = findVariant(variants, me.variant_id);
                const myScore = myRecord ? resolvePeriodScore(me, myRecord, vCfg) : null;
                const open = openLogFor(me.id);
                const todays = logsFor(me.id, todayWorkingDay);
                const hoursToday = loggedHoursForDay(todays, nowTick);
                const expected = standardDailyHours(me.coach_category);
                const myLeave = leaveApplications.filter(a => a.coach_id === me.id);
                const myVios = violations.filter(v => v.coach_id === me.id && v.status !== 'Appeal_Approved');
                const periodVios = myRecord ? myVios.filter(v =>
                  new Date(v.incident_date) >= new Date(myRecord.period_start) &&
                  new Date(v.incident_date) <= new Date(myRecord.period_end)) : [];

                return (
                  <>
                    {isPreviewingCoach && (
                      <div className="unsaved-drafts-bar" style={{ marginBottom: '1rem' }}>
                        <i className="bx bx-show"></i>
                        <span>
                          <strong>Previewing as a coach</strong>
                          <small>
                            This account is not a coach, so {me.name}'s record stands in.
                            Logging in or applying for leave here would be recorded against them.
                          </small>
                        </span>
                      </div>
                    )}
                    <div className="page-header-row">
                      <div>
                        <h2>{me.name}</h2>
                        <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                          {me.id} · {me.coach_type || vCfg.discipline} · {me.coach_category}
                          {me.employment_stage ? ` · ${me.employment_stage}` : ''}
                        </p>
                      </div>
                      <button
                        className={open ? 'btn btn-secondary' : 'btn btn-primary'}
                        onClick={() => open ? handleAttendanceLogout(me) : handleAttendanceLogin(me)}
                      >
                        <i className={`bx ${open ? 'bx-log-out' : 'bx-log-in'}`}></i>
                        {open ? ' Log out' : ' Log in'}
                      </button>
                    </div>

                    <div className="stats-row">
                      <div className="stat-card stat-teal">
                        <div className="stat-icon"><i className="bx bxs-time-five"></i></div>
                        <div className="stat-info">
                          <h3>Today</h3>
                          <h2 className={open ? 'att-ticking' : ''}>{asClock(hoursToday)}</h2>
                          <p>
                            {hoursToday >= expected
                              ? `Done — ${asClock(hoursToday - expected)} beyond ${expected} h`
                              : `${asClock(expected - hoursToday)} still to log of ${expected} h`}
                          </p>
                        </div>
                      </div>
                      <div className="stat-card stat-violet">
                        <div className="stat-icon"><i className="bx bxs-medal"></i></div>
                        <div className="stat-info">
                          <h3>HB+ Score</h3>
                          <h2>{myScore?.score != null ? Number(myScore.score).toFixed(2) : '—'}</h2>
                          <p>{myScore?.band || 'Not scored yet'} · {currentPeriodMonth}</p>
                        </div>
                      </div>
                      <div className="stat-card stat-amber">
                        <div className="stat-icon"><i className="bx bxs-calendar"></i></div>
                        <div className="stat-info">
                          <h3>Paid Leave Left</h3>
                          <h2>{leaveBalanceFor(me, 'PAID').available}</h2>
                          <p>{myLeave.filter(a => a.status === 'Pending').length} application(s) pending</p>
                        </div>
                      </div>
                      <div className="stat-card stat-red">
                        <div className="stat-icon"><i className="bx bxs-error-circle"></i></div>
                        <div className="stat-info">
                          <h3>Incidents This Cycle</h3>
                          <h2>{periodVios.length}</h2>
                          <p>{myVios.length} on record overall</p>
                        </div>
                      </div>
                    </div>

                    <div className="card" style={{ marginTop: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Your Leave</h3>
                        <button className="btn btn-secondary btn-sm"
                          onClick={() => setActiveView('attendance')}>
                          Apply or cancel
                        </button>
                      </div>
                      {myLeave.length === 0 ? (
                        <p className="text-muted">Nothing applied for yet.</p>
                      ) : (
                        <div className="table-container">
                          <table className="data-table">
                            <thead><tr><th>Type</th><th>Dates</th><th className="num-col">Days</th><th>Status</th><th>Note</th></tr></thead>
                            <tbody>
                              {myLeave.slice(0, 8).map(a => (
                                <tr key={a.id}>
                                  <td>{leaveType(a.type_id)?.label}</td>
                                  <td>{a.from_date} → {a.to_date}</td>
                                  <td className="num-col">{a.days}</td>
                                  <td>
                                    <span className={`badge ${
                                      a.status === 'Approved' ? 'badge-success'
                                        : a.status === 'Rejected' ? 'badge-danger'
                                        : a.status === 'Cancelled' ? 'badge-muted' : 'badge-warning'}`}>
                                      {a.status}
                                    </span>
                                  </td>
                                  <td><small className="text-muted">{a.decision_note || a.cancel_note || '—'}</small></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    <div className="card" style={{ marginTop: '1.25rem' }}>
                      <h3>Incidents on Record</h3>
                      {myVios.length === 0 ? (
                        <p className="text-muted">Nothing recorded.</p>
                      ) : (
                        <div className="table-container">
                          <table className="data-table">
                            <thead><tr><th>Date</th><th>Violation</th><th className="num-col">Occurrence</th><th>Consequence</th><th className="num-col">Charged</th></tr></thead>
                            <tbody>
                              {myVios.slice(0, 10).map(v => (
                                <tr key={v.id}>
                                  <td>{new Date(v.incident_date).toLocaleDateString('en-IN')}</td>
                                  <td><strong>{v.type}</strong></td>
                                  <td className="num-col">#{v.occurrence_no}</td>
                                  <td><small className="text-muted">{v.consequence}</small></td>
                                  <td className="num-col">
                                    {isPenaltyChargeable(v)
                                      ? rupees(v.penalty_amount)
                                      : <span className="text-muted">waived</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      <p className="calc-notes">
                        A decision you disagree with can be appealed. Speak to your Reporting
                        Manager, who can raise it.
                      </p>
                    </div>

                    <div className="card" style={{ marginTop: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Payslips</h3>
                      </div>
                      <div className="table-container">
                        <table className="data-table">
                          <thead><tr><th>Period</th><th>Status</th><th className="actions-col">Payslip</th></tr></thead>
                          <tbody>
                            {[...historicMonths, ...currentMonth]
                              .filter(r => r.coach_id === me.id)
                              .sort((a, b) => new Date(b.period_start) - new Date(a.period_start))
                              .map(r => (
                                <tr key={r.period_month}>
                                  <td><strong>{r.period_month}</strong></td>
                                  <td>
                                    <span className={`badge ${r.status === 'FINANCE_LOCKED' ? 'badge-success' : 'badge-warning'}`}>
                                      {r.status === 'FINANCE_LOCKED' ? 'Settled' : 'Not settled'}
                                    </span>
                                  </td>
                                  <td className="actions-col">
                                    {r.status === 'FINANCE_LOCKED' ? (
                                      <button className="btn btn-secondary btn-sm"
                                        onClick={() => handleOpenPayslipModal(me.id, r.period_month)}>
                                        <i className="bx bx-download"></i> View
                                      </button>
                                    ) : (
                                      <span className="text-muted">available once settled</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                );
              })()}

              {(currentRole === "Super Admin" || currentRole === "HR Manager") && (
                <>
                  <div className="stats-row">
                    <div className="stat-card stat-teal">
                      <div className="stat-icon"><i className="bx bxs-group"></i></div>
                      <div className="stat-info">
                        <h3>Active Coaches</h3>
                        <h2>{coaches.filter(c => c.status === 'Active').length} / {coaches.length}</h2>
                        <p>Direct &amp; Partners</p>
                      </div>
                    </div>
                    <div className="stat-card stat-violet">
                      <div className="stat-icon"><i className="bx bxs-check-circle"></i></div>
                      <div className="stat-info">
                        <h3>Evaluations Done</h3>
                        <h2>{currentMonth.filter(e => e.status !== 'DRAFT').length} / {coaches.filter(c => c.status === 'Active').length}</h2>
                        <p>{currentPeriodMonth} performance cycle</p>
                      </div>
                    </div>
                    <div className="stat-card stat-amber">
                      <div className="stat-icon"><i className="bx bxs-shield-alt"></i></div>
                      <div className="stat-info">
                        <h3>Pending HR Review</h3>
                        <h2>{currentMonth.filter(e => e.status === 'RM_SUBMITTED').length}</h2>
                        <p>Needs score validation</p>
                      </div>
                    </div>
                    {LEAVE_APPROVER_ROLES.includes(currentRole) && (() => {
                      const waiting = leaveApplications.filter(a => a.status === 'Pending');
                      if (waiting.length === 0) return null;
                      const overdue = waiting.filter(a =>
                        Math.floor((Date.now() - new Date(a.applied_at)) / 86400000) >= 3).length;
                      return (
                        <div
                          className={`stat-card ${overdue ? 'stat-red' : 'stat-amber'} stat-card-action`}
                          role="button"
                          tabIndex={0}
                          title="Open Attendance & Leave to decide them"
                          onClick={() => setActiveView('attendance')}
                          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveView('attendance'); }}
                        >
                          <div className="stat-icon"><i className="bx bxs-calendar-check"></i></div>
                          <div className="stat-info">
                            <h3>Leave Awaiting You</h3>
                            <h2>{waiting.length}</h2>
                            <p>
                              {overdue
                                ? `${overdue} past the 3-day deadline`
                                : 'Decide within 3 working days'}
                            </p>
                          </div>
                        </div>
                      );
                    })()}
                    {PROFILE_PAY_ROLES.includes(currentRole) && bandMovements.length > 0 && (
                      <div
                        className="stat-card stat-violet stat-card-action"
                        role="button"
                        tabIndex={0}
                        title="Open the Score Tracker, where the moves are marked on the band"
                        onClick={() => setActiveView('score-tracker')}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveView('score-tracker'); }}
                      >
                        <div className="stat-icon"><i className="bx bx-transfer-alt"></i></div>
                        <div className="stat-info">
                          <h3>Band Movement</h3>
                          <h2>
                            {bandMovements.filter(m => m.up).length}↑ {bandMovements.filter(m => !m.up).length}↓
                          </h2>
                          <p>
                            {bandMovements.slice(0, 3).map(m => m.name.split(' ')[0]).join(', ')}
                            {bandMovements.length > 3 ? ` +${bandMovements.length - 3} more` : ''}
                            {' '}— pay does not follow, review it
                          </p>
                        </div>
                      </div>
                    )}
                    <div className="stat-card stat-red">
                      <div className="stat-icon"><i className="bx bxs-error-circle"></i></div>
                      <div className="stat-info">
                        <h3>Risk Watchlist</h3>
                        <h2>{
                          coaches.filter(c => {
                            // A month with no recorded score is not a weak month:
                            // `null < 40` is true, so without this an unrecorded
                            // period counts against the coach.
                            const combined = [...historicMonths, ...currentMonth]
                              .filter(e => e.coach_id === c.id && e.status !== "DRAFT" && e.hb_score != null)
                              .sort((a, b) => new Date(b.period_end) - new Date(a.period_end));
                            return combined.length >= 2 && combined[0].hb_score < 40 && combined[1].hb_score < 40;
                          }).length
                        }</h2>
                        <p>Consecutive scores &lt; 40</p>
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-grid" style={{ marginTop: '1.5rem' }}>
                    {/* SVG column chart for band distributions */}
                    <div className="card grid-span-8">
                      <div className="card-header-row">
                        <h3>HB+ Score Performance Band Distribution</h3>
                        <span className="badge badge-success">{currentPeriodMonth}</span>
                      </div>
                      <div className="chart-container-box">
                        {(() => {
                          const dist = { "0-30": 0, "30-40": 0, "40-50": 0, "50-60": 0, "60-70": 0, "70-80": 0, "80+": 0 };
                          currentMonth.forEach(e => {
                            const sc = e.hb_score || 0;
                            if (sc < 30) dist["0-30"]++;
                            else if (sc < 40) dist["30-40"]++;
                            else if (sc < 50) dist["40-50"]++;
                            else if (sc < 60) dist["50-60"]++;
                            else if (sc < 70) dist["60-70"]++;
                            else if (sc < 80) dist["70-80"]++;
                            else dist["80+"]++;
                          });
                          const maxCount = Math.max(...Object.values(dist), 1);
                          return Object.entries(dist).map(([band, val]) => {
                            const pct = (val / maxCount) * 80;
                            let color = "var(--accent-red)";
                            if (band === "40-50") color = "var(--accent-amber)";
                            if (band === "50-60") color = "var(--accent-teal)";
                            if (band === "60-70") color = "var(--accent-blue)";
                            if (band === "70-80") color = "var(--accent-violet)";
                            if (band === "80+") color = "var(--accent-teal)";
                            return (
                              <div className="chart-bar-col" key={band}>
                                <div className="chart-bar-pillar" style={{ height: `${pct}%`, backgroundColor: color }} data-tooltip={`${val} Coach(es)`}></div>
                                <div className="chart-bar-label">{band}</div>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>

                    {/* Alerts Watchlist */}
                    <div className="card grid-span-4" style={{ maxHeight: '290px', overflowY: 'auto' }}>
                      <div className="card-header-row">
                        <h3>Performance Alerts</h3>
                        <i className="bx bxs-bell-ring text-red animate-pulse"></i>
                      </div>
                      <div className="interaction-history-list">
                        {(() => {
                          const wList = coaches.map(c => {
                            // Same guard as the count above: only months that
                            // actually carry a score can be weak ones.
                            const hist = [...historicMonths, ...currentMonth]
                              .filter(e => e.coach_id === c.id && e.status !== "DRAFT" && e.hb_score != null)
                              .sort((a, b) => new Date(b.period_end) - new Date(a.period_end));
                            if (hist.length >= 2 && hist[0].hb_score < 40 && hist[1].hb_score < 40) {
                              return { c, score1: hist[0].hb_score, score2: hist[1].hb_score };
                            }
                            return null;
                          }).filter(Boolean);

                          if (wList.length === 0) {
                            return <p className="text-secondary" style={{ fontSize: '0.85rem' }}>No critical performance reviews triggered.</p>;
                          }

                          return wList.map(item => (
                            <div key={item.c.id} className="underperform-alert-banner" style={{ padding: '8px 12px', fontSize: '0.8rem', marginBottom: '6px' }}>
                              <i className="bx bxs-error-circle" style={{ fontSize: '1.2rem' }}></i>
                              <div>
                                <strong>{item.c.name} ({item.c.id})</strong>
                                <p className="text-secondary">Consecutive weak scores: {item.score2.toFixed(2)} &rarr; {item.score1.toFixed(2)}</p>
                              </div>
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {/* Finance Dashboard View */}
              {currentRole === "Finance" && (
                <>
                  <div className="stats-row">
                    {(() => {
                      let grossTotal = 0, milestoneTotal = 0, consistencyTotal = 0, deductionTotal = 0;
                      currentMonth.forEach(m => {
                        const coach = coaches.find(c => c.id === m.coach_id);
                        if (!coach) return;
                        const vConfig = findVariant(variants, coach.variant_id);
                        const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(m.period_start) && new Date(v.incident_date) <= new Date(m.period_end));
                        const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === m.period_month && o.status === 'Approved');

                        const calc = m.hb_score != null ? m : computeHBPlusScore(coach, m, vConfig);
                        const pay = computeMonthlyPay(coach, carryPay(m), calc, activeVio, vConfig, coachOrgWork);

                        grossTotal += pay.grossPay;
                        milestoneTotal += pay.milestoneIncentive;
                        consistencyTotal += pay.consistencyBonus;
                        deductionTotal += pay.penaltyDeductions;
                      });

                      return (
                        <>
                          <div className="stat-card stat-teal">
                            <div className="stat-icon"><i className="bx bx-wallet"></i></div>
                            <div className="stat-info">
                              <h3>Base &amp; Extra Salary</h3>
                              <h2>₹{(grossTotal + deductionTotal - milestoneTotal - consistencyTotal).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                              <p>Guaranteed commitment</p>
                            </div>
                          </div>
                          <div className="stat-card stat-violet">
                            <div className="stat-icon"><i className="bx bx-gift"></i></div>
                            <div className="stat-info">
                              <h3>Milestone Rewards</h3>
                              <h2>₹{milestoneTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                              <p>Volume bonuses</p>
                            </div>
                          </div>
                          <div className="stat-card stat-amber">
                            <div className="stat-icon"><i className="bx bx-badge-check"></i></div>
                            <div className="stat-info">
                              <h3>Consistency Bonuses</h3>
                              <h2>₹{consistencyTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                              <p>Roster compliance</p>
                            </div>
                          </div>
                          <div className="stat-card stat-red">
                            <div className="stat-icon"><i className="bx bx-minus-circle"></i></div>
                            <div className="stat-info">
                              <h3>Fines &amp; Penalties</h3>
                              <h2>₹{deductionTotal.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</h2>
                              <p>Annexure-1 deductions</p>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>

                  <div className="card grid-span-12" style={{ marginTop: '1.5rem', textAlign: 'center', padding: '2rem' }}>
                    <h3 style={{ marginBottom: '0.5rem' }}>
                      <i className="bx bxs-file-pdf text-teal" style={{ fontSize: '2rem', verticalAlign: 'middle', marginRight: '8px' }}></i>
                      Payroll Locking &amp; Auditing Panel
                    </h3>
                    <p className="text-secondary" style={{ marginBottom: '1.5rem', maxWidth: '600px', marginLeft: 'auto', marginRight: 'auto' }}>
                      Locking freezes all session reports, scorecards, and penalty logs. Freezing is mandatory before payouts can be routed or export files can be triggered for HRMS integrations.
                    </p>
                    <div className="action-buttons-group" style={{ justifyContent: 'center' }}>
                      <button className="btn btn-primary" onClick={handleLockCycle}>
                        <i className="bx bx-lock-open-alt"></i> {payrollLocked ? "Unlock Period (Admin)" : "Lock Current Payroll Cycle"}
                      </button>
                      {isViewEnabled('payroll') && (
                        <button className="btn btn-secondary" onClick={() => setActiveView('payroll')}>
                          <i className="bx bx-search"></i> View Ledger Detail
                        </button>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* RM Dashboard View */}
              {currentRole === "Reporting Manager" && (
                <>
                  <div className="stats-row">
                    <div className="stat-card stat-teal">
                      <div className="stat-icon"><i className="bx bxs-group"></i></div>
                      <div className="stat-info">
                        <h3>My Coaches</h3>
                        <h2>{coaches.filter(c => c.reporting_manager_id === currentRmContext && c.status === 'Active').length}</h2>
                        <p>Active floor coaches</p>
                      </div>
                    </div>
                    <div className="stat-card stat-violet">
                      <div className="stat-icon"><i className="bx bx-badge-check"></i></div>
                      <div className="stat-info">
                        <h3>Submissions Completed</h3>
                        <h2>{
                          currentMonth.filter(e => {
                            const c = coaches.find(rc => rc.id === e.coach_id);
                            return c && c.reporting_manager_id === currentRmContext && e.status !== 'DRAFT';
                          }).length
                        } / {coaches.filter(c => c.reporting_manager_id === currentRmContext && c.status === 'Active').length}</h2>
                        <p>Evaluated for {currentPeriodMonth}</p>
                      </div>
                    </div>
                    <div className="stat-card stat-amber">
                      <div className="stat-icon"><i className="bx bx-time"></i></div>
                      <div className="stat-info">
                        <h3>Pending Evaluations</h3>
                        <h2>{
                          coaches.filter(c => c.reporting_manager_id === currentRmContext && c.status === 'Active').length -
                          currentMonth.filter(e => {
                            const c = coaches.find(rc => rc.id === e.coach_id);
                            return c && c.reporting_manager_id === currentRmContext && e.status !== 'DRAFT';
                          }).length
                        }</h2>
                        <p>Due in 3 working days</p>
                      </div>
                    </div>
                  </div>

                  <div className="card grid-span-12" style={{ marginTop: '1.5rem' }}>
                    <div className="card-header-row">
                      <h3>Floor Performance Scorecard Submissions</h3>
                      {isViewEnabled('evaluations') && (
                        <button className="btn btn-primary" onClick={() => setActiveView('evaluations')}><i className="bx bx-plus"></i> Enter/Edit Evaluations</button>
                      )}
                    </div>
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Coach ID</th>
                            <th>Coach Name</th>
                            <th>Category</th>
                            <th>Variant</th>
                            <th>Last Month Score</th>
                            <th>{currentPeriodMonth} Score</th>
                            <th>Workflow Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coaches.filter(c => c.reporting_manager_id === currentRmContext && c.status === 'Active').map(c => {
                            const hist = historicMonths.find(hm => hm.coach_id === c.id);
                            const curr = currentMonth.find(cm => cm.coach_id === c.id);
                            const vConfig = findVariant(variants, c.variant_id);
                            
                            let currScoreLabel = "Not Evaluated";
                            let statusBadge = <span className="badge badge-warning">Pending Input</span>;
                            
                            if (curr && curr.status !== 'DRAFT') {
                              const score = curr.hb_score != null ? curr.hb_score : computeHBPlusScore(c, curr, vConfig).hbScore;
                              currScoreLabel = `${score.toFixed(2)} (${getPerformanceBand(score).label})`;
                              
                              let badgeClass = "badge-muted";
                              if (curr.status === 'RM_SUBMITTED') badgeClass = "badge-warning";
                              if (curr.status === 'HR_REVIEWED') badgeClass = "badge-success";
                              if (curr.status === 'FINANCE_LOCKED') badgeClass = "badge-danger";
                              statusBadge = <span className={`badge ${badgeClass}`}>{curr.status.replace('_', ' ')}</span>;
                            }

                            return (
                              <tr key={c.id}>
                                <td>{c.id}</td>
                                <td><strong>{c.name}</strong></td>
                                <td>{c.coach_category}</td>
                                <td>{vConfig ? vConfig.name : c.variant_id}</td>
                                <td>{hist?.hb_score != null ? `${hist.hb_score.toFixed(2)} (${hist.band})` : 'N/A'}</td>
                                <td>{currScoreLabel}</td>
                                <td>{statusBadge}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* Showrunner Dashboard View */}
              {currentRole === "Showrunner" && (
                <div className="card grid-span-12" style={{ textAlign: 'center', padding: '3rem' }}>
                  <i className="bx bx-calendar-check text-teal" style={{ fontSize: '3.5rem', marginBottom: '1rem' }}></i>
                  <h2>Showrunner Portal (SRS Scheduling)</h2>
                  <p className="text-secondary" style={{ maxWidth: '600px', margin: '0.5rem auto 1.5rem auto' }}>
                    Submit session volumes, trial logs, and roster metrics dynamically. Simulated fallback CSV imports can be loaded directly below to patch scores.
                  </p>
                  <div className="action-buttons-group" style={{ justifyContent: 'center' }}>
                    <button className="btn btn-primary" onClick={() => setActiveModal("bulk-sessions")}>
                      <i className="bx bx-import"></i> Bulk Import Sessions completed
                    </button>
                    {isViewEnabled('evaluations') && (
                      <button className="btn btn-secondary" onClick={() => setActiveView("evaluations")}><i className="bx bx-show"></i> Verify Recorded Volumes</button>
                    )}
                  </div>
                </div>
              )}

              {/* Coach Dashboard View */}
              {currentRole === "Coach" && (() => {
                if (!currentSelectedCoach) {
                  return <div className="card"><p>Please select a coach from the header context to view the dashboard.</p></div>;
                }

                const vConfig = findVariant(variants, currentSelectedCoach.variant_id);
                const histList = historicMonths.filter(h => h.coach_id === currentSelectedCoach.id);
                const curr = currentMonth.find(e => e.coach_id === currentSelectedCoach.id);
                
                let finalScore = 0, finalBand = "0-30 Non-Functional", isDraft = true, attendance = 0, sessions = 0;
                if (curr) {
                  const calcObj = curr.hb_score != null ? curr : computeHBPlusScore(currentSelectedCoach, curr, vConfig);
                  finalScore = calcObj.hbScore || calcObj.hb_score;
                  finalBand = getPerformanceBand(finalScore).label;
                  isDraft = curr.status === 'DRAFT';
                  attendance = curr.attendance_pct;
                  sessions = curr.sessions_completed;
                }

                const milestoneTarget = currentSelectedCoach.coach_category === 'Fixed' ? (vConfig.discipline === 'Yoga' ? 117 : 156) : 96;
                const progressPct = Math.min(100, ((Number(sessions) || 0) / milestoneTarget) * 100);
                const activeVio = violations.filter(v => v.coach_id === currentSelectedCoach.id && v.status !== 'Appeal_Approved');

                const allRuns = [...histList, curr].filter(Boolean);

                return (
                  <>
                    <div className="stats-row">
                      <div className="stat-card stat-teal">
                        <div className="stat-icon"><i className="bx bxs-medal"></i></div>
                        <div className="stat-info">
                          <h3>My HB+ Score</h3>
                          <h2>{isDraft ? "Drafting" : finalScore.toFixed(2)}</h2>
                          <p>{isDraft ? "Evaluating..." : finalBand}</p>
                        </div>
                      </div>
                      <div className="stat-card stat-violet">
                        <div className="stat-icon"><i className="bx bx-calendar-event"></i></div>
                        <div className="stat-info">
                          <h3>Attendance Rate</h3>
                          <h2>{attendance}%</h2>
                          <p>Evidence+ Tracked</p>
                        </div>
                      </div>
                      <div className="stat-card stat-amber">
                        <div className="stat-icon"><i className="bx bxs-star"></i></div>
                        <div className="stat-info">
                          <h3>5-Star Streak</h3>
                          <h2>{curr ? curr.five_star_streak : 0}</h2>
                          <p>Consecutive reviews</p>
                        </div>
                      </div>
                      <div className="stat-card stat-red">
                        <div className="stat-icon"><i className="bx bxs-error"></i></div>
                        <div className="stat-info">
                          <h3>Active Violations</h3>
                          <h2>{activeVio.length}</h2>
                          <p>Annexure-1 incidents</p>
                        </div>
                      </div>
                    </div>

                    <div className="dashboard-grid" style={{ marginTop: '1.5rem' }}>
                      <div className="card grid-span-6">
                        <div className="card-header-row">
                          <h3>Sessions Milestone Progress</h3>
                          <span className="badge badge-info">{sessions} / {milestoneTarget} Sessions</span>
                        </div>
                        <p className="text-secondary" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                          Milestone bonuses trigger once volume thresholds are reached. Target base: <strong>{milestoneTarget} sessions</strong>.
                        </p>
                        <div className="custom-progress-bar-container">
                          <div className="custom-progress-bar-fill" style={{ width: `${progressPct}%`, backgroundColor: 'var(--accent-teal)' }}></div>
                        </div>
                        <p className="text-muted" style={{ fontSize: '0.75rem', marginTop: '8px' }}>{Math.round(progressPct)}% of target met</p>
                      </div>

                      <div className="card grid-span-6">
                        <div className="streak-box-dashboard">
                          <div>
                            <h3>5-Star Reward Streak</h3>
                            <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                              Earn <strong>₹{vConfig.id === 'V3' ? '500' : '200'}</strong> for every {vConfig.id === 'V3' ? '15' : '10'} consecutive 5-stars.
                            </p>
                            <h2 className="text-amber" style={{ fontSize: '2rem', marginTop: '8px' }}>
                              {curr ? curr.five_star_streak : 0} <span style={{ fontSize: '1rem', color: 'var(--text-secondary)' }}>consec.</span>
                            </h2>
                          </div>
                          <i className="bx bxs-hot streak-flame-icon"></i>
                        </div>
                      </div>

                      <div className="card grid-span-12" style={{ marginTop: '1rem' }}>
                        <div className="card-header-row">
                          <h3>My Payroll Statements &amp; Payslips</h3>
                          <i className="bx bx-lock-alt text-secondary"></i>
                        </div>
                        <div className="table-container">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Performance Month</th>
                                <th>HB+ Score</th>
                                <th>Band</th>
                                <th>Gross Monthly Pay</th>
                                <th>Lock Status</th>
                                <th className="actions-col">Payslip</th>
                              </tr>
                            </thead>
                            <tbody>
                              {allRuns.map(run => {
                                const scoreVal = run.hb_score != null
                                  ? run.hb_score
                                  : computeHBPlusScore(currentSelectedCoach, run, vConfig).hbScore;
                                const bandVal = run.band || getPerformanceBand(scoreVal).label;
                                const monthVios = violations.filter(v => v.coach_id === currentSelectedCoach.id && new Date(v.incident_date) >= new Date(run.period_start) && new Date(v.incident_date) <= new Date(run.period_end) && v.status !== 'Appeal_Approved');
                                const coachOrgWork = orgWork.filter(o => o.coach_id === currentSelectedCoach.id && o.period_month === run.period_month && o.status === 'Approved');
                                const pay = computeMonthlyPay(currentSelectedCoach, carryPay(run), { hbScore: scoreVal }, monthVios, vConfig, coachOrgWork);
                                const isLocked = run.status === 'FINANCE_LOCKED';
                                
                                return (
                                  <tr key={run.period_month}>
                                    <td><strong>{run.period_month}</strong></td>
                                    <td>{scoreVal.toFixed(2)}</td>
                                    <td>{bandVal}</td>
                                    <td>{isLocked ? `₹${pay.grossPay.toLocaleString('en-IN')}` : <span className="text-secondary">Draft Calculator</span>}</td>
                                    <td>
                                      <span className={`badge ${isLocked ? 'badge-success' : 'badge-warning'}`}>
                                        {isLocked ? 'LOCKED / VERIFIED' : 'DRAFT'}
                                      </span>
                                    </td>
                                    <td className="actions-col">
                                      <button className="btn btn-secondary" onClick={() => handleOpenPayslipModal(currentSelectedCoach.id, run.period_month)} disabled={!isLocked && currentRole !== 'Super Admin'}>
                                        <i className="bx bx-file-pdf"></i> Preview
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </section>
          )}

          {/* Coach Detail Page (drill-down from the Coach Master directory) */}
          {activeView === 'coaches' && coachDetailId && (() => {
            const coach = coaches.find(c => c.id === coachDetailId);
            if (!coach) {
              return (
                <section id="view-coach-detail" className="content-view active-view">
                  <div className="card">
                    <p>That coach record is no longer available.</p>
                    <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => setCoachDetailId(null)}>
                      <i className="bx bx-arrow-back"></i> Back to Coach Master
                    </button>
                  </div>
                </section>
              );
            }

            const vConfig = findVariant(variants, coach.variant_id);
            // Everything below reads vConfig.rates / .weights / .discipline
            // directly, so a missing variant used to throw and blank the page.
            // Say what is wrong instead.
            if (!vConfig) {
              return (
                <section id="view-coach-detail" className="content-view active-view">
                  <div className="card" style={{ padding: '1.5rem' }}>
                    <h3 style={{ marginTop: 0 }}>Cannot open {coach.name}</h3>
                    <p>
                      This coach is on policy variant <strong>{coach.variant_id || '(none)'}</strong>,
                      which is not in the variants table. Their pay bands, weights and
                      thresholds all come from it, so the profile cannot be scored.
                    </p>
                    <p className="text-muted">
                      {variants.length === 0
                        ? "No variants are loaded at all — the reference data did not finish seeding."
                        : `Loaded variants: ${variants.map(v => v.id).join(', ')}.`}
                    </p>
                    <button className="btn btn-secondary" style={{ marginTop: '1rem' }} onClick={() => setCoachDetailId(null)}>
                      <i className="bx bx-arrow-back"></i> Back to Coach Master
                    </button>
                  </div>
                </section>
              );
            }

            const histList = historicMonths.filter(h => h.coach_id === coach.id);
            const curr = currentMonth.find(e => e.coach_id === coach.id);
            const allRuns = [...histList, curr].filter(Boolean)
              .sort((a, b) => new Date(a.period_end) - new Date(b.period_end));

            // The tables show the chosen span of pay cycles; everything else on
            // the page — the header stats, the calculator — still sees them all.
            const runIndex = (month) => allRuns.findIndex(r => r.period_month === month);
            const fromIdx = scorecardFrom && runIndex(scorecardFrom) >= 0 ? runIndex(scorecardFrom) : 0;
            const toIdx = scorecardTo && runIndex(scorecardTo) >= 0 ? runIndex(scorecardTo) : allRuns.length - 1;
            // Picking them the wrong way round reads as a range, not an error.
            const visibleRuns = allRuns.slice(Math.min(fromIdx, toIdx), Math.max(fromIdx, toIdx) + 1);

            // The open period is usually blank until an RM records it, so the
            // header stats report the newest period that actually has entries.
            const isRecorded = (r) => MANUAL_PERIOD_FIELDS.some(f => r[f] !== null && r[f] !== undefined);
            const statRun = [...allRuns].reverse().find(isRecorded) || allRuns[allRuns.length - 1] || null;

            let finalScore = 0, finalBand = "0-30 Non-Functional", isDraft = true;
            let attendance = null, sessions = null, statPeriod = null, statIsCurrent = false;
            if (statRun) {
              const calcObj = statRun.hb_score !== undefined && statRun.hb_score !== null
                ? statRun
                : computeHBPlusScore(coach, statRun, vConfig);
              finalScore = calcObj.hbScore ?? calcObj.hb_score ?? 0;
              finalBand = statRun.band || getPerformanceBand(finalScore).label;
              isDraft = !isRecorded(statRun);
              attendance = statRun.attendance_pct;
              sessions = statRun.sessions_completed;
              statPeriod = statRun.period_month;
              statIsCurrent = !!curr && curr.period_month === statRun.period_month;
            }

            const coachVios = violations.filter(v => v.coach_id === coach.id);
            const activeVio = coachVios.filter(v => v.status !== 'Appeal_Approved');
            const canLock = LOCK_ROLES.includes(currentRole);
            const canManage = PROFILE_PAY_ROLES.includes(currentRole);
            const canEditScores = SCORE_EDIT_ROLES.includes(currentRole);

            // One row per evaluated period. Takes the coach/record pair so an
            // in-progress edit can be re-scored live from the draft values.
            const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            const buildScoreRow = (coachObj, run) => {
              const periodCalc = computeHBPlusScore(coachObj, run, vConfig);
              const isEdited = editingScorePeriod === run.period_month;
              const periodScore = (!isEdited && run.hb_score != null) ? run.hb_score : periodCalc.hbScore;
              const periodBand = (!isEdited && run.band) ? run.band : getPerformanceBand(periodScore).label;
              const periodThreshold = vConfig.rates[coachObj.coach_category]?.[periodBand]?.threshold
                ?? (coachObj.coach_category === 'Fixed' ? (vConfig.discipline === 'Yoga' ? 117 : 156) : 96);
              const periodSessions = Number(run.sessions_completed) || 0;
              const b = periodCalc.breakdown;
              const w = vConfig.weights;

              // Start from the engine's numbers, then let any stored override
              // stand in and re-drive everything downstream of it.
              const ov = run.overrides || {};
              const pick = (key, computed) => (ov[key] !== undefined && ov[key] !== null ? Number(ov[key]) : computed);

              const expPostDoj = pick("exp_post_doj", calculateTenureYears(coachObj.date_of_joining, run.period_end));
              const coachExpYears = Math.min(10,
                (Number(coachObj.freelance_past_exp_with_document) || 0) +
                (Number(coachObj.freelance_past_exp_without_document) || 0) * 0.5 +
                expPostDoj);
              const expCoachScore = pick("exp_coach_score", coachExpYears * w.coaching_exp / 10);
              const expNonCoachScore = pick("exp_non_coach_score", b.nonCoachingExpYears * w.non_coaching_exp / 10);
              const experienceTotal = pick("experience", expCoachScore + expNonCoachScore);

              const eduWeighted = pick("edu_score", b.eduScore * w.education / 10);
              const certRaw = pick("cert_raw", b.certScore);
              const certWeighted = pick("cert_score", certRaw === b.certScore
                ? b.techScore - (b.eduScore * w.education / 10)
                : certRaw * w.technical_cert / (vConfig.discipline === "Yoga" ? 10 : 9.6));
              const technicalTotal = pick("technical", eduWeighted + certWeighted);

              const coreTotal = pick("core_total", b.coreTotal);
              const coreScore = pick("core", coreTotal * w.core_performance / 100);

              const tenureYears = pick("tenure_years", b.tenureYears);
              const orgScore = pick("org", tenureYears * w.tenure / 5);

              const scheduled = Number(run.meetings_scheduled) || 0;
              const attendancePct = pick("attendance_pct",
                scheduled > 0 ? (Number(run.meetings_attended) || 0) / scheduled * 100 : (Number(run.attendance_pct) || 0));
              const attendanceScore = pick("attendance_score", attendancePct * w.attendance / 100);

              const summed = Math.min(100, Math.max(0,
                experienceTotal + technicalTotal + coreScore + orgScore + attendanceScore));
              const hasOverride = SCORE_DRIVING_OVERRIDES.some(k => ov[k] !== undefined && ov[k] !== null);
              const storedScore = (!isEdited && !hasOverride && run.hb_score != null) ? run.hb_score : summed;
              const finalScore = pick("hb_score", Math.round(storedScore * 100) / 100);
              const finalBand = (!isEdited && !hasOverride && run.band) ? run.band : getPerformanceBand(finalScore).label;

              const finalThreshold = pick("threshold", periodThreshold);

              return {
                month: run.period_month,
                range: `${fmtDay(run.period_start)} – ${fmtDay(run.period_end)}`,
                status: run.status,
                exp_doc: Number(coachObj.freelance_past_exp_with_document) || 0,
                exp_nodoc: Number(coachObj.freelance_past_exp_without_document) || 0,
                exp_post_doj: expPostDoj,
                exp_coach_score: expCoachScore,
                exp_non_coach_years: Number(coachObj.non_coaching_exp_years) || 0,
                exp_non_coach_score: expNonCoachScore,
                experience: experienceTotal,
                edu_raw: b.eduScore,
                edu_score: eduWeighted,
                cert_raw: certRaw,
                cert_score: certWeighted,
                technical: technicalTotal,
                prof_appearance: run.prof_appearance,
                client_engagement: run.client_engagement,
                safety: run.safety,
                punctuality: run.punctuality,
                team_conduct: run.team_conduct,
                communication: run.communication,
                isBlank: MANUAL_PERIOD_FIELDS.every(f => run[f] === null || run[f] === undefined),
                core_total: coreTotal,
                core: coreScore,
                tenure_years: tenureYears,
                org: orgScore,
                meetings_scheduled: run.meetings_scheduled,
                meetings_attended: run.meetings_attended,
                attendance_pct: attendancePct,
                attendance_score: attendanceScore,
                hb_score: finalScore,
                band: finalBand,
                overrides: ov,
                sessions: run.sessions_completed,
                night_sessions: run.night_sessions,
                streak: run.five_star_streak,
                threshold: finalThreshold,
                extra_sessions: pick("extra_sessions", Math.max(0, periodSessions - finalThreshold)),
                violations: pick("violations", coachVios.filter(v =>
                  v.status !== 'Appeal_Approved' &&
                  new Date(v.incident_date) >= new Date(run.period_start) &&
                  new Date(v.incident_date) <= new Date(run.period_end)
                ).length)
              };
            };

            // While a row is open, mirror the draft into a coach/record pair so
            // every derived cell in that row recalculates as the user types.
            const draftFor = (run) => {
              const scheduled = Number(scoreDraft.meetings_scheduled) || 0;
              const attended = Math.min(Number(scoreDraft.meetings_attended) || 0, scheduled);
              return {
                coach: {
                  ...coach,
                  freelance_past_exp_with_document: Number(scoreDraft.exp_doc) || 0,
                  freelance_past_exp_without_document: Number(scoreDraft.exp_nodoc) || 0,
                  non_coaching_exp_years: Number(scoreDraft.exp_non_coach_years) || 0,
                  education_score_override: Number(scoreDraft.edu_raw) || 0
                },
                run: {
                  ...run,
                  prof_appearance: Number(scoreDraft.prof_appearance) || 0,
                  client_engagement: Number(scoreDraft.client_engagement) || 0,
                  safety: Number(scoreDraft.safety) || 0,
                  punctuality: Number(scoreDraft.punctuality) || 0,
                  team_conduct: Number(scoreDraft.team_conduct) || 0,
                  communication: Number(scoreDraft.communication) || 0,
                  meetings_scheduled: scheduled,
                  meetings_attended: attended,
                  attendance_pct: scheduled > 0 ? (attended / scheduled) * 100 : 0,
                  sessions_completed: Number(scoreDraft.sessions) || 0,
                  night_sessions: Number(scoreDraft.night_sessions) || 0,
                  five_star_streak: Number(scoreDraft.streak) || 0,
                  overrides: scoreDraft.overrides || {}
                }
              };
            };

            // Incentive is recorded per period but carries no weight in the HB+
            // score, so it leaves the tab strip for its own table below. That
            // table repeats only the month — the period range and record status
            // are already stated once, in the table above.
            const periodGroup = COACH_SCORECARD_GROUPS.find(g => g.key === 'period');
            const incentiveGroup = COACH_SCORECARD_GROUPS.find(g => g.key === 'incentive');
            const tabGroups = COACH_SCORECARD_GROUPS.filter(g => g.key !== 'period' && g.key !== 'incentive');
            const activeGroup = tabGroups.find(g => g.key === scorecardTab) || tabGroups[0];
            const visibleScorecardGroups = [periodGroup, activeGroup];
            const incentiveScorecardGroups = [
              { ...periodGroup, columns: periodGroup.columns.filter(c => c.key === 'month') },
              incentiveGroup
            ];

            const scoreCellValue = (col, row) => {
              const value = row[col.key];
              if (value === null || value === undefined) return '—';
              if (col.decimals !== undefined) return Number(value).toFixed(col.decimals);
              return value;
            };

            const renderScorecardTable = (groups, paneKey, paneId) => (
              <div key={paneKey} className="table-container score-tracker-container scorecard-container scorecard-pane">
                <table className="data-table score-tracker-table">
                  <thead>
                    <tr className="group-header-row">
                      {groups.map(group => {
                        const gw = group.weightKeys
                          ? group.weightKeys.reduce((sum, k) => sum + (vConfig.weights[k] || 0), 0)
                          : null;
                        return (
                          <th key={group.key} colSpan={group.columns.length} className={`group-head group-${group.tone}`}>
                            {group.label}{gw !== null && <span className="group-weight">(Wt {gw}%)</span>}
                          </th>
                        );
                      })}
                      <th className="group-head group-slate actions-col">Actions</th>
                    </tr>
                    <tr className="column-header-row">
                      {groups.flatMap(group => group.columns.map(col => {
                        const weight = col.weightKeys
                          ? `${col.weightKeys.reduce((sum, k) => sum + (vConfig.weights[k] || 0), 0)}%`
                          : col.scale || (col.max && col.max <= 20 ? `Max ${col.max}` : null);
                        return (
                          <th
                            key={col.key}
                            className={[
                              `group-tint-${group.tone}`,
                              `col-${col.key}`,
                              col.sticky ? 'sticky-col sticky-month' : '',
                              col.decimals !== undefined ? 'num-col' : '',
                              col.emphasis ? 'emphasis-col' : ''
                            ].join(' ')}
                          >
                            <span className="col-label">{col.label}</span>
                            {weight && <span className="col-weight">{weight}</span>}
                            {col.entry && (
                              <span className={`entry-tag entry-${col.entry}`}>
                                {col.entry === 'derived' ? 'Dynamic' : 'Manual'}
                                {col.source ? ` · ${col.source}` : ''}
                                {col.note ? ` · ${col.note}` : ''}
                              </span>
                            )}
                          </th>
                        );
                      }))}
                      <th className="group-tint-slate actions-col" title="Edit row"><i className="bx bx-pencil"></i></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRuns.map(run => {
                      const isEditing = editingScorePeriod === run.period_month && editingScorePane === paneId;
                      const source = isEditing ? draftFor(run) : { coach, run };
                      const row = buildScoreRow(source.coach, source.run);
                      const isLocked = run.status === 'FINANCE_LOCKED';
                      // A locked card is read-only for every role, Super Admin
                      // included. The way back in is the padlock on Record
                      // Status, which leaves an audit entry behind it.
                      const mayEdit = canEditScores && !isLocked;
                      const hasPendingDraft = Boolean(pendingDrafts[draftKey(run.coach_id, run.period_month)]);

                      return (
                        <tr
                          key={run.period_month}
                          className={[
                            isEditing ? 'scorecard-editing-row' : '',
                            // The period currently open for recording.
                            run.period_month === currentPeriodMonth ? 'scorecard-current-row' : ''
                          ].filter(Boolean).join(' ')}
                        >
                          {groups.flatMap(group => group.columns.map(col => {
                            const isKeyed = col.entry === 'manual' || col.entry === 'profile';
                            const canOverride = OVERRIDABLE_KEYS.includes(col.key);
                            const isOverridden = (run.overrides || {})[col.key] !== undefined && (run.overrides || {})[col.key] !== null;
                            const isUnlocked = unlockedDynamicKeys.includes(col.key);
                            const editable = isEditing && (isKeyed || (canOverride && isUnlocked));
                            const lockedDynamic = isEditing && canOverride && !isUnlocked;
                            const ceiling = canOverride ? overrideCeiling(col, vConfig.weights) : null;
                            const draftValue = (scoreDraft.overrides || {})[col.key];
                            const outOfRange = isEditing && canOverride && draftValue !== undefined && draftValue !== '' &&
                              (Number.isNaN(Number(draftValue)) || Number(draftValue) < 0 ||
                                (ceiling !== null && Number(draftValue) > ceiling));
                            const bandMove = col.key === 'band'
                              ? bandMoveFor(coach.id, run.period_month) : null;
                            return (
                              <td
                                key={col.key}
                                title={bandMove
                                  ? `Moved ${bandMove.up ? 'up' : 'down'} from ${bandMove.from} (${bandMove.fromMonth})`
                                  : (isOverridden ? 'Hand-entered — overrides the calculated value' : undefined)}
                                className={[
                                  `col-${col.key}`,
                                  bandMove ? `band-moved band-moved-${bandMove.up ? 'up' : 'down'}` : '',
                                  col.sticky ? 'sticky-col sticky-month' : '',
                                  col.decimals !== undefined ? 'num-col' : '',
                                  col.emphasis ? `emphasis-col emphasis-${group.tone}` : '',
                                  editable ? 'editable-cell' : '',
                                  isOverridden ? 'overridden-cell' : '',
                                  outOfRange ? 'invalid-cell' : '',
                                  lockedDynamic ? 'locked-cell' : ''
                                ].join(' ')}
                              >
                                {lockedDynamic ? (
                                  <button
                                    type="button"
                                    className="dynamic-lock-btn"
                                    title={`Calculated field — click to edit${ceiling !== null ? ` (max ${ceiling})` : ''}`}
                                    onClick={() => requestDynamicEdit(col, ceiling)}
                                  >
                                    <span>{scoreCellValue(col, row)}</span>
                                    <i className="bx bx-lock-alt"></i>
                                  </button>
                                ) : editable ? (
                                  <input
                                    type="number"
                                    className={`scorecard-input ${isKeyed ? '' : 'scorecard-input-dynamic'} ${outOfRange ? 'scorecard-input-invalid' : ''}`}
                                    min="0"
                                    max={isKeyed ? col.max : (ceiling ?? undefined)}
                                    step={col.step || (col.decimals === 0 ? 1 : 0.01)}
                                    placeholder={isKeyed ? '—' : undefined}
                                    title={isKeyed ? undefined : `Hand-entered — overrides the calculated value${ceiling !== null ? ` (max ${ceiling})` : ''}.`}
                                    autoFocus={!isKeyed && isUnlocked && draftValue === undefined}
                                    value={isKeyed
                                      ? (scoreDraft[col.key] ?? '')
                                      : (draftValue ?? scoreCellValue(col, row))}
                                    onChange={(e) => isKeyed
                                      ? setScoreDraft(prev => ({ ...prev, [col.key]: e.target.value }))
                                      : applyScoreOverride(col, e.target.value, ceiling)}
                                  />
                                ) : col.key === 'status' ? (
                                  // The padlock carries the status on its own: shut means
                                  // finance-locked, open means still editable. The written
                                  // status stays available on hover and to screen readers.
                                  <div className="status-cell">
                                    {canLock ? (
                                      <button
                                        type="button"
                                        className={`status-lock-btn${isLocked ? ' is-locked' : ''}`}
                                        title={`${run.status} — click to ${isLocked ? 'unlock' : 'lock'} the ${run.period_month} score card`}
                                        aria-label={`${run.status}. ${isLocked ? 'Unlock' : 'Lock'} score card`}
                                        aria-pressed={isLocked}
                                        onClick={() => toggleRecordLock(coach, run)}
                                      >
                                        <i className={isLocked ? 'bx bxs-lock-alt' : 'bx bx-lock-open-alt'}></i>
                                      </button>
                                    ) : (
                                      <span
                                        className={`status-lock-btn is-static${isLocked ? ' is-locked' : ''}`}
                                        title={run.status}
                                        role="img"
                                        aria-label={run.status}
                                      >
                                        <i className={isLocked ? 'bx bxs-lock-alt' : 'bx bx-lock-open-alt'}></i>
                                      </span>
                                    )}
                                  </div>
                                ) : (
                                  scoreCellValue(col, row)
                                )}
                              </td>
                            );
                          }))}
                          <td className="actions-col">
                            {isEditing ? (
                              <div className="table-btn-group">
                                <button className="btn-row-icon icon-save" title="Save this score card" aria-label="Save" onClick={() => saveScoreRowEdit(coach, run)}>
                                  <i className="bx bx-check"></i>
                                </button>
                                {overrideKeys(scoreDraft.overrides).length > 0 && (
                                  <button className="btn-row-icon icon-reset" title="Return every dynamic cell to its calculated value" aria-label="Reset overrides" onClick={clearScoreRowOverrides}>
                                    <i className="bx bx-reset"></i>
                                  </button>
                                )}
                                <button className="btn-row-icon icon-cancel" title="Discard changes" aria-label="Cancel" onClick={cancelScoreRowEdit}>
                                  <i className="bx bx-x"></i>
                                </button>
                              </div>
                            ) : mayEdit ? (
                              <button
                                className={[
                                  'btn-row-icon',
                                  row.isBlank ? 'icon-record' : 'icon-edit',
                                  hasPendingDraft ? 'has-pending-draft' : ''
                                ].filter(Boolean).join(' ')}
                                title={hasPendingDraft
                                  ? `Unsaved changes on ${run.period_month} — open it to carry on`
                                  : row.isBlank ? `Record the ${run.period_month} score card` : `Edit the ${run.period_month} score card`}
                                aria-label={row.isBlank ? 'Record score card' : 'Edit score card'}
                                onClick={() => beginScoreRowEdit(coach, run, paneId)}
                              >
                                <i className={hasPendingDraft ? 'bx bx-edit-alt' : (row.isBlank ? 'bx bx-plus' : 'bx bx-edit')}></i>
                              </button>
                            ) : (
                              <span
                                className="btn-row-icon icon-locked"
                                title={isLocked
                                  ? (canLock
                                      ? 'Locked — unlock it on Record Status to edit'
                                      : 'Locked — ask someone who can unlock it')
                                  : 'Read-only for your role'}
                              >
                                <i className="bx bx-lock-alt"></i>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );

            let statusClass = "badge-muted";
            if (coach.status === "Active") statusClass = "badge-success";
            if (coach.status === "Suspended") statusClass = "badge-danger";

            const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
            const editingProfile = editingCoachCard === 'profile';
            const editingExperience = editingCoachCard === 'experience';
            const editingCerts = editingCoachCard === 'certifications';
            const editingBank = editingCoachCard === 'bank';
            const editingEducation = editingCoachCard === 'education';

            const editItem = (label, control) => (
              <div className="detail-item" key={label}>
                <label>{label}</label>
                {control}
              </div>
            );
            const textField = (key, type = "text") => (
              <input
                type={type}
                className="detail-input"
                value={coachDraft[key] ?? ""}
                onChange={(e) => setCoachField(key, e.target.value)}
              />
            );
            const numField = (key, step = 0.5) => (
              <input
                type="number" min="0" step={step}
                className="detail-input"
                value={coachDraft[key] ?? 0}
                onChange={(e) => setCoachField(key, e.target.value)}
              />
            );
            const selectField = (key, options) => (
              <select className="detail-input" value={coachDraft[key] ?? ""} onChange={(e) => setCoachField(key, e.target.value)}>
                {options.map(o => {
                  const value = typeof o === 'string' ? o : o.value;
                  const label = typeof o === 'string' ? o : o.label;
                  return <option key={value} value={value}>{label}</option>;
                })}
              </select>
            );
            const cardEditControls = (card) => (
              editingCoachCard === card ? (
                <div className="table-btn-group">
                  <button className="btn-row-icon icon-save" title="Save changes" aria-label="Save" onClick={() => saveCoachCardEdit(coach, card)}>
                    <i className="bx bx-check"></i>
                  </button>
                  <button className="btn-row-icon icon-cancel" title="Discard changes" aria-label="Cancel" onClick={cancelCoachCardEdit}>
                    <i className="bx bx-x"></i>
                  </button>
                </div>
              ) : canManage && !editingCoachCard ? (
                <button className="btn-row-icon icon-edit" title="Edit these details" aria-label="Edit" onClick={() => beginCoachCardEdit(coach, card)}>
                  <i className="bx bx-edit"></i>
                </button>
              ) : null
            );

            const detailRow = (label, value) => (
              <div className="detail-item" key={label}>
                <label>{label}</label>
                <span>{value || value === 0 ? value : '—'}</span>
              </div>
            );

            return (
              <section id="view-coach-detail" className="content-view active-view">
                <button className="btn btn-secondary back-link-btn" onClick={() => setCoachDetailId(null)}>
                  <i className="bx bx-arrow-back"></i> Back to Coach Master
                </button>

                <div className="card coach-detail-header">
                  <div className="coach-detail-identity">
                    <div className="coach-detail-avatar">{coach.name.substring(0, 2).toUpperCase()}</div>
                    <div>
                      <h2>{coach.name}</h2>
                      <p className="text-secondary">
                        {coach.id} &middot; {coach.coach_type || (vConfig ? vConfig.discipline : '—')} &middot; {coach.coach_category}
                      </p>
                      <div className="coach-detail-badges">
                        <span className={`badge ${statusClass}`}>{coach.status}</span>
                        <span className="badge badge-info">{vConfig ? vConfig.name : coach.variant_id}</span>
                        {!isDraft && <span className="badge badge-warning">{finalBand}</span>}
                      </div>
                    </div>
                  </div>
                  {canManage && (
                    <div className="table-btn-group">
                      {coach.pdfData && (
                        <a className="btn btn-secondary" href={coach.pdfData} download={coach.pdfName || "profile.pdf"} target="_blank" rel="noreferrer">
                          <i className={getFileIcon(coach.pdfName)}></i> Document
                        </a>
                      )}
                      <button className="btn btn-secondary" onClick={() => handleOpenViolationModal(coach.id)}>
                        <i className="bx bx-error-circle"></i> Log Incident
                      </button>
                      <button className="btn btn-secondary btn-delete-item" onClick={() => handleExitCoach(coach.id)}>
                        <i className="bx bx-log-out"></i> Suspend / Exit
                      </button>
                    </div>
                  )}
                </div>

                <div className="stats-row" style={{ marginTop: '1.5rem' }}>
                  <div className="stat-card stat-teal">
                    <div className="stat-icon"><i className="bx bxs-medal"></i></div>
                    <div className="stat-info">
                      <h3>HB+ Score</h3>
                      <h2>{isDraft ? "—" : finalScore.toFixed(2)}</h2>
                      <p>{isDraft
                        ? `${statPeriod || 'No period'} — awaiting entry`
                        : `${finalBand} · ${statPeriod}${statIsCurrent ? '' : ' (last recorded)'}`}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-violet">
                    <div className="stat-icon"><i className="bx bx-calendar-event"></i></div>
                    <div className="stat-info">
                      <h3>Attendance Rate</h3>
                      <h2>{attendance === null || attendance === undefined ? '—' : `${Number(attendance).toFixed(0)}%`}</h2>
                      <p>{statRun && statRun.meetings_scheduled
                        ? `${statRun.meetings_attended ?? 0} of ${statRun.meetings_scheduled} meetings · ${statPeriod}`
                        : `${statPeriod || 'No period'}`}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-amber">
                    <div className="stat-icon"><i className="bx bxs-star"></i></div>
                    <div className="stat-info">
                      <h3>Sessions Completed</h3>
                      <h2>{sessions === null || sessions === undefined ? '—' : sessions}</h2>
                      <p>{statPeriod || 'No active period'}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-red">
                    <div className="stat-icon"><i className="bx bxs-error"></i></div>
                    <div className="stat-info">
                      <h3>Active Violations</h3>
                      <h2>{activeVio.length}</h2>
                      <p>Annexure-1 incidents</p>
                    </div>
                  </div>
                </div>

                <div className="dashboard-grid" style={{ marginTop: '1.5rem' }}>
                  {/* One section at a time: the three cards were a long scroll, and
                      only one of them is usually being read. */}
                  <div className="grid-span-12">
                    <ScorecardTabs
                      groups={COACH_DETAIL_TABS.filter(t => !(t.pay && HIDES_PAY(currentRole)))}
                      active={coachDetailTab}
                      onChange={switchCoachDetailTab}
                      weights={{}}
                    />
                  </div>

                  {coachDetailTab === 'profile' && (
                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Profile</h3>
                      {cardEditControls('profile')}
                    </div>
                    <div className="detail-grid">
                      {editingProfile ? (
                        <>
                          {editItem("Coach Name", textField("name"))}
                          {editItem("Coach UHID", <span className="detail-readonly">{coach.id}<small>identifier — not editable</small></span>)}
                          {editItem("Gender", selectField("gender", ["", ...GENDER_OPTIONS]))}
                          {editItem("Type of Coach", selectField("coach_type", ["", ...COACH_TYPES.map(t => t.value)]))}
                          {editItem("Category", selectField("coach_category", COACH_CATEGORIES))}
                          {editItem("Policy Variant", selectField("variant_id", offeredVariants(variants, coachDraft.variant_id ?? coach.variant_id)
                            .map(v => ({ value: v.id, label: variantLabel(v) }))))}
                          {editItem("Designation", textField("internal_designation"))}
                          {editItem("Reporting Manager", selectField("reporting_manager_id", REPORTING_MANAGERS))}
                          {editItem("Assigned Property", textField("assigned_property"))}
                          {editItem("Date of Joining", textField("date_of_joining", "date"))}
                          {editItem("First Certification", textField("date_of_first_relevant_certification", "date"))}
                          {editItem("Phone", textField("phone"))}
                          {editItem("Email", textField("email", "email"))}
                          {editItem(
                            "Org Work",
                            !isOrgWorkEligible(coachDraft.coach_category ?? coach.coach_category) ? (
                              <span className="detail-readonly">
                                Not applicable
                                <small>only Flexi and Flexi-Fixed coaches are org-work eligible</small>
                              </span>
                            ) :
                            !orgWorkUnlocked ? (
                              <button
                                type="button"
                                className="dynamic-lock-btn org-work-lock"
                                title="Click to change what this coach is put on"
                                onClick={() => {
                                  const current = coachDraft.org_work_types || [];
                                  const proceed = window.confirm(
                                    `Org work decides what this coach is put on and what it is worth ` +
                                    `(currently ₹${orgWorkRate(current).toLocaleString('en-IN')}).\n\n` +
                                    `Do you want to change it?`
                                  );
                                  if (proceed) setOrgWorkUnlocked(true);
                                }}
                              >
                                <span>
                                  {(coachDraft.org_work_types || []).length
                                    ? `${(coachDraft.org_work_types || []).length} selected · ₹${orgWorkRate(coachDraft.org_work_types).toLocaleString('en-IN')}`
                                    : 'None selected'}
                                </span>
                                <i className="bx bx-lock-alt"></i>
                              </button>
                            ) : (
                            <div className="org-work-picker">
                              {ORG_WORK_TYPES.map(t => {
                                const chosen = (coachDraft.org_work_types || []).includes(t.value);
                                return (
                                  <label key={t.value} className={`org-work-option${chosen ? ' is-chosen' : ''}`}>
                                    <input
                                      type="checkbox"
                                      checked={chosen}
                                      onChange={(e) => setCoachField('org_work_types',
                                        e.target.checked
                                          ? [...(coachDraft.org_work_types || []), t.value]
                                          : (coachDraft.org_work_types || []).filter(x => x !== t.value))}
                                    />
                                    <span>{t.value}</span>
                                    <small>₹{t.min.toLocaleString('en-IN')}–{t.max.toLocaleString('en-IN')}</small>
                                  </label>
                                );
                              })}
                              <p className="org-work-rate">
                                Org rate: <strong>₹{orgWorkRate(coachDraft.org_work_types).toLocaleString('en-IN')}</strong>
                                <span className="text-muted"> at the band minimum · pick as many as apply</span>
                              </p>
                            </div>
                            )
                          )}
                          {editItem("Status", selectField("status", COACH_STATUSES))}
                        </>
                      ) : (
                        <>
                          {detailRow("Coach UHID", coach.id)}
                          {detailRow("Gender", coach.gender)}
                          {detailRow("Type of Coach", coach.coach_type || (vConfig ? vConfig.discipline : null))}
                          {detailRow("Category", coach.coach_category)}
                          {detailRow("Policy Variant", vConfig ? vConfig.name : coach.variant_id)}
                          {detailRow("Designation", coach.internal_designation)}
                          {detailRow("Reporting Manager", coach.reporting_manager_id)}
                          {detailRow("Assigned Property", coach.assigned_property)}
                          {detailRow("Date of Joining", formatDate(coach.date_of_joining))}
                          {detailRow("First Certification", formatDate(coach.date_of_first_relevant_certification))}
                          {detailRow("Phone", coach.phone)}
                          {detailRow("Email", coach.email)}
                          {detailRow(
                            "Org Work",
                            !isOrgWorkEligible(coach.coach_category)
                              ? 'Not applicable — Flexi & Flexi-Fixed only'
                              : (coach.org_work_types || []).length
                                ? `${coach.org_work_types.join(', ')} · ₹${orgWorkRate(coach.org_work_types).toLocaleString('en-IN')}`
                                : 'None selected'
                          )}
                          {detailRow("Status", coach.status)}
                        </>
                      )}
                    </div>
                    {editingProfile && (
                      <p className="text-muted detail-edit-note">
                        Changing Date of Joining or Type of Coach re-scores every period, since tenure and the policy variant feed the HB+ Score.
                      </p>
                    )}
                  </div>
                  )}

                  {/* Payment details are their own card: they are the one part of
                      the profile that goes to a bank rather than to scoring. */}
                  {coachDetailTab === 'bank' && !HIDES_PAY(currentRole) && (
                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Bank Details</h3>
                      {cardEditControls('bank')}
                    </div>
                    <div className="detail-grid">
                      {editingBank ? (
                        <>
                          {editItem("Account Holder Name", textField("bank_holder_name"))}
                          {editItem("Bank Name", textField("bank_name"))}
                          {editItem("Account Number", textField("bank_account"))}
                          {editItem("IFSC Code", textField("bank_ifsc"))}
                          {editItem("Branch", textField("bank_branch"))}
                          {editItem("Account Type", selectField("bank_account_type", BANK_ACCOUNT_TYPES))}
                          {editItem("UPI ID", textField("bank_upi"))}
                          {editItem("PAN Number", textField("pan_number"))}
                        </>
                      ) : (
                        <>
                          {detailRow("Account Holder Name", coach.bank_holder_name)}
                          {detailRow("Bank Name", coach.bank_name)}
                          {detailRow("Account Number", coach.bank_account)}
                          {detailRow("IFSC Code", coach.bank_ifsc)}
                          {detailRow("Branch", coach.bank_branch)}
                          {detailRow("Account Type", coach.bank_account_type)}
                          {detailRow("UPI ID", coach.bank_upi)}
                          {detailRow("PAN Number", coach.pan_number)}
                        </>
                      )}
                    </div>
                    {editingBank && (
                      <p className="text-muted detail-edit-note">
                        These details are what payroll pays into. An IFSC code is stored
                        in upper case. Nothing here affects the HB+ Score.
                      </p>
                    )}
                  </div>
                  )}

                  {coachDetailTab === 'experience' && (
                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Experience &amp; Education</h3>
                      {cardEditControls('experience')}
                    </div>
                    <div className="detail-grid">
                      {editingExperience ? (
                        <>
                          {editItem("Coaching Exp (Documented)", numField("freelance_past_exp_with_document"))}
                          {editItem("Coaching Exp (Undocumented)", numField("freelance_past_exp_without_document"))}
                          {editItem("Non-Coaching Exp", numField("non_coaching_exp_years"))}
                          {editItem("Highest Education", selectField("education_qualification",
                            educationQualificationOptions.includes(coach.education_qualification)
                              ? educationQualificationOptions
                              : [coach.education_qualification, ...educationQualificationOptions]))}
                          {editItem("Education Format", selectField("education_type", educationFormats))}
                        </>
                      ) : (
                        <>
                      {detailRow("Coaching Exp (Documented)", `${coach.freelance_past_exp_with_document ?? 0} yrs`)}
                      {detailRow("Coaching Exp (Undocumented)", `${coach.freelance_past_exp_without_document ?? 0} yrs`)}
                      {detailRow("Non-Coaching Exp", `${coach.non_coaching_exp_years ?? 0} yrs`)}
                      {detailRow("Highest Education", coach.education_qualification)}
                      {detailRow("Education Format", educationFormats.find(f => f.value === coach.education_type)?.label || coach.education_type)}
                      {!HIDES_PAY(currentRole) && coach.flexi_fixed_base_salary != null && detailRow("Flexi-Fixed Base", `₹${Number(coach.flexi_fixed_base_salary).toLocaleString('en-IN')}`)}
                      {!HIDES_PAY(currentRole) && coach.offer_letter_fixed_salary != null && detailRow("Offer Letter Salary", `₹${Number(coach.offer_letter_fixed_salary).toLocaleString('en-IN')}`)}
                        </>
                      )}
                    </div>
                    {editingExperience && (
                      <p className="text-muted detail-edit-note">
                        Undocumented experience counts at 50% and non-coaching experience is halved before its 10-year cap.
                        Changing education clears any hand-entered education score on the score cards.
                      </p>
                    )}

                    <div className="card-header-row" style={{ marginTop: '1.5rem' }}>
                      <h3>Education Certificates</h3>
                      {cardEditControls('education')}
                    </div>

                    {editingEducation ? (
                      <>
                        <div className="cert-edit-list">
                          {(coachDraft.education || []).length === 0 && (
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                              No education recorded yet. Add the first certificate below.
                            </p>
                          )}
                          {(coachDraft.education || []).map((row, i) => (
                            <div className="cert-edit-row edu-edit-row" key={row.id || i}>
                              <div className="edu-edit-fields">
                                <label>
                                  <span>Stage</span>
                                  <select
                                    className="detail-input"
                                    value={row.level ?? ""}
                                    onChange={(e) => setEduField(i, 'level', e.target.value)}
                                  >
                                    <option value="">Select…</option>
                                    {EDUCATION_TIERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                  </select>
                                </label>
                                <label>
                                  <span>Institution</span>
                                  <input
                                    type="text" className="detail-input"
                                    placeholder="e.g. Pune University"
                                    value={row.institution ?? ""}
                                    onChange={(e) => setEduField(i, 'institution', e.target.value)}
                                  />
                                </label>
                                <label>
                                  <span>Qualification</span>
                                  <select
                                    className="detail-input"
                                    value={row.qualification ?? ""}
                                    onChange={(e) => setEduField(i, 'qualification', e.target.value)}
                                  >
                                    <option value="">Select…</option>
                                    {educationQualifications.map(q => <option key={q} value={q}>{q}</option>)}
                                  </select>
                                </label>
                                <label>
                                  <span>Format</span>
                                  <select
                                    className="detail-input"
                                    value={row.format ?? ""}
                                    onChange={(e) => setEduField(i, 'format', e.target.value)}
                                  >
                                    <option value="">Select…</option>
                                    {educationFormats.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                  </select>
                                </label>
                                <label className="cert-edit-score">
                                  <span>Points</span>
                                  <input
                                    type="text" className="detail-input" readOnly tabIndex={-1}
                                    title="Set by the qualification and format, on the Education Master"
                                    value={row.score === "" || row.score == null ? "—" : Number(row.score).toFixed(1)}
                                  />
                                </label>
                                <label className="edu-edit-doc">
                                  <span>Certificate</span>
                                  {row.pdfData ? (
                                    <span className="edu-doc-chip">
                                      <a href={row.pdfData} download={row.pdfName || 'certificate'} target="_blank" rel="noreferrer">
                                        <i className={getFileIcon(row.pdfName)}></i> {row.pdfName || 'certificate'}
                                      </a>
                                      <button
                                        type="button" title="Remove this document" aria-label="Remove document"
                                        onClick={() => setCoachDraft(prev => ({
                                          ...prev,
                                          education: (prev.education || []).map((r, j) =>
                                            j === i ? { ...r, pdfName: "", pdfData: "" } : r)
                                        }))}
                                      >
                                        <i className="bx bx-x"></i>
                                      </button>
                                    </span>
                                  ) : (
                                    <input
                                      type="file" className="detail-input"
                                      accept=".pdf,image/*,.doc,.docx"
                                      onChange={(e) => setEduDocument(i, e.target.files[0])}
                                    />
                                  )}
                                </label>
                              </div>
                              <button
                                type="button" className="btn-row-icon icon-cancel"
                                title="Remove this education entry" aria-label="Remove"
                                onClick={() => removeEduRow(i)}
                              >
                                <i className="bx bx-trash"></i>
                              </button>
                            </div>
                          ))}
                        </div>

                        <button type="button" className="btn btn-secondary" style={{ marginTop: '.75rem' }} onClick={addEduRow}>
                          <i className="bx bx-plus"></i> Add Education Certificate
                        </button>
                        <p className="text-muted detail-edit-note">
                          Record everything from school upward. The stage says which is
                          which, and the highest stage is the one that scores — so listing
                          school or intermediate alongside a degree never lowers the HB+
                          Score. Points come from the qualification and format pairing on
                          the Education Master and cannot be typed here. Rows without a
                          qualification are discarded on save.
                        </p>
                      </>
                    ) : coach.education && coach.education.length > 0 ? (
                      <ul className="detail-cert-list">
                        {/* Listed school upward, the way it was recorded, with the
                            entry that counts as the highest marked. */}
                        {[...coach.education]
                          .sort((a, b) => {
                            const rank = (l) => EDUCATION_TIERS.find(t => t.value === l)?.rank ?? 0;
                            return rank(a.level) - rank(b.level);
                          })
                          .map((row, i) => {
                          const highest = getHighestEducationEntry(coach);
                          const isHighest = highest && (highest.id ? highest.id === row.id : highest === row);
                          const tier = EDUCATION_TIERS.find(t => t.value === row.level);
                          return (
                          <li key={row.id || i}>
                            <span>
                              {tier && <span className="badge badge-muted edu-tier-badge">{tier.label}</span>}
                              <strong>{row.qualification}</strong>
                              {row.institution ? ` — ${row.institution}` : ''}
                              {row.format ? ` · ${educationFormats.find(f => f.value === row.format)?.label || row.format}` : ''}
                              {row.pdfData && (
                                <a
                                  href={row.pdfData} download={row.pdfName || 'certificate'}
                                  target="_blank" rel="noreferrer"
                                  title={`Open ${row.pdfName || 'certificate'}`}
                                  style={{ marginLeft: '8px' }}
                                >
                                  <i className={getFileIcon(row.pdfName)}></i>
                                </a>
                              )}
                              {isHighest && <span className="edu-highest-tag">highest</span>}
                            </span>
                            <span className="badge badge-info">{Number(row.score || 0).toFixed(1)} pts</span>
                          </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-muted" style={{ fontSize: '0.85rem' }}>No education recorded for this coach.</p>
                    )}

                    <div className="card-header-row" style={{ marginTop: '1.5rem' }}>
                      <h3>Technical Certifications</h3>
                      {cardEditControls('certifications')}
                    </div>

                    {editingCerts ? (
                      <>
                        {/* Free text, with the master list offered as suggestions —
                            typing something that is not on it is allowed. */}
                        <datalist id="cert-authority-options">
                          {[...new Set(certifications.map(c => c.authority))].sort().map(a => (
                            <option key={a} value={a} />
                          ))}
                        </datalist>
                        <datalist id="cert-course-options">
                          {certifications.map(c => (
                            <option key={c.id} value={c.course_name}>{c.authority} · {c.score} pts</option>
                          ))}
                        </datalist>

                        <div className="cert-edit-list">
                          {(coachDraft.certifications || []).length === 0 && (
                            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
                              No certifications yet. Add the first one below.
                            </p>
                          )}
                          {(coachDraft.certifications || []).map((cert, i) => (
                            <div className="cert-edit-row" key={cert.id || i}>
                              <div className="cert-edit-fields">
                                <label>
                                  <span>Awarding Body</span>
                                  <input
                                    type="text" className="detail-input" list="cert-authority-options"
                                    placeholder="e.g. NSCA"
                                    value={cert.authority ?? ""}
                                    onChange={(e) => setCertField(i, 'authority', e.target.value)}
                                  />
                                </label>
                                <label>
                                  <span>Course Name</span>
                                  <input
                                    type="text" className="detail-input" list="cert-course-options"
                                    placeholder="e.g. CSCS — Certified Strength & Conditioning Specialist"
                                    value={cert.course_name ?? ""}
                                    onChange={(e) => {
                                      const name = e.target.value;
                                      setCertField(i, 'course_name', name);
                                      // Picking a known course fills in its body and
                                      // score; typing a new one leaves them alone.
                                      const known = certifications.find(c => c.course_name === name);
                                      if (known) {
                                        setCertField(i, 'authority', known.authority);
                                        setCertField(i, 'score', known.score);
                                      }
                                    }}
                                  />
                                </label>
                                <label>
                                  <span>Format</span>
                                  <select
                                    className="detail-input"
                                    value={cert.format ?? ""}
                                    onChange={(e) => setCertField(i, 'format', e.target.value)}
                                  >
                                    <option value="">Select…</option>
                                    {educationFormats.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                                  </select>
                                </label>
                                <label className="cert-edit-score">
                                  <span>Points</span>
                                  <input
                                    type="text" className="detail-input" readOnly tabIndex={-1}
                                    title="Set on the Technical Certifications Master, in the Certifications tab"
                                    value={cert.score === "" || cert.score == null ? "—" : Number(cert.score).toFixed(1)}
                                  />
                                </label>
                              </div>
                              <button
                                type="button" className="btn-row-icon icon-cancel"
                                title="Remove this certification" aria-label="Remove"
                                onClick={() => removeCertRow(i)}
                              >
                                <i className="bx bx-trash"></i>
                              </button>
                            </div>
                          ))}
                        </div>

                        <button type="button" className="btn btn-secondary" style={{ marginTop: '.75rem' }} onClick={addCertRow}>
                          <i className="bx bx-plus"></i> Add Certification
                        </button>
                        <p className="text-muted detail-edit-note">
                          Points come from the Technical Certifications Master and cannot be
                          edited here — choosing a course from the suggestions fills them in.
                          A course that is not on the master carries no points until it is added
                          there. Scoring takes the highest, so a weaker certification never lowers
                          the HB+ Score. Blank rows are discarded on save.
                        </p>
                      </>
                    ) : coach.certifications && coach.certifications.length > 0 ? (
                      <ul className="detail-cert-list">
                        {coach.certifications.map(cert => (
                          <li key={cert.id}>
                            <span>
                              <strong>{cert.authority}</strong> — {cert.course_name}
                              {cert.format && ` · ${educationFormats.find(f => f.value === cert.format)?.label || cert.format}`}
                            </span>
                            <span className="badge badge-info">{cert.score} pts</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted" style={{ fontSize: '0.85rem' }}>No certifications recorded for this coach.</p>
                    )}
                  </div>
                  )}

                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Score Management</h3>
                    </div>

                    {(() => {
                      const openOverrides = COACH_SCORECARD_COLUMNS.filter(c => {
                        const v = (scoreDraft.overrides || {})[c.key];
                        return editingScorePeriod && v !== undefined && v !== null && v !== "";
                      });
                      if (openOverrides.length === 0) return null;
                      return (
                        <div className="override-warning">
                          <i className="bx bx-error"></i>
                          <div>
                            <strong>{openOverrides.length} calculated {openOverrides.length > 1 ? 'cells are' : 'cell is'} being overridden on {editingScorePeriod}.</strong>
                            <span> {openOverrides.map(c => c.label).join(', ')} will stop following the calculation once saved. Use the reset button to put them back.</span>
                          </div>
                        </div>
                      );
                    })()}

                    {allRuns.length === 0 ? (
                      <p className="text-muted" style={{ fontSize: '0.85rem' }}>No score cards recorded for this coach yet.</p>
                    ) : (
                      <>
                      {allRuns.length > 1 && (
                        <div className="scorecard-range">
                          <span className="scorecard-range-label">Pay cycles</span>
                          <select
                            className="header-select"
                            value={allRuns[fromIdx]?.period_month ?? ''}
                            onChange={(e) => setScorecardFrom(e.target.value)}
                          >
                            {allRuns.map(r => <option key={r.period_month} value={r.period_month}>{r.period_month}</option>)}
                          </select>
                          <span className="scorecard-range-to">to</span>
                          <select
                            className="header-select"
                            value={allRuns[toIdx]?.period_month ?? ''}
                            onChange={(e) => setScorecardTo(e.target.value)}
                          >
                            {allRuns.map(r => <option key={r.period_month} value={r.period_month}>{r.period_month}</option>)}
                          </select>
                          <span className="text-muted scorecard-range-count">
                            {visibleRuns.length} of {allRuns.length}
                          </span>
                          {(scorecardFrom || scorecardTo) && (
                            <button
                              type="button" className="btn btn-secondary scorecard-range-reset"
                              onClick={() => { setScorecardFrom(""); setScorecardTo(""); }}
                            >
                              Show all
                            </button>
                          )}
                        </div>
                      )}

                      <ScorecardTabs
                        groups={tabGroups}
                        active={scorecardTab}
                        onChange={setScorecardTab}
                        weights={vConfig.weights}
                      />

                      {/* Edits live in the browser until they are saved, and
                          they can be spread over several months at once, so the
                          count and the way to commit them sit above the table
                          rather than only on the row being edited. */}
                      {(() => {
                        const openKey = editingScorePeriod
                          ? draftKey(coach.id, editingScorePeriod) : null;
                        const keys = new Set([
                          ...Object.keys(pendingDrafts).filter(k => k.startsWith(`${coach.id}|`)),
                          ...(openKey ? [openKey] : [])
                        ]);
                        if (keys.size === 0) return null;
                        const months = [...keys].map(k => k.split('|')[1]);
                        return (
                          <div className="unsaved-drafts-bar">
                            <i className="bx bx-save"></i>
                            <span>
                              <strong>{keys.size} unsaved score card{keys.size === 1 ? '' : 's'}</strong>
                              <small>
                                {months.join(', ')} — {autoSaveAt === 'saving'
                                  ? 'saving…'
                                  : autoSaveAt
                                    ? `saved automatically at ${autoSaveAt}; Save to finish and close`
                                    : 'saved automatically a couple of seconds after you stop typing'}
                              </small>
                            </span>
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => saveAllPendingDrafts(coach, allRuns)}
                            >
                              Save {keys.size === 1 ? '' : 'all'}
                            </button>
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                if (!window.confirm(`Discard ${keys.size} unsaved score card${keys.size === 1 ? '' : 's'}?\n\n${months.join(', ')}`)) return;
                                setPendingDrafts(prev => Object.fromEntries(
                                  Object.entries(prev).filter(([k]) => !keys.has(k))
                                ));
                                if (openKey) cancelScoreRowEdit();
                                showToast("Unsaved changes discarded.", "info");
                              }}
                            >
                              Discard
                            </button>
                          </div>
                        );
                      })()}

                      {renderScorecardTable(visibleScorecardGroups, scorecardTab, 'main')}

                      <h4 className="scorecard-subhead">{incentiveGroup.label}</h4>
                      {renderScorecardTable(incentiveScorecardGroups, 'incentive', 'incentive')}
                      </>
                    )}

                    <p className="text-muted scorecard-legend">
                      <span className="entry-tag entry-manual">Manual</span> cells are keyed in — by RM, from the app, or as the coach's one-time entry.
                      <span className="entry-tag entry-derived">Dynamic</span> cells are calculated and update live as you edit.
                      One-time entries sit on the coach profile, so changing them here re-scores every period.
                      Dynamic cells stay locked while a row is open — click one and confirm to take it over; it then becomes a hand-entered override (amber edge) and re-drives everything below it. The reset button returns the row to calculated.
                      A new period opens automatically once the calendar passes the 15th — its dynamic cells fill in at once, its manual cells wait to be recorded.
                    </p>
                  </div>

                  {/* Pay lives in these two cards, so they are the gate. */}
                  {!HIDES_PAY(currentRole) && (
                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Payroll Calculator</h3>
                      {/* The slip belongs with the pay it states, not with the
                          scores. Same rule as the payslip buttons elsewhere: a
                          slip is issued once Finance has locked the month. */}
                      {canManage && statRun && (() => {
                        const slipPeriod = statRun.period_month;
                        const slipLocked = statRun.status === 'FINANCE_LOCKED';
                        const mayIssue = slipLocked || currentRole === 'Super Admin';
                        return (
                          <button
                            className="btn btn-primary"
                            disabled={!mayIssue}
                            title={mayIssue
                              ? `Download the ${slipPeriod} salary slip`
                              : `${slipPeriod} is not finance-locked yet, so no slip can be issued`}
                            onClick={() => handleOpenPayslipModal(coach.id, slipPeriod)}
                          >
                            <i className="bx bx-download"></i> Download Salary Slip
                          </button>
                        );
                      })()}
                    </div>
                    {(() => {
                      const selected = allRuns.find(r => r.period_month === payCalcPeriod) || allRuns[allRuns.length - 1];
                      if (!selected) {
                        return <p className="text-muted" style={{ fontSize: '0.85rem' }}>No period to calculate pay for yet.</p>;
                      }
                      const seedRow = buildScoreRow(coach, selected);
                      const periodVios = coachVios.filter(v =>
                        v.status !== 'Appeal_Approved' &&
                        new Date(v.incident_date) >= new Date(selected.period_start) &&
                        new Date(v.incident_date) <= new Date(selected.period_end)
                      );
                      const periodOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === selected.period_month && o.status === 'Approved');

                      return (
                        <>
                          <p className="text-muted calc-seed-note">
                            Seeded from {selected.period_month}'s score card
                            ({fmtDay(selected.period_start)} – {fmtDay(selected.period_end)}).
                            Change any input to model a different outcome — nothing here writes back to the record.
                          </p>
                          <PayCalculator
                            variants={variants}
                            onSavePayOverrides={savePayOverrides}
                            coachOptions={[coach]}
                            selectedCoachId={coach.id}
                            lockCoach
                            periodOptions={allRuns.map(r => r.period_month)}
                            onPeriodChange={setPayCalcPeriod}
                            canOverridePay={PROFILE_PAY_ROLES.includes(currentRole)}
                            seed={{
                              key: `${coach.id}-${selected.period_month}`,
                              periodMonth: selected.period_month,
                              periodRange: `${new Date(selected.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(selected.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
                              coreRecorded: hasCorePerformance(selected),
                              coachId: coach.id,
                              coachName: coach.name,
                              variantId: coach.variant_id,
                              category: coach.coach_category,
                              score: seedRow.hb_score,
                              sessions: Number(selected.sessions_completed) || 0,
                              nightSessions: Number(selected.night_sessions) || 0,
                              streak: Number(selected.five_star_streak) || 0,
                              consistency: (Number(selected.attendance_pct) >= 95 && periodVios.length === 0) ? "YES" : "NO",
                              orgWorkPay: periodOrgWork.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
                              penalties: periodVios
                                .filter(isPenaltyChargeable)
                                .reduce((sum, v) => sum + (Number(v.penalty_amount) || 0), 0),
                              missedSessions: Number(selected.missed_sessions) || 0,
                              penaltyItems: periodVios,
                              penaltyOtherCount: coachVios.filter(v => v.status !== 'Appeal_Approved').length - periodVios.length,
                              payFrom: resolvePay(selected),
                              baseOverride: carryPay(selected).fixed_pay_override
                                ?? (coach.coach_category === 'Flexi-Fixed'
                                  ? (coach.flexi_fixed_base_salary ?? "")
                                  : (coach.fixed_salary_override ?? "")),
                              rateOverride: carryPay(selected).per_session_override
                                ?? (coach.per_session_override ?? "")
                            }}
                          />
                        </>
                      );
                    })()}
                  </div>
                  )}

                  {!HIDES_PAY(currentRole) && (
                  <div className="card grid-span-12">
                    <div className="card-header-row"><h3>Payroll History</h3></div>
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Performance Month</th>
                            <th>HB+ Score</th>
                            <th>Band</th>
                            <th>Gross Monthly Pay</th>
                            <th>Lock Status</th>
                            <th className="actions-col">Payslip</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allRuns.length === 0 && (
                            <tr><td colSpan="6" className="text-muted">No payroll runs recorded yet.</td></tr>
                          )}
                          {allRuns.map(run => {
                            const scoreVal = run.hb_score != null
                              ? run.hb_score
                              : computeHBPlusScore(coach, run, vConfig).hbScore;
                            const bandVal = run.band || getPerformanceBand(scoreVal).label;
                            const monthVios = coachVios.filter(v => new Date(v.incident_date) >= new Date(run.period_start) && new Date(v.incident_date) <= new Date(run.period_end) && v.status !== 'Appeal_Approved');
                            const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === run.period_month && o.status === 'Approved');
                            const pay = computeMonthlyPay(coach, carryPay(run), { hbScore: scoreVal }, monthVios, vConfig, coachOrgWork);
                            const isLocked = run.status === 'FINANCE_LOCKED';

                            return (
                              <tr key={run.period_month}>
                                <td><strong>{run.period_month}</strong></td>
                                <td>{scoreVal.toFixed(2)}</td>
                                <td>{bandVal}</td>
                                <td>{isLocked ? `₹${pay.grossPay.toLocaleString('en-IN')}` : <span className="text-secondary">Draft Calculator</span>}</td>
                                <td>
                                  <span className={`badge ${isLocked ? 'badge-success' : 'badge-warning'}`}>
                                    {isLocked ? 'LOCKED / VERIFIED' : 'DRAFT'}
                                  </span>
                                </td>
                                <td className="actions-col">
                                  <button className="btn btn-secondary" onClick={() => handleOpenPayslipModal(coach.id, run.period_month)} disabled={!isLocked && currentRole !== 'Super Admin'}>
                                    <i className="bx bx-file-pdf"></i> Preview
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  )}

                  <div className="card grid-span-12">
                    <div className="card-header-row"><h3>Disciplinary History</h3></div>
                    <div className="table-container">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Incident ID</th>
                            <th>Type</th>
                            <th>Occurrence</th>
                            <th>Consequence</th>
                            <th>Incident Date</th>
                            <th>Reported By</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {coachVios.length === 0 && (
                            <tr><td colSpan="7" className="text-muted">No disciplinary incidents on record.</td></tr>
                          )}
                          {coachVios.map(v => (
                            <tr key={v.id}>
                              <td><strong>{v.id}</strong></td>
                              <td>{v.type}</td>
                              <td>#{v.occurrence_no}</td>
                              <td>{v.consequence}</td>
                              <td>{formatDate(v.incident_date)}</td>
                              <td>{v.reported_by}</td>
                              <td><span className={`badge ${v.status === 'Appeal_Approved' ? 'badge-success' : 'badge-warning'}`}>{v.status}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </section>
            );
          })()}

          {/* Coach Master View */}
          {activeView === 'coaches' && !coachDetailId && (
            <section id="view-coaches" className="content-view active-view">
              <div className="page-header-row">
                <h2>Coach Master Directory</h2>
                {(currentRole === "Super Admin" || currentRole === "HR Manager") && (
                  <button className="btn btn-primary" onClick={() => {
                    resetAddCoachForm();
                    setActiveModal("add-coach");
                  }}><i className="bx bx-plus"></i> Add New Coach</button>
                )}
              </div>

              {/* Filters */}
              <div className="filter-card">
                <div className="filter-grid">
                  <div className="filter-item">
                    <label>Search Coach</label>
                    <input type="text" placeholder="Search by name, ID..." value={coachesSearch} onChange={(e) => setCoachesSearch(e.target.value)} />
                  </div>
                  <div className="filter-item">
                    <label>Filter Type</label>
                    <select value={coachesVariantFilter} onChange={(e) => setCoachesVariantFilter(e.target.value)}>
                      <option value="All">All Types</option>
                      <option value="Strength">Strength</option>
                      <option value="Yoga">Yoga</option>
                      <option value="Pilates">Pilates</option>
                      <option value="Physio">Physio</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Filter Category</label>
                    <select value={coachesCategoryFilter} onChange={(e) => setCoachesCategoryFilter(e.target.value)}>
                      <option value="All">All Categories</option>
                      <option value="Fixed">Fixed</option>
                      <option value="Flexi-Fixed">Flexi-Fixed</option>
                      <option value="Flexi">Flexi</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Filter Status</label>
                    <select value={coachesStatusFilter} onChange={(e) => setCoachesStatusFilter(e.target.value)}>
                      <option value="All">All Statuses</option>
                      <option value="Active">Active</option>
                      <option value="Suspended">Suspended</option>
                      <option value="Exited">Exited</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Coaches Table */}
              <div className="table-container card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Coach ID</th>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>Designation</th>
                      <th>Band</th>
                      <th>DOJ</th>
                      <th>RM</th>
                      <th>Status</th>
                      <th className="actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {coaches.filter(c => {
                      const matchesSearch = c.name.toLowerCase().includes(coachesSearch.toLowerCase()) || c.id.toLowerCase().includes(coachesSearch.toLowerCase());
                      const matchesVariant = matchesCoachType(c, coachesVariantFilter);
                      const matchesCategory = coachesCategoryFilter === "All" || c.coach_category === coachesCategoryFilter;
                      const matchesStatus = coachesStatusFilter === "All" || c.status === coachesStatusFilter;
                      return matchesSearch && matchesVariant && matchesCategory && matchesStatus;
                    }).map(c => {
                      const vConfig = findVariant(variants, c.variant_id);
                      // The band the coach is on in the open cycle, and whether
                      // it moved. Pay no longer follows the band, so a move is
                      // something to act on rather than just a fact.
                      const openRecord = currentMonth.find(r => r.coach_id === c.id);
                      const openBand = openRecord?.hb_score != null
                        ? (openRecord.band || getPerformanceBand(openRecord.hb_score).label)
                        : null;
                      const bandMove = openRecord ? bandMoveFor(c.id, openRecord.period_month) : null;
                      let statusClass = "badge-muted";
                      if (c.status === "Active") statusClass = "badge-success";
                      if (c.status === "Suspended") statusClass = "badge-danger";
                      if (c.status === "Exited") statusClass = "badge-muted";

                      return (
                        <tr
                          key={c.id}
                          className="row-clickable"
                          title="Open coach page"
                          onClick={() => setCoachDetailId(c.id)}
                        >
                          <td><strong>{c.id}</strong></td>
                          <td>
                            <strong>{c.name}</strong>
                            {c.pdfData && (
                              <a 
                                href={c.pdfData} 
                                download={c.pdfName || "profile.pdf"} 
                                title={`Download/View document: ${c.pdfName}`}
                                style={{ marginLeft: '8px', color: 'var(--primary-color)', textDecoration: 'none' }}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <i className={getFileIcon(c.pdfName)} style={{ fontSize: '1.15rem', verticalAlign: 'middle' }}></i>
                              </a>
                            )}
                          </td>
                          <td>{c.coach_type || (vConfig ? (vConfig.discipline === 'S&C' ? 'Strength' : vConfig.discipline) : c.variant_id)}</td>
                          <td>{c.coach_category}</td>
                          <td>{c.internal_designation || 'Coach'}</td>
                          <td
                            className={bandMove ? `band-moved band-moved-${bandMove.up ? 'up' : 'down'}` : ''}
                            title={bandMove
                              ? `Moved ${bandMove.up ? 'up' : 'down'} from ${bandMove.from} (${bandMove.fromMonth}) — pay does not follow`
                              : undefined}
                          >
                            {openBand
                              ? <>{openBand.replace(/ .*/, '')}{bandMove && (
                                  <i className={`bx ${bandMove.up ? 'bx-up-arrow-alt' : 'bx-down-arrow-alt'} band-move-arrow`}></i>
                                )}</>
                              : <span className="text-muted">—</span>}
                          </td>
                          {/* A joining date that never came across reads as the
                              Unix epoch, and tenure is 15% of the score, so it
                              is called out rather than shown as a real date. */}
                          <td>
                            {c.date_of_joining
                              ? new Date(c.date_of_joining).toLocaleDateString('en-IN')
                              : <span className="text-red" title="No joining date — tenure scores as the maximum five years">Not set</span>}
                          </td>
                          <td>{c.reporting_manager_id}</td>
                          <td><span className={`badge ${statusClass}`}>{c.status}</span></td>
                          <td className="actions-col" onClick={(e) => e.stopPropagation()}>
                            {(currentRole === "Super Admin" || currentRole === "HR Manager") ? (
                              <div className="table-btn-group">
                                <button className="btn-table-icon" title="Log Disciplinary Incident" onClick={() => handleOpenViolationModal(c.id)}>
                                  <i className="bx bx-error-circle text-red"></i>
                                </button>
                                <button className="btn-table-icon btn-delete-item" title="Suspend/Exit Coach" onClick={() => handleExitCoach(c.id)}>
                                  <i className="bx bx-log-out"></i>
                                </button>
                              </div>
                            ) : <span className="text-muted">Read-Only</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Monthly Score Records — the IT x HR score tracker sheet, rendered live */}
          {isViewEnabled('score-tracker') && activeView === 'score-tracker' && (() => {
            const rows = buildScoreTrackerRows();
            const months = [...new Set([...historicMonths, ...currentMonth].map(r => r.period_month))];

            // Unscored periods come back with hb_score null. Left in, they
            // coerce to 0 and drag the average down, and the best/worst
            // comparisons against null are always false. Score only what
            // has actually been scored.
            const scoredRows = rows.filter(r => r.hb_score != null);
            const scores = scoredRows.map(r => r.hb_score);
            const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
            const best = scoredRows.reduce((acc, r) => (!acc || r.hb_score > acc.hb_score ? r : acc), null);
            const worst = scoredRows.reduce((acc, r) => (!acc || r.hb_score < acc.hb_score ? r : acc), null);
            const coachCount = new Set(rows.map(r => r.coach_id)).size;

            const totalPages = Math.max(1, Math.ceil(rows.length / scoreRowsPerPage));
            const page = Math.min(scorePage, totalPages);
            const firstIndex = (page - 1) * scoreRowsPerPage;
            const pageRows = rows.slice(firstIndex, firstIndex + scoreRowsPerPage);

            // A weight is only printable when every filtered row agrees on it.
            const weightLabel = (keys) => {
              if (!keys || rows.length === 0) return null;
              const totals = new Set(rows.map(r => keys.reduce((sum, k) => sum + (r.weights[k] || 0), 0)));
              return totals.size === 1 ? `${[...totals][0]}%` : 'varies';
            };

            return (
              <section id="view-score-tracker" className="content-view active-view">
                <div className="tracker-toolbar">
                  <div className="tracker-toolbar-title">
                    <h2>Coach Remuneration / Score Tracker</h2>
                    <p>Track coach experience, technical knowledge and calculate remuneration fairly.</p>
                  </div>
                  <div className="tracker-toolbar-controls">
                    <div className="tracker-search">
                      <i className="bx bx-search"></i>
                      <input
                        type="text"
                        placeholder="Search by coach name or ID..."
                        value={scoreSearch}
                        onChange={(e) => { setScoreSearch(e.target.value); setScorePage(1); }}
                      />
                    </div>
                    <select value={scoreVariantFilter} onChange={(e) => { setScoreVariantFilter(e.target.value); setScorePage(1); }}>
                      <option value="All">All Types</option>
                      <option value="Strength">Strength</option>
                      <option value="Yoga">Yoga</option>
                      <option value="Pilates">Pilates</option>
                      <option value="Physio">Physio</option>
                    </select>
                    <select value={scoreCategoryFilter} onChange={(e) => { setScoreCategoryFilter(e.target.value); setScorePage(1); }}>
                      <option value="All">All Categories</option>
                      {COACH_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <select value={scoreMonthFilter} onChange={(e) => { setScoreMonthFilter(e.target.value); setScorePage(1); }}>
                      <option value="All">All Months</option>
                      {months.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={handleExportScoreTracker} title="Download CSV">
                      <i className="bx bx-download"></i> Export CSV
                    </button>
                  </div>
                </div>

                <div className="stats-row">
                  <div className="stat-card stat-blue">
                    <div className="stat-icon"><i className="bx bxs-group"></i></div>
                    <div className="stat-info">
                      <h3>Total Coaches</h3>
                      <h2>{coachCount}</h2>
                      <p>{rows.length} score records</p>
                    </div>
                  </div>
                  <div className="stat-card stat-teal">
                    <div className="stat-icon"><i className="bx bxs-bar-chart-alt-2"></i></div>
                    <div className="stat-info">
                      <h3>Average Total Score</h3>
                      <h2>{avgScore.toFixed(2)}</h2>
                      <p>{rows.length ? getPerformanceBand(avgScore).label : 'No records'}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-violet">
                    <div className="stat-icon"><i className="bx bxs-star"></i></div>
                    <div className="stat-info">
                      <h3>Highest Score</h3>
                      <h2>{best?.hb_score != null ? best.hb_score.toFixed(2) : '—'}</h2>
                      <p>{best ? best.coach_name : 'No records'}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-amber">
                    <div className="stat-icon"><i className="bx bxs-down-arrow-circle"></i></div>
                    <div className="stat-info">
                      <h3>Lowest Score</h3>
                      <h2>{worst?.hb_score != null ? worst.hb_score.toFixed(2) : '—'}</h2>
                      <p>{worst ? worst.coach_name : 'No records'}</p>
                    </div>
                  </div>
                </div>

                <div className="card score-tracker-card">
                  {/* One column group at a time, as the score card does, so the
                      table reads without running off the side. The bulk controls
                      sit with it: they act on this table, not the page. */}
                  <div className="tracker-tabs-row">
                    <ScorecardTabs
                      groups={trackerTabs}
                      active={trackerActive?.key}
                      onChange={setTrackerTab}
                      weights={{}}
                    />
                    <div className="tracker-bulk-controls">
                      {/* Both act on the tab you are on: its manual fields only.
                          The month is chosen in the dialog each opens. */}
                      {(() => {
                        const hasFields = Boolean(BULK_TABS[trackerActive?.key]);
                        const why = hasFields ? '' : `${trackerActive?.label} is calculated — nothing to enter`;
                        return (
                          <>
                            <button className="btn btn-secondary" disabled={!hasFields}
                                    title={why || `Download the ${trackerActive?.label} template`}
                                    onClick={() => openBulkDialog('template', trackerActive?.key)}>
                              <i className="bx bx-download"></i> Template · {trackerActive?.label}
                            </button>
                            <button className="btn btn-primary" disabled={!hasFields}
                                    title={why || `Upload ${trackerActive?.label} values`}
                                    onClick={() => openBulkDialog('upload', trackerActive?.key)}>
                              <i className="bx bx-upload"></i> Bulk Upload
                            </button>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="table-container score-tracker-container">
                    <table className="data-table score-tracker-table">
                      <thead>
                        <tr className="group-header-row">
                          {trackerGroups.map(group => {
                            const weight = weightLabel(group.weightKeys);
                            return (
                              <th key={group.key} colSpan={group.columns.length} className={`group-head group-${group.tone}`}>
                                {group.label}{weight && <span className="group-weight">(Weight: {weight})</span>}
                              </th>
                            );
                          })}
                        </tr>
                        <tr className="column-header-row">
                          {trackerGroups.flatMap(group => group.columns.map(col => {
                            const weight = weightLabel(col.weightOf ? [col.weightOf] : null);
                            const isSorted = scoreSort.key === col.key;
                            return (
                              <th
                                key={col.key}
                                onClick={col.sortable ? () => toggleScoreSort(col.key) : undefined}
                                className={[
                                  `group-tint-${group.tone}`,
                                  col.sticky ? `sticky-col sticky-${col.key}` : '',
                                  col.decimals !== undefined || col.money ? 'num-col' : '',
                                  col.emphasis ? 'emphasis-col' : '',
                                  col.sortable ? 'sortable-col' : ''
                                ].join(' ')}
                              >
                                <span className="col-label">
                                  {col.label}
                                  {col.sortable && (
                                    <i className={`bx ${isSorted ? (scoreSort.dir === 'asc' ? 'bx-chevron-up' : 'bx-chevron-down') : 'bx-chevron-down'} sort-icon ${isSorted ? 'sort-active' : ''}`}></i>
                                  )}
                                </span>
                                {/* Weight, or the ceiling the figure is out of —
                                    the same line the score card carries. */}
                                {(() => {
                                  const meta = trackerColumnMeta(col);
                                  const scale = weight
                                    || meta?.scale
                                    || (meta?.max && meta.max <= 20 ? `Max ${meta.max}` : null);
                                  return scale ? <span className="col-weight">{scale}</span> : null;
                                })()}
                                {(() => {
                                  const meta = trackerColumnMeta(col);
                                  if (!meta?.entry) return null;
                                  return (
                                    <span className={`entry-tag entry-${meta.entry}`}>
                                      {meta.entry === 'derived' ? 'Dynamic' : 'Manual'}
                                      {meta.source ? ` · ${meta.source}` : ''}
                                      {meta.note ? ` · ${meta.note}` : ''}
                                    </span>
                                  );
                                })()}
                              </th>
                            );
                          }))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.length === 0 && (
                          <tr>
                            <td colSpan={trackerColumns.length} className="text-muted">
                              No score records match the current filters.
                            </td>
                          </tr>
                        )}
                        {pageRows.map(row => (
                          <tr key={row.id} className="row-clickable" title="Open coach page" onClick={() => { setCoachDetailId(row.coach_id); setActiveView('coaches'); }}>
                            {trackerGroups.flatMap(group => group.columns.map(col => (
                              <td
                                key={col.key}
                                className={[
                                  col.sticky ? `sticky-col sticky-${col.key}` : '',
                                  col.decimals !== undefined || col.money ? 'num-col' : '',
                                  col.emphasis ? `emphasis-col emphasis-${group.tone}` : '',
                                  col.key === 'band' && bandMoveFor(row.coach_id, row.month)
                                    ? `band-moved band-moved-${bandMoveFor(row.coach_id, row.month).up ? 'up' : 'down'}`
                                    : ''
                                ].join(' ')}
                                title={col.key === 'band' && bandMoveFor(row.coach_id, row.month)
                                  ? `Moved ${bandMoveFor(row.coach_id, row.month).up ? 'up' : 'down'} from ${bandMoveFor(row.coach_id, row.month).from} (${bandMoveFor(row.coach_id, row.month).fromMonth})`
                                  : undefined}
                              >
                                {formatScoreCell(col, row)}
                                {col.key === 'band' && bandMoveFor(row.coach_id, row.month) && (
                                  <i className={`bx ${bandMoveFor(row.coach_id, row.month).up ? 'bx-up-arrow-alt' : 'bx-down-arrow-alt'} band-move-arrow`}></i>
                                )}
                              </td>
                            )))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="tracker-footer">
                    <span className="text-secondary">
                      {rows.length === 0
                        ? 'Showing 0 records'
                        : `Showing ${firstIndex + 1} - ${Math.min(firstIndex + scoreRowsPerPage, rows.length)} of ${rows.length} records across ${coachCount} coaches`}
                    </span>
                    <div className="tracker-pagination">
                      <label>Rows per page:</label>
                      <select value={scoreRowsPerPage} onChange={(e) => { setScoreRowsPerPage(Number(e.target.value)); setScorePage(1); }}>
                        {SCORE_TRACKER_PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <button className="btn-table-icon" disabled={page <= 1} onClick={() => setScorePage(page - 1)}>
                        <i className="bx bx-chevron-left"></i>
                      </button>
                      <span className="page-indicator">{page}</span>
                      <button className="btn-table-icon" disabled={page >= totalPages} onClick={() => setScorePage(page + 1)}>
                        <i className="bx bx-chevron-right"></i>
                      </button>
                    </div>
                  </div>
                </div>

                <p className="text-muted score-tracker-footnote">
                  Threshold is 156 sessions for Fixed S&amp;C coaches, 117 for Fixed Yoga, and 96 for Flexi / Flexi-Fixed.
                  Consistency Bonus pays ₹500 when attendance is 95%+ with no violations or no-shows in the period.
                  Undocumented freelance experience counts at 50%, and non-coaching experience is halved before its 10-year cap.
                </p>
              </section>
            );
          })()}

          {/* Payroll: a run computed from the score cards, plus the manual calculator */}
          {isViewEnabled('pay-calculator') && activeView === 'pay-calculator' && (() => {
            const periods = [...new Set([...historicMonths, ...currentMonth].map(r => r.period_month))];
            const period = periods.includes(payrollRunPeriod) ? payrollRunPeriod : (periods[periods.length - 1] || currentPeriodMonth);
            const fullRun = buildPayrollRun(period);
            // Filtering the run rather than only the table keeps the totals,
            // the stat cards and the export in step with what is on screen.
            const run = payrollCategoryFilter === "All"
              ? fullRun
              : fullRun.filter(r => r.coach.coach_category === payrollCategoryFilter);
            const sum = (fn) => run.reduce((acc, r) => acc + fn(r), 0);
            const totals = {
              base: sum(r => r.pay.basePay),
              extraSessions: sum(r => r.pay.extraSessions),
              extraSessionPay: sum(r => r.pay.extraSessionPay),
              sessionPay: sum(r => r.pay.sessionPay),
              night: sum(r => r.pay.nightSessionPay),
              milestone: sum(r => r.pay.milestoneIncentive),
              consistency: sum(r => r.pay.consistencyBonus),
              streakOrg: sum(r => r.pay.streakBonusPay + r.pay.orgWorkPay),
              deductions: sum(r => r.pay.penaltyDeductions),
              gross: sum(r => r.pay.grossPay)
            };
            totals.sessions = totals.extraSessionPay + totals.sessionPay;
            totals.incentives = totals.milestone + totals.consistency + totals.streakOrg + totals.night;

            const selected = run.find(r => r.coach.id === payCalcCoachId);

            return (
              <section id="view-pay-calculator" className="content-view active-view">
                <div className="page-header-row">
                  <div>
                    <h2>Payroll Run — {period}</h2>
                    <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                      Every line is computed from that coach's recorded HB+ Score. Nothing here is keyed in by hand.
                    </p>
                  </div>
                  <div className="tracker-toolbar-controls">
                    <select className="header-select" value={period} onChange={(e) => setPayrollRunPeriod(e.target.value)}>
                      {periods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                      className="header-select"
                      value={payrollCategoryFilter}
                      onChange={(e) => setPayrollCategoryFilter(e.target.value)}
                    >
                      <option value="All">All Categories</option>
                      {COACH_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={() => handleExportPayrollRun(period)}>
                      <i className="bx bx-download"></i> Export CSV
                    </button>
                  </div>
                </div>

                <div className="stats-row">
                  <div className="stat-card stat-blue">
                    <div className="stat-icon"><i className="bx bxs-group"></i></div>
                    <div className="stat-info">
                      <h3>Coaches In Run</h3><h2>{run.length}</h2>
                      <p>{run.filter(r => !r.recorded).length} awaiting score entry</p>
                    </div>
                  </div>
                  <div className="stat-card stat-violet">
                    <div className="stat-icon"><i className="bx bx-wallet"></i></div>
                    <div className="stat-info">
                      <h3>Base + Session Pay</h3><h2>{rupees(totals.base + totals.sessions)}</h2>
                      <p>Fixed and per-session</p>
                    </div>
                  </div>
                  <div className="stat-card stat-amber">
                    <div className="stat-icon"><i className="bx bxs-gift"></i></div>
                    <div className="stat-info">
                      <h3>Incentives</h3><h2>{rupees(totals.incentives)}</h2>
                      <p>Milestone, consistency, streak, org work</p>
                    </div>
                  </div>
                  <div className="stat-card stat-teal">
                    <div className="stat-icon"><i className="bx bx-rupee"></i></div>
                    <div className="stat-info">
                      <h3>Gross Payroll</h3><h2>{rupees(totals.gross)}</h2>
                      <p>after {rupees(totals.deductions)} deductions</p>
                    </div>
                  </div>
                </div>

                <div className="card score-tracker-card">
                  {/* The export also sits in the page toolbar, but the table is
                      where Finance actually works, so it is offered here too. */}
                  <div className="card-header-row payroll-run-head">
                    <h3>{period} Payroll Run <span className="text-muted">· {run.length} coach{run.length === 1 ? '' : 'es'}</span></h3>
                    <button
                      className="btn btn-secondary"
                      onClick={() => handleExportPayrollRun(period)}
                      disabled={run.length === 0}
                      title={run.length === 0 ? 'Nothing to export for this period' : `Download the ${period} payroll run as CSV`}
                    >
                      <i className="bx bx-download"></i> Download CSV
                    </button>
                  </div>

                  {/* The run still pays out on an unrecorded month, but Finance
                      needs to see that those lines rest on the fixed points
                      alone — the manual half has not been entered yet. */}
                  {run.some(r => !r.recorded) && (
                    <div className="payroll-incomplete-note">
                      <i className="bx bx-error"></i>
                      <div>
                        <strong>
                          {run.filter(r => !r.recorded).length} score card
                          {run.filter(r => !r.recorded).length > 1 ? 's have' : ' has'} not been recorded for {period}.
                        </strong>
                        <span>
                          {' '}Those lines are computed from the fixed points only — experience,
                          technical and tenure — with nothing for core performance or attendance,
                          so they band low and pay low. They are marked in the table below and in
                          the CSV export.
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="table-container score-tracker-container payroll-run-container">
                    <table className="data-table score-tracker-table">
                      <thead>
                        <tr className="group-header-row">
                          <th colSpan={4} className="group-head group-slate">Coach</th>
                          <th colSpan={2} className="group-head group-teal">Score</th>
                          <th colSpan={5} className="group-head group-blue">Session &amp; Base Pay</th>
                          <th colSpan={4} className="group-head group-green">Incentives</th>
                          <th colSpan={2} className="group-head group-red">Penalty &amp; Total</th>
                        </tr>
                        <tr className="column-header-row">
                          <th className="group-tint-slate sticky-col sticky-month">Coach</th>
                          <th className="group-tint-slate">Coach ID</th>
                          <th className="group-tint-slate">Category</th>
                          <th className="group-tint-slate">Variant</th>
                          <th className="group-tint-teal num-col emphasis-col">HB+ Score</th>
                          <th className="group-tint-teal">Band</th>
                          <th className="group-tint-blue num-col">Per-Session Rate</th>
                          <th className="group-tint-blue num-col">Base / Fixed Pay</th>
                          <th className="group-tint-blue num-col">Extra Sessions</th>
                          <th className="group-tint-blue num-col">Extra Session Pay</th>
                          <th className="group-tint-blue num-col">Per-Session Pay</th>
                          <th className="group-tint-green num-col">Night Premium</th>
                          <th className="group-tint-green num-col">Milestone</th>
                          <th className="group-tint-green num-col">Consistency</th>
                          <th className="group-tint-green num-col">Streak + Org Work</th>
                          <th className="group-tint-red num-col">Penalty</th>
                          <th className="group-tint-red num-col emphasis-col">Gross Pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.length === 0 && (
                          <tr><td colSpan={17} className="text-muted">No score records for {period}.</td></tr>
                        )}
                        {run.map(r => (
                          <tr
                            key={r.coach.id}
                            className={`row-clickable${r.recorded ? '' : ' row-unrecorded'}`}
                            title={r.recorded
                              ? "Open coach page"
                              : "Score card not recorded for this period — pay is computed on the fixed points alone"}
                            onClick={() => { setCoachDetailId(r.coach.id); setActiveView('coaches'); }}
                          >
                            <td className="sticky-col sticky-month"><strong>{r.coach.name}</strong></td>
                            <td>{r.coach.id}</td>
                            <td>{r.coach.coach_category}</td>
                            <td>{r.vConfig.name}</td>
                            <td className="num-col emphasis-col emphasis-teal">{Number(r.score).toFixed(2)}</td>
                            <td>{r.recorded ? r.band : <span className="badge badge-warning">Awaiting entry</span>}</td>
                            <td className="num-col">{rupees(r.pay.perSessionRate)}</td>
                            <td className="num-col">{rupees(r.pay.basePay)}</td>
                            <td className="num-col">{r.pay.extraSessions}</td>
                            <td className="num-col">{rupees(r.pay.extraSessionPay)}</td>
                            <td className="num-col">{rupees(r.pay.sessionPay)}</td>
                            <td className="num-col">{rupees(r.pay.nightSessionPay)}</td>
                            <td className="num-col">{rupees(r.pay.milestoneIncentive)}</td>
                            <td className="num-col">{rupees(r.pay.consistencyBonus)}</td>
                            <td className="num-col">{rupees(r.pay.streakBonusPay + r.pay.orgWorkPay)}</td>
                            <td className="num-col">{r.pay.penaltyDeductions ? `− ${rupees(r.pay.penaltyDeductions)}` : rupees(0)}</td>
                            <td className="num-col emphasis-col emphasis-teal">{rupees(r.pay.grossPay)}</td>
                          </tr>
                        ))}
                      </tbody>
                      {run.length > 0 && (
                        <tfoot>
                          <tr className="payroll-total-row">
                            <td className="sticky-col sticky-month"><strong>Total</strong></td>
                            <td colSpan={6}>{run.length} coaches</td>
                            <td className="num-col">{rupees(totals.base)}</td>
                            <td className="num-col">{totals.extraSessions}</td>
                            <td className="num-col">{rupees(totals.extraSessionPay)}</td>
                            <td className="num-col">{rupees(totals.sessionPay)}</td>
                            <td className="num-col">{rupees(totals.night)}</td>
                            <td className="num-col">{rupees(totals.milestone)}</td>
                            <td className="num-col">{rupees(totals.consistency)}</td>
                            <td className="num-col">{rupees(totals.streakOrg)}</td>
                            <td className="num-col">− {rupees(totals.deductions)}</td>
                            <td className="num-col emphasis-col">{rupees(totals.gross)}</td>
                          </tr>
                        </tfoot>
                      )}
                    </table>
                  </div>
                </div>

                <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
                  <div>
                    <h2>Monthly Pay Calculator</h2>
                    <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                      Choose a coach in the form below to load {period}'s figures automatically, or pick manual entry to model a case from scratch.
                    </p>
                  </div>
                  {PROFILE_PAY_ROLES.includes(currentRole) && (
                    <button
                      className="btn btn-secondary"
                      title={`Write ${period}'s fixed pay and per-session rate onto every coach's ${period} record, so later months carry them`}
                      onClick={() => pinMonthPayForAll(period)}
                    >
                      <i className="bx bx-lock-alt"></i> Fix {period} pay for all coaches
                    </button>
                  )}
                </div>

                <div className="card">
                  <PayCalculator
                    variants={variants}
                    onSavePayOverrides={savePayOverrides}
                    coachOptions={run.map(r => r.coach)}
                    selectedCoachId={payCalcCoachId}
                    onCoachChange={setPayCalcCoachId}
                    canOverridePay={PROFILE_PAY_ROLES.includes(currentRole)}
                    seed={selected ? {
                      key: `${selected.coach.id}-${period}`,
                      periodMonth: period,
                      periodRange: selected.record.period_start
                        ? `${new Date(selected.record.period_start).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${new Date(selected.record.period_end).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
                        : undefined,
                      coreRecorded: hasCorePerformance(selected.record),
                      coachId: selected.coach.id,
                      coachName: selected.coach.name,
                      variantId: selected.coach.variant_id,
                      category: selected.coach.coach_category,
                      score: selected.score,
                      sessions: Number(selected.record.sessions_completed) || 0,
                      nightSessions: Number(selected.record.night_sessions) || 0,
                      streak: Number(selected.record.five_star_streak) || 0,
                      consistency: selected.pay.consistencyEligible ? "YES" : "NO",
                      orgWorkPay: selected.pay.orgWorkPay,
                      penalties: selected.pay.penaltyDeductions,
                      missedSessions: Number(selected.record.missed_sessions) || 0,
                      penaltyItems: selected.periodVios || [],
                      penaltyOtherCount: (selected.coachVios?.length || 0) - (selected.periodVios?.length || 0),
                      payFrom: resolvePay(selected.record),
                      baseOverride: carryPay(selected.record).fixed_pay_override
                        ?? (selected.coach.coach_category === 'Flexi-Fixed'
                          ? (selected.coach.flexi_fixed_base_salary ?? "")
                          : (selected.coach.fixed_salary_override ?? "")),
                      rateOverride: carryPay(selected.record).per_session_override
                        ?? (selected.coach.per_session_override ?? "")
                    } : { key: `manual-${period}` }}
                  />
                </div>

                <div className="page-header-row" style={{ marginTop: '0.5rem' }}>
                  <div>
                    <h2>Compensation Reference Tables</h2>
                    <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                      Rates for {variants.find(v => v.id === payCalcVariant)?.name || ''} ({payCalcVariant}) — switch the policy variant to compare.
                    </p>
                  </div>
                  <select className="header-select" value={payCalcVariant} onChange={(e) => setPayCalcVariant(e.target.value)}>
                    {offeredVariants(variants, payCalcVariant).map(v => (
                      <option key={v.id} value={v.id}>Reference: {variantLabel(v)}</option>
                    ))}
                  </select>
                </div>

                <PayReferenceTables vConfig={variants.find(v => v.id === payCalcVariant)} penaltyMatrix={PENALTY_MATRIX} />
              </section>
            );
          })()}

          {/* Attendance & Leave */}
          {isViewEnabled('attendance') && activeView === 'attendance' && (() => {
            const coach = attendanceCoach;
            const isOwn = currentRole === 'Coach';
            const canApprove = LEAVE_APPROVER_ROLES.includes(currentRole);
            // A Showrunner may see days worked and days off, but never what a
            // day of Loss of Pay costs — that is pay.
            const seesMoney = !HIDES_PAY(currentRole);
            const open = coach ? openLogFor(coach.id) : null;
            const todays = coach ? logsFor(coach.id, todayWorkingDay) : [];
            const hours = loggedHoursForDay(todays, nowTick);
            const avail = coach ? availabilityHoursFor(coach, todayWorkingDay) : { hours: 0, missing: true };
            const todayHoliday = coach ? holidayOn(coach, todayWorkingDay) : null;
            const day = coach ? assessAttendanceDay({
              category: coach.coach_category,
              availabilityHours: avail.hours,
              loggedHours: hours,
              isWeeklyOff: isWeeklyOffFor(coach, todayWorkingDay),
              isHoliday: !!todayHoliday,
              onApprovedLeave: leaveApplications.some(a =>
                a.coach_id === coach.id && a.status === 'Approved' &&
                a.from_date <= todayWorkingDay && a.to_date >= todayWorkingDay),
              availabilityMissing: avail.missing
            }) : null;

            // Everything waiting on this approver. A Reporting Manager decides for
            // their own squad; Super Admin and HR stand in for any of them, which is
            // what makes cover possible when a manager is away.
            const pending = leaveApplications
              .filter(a => a.status === 'Pending')
              .filter(a => {
                if (!canApprove) return a.coach_id === coach?.id;
                if (currentRole !== 'Reporting Manager') return true;
                const applicant = coaches.find(c => c.id === a.coach_id);
                return !currentRmContext || applicant?.reporting_manager_id === currentRmContext;
              })
              .sort((a, b) => new Date(a.applied_at) - new Date(b.applied_at));
            const mine = coach ? leaveApplications.filter(a => a.coach_id === coach.id) : [];

            return (
              <section id="view-attendance" className="content-view active-view">
                <div className="page-header-row">
                  <div>
                    <h2>Attendance &amp; Leave</h2>
                    <p className="text-secondary" style={{ fontSize: '0.85rem', marginTop: '4px' }}>
                      The working day runs 4 AM to 2 AM. Log in and out as many times as the
                      day needs — a period under {MIN_LOGIN_MINUTES} minutes does not count.
                    </p>
                  </div>
                  {!isOwn && (
                    <select
                      className="header-select"
                      value={coach?.id || ''}
                      onChange={(e) => setAttendanceCoachId(e.target.value)}
                    >
                      <option value="">No coach open — showing everyone</option>
                      {coaches.filter(c => c.status === 'Active').map(c => (
                        <option key={c.id} value={c.id}>{c.id} — {c.name}</option>
                      ))}
                    </select>
                  )}
                </div>

                {/* Every application across every coach, which is the view the
                    per-coach history cannot give and the pending queue only half
                    gives. A Reporting Manager sees their squad; HR and Super
                    Admin see all of them. */}
                {canApprove && (() => {
                  const scoped = leaveApplications.filter(a => {
                    if (currentRole === 'Reporting Manager' && currentRmContext) {
                      const applicant = coaches.find(c => c.id === a.coach_id);
                      if (applicant?.reporting_manager_id !== currentRmContext) return false;
                    }
                    if (leaveRegister.status !== 'All' && a.status !== leaveRegister.status) return false;
                    if (leaveRegister.coach !== 'All' && a.coach_id !== leaveRegister.coach) return false;
                    // Overlap, not containment: a leave running across the window
                    // is in it, even if neither end falls inside.
                    if (leaveRegister.from && a.to_date < leaveRegister.from) return false;
                    if (leaveRegister.to && a.from_date > leaveRegister.to) return false;
                    return true;
                  }).sort((a, b) => b.from_date.localeCompare(a.from_date));

                  const totalDays = scoped
                    .filter(a => a.status === 'Approved' || a.status === 'Partially_Approved')
                    .reduce((n, a) => n + Number(a.approved_days ?? a.days), 0);

                  return (
                    <div className="card card-feature" style={{ marginBottom: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Leave Register</h3>
                        <div className="table-btn-group">
                          <span className="text-muted" style={{ fontSize: '0.82rem', marginRight: '0.5rem' }}>
                            {scoped.length} application{scoped.length === 1 ? '' : 's'} · {totalDays} day(s) approved
                          </span>
                          {pending.length > 0 && leaveRegister.status !== 'Pending' && (
                            <button
                              className="btn btn-primary btn-sm"
                              onClick={() => setLeaveRegister(f => ({ ...f, status: 'Pending' }))}
                            >
                              {pending.length} waiting on you
                            </button>
                          )}
                          {leaveRegister.status === 'Pending' && (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => setLeaveRegister(f => ({ ...f, status: 'All' }))}
                            >
                              Show all
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="text-secondary" style={{ fontSize: '0.84rem', marginTop: 0 }}>
                        Every application, every coach. Decide from the row; click a name to
                        open that coach below. A decision is due within 3 working days, and a
                        coach is not marked Loss of Pay while theirs is still waiting.
                      </p>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Status</label>
                          <select value={leaveRegister.status}
                            onChange={(e) => setLeaveRegister(f => ({ ...f, status: e.target.value }))}>
                            <option value="All">All statuses</option>
                            {['Pending', 'Approved', 'Partially_Approved', 'Rejected', 'Cancelled']
                              .map(st => <option key={st} value={st}>{st.replace(/_/g, ' ')}</option>)}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Coach</label>
                          <select value={leaveRegister.coach}
                            onChange={(e) => setLeaveRegister(f => ({ ...f, coach: e.target.value }))}>
                            <option value="All">All coaches</option>
                            {coaches.map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>Leave on or after</label>
                          <input type="date" value={leaveRegister.from}
                            onChange={(e) => setLeaveRegister(f => ({ ...f, from: e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>Leave on or before</label>
                          <input type="date" value={leaveRegister.to}
                            onChange={(e) => setLeaveRegister(f => ({ ...f, to: e.target.value }))} />
                        </div>
                      </div>

                      {scoped.length === 0 ? (
                        <p className="text-muted">Nothing matches those filters.</p>
                      ) : (
                        <div className="table-container">
                          <table className="data-table">
                            <thead>
                              <tr>
                                <th>Coach</th><th>Type</th><th>Dates</th>
                                <th className="num-col">Days</th><th>Status</th>
                                <th>Waiting</th><th>Note</th>
                                <th className="actions-col">Decide</th>
                              </tr>
                            </thead>
                            <tbody>
                              {scoped.map(a => {
                                const c = coaches.find(x => x.id === a.coach_id);
                                const waited = a.applied_at
                                  ? Math.floor((Date.now() - new Date(a.applied_at)) / 86400000) : null;
                                const overdue = a.status === 'Pending' && waited >= 3;
                                return (
                                  <tr key={a.id} className={
                                    overdue ? 'leave-overdue'
                                      : a.status === 'Pending' ? 'leave-pending' : ''}>
                                    <td>
                                      {/* The name is the way into the coach: a decision
                                          often needs the attendance behind it. */}
                                      <button
                                        className="linklike"
                                        title="Open this coach below — attendance, balances and history"
                                        onClick={() => openCoachOnAttendance(a.coach_id)}
                                      >
                                        <strong>{c?.name || a.coach_id}</strong>
                                      </button><br />
                                      <small className="text-muted">{a.coach_id}</small>
                                    </td>
                                    <td>{leaveType(a.type_id)?.label}</td>
                                    <td>{a.from_date}{a.to_date !== a.from_date ? ` → ${a.to_date}` : ''}</td>
                                    <td className="num-col">
                                      {a.approved_days != null && a.approved_days !== a.days
                                        ? <>{a.approved_days}<br /><small className="text-muted">of {a.days}</small></>
                                        : a.days}
                                    </td>
                                    <td>
                                      <span className={`badge ${
                                        a.status === 'Approved' ? 'badge-success'
                                          : a.status === 'Partially_Approved' ? 'badge-info'
                                          : a.status === 'Rejected' ? 'badge-danger'
                                          : a.status === 'Cancelled' ? 'badge-muted' : 'badge-warning'}`}>
                                        {a.status.replace(/_/g, ' ')}
                                      </span>
                                    </td>
                                    <td>
                                      <small className={overdue ? 'text-red' : 'text-muted'}>
                                        {a.status !== 'Pending'
                                          ? (a.decided_by ? `by ${a.decided_by}` : '—')
                                          : waited === 0 ? 'applied today'
                                            : `${waited} day${waited === 1 ? '' : 's'}`}
                                      </small>
                                      {overdue && <><br /><small className="text-red">past the deadline</small></>}
                                    </td>
                                    <td><small className="text-muted">
                                      {a.decision_note || a.cancel_note || a.reason || '—'}
                                    </small></td>
                                    <td className="actions-col">
                                      <div className="table-btn-group">
                                        {a.status === 'Pending' && (
                                          <>
                                            <button className="btn-row-icon icon-save" title="Approve"
                                              onClick={() => handleLeaveDecision(a, 'Approved')}>
                                              <i className="bx bx-check"></i>
                                            </button>
                                            <button className="btn-row-icon icon-edit" title="Approve some days, refuse the rest"
                                              onClick={() => handlePartialApproval(a)}>
                                              <i className="bx bx-slider-alt"></i>
                                            </button>
                                            <button className="btn-row-icon icon-reset" title="Approve as a different leave type"
                                              onClick={() => handleLeaveTypeChange(a)}>
                                              <i className="bx bx-transfer-alt"></i>
                                            </button>
                                            <button className="btn-row-icon icon-cancel" title="Reject — a reason is required"
                                              onClick={() => handleLeaveDecision(a, 'Rejected')}>
                                              <i className="bx bx-x"></i>
                                            </button>
                                          </>
                                        )}
                                        {a.status === 'Rejected' && (
                                          <button className="btn-row-icon icon-edit" title="Appeal this decision"
                                            onClick={() => appealLeaveDecision(a)}>
                                            <i className="bx bx-undo"></i>
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Who is away, and whether that leaves enough on the floor. Shown
                    before the approval queue, since it is the context a decision
                    needs rather than something to look up afterwards. */}
                {canApprove && (() => {
                  const days = Array.from({ length: 14 }, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() + i);
                    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                  });
                  const busy = days.map(d => ({ day: d, away: awayOn(d) })).filter(x => x.away.length > 0);
                  if (busy.length === 0) return null;
                  return (
                    <div className="card" style={{ marginBottom: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Who Is Away — Next 14 Days</h3>
                        <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                          approved and pending
                        </span>
                      </div>
                      <div className="table-container">
                        <table className="data-table">
                          <thead><tr><th>Day</th><th>Away</th><th>Cover left</th></tr></thead>
                          <tbody>
                            {busy.map(({ day, away }) => {
                              const cover = coverCheck(day).filter(c => c.off > 0);
                              return (
                                <tr key={day}>
                                  <td>
                                    <strong>{day}</strong><br />
                                    <small className="text-muted">
                                      {WEEKDAYS[new Date(`${day}T12:00:00`).getDay()]}
                                    </small>
                                  </td>
                                  <td>
                                    {away.map(a => (
                                      <div key={a.app.id}>
                                        {a.coach.name}
                                        <small className="text-muted"> · {leaveType(a.app.type_id)?.label}
                                          {a.app.status === 'Pending' ? ' (pending)' : ''}</small>
                                      </div>
                                    ))}
                                  </td>
                                  <td>
                                    {cover.map(c => (
                                      <div key={c.discipline}>
                                        <small className={c.working === 0 ? 'text-red' : 'text-muted'}>
                                          {c.discipline}: {c.working} of {c.total} working
                                        </small>
                                      </div>
                                    ))}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                {(PROFILE_PAY_ROLES.includes(currentRole) || currentRole === 'Reporting Manager') && (() => {
                  const batch = photoBatchLogs();
                  const withPhoto = attendanceLogs.filter(l => l.photo_path).length;
                  const today = new Date().toISOString().slice(0, 10);
                  const expired = attendanceLogs.filter(l =>
                    l.photo_path && l.photo_expires_at && l.photo_expires_at < today).length;
                  return (
                    <div className="card" style={{ marginBottom: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Login Photographs</h3>
                        <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                          {withPhoto} on record · kept {PHOTO_RETENTION_DAYS} days
                          {(() => {
                            const none = attendanceLogs.filter(l => !l.photo_path).length;
                            return none > 0 ? ` · ${none} login${none === 1 ? '' : 's'} without one` : '';
                          })()}
                        </span>
                      </div>
                      <p className="text-secondary" style={{ fontSize: '0.84rem', marginTop: 0 }}>
                        Choose a batch and download it as one archive, foldered by coach.
                        Photographs are evidence of attendance only — there is no face matching.
                        A coach may skip the camera, so a login can carry none; those are
                        counted above, and marked on the day so a pattern of skipping shows.
                      </p>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Coach</label>
                          <select value={photoBatch.coach}
                            onChange={(e) => setPhotoBatch(b => ({ ...b, coach: e.target.value }))}>
                            <option value="All">All coaches</option>
                            {coaches.map(c => <option key={c.id} value={c.id}>{c.id} — {c.name}</option>)}
                          </select>
                        </div>
                        <div className="form-group">
                          <label>From</label>
                          <input type="date" value={photoBatch.from}
                            onChange={(e) => setPhotoBatch(b => ({ ...b, from: e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>To</label>
                          <input type="date" value={photoBatch.to}
                            onChange={(e) => setPhotoBatch(b => ({ ...b, to: e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>In this batch</label>
                          <span className="calc-static">
                            {batch.length} photograph{batch.length === 1 ? '' : 's'}
                          </span>
                          <span className="field-hint">
                            {batch.length > 0
                              ? `${batch[0].working_day} to ${batch[batch.length - 1].working_day}`
                              : 'Nothing matches those dates.'}
                          </span>
                        </div>
                      </div>
                      <div className="modal-footer">
                        {photoBusy && (
                          <span className="text-muted" style={{ fontSize: '0.82rem', marginRight: 'auto' }}>
                            {photoBusy}
                          </span>
                        )}
                        {expired > 0 && PROFILE_PAY_ROLES.includes(currentRole) && (
                          <button className="btn btn-secondary" onClick={purgeExpiredPhotos}>
                            <i className="bx bx-trash"></i> Delete {expired} past {PHOTO_RETENTION_DAYS} days
                          </button>
                        )}
                        <button className="btn btn-primary"
                          disabled={batch.length === 0 || !!photoBusy}
                          onClick={downloadPhotoBatch}>
                          <i className="bx bx-download"></i> Download {batch.length || ''} as ZIP
                        </button>
                      </div>
                    </div>
                  );
                })()}

                    {/* Deciding leave is not about the coach on screen — an approver should
                    see everything waiting on them the moment they arrive, which is why
                    this sits outside the per-coach block rather than inside it. */}
                {(PROFILE_PAY_ROLES.includes(currentRole) || currentRole === 'Reporting Manager') && (
                  <div className="card" style={{ marginBottom: '1.25rem' }}>
                    <div className="card-header-row">
                      <h3>Reports</h3>
                      <span className="text-muted" style={{ fontSize: '0.82rem' }}>{currentPeriodMonth}</span>
                    </div>
                    <p className="text-secondary" style={{ fontSize: '0.84rem', marginTop: 0 }}>
                      Each one covers the open cycle, except balances, which run to the leave year.
                    </p>
                    <div className="table-btn-group">
                      <button className="btn btn-secondary" onClick={() => downloadAttendanceReport('attendance')}>
                        <i className="bx bx-download"></i> Attendance summary
                      </button>
                      <button className="btn btn-secondary" onClick={() => downloadAttendanceReport('balances')}>
                        <i className="bx bx-download"></i> Leave balances
                      </button>
                      <button className="btn btn-secondary" onClick={() => downloadAttendanceReport('lop')}>
                        <i className="bx bx-download"></i> Loss of Pay days
                      </button>
                      <button className="btn btn-secondary" onClick={() => downloadAttendanceReport('penalties')}>
                        <i className="bx bx-download"></i> Attendance penalties
                      </button>
                    </div>
                  </div>
                )}

                {PROFILE_PAY_ROLES.includes(currentRole) && (() => {
                  const { year } = leaveYearFor(new Date());
                  const list = holidays
                    .filter(h => h.leave_year === year)
                    .sort((a, b) => a.holiday_date.localeCompare(b.holiday_date));
                  return (
                    <div className="card" style={{ marginBottom: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Holiday List {year}</h3>
                        <div className="table-btn-group">
                          <span className="text-muted" style={{ fontSize: '0.82rem', marginRight: '0.5rem' }}>
                            {list.length} published
                          </span>
                          <button className="btn btn-secondary btn-sm" onClick={downloadHolidayTemplate}>
                            <i className="bx bx-download"></i> Template
                          </button>
                          <label className="btn btn-secondary btn-sm" style={{ marginBottom: 0 }}>
                            <i className="bx bx-upload"></i> Upload list
                            <input
                              type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                              onChange={(e) => { readHolidayFile(e.target.files?.[0]); e.target.value = ''; }}
                            />
                          </label>
                        </div>
                      </div>
                      <p className="text-secondary" style={{ fontSize: '0.84rem', marginTop: 0 }}>
                        A day on this list is not counted against anyone. Leave the centre blank
                        for every coach, or name one for a local holiday.
                      </p>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Date</label>
                          <input type="date" value={holidayForm.date}
                            onChange={(e) => setHolidayForm(f => ({ ...f, date: e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>Name</label>
                          <input type="text" value={holidayForm.name} placeholder="e.g. Republic Day"
                            onChange={(e) => setHolidayForm(f => ({ ...f, name: e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>Centre</label>
                          <input type="text" value={holidayForm.centre} placeholder="Blank — everyone"
                            onChange={(e) => setHolidayForm(f => ({ ...f, centre: e.target.value }))} />
                        </div>
                        <div className="form-group" style={{ alignSelf: 'end' }}>
                          <button className="btn btn-primary" onClick={addHoliday}>Add holiday</button>
                        </div>
                      </div>
                      {/* What the file would do, before it does it. Nothing is
                          written until this is accepted. */}
                      {holidayPreview && (() => {
                        const bad = holidayPreview.rows.filter(r => r.problem).length;
                        const dup = holidayPreview.rows.filter(r => !r.problem && r.duplicate).length;
                        const add = holidayPreview.rows.length - bad - dup;
                        return (
                          <div className="bulk-preview-wrap">
                            <div className="unsaved-drafts-bar">
                              <i className="bx bx-list-check"></i>
                              <span>
                                <strong>{holidayPreview.fileName}</strong>
                                <small>
                                  {add} to add
                                  {dup ? ` · ${dup} already on the list` : ''}
                                  {bad ? ` · ${bad} with a problem` : ''}
                                </small>
                              </span>
                              <button className="btn btn-secondary btn-sm" onClick={() => setHolidayPreview(null)}>
                                Cancel
                              </button>
                              <button className="btn btn-primary btn-sm" disabled={add === 0}
                                onClick={applyHolidayPreview}>
                                Add {add || ''}
                              </button>
                            </div>
                            <div className="table-container">
                              <table className="data-table">
                                <thead><tr><th>Line</th><th>Date</th><th>Holiday</th><th>Applies to</th><th>Status</th></tr></thead>
                                <tbody>
                                  {holidayPreview.rows.map(r => (
                                    <tr key={r.line} className={r.problem ? 'leave-overdue' : ''}>
                                      <td>{r.line}</td>
                                      <td>{r.date || <span className="text-muted">—</span>}</td>
                                      <td>{r.name || <span className="text-muted">—</span>}</td>
                                      <td>{r.centre || <span className="text-muted">everyone</span>}</td>
                                      <td>
                                        {r.problem
                                          ? <span className="text-red">{r.problem}</span>
                                          : r.duplicate
                                            ? <span className="text-muted">already on the list</span>
                                            : <span className="text-green">will be added</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        );
                      })()}

                      {list.length > 0 && (
                        <div className="table-container">
                          <table className="data-table">
                            <thead><tr><th>Date</th><th>Day</th><th>Holiday</th><th>Applies to</th><th className="actions-col"></th></tr></thead>
                            <tbody>
                              {list.map(h => (
                                <tr key={h.id}>
                                  <td><strong>{h.holiday_date}</strong></td>
                                  <td>{WEEKDAYS[new Date(`${h.holiday_date}T12:00:00`).getDay()]}</td>
                                  <td>{h.name}</td>
                                  <td>{h.centre_name || <span className="text-muted">everyone</span>}</td>
                                  <td className="actions-col">
                                    <button className="btn-row-icon icon-cancel" title="Remove from the list"
                                      onClick={() => removeHoliday(h)}>
                                      <i className="bx bx-trash"></i>
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {!coach ? (
                  <div className="card">
                    <p className="text-muted">
                      Open a coach to see their attendance, balances and leave history —
                      click a name in the register above, or pick one from the list at the
                      top right.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Today */}
                    <div className="card">
                      <div className="card-header-row" id="attendance-coach-card">
                        <h3>
                          {!isOwn && (
                            <button className="linklike" title="Back to everyone"
                              onClick={() => setAttendanceCoachId('')}
                              style={{ marginRight: '0.5rem' }}>
                              <i className="bx bx-arrow-back"></i>
                            </button>
                          )}
                          {coach.name} · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
                        </h3>
                        <div className="table-btn-group">
                          <button className="btn btn-primary" disabled={!!open}
                            onClick={() => handleAttendanceLogin(coach)}>
                            <i className="bx bx-log-in"></i> Log in
                          </button>
                          <button className="btn btn-secondary" disabled={!open}
                            onClick={() => handleAttendanceLogout(coach)}>
                            <i className="bx bx-log-out"></i> Log out
                          </button>
                          {LEAVE_APPROVER_ROLES.includes(currentRole) && (() => {
                            const settled = attendanceDays.some(d =>
                              d.coach_id === coach.id && d.working_day === todayWorkingDay);
                            // A disabled button with no reason is a dead end, and
                            // there are four different reasons this one is.
                            const why = settled ? 'Already settled'
                              : open ? 'Still logged in — log out first'
                              : todays.length === 0 ? 'Nothing logged today'
                              : null;
                            return (
                              <button className="btn btn-secondary" disabled={!!why}
                                title={why || 'Write the day down: a short day becomes a violation, a very short one becomes Loss of Pay'}
                                onClick={() => settleAttendanceDay(coach, todayWorkingDay)}>
                                <i className="bx bx-check-double"></i> {why || 'Settle day'}
                              </button>
                            );
                          })()}
                        </div>
                      </div>

                      <div className="attendance-today">
                        <div>
                          <span>Logged today</span>
                          <strong className={open ? 'att-ticking' : ''}>{asClock(hours)}</strong>
                        </div>
                        <div><span>Expected</span><strong>{asClock(avail.hours)}</strong></div>
                        {/* What is left of the day. Counted down rather than up,
                            because the question being asked is how much longer. */}
                        <div>
                          <span>{hours >= avail.hours ? 'Beyond expected' : 'Still to log'}</span>
                          <strong className={hours >= avail.hours ? 'att-ok' : (open ? 'att-ticking' : '')}>
                            {hours >= avail.hours
                              ? `+${asClock(hours - avail.hours)}`
                              : asClock(avail.hours - hours)}
                          </strong>
                        </div>
                        <div><span>Status</span><strong className={`att-outcome att-${day.outcome}`}>
                          {{ ok: 'On time', violation: 'Short — violation', lop: 'Short — Loss of Pay',
                             review: 'Flagged for review', leave: 'On leave',
                             'weekly-off': 'Weekly off', holiday: 'Holiday' }[day.outcome]}
                        </strong></div>
                        {seesMoney && day.lopDays > 0 && (
                          <div><span>Would cost</span><strong className="text-red">
                            {rupees(lopPerDay(coach.coach_category, computeMonthlyPay(
                              coach, carryPay(currentMonth.find(r => r.coach_id === coach.id) || {}),
                              { hbScore: 0 }, [], findVariant(variants, coach.variant_id), []
                            ).basePay))}
                          </strong></div>
                        )}
                      </div>

                      <div className="attendance-pattern">
                        <label>Weekly off</label>
                        <select
                          value={coach.weekly_off_day ?? ''}
                          disabled={coach.coach_category === 'Flexi'
                            || !(LEAVE_APPROVER_ROLES.includes(currentRole) || currentRole === 'Showrunner')}
                          onChange={(e) => setWeeklyOff(coach, e.target.value)}
                        >
                          <option value="">None set</option>
                          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                        </select>
                        <span>
                          {coach.coach_category === 'Flexi'
                            ? 'Flexi coaches have no fixed off day — a day with no availability is off.'
                            : coach.weekly_off_day == null
                              ? 'Until this is set, that day counts as one they failed to work.'
                              : `${WEEKDAYS[coach.weekly_off_day]}s are not counted against them.`}
                        </span>
                      </div>

                      {todayHoliday && (
                        <p className="calc-notes">
                          Today is <strong>{todayHoliday.name}</strong>
                          {todayHoliday.centre_name ? ` at ${todayHoliday.centre_name}` : ''} — nothing is owed.
                        </p>
                      )}

                      {/* The bar is the same figure again, read at a glance. */}
                      <div className="att-progress" title={`${Math.round((hours / (avail.hours || 1)) * 100)}% of the day`}>
                        <div
                          className={`att-progress-fill ${hours >= avail.hours ? 'att-progress-done' : ''}`}
                          style={{ width: `${Math.min(100, (hours / (avail.hours || 1)) * 100)}%` }}
                        />
                      </div>

                      {avail.missing && (
                        <p className="calc-notes">
                          Availability has not come from the scheduling system, so the standard
                          {' '}{standardDailyHours(coach.coach_category)} hours stand in. The day is flagged
                          for review and nothing is charged for it.
                        </p>
                      )}

                      {todays.length > 0 && (
                        <div className="table-container">
                          <table className="data-table">
                            <thead><tr><th>In</th><th>Out</th><th className="num-col">Minutes</th><th>Counted</th><th>Where</th><th>Photo</th></tr></thead>
                            <tbody>
                              {todays.map(l => {
                                const mins = ((l.logged_out_at ? new Date(l.logged_out_at) : new Date()) - new Date(l.logged_in_at)) / 60000;
                                return (
                                  <tr key={l.id}>
                                    <td>{new Date(l.logged_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                                    <td>{l.logged_out_at
                                      ? new Date(l.logged_out_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                                      : <span className="badge badge-success">Open</span>}</td>
                                    <td className="num-col">{Math.round(mins)}</td>
                                    <td>{mins < MIN_LOGIN_MINUTES
                                      ? <span className="text-muted">under {MIN_LOGIN_MINUTES} min — not counted</span>
                                      : <span className="text-green">counted</span>}</td>
                                    {/* Recorded on every login and logout, and until now
                                        shown nowhere — so a centre coach logging in from
                                        the wrong place was invisible. */}
                                    <td>
                                      {l.login_lat != null ? (
                                        <a
                                          href={`https://www.google.com/maps?q=${l.login_lat},${l.login_lng}`}
                                          target="_blank" rel="noreferrer"
                                          title={`In: ${l.login_lat}, ${l.login_lng}`}
                                        >
                                          in: {Number(l.login_lat).toFixed(4)}, {Number(l.login_lng).toFixed(4)}
                                        </a>
                                      ) : <small className="text-red">in: no location</small>}
                                      <br />
                                      {l.logout_lat != null ? (
                                        <a
                                          href={`https://www.google.com/maps?q=${l.logout_lat},${l.logout_lng}`}
                                          target="_blank" rel="noreferrer"
                                          title={`Out: ${l.logout_lat}, ${l.logout_lng}`}
                                        >
                                          out: {Number(l.logout_lat).toFixed(4)}, {Number(l.logout_lng).toFixed(4)}
                                        </a>
                                      ) : l.logged_out_at
                                        ? <small className="text-red">out: no location</small>
                                        : <small className="text-muted">out: still in</small>}
                                      {l.within_centre === false && (
                                        <><br /><small className="text-red">outside the centre</small></>
                                      )}
                                      {l.within_centre === null && coach.work_mode === 'Centre' && (
                                        <><br /><small className="text-amber">not verified</small></>
                                      )}
                                    </td>
                                    <td>
                                      {l.photo_path
                                        ? <span className="text-green">taken</span>
                                        : <span className="text-amber">none</span>}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Balances */}
                    <div className="card" style={{ marginTop: '1.25rem' }}>
                      <div className="card-header-row">
                        <h3>Leave Balance</h3>
                        <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                          Leave year {leaveYearFor(new Date()).start} to {leaveYearFor(new Date()).end}
                        </span>
                      </div>
                      <div className="table-container">
                        <table className="data-table">
                          <thead>
                            <tr>
                              <th>Leave type</th>
                              <th className="num-col">Opening</th>
                              <th className="num-col">Accrued</th>
                              <th className="num-col">Used</th>
                              <th className="num-col">Adjusted</th>
                              <th className="num-col">Available</th>
                              <th>Policy</th>
                              <th className="actions-col"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {leaveTypesFor(coach).filter(t => t.id !== 'LOP').map(t => {
                              const b = leaveBalanceFor(coach, t.id);
                              return (
                                <tr key={t.id}>
                                  <td><strong>{t.label}</strong></td>
                                  <td className="num-col">{b.opening}</td>
                                  <td className="num-col">{b.accrued}</td>
                                  <td className="num-col">{b.used}</td>
                                  <td className="num-col">
                                    {b.adjusted
                                      ? <span className={b.adjusted > 0 ? 'text-green' : 'text-red'}>
                                          {b.adjusted > 0 ? '+' : ''}{b.adjusted}
                                        </span>
                                      : <span className="text-muted">—</span>}
                                  </td>
                                  <td className="num-col"><strong>{b.available}</strong></td>
                                  <td><small className="text-muted">{t.note}</small></td>
                                  <td className="actions-col">
                                    {PROFILE_PAY_ROLES.includes(currentRole) && (
                                      <button className="btn-row-icon icon-edit"
                                        title="Adjust this balance by hand — a reason is required"
                                        onClick={() => adjustLeaveBalance(coach, t.id)}>
                                        <i className="bx bx-slider-alt"></i>
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      {!coach.gender && (
                        <p className="calc-notes">
                          No gender on this profile, so Period, Maternity and Paternity leave
                          cannot be offered. It is set on the coach profile.
                        </p>
                      )}
                    </div>

                    {/* Apply */}
                    <div className="card" style={{ marginTop: '1.25rem' }}>
                      <h3>Apply for Leave</h3>
                      <div className="form-grid">
                        <div className="form-group">
                          <label>Type</label>
                          <select value={leaveForm.type}
                            onChange={(e) => setLeaveForm(f => ({ ...f, type: e.target.value }))}>
                            {applicableLeaveTypes(coach).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                          </select>
                          <span className="field-hint">{leaveType(leaveForm.type)?.note}</span>
                        </div>
                        <div className="form-group">
                          <label>From</label>
                          <input type="date" value={leaveForm.from}
                            onChange={(e) => setLeaveForm(f => ({ ...f, from: e.target.value, to: f.to || e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>To</label>
                          <input type="date" value={leaveForm.to}
                            onChange={(e) => setLeaveForm(f => ({ ...f, to: e.target.value }))} />
                        </div>
                        <div className="form-group">
                          <label>Half day</label>
                          <select
                            value={leaveForm.halfDay ? 'yes' : 'no'}
                            disabled={!leaveType(leaveForm.type)?.halfDayAllowed || coach.coach_category === 'Flexi'}
                            onChange={(e) => setLeaveForm(f => ({ ...f, halfDay: e.target.value === 'yes' }))}
                          >
                            <option value="no">No</option>
                            <option value="yes">Yes</option>
                          </select>
                          <span className="field-hint">
                            {coach.coach_category === 'Flexi'
                              ? 'Flexi coaches have no half day.'
                              : `Half a day is ${halfDayHours(coach.coach_category)} hours.`}
                          </span>
                        </div>
                        <div className="form-group w-full">
                          <label>Reason</label>
                          <textarea rows="2" value={leaveForm.reason}
                            onChange={(e) => setLeaveForm(f => ({ ...f, reason: e.target.value }))}
                            placeholder="Optional, but it helps the approver decide." />
                        </div>
                      </div>
                      <div className="modal-footer">
                        <span className="text-muted" style={{ fontSize: '0.8rem', marginRight: 'auto' }}>
                          {leaveForm.from && leaveForm.to
                            ? (() => {
                                const c = leaveDaysFor(coach, leaveForm.from, leaveForm.to, leaveForm.type);
                                const n = leaveForm.halfDay ? 0.5 : c.days;
                                const span = daysBetween(leaveForm.from, leaveForm.to);
                                return `${n} day(s) of leave` +
                                  (c.skipped.length ? ` — ${span} day span, ${c.skipped.length} not counted (${c.skipped.join(', ')})` : '') +
                                  ` · ${leaveBalanceFor(coach, leaveForm.type).available} available`;
                              })()
                            : 'Choose the dates.'}
                        </span>
                        <button className="btn btn-primary" onClick={() => handleLeaveApply(coach)}>Apply</button>
                      </div>
                    </div>

                    {/* History */}
                    <div className="card" style={{ marginTop: '1.25rem' }}>
                      <h3>Leave Applications</h3>
                      {mine.length === 0 ? (
                        <p className="text-muted">Nothing applied for yet.</p>
                      ) : (
                        <div className="table-container">
                          <table className="data-table">
                            <thead>
                              <tr><th>Type</th><th>Dates</th><th className="num-col">Days</th><th>Status</th><th>Note</th><th className="actions-col">{canApprove ? 'Decide' : ''}</th></tr>
                            </thead>
                            <tbody>
                              {mine.map(a => (
                                <tr key={a.id}>
                                  <td>{leaveType(a.type_id)?.label}</td>
                                  <td>{a.from_date} → {a.to_date}</td>
                                  <td className="num-col">{a.days}</td>
                                  <td>
                                    <span className={`badge ${
                                      a.status === 'Approved' ? 'badge-success'
                                        : a.status === 'Rejected' ? 'badge-danger'
                                        : a.status === 'Cancelled' ? 'badge-muted' : 'badge-warning'}`}>
                                      {a.status}
                                    </span>
                                  </td>
                                  <td><small className="text-muted">{a.decision_note || a.cancel_note || '—'}</small></td>
                                  {/* Deciding also belongs here. An approver reading a
                                      row marked PENDING expects to act on it where they
                                      are looking, not on a different card further up. */}
                                  <td className="actions-col">
                                    <div className="table-btn-group">
                                      {canApprove && a.status === 'Pending' && (
                                        <>
                                          <button className="btn-row-icon icon-save" title="Approve this leave"
                                            onClick={() => handleLeaveDecision(a, 'Approved')}>
                                            <i className="bx bx-check"></i>
                                          </button>
                                          <button className="btn-row-icon icon-edit" title="Approve some days and refuse the rest"
                                            onClick={() => handlePartialApproval(a)}>
                                            <i className="bx bx-slider-alt"></i>
                                          </button>
                                          <button className="btn-row-icon icon-reset" title="Approve as a different leave type"
                                            onClick={() => handleLeaveTypeChange(a)}>
                                            <i className="bx bx-transfer-alt"></i>
                                          </button>
                                          <button className="btn-row-icon icon-cancel" title="Reject — a reason is required"
                                            onClick={() => handleLeaveDecision(a, 'Rejected')}>
                                            <i className="bx bx-x"></i>
                                          </button>
                                        </>
                                      )}
                                      {a.status === 'Rejected' && (
                                        <button className="btn-row-icon icon-edit" title="Appeal this decision"
                                          onClick={() => appealLeaveDecision(a)}>
                                          <i className="bx bx-undo"></i>
                                        </button>
                                      )}
                                      {(a.status === 'Pending' || a.status === 'Approved') && (
                                        <button className="btn-row-icon icon-reset" title="Cancel this leave"
                                          onClick={() => handleLeaveCancel(a)}>
                                          <i className="bx bx-trash"></i>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            );
          })()}

          {/* Evaluations View */}
          {isViewEnabled('evaluations') && activeView === 'evaluations' && (
            <section id="view-evaluations" className="content-view active-view">
              <div className="page-header-row">
                <h2>Performance Evaluations</h2>
                <div className="action-buttons-group">
                  {verifyAccess("Super Admin,HR Manager,Reporting Manager,Showrunner") && (
                    <button className="btn btn-secondary" onClick={() => setActiveModal("bulk-sessions")}><i className="bx bx-cloud-upload"></i> Bulk Import Sessions</button>
                  )}
                  {verifyAccess("Super Admin,Reporting Manager") && (
                    <button className="btn btn-primary" onClick={() => {
                      const eligibleCoaches = coaches.filter(c => c.status === 'Active' && (currentRole !== 'Reporting Manager' || c.reporting_manager_id === currentRmContext));
                      if (eligibleCoaches.length > 0) {
                        handleOpenEvalModal(eligibleCoaches[0].id);
                      } else {
                        showToast("No active coaches found in your lead context.", "warning");
                      }
                    }}><i className="bx bx-plus-circle"></i> Add Evaluation</button>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div className="filter-card">
                <div className="filter-grid">
                  <div className="filter-item">
                    <label>Filter Month</label>
                    <select value={evalMonthFilter} onChange={(e) => setEvalMonthFilter(e.target.value)}>
                      <option value={currentPeriodMonth}>{currentPeriodMonth} (Current)</option>
                      <option value="May 2026">May 2026 (Historic)</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Filter Type</label>
                    <select value={evalVariantFilter} onChange={(e) => setEvalVariantFilter(e.target.value)}>
                      <option value="All">All Types</option>
                      <option value="Strength">Strength</option>
                      <option value="Yoga">Yoga</option>
                      <option value="Pilates">Pilates</option>
                      <option value="Physio">Physio</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Submission Status</label>
                    <select value={evalStatusFilter} onChange={(e) => setEvalStatusFilter(e.target.value)}>
                      <option value="All">All Statuses</option>
                      <option value="DRAFT">DRAFT</option>
                      <option value="RM_SUBMITTED">RM SUBMITTED</option>
                      <option value="HR_REVIEWED">HR REVIEWED</option>
                      <option value="FINANCE_LOCKED">LOCKED (Finance)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Evaluations Table */}
              <div className="table-container card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Coach</th>
                      <th>Type</th>
                      <th>Category</th>
                      <th>Attendance %</th>
                      <th>Sessions Done</th>
                      <th>Quality Composite</th>
                      <th>Final HB+ Score</th>
                      <th>Band</th>
                      <th>Workflow Status</th>
                      <th className="actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(evalMonthFilter === currentPeriodMonth ? currentMonth : historicMonths).filter(e => {
                      const coach = coaches.find(c => c.id === e.coach_id);
                      if (!coach) return false;
                      if (currentRole === "Reporting Manager" && coach.reporting_manager_id !== currentRmContext) return false;

                      const matchesVariant = matchesCoachType(coach, evalVariantFilter);
                      const matchesStatus = evalStatusFilter === "All" || e.status === evalStatusFilter;
                      return matchesVariant && matchesStatus;
                    }).map(e => {
                      const coach = coaches.find(c => c.id === e.coach_id);
                      const vConfig = findVariant(variants, coach.variant_id);
                      const calc = e.hb_score != null ? e : computeHBPlusScore(coach, e, vConfig);
                      const scoreVal = calc.hbScore || calc.hb_score;
                      const bandObj = getPerformanceBand(scoreVal);
                      const coreTotal = e.prof_appearance != null 
                        ? (Number(e.prof_appearance) + Number(e.client_engagement) + Number(e.safety) + Number(e.punctuality) + Number(e.team_conduct) + Number(e.communication))
                        : 0;

                      let badgeClass = "badge-muted";
                      if (e.status === "DRAFT") badgeClass = "badge-warning";
                      if (e.status === "RM_SUBMITTED") badgeClass = "badge-info";
                      if (e.status === "HR_REVIEWED") badgeClass = "badge-success";
                      if (e.status === "FINANCE_LOCKED") badgeClass = "badge-danger";

                      const allowedToEdit = currentRole === "Super Admin" || 
                        (currentRole === "Reporting Manager" && e.status === 'DRAFT') || 
                        (currentRole === "HR Manager" && e.status !== 'FINANCE_LOCKED');

                      return (
                        <tr key={e.coach_id + "_" + e.period_month}>
                          <td><strong>{coach.name}</strong><br /><small className="text-muted">{coach.id}</small></td>
                          <td>{vConfig.name}</td>
                          <td>{coach.coach_category}</td>
                          <td>{e.attendance_pct}%</td>
                          <td>{e.sessions_completed}</td>
                          <td>{coreTotal}/100</td>
                          <td><strong>{scoreVal.toFixed(2)}</strong></td>
                          <td><span className={`badge band-badge band-${bandObj.min}-${bandObj.max}`}>{bandObj.label}</span></td>
                          <td><span className={`badge ${badgeClass}`}>{e.status.replace('_', ' ')}</span></td>
                          <td className="actions-col">
                            {allowedToEdit ? (
                              <div className="table-btn-group" style={{ display: 'inline-flex', gap: '4px' }}>
                                <button className="btn btn-secondary" onClick={() => handleOpenEvalModal(coach.id)}><i className="bx bx-edit"></i> Edit</button>
                                {currentRole === "HR Manager" && e.status === 'RM_SUBMITTED' && (
                                  <button className="btn btn-primary" onClick={() => handleHRApproveEval(coach.id)}><i className="bx bx-check"></i> Validate</button>
                                )}
                              </div>
                            ) : <span className="text-muted">No Actions</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Violations View */}
          {isViewEnabled('violations') && activeView === 'violations' && (
            <section id="view-violations" className="content-view active-view">
              <div className="page-header-row">
                <h2>Violations Register (Annexure-1)</h2>
                <button className="btn btn-danger" onClick={() => handleOpenViolationModal()}><i className="bx bx-error"></i> Log Disciplinary Incident</button>
              </div>

              {/* Filters */}
              <div className="filter-card">
                <div className="filter-grid">
                  <div className="filter-item">
                    <label>Search Coach</label>
                    <input type="text" placeholder="Search ID or Name..." value={vioSearch} onChange={(e) => setVioSearch(e.target.value)} />
                  </div>
                  <div className="filter-item">
                    <label>Violation Type</label>
                    <select value={vioTypeFilter} onChange={(e) => setVioTypeFilter(e.target.value)}>
                      <option value="All">All Violation Types</option>
                      <option value="Late Arrival (<5 min)">Late Arrival (&lt;5 min)</option>
                      <option value="Late Arrival (>5 min)">Late Arrival (&gt;5 min)</option>
                      <option value="Coach No-Show">Coach No-Show</option>
                      <option value="Unplanned Absence (<4 hrs notice)">Unplanned Absence</option>
                      <option value="Repeated Roster Violations">Repeated Roster Violations</option>
                      <option value="Conduct">Conduct/Behavioral (HOP)</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Resolve Status</label>
                    <select value={vioStatusFilter} onChange={(e) => setVioStatusFilter(e.target.value)}>
                      <option value="All">All Statuses</option>
                      <option value="Pending_Acknowledge">Pending Coach Acknowledge</option>
                      <option value="Acknowledged">Acknowledged</option>
                      <option value="Appeal_Raised">Appeal Under Review</option>
                      <option value="Appeal_Approved">Appealed (Dismissed)</option>
                      <option value="Appeal_Rejected">Appealed (Upheld)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Incidents Table */}
              <div className="table-container card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Incident ID</th>
                      <th>Coach</th>
                      <th>Violation Type</th>
                      <th>Occur. #</th>
                      <th>Consequence Applied</th>
                      <th>Penalty Amount</th>
                      <th>Date &amp; Time</th>
                      <th>Workflow Status</th>
                      <th className="actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {violations.filter(v => {
                      const coach = coaches.find(c => c.id === v.coach_id);
                      if (!coach) return false;
                      if (currentRole === "Reporting Manager" && coach.reporting_manager_id !== currentRmContext) return false;

                      const matchesSearch = coach.name.toLowerCase().includes(vioSearch.toLowerCase()) || coach.id.toLowerCase().includes(vioSearch.toLowerCase()) || v.id.toLowerCase().includes(vioSearch.toLowerCase());
                      const matchesType = vioTypeFilter === "All" || v.type.includes(vioTypeFilter) || (vioTypeFilter === "Conduct" && !["Late Arrival", "Coach No-Show", "Unplanned Absence"].some(x => v.type.includes(x)));
                      const matchesStatus = vioStatusFilter === "All" || v.status === vioStatusFilter;
                      return matchesSearch && matchesType && matchesStatus;
                    }).map(v => {
                      const coach = coaches.find(c => c.id === v.coach_id);
                      let statusClass = "badge-muted";
                      if (v.status === "Pending_Acknowledge") statusClass = "badge-warning";
                      if (v.status === "Acknowledged") statusClass = "badge-success";
                      if (v.status === "Appeal_Raised") statusClass = "badge-info";
                      if (v.status === "Appeal_Approved") statusClass = "badge-success";
                      if (v.status === "Appeal_Rejected") statusClass = "badge-danger";

                      return (
                        <tr key={v.id}>
                          <td><strong>{v.id}</strong></td>
                          <td><strong>{coach.name}</strong><br /><small className="text-muted">{coach.id}</small></td>
                          <td><span className="text-red">{v.type}</span></td>
                          <td>{v.occurrence_no}</td>
                          <td>{v.consequence}</td>
                          <td>₹{v.penalty_amount.toFixed(2)}</td>
                          <td>{new Date(v.incident_date).toLocaleDateString('en-IN')} {v.incident_time}</td>
                          <td><span className={`badge ${statusClass}`}>{v.status.replace('_', ' ')}</span></td>
                          <td className="actions-col">
                            {currentRole === "Coach" && v.coach_id === currentCoachContext && v.status === 'Pending_Acknowledge' && (
                              <div style={{ display: 'flex', gap: '4px' }}>
                                <button className="btn btn-teal" onClick={() => handleAcknowledgeViolation(v.id)}><i className="bx bx-check"></i> Acknowledge</button>
                                <button className="btn btn-secondary" onClick={() => handleOpenAppealModal(v.id, 'Violation')}><i className="bx bx-conversation"></i> Appeal</button>
                              </div>
                            )}
                            {(currentRole === "Super Admin" || currentRole === "HR Manager") && (
                              <button className="btn-table-icon btn-delete-item" title="Delete Violation" onClick={() => handleDeleteViolation(v.id)}><i className="bx bx-trash"></i></button>
                            )}
                            {!(currentRole === "Coach" && v.coach_id === currentCoachContext && v.status === 'Pending_Acknowledge') && !(currentRole === "Super Admin" || currentRole === "HR Manager") && (
                              <span className="text-muted">No Actions</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Payroll View */}
          {isViewEnabled('payroll') && activeView === 'payroll' && (
            <section id="view-payroll" className="content-view active-view">
              <div className="page-header-row">
                <h2>Monthly Payroll &amp; Incentives Ledger</h2>
                <div className="action-buttons-group">
                  {verifyAccess("Super Admin,Finance") && (
                    <button className="btn btn-warning" onClick={handleLockCycle}><i className="bx bx-lock-alt"></i> {payrollLocked ? "Unlock Period" : "Lock Performance Period"}</button>
                  )}
                  {verifyAccess("Super Admin,Finance") && (
                    <button className="btn btn-teal" onClick={() => showToast("Disbursement of quarterly incentive batches processed.")}><i className="bx bx-credit-card-front"></i> Quarterly Incentive Batches</button>
                  )}
                </div>
              </div>

              {/* Filters */}
              <div className="filter-card">
                <div className="filter-grid">
                  <div className="filter-item">
                    <label>Filter Month</label>
                    <select value={payrollMonthFilter} onChange={(e) => setPayrollMonthFilter(e.target.value)}>
                      <option value={currentPeriodMonth}>{currentPeriodMonth} (Current)</option>
                      <option value="May 2026">May 2026 (Historic)</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Filter Type</label>
                    <select value={payrollVariantFilter} onChange={(e) => setPayrollVariantFilter(e.target.value)}>
                      <option value="All">All Types</option>
                      <option value="Strength">Strength</option>
                      <option value="Yoga">Yoga</option>
                      <option value="Pilates">Pilates</option>
                      <option value="Physio">Physio</option>
                    </select>
                  </div>
                  <div className="filter-item" style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button className="btn btn-secondary w-full" onClick={handleExportCSV}><i className="bx bx-download"></i> Export Payroll CSV</button>
                  </div>
                </div>
              </div>

              {/* Summary Stats Ledger */}
              {(() => {
                const dataset = payrollMonthFilter === currentPeriodMonth ? currentMonth : historicMonths;
                let sumGross = 0, sumIncentives = 0, sumConsistency = 0, sumDeductions = 0;
                
                dataset.forEach(e => {
                  const coach = coaches.find(c => c.id === e.coach_id);
                  if (!coach) return;
                  const matchesV = matchesCoachType(coach, payrollVariantFilter);
                  if (!matchesV) return;

                  const vConfig = findVariant(variants, coach.variant_id);
                  const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
                  const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

                  const calcScoreObj = e.hb_score != null ? e : computeHBPlusScore(coach, e, vConfig);
                  const pay = computeMonthlyPay(coach, carryPay(e), calcScoreObj, activeVio, vConfig, coachOrgWork);

                  sumGross += pay.grossPay;
                  sumIncentives += pay.milestoneIncentive;
                  sumConsistency += pay.consistencyBonus;
                  sumDeductions += pay.penaltyDeductions;
                });

                return (
                  <>
                    <div className="stats-row">
                      <div className="stat-card stat-teal">
                        <div className="stat-icon"><i className="bx bx-wallet"></i></div>
                        <div className="stat-info">
                          <h3>Total Gross Pay</h3>
                          <h2>₹{sumGross.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h2>
                          <p>For selected filters</p>
                        </div>
                      </div>
                      <div className="stat-card stat-violet">
                        <div className="stat-icon"><i className="bx bx-gift"></i></div>
                        <div className="stat-info">
                          <h3>Milestone Incentives</h3>
                          <h2>₹{sumIncentives.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h2>
                          <p>Volume milestone rewards</p>
                        </div>
                      </div>
                      <div className="stat-card stat-amber">
                        <div className="stat-icon"><i className="bx bx-badge-check"></i></div>
                        <div className="stat-info">
                          <h3>Consistency Bonuses</h3>
                          <h2>₹{sumConsistency.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h2>
                          <p>₹500 clean roster bonus</p>
                        </div>
                      </div>
                      <div className="stat-card stat-red">
                        <div className="stat-icon"><i className="bx bx-minus-circle"></i></div>
                        <div className="stat-info">
                          <h3>Total Penalty</h3>
                          <h2>₹{sumDeductions.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h2>
                          <p>Penalties applied</p>
                        </div>
                      </div>
                    </div>

                    {/* Payroll table */}
                    <div className="table-container card">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>Coach ID</th>
                            <th>Coach Name</th>
                            <th>Category</th>
                            <th>HB+ Score</th>
                            <th>Base Pay</th>
                            <th>Session Pay</th>
                            <th>Incentives Sum</th>
                            <th>Penalty</th>
                            <th>Gross Monthly Pay</th>
                            <th>Status</th>
                            <th className="actions-col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dataset.filter(e => {
                            const coach = coaches.find(c => c.id === e.coach_id);
                            if (!coach) return false;
                            return matchesCoachType(coach, payrollVariantFilter);
                          }).map(e => {
                            const coach = coaches.find(c => c.id === e.coach_id);
                            const vConfig = findVariant(variants, coach.variant_id);
                            const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
                            const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

                            const calcScoreObj = e.hb_score != null ? e : computeHBPlusScore(coach, e, vConfig);
                            const pay = computeMonthlyPay(coach, carryPay(e), calcScoreObj, activeVio, vConfig, coachOrgWork);

                            const incSum = pay.milestoneIncentive + pay.consistencyBonus + pay.streakBonusPay + pay.orgWorkPay + pay.trialIncentive + pay.eventIncentive + pay.hopOohPremium + pay.hopPtHomePremium + pay.hopPerformanceCreditsPay;

                            return (
                              <tr key={e.coach_id + "_" + e.period_month}>
                                <td><strong>{coach.id}</strong></td>
                                <td><strong>{coach.name}</strong></td>
                                <td>{coach.coach_category}</td>
                                <td>{(calcScoreObj.hbScore || calcScoreObj.hb_score).toFixed(2)}</td>
                                <td>₹{pay.basePay.toLocaleString('en-IN')}</td>
                                <td>₹{(pay.extraSessionPay + pay.sessionPay).toLocaleString('en-IN')}</td>
                                <td>₹{incSum.toLocaleString('en-IN')}</td>
                                <td className="text-red">₹{pay.penaltyDeductions.toLocaleString('en-IN')}</td>
                                <td><strong>₹{pay.grossPay.toLocaleString('en-IN')}</strong></td>
                                <td>
                                  <span className={`badge ${e.status === 'FINANCE_LOCKED' ? 'badge-danger' : 'badge-warning'}`}>
                                    {e.status === 'FINANCE_LOCKED' ? 'LOCKED' : 'DRAFT'}
                                  </span>
                                </td>
                                <td className="actions-col">
                                  <div style={{ display: 'inline-flex', gap: '4px' }}>
                                    <button className="btn btn-secondary" onClick={() => handleOpenPayslipModal(coach.id, e.period_month)}>
                                      <i className="bx bx-file-blank"></i> Payslip
                                    </button>
                                    {isOrgWorkEligible(coach.coach_category) && (currentRole === 'Super Admin' || currentRole === 'HR Manager') && (
                                      <button className="btn btn-teal" onClick={() => handleOpenOrgWorkModal(coach.id)} disabled={payrollLocked}>
                                        <i className="bx bx-plus-circle"></i> Org Work
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              })()}
            </section>
          )}

          {/* Appeals View */}
          {isViewEnabled('appeals') && activeView === 'appeals' && (
            <section id="view-appeals" className="content-view active-view">
              <div className="page-header-row">
                <h2>Disciplinary &amp; Evaluation Appeals</h2>
                <p>HOP Coached Appeal Portal (3 Working Day Window)</p>
              </div>

              {/* Appeals Table */}
              <div className="table-container card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Appeal ID</th>
                      <th>Coach</th>
                      <th>Target Incident / score</th>
                      <th>Reason for Appeal</th>
                      <th>Raised Date</th>
                      <th>Status</th>
                      <th>RM Decision</th>
                      <th>HR Final Outcome</th>
                      <th className="actions-col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const list = appeals.filter(a => {
                        if (currentRole === "Coach" && a.coach_id !== currentCoachContext) return false;
                        if (currentRole === "Reporting Manager") {
                          const coach = coaches.find(c => c.id === a.coach_id);
                          if (coach && coach.reporting_manager_id !== currentRmContext) return false;
                        }
                        return true;
                      });

                      if (list.length === 0) {
                        return <tr><td colSpan="9" className="text-secondary" style={{ textAlign: 'center' }}>No appeals filed.</td></tr>;
                      }

                      return list.map(a => {
                        const coach = coaches.find(c => c.id === a.coach_id);
                        let statusClass = "badge-muted";
                        if (a.status === "PENDING_RM") statusClass = "badge-warning";
                        if (a.status === "RM_DECIDED") statusClass = "badge-info";
                        if (a.status === "ESCALATED_HR") statusClass = "badge-warning";
                        if (a.status === "RESOLVED") statusClass = "badge-success";

                        let actionButtons = "";
                        if (currentRole === "Reporting Manager" && a.status === 'PENDING_RM') {
                          actionButtons = (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="btn btn-teal" onClick={() => handleRMAppealDecision(a.id, 'Approve')}>Approve</button>
                              <button className="btn btn-danger" onClick={() => handleRMAppealDecision(a.id, 'Reject')}>Reject</button>
                              <button className="btn btn-secondary" onClick={() => handleRMEscalateAppeal(a.id)}>Escalate</button>
                            </div>
                          );
                        } else if (currentRole === "HR Manager" && a.status === 'ESCALATED_HR') {
                          actionButtons = (
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button className="btn btn-teal" onClick={() => handleHRAppealDecision(a.id, 'Approve')}>Approve Appeal</button>
                              <button className="btn btn-danger" onClick={() => handleHRAppealDecision(a.id, 'Reject')}>Reject Appeal</button>
                            </div>
                          );
                        } else {
                          actionButtons = <span className="text-muted">Resolved / Locked</span>;
                        }

                        return (
                          <tr key={a.id}>
                            <td><strong>{a.id}</strong></td>
                            <td><strong>{coach?.name}</strong><br /><small className="text-muted">{coach?.id}</small></td>
                            <td>{a.target_type}: {a.target_id}</td>
                            <td><em>"{a.reason}"</em></td>
                            <td>{a.raised_at}</td>
                            <td><span className={`badge ${statusClass}`}>{a.status.replace('_', ' ')}</span></td>
                            <td>{a.rm_decision_notes || 'Pending'}</td>
                            <td>{a.hr_decision_notes || 'Pending'}</td>
                            <td className="actions-col">{actionButtons}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Settings View */}
          {isViewEnabled('settings') && activeView === 'settings' && (
            <section id="view-settings" className="content-view active-view">
              <div className="page-header-row">
                <h2>System Configurations</h2>
                <button className="btn btn-secondary text-red border-red" onClick={resetToSeed}><i className="bx bx-reset"></i> Reset Database to Seed State</button>
              </div>

              <div className="settings-grid">
                <div className="card settings-section">
                  <h3>Policy Variants &amp; Scoring Weights</h3>
                  <p className="subtitle">Modify weights for the five evaluation variants (ideal sum is 100%)</p>
                  <div className="settings-list" id="variants-config-list">
                    {[
                      { id: "S&C", name: "S&C (Strength & Conditioning)", discipline: "S&C", defaultId: "V1" },
                      { id: "Yoga", name: "Yoga", discipline: "Yoga", defaultId: "V3" }
                    ].map(d => {
                      const v = variants.find(x => x.id === d.defaultId);
                      if (!v) return null;

                      const currentTotal = (v.weights.coaching_exp || 0) +
                                           (v.weights.non_coaching_exp || 0) +
                                           (v.weights.education || 0) +
                                           (v.weights.technical_cert || 0) +
                                           (v.weights.core_performance || 0) +
                                           (v.weights.tenure || 0) +
                                           (v.weights.attendance || 0);

                      const handleWeightChange = (field, valStr) => {
                        let val = parseInt(valStr) || 0;
                        if (val < 0) val = 0;

                        // Calculate sum of other weights
                        const otherSum = Object.entries(v.weights)
                          .filter(([key]) => key !== field)
                          .reduce((sum, [_, value]) => sum + Number(value || 0), 0);

                        const maxAllowed = Math.max(0, 100 - otherSum);
                        const capped = Math.min(maxAllowed, val);

                        setVariants(prev => prev.map(item => {
                          if (item.discipline === d.discipline) {
                            return {
                              ...item,
                              weights: {
                                ...item.weights,
                                [field]: capped
                              }
                            };
                          }
                          return item;
                        }));
                      };

                      return (
                        <div className="settings-list-item" key={d.id}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                            <h4 style={{ margin: 0 }}>{d.name} — Weights Config</h4>
                            <span className={`badge ${currentTotal === 100 ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.85rem', padding: '4px 8px' }}>
                              Total Weight: {currentTotal}%
                            </span>
                          </div>
                          <div className="settings-weights-grid">
                            <div className="weight-input-group">
                              <label>Coaching Exp</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.coaching_exp} 
                                onChange={(e) => handleWeightChange('coaching_exp', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group">
                              <label>Non-Coaching</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.non_coaching_exp} 
                                onChange={(e) => handleWeightChange('non_coaching_exp', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group">
                              <label>Education</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.education} 
                                onChange={(e) => handleWeightChange('education', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group">
                              <label>Tech Cert</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.technical_cert} 
                                onChange={(e) => handleWeightChange('technical_cert', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group">
                              <label>Core Perf</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.core_performance} 
                                onChange={(e) => handleWeightChange('core_performance', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group">
                              <label>Tenure</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.tenure} 
                                onChange={(e) => handleWeightChange('tenure', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group">
                              <label>Attendance</label>
                              <input 
                                type="number" 
                                min="0" 
                                max="100"
                                value={v.weights.attendance} 
                                onChange={(e) => handleWeightChange('attendance', e.target.value)} 
                              />
                            </div>
                            <div className="weight-input-group" style={{ justifyContent: 'flex-end' }}>
                              <button className="btn btn-primary" onClick={() => {
                                handleSaveWeights(d.discipline, v.weights);
                              }} style={{ padding: '6px 12px', fontSize: '0.75rem' }}>Save Config</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

              </div>
            </section>
          )}

          {/* Annexure-1: what a violation costs, and how far back occurrences
              are counted. Read-only — the schedule is policy, not data anyone
              edits here. */}
          {isViewEnabled('penalties') && activeView === 'penalties' && verifyAccess("Super Admin,HR Manager,Finance,Reporting Manager,Showrunner") && (
            <section id="view-penalties" className="content-view active-view">
              <div className="page-header-row">
                <div>
                  <h2>Violation Penalties</h2>
                  <p>Annexure-1 — what each violation costs at every occurrence</p>
                </div>
                <div className="tracker-toolbar-controls">
                  <select className="header-select" value={penaltyVariant} onChange={(e) => setPenaltyVariant(e.target.value)}>
                    {/* Annexure 1B is not a discipline, so it sits beside the
                        variants rather than among them. */}
                    <option value="ONLINE">Annexure 1B — Online / Remote</option>
                    {offeredVariants(variants, penaltyVariant).map(v => (
                      <option key={v.id} value={v.id}>{variantLabel(v)}</option>
                    ))}
                  </select>
                  {verifyAccess("Super Admin,HR Manager,Reporting Manager,Showrunner") && (
                    <button className="btn btn-danger" onClick={() => handleOpenViolationModal()}>
                      <i className="bx bx-error"></i> Record an Incident
                    </button>
                  )}
                </div>
              </div>

              <div className="card">
                <div className="table-container">
                  <table className="data-table penalty-matrix-table">
                    <thead>
                      <tr>
                        <th>Violation Type</th>
                        <th>1st</th>
                        <th>2nd</th>
                        <th>3rd</th>
                        <th>4th / Final</th>
                        <th>Tracking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(PENALTY_MATRIX[penaltyVariant] || PENALTY_MATRIX['default'] || {}).map(([type, steps]) => {
                        const tracking = VIOLATION_TRACKING[type] || 'Lifetime';
                        return (
                          <tr key={type}>
                            <td>
                              <strong>{type}</strong>
                              {ONLINE_VIOLATION_CATEGORIES[type] && (
                                <small className="vio-meta">
                                  {ONLINE_VIOLATION_CATEGORIES[type].category}
                                  {' · '}
                                  <span className={`vio-sev vio-sev-${ONLINE_VIOLATION_CATEGORIES[type].severity.toLowerCase()}`}>
                                    {ONLINE_VIOLATION_CATEGORIES[type].severity}
                                  </span>
                                </small>
                              )}
                            </td>
                            {[0, 1, 2, 3].map(i => {
                              const step = steps[i];
                              // Past the last step defined, the last step stands,
                              // so the table says so rather than showing a dash
                              // that reads as "nothing happens".
                              const beyond = !step && i >= steps.length && steps.length > 0;
                              return (
                                <td key={i} className="num-col" title={step?.consequence}>
                                  {step
                                    ? (step.amount > 0
                                        ? `₹${step.amount.toLocaleString('en-IN')}`
                                        : step.consequence)
                                    : (beyond ? <span className="text-muted">as 
                                        {' '}{steps.length === 1 ? '1st' : steps.length === 2 ? '2nd' : '3rd'}</span> : '—')}
                                </td>
                              );
                            })}
                            <td>
                              <span className={`badge ${tracking === 'Quarterly' ? 'badge-warning' : 'badge-muted'}`}>
                                {tracking}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted scorecard-legend">
                  Occurrences are counted per coach, per violation type.
                  <strong> Quarterly</strong> types start again each quarter, so a late arrival in
                  a new quarter is a first occurrence.
                  <strong> Lifetime</strong> types keep counting for as long as the coach is here.
                  A violation that wins an appeal is not counted at all.
                </p>
              </div>

              {/* What has actually been recorded. The amount on each row is what
                  the schedule above charged for that occurrence, and it is what
                  the coach's payslip deducts for the period it falls in. */}
              <div className="card" style={{ marginTop: '1.5rem' }}>
                <div className="card-header-row">
                  <h3>Recorded Incidents</h3>
                  <span className="text-muted" style={{ fontSize: '0.82rem' }}>
                    {violations.length} recorded · ₹{violations
                      .filter(v => v.status !== 'Appeal_Approved')
                      .reduce((sum, v) => sum + (Number(v.penalty_amount) || 0), 0)
                      .toLocaleString('en-IN')} chargeable
                  </span>
                </div>
                <div className="table-container">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Coach</th>
                        <th>Violation</th>
                        <th className="num-col">Occurrence</th>
                        <th>Consequence</th>
                        <th className="num-col">Penalty</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {violations.length === 0 && (
                        <tr><td colSpan={7} className="text-muted">No incidents recorded.</td></tr>
                      )}
                      {[...violations]
                        .sort((a, b) => new Date(b.incident_date) - new Date(a.incident_date))
                        .map(v => {
                          const c = coaches.find(x => x.id === v.coach_id);
                          const waived = v.status === 'Appeal_Approved';
                          return (
                            <tr key={v.id} className={waived ? 'row-unrecorded' : undefined}>
                              <td>{new Date(v.incident_date).toLocaleDateString('en-IN')}</td>
                              <td><strong>{c?.name || v.coach_id}</strong></td>
                              <td>{v.type}</td>
                              <td className="num-col">#{v.occurrence_no}</td>
                              <td>{v.consequence}</td>
                              <td className="num-col">
                                {waived
                                  ? <span className="text-muted">waived</span>
                                  : `₹${(Number(v.penalty_amount) || 0).toLocaleString('en-IN')}`}
                              </td>
                              <td><span className="badge badge-muted">{v.status}</span></td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted scorecard-legend">
                  A penalty is deducted on the payslip for the period its incident date falls in,
                  under Taxes &amp; Deductions. Nothing is keyed in there — it comes from here.
                </p>
              </div>
            </section>
          )}

          {/* Certifications — the master list every coach's technical score reads
              from, so defining an entry here sets the points for everyone who
              holds it. Super Admin and HR only. */}
          {isViewEnabled('certifications') && activeView === 'certifications' && verifyAccess("Super Admin,HR Manager") && (
            <section id="view-certifications" className="content-view active-view">
              <div className="page-header-row">
                <div>
                  <h2>Certifications</h2>
                  <p>Master list of technical certifications and the points each one carries</p>
                </div>
              </div>

              <div className="card settings-section">
                <h3>Technical Certifications Master</h3>
                <p className="subtitle">Assign base scoring values to certificates</p>
                <div className="settings-scroll-container">
                  <table className="data-table small-table">
                    <thead>
                      <tr>
                        <th>Authority</th>
                        <th>Certification Name</th>
                        <th>Type</th>
                        <th>Tier</th>
                        <th>Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {certifications.map((c, i) => (
                        <tr key={c.id || i}>
                          <td><strong>{c.authority}</strong></td>
                          <td>
                            {c.course_name}
                            {c.pdfData && (
                              <a 
                                href={c.pdfData} 
                                download={c.pdfName || "certificate.pdf"} 
                                title={`Download/View document: ${c.pdfName}`}
                                style={{ marginLeft: '8px', color: 'var(--primary-color)', textDecoration: 'none' }}
                                target="_blank"
                                rel="noreferrer"
                              >
                                <i className={getFileIcon(c.pdfName)} style={{ fontSize: '1.15rem', verticalAlign: 'middle' }}></i>
                              </a>
                            )}
                          </td>
                          <td>
                            {(() => {
                              // Yoga and S&C certifications score against different
                              // denominators, so which discipline a row belongs to
                              // is worth showing rather than only filtering on.
                              const yoga = /yoga/i.test(c.variant_type || '');
                              return (
                                <span className={`cert-type-chip ${yoga ? 'is-yoga' : 'is-sc'}`}>
                                  <i className={yoga ? 'bx bx-body' : 'bx bx-dumbbell'}></i>
                                  {c.variant_type || '—'}
                                </span>
                              );
                            })()}
                          </td>
                          <td>{c.level}</td>
                          <td><strong>{Number(c.score ?? 0).toFixed(1)}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                  <h4 style={{ marginBottom: '12px' }}>Add New Certification</h4>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    handleAddCertification();
                  }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', alignItems: 'end' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Authority</label>
                      <input type="text" value={newCertAuthority} onChange={(e) => setNewCertAuthority(e.target.value)} placeholder="e.g. NSCA" required />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Certification Name</label>
                      <input type="text" value={newCertCourseName} onChange={(e) => setNewCertCourseName(e.target.value)} placeholder="e.g. CSCS" required />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Discipline</label>
                      <select value={newCertVariantType} onChange={(e) => setNewCertVariantType(e.target.value)} required>
                        <option value="S&C">S&amp;C</option>
                        <option value="Yoga">Yoga</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Tier Level</label>
                      <select value={newCertLevel} onChange={(e) => setNewCertLevel(e.target.value)} required>
                        <option value="Gold">Gold</option>
                        <option value="Silver">Silver</option>
                        <option value="Bronze">Bronze</option>
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Score (0-10)</label>
                      <input type="number" step="0.1" min="0" max="10" value={newCertScore} onChange={(e) => setNewCertScore(Number(e.target.value))} required />
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Certification Attachment (PDF, Image, Word &lt; 500KB)</label>
                      <input type="file" accept=".pdf,image/*,.doc,.docx" onChange={handlePdfUpload} />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ height: '38px' }}>Add Cert</button>
                  </form>
                </div>
              </div>

              <div className="card settings-section">
                <h3>Study Formats</h3>
                <p className="subtitle">
                  How a qualification was studied. Each format pairs with a
                  qualification in the Education Master below to carry a score.
                </p>
                <div className="settings-scroll-container">
                  <table className="data-table small-table">
                    <thead>
                      <tr>
                        <th>Format</th>
                        <th>Stored Key</th>
                        <th style={{ textAlign: 'right' }}>Scoring Rows</th>
                        <th style={{ textAlign: 'right' }}>Coaches</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {educationFormats.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem' }}>
                            <span className="text-muted">No study formats defined yet.</span>
                          </td>
                        </tr>
                      )}
                      {educationFormats.map(format => {
                        const pairings = educationLevels.filter(l => l.format === format.value).length;
                        const holders = coaches.filter(c => c.education_type === format.value).length;
                        const inUse = pairings > 0 || holders > 0;
                        return (
                          <tr key={format.value}>
                            <td><strong>{format.label}</strong></td>
                            <td><code style={{ fontSize: '0.78rem' }}>{format.value}</code></td>
                            <td style={{ textAlign: 'right' }}>
                              <span className="text-muted">{pairings || '—'}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <span className="text-muted">{holders || '—'}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className="btn-row-icon icon-cancel"
                                title={inUse ? 'Still in use — clear its scoring rows and coaches first' : 'Remove this format'}
                                aria-label="Remove"
                                onClick={() => handleRemoveEducationFormat(format)}
                              >
                                <i className="bx bx-trash"></i>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                  <h4 style={{ marginBottom: '12px' }}>Add Study Format</h4>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    handleAddEducationFormat();
                  }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', alignItems: 'end' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Format Name</label>
                      <input
                        type="text" required
                        placeholder="e.g. Distance — India"
                        value={newEduFormatLabel}
                        onChange={(e) => setNewEduFormatLabel(e.target.value)}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ height: '38px' }}>Add Format</button>
                  </form>
                  <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: '10px' }}>
                    A new format starts with no points against any qualification — set
                    those in the Education Master below. The stored key is derived from
                    the name once and never changes, so coach records stay intact.
                  </p>
                </div>
              </div>

              <div className="card settings-section">
                <h3>Education Master</h3>
                <p className="subtitle">
                  Points for each qualification and study format. A coach's Non-Tech
                  Educational Score is read straight from this table.
                </p>
                <div className="settings-scroll-container">
                  <table className="data-table small-table">
                    <thead>
                      <tr>
                        <th>Qualification</th>
                        <th>Study Format</th>
                        <th style={{ textAlign: 'right' }}>Points</th>
                        <th style={{ textAlign: 'right' }}>Coaches</th>
                        <th style={{ textAlign: 'right' }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {educationLevels.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '1.5rem' }}>
                            <span className="text-muted">No education levels defined yet.</span>
                          </td>
                        </tr>
                      )}
                      {educationLevels.map(level => {
                        const formatLabel = educationFormats.find(f => f.value === level.format)?.label || level.format;
                        const holders = coaches.filter(
                          c => c.education_qualification === level.qualification && c.education_type === level.format
                        ).length;
                        return (
                          <tr key={level.id}>
                            <td><strong>{level.qualification}</strong></td>
                            <td>{formatLabel}</td>
                            <td style={{ textAlign: 'right' }}><strong>{Number(level.score).toFixed(1)}</strong></td>
                            <td style={{ textAlign: 'right' }}>
                              <span className="text-muted">{holders || '—'}</span>
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              <button
                                className="btn-row-icon icon-cancel"
                                title="Remove this pairing" aria-label="Remove"
                                onClick={() => handleRemoveEducationLevel(level)}
                              >
                                <i className="bx bx-trash"></i>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div style={{ marginTop: '24px', borderTop: '1px solid var(--border-color)', paddingTop: '20px' }}>
                  <h4 style={{ marginBottom: '12px' }}>Add / Update Education Points</h4>
                  <form onSubmit={(e) => {
                    e.preventDefault();
                    handleAddEducationLevel();
                  }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', alignItems: 'end' }}>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Qualification</label>
                      <input
                        type="text" list="edu-qualification-options" required
                        placeholder="e.g. PhD (Doctorate)"
                        value={newEduQualification}
                        onChange={(e) => setNewEduQualification(e.target.value)}
                      />
                      <datalist id="edu-qualification-options">
                        {educationQualifications.map(q => <option key={q} value={q} />)}
                      </datalist>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Study Format</label>
                      <select value={newEduFormat} onChange={(e) => setNewEduFormat(e.target.value)} required>
                        {educationFormats.map(f => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                      <label>Points (0–10)</label>
                      <input
                        type="number" step="0.1" min="0" max="10" required
                        value={newEduScore}
                        onChange={(e) => setNewEduScore(Number(e.target.value))}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ height: '38px' }}>Save Points</button>
                  </form>
                  <p className="text-muted" style={{ fontSize: '0.78rem', marginTop: '10px' }}>
                    A qualification and format pair carries one score, so re-entering an
                    existing pair updates its points rather than adding a second row.
                    Qualifications listed here are the ones offered on the coach profile.
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Audit View */}
          {isViewEnabled('user-access') && activeView === 'user-access' && verifyAccess("Super Admin") && (
            <section id="view-user-access" className="content-view active-view">
              <div className="page-header-row">
                <div>
                  <h2>User Access</h2>
                  <p>Assign a role to everyone who has signed in with Google</p>
                </div>
                <button className="btn btn-secondary" onClick={refreshAppUsers} disabled={appUsersLoading}>
                  <i className="bx bx-refresh"></i> {appUsersLoading ? "Loading…" : "Refresh"}
                </button>
              </div>

              {appUsersError && (
                <div className="card" style={{ padding: '1rem', marginBottom: '1rem', color: 'var(--accent-red, #9f4022)' }}>
                  <strong>Could not load users:</strong> {appUsersError}
                </div>
              )}

              <div className="card" style={{ padding: '.9rem 1rem', marginBottom: '1rem' }}>
                <small className="text-muted">
                  Signing in does not grant access. A new account arrives as an
                  unassigned <strong>Coach</strong> and sees an "Access pending"
                  screen until you give it a role here. A <strong>Coach</strong> must be
                  linked to a coach record, and a <strong>Reporting Manager</strong> to a squad.
                </small>
              </div>

              <div className="table-container card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>Last Sign-In</th>
                      <th>Role</th>
                      <th>Linked To</th>
                      <th style={{ textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {appUsers.length === 0 && !appUsersLoading && (
                      <tr>
                        <td colSpan={5} style={{ textAlign: 'center', padding: '2rem' }}>
                          <span className="text-muted">Nobody has signed in yet.</span>
                        </td>
                      </tr>
                    )}
                    {appUsers.map(u => {
                      const draft = userDrafts[u.id] || { role: u.role, coachId: u.coach_id || "", rmId: u.rm_id || "" };
                      const pending = u.role === 'Coach' && !u.coach_id;
                      const isSelf = u.id === session?.user?.id;
                      return (
                        <tr key={u.id} className={pending ? 'row-pending' : undefined}>
                          <td>
                            <div className="user-cell">
                              {u.avatar_url
                                ? <img className="user-cell-avatar" src={u.avatar_url} alt="" referrerPolicy="no-referrer" />
                                : <span className="user-cell-avatar user-cell-initials">
                                    {(u.full_name || u.email || '?').slice(0, 1).toUpperCase()}
                                  </span>}
                              <div>
                                <strong>{u.full_name || '—'}</strong>
                                {isSelf && <span className="badge badge-info" style={{ marginLeft: '.4rem' }}>You</span>}
                                {pending && <span className="badge badge-warning" style={{ marginLeft: '.4rem' }}>Pending</span>}
                                <br /><small className="text-muted">{u.email}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <small>{u.last_sign_in_at
                              ? new Date(u.last_sign_in_at).toLocaleString('en-IN')
                              : <span className="text-muted">never</span>}</small>
                          </td>
                          <td>
                            <select
                              className="header-select"
                              value={draft.role}
                              onChange={(e) => updateUserDraft(u.id, { role: e.target.value })}
                            >
                              {(APP_ROLES.includes(draft.role) ? APP_ROLES : [...APP_ROLES, draft.role])
                                .map(r => (
                                  <option key={r} value={r}>
                                    {r}{APP_ROLES.includes(r) ? '' : ' (current)'}
                                  </option>
                                ))}
                            </select>
                          </td>
                          <td>
                            {draft.role === 'Coach' && (
                              <select
                                className="header-select"
                                value={draft.coachId}
                                onChange={(e) => updateUserDraft(u.id, { coachId: e.target.value })}
                              >
                                <option value="">— pick a coach record —</option>
                                {coaches.map(c => (
                                  <option key={c.id} value={c.id}>{c.name} ({c.id})</option>
                                ))}
                              </select>
                            )}
                            {draft.role === 'Reporting Manager' && (
                              <select
                                className="header-select"
                                value={draft.rmId}
                                onChange={(e) => updateUserDraft(u.id, { rmId: e.target.value })}
                              >
                                <option value="">— pick a squad —</option>
                                {RM_SCOPES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                              </select>
                            )}
                            {draft.role !== 'Coach' && draft.role !== 'Reporting Manager' && (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn btn-primary"
                              disabled={!userAccessDirty(u) || savingUserId === u.id}
                              onClick={() => handleSaveUserAccess(u)}
                            >
                              {savingUserId === u.id ? "Saving…" : "Save"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {isViewEnabled('audit') && activeView === 'audit' && (
            <section id="view-audit" className="content-view active-view">
              <div className="page-header-row">
                <h2>System Audit Trails</h2>
                <p>Immutable log of overrides, locks, and score overrides</p>
              </div>

              <div className="table-container card">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Actor</th>
                      <th>Action</th>
                      <th>Details</th>
                      <th>IP / User Agent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLog.map(log => (
                      <tr key={log.id}>
                        <td><small>{log.timestamp}</small></td>
                        <td><strong>{log.actor}</strong></td>
                        <td><span className="badge badge-info">{log.action}</span></td>
                        <td>{log.details}</td>
                        <td><small className="text-muted">{log.ip}</small></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>

      {/* ========================================================= */}
      {/* MODAL LIGHTBOXES                                          */}
      {/* ========================================================= */}

      {/* Modal: Add Coach */}
      {activeModal === 'add-coach' && (
        <div className="modal-backdrop active-modal">
          <div className="modal-card">
            <div className="modal-header">
              <h3><i className="bx bx-user-plus"></i> Add New Coach</h3>
              <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
            </div>
            <form onSubmit={handleCreateCoachSubmit} noValidate>
              <div className="form-section-title">Coach Information</div>
              <div className="form-grid">
                <div className="form-group">
                  <label>Coach Name <span className="required-star">*</span></label>
                  <input
                    type="text"
                    className={newCoachErrors.name ? "input-invalid" : ""}
                    placeholder="Enter coach name"
                    value={newCoachName}
                    onChange={(e) => setNewCoachName(e.target.value)}
                  />
                  {newCoachErrors.name && <span className="field-error">{newCoachErrors.name}</span>}
                </div>
                <div className="form-group">
                  <label>Coach UHID <span className="required-star">*</span></label>
                  <input
                    type="text"
                    className={newCoachErrors.uhid ? "input-invalid" : ""}
                    placeholder="Enter coach UHID"
                    value={newCoachUhid}
                    onChange={(e) => setNewCoachUhid(e.target.value)}
                  />
                  {newCoachErrors.uhid && <span className="field-error">{newCoachErrors.uhid}</span>}
                </div>
                <div className="form-group">
                  <label>Email Address <span className="required-star">*</span></label>
                  <input
                    type="email"
                    className={newCoachErrors.email ? "input-invalid" : ""}
                    placeholder="Enter email address"
                    value={newCoachEmail}
                    onChange={(e) => setNewCoachEmail(e.target.value)}
                  />
                  {newCoachErrors.email && <span className="field-error">{newCoachErrors.email}</span>}
                </div>
                <div className="form-group">
                  <label>Gender <span className="required-star">*</span></label>
                  <select
                    className={newCoachErrors.gender ? "input-invalid" : ""}
                    value={newCoachGender}
                    onChange={(e) => setNewCoachGender(e.target.value)}
                  >
                    <option value="">Select gender</option>
                    {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                  {newCoachErrors.gender && <span className="field-error">{newCoachErrors.gender}</span>}
                </div>
                <div className="form-group">
                  <label>Type of Coach <span className="required-star">*</span></label>
                  <select
                    className={newCoachErrors.type ? "input-invalid" : ""}
                    value={newCoachType}
                    onChange={(e) => setNewCoachType(e.target.value)}
                  >
                    <option value="">Select coach type</option>
                    {COACH_TYPES.map(t => <option key={t.value} value={t.value}>{t.value}</option>)}
                  </select>
                  {newCoachErrors.type && <span className="field-error">{newCoachErrors.type}</span>}
                </div>
                <div className="form-group">
                  <label>Category <span className="required-star">*</span></label>
                  <select
                    className={newCoachErrors.category ? "input-invalid" : ""}
                    value={newCoachCategory}
                    onChange={(e) => setNewCoachCategory(e.target.value)}
                  >
                    <option value="">Select category</option>
                    {COACH_CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  {newCoachErrors.category && <span className="field-error">{newCoachErrors.category}</span>}
                </div>
              </div>

              {/* Pay is stored on the coach from the start, so it never moves
                  on its own when the score does. The defaults are the floor of
                  the entry band, which is a starting point, not a proposal. */}
              {newCoachCategory && newCoachCategory !== 'Flexi' && (() => {
                const typeConfig = COACH_TYPES.find(t => t.value === newCoachType);
                const entry = entryBenchmark(typeConfig?.variant_id, newCoachCategory);
                return (
                  <div className="form-grid">
                    <div className="form-group">
                      <label>Starting Salary (₹)</label>
                      <input
                        type="number" min="0" step="any"
                        value={newCoachSalary}
                        placeholder={entry.salary != null ? String(entry.salary) : ''}
                        onChange={(e) => setNewCoachSalary(e.target.value)}
                      />
                      <span className="field-hint">
                        {entry.salary != null
                          ? `Blank uses ₹${entry.salary.toLocaleString('en-IN')} — the floor of ${PAY_BANDS[0].label}, where a coach with no score benchmarks.`
                          : 'No benchmark for this category.'}
                      </span>
                    </div>
                    <div className="form-group">
                      <label>Starting Per-Session Rate (₹)</label>
                      <input
                        type="number" min="0" step="any"
                        value={newCoachRate}
                        placeholder={entry.rate != null ? String(entry.rate) : ''}
                        onChange={(e) => setNewCoachRate(e.target.value)}
                      />
                      <span className="field-hint">
                        {newCoachCategory === 'Fixed'
                          ? 'Blank derives it from the salary above, ÷ 26 ÷ 6, floored at ₹200.'
                          : "Blank uses the band's session rate."}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Add Coach</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Evaluation Scorecard Form */}
      {activeModal === 'eval-form' && (() => {
        const coach = coaches.find(c => c.id === selectedCoachId);
        const vConfig = variants.find(v => v.id === coach?.variant_id);
        
        // Derive live calculation preview variables
        const mockData = {
          prof_appearance: Number(evalAppearance),
          client_engagement: Number(evalEngagement),
          safety: Number(evalSafety),
          punctuality: Number(evalPunctuality),
          team_conduct: Number(evalConduct),
          communication: Number(evalCommunication),
          attendance_pct: Number(evalAttendance),
          period_end: new Date().toISOString()
        };
        const coreTotal = mockData.prof_appearance + mockData.client_engagement + mockData.safety + 
                          mockData.punctuality + mockData.team_conduct + mockData.communication;
        const updatedCoach = coach ? { ...coach, coach_category: evalCoachCategory } : null;
        const calc = updatedCoach ? computeHBPlusScore(updatedCoach, mockData, vConfig) : { hbScore: 0 };
        const band = getPerformanceBand(calc.hbScore);

        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card modal-large">
              <div className="modal-header">
                <h3>Record Monthly Score Card</h3>
                <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
              </div>
              <form onSubmit={handleEvalSubmit}>
                <div className="form-section-title">Coach &amp; Period Context</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Coach Profile</label>
                    <input type="text" value={coach?.name || ""} disabled />
                  </div>
                  <div className="form-group">
                    <label>Policy Variant</label>
                    <input type="text" value={vConfig?.name || ""} disabled />
                  </div>
                  <div className="form-group">
                    <label>Category</label>
                    <select value={evalCoachCategory} onChange={(e) => setEvalCoachCategory(e.target.value)} required>
                      <option value="Fixed">Fixed</option>
                      <option value="Flexi">Flexi</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Performance Month</label>
                    <select disabled value={currentPeriodMonth} onChange={() => {}}>
                      <option value={currentPeriodMonth}>{currentPeriodMonth} ({currentPeriodRange})</option>
                    </select>
                  </div>
                </div>

                <div className="form-section-title">Core Performance Metrics (RM Assessment: scale 0 to 15/20)</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Professional Appearance (Max 20)</label>
                    <input type="number" min="0" max="20" value={evalAppearance} onChange={(e) => setEvalAppearance(Number(e.target.value))} required />
                    <span className="input-hint">Grooming, Uniform compliance</span>
                  </div>
                  <div className="form-group">
                    <label>Client Engagement (Max 20)</label>
                    <input type="number" min="0" max="20" value={evalEngagement} onChange={(e) => setEvalEngagement(Number(e.target.value))} required />
                    <span className="input-hint">Session rating &amp; feedback</span>
                  </div>
                  <div className="form-group">
                    <label>Safety &amp; Cleanliness (Max 15)</label>
                    <input type="number" min="0" max="15" value={evalSafety} onChange={(e) => setEvalSafety(Number(e.target.value))} required />
                    <span className="input-hint">Correct form coaching, studio safety</span>
                  </div>
                  <div className="form-group">
                    <label>Punctuality &amp; Docs (Max 10)</label>
                    <input type="number" min="0" max="10" value={evalPunctuality} onChange={(e) => setEvalPunctuality(Number(e.target.value))} required />
                    <span className="input-hint">On-time start, closing reports</span>
                  </div>
                  <div className="form-group">
                    <label>Team Conduct (Max 15)</label>
                    <input type="number" min="0" max="15" value={evalConduct} onChange={(e) => setEvalConduct(Number(e.target.value))} required />
                    <span className="input-hint">Peer respect, meeting participation</span>
                  </div>
                  <div className="form-group">
                    <label>Communication (Max 20)</label>
                    <input type="number" min="0" max="20" value={evalCommunication} onChange={(e) => setEvalCommunication(Number(e.target.value))} required />
                    <span className="input-hint">Client empathy, WhatsApp responsiveness</span>
                  </div>
                </div>

                <div className="form-section-title">Roster, Volume &amp; Special Sessions (SRS/Operations Feed)</div>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Evidence+ Attendance %</label>
                    <input type="number" min="0" max="100" value={evalAttendance} onChange={(e) => setEvalAttendance(Number(e.target.value))} required />
                  </div>
                  <div className="form-group">
                    <label>Sessions Completed (Month Count)</label>
                    <input type="number" min="0" value={evalSessionsCompleted} onChange={(e) => setEvalSessionsCompleted(Number(e.target.value))} required />
                  </div>
                  <div className="form-group">
                    <label>Night Sessions Completed (10 PM - 4 AM)</label>
                    <input type="number" min="0" value={evalNightSessions} onChange={(e) => setEvalNightSessions(Number(e.target.value))} required />
                  </div>
                  <div className="form-group">
                    <label>5-Star Streak Count (Running)</label>
                    <input type="number" min="0" value={evalStreak} onChange={(e) => setEvalStreak(Number(e.target.value))} required />
                  </div>

                  {/* HOP Special fields */}
                  {coach?.variant_id === 'V5' && (
                    <>
                      <div className="form-group">
                        <label>Out-of-Hours Sessions (V5)</label>
                        <input type="number" min="0" value={evalOohSessions} onChange={(e) => setEvalOohSessions(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label>PT &amp; Home Visit Sessions (V5)</label>
                        <input type="number" min="0" value={evalPtHomeSessions} onChange={(e) => setEvalPtHomeSessions(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label>L&amp;D/Credits Points (V5)</label>
                        <input type="number" min="0" value={evalCredits} onChange={(e) => setEvalCredits(Number(e.target.value))} />
                      </div>
                    </>
                  )}

                  {/* Flexi Special fields */}
                  {evalCoachCategory === 'Flexi' && (
                    <>
                      <div className="form-group">
                        <label>Trial Sessions Completed</label>
                        <input type="number" min="0" value={evalTrialSessions} onChange={(e) => setEvalTrialSessions(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label>Half-Day Events Supported</label>
                        <input type="number" min="0" value={evalHalfEvents} onChange={(e) => setEvalHalfEvents(Number(e.target.value))} />
                      </div>
                      <div className="form-group">
                        <label>Full-Day Events Supported</label>
                        <input type="number" min="0" value={evalFullEvents} onChange={(e) => setEvalFullEvents(Number(e.target.value))} />
                      </div>
                    </>
                  )}
                </div>

                <div className="live-score-preview-bar">
                  <div>Composite Core Performance: <strong>{coreTotal}</strong>/100</div>
                  <div>Calculated HB+ Score: <strong>{calc.hbScore.toFixed(2)}</strong></div>
                  <div>Derived Pay Band: <span className={`badge band-badge band-${band.min}-${band.max}`}>{band.label}</span></div>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Submit Score Card</button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal: Log Violation */}
      {activeModal === 'log-violation' && (() => {
        const coach = coaches.find(c => c.id === vioCoachId);
        const occurrence = getViolationOccurrenceNumber(vioCoachId, vioType, vioDate, violations) + 1;
        const consequenceObj = getPenaltyConsequence(coach?.variant_id || "V1", vioType, occurrence, PENALTY_MATRIX);

        let finalAmount = consequenceObj.amount;
        if (consequenceObj.consequence.includes("Deduct") && consequenceObj.consequence.includes("Session")) {
          const activeE = currentMonth.find(cm => cm.coach_id === vioCoachId);
          const score = activeE ? (activeE.hb_score || 50) : 50;
          const band = getPerformanceBand(score).label;
          const vConfig = variants.find(v => v.id === coach?.variant_id);
          const sessionRate = vConfig?.rates[coach?.coach_category]?.[band]?.per_session || 250;
          const sessionCount = consequenceObj.consequence.includes("1") ? 1 : (consequenceObj.consequence.includes("2") ? 2 : 4);
          finalAmount = sessionRate * sessionCount;
        }

        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card">
              <div className="modal-header">
                <h3>Log Disciplinary / Punctuality Incident</h3>
                <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
              </div>
              <form onSubmit={handleLogViolationSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Select Coach</label>
                    <select value={vioCoachId} onChange={(e) => {
                      setVioCoachId(e.target.value);
                      setVioType("Late Arrival (<5 min)"); // reset type
                    }} required>
                      <option value="">Choose a coach…</option>
                      {coaches.map(c => (
                        <option key={c.id} value={c.id}>{c.id} - {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Incident Type</label>
                    <select value={vioType} onChange={(e) => setVioType(e.target.value)} required>
                      {/* Built from the matrices rather than typed out, so a
                          violation added to an annexure becomes loggable
                          without a second list to keep in step — and nothing
                          can be logged that has no rule behind it. */}
                      {violationOptions(coach).map(group => (
                        <optgroup key={group.label} label={group.label}>
                          {group.types.map(t => <option key={t} value={t}>{t}</option>)}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Incident Date</label>
                    <input type="date" value={vioDate} onChange={(e) => setVioDate(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label>Incident Time</label>
                    <input type="text" value={vioTime} onChange={(e) => setVioTime(e.target.value)} placeholder="e.g. 07:05 AM" required />
                  </div>
                  <div className="form-group w-full">
                    <label>Evidence / Justification Notes</label>
                    <textarea rows="3" value={vioEvidence} onChange={(e) => setVioEvidence(e.target.value)} placeholder="Enter screenshot details, reason, or attendance tool logs..." required />
                  </div>
                </div>

                <div className="live-violation-calc-bar card" style={{ marginTop: '1rem', padding: '0.75rem', borderLeft: '4px solid var(--accent-red)', display: 'block' }}>
                  <p>Historical Occurrences (Tracking Window): <strong>{occurrence}</strong></p>
                  <p>Consequence Rule: <strong className="text-red">{consequenceObj.consequence}</strong></p>
                  <p>Penalty Amount: <strong>₹{finalAmount.toLocaleString('en-IN')}</strong></p>
                  <p>
                    Deducted on: <strong>{vioDate ? getPeriodForDate(new Date(vioDate)).period_month : '—'}</strong>
                    {vioDate && <span className="text-muted"> — the period the incident date falls in, not the month it is recorded</span>}
                  </p>
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                  <button type="submit" className="btn btn-danger">Log Violation</button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {photoCapture && (
        <div className="modal-backdrop active-modal">
          <div className="modal-card" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3>Photograph for {photoCapture.coach?.name}</h3>
              <i className="bx bx-x modal-close-btn" onClick={() => closeCapture(null)}></i>
            </div>
            <div className="modal-body-content">
              <video ref={videoRef} autoPlay playsInline muted className="capture-video" />
              <p className="calc-notes" style={{ marginTop: '0.5rem' }}>
                Face the camera in good light. The photograph is kept {PHOTO_RETENTION_DAYS} days
                as a record that you logged in, and is not matched against anything.
                {loginFailures.current > 0 && loginFailures.current < LOGIN_FAILURES_BEFORE_SKIP && (
                  <><br /><span className="text-amber">
                    {loginFailures.current} of {LOGIN_FAILURES_BEFORE_SKIP} attempts used. After
                    {' '}{LOGIN_FAILURES_BEFORE_SKIP} you can log in without one.
                  </span></>
                )}
              </p>
            </div>
            <div className="modal-footer">
              {/* Only once the equipment has failed three times, rather than as
                  a standing option — a photograph is required, and this is the
                  way past a camera that will not work, not a preference. */}
              {loginFailures.current >= LOGIN_FAILURES_BEFORE_SKIP ? (
                <button type="button" className="btn btn-secondary" onClick={() => closeCapture({ cancelled: true })}>
                  Log in without one
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => closeCapture({ cancelled: true })}>
                  Cancel
                </button>
              )}
              <button type="button" className="btn btn-primary" onClick={takeShot}>
                <i className="bx bx-camera"></i> Take photograph
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Bulk Sessions CSV */}
      {activeModal === 'bulk-sessions' && (
        <div className="modal-backdrop active-modal">
          <div className="modal-card">
            <div className="modal-header">
              <h3>Bulk Import Sessions Completed</h3>
              <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
            </div>
            <div className="modal-body-content">
              <p className="subtitle">Simulate REST API webhook or paste CSV-formatted content below:</p>
              <textarea rows="8" className="code-area-textarea" value={bulkCSV} onChange={(e) => setBulkCSV(e.target.value)} placeholder={`coach_id,sessions_completed,night_sessions,attendance_pct
HB+_023,162,0,95
HB+_026,110,12,94
HB+_030,185,0,96`} />
              <div className="modal-note-box" style={{ marginTop: '10px' }}>
                <strong>Note:</strong> Matching coaches' current month sessions completed, night sessions, and attendance percentages will be overwritten.
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Close</button>
              <button type="button" className="btn btn-primary" onClick={handleBulkSessionsSubmit}>Import Data</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Org Work Entry */}
      {activeModal === 'org-work' && (() => {
        const coach = coaches.find(c => c.id === selectedCoachId);
        let min = 3000, max = 4000;
        if (owWorkType === "Hiring Support") { min = 1500; max = 2500; }
        else if (owWorkType.includes("Course Development") || owWorkType.includes("Mentoring")) { min = 3500; max = 5500; }

        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card">
              <div className="modal-header">
                <h3>Add Organizational Work Item (Flexi-Fixed)</h3>
                <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
              </div>
              <form onSubmit={handleOrgWorkSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Coach Name</label>
                    <input type="text" value={coach?.name || ""} disabled />
                  </div>
                  <div className="form-group">
                    <label>Work Type</label>
                    <select value={owWorkType} onChange={(e) => {
                      setOwWorkType(e.target.value);
                      // Auto-update values matching defaults
                      if (e.target.value === "Workout Planning / Programming") setOwAmount(3000);
                      else if (e.target.value === "Hiring Support") setOwAmount(1500);
                      else setOwAmount(3500);
                    }} required>
                      <option value="Workout Planning / Programming">Workout Planning / Programming (₹3,000 - 4,000)</option>
                      <option value="Hiring Support">Hiring Support (₹1,500 - 2,500)</option>
                      <option value="Course Development">Course Development (₹3,500 - 5,500)</option>
                      <option value="Coach Training / Mentoring">Coach Training / Mentoring (₹3,500 - 5,500)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Approved Pay Amount (₹)</label>
                    <input type="number" min="0" value={owAmount} onChange={(e) => setOwAmount(Number(e.target.value))} required />
                    <span className="input-hint">Min: ₹{min} | Max: ₹{max}</span>
                  </div>
                </div>
                <div className="modal-footer" style={{ marginTop: '1.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Add Work Item</button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal: File Appeal */}
      {activeModal === 'appeal' && (() => {
        let displayTarget = appealTargetId;
        if (appealTargetType === 'Violation') {
          const vio = violations.find(v => v.id === appealTargetId);
          if (vio) displayTarget = `Violation: ${vio.type} on ${vio.incident_date}`;
        }

        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card">
              <div className="modal-header">
                <h3>File Appeal against Disciplinary/Pay Event</h3>
                <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
              </div>
              <form onSubmit={handleFileAppealSubmit}>
                <div className="form-grid">
                  <div className="form-group">
                    <label>Incident / Score target</label>
                    <input type="text" value={displayTarget} disabled />
                  </div>
                  <div className="form-group w-full">
                    <label>Appeal Reason / Ground of Disagreement</label>
                    <textarea rows="4" value={appealReason} onChange={(e) => setAppealReason(e.target.value)} placeholder="Explain why the deduction is incorrect or describe the makeup session agreement..." required />
                  </div>
                </div>
                <div className="modal-footer" style={{ marginTop: '1.5rem' }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">File Appeal</button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal: Payslip print layout preview */}
      {/* Bulk: choose the month (and the file), then review before anything lands. */}
      {bulkDialog && (() => {
        const tab = BULK_TABS[bulkDialog.tab];
        const tabLabel = SCORE_TRACKER_GROUPS.find(g => g.key === bulkDialog.tab)?.label || bulkDialog.tab;
        const isProfile = tab?.scope === 'profile';
        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card">
              <div className="modal-header">
                <h3>{bulkDialog.mode === 'template' ? 'Download Template' : 'Bulk Upload'} — {tabLabel}</h3>
                <i className="bx bx-x modal-close-btn" onClick={() => setBulkDialog(null)}></i>
              </div>
              <div className="modal-body">
                <p className="text-muted" style={{ fontSize: '0.85rem', marginTop: 0 }}>
                  Manual fields only: {tab.fields.map(f => f.label).join(', ')}.
                </p>
                {isProfile ? (
                  <p className="bulk-scope-note">
                    These are one-time values on the coach profile, so they take no month.
                    Applying them re-scores every month that is not locked.
                  </p>
                ) : (
                  <div className="form-group">
                    <label>Which month is this for?</label>
                    <select value={bulkDialog.month} onChange={(e) => setBulkDialog(d => ({ ...d, month: e.target.value }))}>
                      {bulkPeriods().map(m => (
                        <option key={m} value={m}>{m}{m === currentPeriodMonth ? ' (current payroll)' : ''}</option>
                      ))}
                    </select>
                  </div>
                )}
                {bulkDialog.mode === 'template' ? (
                  <button className="btn btn-primary" onClick={() => downloadBulkTemplate(bulkDialog)}>
                    <i className="bx bx-download"></i> Download {isProfile ? '' : `${bulkDialog.month} `}template
                  </button>
                ) : (
                  <label className="btn btn-primary" style={{ marginBottom: 0 }}>
                    <i className="bx bx-upload"></i> Choose file to preview
                    <input type="file" accept=".csv,text/csv" style={{ display: 'none' }}
                           onChange={(ev) => { buildBulkPreview(ev.target.files[0], bulkDialog); ev.target.value = ''; }} />
                  </label>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {bulkPreview && (() => {
        const tabLabel = SCORE_TRACKER_GROUPS.find(g => g.key === bulkPreview.tab)?.label || bulkPreview.tab;
        const { changes, errors, patches } = summariseBulkPreview(bulkPreview);
        const skipped = bulkPreview.rows.filter(r => r.skip).length;
        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card modal-large bulk-preview-card">
              <div className="modal-header">
                <h3>Review upload — {tabLabel} · {bulkPreview.scope === 'profile' ? 'coach profiles' : bulkPreview.month}</h3>
                <i className="bx bx-x modal-close-btn" onClick={cancelBulkPreview}></i>
              </div>
              <div className="bulk-preview-body">
                <p className="text-muted bulk-file-note">
                  {bulkPreview.fileName} — nothing has been saved yet. Every value can be edited here.
                </p>
                <div className="bulk-summary">
                  <span className="bulk-ok">✓ {changes} change{changes === 1 ? '' : 's'} across {patches.size} coach{patches.size === 1 ? '' : 'es'}</span>
                  {errors > 0 && <span className="bulk-bad">✗ {errors} error{errors === 1 ? '' : 's'}</span>}
                  {skipped > 0 && <span className="bulk-warn">⚠ {skipped} skipped</span>}
                  {bulkPreview.unknown.length > 0 && <span className="bulk-bad">✗ {bulkPreview.unknown.length} unknown coach ID{bulkPreview.unknown.length === 1 ? '' : 's'}</span>}
                </div>

                {/* One row per coach, one column per field — the template's own
                    layout, so it reads like the sheet it came from. */}
                <div className="table-container bulk-grid-wrap">
                  <table className="data-table bulk-grid">
                    <thead>
                      <tr>
                        <th className="bulk-sticky">Coach ID</th>
                        <th>Coach Name</th>
                        {bulkPreview.fields.map(f => <th key={f.key} className="num-col">{f.label}</th>)}
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkPreview.rows.map((row, i) => {
                        const rowErrors = row.skip ? 0 : bulkPreview.fields
                          .filter(f => checkBulkCell(f, row.cells[f.key].raw).error).length;
                        return (
                          <tr key={row.coachId} className={row.skip ? 'bulk-row-skipped' : (rowErrors ? 'bulk-row-error' : '')}>
                            <td className="bulk-sticky"><strong>{row.coachId}</strong></td>
                            <td>{row.name}</td>
                            {bulkPreview.fields.map(f => {
                              const cell = row.cells[f.key];
                              const { value, error } = checkBulkCell(f, cell.raw);
                              const changed = !error && value !== null && !(cell.current !== null && Number(cell.current) === value);
                              return (
                                <td key={f.key} className="num-col">
                                  {row.skip ? (
                                    <span className="text-muted">{cell.raw === '' ? '—' : cell.raw}</span>
                                  ) : (
                                    <input
                                      className={`bulk-cell${error ? ' is-error' : ''}${changed ? ' is-changed' : ''}`}
                                      value={cell.raw}
                                      onChange={(e) => editBulkCell(i, f.key, e.target.value)}
                                      title={error
                                        ? error
                                        : changed ? `Was ${cell.current ?? '—'}` : 'Unchanged'}
                                    />
                                  )}
                                </td>
                              );
                            })}
                            <td className="bulk-status">
                              {row.skip
                                ? <span className="bulk-warn">⚠ {row.skip}</span>
                                : rowErrors
                                  ? <span className="bulk-bad">✗ {rowErrors} to fix</span>
                                  : <span className="bulk-ok">✓ ready</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {bulkPreview.unknown.length > 0 && (
                  <p className="bulk-issues bulk-bad">
                    ✗ Not in the system, left out: {bulkPreview.unknown.join(', ')}
                  </p>
                )}

                <p className="bulk-legend">
                  <span className="bulk-swatch is-changed"></span> changed
                  <span className="bulk-swatch is-error"></span> needs fixing — hover it for why
                  <span className="text-muted"> · greyed rows cannot be changed for this month</span>
                </p>
              </div>

              <div className="bulk-actions">
                {errors > 0 && (
                  <span className="bulk-block-note">
                    Fix the {errors} highlighted cell{errors === 1 ? '' : 's'} to upload, or bypass to apply everything else.
                  </span>
                )}
                <button className="btn btn-secondary" onClick={cancelBulkPreview}>Cancel</button>
                {errors > 0 && (
                  <button className="btn btn-danger" disabled={changes === 0}
                          title="Apply every valid change and leave the error cells out"
                          onClick={() => applyBulkPreview(true)}>
                    Bypass &amp; Apply {changes}
                  </button>
                )}
                <button className="btn btn-primary" disabled={errors > 0}
                        title={errors ? 'Fix the errors first, or use Bypass' : undefined}
                        onClick={() => applyBulkPreview(false)}>
                  <i className="bx bx-check"></i> Accept &amp; Apply
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {activeModal === 'payslip-preview' && (() => {
        const coach = coaches.find(c => c.id === selectedCoachId);
        if (!coach) return null;
        
        const vConfig = findVariant(variants, coach.variant_id);
        // Matching on the coach alone returned whichever record happened to
        // come first, so every historic payslip showed one arbitrary month's
        // figures under the heading of the month that was asked for. The month
        // is part of the identity of the record, and which array holds it
        // depends on whether the cycle has rolled, so both are searched.
        const e = [...currentMonth, ...historicMonths].find(
          x => x.coach_id === selectedCoachId && x.period_month === payslipPeriod
        );
        if (!e) return null;

        const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
        const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

        const calcScoreObj = e.hb_score != null ? e : computeHBPlusScore(coach, e, vConfig);
        const pay = computeMonthlyPay(coach, carryPay(e), calcScoreObj, activeVio, vConfig, coachOrgWork);

        const earningsSum = pay.basePay + pay.extraSessionPay + pay.sessionPay + pay.nightSessionPay + pay.milestoneIncentive + 
                            pay.consistencyBonus + pay.streakBonusPay + pay.orgWorkPay + pay.trialIncentive + pay.eventIncentive + 
                            pay.hopOohPremium + pay.hopPtHomePremium + pay.hopPerformanceCreditsPay;

        // Earnings (A) is what the month was worth before anything came off it.
        // Loss of Pay used to be netted silently out of this, which left a slip
        // showing a smaller salary with nothing saying why — so it is shown
        // gross here and taken off in deductions, where it can be read.
        const totalEarnings = Math.round(
          (pay.grossPay + pay.penaltyDeductions + pay.lossOfPay) * 100) / 100;
        const earningLines = payslipEarnings(coach.coach_category, totalEarnings, pay.basePay);
        // Withheld on what is left after days not worked, as the policy sets
        // out — so the figure itself does not change, only where it is shown.
        const taxableEarnings = Math.round((totalEarnings - pay.lossOfPay) * 100) / 100;
        const incomeTax = Math.round(taxableEarnings * TDS_194J_RATE);
        const totalDeductions = Math.round(
          (incomeTax + pay.penaltyDeductions + pay.lossOfPay) * 100) / 100;
        const netPayable = Math.round((totalEarnings - totalDeductions) * 100) / 100;

        // A salaried month is described in days, so count the period's own.
        const periodDays = Math.round(
          (new Date(e.period_end) - new Date(e.period_start)) / 86400000
        ) + 1;

        const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', {
          day: 'numeric', month: 'short', year: 'numeric'
        }) : 'N/A';

        return (
          <div className="modal-backdrop active-modal">
            <div className="modal-card modal-large">
              <div className="modal-header no-print">
                <h3>Official Payslip &amp; Incentive Statement</h3>
                <div className="header-buttons-row" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <button className="btn btn-primary" onClick={() => window.print()}><i className="bx bx-printer"></i> Print / Export PDF</button>
                  <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
                </div>
              </div>
              
              <div className="payslip-print-layout" id="payslip-print-content">
                <div className="payslip-top">
                  <div>
                    <h1 className="payslip-title">PAYSLIP <span>{payslipPeriod.toUpperCase()}</span></h1>
                    <p className="payslip-company">HB+ FITNESS PRIVATE LIMITED</p>
                    <p className="payslip-address">3rd Floor, HSR Plaza, Outer Ring Road, Bengaluru - 560102</p>
                  </div>
                  <div className="payslip-mark">HB+</div>
                </div>

                <h2 className="payslip-person">{coach.name.toUpperCase()}</h2>
                <div className="payslip-facts">
                  {[
                    ['Employee Number', coach.id],
                    ['Date Joined', formatDate(coach.date_of_joining)],
                    ['Department', 'Delivery'],
                    ['Sub Department', vConfig?.discipline === 'Yoga' ? 'Yoga' : 'Physical Training'],
                    ['Designation', coach.internal_designation || 'Coach'],
                    ['Payment Mode', 'Bank Transfer'],
                    ['UAN', 'N/A'],
                    ['PF Number', 'N/A'],
                    ['PAN Number', coach.pan_number || 'N/A'],
                    ['Secondary Job Title', coach.coach_type || 'N/A']
                  ].map(([label, value]) => (
                    <div className="payslip-fact" key={label}>
                      <span>{label}</span>
                      <strong>{value ?? 'N/A'}</strong>
                    </div>
                  ))}
                </div>

                <div className="payslip-section-title">SALARY DETAILS</div>
                <div className="payslip-facts">
                  {coach.coach_category === 'Fixed' ? (
                    // A salaried month is described in days.
                    [
                      ['Actual Payable Days', periodDays.toFixed(1)],
                      ['Total Working Days', periodDays.toFixed(1)],
                      ['Loss Of Pay Days', '0.00'],
                      ['Days Payable', String(periodDays)]
                    ]
                  ) : (
                    // A session-paid month is described in what was delivered.
                    [['Payable Units', `${Number(e.sessions_completed) || 0} Sessions`]]
                  ).map(([label, value]) => (
                    <div className="payslip-fact" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>

                <div className="payslip-ledger-grid">
                  <div className="payslip-ledger-section">
                    <h3>EARNINGS</h3>
                    <table className="payslip-ledger-table">
                      <tbody>
                        {earningLines.map(line => (
                          <tr key={line.label}>
                            <td>{line.label}</td>
                            <td className="amt">{line.amount.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr className="total-row">
                          <td>Total Earnings (A)</td>
                          <td className="amt">{totalEarnings.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <div className="payslip-ledger-section">
                    <h3>TAXES &amp; DEDUCTIONS</h3>
                    <table className="payslip-ledger-table">
                      <tbody>
                        {pay.lossOfPay > 0 && (
                          <tr>
                            <td>
                              Loss of Pay ({pay.lopDays} day{pay.lopDays === 1 ? '' : 's'})
                              {pay.unplannedLopDays > 0 && ` — ${pay.unplannedLopDays} unplanned`}
                            </td>
                            <td className="amt">{pay.lossOfPay.toFixed(2)}</td>
                          </tr>
                        )}
                        {pay.penaltyDeductions > 0 && (
                          <tr>
                            <td>Penalty ({activeVio.length} incident{activeVio.length === 1 ? '' : 's'})</td>
                            <td className="amt">{pay.penaltyDeductions.toFixed(2)}</td>
                          </tr>
                        )}
                        <tr>
                          <td>Total Income Tax</td>
                          <td className="amt">{incomeTax.toFixed(2)}</td>
                        </tr>
                        <tr className="total-row">
                          <td>Total Taxes &amp; Deductions (B)</td>
                          <td className="amt">{totalDeductions.toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="payslip-net">
                  <div className="payslip-net-row">
                    <span>Net Salary Payable ( A - B )</span>
                    <strong>{netPayable.toFixed(2)}</strong>
                  </div>
                  <div className="payslip-net-row payslip-net-words-row">
                    <span>Net Salary in words</span>
                    <strong>{amountInWords(netPayable)}</strong>
                  </div>
                </div>

                <p className="payslip-note">
                  <strong>**Note :</strong> All amounts displayed in this payslip are in INR
                </p>
                <p className="payslip-note">
                  * This is computer generated statement, does not require signature.
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
