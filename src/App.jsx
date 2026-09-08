import React, { useState, useEffect, useRef } from 'react';
import { 
  INITIAL_VARIANTS, 
  INITIAL_CERTIFICATIONS, 
  INITIAL_COACHES, 
  INITIAL_VIOLATIONS, 
  INITIAL_HISTORIC_MONTHS, 
  INITIAL_CURRENT_MONTH, 
  INITIAL_ORG_WORK, 
  PENALTY_MATRIX 
} from './data.js';

import { 
  computeHBPlusScore, 
  getPerformanceBand, 
  computeMonthlyPay, 
  getViolationOccurrenceNumber, 
  getPenaltyConsequence,
  getQuarterLabel,
  calculateTenureYears,
  getEducationScore,
  getPeriodForDate,
  getNextPeriod
} from './calculations.js';

// Phase 1 scope: only these modules are exposed in the UI.
// Add a view key back to this list to re-enable its nav item and its view section.
const ENABLED_VIEWS = ["dashboard", "coaches", "score-tracker", "pay-calculator"];
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

// Pay structures; each maps to a rates/milestones table on the policy variant.
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
      { key: "category", label: "Category", sortable: true }
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
      { key: "core", label: "Core Performance", weightOf: "core_performance", decimals: 2 },
      { key: "org", label: "Org Reliability", weightOf: "tenure", decimals: 2 },
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
    key: "sessions", label: "Session Counts", tone: "indigo",
    columns: [
      { key: "sessions", label: "Sessions Completed", decimals: 0, sortable: true },
      { key: "threshold", label: "Threshold", decimals: 0 },
      { key: "extra_sessions", label: "Extra Sessions", decimals: 0, emphasis: true }
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
    key: "incentives", label: "Incentives & Bonuses", tone: "green",
    columns: [
      { key: "milestone", label: "Milestone Incentive", money: true },
      { key: "consistency", label: "Consistency Bonus", money: true },
      { key: "streak", label: "5-Star Streak Count", decimals: 0 }
    ]
  }
];

const SCORE_TRACKER_COLUMNS = SCORE_TRACKER_GROUPS.flatMap(g => g.columns);

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
      { key: "status", label: "Record Status" }
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
      { key: "cert_raw", label: "Technical Certification Score", entry: "derived", note: "From certifications", decimals: 2 },
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
      { key: "hb_score", label: "HB+ Score", entry: "derived", scale: "/ 100", decimals: 2, emphasis: true },
      { key: "band", label: "Performance Band", entry: "derived" }
    ]
  },
  {
    key: "volume", label: "Volume & Conduct", tone: "green",
    columns: [
      { key: "sessions", label: "Sessions Completed", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "night_sessions", label: "Night Sessions", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "streak", label: "5-Star Streak", entry: "manual", source: "From App", max: 999, decimals: 0 },
      { key: "threshold", label: "Threshold", entry: "derived", decimals: 0 },
      { key: "extra_sessions", label: "Extra Sessions", entry: "derived", decimals: 0 },
      { key: "violations", label: "Violations in Period", entry: "derived", decimals: 0 }
    ]
  }
];

const COACH_SCORECARD_COLUMNS = COACH_SCORECARD_GROUPS.flatMap(g => g.columns);

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
    default: return null;
  }
};

const OVERRIDABLE_KEYS = [
  "exp_post_doj", "exp_coach_score", "exp_non_coach_score", "experience",
  "edu_score", "cert_raw", "cert_score", "technical",
  "core_total", "core", "tenure_years", "org",
  "attendance_pct", "attendance_score", "hb_score", "threshold"
];

