/**
 * Supabase wiring for the HB+ dashboard.
 *
 * The app keeps its whole world in a handful of useState arrays. Rather than
 * rewrite every handler, this module:
 *   - loads those arrays back out of Postgres in the exact shape App.jsx wants
 *     (`loadState`), and
 *   - diffs the previous snapshot against the next one and issues only the
 *     upserts/deletes that changed (`syncState`).
 *
 * So every existing `setCoaches(...)` / `setViolations(...)` call keeps working
 * and the write-through happens in one debounced effect.
 *
 * Browser-safe: anon key only, every statement goes through RLS.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  console.warn(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing — the app will fall back to localStorage.'
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // OAuth sends the user back with the session in the URL fragment;
        // supabase-js picks it up and then we strip it in AuthGate.
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    })
  : null;

// ---------------------------------------------------------------------------
// Field mappers. The DB is snake_case; two app fields (pdfData/pdfName) are not.
// ---------------------------------------------------------------------------

const PERIOD_COLS = [
  'coach_id', 'period_month', 'period_start', 'period_end', 'prof_appearance',
  'client_engagement', 'safety', 'punctuality', 'team_conduct', 'communication',
  'meetings_scheduled', 'meetings_attended', 'attendance_pct', 'sessions_completed',
  'night_sessions', 'ooh_sessions_completed', 'pt_home_sessions_completed',
  'five_star_streak', 'hb_score', 'band', 'status', 'overrides'
];

const COACH_COLS = [
  'id', 'name', 'email', 'phone', 'gender', 'variant_id', 'coach_type',
  'coach_category', 'internal_designation', 'date_of_joining',
  'date_of_first_relevant_certification', 'freelance_past_exp_with_document',
  'freelance_past_exp_without_document', 'non_coaching_exp_years',
  'education_score_override', 'education_qualification', 'education_type',
  'reporting_manager_id', 'assigned_property', 'status', 'bank_account',
  'fixed_salary_override', 'flexi_fixed_base_salary', 'certifications',
  'five_star_streak'
];

const pick = (obj, keys) =>
  Object.fromEntries(keys.filter(k => obj[k] !== undefined).map(k => [k, obj[k]]));

// Empty strings must become null for date/numeric columns, or Postgres rejects them.
const blanksToNull = (row, keys) => {
  const out = { ...row };
  for (const k of keys) if (out[k] === '') out[k] = null;
  return out;
};

const DATE_ISH = [
  'date_of_joining', 'date_of_first_relevant_certification', 'incident_date',
  'education_score_override', 'fixed_salary_override', 'flexi_fixed_base_salary'
];

const MAPPERS = {
  variants: {
    table: 'variants',
    key: v => v.id,
    toRow: v => ({
      ...pick(v, ['id', 'name', 'discipline', 'audience', 'property', 'is_active']),
      weights: v.weights ?? {},
      rates: v.rates ?? {},
      milestones: v.milestones ?? {}
    }),
    fromRow: r => r
  },
  certifications: {
    table: 'certifications',
    key: c => c.id,
    toRow: c => ({
      ...pick(c, ['id', 'variant_type', 'authority', 'course_name', 'level', 'score']),
      pdf_name: c.pdfName || null,
      pdf_data: c.pdfData || null
    }),
    fromRow: r => {
      const { pdf_name, pdf_data, created_at, updated_at, ...rest } = r;
      return { ...rest, pdfName: pdf_name ?? '', pdfData: pdf_data ?? '' };
    }
  },
  educationFormats: {
    table: 'education_formats',
    // The app carries { value, label }; the table keys on the stored value.
    key: f => f.value,
    toRow: f => ({ id: f.value, label: f.label }),
    fromRow: r => ({ value: r.id, label: r.label })
  },
  educationLevels: {
    table: 'education_levels',
    key: l => l.id,
    toRow: l => ({
      id: l.id,
      qualification: l.qualification,
      format: l.format,
      score: Number(l.score) || 0
    }),
    fromRow: r => {
      const { created_at, updated_at, ...rest } = r;
      return rest;
    }
  },
  coaches: {
    table: 'coaches',
    key: c => c.id,
    toRow: c => blanksToNull({
      ...pick(c, COACH_COLS),
      certifications: c.certifications ?? [],
      education: c.education ?? [],
      pdf_name: c.pdfName || null,
      pdf_data: c.pdfData || null
    }, DATE_ISH),
    fromRow: r => {
      const { pdf_name, pdf_data, created_at, updated_at, ...rest } = r;
      return { ...rest, pdfName: pdf_name ?? '', pdfData: pdf_data ?? '' };
    }
  },
  historicMonths: {
    table: 'performance_records',
    key: r => `${r.coach_id}|${r.period_month}`,
    onConflict: 'coach_id,period_month',
    toRow: r => ({ ...pick(r, PERIOD_COLS), record_type: 'historic', overrides: r.overrides ?? {} }),
    fromRow: r => r,
    deleteBy: 'compound'
  },
  currentMonth: {
    table: 'performance_records',
    key: r => `${r.coach_id}|${r.period_month}`,
    onConflict: 'coach_id,period_month',
    toRow: r => ({ ...pick(r, PERIOD_COLS), record_type: 'current', overrides: r.overrides ?? {} }),
    fromRow: r => r,
    deleteBy: 'compound'
  },
  orgWork: {
    table: 'org_work',
    key: o => o.id,
    toRow: o => pick(o, ['id', 'coach_id', 'period_month', 'work_type', 'amount', 'approved_by', 'status', 'notes']),
    fromRow: r => r
  },
  violations: {
    table: 'violations',
    key: v => v.id,
    toRow: v => blanksToNull(pick(v, [
      'id', 'coach_id', 'type', 'occurrence_no', 'consequence', 'penalty_amount',
      'incident_date', 'incident_time', 'reported_by', 'evidence', 'status'
    ]), DATE_ISH),
    fromRow: r => r
  },
  appeals: {
    table: 'appeals',
    key: a => a.id,
    toRow: a => pick(a, [
      'id', 'coach_id', 'target_type', 'target_id', 'reason',
      'status', 'rm_remark', 'hr_remark'
    ]),
    fromRow: r => ({ ...r, raised_at: new Date(r.raised_at).toLocaleDateString('en-IN') })
  },
  auditLog: {
    table: 'audit_log',
    key: l => l.id,
    insertOnly: true,
    toRow: l => ({
      id: l.id,
      actor: l.actor,
      action: l.action,
      details: l.details,
      ip: l.ip,
      user_agent: l.userAgent
    }),
    fromRow: r => ({
      id: r.id,
      timestamp: new Date(r.timestamp).toLocaleString('en-IN'),
      actor: r.actor,
      action: r.action,
      details: r.details,
      ip: r.ip,
      userAgent: r.user_agent
    })
  }
};

export const SYNCED_COLLECTIONS = Object.keys(MAPPERS);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function getSession() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

/** Only this Google Workspace domain may sign in. */
export const ALLOWED_EMAIL_DOMAIN =
  import.meta.env.VITE_ALLOWED_EMAIL_DOMAIN || 'hbplus.fit';

