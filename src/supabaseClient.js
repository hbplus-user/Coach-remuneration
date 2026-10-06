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
  'five_star_streak', 'missed_sessions', 'hb_score', 'band', 'status', 'overrides',
  // Pay set for this month specifically, which the band must not overwrite.
  'fixed_pay_override', 'per_session_override',
  // What the cycle lost to Loss of Pay, and how much of it nobody could plan for.
  'lop_days', 'unplanned_lop_days'
];

const COACH_COLS = [
  'id', 'name', 'email', 'phone', 'gender', 'variant_id', 'coach_type',
  // Stage, working pattern and centre, for attendance and leave.
  'employment_stage', 'training_end_date', 'probation_end_date',
  'weekly_off_day', 'work_mode', 'centre_name', 'centre_lat', 'centre_lng',
  'coach_category', 'internal_designation', 'date_of_joining',
  'date_of_first_relevant_certification', 'freelance_past_exp_with_document',
  'freelance_past_exp_without_document', 'non_coaching_exp_years',
  'education_score_override', 'education_qualification', 'education_type',
  'reporting_manager_id', 'assigned_property', 'status', 'bank_account',
  'bank_holder_name', 'bank_name', 'bank_ifsc', 'bank_branch',
  'bank_account_type', 'bank_upi', 'pan_number',
  'fixed_salary_override', 'flexi_fixed_base_salary', 'per_session_override', 'certifications',
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
  'education_score_override', 'fixed_salary_override', 'flexi_fixed_base_salary',
  'per_session_override', 'fixed_pay_override',
  'training_end_date', 'probation_end_date', 'weekly_off_day',
  'centre_lat', 'centre_lng', 'lop_days', 'unplanned_lop_days'
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
      org_work_types: c.org_work_types ?? [],
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
    deleteBy: 'compound',
    keyColumns: ['coach_id', 'period_month']
  },
  currentMonth: {
    table: 'performance_records',
    key: r => `${r.coach_id}|${r.period_month}`,
    onConflict: 'coach_id,period_month',
    toRow: r => ({ ...pick(r, PERIOD_COLS), record_type: 'current', overrides: r.overrides ?? {} }),
    fromRow: r => r,
    deleteBy: 'compound',
    keyColumns: ['coach_id', 'period_month']
  },
  attendanceLogs: {
    table: 'attendance_logs',
    key: a => a.id,
    toRow: a => blanksToNull(pick(a, [
      'id', 'coach_id', 'working_day', 'logged_in_at', 'logged_out_at',
      'login_lat', 'login_lng', 'logout_lat', 'logout_lng', 'within_centre',
      'photo_path', 'photo_expires_at', 'auto_logged_out', 'late_by_minutes', 'notes'
    ]), DATE_ISH),
    fromRow: r => r
  },
  attendanceDays: {
    table: 'attendance_days',
    key: d => `${d.coach_id}|${d.working_day}`,
    onConflict: 'coach_id,working_day',
    toRow: d => blanksToNull(pick(d, [
      'coach_id', 'working_day', 'expected_hours', 'logged_hours', 'shortfall_hours',
      'outcome', 'lop_days', 'planned', 'disputed', 'dispute_note', 'resolved_by'
    ]), DATE_ISH),
    fromRow: r => r,
    deleteBy: 'compound',
    keyColumns: ['coach_id', 'working_day']
  },
  leaveBalances: {
    table: 'leave_balances',
    key: b => `${b.coach_id}|${b.leave_year}|${b.type_id}`,
    onConflict: 'coach_id,leave_year,type_id',
    toRow: b => blanksToNull(pick(b, [
      'coach_id', 'leave_year', 'type_id', 'opening', 'accrued', 'used',
      'adjusted', 'adjust_reason'
    ]), DATE_ISH),
    fromRow: r => r,
    deleteBy: 'compound',
    keyColumns: ['coach_id', 'leave_year', 'type_id']
  },
  leaveApplications: {
    table: 'leave_applications',
    key: a => a.id,
    toRow: a => blanksToNull(pick(a, [
      'id', 'coach_id', 'type_id', 'from_date', 'to_date', 'days', 'half_day',
      'reason', 'certificate', 'status', 'approved_days', 'approved_from',
      'approved_to', 'applied_at', 'applied_by', 'decided_by', 'decided_at',
      'decision_note', 'cancelled_at', 'cancel_note'
    ]), DATE_ISH),
    fromRow: r => r
  },
  holidays: {
    table: 'holidays',
    key: h => h.id,
    toRow: h => blanksToNull(pick(h, [
      'id', 'leave_year', 'holiday_date', 'name', 'centre_name'
    ]), DATE_ISH),
    fromRow: r => r
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
  // 'Coach' is assignable again: coaches sign in for attendance and leave, and
  // see their own month — their hours, leave, score, incidents and payslips.
  // A Coach must be linked to a coach record, or there is nothing to show them.
  'Super Admin', 'HR Manager', 'Finance', 'Showrunner', 'Reporting Manager', 'Coach'
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

  const [variants, certifications, educationFormats, educationLevels, coaches, periods, orgWork,
         attendanceLogs, attendanceDays, leaveBalances, leaveApplications, holidays,
         violations, appeals, auditLog, cycles] =
    await Promise.all([
      supabase.from('variants').select('*').order('id'),
      supabase.from('certifications').select('*').order('id'),
      supabase.from('education_formats').select('*').order('id'),
      supabase.from('education_levels').select('*').order('id'),
      supabase.from('coaches').select('*').order('id'),
      supabase.from('performance_records').select('*'),
      supabase.from('org_work').select('*'),
      supabase.from('attendance_logs').select('*').order('logged_in_at', { ascending: false }).limit(5000),
      supabase.from('attendance_days').select('*'),
      supabase.from('leave_balances').select('*'),
      supabase.from('leave_applications').select('*').order('applied_at', { ascending: false }),
      supabase.from('holidays').select('*').order('holiday_date'),
      supabase.from('violations').select('*').order('incident_date', { ascending: false }),
      supabase.from('appeals').select('*'),
      supabase.from('audit_log').select('*').order('timestamp', { ascending: false }).limit(500),
      supabase.from('payroll_cycles').select('*')
    ]);

  const failed = [variants, certifications, educationFormats, educationLevels, coaches, periods, orgWork,
                  attendanceLogs, attendanceDays, leaveBalances, leaveApplications, holidays,
                  violations, appeals, auditLog, cycles]
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
    attendanceLogs: attendanceLogs.data ?? [],
    attendanceDays: attendanceDays.data ?? [],
    leaveBalances: leaveBalances.data ?? [],
    leaveApplications: leaveApplications.data ?? [],
    holidays: holidays.data ?? [],
    violations: violations.data ?? [],
    appeals: (appeals.data ?? []).map(MAPPERS.appeals.fromRow),
    auditLog: (auditLog.data ?? []).map(MAPPERS.auditLog.fromRow),
    payrollLocked: openCycle?.locked ?? false,
    openPeriodMonth: openCycle?.period_month ?? null
  };
}

