/**
 * A read-only proxy to the HB+ admin API.
 *
 * The browser refuses to hand the dashboard a response from admin.hbplus.fit,
 * because that is a different origin and the admin API does not say the
 * dashboard may read it. This function runs on the dashboard's own domain, so
 * as far as the browser is concerned there is no cross-origin request at all
 * and CORS never applies.
 *
 * It also holds the admin token. A token in a VITE_ variable is compiled into
 * the JavaScript and readable by anyone who opens the app; HB_ADMIN_TOKEN is
 * read here, on the server, and never reaches the browser.
 *
 * A proxy on your own domain inherits your domain's reach, so this one is
 * deliberately narrow:
 *
 *   - GET only, so nothing here can change anything upstream.
 *   - Three known paths, so it cannot be used to reach the rest of the admin
 *     API. An open relay with a built-in token would be worse than the CORS
 *     problem it solves.
 *   - A valid Supabase session required, checked against Supabase on every
 *     call. Without this, the function is public: anyone who finds the URL
 *     reads your coaches' data.
 */

const UPSTREAM = process.env.HB_ADMIN_API_BASE || 'https://admin.hbplus.fit';

// The only paths this proxy will fetch. Anything else is refused.
const ROUTES = {
  feedbacks: '/api/v1/feedbacks',
  sessions: '/api/v1/dashboard/coach-session-summary',
  availability: '/api/v1/coach/availability'
};

/** Whoever is calling must hold a live Supabase session for this project. */
async function callerIsSignedIn(req) {
  const auth = req.headers.authorization || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!jwt) return false;

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anon, Authorization: `Bearer ${jwt}` }
    });
    if (!res.ok) return false;
    const user = await res.json();
    if (!user?.email) return false;

    // Same domain rule the app signs in with, applied again here. The browser
    // check can be edited by whoever is looking at it; this one cannot.
    const domain = process.env.VITE_ALLOWED_EMAIL_DOMAIN;
    if (domain && !user.email.toLowerCase().endsWith(`@${domain.toLowerCase()}`)) return false;

    return true;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'This proxy only reads.' });
  }

  // Where the route name comes from, and why not req.query.path: the catch-all
  // file name promises Vercel will fill that in, and on this deployment it did
  // not — so every path fell through to the 404 below and the dashboard was
  // told the admin API had answered 404 when the admin API had never been
  // asked. The URL is the one thing always present, so it is read first and
  // the route param is only a fallback.
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const fromPath = url.pathname.replace(/^\/+api\/+hb\/*/, '').split('/').filter(Boolean);
  const parts = fromPath.length ? fromPath : [].concat(req.query?.path || []);
  const route = ROUTES[parts[0]];
  if (!route) {
    // Name what was asked for. A 404 that does not say what it did not find
    // is a morning lost to guessing.
    return res.status(404).json({
      error: `Unknown route ${JSON.stringify(parts[0] ?? url.pathname)}. `
        + `This proxy serves: ${Object.keys(ROUTES).join(', ')}.`
    });
  }

  if (!(await callerIsSignedIn(req))) {
    return res.status(401).json({ error: 'Sign in to the dashboard first.' });
  }

  const token = process.env.HB_ADMIN_TOKEN || '';
  if (!token && !process.env.HB_ADMIN_COOKIE) {
    return res.status(500).json({
      error: 'Neither HB_ADMIN_TOKEN nor HB_ADMIN_COOKIE is set on this deployment, so there is nothing to authenticate with upstream.'
    });
  }

  // Forward the query string as given — coach_id, start_date, limit and the
  // rest are the admin API's business, not this function's.
  // From the URL for the same reason as the route above, so the two cannot
  // disagree about what was asked for.
  const qs = new URLSearchParams(url.search);
  qs.delete('path');

  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}${route}?${qs}`, {
      headers: {
        Accept: 'application/json',
        // The admin dashboard sends these alongside the token; some routes
        // check them. Not secrets.
        'hb-client': 'admin-dashboard',
        'hb-platform': 'web',
        'hb-app-version': process.env.HB_APP_VERSION || '1.1.0',
        ...(token ? { Authorization: token.startsWith('Bearer ') ? token : `Bearer ${token}` } : {}),
        // Some deployments authenticate with the admin session cookie rather
        // than a bearer token. Set HB_ADMIN_COOKIE if so.
        ...(process.env.HB_ADMIN_COOKIE ? { Cookie: process.env.HB_ADMIN_COOKIE } : {})
      }
    });
  } catch (e) {
    return res.status(502).json({ error: `Could not reach the admin API: ${e.message}` });
  }

  const body = await upstream.text();
  res.status(upstream.status);
  res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
  // Coach data, and it is per-signed-in-caller. Nothing caches it.
  res.setHeader('Cache-Control', 'no-store');
  return res.send(body);
}
