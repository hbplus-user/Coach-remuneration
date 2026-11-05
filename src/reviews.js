/**
 * The HB+ admin API: coach reviews, and the session summary for a pay cycle.
 *
 * The streak is the one figure on the score card that is genuinely countable
 * from the feedback feed rather than judged, so it is the one worth fetching.
 * Everything here is pure except `fetchReviews`, so the counting can be
 * checked without a network.
 */

export const REVIEW_API_DEFAULT = 'https://admin.hbplus.fit/api/v1/feedbacks';

/**
 * A base as a URL. A relative one ("/api/hb/feedbacks") is this app's own
 * proxy and resolves against the page; `new URL` alone would throw on it.
 */
const apiURL = (base) => new URL(
  base,
  typeof window === 'undefined' ? 'https://localhost' : window.location.origin
);

/** Where a failed call was going, for an error message. */
const apiHost = (base) => {
  try { return apiURL(base).host || String(base); } catch { return String(base); }
};

/**
 * Where a review's rating and date live is not documented anywhere we control,
 * and a field renamed upstream would otherwise read as "no reviews" rather
 * than as a failure. So the shape is detected and reported, never assumed.
 */
const RATING_KEYS = [
  'rating', 'ratings', 'star', 'stars', 'star_rating', 'starRating',
  'score', 'value', 'feedback_rating', 'overall_rating', 'overallRating'
];
const DATE_KEYS = [
  'created_at', 'createdAt', 'date', 'submitted_at', 'submittedAt',
  'feedback_date', 'feedbackDate', 'updated_at', 'updatedAt', 'time'
];
const ID_KEYS = ['id', '_id', 'uuid', 'feedback_id', 'feedbackId'];

const firstKey = (obj, keys) => keys.find(k =>
  obj[k] !== undefined && obj[k] !== null && obj[k] !== '');

/**
 * The array of reviews, wherever the payload keeps it.
 *
 * A bare array, or one under any of the usual envelope keys, including one
 * level of nesting — `{ data: { feedbacks: [...] } }` is as common as
 * `{ data: [...] }` and failing on it would look like an empty feed.
 */
export const extractReviews = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const KEYS = ['result', 'data', 'feedbacks', 'results', 'items', 'records', 'rows', 'list'];
  for (const k of KEYS) {
    if (Array.isArray(payload[k])) return payload[k];
  }
  for (const k of KEYS) {
    const inner = payload[k];
    if (inner && typeof inner === 'object') {
      for (const k2 of KEYS) if (Array.isArray(inner[k2])) return inner[k2];
    }
  }
  return [];
};

/**
 * One review reduced to what the streak needs: a rating and when it happened.
 * Returns null for a row with no readable rating rather than scoring it zero,
 * which would break a streak that never actually broke.
 */
export const normaliseReview = (raw) => {
  if (!raw || typeof raw !== 'object') return null;

  const rKey = firstKey(raw, RATING_KEYS);
  if (!rKey) return null;
  const rating = Number(raw[rKey]);
  if (!Number.isFinite(rating)) return null;

  const dKey = firstKey(raw, DATE_KEYS);
  const at = dKey ? new Date(raw[dKey]) : null;

  const iKey = firstKey(raw, ID_KEYS);

  return {
    id: iKey ? String(raw[iKey]) : null,
    rating,
    at: at && !Number.isNaN(at.getTime()) ? at : null,
    ratingField: rKey,
    dateField: dKey || null
  };
};

/**
 * What a payload turned into, including why rows were dropped. The caller
 * shows this before anything is written, because a silent zero and a parse
 * failure look identical on a score card.
 */
export const parseReviews = (payload) => {
  const rows = extractReviews(payload);
  const reviews = [];
  let unreadable = 0;
  for (const r of rows) {
    const n = normaliseReview(r);
    if (n) reviews.push(n); else unreadable += 1;
  }
  // Oldest first: a streak is an order, so an undated feed cannot be counted
  // reliably and the caller is told as much.
  reviews.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0));
  return {
    reviews,
    total: rows.length,
    unreadable,
    undated: reviews.filter(r => !r.at).length,
    ratingField: reviews[0]?.ratingField ?? null,
    dateField: reviews[0]?.dateField ?? null,
    maxSeen: reviews.reduce((m, r) => Math.max(m, r.rating), 0)
  };
};

const inWindow = (d, from, to) => {
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
};