/**
 * Just the lock state, cheap enough to poll. A lock set by one person has to
 * reach everyone else's open tab without a reload, but re-reading the whole
 * state would fight with whatever they are editing, so this reads only the
 * columns that say what is locked.
 */
export async function loadLockState() {
  if (!supabase) return null;

  const [periods, cycles] = await Promise.all([
    supabase.from('performance_records').select('coach_id, period_month, status'),
    supabase.from('payroll_cycles').select('period_month, locked')
  ]);

  const failed = [periods, cycles].find(r => r.error);
  if (failed) throw failed.error;

  const openCycle = (cycles.data ?? []).find(c => !c.locked) ?? (cycles.data ?? [])[0];
  return {
    statuses: new Map((periods.data ?? []).map(r => [`${r.coach_id}|${r.period_month}`, r.status])),
    payrollLocked: openCycle?.locked ?? false
  };
}

// ---------------------------------------------------------------------------
// Login photographs
//
// Stored in a private bucket, reached through short-lived signed URLs. The
// database keeps the path only — the images themselves never travel with the
// app's state.
// ---------------------------------------------------------------------------

export const ATTENDANCE_PHOTO_BUCKET = 'attendance-photos';

/**
 * Put one photograph in the bucket and return its path.
 *
 * Foldered by coach and dated, so the archive an administrator downloads is
 * already organised and a path is readable on its own.
 */