export const isAllowedEmail = (email) =>
  typeof email === 'string' &&
  email.toLowerCase().endsWith(`@${ALLOWED_EMAIL_DOMAIN.toLowerCase()}`);

/**
 * Google OAuth, the only way in.
 *
 * `hd` asks Google to show just the work domain's accounts — a convenience,
 * not a control, since it can be edited out of the URL. The real enforcement
 * is the RLS domain check in schema.sql, backed by a sign-out here.
 *
 * redirectTo must be listed under Authentication -> URL Configuration ->
 * Redirect URLs in the Supabase dashboard or Google refuses the round-trip.
 */
export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
        hd: ALLOWED_EMAIL_DOMAIN
      }
    }
  });

export const signOut = () => supabase.auth.signOut();

/** The signed-in user's role + coach/RM binding from public.app_users. */
export async function loadProfile(userId) {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Role management (admins only — the checks live in the SQL functions)
// ---------------------------------------------------------------------------

export const APP_ROLES = [
  'Super Admin', 'HR Manager', 'Finance', 'Operations', 'Reporting Manager', 'Coach'
];

export const RM_SCOPES = [
  { id: 'RM_01', label: 'RM_01 — S&C' },
  { id: 'RM_02', label: 'RM_02 — Yoga' },
  { id: 'RM_03', label: 'RM_03 — HOP' }
];

/** Everyone who has signed in, newest first, unassigned accounts at the top. */
export async function listAppUsers() {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('admin_list_users');
  if (error) throw error;
  return data ?? [];
}

/** Assign a role and its binding. Returns the updated row. */
export async function setUserAccess({ id, role, coachId = null, rmId = null }) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('admin_set_access', {
    target_id: id,
    new_role: role,
    new_coach_id: coachId || null,
    new_rm_id: rmId || null
  });
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

/** Reads everything back in the shape App.jsx holds in useState. */
export async function loadState() {
  if (!supabase) return null;

  const [variants, certifications, educationFormats, educationLevels, coaches, periods, orgWork, violations, appeals, auditLog, cycles] =
    await Promise.all([
      supabase.from('variants').select('*').order('id'),
      supabase.from('certifications').select('*').order('id'),
      supabase.from('education_formats').select('*').order('id'),
      supabase.from('education_levels').select('*').order('id'),
      supabase.from('coaches').select('*').order('id'),
      supabase.from('performance_records').select('*'),
      supabase.from('org_work').select('*'),
      supabase.from('violations').select('*').order('incident_date', { ascending: false }),
      supabase.from('appeals').select('*'),
      supabase.from('audit_log').select('*').order('timestamp', { ascending: false }).limit(500),
      supabase.from('payroll_cycles').select('*')
    ]);

  const failed = [variants, certifications, educationFormats, educationLevels, coaches, periods, orgWork, violations, appeals, auditLog, cycles]
    .find(r => r.error);
  if (failed) throw failed.error;

  const rows = periods.data ?? [];
  const openCycle = (cycles.data ?? []).find(c => !c.locked) ?? (cycles.data ?? [])[0];

  return {
    variants: (variants.data ?? []).map(MAPPERS.variants.fromRow),
    certifications: (certifications.data ?? []).map(MAPPERS.certifications.fromRow),
    educationFormats: (educationFormats.data ?? []).map(MAPPERS.educationFormats.fromRow),
    educationLevels: (educationLevels.data ?? []).map(MAPPERS.educationLevels.fromRow),
    coaches: (coaches.data ?? []).map(MAPPERS.coaches.fromRow),
    historicMonths: rows.filter(r => r.record_type === 'historic'),
    currentMonth: rows.filter(r => r.record_type === 'current'),
    orgWork: orgWork.data ?? [],
    violations: violations.data ?? [],
    appeals: (appeals.data ?? []).map(MAPPERS.appeals.fromRow),
    auditLog: (auditLog.data ?? []).map(MAPPERS.auditLog.fromRow),
    payrollLocked: openCycle?.locked ?? false,
    openPeriodMonth: openCycle?.period_month ?? null
  };
}

/** True when the project is reachable but empty — i.e. the seed has not run. */
export async function isDatabaseEmpty() {
  if (!supabase) return false;
  const { count, error } = await supabase
    .from('coaches')
    .select('id', { count: 'exact', head: true });
  if (error) throw error;
  return (count ?? 0) === 0;
}

// ---------------------------------------------------------------------------
// Write-through
// ---------------------------------------------------------------------------

const sameRow = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Diffs `prev` against `next` collection by collection and writes only what
 * changed. Returns a list of human-readable errors (empty when all went well).
 */
export async function syncState(prev, next) {
  if (!supabase) return [];
  const errors = [];

  for (const name of SYNCED_COLLECTIONS) {
    const map = MAPPERS[name];
    const before = prev?.[name] ?? [];
    const after = next?.[name] ?? [];
    if (before === after) continue;

    const beforeByKey = new Map(before.map(x => [map.key(x), x]));
    const afterByKey = new Map(after.map(x => [map.key(x), x]));

    const upserts = [];
    for (const [k, item] of afterByKey) {
      const old = beforeByKey.get(k);
      if (!old || !sameRow(map.toRow(old), map.toRow(item))) upserts.push(map.toRow(item));
    }

    const removed = [...beforeByKey.keys()].filter(k => !afterByKey.has(k));

    if (upserts.length) {
      const { error } = map.insertOnly
        ? await supabase.from(map.table).upsert(upserts, { onConflict: 'id', ignoreDuplicates: true })
        : await supabase.from(map.table).upsert(upserts, { onConflict: map.onConflict ?? 'id' });
      if (error) errors.push(`${map.table}: ${error.message}`);
    }

    if (removed.length && !map.insertOnly) {
      if (map.deleteBy === 'compound') {
        // performance_records has no single-column key; delete pair by pair.
        for (const k of removed) {
          const [coachId, month] = k.split('|');
          const { error } = await supabase
            .from(map.table).delete()
            .eq('coach_id', coachId).eq('period_month', month);
          if (error) errors.push(`${map.table}: ${error.message}`);
        }
      } else {
        const { error } = await supabase.from(map.table).delete().in('id', removed);
        if (error) errors.push(`${map.table}: ${error.message}`);
      }
    }
  }

  // payrollLocked lives on the open cycle row rather than in a collection.
  if (prev && prev.payrollLocked !== next.payrollLocked && next.openPeriodMonth) {
    const { error } = await supabase
      .from('payroll_cycles')
      .update({
        locked: next.payrollLocked,
        locked_at: next.payrollLocked ? new Date().toISOString() : null
      })
      .eq('period_month', next.openPeriodMonth);
    if (error) errors.push(`payroll_cycles: ${error.message}`);
  }

  return errors;
}