/**
 * The 5-Star Streak for a period.
 *
 * Reviews and streak-breaking incidents are walked together in time order. A
 * rating below five breaks the run, and so does a violation — the policy the
 * pay engine already states: "Streak resets to 0 on any violation, Coach
 * No-Show, or Client No-Show."
 *
 * The figure reported is the LONGEST run inside the period, which is what the
 * score card's "5-Star Streak Count · consecutive" asks for and what the bonus
 * then divides by ten. A month holding two separate runs of six does not make
 * twelve: they were not consecutive.
 */
export const fiveStarStreak = (reviews, breakers = [], { from = null, to = null } = {}) => {
  const events = [];
  for (const r of reviews) {
    if (!inWindow(r.at, from, to)) continue;
    events.push({ at: r.at, kind: 'review', rating: r.rating });
  }
  for (const b of breakers) {
    const at = b instanceof Date ? b : new Date(b);
    if (Number.isNaN(at.getTime()) || !inWindow(at, from, to)) continue;
    events.push({ at, kind: 'break' });
  }
  // A breaker landing the same moment as a review ends the run that review
  // would have extended, so it is ordered after it.
  events.sort((a, b) => (a.at - b.at) || (a.kind === 'break' ? 1 : -1));

  let run = 0;
  let longest = 0;
  let fiveStars = 0;
  const runs = [];
  for (const e of events) {
    if (e.kind === 'break' || e.rating < 5) {
      if (run > 0) runs.push(run);
      run = 0;
      continue;
    }
    fiveStars += 1;
    run += 1;
    if (run > longest) longest = run;
  }
  if (run > 0) runs.push(run);

  return {
    streak: longest,
    longest,
    current: run,
    runs,
    fiveStars,
    considered: events.filter(e => e.kind === 'review').length,
    breaks: events.filter(e => e.kind === 'break').length
  };
};

/**
 * Fetch every review for one coach, following the limit in pages.
 *
 * `limit` is a cap, not a promise: a coach past it would otherwise come back
 * truncated and silently short, which is exactly how the 1000-row default on
 * the database hid most of the history. So pages are requested until one comes
 * back short, and the caller is told if the guard stopped it early.
 */
export async function fetchReviews(appCoachId, {
  base = REVIEW_API_DEFAULT,
  limit = 300,
  token = null,
  activeOnly = true,
  maxPages = 40,
  signal
} = {}) {
  if (!appCoachId) return { ok: false, why: 'This coach has no app ID set.' };

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  const all = [];
  let page = 0;
  let truncated = false;

  for (;;) {
    const url = apiURL(base);
    url.searchParams.set('feedback_to', appCoachId);
    url.searchParams.set('limit', String(limit));
    if (activeOnly) url.searchParams.set('is_active', 'true');
    if (page > 0) url.searchParams.set('offset', String(page * limit));

    let res;
    try {
      res = await fetch(url.toString(), {
        headers,
        // The admin session is a cookie on admin.hbplus.fit. Sending it needs
        // the server to allow this origin with credentials; where it does not,
        // the failure is reported rather than guessed at.
        credentials: token ? 'omit' : 'include',
        signal
      });
    } catch (e) {
      return {
        ok: false,
        why: page === 0
          ? `Could not reach ${apiHost(base)}. If the browser console shows a CORS error, the admin API has to allow this site's origin — that cannot be fixed from here.`
          : `Fetched ${all.length} reviews, then the connection failed: ${e.message}`
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        why: res.status === 401 || res.status === 403
          ? `The API refused the request (${res.status}). It needs an admin token. — Using the bundled proxy: set HB_ADMIN_TOKEN in .env and restart the dev server. Calling admin.hbplus.fit directly: paste a token into the API access box above. The token is the Authorization header your own admin.hbplus.fit session sends — DevTools, Network, any /api/v1/ request.`
          : `The API answered ${res.status} ${res.statusText}.`
      };
    }

    let payload;
    try { payload = await res.json(); }
    catch { return { ok: false, why: 'The API did not return JSON.' }; }

    const batch = extractReviews(payload);
    all.push(...batch);

    // Advance by what came back, and stop on a short page — the only reliable
    // end marker when the total is not stated.
    if (batch.length < limit) break;
    page += 1;
    if (page >= maxPages) { truncated = true; break; }
  }

  return { ok: true, raw: all, truncated, ...parseReviews(all) };
}


