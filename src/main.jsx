import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './AuthGate.jsx';
import ErrorBoundary from './ErrorBoundary.jsx';
import './style.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AuthGate>
        {({ session, profile, onSignOut }) => (
          <App session={session} profile={profile} onSignOut={onSignOut} />
        )}
      </AuthGate>
    </ErrorBoundary>
  </React.StrictMode>
);
