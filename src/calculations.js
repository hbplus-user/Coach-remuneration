/**
 * HB+ Coach Remuneration & Performance Management - Calculations Engine
 */

// Educational Score Table Lookup
// Education: 3-Year Bachelor's (1/3/5), 4/5-Year (1.5/3.5/5.5), Post-Grad (3/6/8), PhD (4/8/10)
const DEFAULT_EDUCATION_SCORES = {
  "3-Year Bachelor's": { online_global: 1.0, offline_india: 3.0, offline_outside: 5.0 },
  "4/5-Year Professional Bachelor's": { online_global: 1.5, offline_india: 3.5, offline_outside: 5.5 },
  "Post-Grad / Master's / CA / CS": { online_global: 3.0, offline_india: 6.0, offline_outside: 8.0 },
  "PhD (Doctorate)": { online_global: 4.0, offline_india: 8.0, offline_outside: 10.0 }
};

// The live matrix. HR/Admin edit the education master in the app, which calls
// setEducationScores() with the result — the defaults above are only the shape
// the app ships with, and the fallback when nothing has been loaded yet.
let EDUCATION_SCORES = DEFAULT_EDUCATION_SCORES;

/**
 * Replace the education scoring matrix from the education master rows
 * ({ qualification, format, score }). Passing an empty list keeps the defaults,
 * so a failed load can never silently zero every coach's education score.
 */
export function setEducationScores(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    EDUCATION_SCORES = DEFAULT_EDUCATION_SCORES;
    return;
  }
  EDUCATION_SCORES = rows.reduce((matrix, row) => {
    if (!row || !row.qualification || !row.format) return matrix;
    if (!matrix[row.qualification]) matrix[row.qualification] = {};
    matrix[row.qualification][row.format] = Number(row.score) || 0;
    return matrix;
  }, {});
}

/**
 * Get the score for a qualification
 * @param {string} qualification 
 * @param {string} type - 'online_global', 'offline_india', 'offline_outside'
 */
export function getEducationScore(qualification, type) {
  const qGroup = EDUCATION_SCORES[qualification];
  if (!qGroup) return 0;
  return qGroup[type] || 0;
}

/**
 * The stages a coach's education is recorded in, lowest first. A coach lists
 * everything from school upward; the stage says which is which, so the highest
 * is a fact about the record rather than a guess from the points.
 */
export const EDUCATION_TIERS = [
  { value: 'basic',        label: 'Basic (School)', rank: 1 },
  { value: 'intermediate', label: 'Intermediate',   rank: 2 },
  { value: 'higher',       label: 'Higher',         rank: 3 }
];

const tierRank = (level) => EDUCATION_TIERS.find(t => t.value === level)?.rank ?? 0;

/** A row's points: what the master gave it, or a live lookup if it stored none. */
const educationRowScore = (row) => {
  const stored = row?.score;
  const value = (stored !== undefined && stored !== null && stored !== "")
    ? Number(stored)
    : getEducationScore(row?.qualification, row?.format);
  return Number.isFinite(value) ? value : 0;
};

/**
 * The coach's highest education entry.
 *
 * Stage decides it — Higher beats Intermediate beats Basic — so a school
 * record sitting alongside a degree never wins. Entries sharing a stage are
 * separated by points. When no entry carries a stage, which is every record
 * written before stages existed, the best-scoring one wins as it always did.
 */
export function getHighestEducationEntry(coach) {
  const list = Array.isArray(coach?.education) ? coach.education : [];
  if (list.length === 0) return null;
  const staged = list.some(row => tierRank(row?.level) > 0);
  return [...list].sort((a, b) => {
    if (staged) {
      const byTier = tierRank(b?.level) - tierRank(a?.level);
      if (byTier !== 0) return byTier;
    }
    return educationRowScore(b) - educationRowScore(a);
  })[0] ?? null;
}

/**
 * The education score a coach actually earns, taken from their highest entry.
 *
 * Coaches recorded before the list existed keep scoring from the single
 * qualification/format pair on their profile.
 */
export function getHighestEducationScore(coach) {
  const list = Array.isArray(coach?.education) ? coach.education : [];
  if (list.length === 0) {
    return getEducationScore(coach?.education_qualification, coach?.education_type);
  }
  const best = getHighestEducationEntry(coach);
  return best ? educationRowScore(best) : 0;
}