/* ---------------------------------------------------------------------------
 * Session summary
 *
 * How many sessions a coach completed, missed and had cancelled in a window.
 * Two of those are manual cells on the score card that someone currently reads
 * off the app and types in, so they are worth fetching.
 * ------------------------------------------------------------------------ */

export const SESSION_API_DEFAULT =
  'https://admin.hbplus.fit/api/v1/dashboard/coach-session-summary';

/**
 * The window is epoch milliseconds at IST midnight, not UTC and not seconds.
 * The sample URL pins this down: 1792089000000 is 16 Oct 2026 00:00 IST, a pay
 * cycle start to the millisecond. Getting the zone wrong would shift the
 * window five and a half hours and quietly move sessions between cycles.
 */
export const istDayStart = (isoDay) => new Date(`${isoDay}T00:00:00+05:30`).getTime();
export const istDayEnd = (isoDay) => new Date(`${isoDay}T23:59:59.999+05:30`).getTime();

const COMPLETED_KEYS = [
  'completed', 'completed_sessions', 'completedSessions', 'total_completed',
  'totalCompleted', 'sessions_completed', 'sessionsCompleted', 'complete', 'done'
];
// Two different no-shows, and they are not interchangeable. `i_missed` is the
// coach failing to turn up — chargeable. `we_missed_you` is the member not
// turning up — the coach held the slot and is normally still paid for it.
// Counting them as one figure would dock a coach for members who stood them up,
// so they are read, stored and shown separately and never added together.
const COACH_MISSED_KEYS = [
  'i_missed', 'iMissed', 'coach_missed', 'coachMissed', 'coach_no_show',
  'missed', 'missed_sessions', 'missedSessions', 'total_missed', 'totalMissed',
  'no_show', 'noShow', 'noshow', 'absent'
];
const MEMBER_MISSED_KEYS = [
  'we_missed_you', 'weMissedYou', 'we_missed', 'member_missed', 'memberMissed',
  'client_missed', 'clientMissed', 'user_missed', 'userMissed'
];
const TOTAL_KEYS = ['total_session', 'totalSession', 'total_sessions', 'totalSessions', 'total'];

// Where the counts live when they are not flat on the row.
const COUNT_CONTAINERS = [
  'statusCounts', 'status_counts', 'statuses', 'counts',
  'sessionCounts', 'session_counts'
];

// A per-country (or per-anything) breakdown of the very same sessions. Folding
// it in as well would count every session twice.
const BREAKDOWN_KEYS = ['userLists', 'user_lists', 'userList', 'breakdown', 'rows'];
const CANCELLED_KEYS = [
  'cancelled', 'canceled', 'cancelled_sessions', 'cancelledSessions',
  'canceled_sessions', 'total_cancelled', 'totalCancelled'
];

/** A row's counts, lifted out of `statusCounts` if that is where they sit. */
const countsIn = (row) => {
  if (!row || typeof row !== 'object') return null;
  for (const k of COUNT_CONTAINERS) {
    if (row[k] && typeof row[k] === 'object' && !Array.isArray(row[k])) {
      return { ...row, ...row[k] };
    }
  }
  return row;
};

/** Several summary rows added into one. Breakdowns of the same sessions are
 *  skipped, and only real numbers are added — "" is not a zero. */
const sumRows = (rows) => {
  const out = {};
  let any = false;
  for (const row of rows) {
    const c = countsIn(row);
    if (!c) continue;
    for (const [k, v] of Object.entries(c)) {
      if (BREAKDOWN_KEYS.includes(k)) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[k] = (out[k] || 0) + v;
      any = true;
    }
  }
  return any ? out : null;
};

const numberAt = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(typeof v === 'object' ? (v.count ?? v.total ?? v.value) : v);
    if (Number.isFinite(n)) return { value: n, field: k };
  }
  return null;
};

/**
 * The counts, whatever shape they arrive in — a flat object, one wrapped in an
 * envelope, or a list of one row per status. A field that cannot be found is
 * reported as missing rather than counted as zero: a coach who completed no
 * sessions and a field we failed to read look identical on a score card, and
 * only one of them should reach payroll.
 */
