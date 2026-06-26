/**
 * HB+ Coach Remuneration & Performance Management - Automated Verification Suite
 */

import { computeHBPlusScore, getPerformanceBand, computeMonthlyPay, getViolationOccurrenceNumber, getPenaltyConsequence } from './src/calculations.js';
import { INITIAL_VARIANTS, INITIAL_CERTIFICATIONS, INITIAL_COACHES, INITIAL_VIOLATIONS, PENALTY_MATRIX } from './src/data.js';

console.log("==================================================");
console.log("  RUNNING HB+ REMUNERATION MATHEMATICAL TESTS     ");
console.log("==================================================");

let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✅ PASS: ${message}`);
  } else {
    console.error(`❌ FAIL: ${message}`);
    testsFailed++;
  }
}

// -------------------------------------------------------------------------
// TEST 1: Variant Isolation (S&C vs Yoga weight difference)
// -------------------------------------------------------------------------
try {
  const v1 = INITIAL_VARIANTS.find(v => v.id === 'V1'); // S&C Internal
  const v3 = INITIAL_VARIANTS.find(v => v.id === 'V3'); // Yoga Internal
  
  const mockCoach = {
    freelance_past_exp_with_document: 0,
    freelance_past_exp_without_document: 0,
    date_of_joining: "2026-06-25", // 0 tenure
    non_coaching_exp_years: 0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india", // 3.0 points
    certifications: [{ score: 8.0 }]
  };
  
  const mockEval = {
    prof_appearance: 16, client_engagement: 16, safety: 12, punctuality: 8, team_conduct: 13, communication: 15, // core 80
    attendance_pct: 90,
    period_end: "2026-06-25"
  };

  const scScore = computeHBPlusScore(mockCoach, mockEval, v1).hbScore;
  const yogaScore = computeHBPlusScore(mockCoach, mockEval, v3).hbScore;

  assert(scScore !== yogaScore, `Variant Isolation: S&C score (${scScore}) should differ from Yoga score (${yogaScore}) under identical parameters.`);
} catch (err) {
  assert(false, `Test 1 Error: ${err.message}`);
}

// -------------------------------------------------------------------------
// TEST 2: Band boundaries (Strict thresholds)
// -------------------------------------------------------------------------
try {
  const b59 = getPerformanceBand(59.99);
  const b60 = getPerformanceBand(60.00);
  
  assert(b59.label.includes("50–60 Stable"), `Band Boundary: 59.99 maps to ${b59.label}`);
  assert(b60.label.includes("60–70 Good"), `Band Boundary: 60.00 maps to ${b60.label}`);
} catch (err) {
  assert(false, `Test 2 Error: ${err.message}`);
}

// -------------------------------------------------------------------------
// TEST 3: Seed Data Calculations validation (All 15 target tracker scores)
// -------------------------------------------------------------------------
try {
  const v1 = INITIAL_VARIANTS.find(v => v.id === 'V1');
  
  const TARGETS = {
    "HB+_023": { target: 53.39, name: "Ankush Chettri", eval: { prof_appearance: 16, client_engagement: 19, safety: 12, punctuality: 6, team_conduct: 10, communication: 10, attendance_pct: 40.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_026": { target: 39.98, name: "Shilpa Singh", eval: { prof_appearance: 16, client_engagement: 19, safety: 12, punctuality: 3, team_conduct: 5, communication: 10, attendance_pct: 0.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_030": { target: 68.00, name: "Hardik Nagpal", eval: { prof_appearance: 18, client_engagement: 19, safety: 14, punctuality: 8, team_conduct: 12, communication: 18, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_048": { target: 59.11, name: "Mousumi Dutta", eval: { prof_appearance: 10, client_engagement: 17, safety: 10, punctuality: 8, team_conduct: 12, communication: 17, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_068": { target: 68.11, name: "Ayesha Tabassum", eval: { prof_appearance: 18, client_engagement: 18, safety: 14, punctuality: 6, team_conduct: 12, communication: 18, attendance_pct: 100.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_070": { target: 59.14, name: "Poonam Gusain", eval: { prof_appearance: 18, client_engagement: 19, safety: 14, punctuality: 6, team_conduct: 10, communication: 10, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_080": { target: 68.46, name: "Ramon Roychowdhury", eval: { prof_appearance: 18, client_engagement: 19, safety: 14, punctuality: 5, team_conduct: 9, communication: 10, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_084": { target: 37.28, name: "Budhaditya Ghosh", eval: { prof_appearance: 15, client_engagement: 17, safety: 12, punctuality: 7, team_conduct: 12, communication: 10, attendance_pct: 0.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_098": { target: 61.79, name: "Chaitra Narendra", eval: { prof_appearance: 18, client_engagement: 17, safety: 13, punctuality: 7, team_conduct: 12, communication: 15, attendance_pct: 100.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_103": { target: 62.03, name: "Sahilpreet singh", eval: { prof_appearance: 18, client_engagement: 18, safety: 18, punctuality: 7, team_conduct: 10, communication: 15, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_093": { target: 48.96, name: "Amlan Gogoi", eval: { prof_appearance: 18, client_engagement: 17, safety: 12, punctuality: 7, team_conduct: 10, communication: 12, attendance_pct: 40.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_115": { target: 63.21, name: "Karthik R", eval: { prof_appearance: 18, client_engagement: 18, safety: 12, punctuality: 8, team_conduct: 12, communication: 18, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_120": { target: 43.08, name: "Rakesh Roshan Chakra", eval: { prof_appearance: 10, client_engagement: 15, safety: 10, punctuality: 8, team_conduct: 8, communication: 15, attendance_pct: 80.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_121": { target: 48.21, name: "Sambit Nag", eval: { prof_appearance: 17, client_engagement: 18, safety: 12, punctuality: 8, team_conduct: 13, communication: 18, attendance_pct: 20.0, period_month: "May 2026", period_end: "2026-05-15" } },
    "HB+_122": { target: 46.18, name: "Shubham Vashist", eval: { prof_appearance: 16, client_engagement: 18, safety: 13, punctuality: 7, team_conduct: 10, communication: 10, attendance_pct: 20.0, period_month: "May 2026", period_end: "2026-05-15" } }
  };

  Object.entries(TARGETS).forEach(([cid, data]) => {
    const coach = INITIAL_COACHES.find(c => c.id === cid);
    const scoreObj = computeHBPlusScore(coach, data.eval, v1);
    const calculated = scoreObj.hbScore;
    const diff = Math.abs(calculated - data.target);
    assert(diff <= 0.5, `Seed Calculation for ${data.name} (${cid}): Calculated = ${calculated}, Target = ${data.target} (diff = ${diff.toFixed(2)})`);
  });
} catch (err) {
  assert(false, `Test 3 Error: ${err.message}`);
}

// -------------------------------------------------------------------------
// TEST 4: Penalty Progression Escalations
// -------------------------------------------------------------------------
try {
  // Let's check V1 Late Arrival (<5 min) fines: 1st=100, 2nd=150, 3rd=200, 4th=250
  const c1 = getPenaltyConsequence("V1", "Late Arrival (<5 min)", 1, PENALTY_MATRIX);
  const c2 = getPenaltyConsequence("V1", "Late Arrival (<5 min)", 2, PENALTY_MATRIX);
  const c3 = getPenaltyConsequence("V1", "Late Arrival (<5 min)", 3, PENALTY_MATRIX);
  const c4 = getPenaltyConsequence("V1", "Late Arrival (<5 min)", 4, PENALTY_MATRIX);

  assert(c1.amount === 100, `Penalty Escalation: 1st Late Arrival (<5m) = ₹${c1.amount}`);
  assert(c2.amount === 150, `Penalty Escalation: 2nd Late Arrival (<5m) = ₹${c2.amount}`);
  assert(c3.amount === 200, `Penalty Escalation: 3rd Late Arrival (<5m) = ₹${c3.amount}`);
  assert(c4.amount === 250, `Penalty Escalation: 4th Late Arrival (<5m) = ₹${c4.amount}`);
} catch (err) {
  assert(false, `Test 4 Error: ${err.message}`);
}

// -------------------------------------------------------------------------
// TEST 5: Milestone Payouts & Consistency Bonuses
// -------------------------------------------------------------------------
try {
  const v1 = INITIAL_VARIANTS.find(v => v.id === 'V1');
  const akash = INITIAL_COACHES.find(c => c.id === 'HB+_023'); // Fixed coach
  
  // 156 sessions milestone = ₹1000
  const eval156 = { sessions_completed: 156, attendance_pct: 95, night_sessions: 0 };
  const pay156 = computeMonthlyPay(akash, eval156, { hbScore: 53.39 }, [], v1);
  assert(pay156.milestoneIncentive === 1000, `Milestones: 156 sessions milestone = ₹${pay156.milestoneIncentive}`);

  // 182 sessions milestone = ₹2000
  const eval182 = { sessions_completed: 182, attendance_pct: 95, night_sessions: 0 };
  const pay182 = computeMonthlyPay(akash, eval182, { hbScore: 53.39 }, [], v1);
  assert(pay182.milestoneIncentive === 2000, `Milestones: 182 sessions milestone = ₹${pay182.milestoneIncentive}`);

  // Consistency bonus validation: 95% attendance, 0 violations, 0 no shows -> ₹500
  assert(pay156.consistencyBonus === 500, `Consistency Bonus: Active at 95% attendance + 0 violations -> ₹${pay156.consistencyBonus}`);
  
  const evalBadAttendance = { sessions_completed: 156, attendance_pct: 92, night_sessions: 0 };
  const payBadAttendance = computeMonthlyPay(akash, evalBadAttendance, { hbScore: 53.39 }, [], v1);
  assert(payBadAttendance.consistencyBonus === 0, `Consistency Bonus: Inactive at 92% attendance -> ₹${payBadAttendance.consistencyBonus}`);
} catch (err) {
  assert(false, `Test 5 Error: ${err.message}`);
}

console.log("==================================================");
if (testsFailed === 0) {
  console.log("  ALL TESTS PASSED SUCCESSFULLY!                 ");
} else {
  console.error(`  ${testsFailed} TEST(S) FAILED. CHECK LOGS.       `);
}
console.log("==================================================");

process.exit(testsFailed === 0 ? 0 : 1);