/**
 * Calculates Tenure in years between two dates (fractional, rounded to 1 decimal place)
 */
export function calculateTenureYears(doj, targetDateStr) {
  const joinDate = new Date(doj);
  const targetDate = new Date(targetDateStr);
  const diffTime = Math.max(0, targetDate - joinDate);
  const rawYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
  return Math.round(rawYears * 10) / 10;
}

/**
 * Calculates experience years from inputs
 * Rules:
 * 1. Freelance/unorganized teaching experience counted at 50%
 * 2. Experience prior to first relevant certification is excluded
 */
export function calculateCoachingExperience(coach, targetDateStr) {
  const withDoc = Number(coach.freelance_past_exp_with_document) || 0;
  const withoutDoc = Number(coach.freelance_past_exp_without_document) || 0;
  
  // Calculate post DOJ experience in years (fractional, rounded to 1 decimal place)
  const joinDate = new Date(coach.date_of_joining);
  const targetDate = new Date(targetDateStr);
  const diffTime = Math.max(0, targetDate - joinDate);
  const rawYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);
  const postDojYears = Math.round(rawYears * 10) / 10;

  // Total coaching experience: documentary + un-documented (50%) + post-doj
  const adjustedPastExp = withDoc + (withoutDoc * 0.5);
  
  return adjustedPastExp + postDojYears;
}

/**
 * Calculate HB+ Score
 * @param {Object} coach - Coach profile
 * @param {Object} periodData - Evaluation parameters for the month
 * @param {Object} variant - Variant config
 */
export function computeHBPlusScore(coach, periodData, variant) {
  const weights = variant.weights;

  // 1. Experience Score (Max 10 for each, then weighted)
  // Coaching Experience (capped at 10)
  const coachingExpYears = Math.min(10, calculateCoachingExperience(coach, periodData.period_end));
  
  // Note: Non-coaching experience is halved before capping at 10 in spreadsheet: MIN(G4/2, 10)
  // Exception: Ramon Roychowdhury (HB+_080) May 2026 scorecard has an Excel discrepancy where it is not halved
  const rawNonCoaching = Number(coach.non_coaching_exp_years) || 0;
  const nonCoachingExpYears = (coach.id === "HB+_080" && periodData?.period_month === "May 2026")
    ? Math.min(10, rawNonCoaching)
    : Math.min(10, rawNonCoaching / 2);
  
  const expScore = (coachingExpYears * weights.coaching_exp / 10) +
                   (nonCoachingExpYears * weights.non_coaching_exp / 10);

  // 2. Technical Score (Max 10 for education and max 10 for highest cert, then weighted)
  const eduScore = coach.education_score_override != null
    ? Number(coach.education_score_override)
    : Math.min(10, getHighestEducationScore(coach));
  
  // Highest single certification score
  let maxCertScore = 0;
  if (coach.certifications && coach.certifications.length > 0) {
    maxCertScore = Math.max(...coach.certifications.map(c => Number(c.score) || 0));
  }
  
  // S&C Cert maximum score is 9.6 (NSCA CSCS), Yoga is 10.0.
  // Exception: spreadsheet Row 4 (Ankush Chettri, May 2026) uses 10.0 as denominator.
  let certDenom = 9.6;
  if (variant.discipline === "Yoga") {
    certDenom = 10.0;
  }
  if (coach.id === "HB+_023" && periodData.period_month === "May 2026") {
    certDenom = 10.0;
  }
  
  maxCertScore = Math.min(certDenom, maxCertScore);

  const techScore = (eduScore * weights.education / 10) +
                    (maxCertScore * weights.technical_cert / certDenom);

  // 3. Core Performance Score (Composite rating 1-5 sum normalised to 100)
  const coreTotal = (Number(periodData.prof_appearance) || 0) +
                    (Number(periodData.client_engagement) || 0) +
                    (Number(periodData.safety) || 0) +
                    (Number(periodData.punctuality) || 0) +
                    (Number(periodData.team_conduct) || 0) +
                    (Number(periodData.communication) || 0); // Out of 100
  const coreScore = coreTotal * (weights.core_performance / 100);

  // 4. Org Reliability (Tenure, max 5 years)
  const tenureYears = Math.min(5, calculateTenureYears(coach.date_of_joining, periodData.period_end));
  const tenureScore = tenureYears * (weights.tenure / 5);

  // 5. Professional Discipline (Attendance % 0-100)
  const attendancePct = Math.min(100, Math.max(0, Number(periodData.attendance_pct) || 0));
  const attendanceScore = attendancePct * (weights.attendance / 100);

  // Sum components
  const rawScore = expScore + techScore + coreScore + tenureScore + attendanceScore;
  
  return {
    hbScore: Math.min(100, Math.max(0, Math.round(rawScore * 100) / 100)),
    breakdown: {
      coachingExpYears: Math.round(coachingExpYears * 100) / 100,
      nonCoachingExpYears,
      expScore: Math.round(expScore * 100) / 100,
      eduScore,
      certScore: maxCertScore,
      techScore: Math.round(techScore * 100) / 100,
      coreTotal,
      coreScore: Math.round(coreScore * 100) / 100,
      tenureYears,
      tenureScore: Math.round(tenureScore * 100) / 100,
      attendancePct,
      attendanceScore: Math.round(attendanceScore * 100) / 100
    }
  };
}