export const parseSessionSummary = (payload) => {
  let obj = payload;
  for (const k of ['data', 'summary', 'result', 'results', 'sessions']) {
    if (obj && typeof obj === 'object' && !Array.isArray(obj) && obj[k] !== undefined) {
      obj = obj[k];
      break;
    }
  }

  // An empty result is an answer, not a failure: this coach had no sessions in
  // this window. Saying "no readable counts" for it sends someone hunting a
  // bug in the parser when the month was simply quiet, or the coach had not
  // started yet.
  if (Array.isArray(obj) && obj.length === 0) {
    return {
      ok: false,
      empty: true,
      why: 'The app has no sessions for this coach in this window. That is the '
         + 'app\'s answer, not a failure to read it \u2014 check the coach had '
         + 'started by then, and that their App Coach ID is the right one.'
    };
  }

  if (Array.isArray(obj)) {
    // A list of { status, count } rows folded into one object...
    const folded = {};
    let foldedAny = false;
    for (const row of obj) {
      if (!row || typeof row !== 'object') continue;
      const label = String(row.status ?? row.label ?? row.name ?? row.type ?? '')
        .toLowerCase().replace(/[^a-z]/g, '');
      const n = Number(row.count ?? row.total ?? row.value ?? row.sessions);
      if (label && Number.isFinite(n)) { folded[label] = n; foldedAny = true; }
    }
    // ...or, as the live API actually sends it, one row per country, each
    // carrying its own statusCounts. Those add up to the coach's month.
    obj = foldedAny ? folded : sumRows(obj);
  } else {
    obj = countsIn(obj);
  }

  if (!obj || typeof obj !== 'object') {
    return { ok: false, why: 'The summary had no readable counts.' };
  }

  const c  = numberAt(obj, COMPLETED_KEYS);
  const im = numberAt(obj, COACH_MISSED_KEYS);
  const wm = numberAt(obj, MEMBER_MISSED_KEYS);
  const x  = numberAt(obj, CANCELLED_KEYS);
  const t  = numberAt(obj, TOTAL_KEYS);

  if (!c && !im && !wm && !x) {
    return {
      ok: false,
      why: 'None of completed, missed or cancelled could be found in the summary. ' +
           `It carried: ${Object.keys(obj).slice(0, 12).join(', ') || 'nothing'}.`
    };
  }

  // What the coach is paid for. A member who does not turn up has still had
  // the slot held for them and the coach is paid for it, so those sessions
  // belong in the month's count; the coach's own no-shows do not. The two
  // parts stay separate as well, because "92 sessions" and "85 worked, 7 stood
  // up" are different facts about a month and only one of them is a surprise.
  const payable = c
    ? c.value + (wm?.value ?? 0)
    : null;

  return {
    ok: true,
    completed: c?.value ?? null,
    payable,
    coachMissed: im?.value ?? null,
    memberMissed: wm?.value ?? null,
    missed: im?.value ?? null,       // the chargeable one, kept under the old name
    cancelled: x?.value ?? null,
    total: t?.value ?? null,
    fields: {
      completed: c?.field ?? null,
      coachMissed: im?.field ?? null,
      memberMissed: wm?.field ?? null,
      cancelled: x?.field ?? null,
      total: t?.field ?? null
    },
    missing: Object.entries({ completed: c, coachMissed: im, memberMissed: wm, cancelled: x })
      .filter(([, v]) => !v).map(([k]) => k),
    keys: Object.keys(obj)
  };
};


/**
 * Fetch one coach's session summary for a pay cycle.
 *
 * `fromDay` and `toDay` are the cycle's own dates — "2026-10-16", "2026-11-15"
 * — and are turned into the IST-midnight window the API expects.
 */
export async function fetchSessionSummary(appCoachId, {
  base = SESSION_API_DEFAULT,
  fromDay,
  toDay,
  token = null,
  signal
} = {}) {
  if (!appCoachId) return { ok: false, why: 'This coach has no app ID set.' };
  if (!fromDay || !toDay) return { ok: false, why: 'No period to fetch.' };

  const url = apiURL(base);
  url.searchParams.set('start_date', String(istDayStart(fromDay)));
  url.searchParams.set('end_date', String(istDayEnd(toDay)));
  url.searchParams.set('coach_id', appCoachId);

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url.toString(), {
      headers,
      credentials: token ? 'omit' : 'include',
      signal
    });
  } catch (e) {
    return {
      ok: false,
      why: `Could not reach ${apiHost(base)}. If the browser console shows a ` +
           `CORS error, the admin API has to allow this site's origin — that cannot ` +
           `be fixed from here. (${e.message})`
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      why: res.status === 401 || res.status === 403
        ? `The API refused the request (${res.status}). It needs an admin token. — Using the bundled proxy: set HB_ADMIN_TOKEN in .env and restart the dev server. Calling admin.hbplus.fit directly: paste a token into the API access box above. The token is the Authorization header your own admin.hbplus.fit session sends — DevTools, Network, any /api/v1/ request.`
        : `The API answered ${res.status} ${res.statusText}.`
    };
  }

  let payload;
  try { payload = await res.json(); }
  catch { return { ok: false, why: 'The API did not return JSON.' }; }

  const parsed = parseSessionSummary(payload);
  return parsed.ok
    ? { ...parsed, window: { from: fromDay, to: toDay } }
    : parsed;
}


