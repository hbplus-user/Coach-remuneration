/**
 * HB+ Coach Remuneration & Performance Management - Seed Data
 */

export const INITIAL_VARIANTS = [
  {
    id: "V1",
    name: "HB+ Internal S&C",
    discipline: "S&C",
    audience: "Internal",
    property: "HB+ Studio",
    is_active: true,
    weights: {
      coaching_exp: 8,       // 8%
      non_coaching_exp: 4,   // 4%
      education: 5,          // 5%
      technical_cert: 15,    // 15%
      core_performance: 28,  // 28%
      tenure: 15,            // 15%
      attendance: 25         // 25%
    },
    rates: {
      "Fixed": {
        "0–30 Non-Functional": { per_session: 200, std_fixed: 22100, min_fixed: 19890, max_fixed: 24310, threshold: 156 },
        "30–40 Weak": { per_session: 218, std_fixed: 25506, min_fixed: 22955, max_fixed: 28056, threshold: 156 },
        "40–50 Basic": { per_session: 240, std_fixed: 28860, min_fixed: 25974, max_fixed: 31746, threshold: 156 },
        "50–60 Stable": { per_session: 264, std_fixed: 32947, min_fixed: 29652, max_fixed: 36242, threshold: 156 },
        "60–70 Good": { per_session: 290, std_fixed: 36569, min_fixed: 32912, max_fixed: 40226, threshold: 156 },
        "70–80 High-Quality": { per_session: 318, std_fixed: 40513, min_fixed: 36462, max_fixed: 44565, threshold: 156 },
        "80–90 Exceptional": { per_session: 348, std_fixed: 44788, min_fixed: 40309, max_fixed: 49266, threshold: 156 }
      },
      "Flexi-Fixed": {
        "0–30 Non-Functional": { per_session: 200, min_fixed: 500, max_fixed: 1000, threshold: 96 },
        "30–40 Weak": { per_session: 218, min_fixed: 1000, max_fixed: 1500, threshold: 96 },
        "40–50 Basic": { per_session: 240, min_fixed: 1500, max_fixed: 2000, threshold: 96 },
        "50–60 Stable": { per_session: 264, min_fixed: 2000, max_fixed: 2500, threshold: 96 },
        "60–70 Good": { per_session: 290, min_fixed: 2500, max_fixed: 3000, threshold: 96 },
        "70–80 High-Quality": { per_session: 318, min_fixed: 3000, max_fixed: 3500, threshold: 96 },
        "80–90 Exceptional": { per_session: 348, min_fixed: 3500, max_fixed: 4000, threshold: 96 }
      },
      "Flexi": {
        "0–30 Non-Functional": { per_session: 200, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "30–40 Weak": { per_session: 218, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "40–50 Basic": { per_session: 240, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "50–60 Stable": { per_session: 264, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "60–70 Good": { per_session: 290, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "70–80 High-Quality": { per_session: 318, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "80–90 Exceptional": { per_session: 348, min_fixed: 0, max_fixed: 0, threshold: 96 }
      }
    },
    milestones: {
      "Fixed": [
        { threshold: 156, amount: 1000 },
        { threshold: 182, amount: 2000 }
      ],
      "Flexi-Fixed": [
        { threshold: 96, amount: 1152 },
        { threshold: 135, amount: 2025 },
        { threshold: 186, amount: 3640 }
      ],
      "Flexi": [
        { threshold: 96, amount: 1152 },
        { threshold: 135, amount: 2025 },
        { threshold: 186, amount: 3640 }
      ]
    }
  },
  {
    id: "V2",
    name: "HB+ External S&C",
    discipline: "S&C",
    audience: "External",
    property: "HB+ Studio / Partner",
    is_active: true,
    weights: {
      coaching_exp: 8,
      non_coaching_exp: 4,
      education: 5,
      technical_cert: 15,
      core_performance: 28,
      tenure: 15,
      attendance: 25
    },
    rates: {
      "Fixed": {
        "0–30 Non-Functional": { per_session: 200, std_fixed: 22100, min_fixed: 19890, max_fixed: 24310, threshold: 156 },
        "30–40 Weak": { per_session: 218, std_fixed: 25506, min_fixed: 22955, max_fixed: 28056, threshold: 156 },
        "40–50 Basic": { per_session: 240, std_fixed: 28860, min_fixed: 25974, max_fixed: 31746, threshold: 156 },
        "50–60 Stable": { per_session: 264, std_fixed: 32947, min_fixed: 29652, max_fixed: 36242, threshold: 156 },
        "60–70 Good": { per_session: 290, std_fixed: 36569, min_fixed: 32912, max_fixed: 40226, threshold: 156 },
        "70–80 High-Quality": { per_session: 318, std_fixed: 40513, min_fixed: 36462, max_fixed: 44565, threshold: 156 },
        "80–90 Exceptional": { per_session: 348, std_fixed: 44788, min_fixed: 40309, max_fixed: 49266, threshold: 156 }
      },
      "Flexi-Fixed": {
        "0–30 Non-Functional": { per_session: 200, min_fixed: 500, max_fixed: 1000, threshold: 96 },
        "30–40 Weak": { per_session: 218, min_fixed: 1000, max_fixed: 1500, threshold: 96 },
        "40–50 Basic": { per_session: 240, min_fixed: 1500, max_fixed: 2000, threshold: 96 },
        "50–60 Stable": { per_session: 264, min_fixed: 2000, max_fixed: 2500, threshold: 96 },
        "60–70 Good": { per_session: 290, min_fixed: 2500, max_fixed: 3000, threshold: 96 },
        "70–80 High-Quality": { per_session: 318, min_fixed: 3000, max_fixed: 3500, threshold: 96 },
        "80–90 Exceptional": { per_session: 348, min_fixed: 3500, max_fixed: 4000, threshold: 96 }
      },
      "Flexi": {
        "0–30 Non-Functional": { per_session: 200, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "30–40 Weak": { per_session: 218, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "40–50 Basic": { per_session: 240, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "50–60 Stable": { per_session: 264, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "60–70 Good": { per_session: 290, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "70–80 High-Quality": { per_session: 318, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "80–90 Exceptional": { per_session: 348, min_fixed: 0, max_fixed: 0, threshold: 96 }
      }
    },
    milestones: {
      "Fixed": [
        { threshold: 156, amount: 1000 },
        { threshold: 182, amount: 2000 }
      ],
      "Flexi-Fixed": [
        { threshold: 96, amount: 1152 },
        { threshold: 135, amount: 2025 },
        { threshold: 186, amount: 3640 }
      ],
      "Flexi": [
        { threshold: 96, amount: 1152 },
        { threshold: 135, amount: 2025 },
        { threshold: 186, amount: 3640 }
      ]
    }
  },
  {
    id: "V3",
    name: "HB+ Internal Yoga",
    discipline: "Yoga",
    audience: "Internal",
    property: "HB+ Studio / Online",
    is_active: true,
    weights: {
      coaching_exp: 8,
      non_coaching_exp: 4,
      education: 5,
      technical_cert: 15,
      core_performance: 44,  // Override: 44%
      tenure: 20,            // Override: 20%
      attendance: 4          // Override: 4%
    },
    rates: {
      "Fixed": {
        "0–30 Non-Functional": { per_session: 210, std_fixed: 23205, min_fixed: 20884, max_fixed: 25525, threshold: 117 },
        "30–40 Weak": { per_session: 240, std_fixed: 28080, min_fixed: 25272, max_fixed: 30888, threshold: 117 },
        "40–50 Basic": { per_session: 280, std_fixed: 33670, min_fixed: 30303, max_fixed: 37037, threshold: 117 },
        "50–60 Stable": { per_session: 320, std_fixed: 39936, min_fixed: 35942, max_fixed: 43929, threshold: 117 },
        "60–70 Good": { per_session: 360, std_fixed: 45396, min_fixed: 40856, max_fixed: 49935, threshold: 117 },
        "70–80 High-Quality": { per_session: 400, std_fixed: 50960, min_fixed: 45864, max_fixed: 56056, threshold: 117 },
        "80–90 Exceptional": { per_session: 440, std_fixed: 56628, min_fixed: 50965, max_fixed: 62290, threshold: 117 }
      },
      "Flexi-Fixed": {
        "0–30 Non-Functional": { per_session: 210, min_fixed: 500, max_fixed: 1000, threshold: 96 },
        "30–40 Weak": { per_session: 240, min_fixed: 1000, max_fixed: 1500, threshold: 96 },
        "40–50 Basic": { per_session: 280, min_fixed: 1500, max_fixed: 2000, threshold: 96 },
        "50–60 Stable": { per_session: 320, min_fixed: 2000, max_fixed: 2500, threshold: 96 },
        "60–70 Good": { per_session: 360, min_fixed: 2500, max_fixed: 3000, threshold: 96 },
        "70–80 High-Quality": { per_session: 400, min_fixed: 3000, max_fixed: 3500, threshold: 96 },
        "80–90 Exceptional": { per_session: 440, min_fixed: 3500, max_fixed: 4000, threshold: 96 }
      },
      "Flexi": {
        "0–30 Non-Functional": { per_session: 210, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "30–40 Weak": { per_session: 240, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "40–50 Basic": { per_session: 280, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "50–60 Stable": { per_session: 320, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "60–70 Good": { per_session: 360, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "70–80 High-Quality": { per_session: 400, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "80–90 Exceptional": { per_session: 440, min_fixed: 0, max_fixed: 0, threshold: 96 }
      }
    },
    milestones: {
      "Fixed": [
        { threshold: 117, amount: 1000 },
        { threshold: 143, amount: 2000 }
      ],
      "Flexi-Fixed": [], // Not eligible
      "Flexi": [] // Not eligible
    }
  },
  {
    id: "V4",
    name: "HB+ External Yoga",
    discipline: "Yoga",
    audience: "External",
    property: "HB+ Studio / Online",
    is_active: true,
    weights: {
      coaching_exp: 8,
      non_coaching_exp: 4,
      education: 5,
      technical_cert: 15,
      core_performance: 28,  // standard weight
      tenure: 15,
      attendance: 25
    },
    rates: {
      "Fixed": {
        "0–30 Non-Functional": { per_session: 210, std_fixed: 23205, min_fixed: 20884, max_fixed: 25525, threshold: 117 },
        "30–40 Weak": { per_session: 240, std_fixed: 28080, min_fixed: 25272, max_fixed: 30888, threshold: 117 },
        "40–50 Basic": { per_session: 280, std_fixed: 33670, min_fixed: 30303, max_fixed: 37037, threshold: 117 },
        "50–60 Stable": { per_session: 320, std_fixed: 39936, min_fixed: 35942, max_fixed: 43929, threshold: 117 },
        "60–70 Good": { per_session: 360, std_fixed: 45396, min_fixed: 40856, max_fixed: 49935, threshold: 117 },
        "70–80 High-Quality": { per_session: 400, std_fixed: 50960, min_fixed: 45864, max_fixed: 56056, threshold: 117 },
        "80–90 Exceptional": { per_session: 440, std_fixed: 56628, min_fixed: 50965, max_fixed: 62290, threshold: 117 }
      },
      "Flexi-Fixed": {
        "0–30 Non-Functional": { per_session: 210, min_fixed: 500, max_fixed: 1000, threshold: 96 },
        "30–40 Weak": { per_session: 240, min_fixed: 1000, max_fixed: 1500, threshold: 96 },
        "40–50 Basic": { per_session: 280, min_fixed: 1500, max_fixed: 2000, threshold: 96 },
        "50–60 Stable": { per_session: 320, min_fixed: 2000, max_fixed: 2500, threshold: 96 },
        "60–70 Good": { per_session: 360, min_fixed: 2500, max_fixed: 3000, threshold: 96 },
        "70–80 High-Quality": { per_session: 400, min_fixed: 3000, max_fixed: 3500, threshold: 96 },
        "80–90 Exceptional": { per_session: 440, min_fixed: 3500, max_fixed: 4000, threshold: 96 }
      },
      "Flexi": {
        "0–30 Non-Functional": { per_session: 210, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "30–40 Weak": { per_session: 240, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "40–50 Basic": { per_session: 280, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "50–60 Stable": { per_session: 320, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "60–70 Good": { per_session: 360, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "70–80 High-Quality": { per_session: 400, min_fixed: 0, max_fixed: 0, threshold: 96 },
        "80–90 Exceptional": { per_session: 440, min_fixed: 0, max_fixed: 0, threshold: 96 }
      }
    },
    milestones: {
      "Fixed": [
        { threshold: 117, amount: 1000 },
        { threshold: 143, amount: 2000 }
      ],
      "Flexi-Fixed": [],
      "Flexi": []
    }
  },
  {
    id: "V5",
    name: "HOP Internal S&C",
    discipline: "S&C",
    audience: "Internal",
    property: "HOP Studio / Home Visit",
    is_active: true,
    weights: {
      coaching_exp: 8,
      non_coaching_exp: 4,
      education: 5,
      technical_cert: 15,
      core_performance: 28,
      tenure: 15,
      attendance: 25 // L&D
    },
    rates: {
      "Fixed": {
        "0–30 Non-Functional": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 },
        "30–40 Weak": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 },
        "40–50 Basic": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 },
        "50–60 Stable": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 },
        "60–70 Good": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 },
        "70–80 High-Quality": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 },
        "80–90 Exceptional": { per_session: 150, std_fixed: 0, min_fixed: 0, max_fixed: 0, threshold: 156 }
      }
    },
    milestones: {
      "Fixed": [
        { threshold: 156, amount: 1000 },
        { threshold: 182, amount: 2500 }
      ]
    }
  }
];

export const INITIAL_CERTIFICATIONS = [
  // S&C Certifications
  { id: "SC1", variant_type: "S&C", authority: "NSCA", course_name: "CSCS — Certified Strength & Conditioning Specialist", level: "Gold", score: 9.6 },
  { id: "SC2", variant_type: "S&C", authority: "ACSM", course_name: "Certified Clinical Exercise Physiologist", level: "Gold", score: 9.6 },
  { id: "SC3", variant_type: "S&C", authority: "ACSM", course_name: "Certified Exercise Physiologist", level: "Gold", score: 9.2 },
  { id: "SC4", variant_type: "S&C", authority: "ASCA", course_name: "Strength & Conditioning Coach (Level 3)", level: "Gold", score: 9.4 },
  { id: "SC5", variant_type: "S&C", authority: "NASM", course_name: "Corrective Exercise Specialist (CES)", level: "Gold", score: 9.1 },
  { id: "SC6", variant_type: "S&C", authority: "ASCA", course_name: "Strength & Conditioning Coach (Level 2)", level: "Silver", score: 9.0 },
  { id: "SC7", variant_type: "S&C", authority: "EXOS", course_name: "Performance Specialist", level: "Silver", score: 9.1 },
  { id: "SC8", variant_type: "S&C", authority: "ACE", course_name: "Personal Trainer", level: "Bronze", score: 8.2 },
  { id: "SC9", variant_type: "S&C", authority: "K11", course_name: "Diploma in Personal Training", level: "Bronze", score: 7.7 },
  { id: "SC10", variant_type: "S&C", authority: "ISSA", course_name: "Certified Personal Trainer", level: "Bronze", score: 7.8 },
  
  // Yoga Certifications
  { id: "YG1", variant_type: "Yoga", authority: "Yoga Alliance USA", course_name: "RYT 500 (Registered Yoga Teacher)", level: "Gold", score: 10.0 },
  { id: "YG2", variant_type: "Yoga", authority: "Yoga Alliance USA", course_name: "RYT 200", level: "Silver", score: 7.0 },
  { id: "YG3", variant_type: "Yoga", authority: "Kaivalyadhama", course_name: "PG Diploma in Yoga Education", level: "Gold", score: 9.0 },
  { id: "YG4", variant_type: "Yoga", authority: "The Yoga Institute", course_name: "1 Month TTC", level: "Bronze", score: 5.0 }
];

export const INITIAL_COACHES = [
  // 1. Ankush Chettri (HB+_023)
  {
    id: "HB+_023",
    name: "Ankush Chettri",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2023-05-15", // dynamic post DOJ = 3.0 yrs on 15 May 2026
    date_of_first_relevant_certification: "2023-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 0.0,
    education_score_override: 0.0,
    education_qualification: "None",
    education_type: "online_global",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio Indiranagar",
    status: "Active",
    bank_account: "XXXX XXXX 4102",
    phone: "+91 98765 43210",
    email: "ankush.c@hbplus.com",
    certifications: [{ id: "SC9", authority: "K11", course_name: "Diploma in Personal Training", score: 7.7 }],
    five_star_streak: 8
  },
  // 2. Shilpa Singh (HB+_026)
  {
    id: "HB+_026",
    name: "Shilpa Singh",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2024-05-15", // dynamic post DOJ = 2.0 yrs
    date_of_first_relevant_certification: "2023-05-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 2.0, // 2 * 0.5 = 1.0 yr past
    non_coaching_exp_years: 0.0,
    education_score_override: 8.0,
    education_qualification: "PhD (Doctorate)",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio Koramangala",
    status: "Active",
    bank_account: "XXXX XXXX 9987",
    phone: "+91 91234 56789",
    email: "shilpa.s@hbplus.com",
    certifications: [{ id: "SC10", authority: "ISSA", course_name: "Certified Personal Trainer", score: 6.0 }],
    five_star_streak: 6
  },
  // 3. Hardik Nagpal (HB+_030)
  {
    id: "HB+_030",
    name: "Hardik Nagpal",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2024-05-15", // 2.0 yrs
    date_of_first_relevant_certification: "2024-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 4.0, // 4 * 0.5 = 2.0 yrs past
    non_coaching_exp_years: 0.0,
    education_score_override: 9.0,
    education_qualification: "PhD (Doctorate)",
    education_type: "offline_outside",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio JP Nagar",
    status: "Active",
    bank_account: "XXXX XXXX 1234",
    phone: "+91 88888 77777",
    email: "hardik.n@hbplus.com",
    certifications: [{ id: "SC10", authority: "ISSA", course_name: "Certified Personal Trainer", score: 6.0 }],
    five_star_streak: 11
  },
  // 4. Mousumi Dutta (HB+_048)
  {
    id: "HB+_048",
    name: "Mousumi Dutta",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2024-11-15", // 1.5 yrs
    date_of_first_relevant_certification: "2024-05-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 4.0, // 2.0 yrs past
    non_coaching_exp_years: 5.0,
    education_score_override: 3.0,
    education_qualification: "Post-Grad / Master's / CA / CS",
    education_type: "online_global",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio HSR",
    status: "Active",
    bank_account: "XXXX XXXX 4567",
    phone: "+91 77777 66666",
    email: "mousumi.d@hbplus.com",
    certifications: [{ id: "SC10", authority: "ISSA", course_name: "Certified Personal Trainer", score: 5.5 }],
    five_star_streak: 4
  },
  // 5. Ayesha Tabassum (HB+_068)
  {
    id: "HB+_068",
    name: "Ayesha Tabassum",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2025-05-15", // 1.0 yr
    date_of_first_relevant_certification: "2025-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 1.0,
    education_score_override: 3.5,
    education_qualification: "4/5-Year Professional Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio Whitefield",
    status: "Active",
    bank_account: "XXXX XXXX 3344",
    phone: "+91 99999 88888",
    email: "ayesha.t@hbplus.com",
    certifications: [{ id: "SC7", authority: "EXOS", course_name: "Performance Specialist", score: 8.5 }],
    five_star_streak: 15
  },
  // 6. Poonam Gusain (HB+_070)
  {
    id: "HB+_070",
    name: "Poonam Gusain",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2025-05-15", // 1.0 yr
    date_of_first_relevant_certification: "2025-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 0.0,
    education_score_override: 8.8,
    education_qualification: "PhD",
    education_type: "offline_outside",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio Malleshwaram",
    status: "Active",
    bank_account: "XXXX XXXX 5566",
    phone: "+91 98888 12345",
    email: "poonam.g@hbplus.com",
    certifications: [{ id: "SC10", authority: "ISSA", course_name: "Certified Personal Trainer", score: 6.0 }],
    five_star_streak: 9
  },
  // 7. Ramon Roychowdhury (HB+_080)
  {
    id: "HB+_080",
    name: "Ramon Roychowdhury",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2025-05-15", // 1.0 yr
    date_of_first_relevant_certification: "2022-01-01",
    freelance_past_exp_with_document: 3.0,
    freelance_past_exp_without_document: 2.0, // 1.0 yr past
    non_coaching_exp_years: 6.0,
    education_score_override: 8.0,
    education_qualification: "PhD",
    education_type: "offline_outside",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio Koramangala",
    status: "Active",
    bank_account: "XXXX XXXX 7788",
    phone: "+91 90000 11111",
    email: "ramon.r@hbplus.com",
    certifications: [{ id: "SC6", authority: "ASCA", course_name: "Strength & Conditioning Coach", score: 9.0 }],
    five_star_streak: 20
  },
  // 8. Budhaditya Ghosh (HB+_084)
  {
    id: "HB+_084",
    name: "Budhaditya Ghosh",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2025-05-15", // 1.0 yr
    date_of_first_relevant_certification: "2021-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 8.0, // 4.0 yrs past
    non_coaching_exp_years: 0.0,
    education_score_override: 0.0,
    education_qualification: "None",
    education_type: "online_global",
    reporting_manager_id: "RM_01",
    assigned_property: "Partner Gym Hub",
    status: "Active",
    bank_account: "XXXX XXXX 1122",
    phone: "+91 94444 55555",
    email: "budhaditya.g@hbplus.com",
    certifications: [{ id: "SC9", authority: "K11", course_name: "Diploma in Personal Training", score: 6.3 }],
    five_star_streak: 1
  },
  // 9. Chaitra Narendra (HB+_098)
  {
    id: "HB+_098",
    name: "Chaitra Narendra",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2024-01-01",
    freelance_past_exp_with_document: 1.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 0.0,
    education_score_override: 3.5,
    education_qualification: "4/5-Year Professional Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "Partner Gym Hub",
    status: "Active",
    bank_account: "XXXX XXXX 6677",
    phone: "+91 95555 66666",
    email: "chaitra.n@hbplus.com",
    certifications: [{ id: "SC10", authority: "ISSA", course_name: "Certified Personal Trainer", score: 6.0 }],
    five_star_streak: 2
  },
  // 10. Sahilpreet singh (HB+_103)
  {
    id: "HB+_103",
    name: "Sahilpreet singh",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2024-05-15",
    freelance_past_exp_with_document: 1.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 0.0,
    education_score_override: 3.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio JP Nagar",
    status: "Active",
    bank_account: "XXXX XXXX 8899",
    phone: "+91 96666 77777",
    email: "sahilpreet.s@hbplus.com",
    certifications: [{ id: "SC5", authority: "NASM", course_name: "Corrective Exercise Specialist", score: 8.8 }],
    five_star_streak: 5
  },
  // 11. Amlan Gogoi (HB+_093)
  {
    id: "HB+_093",
    name: "Amlan Gogoi",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2024-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 1.0, // 0.5 yr past
    non_coaching_exp_years: 3.0,
    education_score_override: 3.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "Partner Gym Hub",
    status: "Active",
    bank_account: "XXXX XXXX 3322",
    phone: "+91 97777 88888",
    email: "amlan.g@hbplus.com",
    certifications: [{ id: "SC7", authority: "EXOS", course_name: "Performance Specialist", score: 8.5 }],
    five_star_streak: 4
  },
  // 12. Karthik R (HB+_115)
  {
    id: "HB+_115",
    name: "Karthik R",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2024-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 3.0, // 1.5 yrs past
    non_coaching_exp_years: 0.0,
    education_score_override: 5.5,
    education_qualification: "4/5-Year Professional Bachelor's",
    education_type: "offline_outside",
    reporting_manager_id: "RM_01",
    assigned_property: "Partner Gym Hub",
    status: "Active",
    bank_account: "XXXX XXXX 5544",
    phone: "+91 93333 44444",
    email: "karthik.r@hbplus.com",
    certifications: [{ id: "SC7", authority: "EXOS", course_name: "Performance Specialist", score: 8.5 }],
    five_star_streak: 11
  },
  // 13. Rakesh Roshan Chakra (HB+_120)
  {
    id: "HB+_120",
    name: "Rakesh Roshan Chakra",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Crew",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2025-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 3.0, // 1.5 yrs past
    non_coaching_exp_years: 0.0,
    education_score_override: 3.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "HB+ Studio Koramangala",
    status: "Active",
    bank_account: "XXXX XXXX 9900",
    phone: "+91 92222 33333",
    email: "rakesh.r@hbplus.com",
    certifications: [],
    five_star_streak: 0
  },
  // 14. Sambit Nag (HB+_121)
  {
    id: "HB+_121",
    name: "Sambit Nag",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2024-05-15",
    freelance_past_exp_with_document: 1.0,
    freelance_past_exp_without_document: 1.0, // 0.5 yr past
    non_coaching_exp_years: 0.0,
    education_score_override: 3.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "Partner Gym Hub",
    status: "Active",
    bank_account: "XXXX XXXX 7700",
    phone: "+91 91111 22222",
    email: "sambit.n@hbplus.com",
    certifications: [{ id: "SC6", authority: "ASCA", course_name: "Strength & Conditioning Coach", score: 9.3 }],
    five_star_streak: 1
  },
  // 15. Shubham Vashist (HB+_122)
  {
    id: "HB+_122",
    name: "Shubham Vashist",
    variant_id: "V1",
    coach_category: "Fixed",
    internal_designation: "Lancer",
    date_of_joining: "2025-11-15", // 0.5 yrs
    date_of_first_relevant_certification: "2020-01-01",
    freelance_past_exp_with_document: 0.0,
    freelance_past_exp_without_document: 11.0, // 5.5 yrs past
    non_coaching_exp_years: 0.0,
    education_score_override: 3.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_01",
    assigned_property: "Partner Gym Hub",
    status: "Active",
    bank_account: "XXXX XXXX 8811",
    phone: "+91 90009 00009",
    email: "shubham.v@hbplus.com",
    certifications: [{ id: "SC9", authority: "K11", course_name: "Diploma in Personal Training", score: 8.1 }],
    five_star_streak: 1
  },

  // ------------------------------------
  // EXTRA PILOT COACHES FOR VARIANT Logic (V3, V4, V5)
  // ------------------------------------
  {
    id: "HB+_130",
    name: "Priya Nair (Yoga Internal)",
    variant_id: "V3",
    coach_category: "Fixed",
    internal_designation: "Yoga Guru",
    date_of_joining: "2023-01-15",
    date_of_first_relevant_certification: "2020-01-01",
    freelance_past_exp_with_document: 3.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 0.0,
    education_qualification: "Post-Grad / Master's / CA / CS",
    education_type: "offline_india",
    reporting_manager_id: "RM_02",
    assigned_property: "HB+ Online Studio",
    status: "Active",
    bank_account: "XXXX XXXX 1144",
    phone: "+91 98888 77777",
    email: "priya.n@hbplus.com",
    certifications: [{ id: "YG3", authority: "Kaivalyadhama", course_name: "PG Diploma", score: 9.0 }],
    five_star_streak: 16
  },
  {
    id: "HB+_131",
    name: "Tanya Sen (Yoga External)",
    variant_id: "V4",
    coach_category: "Flexi-Fixed",
    internal_designation: "Associate Yoga Coach",
    date_of_joining: "2024-01-15",
    date_of_first_relevant_certification: "2021-01-10",
    freelance_past_exp_with_document: 2.0,
    freelance_past_exp_without_document: 0.0,
    non_coaching_exp_years: 0.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_02",
    assigned_property: "MindBody Partner Hub",
    status: "Active",
    bank_account: "XXXX XXXX 2255",
    phone: "+91 97777 55555",
    email: "tanya.s@hbplus.com",
    certifications: [{ id: "YG2", authority: "Yoga Alliance", course_name: "RYT 200", score: 7.0 }],
    five_star_streak: 5,
    flexi_fixed_base_salary: 2000
  },
  {
    id: "HB+_132",
    name: "Vikram Dev (HOP Internal)",
    variant_id: "V5",
    coach_category: "Fixed",
    internal_designation: "Crew Coach",
    date_of_joining: "2023-08-01",
    date_of_first_relevant_certification: "2021-02-15",
    freelance_past_exp_with_document: 1.0,
    freelance_past_exp_without_document: 1.5,
    non_coaching_exp_years: 1.0,
    education_qualification: "3-Year Bachelor's",
    education_type: "offline_india",
    reporting_manager_id: "RM_03",
    assigned_property: "HOP Studio Electronic City",
    status: "Active",
    bank_account: "XXXX XXXX 3366",
    phone: "+91 96666 44444",
    email: "vikram.d@hop.hbplus.com",
    certifications: [{ id: "SC7", authority: "EXOS", course_name: "Performance Specialist", score: 7.5 }],
    five_star_streak: 11,
    offer_letter_fixed_salary: 32000
  }
];

// Seed Historical Data (Performance Period: May 2026 - e.g. 16 Apr to 15 May)
export const INITIAL_HISTORIC_MONTHS = [
  // Ankush Chettri (HB+_023) - May 2026
  {
    coach_id: "HB+_023",
    period_month: "May 2026",
    period_start: "2026-04-16",
    period_end: "2026-05-15",
    prof_appearance: 16,
    client_engagement: 19,
    safety: 12,
    punctuality: 6,
    team_conduct: 10,
    communication: 10,
    attendance_pct: 40.0, // 2 / 5 * 100
    sessions_completed: 100.0,
    night_sessions: 0,
    five_star_streak: 8,
    status: "FINANCE_LOCKED",
    hb_score: 53.39,
    band: "50–60 Stable"
  },
  // Shilpa Singh (HB+_026) - May 2026
  {
    coach_id: "HB+_026",
    period_month: "May 2026",
    period_start: "2026-04-16",
    period_end: "2026-05-15",
    prof_appearance: 16,
    client_engagement: 19,
    safety: 12,
    punctuality: 3,
    team_conduct: 5,
    communication: 10,
    attendance_pct: 0.0, // 0 / 5 * 100
    sessions_completed: 200.0,
    night_sessions: 0,
    five_star_streak: 6,
    status: "FINANCE_LOCKED",
    hb_score: 39.98,
    band: "30–40 Weak"
  },
  // Hardik Nagpal (HB+_030) - May 2026
  {
    coach_id: "HB+_030",
    period_month: "May 2026",
    period_start: "2026-04-16",
    period_end: "2026-05-15",
    prof_appearance: 18,
    client_engagement: 19,
    safety: 14,
    punctuality: 8,
    team_conduct: 12,
    communication: 18,
    attendance_pct: 80.0,
    sessions_completed: 0.0,
    night_sessions: 0,
    five_star_streak: 11,
    status: "FINANCE_LOCKED",
    hb_score: 68.00,
    band: "60–70 Good"
  }
];

// Current live month data (June 2026 - e.g. 16 May to 15 Jun)
export const INITIAL_CURRENT_MONTH = [
  {
    coach_id: "HB+_023",
    period_month: "June 2026",
    period_start: "2026-05-16",
    period_end: "2026-06-15",
    prof_appearance: 16,
    client_engagement: 19,
    safety: 12,
    punctuality: 6,
    team_conduct: 10,
    communication: 10,
    attendance_pct: 95.0,
    sessions_completed: 162.0,
    night_sessions: 0,
    five_star_streak: 10,
    status: "DRAFT"
  },
  {
    coach_id: "HB+_026",
    period_month: "June 2026",
    period_start: "2026-05-16",
    period_end: "2026-06-15",
    prof_appearance: 16,
    client_engagement: 19,
    safety: 12,
    punctuality: 3,
    team_conduct: 5,
    communication: 10,
    attendance_pct: 80.0,
    sessions_completed: 110.0,
    night_sessions: 12,
    five_star_streak: 6,
    status: "DRAFT"
  },
  {
    coach_id: "HB+_030",
    period_month: "June 2026",
    period_start: "2026-05-16",
    period_end: "2026-06-15",
    prof_appearance: 18,
    client_engagement: 19,
    safety: 14,
    punctuality: 8,
    team_conduct: 12,
    communication: 18,
    attendance_pct: 96.0,
    sessions_completed: 185.0,
    night_sessions: 0,
    five_star_streak: 15,
    status: "DRAFT"
  },
  {
    coach_id: "HB+_130",
    period_month: "June 2026",
    period_start: "2026-05-16",
    period_end: "2026-06-15",
    prof_appearance: 19,
    client_engagement: 19,
    safety: 14,
    punctuality: 9,
    team_conduct: 15,
    communication: 18,
    attendance_pct: 98,
    sessions_completed: 128,
    night_sessions: 0,
    five_star_streak: 20,
    status: "DRAFT"
  },
  {
    coach_id: "HB+_131",
    period_month: "June 2026",
    period_start: "2026-05-16",
    period_end: "2026-06-15",
    prof_appearance: 14,
    client_engagement: 15,
    safety: 11,
    punctuality: 7,
    team_conduct: 11,
    communication: 13,
    attendance_pct: 88,
    sessions_completed: 104,
    night_sessions: 8,
    five_star_streak: 4,
    trial_sessions_completed: 6,
    half_day_events: 1,
    full_day_events: 0,
    status: "DRAFT"
  },
  {
    coach_id: "HB+_132",
    period_month: "June 2026",
    period_start: "2026-05-16",
    period_end: "2026-06-15",
    prof_appearance: 17,
    client_engagement: 17,
    safety: 13,
    punctuality: 9,
    team_conduct: 14,
    communication: 16,
    attendance_pct: 96,
    sessions_completed: 160,
    night_sessions: 0,
    five_star_streak: 12,
    ooh_sessions_completed: 5,
    pt_home_sessions_completed: 8,
    performance_credits_points: 12,
    status: "DRAFT"
  }
];

// Seed Org Work Items Claimed
export const INITIAL_ORG_WORK = [
  { id: "OW_01", coach_id: "HB+_131", period_month: "June 2026", work_type: "Workout Planning / Programming", amount: 3500, approved_by: "HR_01", status: "Approved" }
];

// Seed Violations Register
export const INITIAL_VIOLATIONS = [
  // Historic violations
  {
    id: "VIO_01",
    coach_id: "HB+_023",
    type: "Late Arrival (<5 min)",
    occurrence_no: 1,
    consequence: "₹100 fine",
    penalty_amount: 100,
    incident_date: "2026-04-20",
    reported_by: "RM_01",
    status: "Acknowledged"
  },
  {
    id: "VIO_02",
    coach_id: "HB+_023",
    type: "Late Arrival (<5 min)",
    occurrence_no: 2,
    consequence: "₹150 fine",
    penalty_amount: 150,
    incident_date: "2026-05-02",
    reported_by: "RM_01",
    status: "Acknowledged"
  }
];

// Detailed progressive penalty structures for S&C, Yoga, and HOP
export const PENALTY_MATRIX = {
  // V1 - Internal S&C
  "V1": {
    "Late Arrival (<5 min)": [
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "₹150 Fine", amount: 150 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹250 Fine", amount: 250 }
    ],
    "Late Arrival (>5 min)": [
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹250 Fine", amount: 250 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "1-Day Unpaid Suspension", amount: 1000 }
    ],
    "Coach No-Show": [
      { consequence: "₹350 Fine", amount: 350 },
      { consequence: "₹450 Fine", amount: 450 },
      { consequence: "₹550 Fine", amount: 550 },
      { consequence: "₹650 Fine", amount: 650 }
    ],
    "Unplanned Absence (<4 hrs notice)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "Allocation Reduction", amount: 0 }
    ],
    "Repeated Roster Violations": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Reduced Session Allocation", amount: 0 },
      { consequence: "₹500 Fine", amount: 500 },
      { consequence: "HR Formal Review", amount: 0 }
    ]
  },
  // V2 - External S&C
  "V2": {
    "Late Arrival (<5 min)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Priority Allocation Drop", amount: 0 },
      { consequence: "₹50 Fine", amount: 50 },
      { consequence: "₹100 Fine", amount: 100 }
    ],
    "Late Arrival (>5 min)": [
      { consequence: "₹50 Fine", amount: 50 },
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "1-Day Unpaid Suspension", amount: 500 }
    ],
    "Coach No-Show": [
      { consequence: "Deduct 1 Session Pay", amount: 240 },
      { consequence: "Deduct 2 Sessions Pay", amount: 480 },
      { consequence: "Deduct 4 Sessions Pay", amount: 960 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ],
    "Unplanned Absence (<4 hrs notice)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "Session Allocation Reduction", amount: 0 }
    ],
    "Repeated Roster Violations": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Reduced Session Allocation", amount: 0 },
      { consequence: "Loss of Milestone Eligibility", amount: 0 },
      { consequence: "HR Formal Review", amount: 0 }
    ]
  },
  // V3 - Internal Yoga
  "V3": {
    "Late Arrival (<5 min)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Priority Allocation Drop", amount: 0 },
      { consequence: "₹75 Fine", amount: 75 },
      { consequence: "₹125 Fine", amount: 125 }
    ],
    "Late Arrival (>5 min)": [
      { consequence: "₹75 Fine", amount: 75 },
      { consequence: "₹125 Fine", amount: 125 },
      { consequence: "₹250 Fine", amount: 250 },
      { consequence: "1-Day Unpaid Suspension", amount: 1500 }
    ],
    "Coach No-Show": [
      { consequence: "Deduct 1 Session Pay", amount: 320 },
      { consequence: "Deduct 2 Sessions Pay", amount: 640 },
      { consequence: "Deduct 4 Sessions Pay", amount: 1280 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ],
    "Unplanned Absence (<4 hrs notice)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹125 Fine", amount: 125 },
      { consequence: "₹250 Fine", amount: 250 },
      { consequence: "Session Allocation Reduction", amount: 0 }
    ],
    "Repeated Roster Violations": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Reduced Session Allocation", amount: 0 },
      { consequence: "Loss of Milestone Eligibility", amount: 0 },
      { consequence: "HR Formal Review", amount: 0 }
    ]
  },
  // V4 - External Yoga
  "V4": {
    "Late Arrival (<5 min)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Priority Allocation Drop", amount: 0 },
      { consequence: "₹50 Fine", amount: 50 },
      { consequence: "₹100 Fine", amount: 100 }
    ],
    "Late Arrival (>5 min)": [
      { consequence: "₹50 Fine", amount: 50 },
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "1-Day Unpaid Suspension", amount: 500 }
    ],
    "Coach No-Show": [
      { consequence: "Deduct 1 Session Pay", amount: 280 },
      { consequence: "Deduct 2 Sessions Pay", amount: 560 },
      { consequence: "Deduct 4 Sessions Pay", amount: 1120 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ],
    "Unplanned Absence (<4 hrs notice)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "Allocation Reduction", amount: 0 }
    ],
    "Repeated Roster Violations": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Reduced Session Allocation", amount: 0 },
      { consequence: "Loss of Milestone Eligibility", amount: 0 },
      { consequence: "HR Formal Review", amount: 0 }
    ]
  },
  // V5 - HOP (16 violation types lookup)
  "V5": {
    "Late Arrival (<5 min)": [
      { consequence: "Written Warning", amount: 100 },
      { consequence: "₹150 Fine", amount: 150 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹250 Fine", amount: 250 }
    ],
    "Late Arrival (>5 min)": [
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹250 Fine", amount: 250 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "1-Day Unpaid Suspension", amount: 1000 }
    ],
    "Coach No-Show": [
      { consequence: "₹350 Fine", amount: 350 },
      { consequence: "₹450 Fine", amount: 450 },
      { consequence: "₹550 Fine", amount: 550 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ],
    "Unplanned Absence (<4 hrs notice)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "Allocation Reduction", amount: 0 }
    ],
    "Ignoring Roster / WhatsApp Messages": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "Slot Reassignment", amount: 0 },
      { consequence: "HR Review", amount: 0 }
    ],
    "Declining Session Under Capacity": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹150 Fine", amount: 150 },
      { consequence: "Loss of Lead Guarantee", amount: 0 },
      { consequence: "HR Review", amount: 0 }
    ],
    "Not Updating Session Data": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹50 Fine per session", amount: 50 },
      { consequence: "₹100 Fine per session", amount: 100 },
      { consequence: "Suspension", amount: 0 }
    ],
    "Unprofessional Appearance": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "Suspension", amount: 0 },
      { consequence: "Termination Review", amount: 0 }
    ],
    "Coach No-Show — No Communication": [
      { consequence: "₹500 Fine + Allocation Freeze", amount: 500 },
      { consequence: "₹1000 Fine + 3-Day Suspension", amount: 1000 },
      { consequence: "Termination Review", amount: 0 },
      { consequence: "Termination Review", amount: 0 }
    ],
    "Unauthorised Commitment to Client": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹500 Fine", amount: 500 },
      { consequence: "Suspension", amount: 0 },
      { consequence: "Termination Review", amount: 0 }
    ],
    "Collecting Payment Directly from Client": [
      { consequence: "₹1000 Fine + Written Warning", amount: 1000 },
      { consequence: "Immediate Termination Review", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ],
    "Sharing Client Data Externally": [
      { consequence: "Written Warning + Data Audit", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ],
    "Discussion About Internal Matters with Clients": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹500 Fine", amount: 500 },
      { consequence: "Suspension", amount: 0 },
      { consequence: "Termination Review", amount: 0 }
    ],
    "Posting Content Without Client Consent": [
      { consequence: "Written Warning + Take down", amount: 0 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "Suspension", amount: 0 },
      { consequence: "Termination Review", amount: 0 }
    ],
    "Inappropriate Behaviour / Touching Without Consent": [
      { consequence: "Immediate Suspension + Inquiry", amount: 0 },
      { consequence: "Termination Review", amount: 0 },
      { consequence: "Termination Review", amount: 0 },
      { consequence: "Termination Review", amount: 0 }
    ],
    "Client Safety Incident Due to Negligence": [
      { consequence: "Written Warning + Action Plan", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 },
      { consequence: "Immediate Termination Review", amount: 0 }
    ]
  },
  "default": {
    "Late Arrival (<5 min)": [
      { consequence: "₹100 Fine", amount: 100 },
      { consequence: "₹150 Fine", amount: 150 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹250 Fine", amount: 250 }
    ],
    "Late Arrival (>5 min)": [
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹250 Fine", amount: 250 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "1-Day Unpaid Suspension", amount: 1000 }
    ],
    "Coach No-Show": [
      { consequence: "₹350 Fine", amount: 350 },
      { consequence: "₹450 Fine", amount: 450 },
      { consequence: "₹550 Fine", amount: 550 },
      { consequence: "₹650 Fine", amount: 650 }
    ],
    "Unplanned Absence (<4 hrs notice)": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "₹200 Fine", amount: 200 },
      { consequence: "₹300 Fine", amount: 300 },
      { consequence: "Allocation Reduction", amount: 0 }
    ],
    "Repeated Roster Violations": [
      { consequence: "Written Warning", amount: 0 },
      { consequence: "Reduced Session Allocation", amount: 0 },
      { consequence: "₹500 Fine", amount: 500 },
      { consequence: "HR Formal Review", amount: 0 }
    ]
  }
};