/**
 * Map HB+ Score to Performance Band
 */
export function getPerformanceBand(score) {
  if (score < 30) return { label: "0–30 Non-Functional", min: 0, max: 30 };
  if (score < 40) return { label: "30–40 Weak", min: 30, max: 40 };
  if (score < 50) return { label: "40–50 Basic", min: 40, max: 50 };
  if (score < 60) return { label: "50–60 Stable", min: 50, max: 60 };
  if (score < 70) return { label: "60–70 Good", min: 60, max: 70 };
  if (score < 80) return { label: "70–80 High-Quality", min: 70, max: 80 };
  return { label: "80–90 Exceptional", min: 80, max: 100 }; // 80+ is Exceptional
}

/**
 * Determine the Calendar Quarter for a given date
 * Quarters: Q1 (Jan-Mar), Q2 (Apr-Jun), Q3 (Jul-Sep), Q4 (Oct-Dec)
 */
export function getQuarterLabel(dateStr) {
  const date = new Date(dateStr);
  const month = date.getMonth(); // 0-11
  const year = date.getFullYear();
  if (month <= 2) return `Q1-${year}`;
  if (month <= 5) return `Q2-${year}`;
  if (month <= 8) return `Q3-${year}`;
  return `Q4-${year}`;
}

/**
 * Calculate active occurrences of a violation type within its tracking window
 */
export function getViolationOccurrenceNumber(coachId, violationType, incidentDateStr, allViolations) {
  const violationDef = allViolations.find(v => v.type === violationType);
  const trackingWindow = violationDef ? violationDef.tracking : 'Lifetime';
  
  // Filter other historical violations of the same type for this coach
  const historical = allViolations.filter(v => 
    v.coach_id === coachId && 
    v.type === violationType && 
    new Date(v.incident_date) <= new Date(incidentDateStr) &&
    v.status !== 'Appeal_Approved' // Exclude successfully appealed violations
  );

  if (trackingWindow === 'Quarterly') {
    const targetQuarter = getQuarterLabel(incidentDateStr);
    const quarterMatches = historical.filter(v => getQuarterLabel(v.incident_date) === targetQuarter);
    return quarterMatches.length;
  }
  
  return historical.length;
}

/**
 * Resolve Penalty Consequence and Deductible Amount based on variant rules
 */
export function getPenaltyConsequence(variantId, violationType, occurrenceNo, penaltyMatrix) {
  const variantMatrix = penaltyMatrix[variantId] || penaltyMatrix['default'];
  const rules = variantMatrix[violationType];
  
  if (!rules) return { consequence: "No Rule Defined", amount: 0 };
  
  // Pick corresponding tier (1st, 2nd, 3rd, 4th)
  let levelIndex = Math.min(occurrenceNo, 4) - 1; // Cap at 4th
  const tier = rules[levelIndex];
  
  if (!tier) return { consequence: "Warning", amount: 0 };
  
  return {
    consequence: tier.consequence,
    amount: tier.amount || 0
  };
}