/* ---------------------------------------------------------------------------
 * Availability
 *
 * The hours a coach offered on each day. This is the feed the attendance
 * settlement has been missing: without it, availabilityHoursFor falls back to
 * standard hours and marks the day `missing`, so a part-worked day is sent for
 * review instead of being charged. With it, a shortfall can finally be
 * measured against what was actually promised.
 * ------------------------------------------------------------------------ */

export const AVAILABILITY_API_DEFAULT =
  'https://admin.hbplus.fit/api/v1/coach/availability';

const START_KEYS = ['available_from', 'availableFrom', 'start_time', 'startTime', 'start', 'from', 'start_at', 'startAt', 'from_time'];
const END_KEYS   = ['available_till', 'availableTill', 'available_to', 'end_time', 'endTime', 'end', 'to', 'end_at', 'endAt', 'to_time'];
const DAY_KEYS   = ['valid_from', 'validFrom', 'day', 'date'];

/**
 * The IST calendar day a moment falls on, as "YYYY-MM-DD".
 *
 * Availability is published against Indian dates, and the working day here runs
 * 4 AM to 2 AM. Bucketing by UTC instead would move every slot before 5:30 AM
 * into the previous day.
 */
/** A moment as "HH:MM" in IST, for showing a published window. */
export const istTimeOf = (ms) =>
  new Date(ms + (5.5 * 3600 * 1000)).toISOString().slice(11, 16);

export const istDayOf = (ms) => {
  const d = new Date(ms + (5.5 * 3600 * 1000));
  return d.toISOString().slice(0, 10);
};

const msAt = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    // Epoch milliseconds, epoch seconds, or a date string — all three appear in
    // feeds like this one, and seconds read as 1970 if taken at face value.
    if (Number.isFinite(n)) return n > 1e11 ? n : n * 1000;
    const t = new Date(v).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return null;
};

const findSlotArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const KEYS = ['result', 'data', 'availability', 'availabilities', 'slots', 'results', 'items', 'records'];
  for (const k of KEYS) if (Array.isArray(payload[k])) return payload[k];
  for (const k of KEYS) {
    const inner = payload[k];
    if (inner && typeof inner === 'object') {
      for (const k2 of KEYS) if (Array.isArray(inner[k2])) return inner[k2];
      // A day-keyed object: { "2026-10-26": [ ...slots ] }
      const flat = [];
      for (const [day, v] of Object.entries(inner)) {
        if (Array.isArray(v) && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
          for (const slot of v) flat.push({ ...slot, _day: day });
        }
      }
      if (flat.length) return flat;
    }
  }
  return [];
};

/**
 * One document per day, each holding its own slots, flattened to a slot list.
 *
 * Only `approved_availability` is read. Hours a coach proposed but nobody
 * signed off on are not a commitment — treating them as one would hold a coach
 * to a day their manager never agreed to — so they are counted and reported
 * separately instead.
 */
const expandDayDocs = (rows) => {
  const out = [];
  let pendingSlots = 0, pendingDays = 0, inactiveDays = 0;

  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;

    const approved = row.approved_availability ?? row.approvedAvailability;
    if (!Array.isArray(approved)) { out.push(row); continue; }

    const unapproved = row.unapproved_availability ?? row.unapprovedAvailability;
    if (Array.isArray(unapproved)) pendingSlots += unapproved.length;

    if (row.is_active === false) { inactiveDays += 1; continue; }
    if (row.status && String(row.status).toLowerCase() !== 'approved') {
      pendingDays += 1;
      continue;
    }

    const dayMs = msAt(row, DAY_KEYS);
    const day = dayMs === null ? undefined : istDayOf(dayMs);
    for (const slot of approved) {
      if (slot && typeof slot === 'object') out.push({ ...slot, _day: day });
    }
  }

  return { rows: out, pendingSlots, pendingDays, inactiveDays };
};

