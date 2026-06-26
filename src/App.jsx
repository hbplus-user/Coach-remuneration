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
  getQuarterLabel
} from './calculations.js';

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
  const [newCoachVariant, setNewCoachVariant] = useState("V1");
  const [newCoachCategory, setNewCoachCategory] = useState("Fixed");
  const [newCoachDesignation, setNewCoachDesignation] = useState("");
  const [newCoachDoj, setNewCoachDoj] = useState("2026-06-25");
  const [newCoachDofc, setNewCoachDofc] = useState("2024-01-01");
  const [newCoachExpWith, setNewCoachExpWith] = useState(1.0);
  const [newCoachExpWithout, setNewCoachExpWithout] = useState(0.0);
  const [newCoachNonCoaching, setNewCoachNonCoaching] = useState(0);
  const [newCoachQualification, setNewCoachQualification] = useState("3-Year Bachelor's");
  const [newCoachEduType, setNewCoachEduType] = useState("offline_india");
  const [newCoachRm, setNewCoachRm] = useState("RM_01");
  const [newCoachSalary, setNewCoachSalary] = useState(0);
  const [newCoachProperty, setNewCoachProperty] = useState("HB+ Studio HSR");
  const [newCoachPhone, setNewCoachPhone] = useState("");
  const [newCoachEmail, setNewCoachEmail] = useState("");
  const [newCoachCerts, setNewCoachCerts] = useState([]); // selected cert IDs

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

  // 7. Payslip Preview Period
  const [payslipPeriod, setPayslipPeriod] = useState("June 2026");

  // Filters State
  const [coachesSearch, setCoachesSearch] = useState("");
  const [coachesVariantFilter, setCoachesVariantFilter] = useState("All");
  const [coachesCategoryFilter, setCoachesCategoryFilter] = useState("All");
  const [coachesStatusFilter, setCoachesStatusFilter] = useState("All");

  const [evalMonthFilter, setEvalMonthFilter] = useState("June 2026");
  const [evalVariantFilter, setEvalVariantFilter] = useState("All");
  const [evalStatusFilter, setEvalStatusFilter] = useState("All");

  const [vioSearch, setVioSearch] = useState("");
  const [vioTypeFilter, setVioTypeFilter] = useState("All");
  const [vioStatusFilter, setVioStatusFilter] = useState("All");

  const [payrollMonthFilter, setPayrollMonthFilter] = useState("June 2026");
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
        setHistoricMonths(parsed.historicMonths || []);
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
    if (!verifyAccess(permittedRoles)) {
      showToast("Access Denied: Your current role is not authorized.", "danger");
      return;
    }
    setActiveView(view);
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

  // Create coach
  const handleCreateCoachSubmit = (e) => {
    e.preventDefault();
    const newId = `HB+_${String(coaches.length + 23).padStart(3, '0')}`;

    // Map certs detail
    const selectedCertsList = certifications
      .filter(c => newCoachCerts.includes(c.id))
      .map(c => ({ id: c.id, authority: c.authority, course_name: c.course_name, score: c.score }));

    const newCoach = {
      id: newId,
      name: newCoachName,
      variant_id: newCoachVariant,
      coach_category: newCoachCategory,
      internal_designation: newCoachDesignation,
      date_of_joining: newCoachDoj,
      date_of_first_relevant_certification: newCoachDofc,
      freelance_past_exp_with_document: newCoachExpWith,
      freelance_past_exp_without_document: newCoachExpWithout,
      non_coaching_exp_years: newCoachNonCoaching,
      education_qualification: newCoachQualification,
      education_type: newCoachEduType,
      reporting_manager_id: newCoachRm,
      assigned_property: newCoachProperty,
      status: "Active",
      bank_account: "XXXX XXXX 8899",
      phone: newCoachPhone,
      email: newCoachEmail,
      certifications: selectedCertsList,
      five_star_streak: 0
    };

    if (newCoachCategory === 'Flexi-Fixed') {
      newCoach.flexi_fixed_base_salary = newCoachSalary || 2500;
    } else if (newCoachVariant === 'V5') {
      newCoach.offer_letter_fixed_salary = newCoachSalary || 30000;
    }

    setCoaches(prev => [...prev, newCoach]);

    // Seed evaluation scorecard
    setCurrentMonth(prev => [...prev, {
      coach_id: newId,
      period_month: "June 2026",
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

    logAudit("Coach Created", `Created coach ${newCoachName} (${newId}) registered to variant ${newCoachVariant}`);
    showToast(`Coach Profile ${newId} created successfully.`);
    setActiveModal(null);

    // reset fields
    setNewCoachName("");
    setNewCoachCerts([]);
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
      if (item.coach_id === selectedCoachId && item.period_month === "June 2026") {
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
      period_month: "June 2026",
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
      if (item.coach_id === coachId && item.period_month === "June 2026") {
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
  const handleSaveWeights = (variantId, newWeights) => {
    const sum = Object.values(newWeights).reduce((a, b) => a + b, 0);
    if (sum !== 100) {
      showToast(`Warning: Weights sum to ${sum}%. Weights should ideally equal 100% to normalize score out of 100.`, "warning");
    }

    setVariants(prev => prev.map(v => {
      if (v.id === variantId) {
        return { ...v, weights: newWeights };
      }
      return v;
    }));

    // Trigger recalculation of current month scorecard values using updated weights
    setCurrentMonth(prev => prev.map(evalRecord => {
      const coach = coaches.find(c => c.id === evalRecord.coach_id);
      if (coach && coach.variant_id === variantId) {
        const v = variants.find(x => x.id === variantId);
        const activeWeightsVariant = { ...v, weights: newWeights };
        const calc = computeHBPlusScore(coach, evalRecord, activeWeightsVariant);
        return {
          ...evalRecord,
          hb_score: calc.hbScore,
          band: getPerformanceBand(calc.hbScore).label
        };
      }
      return evalRecord;
    }));

    logAudit("Weights Adjusted", `Updated evaluation weights for variant: ${variants.find(x => x.id === variantId)?.name}`);
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

    logAudit(nextLocked ? "Payroll Lock" : "Payroll Unlock", "Manually toggled performance metrics lock for June 2026 cycle.");
    showToast(nextLocked ? "Current month payroll is now locked." : "Payroll unlocked for edits.", nextLocked ? "info" : "warning");
  };

  // Export CSV
  const handleExportCSV = () => {
    const dataset = payrollMonthFilter === "June 2026" ? currentMonth : historicMonths;
    let csvContent = "data:text/csv;charset=utf-8,Coach ID,Name,Category,HB+ Score,Band,Base Pay,Session Pay,Incentives,Deductions,Gross Pay,Status\n";

    dataset.forEach(e => {
      const coach = coaches.find(c => c.id === e.coach_id);
      if (!coach) return;
      if (payrollVariantFilter !== "All" && coach.variant_id !== payrollVariantFilter) return;

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
      { view: "evaluations", roles: "Super Admin,HR Manager,Reporting Manager,Operations,Auditor" },
      { view: "violations", roles: "Super Admin,HR Manager,Reporting Manager,Finance,Auditor" },
      { view: "payroll", roles: "Super Admin,HR Manager,Finance,Auditor" },
      { view: "appeals", roles: "Super Admin,HR Manager,Reporting Manager,Coach,Auditor" },
      { view: "settings", roles: "Super Admin,HR Manager" },
      { view: "audit", roles: "Super Admin,Auditor" }
    ];

    const activeDef = items.find(item => item.view === activeView);
    if (activeDef && activeDef.roles) {
      const isAllowed = activeDef.roles.split(",").includes(role);
      if (!isAllowed) {
        setActiveView("dashboard");
      }
    }
    logAudit("Role Switched", `Switched interface view context to: ${role}`);
  };

  // Helper check for active certifications on variants
  const getCertsForVariant = (varId) => {
    const v = variants.find(x => x.id === varId);
    const discipline = v ? v.discipline : "S&C";
    return certifications.filter(c => c.variant_type === discipline);
  };

  // If initial load hasn't occurred, show a placeholder loading screen
  if (!isStateLoaded) {
    return <div style={{ background: '#0b0f19', color: '#fff', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>Loading Remuneration Workspace...</div>;
  }

  // Active coach state reference
  const currentSelectedCoach = coaches.find(c => c.id === currentCoachContext);

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
            {verifyAccess("Super Admin,HR Manager,Reporting Manager,Operations,Auditor") && (
              <li className={`nav-item ${activeView === 'evaluations' ? 'active' : ''}`} onClick={() => handleNavClick('evaluations', "Super Admin,HR Manager,Reporting Manager,Operations,Auditor")}>
                <a href="#evaluations"><i className="bx bxs-medal nav-icon"></i><span>Evaluations</span></a>
              </li>
            )}
            {verifyAccess("Super Admin,HR Manager,Reporting Manager,Finance,Auditor") && (
              <li className={`nav-item ${activeView === 'violations' ? 'active' : ''}`} onClick={() => handleNavClick('violations', "Super Admin,HR Manager,Reporting Manager,Finance,Auditor")}>
                <a href="#violations"><i className="bx bxs-error-circle nav-icon"></i><span>Violation Register</span></a>
              </li>
            )}
            {verifyAccess("Super Admin,HR Manager,Finance,Auditor") && (
              <li className={`nav-item ${activeView === 'payroll' ? 'active' : ''}`} onClick={() => handleNavClick('payroll', "Super Admin,HR Manager,Finance,Auditor")}>
                <a href="#payroll"><i className="bx bx-rupee nav-icon"></i><span>Payroll &amp; Incentives</span></a>
              </li>
            )}
            {verifyAccess("Super Admin,HR Manager,Reporting Manager,Coach,Auditor") && (
              <li className={`nav-item ${activeView === 'appeals' ? 'active' : ''}`} onClick={() => handleNavClick('appeals', "Super Admin,HR Manager,Reporting Manager,Coach,Auditor")}>
                <a href="#appeals"><i className="bx bxs-conversation nav-icon"></i><span>Appeals Panel</span></a>
              </li>
            )}
            {verifyAccess("Super Admin,HR Manager") && (
              <li className={`nav-item ${activeView === 'settings' ? 'active' : ''}`} onClick={() => handleNavClick('settings', "Super Admin,HR Manager")}>
                <a href="#settings"><i className="bx bxs-cog nav-icon"></i><span>Settings &amp; Variants</span></a>
              </li>
            )}
            {verifyAccess("Super Admin,Auditor") && (
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
              <h1 id="page-title">{activeView.charAt(0).toUpperCase() + activeView.slice(1).replace('coaches', 'Coach Master').replace('payroll', 'Payroll Ledger').replace('audit', 'Audit Trails')}</h1>
              <p id="header-period-info">Performance Period: <strong className="text-teal">June 2026</strong> (16 May - 15 Jun) — <span className={`badge ${payrollLocked ? 'badge-danger' : 'badge-warning'}`} id="calendar-lock-status">{payrollLocked ? 'LOCKED' : 'Active (Unlocked)'}</span></p>
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
                        <p>June 2026 performance cycle</p>
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
                        <span className="badge badge-success">June 2026</span>
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
                      <button className="btn btn-secondary" onClick={() => setActiveView('payroll')}>
                        <i className="bx bx-search"></i> View Ledger Detail
                      </button>
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
                        <p>Evaluated for June 2026</p>
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
                      <button className="btn btn-primary" onClick={() => setActiveView('evaluations')}><i className="bx bx-plus"></i> Enter/Edit Evaluations</button>
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
                            <th>June 2026 Score</th>
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
                    <button className="btn btn-secondary" onClick={() => setActiveView("evaluations")}><i className="bx bx-show"></i> Verify Recorded Volumes</button>
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
                const progressPct = Math.min(100, (sessions / milestoneTarget) * 100);
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
                                const scoreVal = run.hb_score !== undefined ? run.hb_score : finalScore;
                                const bandVal = run.band || finalBand;
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

          {/* Coach Master View */}
          {activeView === 'coaches' && (
            <section id="view-coaches" className="content-view active-view">
              <div className="page-header-row">
                <h2>Coach Master Directory</h2>
                {(currentRole === "Super Admin" || currentRole === "HR Manager") && (
                  <button className="btn btn-primary" onClick={() => {
                    setNewCoachVariant("V1");
                    setNewCoachCategory("Fixed");
                    setNewCoachCerts([]);
                    setNewCoachRm("RM_01");
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
                    <label>Filter Variant</label>
                    <select value={coachesVariantFilter} onChange={(e) => setCoachesVariantFilter(e.target.value)}>
                      <option value="All">All Variants</option>
                      <option value="V1">HB+ Internal S&amp;C</option>
                      <option value="V2">HB+ External S&amp;C</option>
                      <option value="V3">HB+ Internal Yoga</option>
                      <option value="V4">HB+ External Yoga</option>
                      <option value="V5">HOP Internal S&amp;C</option>
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
                      <th>Variant</th>
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
                      const matchesVariant = coachesVariantFilter === "All" || c.variant_id === coachesVariantFilter;
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
                        <tr key={c.id}>
                          <td><strong>{c.id}</strong></td>
                          <td><strong>{c.name}</strong></td>
                          <td>{vConfig ? vConfig.name : c.variant_id}</td>
                          <td>{c.coach_category}</td>
                          <td>{c.internal_designation || 'Coach'}</td>
                          <td>{new Date(c.date_of_joining).toLocaleDateString('en-IN')}</td>
                          <td>{c.reporting_manager_id}</td>
                          <td><span className={`badge ${statusClass}`}>{c.status}</span></td>
                          <td className="actions-col">
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

          {/* Evaluations View */}
          {activeView === 'evaluations' && (
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
                      <option value="June 2026">June 2026 (Current)</option>
                      <option value="May 2026">May 2026 (Historic)</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Filter Variant</label>
                    <select value={evalVariantFilter} onChange={(e) => setEvalVariantFilter(e.target.value)}>
                      <option value="All">All Variants</option>
                      <option value="V1">V1 S&amp;C Internal</option>
                      <option value="V2">V2 S&amp;C External</option>
                      <option value="V3">V3 Yoga Internal</option>
                      <option value="V4">V4 Yoga External</option>
                      <option value="V5">V5 HOP Internal</option>
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
                      <th>Variant</th>
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
                    {(evalMonthFilter === "June 2026" ? currentMonth : historicMonths).filter(e => {
                      const coach = coaches.find(c => c.id === e.coach_id);
                      if (!coach) return false;
                      if (currentRole === "Reporting Manager" && coach.reporting_manager_id !== currentRmContext) return false;

                      const matchesVariant = evalVariantFilter === "All" || coach.variant_id === evalVariantFilter;
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
          {activeView === 'violations' && (
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
          {activeView === 'payroll' && (
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
                      <option value="June 2026">June 2026 (Current)</option>
                      <option value="May 2026">May 2026 (Historic)</option>
                    </select>
                  </div>
                  <div className="filter-item">
                    <label>Filter Variant</label>
                    <select value={payrollVariantFilter} onChange={(e) => setPayrollVariantFilter(e.target.value)}>
                      <option value="All">All Variants</option>
                      <option value="V1">V1 S&amp;C Internal</option>
                      <option value="V2">V2 S&amp;C External</option>
                      <option value="V3">V3 Yoga Internal</option>
                      <option value="V4">V4 Yoga External</option>
                      <option value="V5">V5 HOP Internal</option>
                    </select>
                  </div>
                  <div className="filter-item" style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button className="btn btn-secondary w-full" onClick={handleExportCSV}><i className="bx bx-download"></i> Export Payroll CSV</button>
                  </div>
                </div>
              </div>

              {/* Summary Stats Ledger */}
              {(() => {
                const dataset = payrollMonthFilter === "June 2026" ? currentMonth : historicMonths;
                let sumGross = 0, sumIncentives = 0, sumConsistency = 0, sumDeductions = 0;
                
                dataset.forEach(e => {
                  const coach = coaches.find(c => c.id === e.coach_id);
                  if (!coach) return;
                  if (payrollVariantFilter !== "All" && coach.variant_id !== payrollVariantFilter) return;

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
                            return payrollVariantFilter === "All" || coach.variant_id === payrollVariantFilter;
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
          {activeView === 'appeals' && (
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
          {activeView === 'settings' && (
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
                    {variants.map(v => (
                      <div className="settings-list-item" key={v.id}>
                        <h4>{v.name} ({v.discipline}) — Weights Config</h4>
                        <div className="settings-weights-grid">
                          <div className="weight-input-group">
                            <label>Coaching Exp</label>
                            <input type="number" defaultValue={v.weights.coaching_exp} id={`wt-coaching-${v.id}`} />
                          </div>
                          <div className="weight-input-group">
                            <label>Non-Coaching</label>
                            <input type="number" defaultValue={v.weights.non_coaching_exp} id={`wt-non-${v.id}`} />
                          </div>
                          <div className="weight-input-group">
                            <label>Education</label>
                            <input type="number" defaultValue={v.weights.education} id={`wt-edu-${v.id}`} />
                          </div>
                          <div className="weight-input-group">
                            <label>Tech Cert</label>
                            <input type="number" defaultValue={v.weights.technical_cert} id={`wt-cert-${v.id}`} />
                          </div>
                          <div className="weight-input-group">
                            <label>Core Perf</label>
                            <input type="number" defaultValue={v.weights.core_performance} id={`wt-core-${v.id}`} />
                          </div>
                          <div className="weight-input-group">
                            <label>Tenure</label>
                            <input type="number" defaultValue={v.weights.tenure} id={`wt-tenure-${v.id}`} />
                          </div>
                          <div className="weight-input-group">
                            <label>Attendance</label>
                            <input type="number" defaultValue={v.weights.attendance} id={`wt-attendance-${v.id}`} />
                          </div>
                          <div className="weight-input-group" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-primary" onClick={() => {
                              const newWeights = {
                                coaching_exp: Number(document.getElementById(`wt-coaching-${v.id}`).value),
                                non_coaching_exp: Number(document.getElementById(`wt-non-${v.id}`).value),
                                education: Number(document.getElementById(`wt-edu-${v.id}`).value),
                                technical_cert: Number(document.getElementById(`wt-cert-${v.id}`).value),
                                core_performance: Number(document.getElementById(`wt-core-${v.id}`).value),
                                tenure: Number(document.getElementById(`wt-tenure-${v.id}`).value),
                                attendance: Number(document.getElementById(`wt-attendance-${v.id}`).value)
                              };
                              handleSaveWeights(v.id, newWeights);
                            }} style={{ padding: '4px 8px', fontSize: '0.75rem' }}>Save</button>
                          </div>
                        </div>
                      </div>
                    ))}
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
                            <td>{c.course_name}</td>
                            <td>{c.level}</td>
                            <td><strong>{c.score.toFixed(1)}</strong></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* Audit View */}
          {activeView === 'audit' && (
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
              <h3>Create New Coach Profile</h3>
              <i className="bx bx-x modal-close-btn" onClick={() => setActiveModal(null)}></i>
            </div>
            <form onSubmit={handleCreateCoachSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label>Full Name</label>
                  <input type="text" value={newCoachName} onChange={(e) => setNewCoachName(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Policy Variant</label>
                  <select value={newCoachVariant} onChange={(e) => {
                    setNewCoachVariant(e.target.value);
                    setNewCoachCerts([]); // reset selected certs
                  }} required>
                    <option value="V1">HB+ Internal S&amp;C</option>
                    <option value="V2">HB+ External S&amp;C</option>
                    <option value="V3">HB+ Internal Yoga</option>
                    <option value="V4">HB+ External Yoga</option>
                    <option value="V5">HOP Internal S&amp;C</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Coach Category</label>
                  <select value={newCoachCategory} onChange={(e) => setNewCoachCategory(e.target.value)} required>
                    <option value="Fixed">Fixed</option>
                    <option value="Flexi-Fixed">Flexi-Fixed</option>
                    <option value="Flexi">Flexi</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Designation</label>
                  <input type="text" value={newCoachDesignation} onChange={(e) => setNewCoachDesignation(e.target.value)} placeholder="e.g. Coach, Crew" required />
                </div>
                <div className="form-group">
                  <label>Date of Joining</label>
                  <input type="date" value={newCoachDoj} onChange={(e) => setNewCoachDoj(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Date of First Certification</label>
                  <input type="date" value={newCoachDofc} onChange={(e) => setNewCoachDofc(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Coaching Exp (Years Documented)</label>
                  <input type="number" step="0.5" min="0" value={newCoachExpWith} onChange={(e) => setNewCoachExpWith(Number(e.target.value))} required />
                </div>
                <div className="form-group">
                  <label>Coaching Exp (Years Undocumented)</label>
                  <input type="number" step="0.5" min="0" value={newCoachExpWithout} onChange={(e) => setNewCoachExpWithout(Number(e.target.value))} required />
                </div>
                <div className="form-group">
                  <label>Non-Coaching Exp (Years)</label>
                  <input type="number" min="0" value={newCoachNonCoaching} onChange={(e) => setNewCoachNonCoaching(Number(e.target.value))} required />
                </div>
                <div className="form-group">
                  <label>Highest Education</label>
                  <select value={newCoachQualification} onChange={(e) => setNewCoachQualification(e.target.value)} required>
                    <option value="3-Year Bachelor's">3-Year Bachelor's</option>
                    <option value="4/5-Year Professional Bachelor's">4/5-Year Professional Bachelor's</option>
                    <option value="Post-Grad / Master's / CA / CS">Post-Grad / Master's / CA / CS</option>
                    <option value="PhD (Doctorate)">PhD (Doctorate)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Education Format</label>
                  <select value={newCoachEduType} onChange={(e) => setNewCoachEduType(e.target.value)} required>
                    <option value="offline_india">Offline - India</option>
                    <option value="online_global">Online - Global / India</option>
                    <option value="offline_outside">Offline - Outside India</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Reporting Manager</label>
                  <select value={newCoachRm} onChange={(e) => setNewCoachRm(e.target.value)} required>
                    <option value="RM_01">RM 01 (S&amp;C)</option>
                    <option value="RM_02">RM 02 (Yoga)</option>
                    <option value="RM_03">RM 03 (HOP)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Offer Salary (V5) / Flexi Base Salary</label>
                  <input type="number" value={newCoachSalary} onChange={(e) => setNewCoachSalary(Number(e.target.value))} />
                </div>
                <div className="form-group">
                  <label>Assigned Property</label>
                  <input type="text" value={newCoachProperty} onChange={(e) => setNewCoachProperty(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <input type="text" value={newCoachPhone} onChange={(e) => setNewCoachPhone(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input type="email" value={newCoachEmail} onChange={(e) => setNewCoachEmail(e.target.value)} required />
                </div>
              </div>

              <div className="form-group w-full" style={{ marginTop: '1rem' }}>
                <label>Select Certifications</label>
                <div className="checkbox-group-grid">
                  {getCertsForVariant(newCoachVariant).map(c => (
                    <label className="checkbox-item" key={c.id}>
                      <input type="checkbox" checked={newCoachCerts.includes(c.id)} onChange={(e) => {
                        if (e.target.checked) {
                          setNewCoachCerts(prev => [...prev, c.id]);
                        } else {
                          setNewCoachCerts(prev => prev.filter(x => x !== c.id));
                        }
                      }} />
                      <span>{c.authority} - {c.course_name} ({c.score} pts)</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setActiveModal(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Create Profile</button>
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
                      <option value="Flexi-Fixed">Flexi-Fixed</option>
                      <option value="Flexi">Flexi</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Performance Month</label>
                    <select disabled defaultValue="June 2026">
                      <option value="June 2026">June 2026 (16 May - 15 Jun)</option>
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
        const dataset = payslipPeriod === "June 2026" ? currentMonth : historicMonths;
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