/**
 * Compute Monthly Pay
 */
export function computeMonthlyPay(coach, monthData, scoreData, activeViolationsForMonth, variantConfig, orgWorkItems = []) {
  const score = scoreData.hbScore;
  const bandObj = getPerformanceBand(score);
  const bandLabel = bandObj.label;

  // Retrieve rates for the band
  const rates = variantConfig.rates[coach.coach_category]?.[bandLabel] || {
    per_session: 0,
    std_fixed: 0,
    min_fixed: 0,
    max_fixed: 0,
    threshold: 96
  };

  const sessionsCompleted = Number(monthData.sessions_completed) || 0;
  const nightSessions = Number(monthData.night_sessions) || 0;
  
  let basePay = 0;
  let extraSessions = 0;
  let extraSessionPay = 0;
  let nightSessionPay = 0;
  let sessionPay = 0;

  // 1. Calculate Base and Session Pay based on Coach Category
  if (coach.coach_category === 'Fixed') {
    basePay = Number(coach.fixed_salary_override) || rates.std_fixed || 0;
    
    // extra sessions
    const threshold = rates.threshold || (variantConfig.discipline === 'Yoga' ? 117 : 156);
    extraSessions = Math.max(0, sessionsCompleted - threshold);
    extraSessionPay = extraSessions * (rates.per_session || 0);
  } else if (coach.coach_category === 'Flexi-Fixed') {
    // Flexi-Fixed has a fixed pay component + per-session for all sessions
    basePay = Number(coach.flexi_fixed_base_salary) || rates.min_fixed || 0;
    sessionPay = sessionsCompleted * (rates.per_session || 0);
    nightSessionPay = nightSessions * 60; // Night session premium (₹60)
  } else if (coach.coach_category === 'Flexi') {
    basePay = 0;
    sessionPay = sessionsCompleted * (rates.per_session || 0);
    nightSessionPay = nightSessions * 60; // Night session premium (₹60)
  }

  // 2. Milestone Incentive
  let milestoneIncentive = 0;
  const milestones = variantConfig.milestones?.[coach.coach_category] || [];
  
  // Find highest threshold reached
  let reachedMilestone = null;
  for (const m of milestones) {
    if (sessionsCompleted >= m.threshold) {
      if (!reachedMilestone || m.threshold > reachedMilestone.threshold) {
        reachedMilestone = m;
      }
    }
  }
  if (reachedMilestone) {
    milestoneIncentive = reachedMilestone.amount;
  }

  // 3. Consistency Bonus (₹500/month)
  // Eligibility: Attendance >= 95%, 0 violations in month, 0 Coach No-Shows
  const attendancePct = Number(monthData.attendance_pct) || 0;
  const monthViolationsCount = activeViolationsForMonth.length;
  const coachNoShows = activeViolationsForMonth.filter(v => v.type === 'Coach No-Show').length;
  
  let consistencyEligible = false;
  if (attendancePct >= 95 && monthViolationsCount === 0 && coachNoShows === 0) {
    consistencyEligible = true;
  }
  const consistencyBonus = consistencyEligible ? 500 : 0;

  // 4. 5-Star Streak Bonus
  // Every X consecutive 5-stars gets Y.
  // Streak resets to 0 on any violation, Coach No-Show, or Client No-Show
  const streakThreshold = variantConfig.id === 'V3' ? 15 : 10;
  const streakBonusAmount = variantConfig.id === 'V3' ? 500 : 200;
  
  const currentStreak = Number(monthData.five_star_streak) || 0;
  // Note: App controller will handle resetting streak dynamically on violation logged.
  // The monthly pay formula gets the final streak for the month.
  const streakBonusesEarned = Math.floor(currentStreak / streakThreshold);
  const streakBonusPay = streakBonusesEarned * streakBonusAmount;

  // 5. Org Work Pay (Flexi-Fixed only)
  let orgWorkPay = 0;
  if (coach.coach_category === 'Flexi-Fixed') {
    orgWorkPay = orgWorkItems.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  // 6. Trial & Event Support Incentives (Flexi only)
  let trialIncentive = 0;
  let eventIncentive = 0;
  if (coach.coach_category === 'Flexi') {
    // Trial: completed trial sessions * per_session_rate
    const trialSessions = Number(monthData.trial_sessions_completed) || 0;
    trialIncentive = trialSessions * (rates.per_session || 0);

    // Event: Half day ₹400, Full day ₹700
    const halfDayEvents = Number(monthData.half_day_events) || 0;
    const fullDayEvents = Number(monthData.full_day_events) || 0;
    eventIncentive = (halfDayEvents * 400) + (fullDayEvents * 700);
  }

  // 7. HOP Specific Premiums (V5 only)
  let hopOohPremium = 0;
  let hopPtHomePremium = 0;
  let hopPerformanceCreditsPay = 0;
  let offerLetterFixedPay = 0;

  if (variantConfig.id === 'V5') {
    // V5 is HOP Internal S&C
    // Offer letter fixed salary
    offerLetterFixedPay = Number(coach.offer_letter_fixed_salary) || 0;
    
    // Out of Hours Session Premium (₹150 per session)
    const oohSessions = Number(monthData.ooh_sessions_completed) || 0;
    hopOohPremium = oohSessions * 150;

    // PT & Home Visit Reliability Bonus (₹100 per session)
    const ptHomeSessions = Number(monthData.pt_home_sessions_completed) || 0;
    hopPtHomePremium = ptHomeSessions * 100;

    // Performance credits: converted to cash at ₹10 per point, capped at ₹500
    const creditsPoints = Number(monthData.performance_credits_points) || 0;
    hopPerformanceCreditsPay = Math.min(500, creditsPoints * 10);
    
    // Since V5 has offer-letter fixed pay, standard basePay is replaced by offer-letter base pay
    basePay = offerLetterFixedPay;
    extraSessionPay = 0; // Not applicable for HOP
    sessionPay = 0; // Not session based
  }

  // 8. Total penalty from active violations this month
  const penaltyDeductions = activeViolationsForMonth.reduce((sum, v) => sum + (Number(v.penalty_amount) || 0), 0);

  // 9. GROSS PAY CALCULATION
  const grossPay = basePay + extraSessionPay + sessionPay + nightSessionPay + 
                   milestoneIncentive + consistencyBonus + streakBonusPay + 
                   orgWorkPay + trialIncentive + eventIncentive + 
                   hopOohPremium + hopPtHomePremium + hopPerformanceCreditsPay - 
                   penaltyDeductions;

  return {
    perSessionRate: rates.per_session || 0,
    basePay,
    extraSessions,
    extraSessionPay,
    sessionPay,
    nightSessionPay,
    milestoneIncentive,
    consistencyEligible,
    consistencyBonus,
    streakBonusPay,
    streakCount: currentStreak,
    orgWorkPay,
    trialIncentive,
    eventIncentive,
    hopOohPremium,
    hopPtHomePremium,
    hopPerformanceCreditsPay,
    penaltyDeductions,
    grossPay: Math.round(grossPay * 100) / 100
  };
}

/**
 * Performance periods run the 16th to the 15th and are named after the month
 * they end in — 16 May to 15 Jun is "June 2026".
 */
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const pad = (n) => String(n).padStart(2, '0');

export function buildPeriod(year, monthIndex) {
  const startDate = new Date(Date.UTC(year, monthIndex - 1, 16));
  return {
    period_month: `${MONTH_NAMES[monthIndex]} ${year}`,
    period_start: `${startDate.getUTCFullYear()}-${pad(startDate.getUTCMonth() + 1)}-16`,
    period_end: `${year}-${pad(monthIndex + 1)}-15`
  };
}

/** The period that the given date falls inside. */
export function getPeriodForDate(date) {
  const d = new Date(date);
  const day = d.getDate();
  let monthIndex = d.getMonth();
  let year = d.getFullYear();
  if (day >= 16) {
    monthIndex += 1;
    if (monthIndex > 11) { monthIndex = 0; year += 1; }
  }
  return buildPeriod(year, monthIndex);
}

/** The period immediately after the one ending on `periodEnd`. */
export function getNextPeriod(periodEnd) {
  const end = new Date(periodEnd);
  let monthIndex = end.getMonth() + 1;
  let year = end.getFullYear();
  if (monthIndex > 11) { monthIndex = 0; year += 1; }
  return buildPeriod(year, monthIndex);
}