/**
 * Availability folded into hours per day.
 *
 * Overlapping slots are merged rather than added up — a coach who published
 * 9–12 and 11–14 offered five hours, not six, and summing them would invent an
 * hour they never promised and then charge a shortfall against it.
 */
export const parseAvailability = (payload) => {
  const docs = findSlotArray(payload);
  const { rows: raw, pendingSlots, pendingDays, inactiveDays } = expandDayDocs(docs);
  const byDay = new Map();
  let unreadable = 0;

  for (const slot of raw) {
    const start = msAt(slot, START_KEYS);
    const end = msAt(slot, END_KEYS);
    if (start === null || end === null || end <= start) { unreadable += 1; continue; }
    const day = slot._day || istDayOf(start);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push([start, end]);
  }

  const days = [];
  for (const [day, spans] of [...byDay.entries()].sort()) {
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const span of spans) {
      const last = merged[merged.length - 1];
      if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
      else merged.push([...span]);
    }
    const ms = merged.reduce((t, [a, b]) => t + (b - a), 0);
    days.push({
      working_day: day,
      hours: Math.round((ms / 3600000) * 100) / 100,
      slots: merged.length,
      from: merged[0][0],
      to: merged[merged.length - 1][1],
      spans: merged,
      overlapping: merged.length < spans.length
    });
  }

  return {
    days,
    slotCount: raw.length,
    dayDocs: docs.length,
    pendingSlots,
    pendingDays,
    inactiveDays,
    unreadable,
    startField: raw.length ? START_KEYS.find(k => raw[0]?.[k] !== undefined) ?? null : null,
    endField: raw.length ? END_KEYS.find(k => raw[0]?.[k] !== undefined) ?? null : null
  };
};

/** One coach's published availability across a window of days. */
export async function fetchAvailability(appCoachId, {
  base = AVAILABILITY_API_DEFAULT,
  fromDay,
  toDay,
  token = null,
  signal
} = {}) {
  if (!appCoachId) return { ok: false, why: 'This coach has no app ID set.' };
  if (!fromDay || !toDay) return { ok: false, why: 'No date range to fetch.' };

  const url = apiURL(base);
  url.searchParams.set('coach_id', appCoachId);
  url.searchParams.set('start_time', String(istDayStart(fromDay)));
  url.searchParams.set('end_time', String(istDayEnd(toDay)));

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  let res;
  try {
    res = await fetch(url.toString(), { headers, credentials: token ? 'omit' : 'include', signal });
  } catch (e) {
    return {
      ok: false,
      why: `Could not reach ${apiHost(base)}. A CORS error in the console means ` +
           `the admin API has to allow this site's origin — see ADMIN-API-CORS.md. (${e.message})`
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      why: res.status === 401 || res.status === 403
        ? `The API refused the request (${res.status}). It needs an admin token. — Using the bundled proxy: set HB_ADMIN_TOKEN in .env and restart the dev server. Calling admin.hbplus.fit directly: paste a token into the API access box above. The token is the Authorization header your own admin.hbplus.fit session sends — DevTools, Network, any /api/v1/ request.`
        : `The API answered ${res.status} ${res.statusText}.`
    };
  }

  let payload;
  try { payload = await res.json(); }
  catch { return { ok: false, why: 'The API did not return JSON.' }; }

  const parsed = parseAvailability(payload);
  if (parsed.slotCount === 0) {
    return { ok: true, ...parsed, empty: true, window: { from: fromDay, to: toDay } };
  }
  return { ok: true, ...parsed, window: { from: fromDay, to: toDay } };
}

/* -------------------------------------------------------------------------
 * Night sessions
 * ---------------------------------------------------------------------- */

// A night session is one taken between 10pm and 4am. Both ends are IST hours
// on the clock, not a duration: 22:00 to 24:00 belongs to the evening's date,
// 00:00 to 04:00 to the next morning's.
export const NIGHT_FROM_HOUR = 22;
export const NIGHT_TO_HOUR = 4;

const HOUR = 3600 * 1000;
const DAY_MS = 24 * HOUR;

