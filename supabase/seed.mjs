/**
 * Seeds Supabase from src/data.js.
 *
 *   npm i @supabase/supabase-js
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node supabase/seed.mjs
 *
 * Uses the SERVICE ROLE key (bypasses RLS) — run it locally only, never ship
 * that key to the browser. Every write is an upsert, so re-running is safe.
 */
import { createClient } from '@supabase/supabase-js';
import {
  INITIAL_VARIANTS,
  INITIAL_CERTIFICATIONS,
  INITIAL_COACHES,
  INITIAL_HISTORIC_MONTHS,
  INITIAL_CURRENT_MONTH,
  INITIAL_ORG_WORK,
  INITIAL_VIOLATIONS,
  PENALTY_MATRIX
} from '../src/data.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const push = async (table, rows, onConflict) => {
  if (!rows.length) return;
  const { error } = await db.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
  console.log(`  ✓ ${table.padEnd(21)} ${rows.length} rows`);
};

// Only columns the table actually has; drop undefined so defaults apply.
const pick = (obj, keys) =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));

const PERIOD_COLS = [
  'coach_id','period_month','period_start','period_end','prof_appearance',
  'client_engagement','safety','punctuality','team_conduct','communication',
  'meetings_scheduled','meetings_attended','attendance_pct','sessions_completed',
  'night_sessions','ooh_sessions_completed','pt_home_sessions_completed',
  'five_star_streak','hb_score','band','status','overrides'
];

console.log('Seeding Supabase…');

await push('variants', INITIAL_VARIANTS.map(v => ({
  id: v.id, name: v.name, discipline: v.discipline, audience: v.audience,
  property: v.property, is_active: v.is_active,
  weights: v.weights ?? {}, rates: v.rates ?? {}, milestones: v.milestones ?? {}
})), 'id');

await push('certifications', INITIAL_CERTIFICATIONS.map(c => ({
  id: c.id, variant_type: c.variant_type, authority: c.authority,
  course_name: c.course_name, level: c.level, score: c.score,
  pdf_name: c.pdfName ?? null, pdf_data: c.pdfData ?? null
})), 'id');

await push('coaches', INITIAL_COACHES.map(c => ({
  ...pick(c, [
    'id','name','email','phone','gender','variant_id','coach_type','coach_category',
    'internal_designation','date_of_joining','date_of_first_relevant_certification',
    'freelance_past_exp_with_document','freelance_past_exp_without_document',
    'non_coaching_exp_years','education_score_override','education_qualification',
    'education_type','reporting_manager_id','assigned_property','status',
    'bank_account','fixed_salary_override','flexi_fixed_base_salary','five_star_streak'
  ]),
  certifications: c.certifications ?? [],
  pdf_name: c.pdfName ?? null,
  pdf_data: c.pdfData ?? null
})), 'id');

await push('performance_records', [
  ...INITIAL_HISTORIC_MONTHS.map(r => ({ ...pick(r, PERIOD_COLS), record_type: 'historic' })),
  ...INITIAL_CURRENT_MONTH.map(r => ({ ...pick(r, PERIOD_COLS), record_type: 'current' }))
], 'coach_id,period_month');

await push('org_work', INITIAL_ORG_WORK.map(o => pick(o, [
  'id','coach_id','period_month','work_type','amount','approved_by','status','notes'
])), 'id');

await push('violations', INITIAL_VIOLATIONS.map(v => pick(v, [
  'id','coach_id','type','occurrence_no','consequence','penalty_amount',
  'incident_date','incident_time','reported_by','evidence','status'
])), 'id');

// Flatten PENALTY_MATRIX: { V1: { "Late Arrival": [ {consequence, amount}, ... ] } }
const penaltyRows = Object.entries(PENALTY_MATRIX).flatMap(([variant_id, types]) =>
  Object.entries(types).flatMap(([violation_type, steps]) =>
    steps.map((s, i) => ({
      variant_id, violation_type, occurrence_no: i + 1,
      consequence: s.consequence, amount: s.amount ?? 0
    }))
  )
);
await push('penalty_matrix', penaltyRows, 'variant_id,violation_type,occurrence_no');

const open = INITIAL_CURRENT_MONTH[0];
if (open) {
  await push('payroll_cycles', [{
    period_month: open.period_month,
    period_start: open.period_start,
    period_end: open.period_end,
    locked: false
  }], 'period_month');
}

console.log('Done.');
