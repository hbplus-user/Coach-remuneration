import React from 'react';

/**
 * A render error anywhere below this unmounts React's whole tree, which shows
 * up as a blank page with the cause only in the console. Catch it and put the
 * message on screen instead.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Render error:', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 620 }}>
          <div className="auth-logo">HB+</div>
          <h1 style={{ margin: '1rem 0 .5rem', fontSize: '1.15rem' }}>Something broke on this screen</h1>
          <p className="auth-foot" style={{ textAlign: 'left', margin: 0 }}>
            The page failed to render. This is usually reference data that did
            not load — a coach pointing at a variant that is missing, for example.
          </p>
          <pre style={{
            marginTop: '1rem', padding: '.8rem', borderRadius: 8, overflowX: 'auto',
            fontSize: '.78rem', lineHeight: 1.5, whiteSpace: 'pre-wrap',
            color: 'var(--brand-rust, #9f4022)', background: 'rgba(159,64,34,.10)',
            border: '1px solid rgba(159,64,34,.35)'
          }}>
            {this.state.error?.message || String(this.state.error)}
          </pre>
          <button className="auth-submit" style={{ marginTop: '1.25rem' }}
                  onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="auth-google" style={{ marginTop: '.6rem' }}
                  onClick={() => window.location.reload()}>
            Reload the app
          </button>
        </div>
      </div>
    );
  }
}