/** The ISO day `n` days after `isoDay`, in IST. */
const addDays = (isoDay, n) =>
  new Date(istDayStart(isoDay) + n * DAY_MS + 12 * HOUR)
    .toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/**
 * The night windows covering a cycle, as [startMs, endMs] pairs.
 *
 * Every instant inside the cycle's own dates whose IST clock reads 22:00-04:00,
 * and no instant outside them. The bulk of it is one window per night, each
 * running from 22:00 across midnight to 04:00 — which is both how a night is
 * actually worked and half the requests of asking for the two halves apart.
 *
 * The two ends need their own windows. The cycle's first morning has no
 * preceding evening inside the cycle, and the last evening has no morning
 * after it, so without them the first 00:00-04:00 and the last 22:00-24:00
 * would be dropped — the exact small, invisible undercount that this kind of
 * window arithmetic is prone to.
 */
export const nightWindows = (fromDay, toDay) => {
  const out = [];
  if (!fromDay || !toDay) return out;
  const last = istDayStart(toDay);

  // The cycle's first morning, 00:00-04:00.
  out.push([istDayStart(fromDay), istDayStart(fromDay) + NIGHT_TO_HOUR * HOUR - 1]);

  for (let day = fromDay; istDayStart(day) < last; day = addDays(day, 1)) {
    const start = istDayStart(day) + NIGHT_FROM_HOUR * HOUR;
    const end = istDayStart(addDays(day, 1)) + NIGHT_TO_HOUR * HOUR - 1;
    out.push([start, end]);
  }

  // The cycle's last evening, 22:00 to the end of the day.
  out.push([last + NIGHT_FROM_HOUR * HOUR, istDayEnd(toDay)]);
  return out;
};

/**
 * One session-summary call over an arbitrary window.
 *
 * The admin API filters on the exact timestamps given, not on whole days —
 * asking for 12:00-14:00 really does answer for those two hours. That is what
 * makes counting night sessions possible at all from an endpoint that returns
 * no session times: ask only about the night, and the count that comes back is
 * the night's.
 *
 * An empty answer is a zero here, not an error. Most nights have no sessions.
 */
const countsInWindow = async (appCoachId, base, token, [start, end], signal) => {
  const url = apiURL(base);
  url.searchParams.set('start_date', String(start));
  url.searchParams.set('end_date', String(end));
  url.searchParams.set('coach_id', appCoachId);

  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

  const res = await fetch(url.toString(), {
    headers, credentials: token ? 'omit' : 'include', signal
  });
  if (!res.ok) throw new Error(`The API answered ${res.status} ${res.statusText}.`);

  const parsed = parseSessionSummary(await res.json());
  if (parsed.empty) return { completed: 0, total: 0 };
  if (!parsed.ok) throw new Error(parsed.why);
  return { completed: Number(parsed.completed) || 0, total: Number(parsed.total) || 0 };
};

/**
 * How many sessions a coach took between 10pm and 4am across a pay cycle.
 *
 * The summary endpoint returns counts and no times, so there is no single call
 * that answers this. It is asked one night at a time and added up — about
 * thirty requests for a cycle, run a few at once rather than all at once so a
 * fill does not arrive as a burst on the admin API.
 *
 * Completed sessions only. The night premium pays for having worked the
 * night; a session nobody turned up to was not worked.
 */
export async function fetchNightSessions(appCoachId, {
  base = SESSION_API_DEFAULT,
  fromDay,
  toDay,
  token = null,
  signal,
  concurrency = 5
} = {}) {
  if (!appCoachId) return { ok: false, why: 'This coach has no app ID set.' };
  if (!fromDay || !toDay) return { ok: false, why: 'No period to fetch.' };

  const windows = nightWindows(fromDay, toDay);
  let completed = 0;
  let total = 0;
  let next = 0;

  const worker = async () => {
    while (next < windows.length) {
      const mine = windows[next++];
      const c = await countsInWindow(appCoachId, base, token, mine, signal);
      completed += c.completed;
      total += c.total;
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, windows.length) }, worker));
  } catch (e) {
    return {
      ok: false,
      why: `Could not count night sessions from ${apiHost(base)}: ${e.message}`
    };
  }

  return {
    ok: true,
    completed,
    total,
    nights: windows.length,
    window: { from: fromDay, to: toDay }
  };
}
