import React, { useEffect, useState } from 'react';
import {
  isSupabaseConfigured, getSession, onAuthChange,
  signInWithGoogle, signOut, loadProfile,
  ALLOWED_EMAIL_DOMAIN, isAllowedEmail
} from './supabaseClient.js';

/**
 * Wraps the dashboard in a Supabase session. Nothing renders until we know who
 * is signed in, because the role and coach binding come from app_users and the
 * RLS policies return nothing without a session.
 *
 * Sign-in is Google only, restricted to the @hbplus.fit workspace. That rule is
 * enforced three times over: Google is asked for the domain (`hd`), a stray
 * account is signed straight back out here, and — the part that actually
 * matters, since the first two run on the client — every RLS policy checks the
 * email domain on the JWT.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [profileError, setProfileError] = useState('');
  const [rejectedEmail, setRejectedEmail] = useState('');

  useEffect(() => {
    let alive = true;

    const accept = (s) => {
      if (!alive) return;
      // A non-workspace Google account gets no further than this.
      if (s?.user && !isAllowedEmail(s.user.email)) {
        setRejectedEmail(s.user.email);
        setSession(null);
        setChecking(false);
        signOut();
        return;
      }
      setSession(s);
      setChecking(false);
    };

    getSession().then(accept);
    const stop = onAuthChange(accept);

    // An OAuth return leaves ?code=... / #access_token=... in the address bar
    // long after supabase-js has traded it for a session. Clean it up.
    if (window.location.hash.includes('access_token') ||
        window.location.search.includes('code=')) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    return () => { alive = false; stop(); };
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    let alive = true;
    loadProfile(session.user.id)
      .then(p => {
        if (!alive) return;
        if (!p) {
          setProfileError(
            `Signed in as ${session.user.email}, but no profile row exists in ` +
            'app_users for this account. An administrator needs to create one.'
          );
        } else {
          setProfileError('');
          setProfile(p);
        }
      })
      .catch(e => alive && setProfileError(e.message));
    return () => { alive = false; };
  }, [session?.user?.id]);

  if (!isSupabaseConfigured) {
    return <Notice
      title="Supabase is not configured"
      body="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env, then restart the dev server."
    />;
  }

  if (rejectedEmail) {
    return <Notice
      title="Wrong account"
      body={
        <>
          <p style={{ margin: 0 }}>
            <strong>{rejectedEmail}</strong> is not an <code>@{ALLOWED_EMAIL_DOMAIN}</code> account.
          </p>
          <p style={{ marginTop: '.75rem' }}>
            This dashboard is limited to the HB+ workspace. Sign in with your
            work account instead.
          </p>
        </>
      }
      action={{ label: 'Try another account', onClick: () => { setRejectedEmail(''); signInWithGoogle(); } }}
    />;
  }

  if (checking) return <Splash label="Checking session…" />;
  if (!session) return <LoginScreen />;

  if (profileError) {
    return <Notice title="No access yet" body={profileError} action={{ label: 'Sign Out', onClick: () => signOut() }} />;
  }
  if (!profile) return <Splash label="Loading profile…" />;

  // A brand-new sign-in lands here: the trigger created an app_users row but
  // nobody has assigned a role or linked a coach record yet. Showing the coach
  // self-service view with no coach bound would just look broken.
  if (profile.role === 'Coach' && !profile.coach_id) {
    return <Notice
      title="Access pending"
      body={
        <>
          <p style={{ margin: 0 }}>
            You are signed in as <strong>{session.user.email}</strong>, but this
            account has not been linked to a coach record or given a role yet.
          </p>
          <p style={{ marginTop: '.75rem' }}>
            An administrator needs to set your role in the <code>app_users</code> table.
          </p>
        </>
      }
      action={{ label: 'Sign Out', onClick: () => signOut() }}
    />;
  }

  return children({ session, profile, onSignOut: () => signOut() });
}

function LoginScreen() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const google = async () => {
    setBusy(true);
    setError('');
    // On success the browser navigates away to Google, so there is nothing to
    // await; only a configuration failure comes back here.
    const { error } = await signInWithGoogle();
    if (error) { setError(error.message); setBusy(false); }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">HB+</div>
          <div>
            <h1>Coach Remuneration</h1>
            <p>Performance &amp; Payroll Management</p>
          </div>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button className="auth-google" type="button" disabled={busy} onClick={google}>
          <GoogleMark />
          {busy ? 'Redirecting…' : 'Sign in with Google'}
        </button>

        <p className="auth-foot">
          Restricted to <strong>@{ALLOWED_EMAIL_DOMAIN}</strong> accounts.
          Access is granted by an administrator.
        </p>
      </div>
    </div>
  );
}

function Splash({ label }) {
  return (
    <div className="auth-shell">
      <div className="auth-card auth-card-centered">
        <div className="auth-logo">HB+</div>
        <p className="auth-foot">{label}</p>
      </div>
    </div>
  );
}

function Notice({ title, body, action }) {
  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">HB+</div>
        <h1 style={{ margin: '1rem 0 0', fontSize: '1.15rem' }}>{title}</h1>
        <div className="auth-foot" style={{ textAlign: 'left', marginTop: '.75rem' }}>{body}</div>
        {action && (
          <button className="auth-submit" style={{ marginTop: '1.25rem' }} onClick={action.onClick}>
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}

/** Google's four-colour "G", inline so no external asset is needed. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.6-9.4 6.6-16.1z"/>
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.4l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.4 46 24 46z"/>
      <path fill="#FBBC05" d="M11.8 28.2c-.4-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2v-5.7H4.5C3 17.1 2.1 20.4 2.1 24s.9 6.9 2.4 9.9l7.3-5.7z"/>
      <path fill="#EA4335" d="M24 10.8c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.4 2 8.1 6.9 4.5 14.1l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"/>
    </svg>
  );
}
