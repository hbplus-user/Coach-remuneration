# Letting the coach dashboard read the admin API

The dashboard calls three endpoints on `admin.hbplus.fit`:

- `GET /api/v1/feedbacks` — reviews, for the 5-Star Streak
- `GET /api/v1/dashboard/coach-session-summary` — sessions completed / missed / cancelled
- `GET /api/v1/coach/availability` — published availability, checked against logins

Both work today when you open the URL in a browser tab, because that tab **is**
`admin.hbplus.fit`. They fail from the dashboard, because the dashboard is served
from a different origin and the browser discards the response.

Nothing in the dashboard can fix this. The request leaves the browser and the
admin API answers it correctly — the browser throws the answer away before the
page sees it, because the response does not say the dashboard is allowed to read
it. The change is one set of response headers on the admin API.

## Origins to allow

The dashboard's final subdomain is not settled yet, so allow the parent domain
and local development:

| Origin | What it is |
|---|---|
| `https://<anything>.hbplus.fit` | wherever the dashboard lands |
| `http://localhost:5173` | Vite dev server |
| `http://localhost:4173` | `vite preview` |

## The headers

```
Access-Control-Allow-Origin: <the request's Origin, echoed back>
Access-Control-Allow-Credentials: true
Vary: Origin
```

Three things are easy to get wrong here:

1. **`*` will not work.** The dashboard sends the admin session cookie, and the
   spec forbids the wildcard on credentialed requests. The server has to check
   the incoming `Origin` against an allowlist and echo back that exact value.
2. **`Vary: Origin` is not optional.** Without it a CDN or proxy caches the
   first caller's `Access-Control-Allow-Origin` and serves it to everyone else,
   so the API works for one origin and mysteriously fails for the next.
3. **Preflight.** A plain `GET` with a cookie is a "simple" request and needs no
   preflight. The moment an `Authorization` header is sent the browser first
   sends `OPTIONS`, which must be answered `204` with the headers above plus
   `Access-Control-Allow-Headers: Authorization, Content-Type`.

## Express

```js
const ALLOWED = [
  /^https:\/\/[a-z0-9-]+\.hbplus\.fit$/i,
  /^http:\/\/localhost:(5173|4173)$/
];

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED.some(re => re.test(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

With the `cors` package instead:

```js
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || ALLOWED.some(re => re.test(origin))),
  credentials: true
}));
```

## nginx

```nginx
map $http_origin $cors_origin {
    default                                   "";
    "~^https://[a-z0-9-]+\.hbplus\.fit$"      $http_origin;
    "~^http://localhost:(5173|4173)$"         $http_origin;
}

location /api/v1/ {
    add_header Access-Control-Allow-Origin      $cors_origin always;
    add_header Access-Control-Allow-Credentials true          always;
    add_header Vary                             Origin        always;
    add_header Access-Control-Allow-Headers     "Authorization, Content-Type" always;

    if ($request_method = OPTIONS) { return 204; }
    # ... existing proxy_pass ...
}
```

## The cookie, once CORS is sorted

Two different cases, and only one of them is likely to work straight away:

- **Dashboard on a `*.hbplus.fit` subdomain** — same *site* as the admin API
  even though it is a different *origin*, so an ordinary `SameSite=Lax` session
  cookie is sent with the request. This should just work.
- **Dashboard on `localhost`** — genuinely cross-site. A `SameSite=Lax` cookie
  is **not** sent, so the call will come back `401` even with CORS correct.
  Either set the session cookie `SameSite=None; Secure`, or use a bearer token
  for local development. The dashboard has a token box under **API access** in
  the fetch panel for exactly this; it is held for the browser tab only and is
  never written into the built JavaScript.

So on a real subdomain this needs the headers alone. On localhost it needs the
headers **and** a token.

## If the admin API cannot be changed

There is a proxy in this repo already: `api/hb/[...path].js`, a Vercel
serverless function on the dashboard's own domain. The browser sees a
same-origin request, so CORS never applies and none of the above is needed.

To use it:

1. Set `HB_ADMIN_TOKEN` in the Vercel dashboard, under Settings ->
   Environment Variables. **Not** a `VITE_` variable — those are compiled into
   the JavaScript and readable by anyone who opens the app.
2. Set `VITE_REVIEW_API_BASE=/api/hb/feedbacks`,
   `VITE_SESSION_API_BASE=/api/hb/sessions` and
   `VITE_AVAILABILITY_API_BASE=/api/hb/availability`.
3. Redeploy.

The proxy is deliberately narrow, because one on your own domain inherits your
domain's reach: `GET` only, three known paths and nothing else, and a live
Supabase session required on every call, checked against Supabase rather than
taken on trust. Without that last check it would be a public endpoint with a
built-in admin token, which is worse than the problem it solves.

`vite dev` does not run serverless functions. Locally, either run `vercel dev`,
or leave the three variables unset and call the admin API directly with a token
in the fetch panel.