// Fields an RM / the app keys in each period. A rolled-over period starts with
// these null so the row reads empty until someone actually records the month.
const MANUAL_PERIOD_FIELDS = [
  "prof_appearance", "client_engagement", "safety", "punctuality",
  "team_conduct", "communication", "meetings_scheduled", "meetings_attended",
  "sessions_completed", "night_sessions", "five_star_streak"
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
function PayCalculator({ variants, seed, onSeedChange, coachOptions, selectedCoachId, onCoachChange, lockCoach }) {
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
  const [baseOverride, setBaseOverride] = useState(seed?.baseOverride ?? "");

  // Re-seed when the caller points the calculator at a different period/coach.
  const seedKey = seed?.key;
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
    setBaseOverride(seed.baseOverride ?? "");
  }, [seedKey]);

  const vConfig = variants.find(v => v.id === variantId) || variants[0];
  if (!vConfig) return null;

  const numericScore = Math.min(90, Math.max(0, Number(score) || 0));
  const band = getPerformanceBand(numericScore);
  const rates = vConfig.rates[category]?.[band.label] || {};

  // A synthetic coach + month record: consistency is a yes/no input here rather
  // than something derived, so attendance is forced to match the choice and the
  // penalty total is applied at the end instead of through a violations list.
  const syntheticCoach = {
    id: "CALC",
    coach_category: category,
    variant_id: vConfig.id,
    ...(baseOverride !== "" && category === "Fixed" ? { fixed_salary_override: Number(baseOverride) } : {}),
    ...(baseOverride !== "" && category === "Flexi-Fixed" ? { flexi_fixed_base_salary: Number(baseOverride) } : {})
  };
  const syntheticMonth = {
    sessions_completed: Number(sessions) || 0,
    night_sessions: Number(nightSessions) || 0,
    five_star_streak: Number(streak) || 0,
    attendance_pct: consistency === "YES" ? 100 : 0
  };
  const orgItems = category === "Flexi-Fixed" && Number(orgWorkPay) > 0
    ? [{ amount: Number(orgWorkPay) }]
    : [];

  const pay = computeMonthlyPay(syntheticCoach, syntheticMonth, { hbScore: numericScore }, [], vConfig, orgItems);
  const penaltyTotal = Number(penalties) || 0;
  const grossPay = Math.round((pay.grossPay - penaltyTotal) * 100) / 100;

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
      type="number" min="0" max={max}
      className="calc-input"
      value={value}
      onChange={(e) => { setter(e.target.value); onSeedChange?.(); }}
    />
  );

  return (
    <div className="pay-calc-grid">
      <div className="pay-calc-col">
        <div className="calc-section-title calc-section-input">Input Parameters <span>Fill these cells only</span></div>
        <table className="data-table calc-table">
          <tbody>
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
                {variants.map(v => <option key={v.id} value={v.id}>{v.id} — {v.name} ({v.audience})</option>)}
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
            {inputRow("Org Work Pay This Month (₹)", num(orgWorkPay, setOrgWorkPay), "Flexi-Fixed only")}
            {inputRow("Total Penalty Deductions (₹)", num(penalties, setPenalties))}
            {category !== "Flexi" && inputRow("Base / Fixed Pay Override (₹)", (
              <input type="number" min="0" className="calc-input" value={baseOverride} placeholder={`Std ${rupees(category === 'Fixed' ? rates.std_fixed : rates.min_fixed)}`} onChange={(e) => setBaseOverride(e.target.value)} />
            ), "leave blank to use the band rate")}
          </tbody>
        </table>
      </div>

      <div className="pay-calc-col">
        <div className="calc-section-title calc-section-output">Computed Pay Breakdown <span>{band.label}</span></div>
        <table className="data-table calc-table">
          <tbody>
            {outputRow("Per-Session Rate (₹)", rupees(pay.perSessionRate))}
            {outputRow("Session Threshold", rates.threshold ?? (category === 'Fixed' ? (vConfig.discipline === 'Yoga' ? 117 : 156) : 96))}
            {outputRow("Base / Fixed Pay (₹)", rupees(pay.basePay))}
            {outputRow("Extra Sessions (beyond threshold)", pay.extraSessions)}
            {outputRow("Extra Session Pay (₹)", rupees(pay.extraSessionPay))}
            {outputRow("Per-Session Pay (₹)", rupees(pay.sessionPay), "Flexi / Flexi-Fixed")}
            {outputRow("Night Session Premium (₹)", rupees(pay.nightSessionPay), "₹60/session, Flexi & Flexi-Fixed only")}
            {outputRow("Milestone Incentive (₹)", rupees(pay.milestoneIncentive))}
            {outputRow("Consistency Bonus (₹)", rupees(pay.consistencyBonus))}
            {outputRow("5-Star Streak Bonus (₹)", rupees(pay.streakBonusPay), `₹${vConfig.id === 'V3' ? 500 : 200} per ${vConfig.id === 'V3' ? 15 : 10} consecutive`)}
            {outputRow("Org Work Pay (₹)", rupees(pay.orgWorkPay), "Flexi-Fixed only")}
            {outputRow("Penalty Deductions (₹)", `− ${rupees(penaltyTotal)}`)}
            {outputRow("Gross Monthly Pay (₹)", rupees(grossPay), null, true)}
          </tbody>
        </table>
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
        <div className="card-header-row"><h3>Organizational Work Pay <span className="text-muted">(Flexi-Fixed only)</span></h3></div>
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

export default function App() {
  // App States
  const [variants, setVariants] = useState([]);
  const [certifications, setCertifications] = useState([]);
  const [coaches, setCoaches] = useState([]);
  const [historicMonths, setHistoricMonths] = useState([]);
  const [currentMonth, setCurrentMonth] = useState([]);
  const [orgWork, setOrgWork] = useState([]);
  const [violations, setViolations] = useState([]);
  const [appeals, setAppeals] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [payrollLocked, setPayrollLocked] = useState(false);
  const [isStateLoaded, setIsStateLoaded] = useState(false);

  // View & Context Navigation
  const [currentRole, setCurrentRole] = useState("Super Admin");
  const [currentCoachContext, setCurrentCoachContext] = useState("");
  const [currentRmContext, setCurrentRmContext] = useState("RM_01");
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
  const [scoreDraft, setScoreDraft] = useState({});
  // Dynamic columns the user has explicitly confirmed they want to hand-enter.
  const [unlockedDynamicKeys, setUnlockedDynamicKeys] = useState([]);

  const [scoreSearch, setScoreSearch] = useState("");
  const [scoreMonthFilter, setScoreMonthFilter] = useState("All");
  const [scoreCategoryFilter, setScoreCategoryFilter] = useState("All");
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

  // Load state from localStorage on mount
  useEffect(() => {
    const cached = localStorage.getItem('hb_remuneration_state');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        setVariants(parsed.variants || []);
        setCertifications(parsed.certifications || []);
        setCoaches(parsed.coaches || []);

        // Backfill seed score records the cached state predates (e.g. the full
        // May 2026 sheet), without discarding anything the user has entered.
        const cachedHistoric = parsed.historicMonths || [];
        const cachedKeys = new Set(cachedHistoric.map(r => `${r.coach_id}|${r.period_month}`));
        const missingSeed = INITIAL_HISTORIC_MONTHS.filter(r => !cachedKeys.has(`${r.coach_id}|${r.period_month}`));
        setHistoricMonths([...cachedHistoric, ...missingSeed]);
        setCurrentMonth(parsed.currentMonth || []);
        setOrgWork(parsed.orgWork || []);
        setViolations(parsed.violations || []);
        setAppeals(parsed.appeals || []);
        setAuditLog(parsed.auditLog || []);
        setPayrollLocked(parsed.payrollLocked || false);
        
        if (parsed.coaches?.length > 0) {
          setCurrentCoachContext(parsed.coaches[0].id);
        }
      } catch (e) {
        console.error("Failed to parse cached state, resetting to seed", e);
        resetToSeed();
      }
    } else {
      resetToSeed();
    }
    setIsStateLoaded(true);
  }, []);

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
    const rolledIntoHistory = [
      ...currentMonth,
      ...closed.flatMap(period => activeCoaches.map(c => blankPeriodRecord(c.id, period)))
    ];

    setHistoricMonths(prev => [...prev, ...rolledIntoHistory]);
    setCurrentMonth(activeCoaches.map(c => blankPeriodRecord(c.id, livePeriod)));
    setPayrollLocked(false);

    const opened = closed.length + 1;
    logAudit(
      "Period Rolled Over",
      `Calendar advanced past ${openPeriod.period_month}. Opened ${livePeriod.period_month} (${opened} period${opened > 1 ? 's' : ''} created) with blank score cards for ${activeCoaches.length} active coaches.`
    );
    showToast(`New performance period opened: ${livePeriod.period_month}.`, "info");
  }, [isStateLoaded, coaches.length]);

  // Save state to localStorage when values change (except initial load empty states)
  useEffect(() => {
    if (isStateLoaded) {
      const STATE = {
        variants,
        certifications,
        coaches,
        historicMonths,
        currentMonth,
        orgWork,
        violations,
        appeals,
        auditLog,
        payrollLocked
      };
      localStorage.setItem('hb_remuneration_state', JSON.stringify(STATE));
    }
  }, [variants, certifications, coaches, historicMonths, currentMonth, orgWork, violations, appeals, auditLog, payrollLocked, isStateLoaded]);

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

  // Seed Reset
  const resetToSeed = () => {
    setVariants(JSON.parse(JSON.stringify(INITIAL_VARIANTS)));
    setCertifications(JSON.parse(JSON.stringify(INITIAL_CERTIFICATIONS)));
    setCoaches(JSON.parse(JSON.stringify(INITIAL_COACHES)));
    setHistoricMonths(JSON.parse(JSON.stringify(INITIAL_HISTORIC_MONTHS)));
    setCurrentMonth(JSON.parse(JSON.stringify(INITIAL_CURRENT_MONTH)));
    setOrgWork(JSON.parse(JSON.stringify(INITIAL_ORG_WORK)));
    setViolations(JSON.parse(JSON.stringify(INITIAL_VIOLATIONS)));
    setAppeals([]);
    setPayrollLocked(false);

    const initialLog = [
      {
        id: "AUD_SEED",
        timestamp: new Date().toLocaleString('en-IN'),
        actor: "System",
        action: "Database Reseed",
        details: "Application databases reset to initial frameworks.",
        ip: "127.0.0.1",
        userAgent: "Server Engine"
      }
    ];
    setAuditLog(initialLog);
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

  // Open Log Violation Modal
  const handleOpenViolationModal = (coachId = "") => {
    const firstCoach = coachId || (coaches.length > 0 ? coaches[0].id : "");
    setVioCoachId(firstCoach);
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

  // Open Payslip Modal
  const handleOpenPayslipModal = (coachId, period) => {
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
    setNewCoachErrors({});
  };

  // Score Management: open one period's row for editing, seeded from the record
  // plus the coach's one-time profile entries.
  const beginScoreRowEdit = (coach, run) => {
    setEditingScorePeriod(run.period_month);
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
      exp_doc: coach.freelance_past_exp_with_document ?? 0,
      exp_nodoc: coach.freelance_past_exp_without_document ?? 0,
      exp_non_coach_years: coach.non_coaching_exp_years ?? 0,
      edu_raw: coach.education_score_override !== undefined
        ? coach.education_score_override
        : getEducationScore(coach.education_qualification, coach.education_type),
      overrides: { ...(run.overrides || {}) }
    });
    // Cells already carrying an override stay open; the rest re-lock.
    setUnlockedDynamicKeys(Object.keys(run.overrides || {}));
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
    setScoreDraft(prev => ({ ...prev, overrides: {} }));
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

  const cancelScoreRowEdit = () => {
    setEditingScorePeriod(null);
    setScoreDraft({});
    setUnlockedDynamicKeys([]);
  };

  // Apply a draft: monthly fields to the period record, one-time fields to the coach.
  const saveScoreRowEdit = (coach, run) => {
    const vCfg = variants.find(v => v.id === coach.variant_id);
    const overrides = scoreDraft.overrides || {};
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
      showToast(`Cannot save — ${invalid.map(c => c.label).join(', ')} ${invalid.length > 1 ? 'are' : 'is'} out of range.`, "danger");
      return;
    }

    if (overriddenCols.length > 0) {
      const list = overriddenCols.map(c => `• ${c.label}: ${overrides[c.key]}`).join('\n');
      const proceed = window.confirm(
        `${overriddenCols.length} calculated cell${overriddenCols.length > 1 ? 's are' : ' is'} being replaced by a hand-entered value on ${run.period_month}:\n\n${list}\n\n` +
        `These will stop following the calculation until you reset them. Save anyway?`
      );
      if (!proceed) return;
    }

    const scheduled = Number(scoreDraft.meetings_scheduled) || 0;
    const attended = Math.min(Number(scoreDraft.meetings_attended) || 0, scheduled);
    const attendancePct = scheduled > 0 ? (attended / scheduled) * 100 : 0;

    const updatedRecord = {
      ...run,
      prof_appearance: Number(scoreDraft.prof_appearance) || 0,
      client_engagement: Number(scoreDraft.client_engagement) || 0,
      safety: Number(scoreDraft.safety) || 0,
      punctuality: Number(scoreDraft.punctuality) || 0,
      team_conduct: Number(scoreDraft.team_conduct) || 0,
      communication: Number(scoreDraft.communication) || 0,
      meetings_scheduled: scheduled,
      meetings_attended: attended,
      attendance_pct: Math.round(attendancePct * 100) / 100,
      sessions_completed: Number(scoreDraft.sessions) || 0,
      night_sessions: Number(scoreDraft.night_sessions) || 0,
      five_star_streak: Number(scoreDraft.streak) || 0,
      overrides: { ...(scoreDraft.overrides || {}) }
    };

    const updatedCoach = {
      ...coach,
      freelance_past_exp_with_document: Number(scoreDraft.exp_doc) || 0,
      freelance_past_exp_without_document: Number(scoreDraft.exp_nodoc) || 0,
      non_coaching_exp_years: Number(scoreDraft.exp_non_coach_years) || 0,
      education_score_override: Number(scoreDraft.edu_raw) || 0
    };

    // Re-score the period with the new inputs so the stored total stays in step.
    // A hand-entered HB+ Score wins; any other override is re-applied on read.
    const vConfig = variants.find(v => v.id === coach.variant_id);
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

    const overrideCount = Object.keys(updatedRecord.overrides).length;
    logAudit("Score Card Edited", `Updated ${run.period_month} score card for ${coach.name} (${coach.id}) — HB+ Score now ${finalScore}${overrideCount ? `, ${overrideCount} manual override(s)` : ''}`);
    showToast(`${run.period_month} score card saved. HB+ Score: ${finalScore}`);
    cancelScoreRowEdit();
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

    const newCoach = {
      ...NEW_COACH_DEFAULTS,
      id: newId,
      name: newCoachName.trim(),
      email: newCoachEmail.trim(),
      gender: newCoachGender,
      coach_type: newCoachType,
      coach_category: newCoachCategory,
      variant_id: typeConfig.variant_id,
      reporting_manager_id: typeConfig.reporting_manager_id
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

  const handleAddCertification = () => {
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

    const coach = coaches.find(c => c.id === selectedCoachId);
    const vConfig = variants.find(v => v.id === coach.variant_id);

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
    const occurrence = getViolationOccurrenceNumber(vioCoachId, vioType, vioDate, violations) + 1;
    const consequenceObj = getPenaltyConsequence(coach.variant_id, vioType, occurrence, PENALTY_MATRIX);

    let finalAmount = consequenceObj.amount;
    if (consequenceObj.consequence.includes("Deduct") && consequenceObj.consequence.includes("Session")) {
      const activeE = currentMonth.find(cm => cm.coach_id === vioCoachId);
      const score = activeE ? (activeE.hb_score || 50) : 50;
      const band = getPerformanceBand(score).label;
      const vConfig = variants.find(v => v.id === coach.variant_id);
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
          const vConfig = variants.find(v => v.id === coach.variant_id);

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
    let min = 3000, max = 4000;
    if (owWorkType === "Hiring Support") { min = 1500; max = 2500; }
    else if (owWorkType.includes("Course Development") || owWorkType.includes("Mentoring")) { min = 3500; max = 5500; }
    
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

        const vConfig = variants.find(v => v.id === coach.variant_id);
        if (!vConfig) return null;

        const inPeriod = violations.filter(v =>
          v.coach_id === coach.id &&
          v.status !== 'Appeal_Approved' &&
          new Date(v.incident_date) >= new Date(record.period_start) &&
          new Date(v.incident_date) <= new Date(record.period_end)
        );
        const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === record.period_month && o.status === 'Approved');

        const calc = computeHBPlusScore(coach, record, vConfig);
        const hbScore = record.hb_score !== undefined ? record.hb_score : calc.hbScore;
        const band = record.band || getPerformanceBand(hbScore).label;
        const pay = computeMonthlyPay(coach, record, { hbScore }, inPeriod, vConfig, coachOrgWork);
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
          category: coach.internal_designation || 'Coach',
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
          core: calc.breakdown.coreScore,
          org: calc.breakdown.tenureScore,
          attendance: calc.breakdown.attendanceScore,
          hb_score: hbScore,
          band,
          coach_type: coach.coach_type || (vConfig ? (vConfig.discipline === 'S&C' ? 'Strength' : vConfig.discipline) : 'Strength'),
          sessions: Number(record.sessions_completed) || 0,
          threshold,
          extra_sessions: pay.extraSessions,
          late_count: inPeriod.filter(v => v.type && v.type.includes('Late Arrival')).length,
          noshow_count: inPeriod.filter(v => v.type && v.type.includes('No-Show')).length,
          milestone: pay.milestoneIncentive,
          consistency: pay.consistencyBonus,
          streak: Number(record.five_star_streak) || 0
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

  const handleExportScoreTracker = () => {
    const rows = buildScoreTrackerRows();
    const header = SCORE_TRACKER_COLUMNS.map(c => `"${c.label}"`).join(",");
    const body = rows.map(row => SCORE_TRACKER_COLUMNS.map(c => `"${row[c.key]}"`).join(",")).join("\n");

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
      const vConfig = variants.find(v => v.id === coach.variant_id);
      if (!vConfig) return null;

      const { score, band } = resolvePeriodScore(coach, record, vConfig);
      const periodVios = violations.filter(v =>
        v.coach_id === coach.id &&
        v.status !== 'Appeal_Approved' &&
        new Date(v.incident_date) >= new Date(record.period_start) &&
        new Date(v.incident_date) <= new Date(record.period_end)
      );
      const periodOrgWork = orgWork.filter(o =>
        o.coach_id === coach.id && o.period_month === periodMonth && o.status === 'Approved'
      );
      const pay = computeMonthlyPay(coach, record, { hbScore: score }, periodVios, vConfig, periodOrgWork);

      return {
        coach, record, vConfig, score, band, pay,
        recorded: MANUAL_PERIOD_FIELDS.some(f => record[f] !== null && record[f] !== undefined)
      };
    }).filter(Boolean).sort((a, b) => a.coach.id.localeCompare(b.coach.id));
  };

  const handleExportPayrollRun = (periodMonth) => {
    const rows = buildPayrollRun(periodMonth);
    const header = ["Coach ID", "Coach Name", "Category", "HB+ Score", "Band", "Per-Session Rate",
      "Base Pay", "Extra Sessions", "Extra Session Pay", "Session Pay", "Night Premium",
      "Milestone", "Consistency", "Streak Bonus", "Org Work", "Deductions", "Gross Pay"];
    const body = rows.map(r => [
      r.coach.id, r.coach.name, r.coach.coach_category, r.score, r.band, r.pay.perSessionRate,
      r.pay.basePay, r.pay.extraSessions, r.pay.extraSessionPay, r.pay.sessionPay, r.pay.nightSessionPay,
      r.pay.milestoneIncentive, r.pay.consistencyBonus, r.pay.streakBonusPay, r.pay.orgWorkPay,
      r.pay.penaltyDeductions, r.pay.grossPay
    ].map(v => `"${v}"`).join(","));

    const encodedUri = encodeURI(`data:text/csv;charset=utf-8,${header.map(h => `"${h}"`).join(",")}\n${body.join("\n")}`);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `HB_Payroll_Run_${periodMonth.replace(' ', '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    logAudit("Payroll Run Exported", `Exported the ${periodMonth} payroll run (${rows.length} coaches) to CSV`);
    showToast(`${periodMonth} payroll run downloaded.`);
  };

  // Export CSV
  const handleExportCSV = () => {
    const dataset = payrollMonthFilter === currentPeriodMonth ? currentMonth : historicMonths;
    let csvContent = "data:text/csv;charset=utf-8,Coach ID,Name,Category,HB+ Score,Band,Base Pay,Session Pay,Incentives,Deductions,Gross Pay,Status\n";

    dataset.forEach(e => {
      const coach = coaches.find(c => c.id === e.coach_id);
      if (!coach) return;
      const matchesV = matchesCoachType(coach, payrollVariantFilter);
      if (!matchesV) return;

      const vConfig = variants.find(v => v.id === coach.variant_id);
      const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
      const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

      const calcScoreObj = e.hb_score !== undefined ? e : computeHBPlusScore(coach, e, vConfig);
      const pay = computeMonthlyPay(coach, e, calcScoreObj, activeVio, vConfig, coachOrgWork);

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

  // Switch Active role context handler
  const handleRoleSelectChange = (role) => {
    setCurrentRole(role);
    if (role === "Coach" && coaches.length > 0 && !currentCoachContext) {
      setCurrentCoachContext(coaches[0].id);
    }
    
    // Auto redirection if the active view is blocked for this role
    const items = [
      { view: "dashboard", roles: null },
      { view: "coaches", roles: "Super Admin,HR Manager,Auditor" },
      { view: "score-tracker", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Auditor" },
      { view: "pay-calculator", roles: "Super Admin,HR Manager,Finance,Auditor" },
      { view: "evaluations", roles: "Super Admin,HR Manager,Reporting Manager,Operations,Auditor" },
      { view: "violations", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Auditor" },
      { view: "payroll", roles: "Super Admin,HR Manager,Finance,Auditor" },
      { view: "appeals", roles: "Super Admin,HR Manager,Reporting Manager,Coach,Auditor" },
      { view: "settings", roles: "Super Admin,HR Manager" },
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
    return <div style={{ background: '#0b0f19', color: '#fff', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>Loading Remuneration Workspace...</div>;
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
            {verifyAccess("Super Admin,HR Manager,Auditor") && (
              <li className={`nav-item ${activeView === 'coaches' ? 'active' : ''}`} onClick={() => handleNavClick('coaches', "Super Admin,HR Manager,Auditor")}>
                <a href="#coaches"><i className="bx bxs-group nav-icon"></i><span>Coach Master</span></a>
              </li>
            )}
            {isViewEnabled('score-tracker') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Auditor") && (
              <li className={`nav-item ${activeView === 'score-tracker' ? 'active' : ''}`} onClick={() => handleNavClick('score-tracker', "Super Admin,HR Manager,Reporting Manager,Finance,Auditor")}>
                <a href="#score-tracker"><i className="bx bxs-spreadsheet nav-icon"></i><span>Score Tracker</span></a>
              </li>
            )}
            {isViewEnabled('pay-calculator') && verifyAccess("Super Admin,HR Manager,Finance,Auditor") && (
              <li className={`nav-item ${activeView === 'pay-calculator' ? 'active' : ''}`} onClick={() => handleNavClick('pay-calculator', "Super Admin,HR Manager,Finance,Auditor")}>
                <a href="#pay-calculator"><i className="bx bxs-calculator nav-icon"></i><span>Payroll Calculator</span></a>
              </li>
            )}
            {isViewEnabled('evaluations') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Operations,Auditor") && (
              <li className={`nav-item ${activeView === 'evaluations' ? 'active' : ''}`} onClick={() => handleNavClick('evaluations', "Super Admin,HR Manager,Reporting Manager,Operations,Auditor")}>
                <a href="#evaluations"><i className="bx bxs-medal nav-icon"></i><span>Evaluations</span></a>
              </li>
            )}
            {isViewEnabled('violations') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Auditor") && (
              <li className={`nav-item ${activeView === 'violations' ? 'active' : ''}`} onClick={() => handleNavClick('violations', "Super Admin,HR Manager,Reporting Manager,Finance,Auditor")}>
                <a href="#violations"><i className="bx bxs-error-circle nav-icon"></i><span>Violation Register</span></a>
              </li>
            )}
            {isViewEnabled('payroll') && verifyAccess("Super Admin,HR Manager,Finance,Auditor") && (
              <li className={`nav-item ${activeView === 'payroll' ? 'active' : ''}`} onClick={() => handleNavClick('payroll', "Super Admin,HR Manager,Finance,Auditor")}>
                <a href="#payroll"><i className="bx bx-rupee nav-icon"></i><span>Payroll &amp; Incentives</span></a>
              </li>
            )}
            {isViewEnabled('appeals') && verifyAccess("Super Admin,HR Manager,Reporting Manager,Coach,Auditor") && (
              <li className={`nav-item ${activeView === 'appeals' ? 'active' : ''}`} onClick={() => handleNavClick('appeals', "Super Admin,HR Manager,Reporting Manager,Coach,Auditor")}>
                <a href="#appeals"><i className="bx bxs-conversation nav-icon"></i><span>Appeals Panel</span></a>
              </li>
            )}
            {isViewEnabled('settings') && verifyAccess("Super Admin,HR Manager") && (
              <li className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => handleNavClick('settings', "Super Admin,HR Manager")}>
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
                          currentRole === "Operations" ? "linear-gradient(135deg, var(--accent-amber), var(--accent-teal))" :
                          currentRole === "Reporting Manager" ? "linear-gradient(135deg, var(--accent-blue), var(--accent-teal))" :
                          "linear-gradient(135deg, var(--accent-teal), var(--accent-amber))"
            }}>
              {currentRole === "Super Admin" ? "SA" :
               currentRole === "HR Manager" ? "HR" :
               currentRole === "Finance" ? "FN" :
               currentRole === "Operations" ? "OP" :
               currentRole === "Reporting Manager" ? "RM" :
               (currentSelectedCoach ? currentSelectedCoach.name.substring(0, 2).toUpperCase() : "CH")}
            </div>
            <div className="user-details">
              <h4 id="user-display-name">
                {currentRole === "Super Admin" ? "Super Admin" :
                 currentRole === "HR Manager" ? "HR Manager" :
                 currentRole === "Finance" ? "Finance Officer" :
                 currentRole === "Operations" ? "SRS Scheduler" :
                 currentRole === "Reporting Manager" ? 
                   (currentRmContext === "RM_01" ? "S&C RM (Lead)" : currentRmContext === "RM_02" ? "Yoga RM (Lead)" : "HOP RM (Lead)") :
                 (currentSelectedCoach ? currentSelectedCoach.name : "Coach Profile")}
              </h4>
              <span id="user-display-role">
                {currentRole === "Super Admin" ? "System Root" :
                 currentRole === "HR Manager" ? "HR Department" :
                 currentRole === "Finance" ? "Accounts & Payroll" :
                 currentRole === "Operations" ? "Operations Team" :
                 currentRole === "Reporting Manager" ? "Reporting Manager" :
                 `Coach ID: ${currentCoachContext}`}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="main-content">
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
              <label htmlFor="role-select"><i className="bx bxs-user-badge"></i> View Role</label>
              <select id="role-select" className="header-select" value={currentRole} onChange={(e) => handleRoleSelectChange(e.target.value)}>
                <option value="Super Admin">Super Admin</option>
                <option value="HR Manager">HR Manager</option>
                <option value="Reporting Manager">Reporting Manager</option>
                <option value="Finance">Finance / Payroll</option>
                <option value="Operations">Operations / SRS</option>
                <option value="Coach">Coach (Self-Service)</option>
              </select>
            </div>

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
                    <div className="stat-card stat-red">
                      <div className="stat-icon"><i className="bx bxs-error-circle"></i></div>
                      <div className="stat-info">
                        <h3>Risk Watchlist</h3>
                        <h2>{
                          coaches.filter(c => {
                            const combined = [...historicMonths, ...currentMonth]
                              .filter(e => e.coach_id === c.id && e.status !== "DRAFT")
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
                            const hist = [...historicMonths, ...currentMonth]
                              .filter(e => e.coach_id === c.id && e.status !== "DRAFT")
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
                        const vConfig = variants.find(v => v.id === coach.variant_id);
                        const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(m.period_start) && new Date(v.incident_date) <= new Date(m.period_end));
                        const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === m.period_month && o.status === 'Approved');

                        const calc = m.hb_score !== undefined ? m : computeHBPlusScore(coach, m, vConfig);
                        const pay = computeMonthlyPay(coach, m, calc, activeVio, vConfig, coachOrgWork);

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
                            const vConfig = variants.find(v => v.id === c.variant_id);
                            
                            let currScoreLabel = "Not Evaluated";
                            let statusBadge = <span className="badge badge-warning">Pending Input</span>;
                            
                            if (curr && curr.status !== 'DRAFT') {
                              const score = curr.hb_score !== undefined ? curr.hb_score : computeHBPlusScore(c, curr, vConfig).hbScore;
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
                                <td>{hist ? `${hist.hb_score.toFixed(2)} (${hist.band})` : 'N/A'}</td>
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

              {/* Operations Dashboard View */}
              {currentRole === "Operations" && (
                <div className="card grid-span-12" style={{ textAlign: 'center', padding: '3rem' }}>
                  <i className="bx bx-calendar-check text-teal" style={{ fontSize: '3.5rem', marginBottom: '1rem' }}></i>
                  <h2>Operations Floor Portal (SRS Scheduling)</h2>
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

                const vConfig = variants.find(v => v.id === currentSelectedCoach.variant_id);
                const histList = historicMonths.filter(h => h.coach_id === currentSelectedCoach.id);
                const curr = currentMonth.find(e => e.coach_id === currentSelectedCoach.id);
                
                let finalScore = 0, finalBand = "0-30 Non-Functional", isDraft = true, attendance = 0, sessions = 0;
                if (curr) {
                  const calcObj = curr.hb_score !== undefined ? curr : computeHBPlusScore(currentSelectedCoach, curr, vConfig);
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
                                const scoreVal = run.hb_score !== undefined
                                  ? run.hb_score
                                  : computeHBPlusScore(currentSelectedCoach, run, vConfig).hbScore;
                                const bandVal = run.band || getPerformanceBand(scoreVal).label;
                                const monthVios = violations.filter(v => v.coach_id === currentSelectedCoach.id && new Date(v.incident_date) >= new Date(run.period_start) && new Date(v.incident_date) <= new Date(run.period_end) && v.status !== 'Appeal_Approved');
                                const coachOrgWork = orgWork.filter(o => o.coach_id === currentSelectedCoach.id && o.period_month === run.period_month && o.status === 'Approved');
                                const pay = computeMonthlyPay(currentSelectedCoach, run, { hbScore: scoreVal }, monthVios, vConfig, coachOrgWork);
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

            const vConfig = variants.find(v => v.id === coach.variant_id);
            const histList = historicMonths.filter(h => h.coach_id === coach.id);
            const curr = currentMonth.find(e => e.coach_id === coach.id);

            let finalScore = 0, finalBand = "0-30 Non-Functional", isDraft = true, attendance = 0, sessions = 0;
            if (curr) {
              const calcObj = curr.hb_score !== undefined ? curr : computeHBPlusScore(coach, curr, vConfig);
              finalScore = calcObj.hbScore ?? calcObj.hb_score ?? 0;
              finalBand = getPerformanceBand(finalScore).label;
              isDraft = curr.status === 'DRAFT';
              attendance = curr.attendance_pct;
              sessions = curr.sessions_completed;
            }

            const coachVios = violations.filter(v => v.coach_id === coach.id);
            const activeVio = coachVios.filter(v => v.status !== 'Appeal_Approved');
            const allRuns = [...histList, curr].filter(Boolean);
            const canManage = currentRole === "Super Admin" || currentRole === "HR Manager";

            // One row per evaluated period. Takes the coach/record pair so an
            // in-progress edit can be re-scored live from the draft values.
            const fmtDay = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
            const buildScoreRow = (coachObj, run) => {
              const periodCalc = computeHBPlusScore(coachObj, run, vConfig);
              const isEdited = editingScorePeriod === run.period_month;
              const periodScore = (!isEdited && run.hb_score !== undefined) ? run.hb_score : periodCalc.hbScore;
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
              const hasOverride = OVERRIDABLE_KEYS.some(k => ov[k] !== undefined && ov[k] !== null);
              const storedScore = (!isEdited && !hasOverride && run.hb_score !== undefined) ? run.hb_score : summed;
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
                extra_sessions: Math.max(0, periodSessions - finalThreshold),
                violations: coachVios.filter(v =>
                  v.status !== 'Appeal_Approved' &&
                  new Date(v.incident_date) >= new Date(run.period_start) &&
                  new Date(v.incident_date) <= new Date(run.period_end)
                ).length
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

            const scoreCellValue = (col, row) => {
              const value = row[col.key];
              if (value === null || value === undefined) return '—';
              if (col.decimals !== undefined) return Number(value).toFixed(col.decimals);
              return value;
            };

            let statusClass = "badge-muted";
            if (coach.status === "Active") statusClass = "badge-success";
            if (coach.status === "Suspended") statusClass = "badge-danger";

            const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-IN') : '—';
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
                      <h2>{isDraft ? "Drafting" : finalScore.toFixed(2)}</h2>
                      <p>{isDraft ? "Evaluation in progress" : finalBand}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-violet">
                    <div className="stat-icon"><i className="bx bx-calendar-event"></i></div>
                    <div className="stat-info">
                      <h3>Attendance Rate</h3>
                      <h2>{attendance === null || attendance === undefined ? '—' : `${attendance}%`}</h2>
                      <p>Current period</p>
                    </div>
                  </div>
                  <div className="stat-card stat-amber">
                    <div className="stat-icon"><i className="bx bxs-star"></i></div>
                    <div className="stat-info">
                      <h3>Sessions Completed</h3>
                      <h2>{sessions === null || sessions === undefined ? '—' : sessions}</h2>
                      <p>{curr ? curr.period_month : 'No active period'}</p>
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
                    <div className="card-header-row"><h3>Profile</h3></div>
                    <div className="detail-grid">
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
                      {detailRow("Bank Account", coach.bank_account)}
                      {detailRow("Status", coach.status)}
                    </div>
                  </div>

                  <div className="card grid-span-6">
                    <div className="card-header-row"><h3>Experience &amp; Education</h3></div>
                    <div className="detail-grid">
                      {detailRow("Coaching Exp (Documented)", `${coach.freelance_past_exp_with_document ?? 0} yrs`)}
                      {detailRow("Coaching Exp (Undocumented)", `${coach.freelance_past_exp_without_document ?? 0} yrs`)}
                      {detailRow("Non-Coaching Exp", `${coach.non_coaching_exp_years ?? 0} yrs`)}
                      {detailRow("Highest Education", coach.education_qualification)}
                      {detailRow("Education Format", coach.education_type)}
                      {coach.flexi_fixed_base_salary !== undefined && detailRow("Flexi-Fixed Base", `₹${Number(coach.flexi_fixed_base_salary).toLocaleString('en-IN')}`)}
                      {coach.offer_letter_fixed_salary !== undefined && detailRow("Offer Letter Salary", `₹${Number(coach.offer_letter_fixed_salary).toLocaleString('en-IN')}`)}
                    </div>

                    <div className="card-header-row" style={{ marginTop: '1.5rem' }}><h3>Technical Certifications</h3></div>
                    {coach.certifications && coach.certifications.length > 0 ? (
                      <ul className="detail-cert-list">
                        {coach.certifications.map(cert => (
                          <li key={cert.id}>
                            <span><strong>{cert.authority}</strong> — {cert.course_name}</span>
                            <span className="badge badge-info">{cert.score} pts</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-muted" style={{ fontSize: '0.85rem' }}>No certifications recorded for this coach.</p>
                    )}
                  </div>

                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Score Management</h3>
                      {canManage && curr && (
                        <button className="btn btn-primary" onClick={() => handleOpenEvalModal(coach.id)}>
                          <i className="bx bx-edit"></i> Enter / Edit Score Card
                        </button>
                      )}
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
                      <div className="table-container score-tracker-container scorecard-container">
                        <table className="data-table score-tracker-table">
                          <thead>
                            <tr className="group-header-row">
                              {COACH_SCORECARD_GROUPS.map(group => {
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
                              {COACH_SCORECARD_GROUPS.flatMap(group => group.columns.map(col => {
                                const weight = col.weightKeys
                                  ? `${col.weightKeys.reduce((sum, k) => sum + (vConfig.weights[k] || 0), 0)}%`
                                  : col.scale || (col.max && col.max <= 20 ? `Max ${col.max}` : null);
                                return (
                                  <th
                                    key={col.key}
                                    className={[
                                      `group-tint-${group.tone}`,
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
                              <th className="group-tint-slate actions-col">Edit Row</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allRuns.map(run => {
                              const isEditing = editingScorePeriod === run.period_month;
                              const source = isEditing ? draftFor(run) : { coach, run };
                              const row = buildScoreRow(source.coach, source.run);
                              const isLocked = run.status === 'FINANCE_LOCKED';
                              const mayEdit = canManage && (!isLocked || currentRole === 'Super Admin');

                              return (
                                <tr key={run.period_month} className={isEditing ? 'scorecard-editing-row' : ''}>
                                  {COACH_SCORECARD_GROUPS.flatMap(group => group.columns.map(col => {
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
                                    return (
                                      <td
                                        key={col.key}
                                        title={isOverridden ? 'Hand-entered — overrides the calculated value' : undefined}
                                        className={[
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
                                          <span className={`badge ${isLocked ? 'badge-success' : 'badge-warning'}`}>{run.status}</span>
                                        ) : (
                                          scoreCellValue(col, row)
                                        )}
                                      </td>
                                    );
                                  }))}
                                  <td className="actions-col">
                                    {isEditing ? (
                                      <div className="table-btn-group">
                                        <button className="btn btn-primary btn-compact" onClick={() => saveScoreRowEdit(coach, run)}>
                                          <i className="bx bx-check"></i> Save
                                        </button>
                                        {Object.keys(scoreDraft.overrides || {}).length > 0 && (
                                          <button className="btn btn-secondary btn-compact" title="Return every dynamic cell to its calculated value" onClick={clearScoreRowOverrides}>
                                            <i className="bx bx-reset"></i>
                                          </button>
                                        )}
                                        <button className="btn btn-secondary btn-compact" onClick={cancelScoreRowEdit}>
                                          Cancel
                                        </button>
                                      </div>
                                    ) : mayEdit ? (
                                      <button className={`btn btn-compact ${row.isBlank ? 'btn-primary' : 'btn-secondary'}`} onClick={() => beginScoreRowEdit(coach, run)}>
                                        <i className="bx bx-edit"></i> {row.isBlank ? 'Record' : 'Edit'}
                                      </button>
                                    ) : (
                                      <span className="text-muted">{isLocked ? 'Locked' : 'Read-Only'}</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <p className="text-muted scorecard-legend">
                      <span className="entry-tag entry-manual">Manual</span> cells are keyed in — by RM, from the app, or as the coach's one-time entry.
                      <span className="entry-tag entry-derived">Dynamic</span> cells are calculated and update live as you edit.
                      One-time entries sit on the coach profile, so changing them here re-scores every period.
                      Dynamic cells stay locked while a row is open — click one and confirm to take it over; it then becomes a hand-entered override (amber edge) and re-drives everything below it. The reset button returns the row to calculated.
                      A new period opens automatically once the calendar passes the 15th — its dynamic cells fill in at once, its manual cells wait to be recorded.
                    </p>
                  </div>

                  <div className="card grid-span-12">
                    <div className="card-header-row">
                      <h3>Payroll Calculator</h3>
                      <select
                        className="header-select"
                        value={payCalcPeriod || allRuns[allRuns.length - 1]?.period_month || ''}
                        onChange={(e) => setPayCalcPeriod(e.target.value)}
                      >
                        {allRuns.map(r => <option key={r.period_month} value={r.period_month}>{r.period_month}</option>)}
                      </select>
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
                            Seeded from {selected.period_month}'s score card. Change any input to model a different outcome — nothing here writes back to the record.
                          </p>
                          <PayCalculator
                            variants={variants}
                            coachOptions={[coach]}
                            selectedCoachId={coach.id}
                            lockCoach
                            seed={{
                              key: `${coach.id}-${selected.period_month}`,
                              coachName: coach.name,
                              variantId: coach.variant_id,
                              category: coach.coach_category,
                              score: seedRow.hb_score,
                              sessions: Number(selected.sessions_completed) || 0,
                              nightSessions: Number(selected.night_sessions) || 0,
                              streak: Number(selected.five_star_streak) || 0,
                              consistency: (Number(selected.attendance_pct) >= 95 && periodVios.length === 0) ? "YES" : "NO",
                              orgWorkPay: periodOrgWork.reduce((sum, o) => sum + (Number(o.amount) || 0), 0),
                              penalties: periodVios.reduce((sum, v) => sum + (Number(v.penalty_amount) || 0), 0),
                              baseOverride: coach.coach_category === 'Flexi-Fixed'
                                ? (coach.flexi_fixed_base_salary ?? "")
                                : (coach.fixed_salary_override ?? "")
                            }}
                          />
                        </>
                      );
                    })()}
                  </div>

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
                            const scoreVal = run.hb_score !== undefined
                              ? run.hb_score
                              : computeHBPlusScore(coach, run, vConfig).hbScore;
                            const bandVal = run.band || getPerformanceBand(scoreVal).label;
                            const monthVios = coachVios.filter(v => new Date(v.incident_date) >= new Date(run.period_start) && new Date(v.incident_date) <= new Date(run.period_end) && v.status !== 'Appeal_Approved');
                            const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === run.period_month && o.status === 'Approved');
                            const pay = computeMonthlyPay(coach, run, { hbScore: scoreVal }, monthVios, vConfig, coachOrgWork);
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
                      const vConfig = variants.find(v => v.id === c.variant_id);
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
                          <td>{new Date(c.date_of_joining).toLocaleDateString('en-IN')}</td>
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
            const designations = [...new Set(coaches.map(c => c.internal_designation || 'Coach'))].sort();

            const scores = rows.map(r => r.hb_score);
            const avgScore = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
            const best = rows.reduce((acc, r) => (!acc || r.hb_score > acc.hb_score ? r : acc), null);
            const worst = rows.reduce((acc, r) => (!acc || r.hb_score < acc.hb_score ? r : acc), null);
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
                      {designations.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <select value={scoreMonthFilter} onChange={(e) => { setScoreMonthFilter(e.target.value); setScorePage(1); }}>
                      <option value="All">All Months</option>
                      {months.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <button className="btn btn-secondary" onClick={handleExportScoreTracker}>
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
                      <h2>{best ? best.hb_score.toFixed(2) : '—'}</h2>
                      <p>{best ? best.coach_name : 'No records'}</p>
                    </div>
                  </div>
                  <div className="stat-card stat-amber">
                    <div className="stat-icon"><i className="bx bxs-down-arrow-circle"></i></div>
                    <div className="stat-info">
                      <h3>Lowest Score</h3>
                      <h2>{worst ? worst.hb_score.toFixed(2) : '—'}</h2>
                      <p>{worst ? worst.coach_name : 'No records'}</p>
                    </div>
                  </div>
                </div>

                <div className="card score-tracker-card">
                  <div className="table-container score-tracker-container">
                    <table className="data-table score-tracker-table">
                      <thead>
                        <tr className="group-header-row">
                          {SCORE_TRACKER_GROUPS.map(group => {
                            const weight = weightLabel(group.weightKeys);
                            return (
                              <th key={group.key} colSpan={group.columns.length} className={`group-head group-${group.tone}`}>
                                {group.label}{weight && <span className="group-weight">(Weight: {weight})</span>}
                              </th>
                            );
                          })}
                        </tr>
                        <tr className="column-header-row">
                          {SCORE_TRACKER_GROUPS.flatMap(group => group.columns.map(col => {
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
                                {weight && <span className="col-weight">{weight}</span>}
                              </th>
                            );
                          }))}
                        </tr>
                      </thead>
                      <tbody>
                        {pageRows.length === 0 && (
                          <tr>
                            <td colSpan={SCORE_TRACKER_COLUMNS.length} className="text-muted">
                              No score records match the current filters.
                            </td>
                          </tr>
                        )}
                        {pageRows.map(row => (
                          <tr key={row.id} className="row-clickable" title="Open coach page" onClick={() => { setCoachDetailId(row.coach_id); setActiveView('coaches'); }}>
                            {SCORE_TRACKER_GROUPS.flatMap(group => group.columns.map(col => (
                              <td
                                key={col.key}
                                className={[
                                  col.sticky ? `sticky-col sticky-${col.key}` : '',
                                  col.decimals !== undefined || col.money ? 'num-col' : '',
                                  col.emphasis ? `emphasis-col emphasis-${group.tone}` : ''
                                ].join(' ')}
                              >
                                {formatScoreCell(col, row)}
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
            const run = buildPayrollRun(period);
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
                  <div className="table-container score-tracker-container payroll-run-container">
                    <table className="data-table score-tracker-table">
                      <thead>
                        <tr className="group-header-row">
                          <th colSpan={4} className="group-head group-slate">Coach</th>
                          <th colSpan={2} className="group-head group-teal">Score</th>
                          <th colSpan={5} className="group-head group-blue">Session &amp; Base Pay</th>
                          <th colSpan={4} className="group-head group-green">Incentives</th>
                          <th colSpan={2} className="group-head group-red">Deductions &amp; Total</th>
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
                          <th className="group-tint-red num-col">Deductions</th>
                          <th className="group-tint-red num-col emphasis-col">Gross Pay</th>
                        </tr>
                      </thead>
                      <tbody>
                        {run.length === 0 && (
                          <tr><td colSpan={17} className="text-muted">No score records for {period}.</td></tr>
                        )}
                        {run.map(r => (
                          <tr key={r.coach.id} className="row-clickable" title="Open coach page" onClick={() => { setCoachDetailId(r.coach.id); setActiveView('coaches'); }}>
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
                </div>

                <div className="card">
                  <PayCalculator
                    variants={variants}
                    coachOptions={run.map(r => r.coach)}
                    selectedCoachId={payCalcCoachId}
                    onCoachChange={setPayCalcCoachId}
                    seed={selected ? {
                      key: `${selected.coach.id}-${period}`,
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
                      baseOverride: selected.coach.coach_category === 'Flexi-Fixed'
                        ? (selected.coach.flexi_fixed_base_salary ?? "")
                        : (selected.coach.fixed_salary_override ?? "")
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
                    {variants.map(v => <option key={v.id} value={v.id}>Reference: {v.id} — {v.name}</option>)}
                  </select>
                </div>

                <PayReferenceTables vConfig={variants.find(v => v.id === payCalcVariant)} penaltyMatrix={PENALTY_MATRIX} />
              </section>
            );
          })()}

          {/* Evaluations View */}
          {isViewEnabled('evaluations') && activeView === 'evaluations' && (
            <section id="view-evaluations" className="content-view active-view">
              <div className="page-header-row">
                <h2>Performance Evaluations</h2>
                <div className="action-buttons-group">
                  {verifyAccess("Super Admin,Operations") && (
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
                      const vConfig = variants.find(v => v.id === coach.variant_id);
                      const calc = e.hb_score !== undefined ? e : computeHBPlusScore(coach, e, vConfig);
                      const scoreVal = calc.hbScore || calc.hb_score;
                      const bandObj = getPerformanceBand(scoreVal);
                      const coreTotal = e.prof_appearance !== undefined 
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
                      <th>Deduction Amount</th>
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

                  const vConfig = variants.find(v => v.id === coach.variant_id);
                  const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
                  const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

                  const calcScoreObj = e.hb_score !== undefined ? e : computeHBPlusScore(coach, e, vConfig);
                  const pay = computeMonthlyPay(coach, e, calcScoreObj, activeVio, vConfig, coachOrgWork);

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
                          <h3>Total Deductions</h3>
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
                            <th>Deductions</th>
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
                            const vConfig = variants.find(v => v.id === coach.variant_id);
                            const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
                            const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

                            const calcScoreObj = e.hb_score !== undefined ? e : computeHBPlusScore(coach, e, vConfig);
                            const pay = computeMonthlyPay(coach, e, calcScoreObj, activeVio, vConfig, coachOrgWork);

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
                                    {coach.coach_category === 'Flexi-Fixed' && (currentRole === 'Super Admin' || currentRole === 'HR Manager') && (
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

                <div className="card settings-section">
                  <h3>Technical Certifications Master</h3>
                  <p className="subtitle">Assign base scoring values to certificates</p>
                  <div className="settings-scroll-container">
                    <table className="data-table small-table">
                      <thead>
                        <tr>
                          <th>Authority</th>
                          <th>Certification Name</th>
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
                            <td>{c.level}</td>
                            <td><strong>{c.score.toFixed(1)}</strong></td>
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
              </div>
            </section>
          )}

          {/* Audit View */}
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
                      {coaches.map(c => (
                        <option key={c.id} value={c.id}>{c.id} - {c.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Incident Type</label>
                    <select value={vioType} onChange={(e) => setVioType(e.target.value)} required>
                      <option value="Late Arrival (<5 min)">Late Arrival (&lt;5 min)</option>
                      <option value="Late Arrival (>5 min)">Late Arrival (&gt;5 min)</option>
                      <option value="Coach No-Show">Coach No-Show</option>
                      <option value="Unplanned Absence (<4 hrs notice)">Unplanned Absence (&lt;4 hrs notice)</option>
                      <option value="Repeated Roster Violations">Repeated Roster Violations</option>
                      {coach?.variant_id === 'V5' && (
                        <>
                          <option value="Ignoring Roster / WhatsApp Messages">Ignoring Roster / WhatsApp Messages</option>
                          <option value="Declining Session Under Capacity">Declining Session Under Capacity</option>
                          <option value="Not Updating Session Data">Not Updating Session Data</option>
                          <option value="Unprofessional Appearance">Unprofessional Appearance</option>
                          <option value="Coach No-Show — No Communication">Coach No-Show — No Communication</option>
                          <option value="Unauthorised Commitment to Client">Unauthorised Commitment to Client</option>
                          <option value="Collecting Payment Directly from Client">Collecting Payment Directly from Client</option>
                          <option value="Sharing Client Data Externally">Sharing Client Data Externally</option>
                          <option value="Discussion About Internal Matters with Clients">Discussion About Internal Matters with Clients</option>
                          <option value="Posting Content Without Client Consent">Posting Content Without Client Consent</option>
                          <option value="Inappropriate Behaviour / Touching Without Consent">Inappropriate Behaviour / Touching Without Consent</option>
                          <option value="Client Safety Incident Due to Negligence">Client Safety Incident Due to Negligence</option>
                        </>
                      )}
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
                  <p>Deduction Amount: <strong>₹{finalAmount.toLocaleString('en-IN')}</strong></p>
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
      {activeModal === 'payslip-preview' && (() => {
        const coach = coaches.find(c => c.id === selectedCoachId);
        if (!coach) return null;
        
        const vConfig = variants.find(v => v.id === coach.variant_id);
        const dataset = payslipPeriod === currentPeriodMonth ? currentMonth : historicMonths;
        const e = dataset.find(x => x.coach_id === selectedCoachId);
        if (!e) return null;

        const activeVio = violations.filter(v => v.coach_id === coach.id && new Date(v.incident_date) >= new Date(e.period_start) && new Date(v.incident_date) <= new Date(e.period_end) && v.status !== 'Appeal_Approved');
        const coachOrgWork = orgWork.filter(o => o.coach_id === coach.id && o.period_month === e.period_month && o.status === 'Approved');

        const calcScoreObj = e.hb_score !== undefined ? e : computeHBPlusScore(coach, e, vConfig);
        const pay = computeMonthlyPay(coach, e, calcScoreObj, activeVio, vConfig, coachOrgWork);

        const earningsSum = pay.basePay + pay.extraSessionPay + pay.sessionPay + pay.nightSessionPay + pay.milestoneIncentive + 
                            pay.consistencyBonus + pay.streakBonusPay + pay.orgWorkPay + pay.trialIncentive + pay.eventIncentive + 
                            pay.hopOohPremium + pay.hopPtHomePremium + pay.hopPerformanceCreditsPay;

        const uniqueAuditCode = `HB_AUD_${coach.id.replace('+', '')}_${payslipPeriod.replace(' ', '_').toUpperCase()}`;

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
                <div className="payslip-header-grid">
                  <div className="payslip-header-left">
                    <h1>HB+ FITNESS PRIVATE LIMITED</h1>
                    <p>3rd Floor, HSR Plaza, Outer Ring Road, Bengaluru - 560102</p>
                    <p>Official Pay Slip &amp; Performance Earnings Breakdown</p>
                  </div>
                  <div className="payslip-header-right">
                    <h2>PAYSLIP STATEMENT</h2>
                    <span className="text-teal">{payslipPeriod}</span>
                    <small style={{ marginTop: '4px' }}>Audit Code: {uniqueAuditCode}</small>
                  </div>
                </div>

                <table className="payslip-details-table">
                  <tbody>
                    <tr>
                      <td className="label-col">Coach Name</td>
                      <td className="val-col">{coach.name}</td>
                      <td className="label-col">Coach ID</td>
                      <td className="val-col">{coach.id}</td>
                    </tr>
                    <tr>
                      <td className="label-col">Policy Variant</td>
                      <td className="val-col">{vConfig.name}</td>
                      <td className="label-col">Coach Category</td>
                      <td className="val-col">{coach.coach_category}</td>
                    </tr>
                    <tr>
                      <td className="label-col">Designation</td>
                      <td className="val-col">{coach.internal_designation || 'Coach'}</td>
                      <td className="label-col">Assigned Hub</td>
                      <td className="val-col">{coach.assigned_property}</td>
                    </tr>
                    <tr>
                      <td className="label-col">HB+ Score</td>
                      <td className="val-col"><strong>{(calcScoreObj.hbScore || calcScoreObj.hb_score).toFixed(2)}</strong></td>
                      <td className="label-col">Performance Band</td>
                      <td className="val-col">{calcScoreObj.band || getPerformanceBand(calcScoreObj.hbScore || calcScoreObj.hb_score).label}</td>
                    </tr>
                  </tbody>
                </table>

                <div className="payslip-ledger-grid">
                  {/* Earnings */}
                  <div className="payslip-ledger-section">
                    <h3>EARNINGS &amp; REWARDS</h3>
                    <table className="payslip-ledger-table">
                      <tbody>
                        <tr><td>Base Pay ({coach.coach_category})</td><td className="amt">₹{pay.basePay.toFixed(2)}</td></tr>
                        {pay.extraSessionPay > 0 && (
                          <tr><td>Extra Session Payout (x{pay.extraSessions})</td><td className="amt">₹{pay.extraSessionPay.toFixed(2)}</td></tr>
                        )}
                        {pay.sessionPay > 0 && coach.coach_category !== 'Fixed' && (
                          <tr><td>Session Completed Pay (x{e.sessions_completed})</td><td className="amt">₹{pay.sessionPay.toFixed(2)}</td></tr>
                        )}
                        {pay.nightSessionPay > 0 && (
                          <tr><td>Night Shift Premiums (x{e.night_sessions})</td><td className="amt">₹{pay.nightSessionPay.toFixed(2)}</td></tr>
                        )}
                        {pay.milestoneIncentive > 0 && (
                          <tr><td>Milestone Target Reward</td><td className="amt">₹{pay.milestoneIncentive.toFixed(2)}</td></tr>
                        )}
                        {pay.consistencyBonus > 0 && (
                          <tr><td>Roster Consistency Reward</td><td className="amt">₹{pay.consistencyBonus.toFixed(2)}</td></tr>
                        )}
                        {pay.streakBonusPay > 0 && (
                          <tr><td>5-Star Streak Reward</td><td className="amt">₹{pay.streakBonusPay.toFixed(2)}</td></tr>
                        )}
                        {pay.orgWorkPay > 0 && (
                          <tr><td>Organizational Work Pay</td><td className="amt">₹{pay.orgWorkPay.toFixed(2)}</td></tr>
                        )}
                        {pay.trialIncentive > 0 && (
                          <tr><td>Trial Completion Bonus</td><td className="amt">₹{pay.trialIncentive.toFixed(2)}</td></tr>
                        )}
                        {pay.eventIncentive > 0 && (
                          <tr><td>Event Support Bonus</td><td className="amt">₹{pay.eventIncentive.toFixed(2)}</td></tr>
                        )}
                        {pay.hopOohPremium > 0 && (
                          <tr><td>HOP Out-of-Hours Premium</td><td className="amt">₹{pay.hopOohPremium.toFixed(2)}</td></tr>
                        )}
                        {pay.hopPtHomePremium > 0 && (
                          <tr><td>HOP PT &amp; Home Visit Reliability</td><td className="amt">₹{pay.hopPtHomePremium.toFixed(2)}</td></tr>
                        )}
                        {pay.hopPerformanceCreditsPay > 0 && (
                          <tr><td>HOP Performance Credits</td><td className="amt">₹{pay.hopPerformanceCreditsPay.toFixed(2)}</td></tr>
                        )}
                        <tr className="total-row"><td>Gross Additions</td><td className="amt">₹{earningsSum.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Deductions */}
                  <div className="payslip-ledger-section">
                    <h3>DISCIPLINARY DEDUCTIONS</h3>
                    <table className="payslip-ledger-table">
                      <tbody>
                        {activeVio.length === 0 ? (
                          <tr><td className="text-secondary">No payroll deductions recorded.</td><td className="amt">₹0.00</td></tr>
                        ) : (
                          activeVio.map(v => (
                            <tr key={v.id}>
                              <td>Incident: {v.type} ({new Date(v.incident_date).toLocaleDateString('en-IN')})</td>
                              <td className="amt text-red">-₹{v.penalty_amount.toFixed(2)}</td>
                            </tr>
                          ))
                        )}
                        <tr className="total-row"><td>Gross Deductions</td><td className="amt">₹{pay.penaltyDeductions.toFixed(2)}</td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="payslip-net-box">
                  <h2>NET PAYABLE AMOUNT</h2>
                  <h1>₹{pay.grossPay.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</h1>
                </div>

                <div className="payslip-signatures-row">
                  <div className="signature-box">Prepared by Finance Department</div>
                  <div className="signature-box">Approved by HR Director</div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