export async function uploadAttendancePhoto(coachId, when, blob) {
  if (!supabase) return null;
  const d = new Date(when);
  const stamp = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
    + `_${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  const path = `${coachId}/${stamp}.jpg`;

  const { error } = await supabase.storage
    .from(ATTENDANCE_PHOTO_BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg', upsert: true });
  if (error) throw error;
  return path;
}

const pad2 = (n) => String(n).padStart(2, '0');

/**
 * Signed URLs for a set of paths, valid for an hour.
 *
 * Returned in the order asked for, with nulls where one could not be signed,
 * so a caller zipping them can say which were missing rather than silently
 * producing a shorter archive.
 */
export async function signedPhotoUrls(paths, expiresIn = 3600) {
  if (!supabase || !paths?.length) return [];
  const { data, error } = await supabase.storage
    .from(ATTENDANCE_PHOTO_BUCKET)
    .createSignedUrls(paths, expiresIn);
  if (error) throw error;
  const byPath = new Map((data ?? []).map(d => [d.path, d.signedUrl ?? null]));
  return paths.map(p => byPath.get(p) ?? null);
}

/** Remove photographs from the bucket. Used by retention, not by correction. */
export async function deleteAttendancePhotos(paths) {
  if (!supabase || !paths?.length) return { removed: 0 };
  const { error } = await supabase.storage.from(ATTENDANCE_PHOTO_BUCKET).remove(paths);
  if (error) throw error;
  return { removed: paths.length };
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

  // `historicMonths` and `currentMonth` are two views of one table, sharing one
  // key space. Deciding deletions per collection meant a row that had simply
  // moved between them — which is what closing a cycle does to every record —
  // was upserted by the collection that gained it and then deleted by the one
  // that lost it, destroying the month's data. Deletions are therefore judged
  // against every collection writing to that table, not just this one.
  const liveKeysByTable = new Map();
  for (const name of SYNCED_COLLECTIONS) {
    const map = MAPPERS[name];
    if (!liveKeysByTable.has(map.table)) liveKeysByTable.set(map.table, new Set());
    const live = liveKeysByTable.get(map.table);
    for (const item of next?.[name] ?? []) live.add(map.key(item));
  }

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

    const stillLive = liveKeysByTable.get(map.table) ?? afterByKey;
    const removed = [...beforeByKey.keys()].filter(k => !stillLive.has(k));

    if (upserts.length) {
      const { error } = map.insertOnly
        ? await supabase.from(map.table).upsert(upserts, { onConflict: 'id', ignoreDuplicates: true })
        : await supabase.from(map.table).upsert(upserts, { onConflict: map.onConflict ?? 'id' });
      if (error) errors.push(`${map.table}: ${error.message}`);
    }

    if (removed.length && !map.insertOnly) {
      if (map.deleteBy === 'compound') {
        // These tables have no single-column key, so a row is identified by the
        // same columns its key is built from. Those columns are declared on the
        // mapper rather than assumed: this used to hardcode period_month, which
        // was right for performance_records and wrong for every table added
        // after it — a delete would have queried a column that does not exist.
        const cols = map.keyColumns;
        if (!cols?.length) {
          errors.push(`${map.table}: compound delete needs keyColumns on the mapper`);
        } else {
          for (const k of removed) {
            const parts = k.split('|');
            let q = supabase.from(map.table).delete();
            cols.forEach((col, i) => { q = q.eq(col, parts[i]); });
            const { error } = await q;
            if (error) errors.push(`${map.table}: ${error.message}`);
          }
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
