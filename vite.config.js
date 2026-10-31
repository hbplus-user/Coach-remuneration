import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The same three admin-API routes the Vercel function serves, so `npm run dev`
 * behaves like production without the Vercel CLI.
 *
 * This runs in the dev server, not the browser, so HB_ADMIN_TOKEN is read from
 * .env without a VITE_ prefix and never reaches the bundle. Development only —
 * `vite build` does not include any of it.
 */
const ROUTES = {
  '/api/hb/feedbacks': '/api/v1/feedbacks',
  '/api/hb/sessions': '/api/v1/dashboard/coach-session-summary',
  '/api/hb/availability': '/api/v1/coach/availability'
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.HB_ADMIN_API_BASE || 'https://admin.hbplus.fit';

  const hasCredential = Boolean(env.HB_ADMIN_TOKEN || env.HB_ADMIN_COOKIE);

  const auth = (proxy) => {
    // Without a credential the admin API answers REQUIRED_AUTH_HEADER, which
    // reads like the proxy is broken when it is working perfectly. Say so here
    // instead of forwarding a request that cannot succeed.
    proxy.on('proxyReq', (proxyReq, req, res) => {
      if (hasCredential) return;
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'No admin credential configured.',
        fix: 'Add HB_ADMIN_TOKEN=... to .env (not VITE_), then restart npm run dev.',
        where: 'Open admin.hbplus.fit signed in, DevTools -> Network -> click any '
             + '/api/v1/ request -> Request Headers -> copy the whole Authorization value.'
      }));
      proxyReq.destroy();
    });
    proxy.on('proxyReq', (proxyReq) => {
      if (env.HB_ADMIN_TOKEN) {
        proxyReq.setHeader('Authorization', env.HB_ADMIN_TOKEN.startsWith('Bearer ')
          ? env.HB_ADMIN_TOKEN
          : `Bearer ${env.HB_ADMIN_TOKEN}`);
      }
      // A browser session cookie copied from DevTools works too, and is the
      // quickest way to try this before anyone issues a token.
      if (env.HB_ADMIN_COOKIE) proxyReq.setHeader('Cookie', env.HB_ADMIN_COOKIE);
      // The admin dashboard sends these alongside the token; some routes
      // check them. Not secrets.
      proxyReq.setHeader('hb-client', 'admin-dashboard');
      proxyReq.setHeader('hb-platform', 'web');
      proxyReq.setHeader('hb-app-version', env.HB_APP_VERSION || '1.1.0');
      proxyReq.setHeader('Accept', 'application/json');
    });
    proxy.on('error', (err) => console.error('[hb-proxy]', err.message));
  };

  const proxy = {};
  for (const [from, to] of Object.entries(ROUTES)) {
    proxy[from] = {
      target,
      changeOrigin: true,
      secure: true,
      // Keep the query string: coach_id and the window live in it.
      rewrite: (p) => to + p.slice(p.indexOf('?') === -1 ? p.length : p.indexOf('?')),
      configure: auth
    };
  }

  return { plugins: [react()], server: { proxy } };
});
