import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

export function Login() {
  const {
    isAuthenticated,
    startLogin,
    cancelLogin,
    loginPhase,
    deviceCode,
    error,
  } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // Redirect when authenticated
  useEffect(() => {
    if (isAuthenticated) {
      navigate(from, { replace: true });
    }
  }, [isAuthenticated, from, navigate]);

  // Copy user code to clipboard
  const copyCode = async () => {
    if (deviceCode?.user_code) {
      await navigator.clipboard.writeText(deviceCode.user_code);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-bg px-4">
      <div className="w-full max-w-md">
        {/* Branding */}
        <div className="mb-8 text-center">
          <div className="mb-4 text-6xl" role="img" aria-label="GHAGGA bird">
            🐦
          </div>
          <h1 className="text-3xl font-bold text-text-primary">GHAGGA</h1>
          <p className="mt-2 text-text-secondary">
            Multi-agent AI Code Review
          </p>
        </div>

        {/* Login Card */}
        <div className="rounded-lg border border-surface-border bg-surface-card p-6">
          {/* ─── Idle / Initial State ─────────────────────────── */}
          {(loginPhase === 'idle' || loginPhase === 'error') && (
            <>
              <h2 className="mb-4 text-lg font-semibold text-text-primary">
                Sign in with GitHub
              </h2>
              <p className="mb-6 text-sm text-text-secondary">
                Authenticate with your GitHub account to get started.
                Uses GitHub's secure Device Flow — no passwords needed.
              </p>

              {error && (
                <div className="mb-4 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={startLogin}
                className="btn-primary flex w-full items-center justify-center gap-2"
              >
                <svg
                  className="h-5 w-5"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                Sign in with GitHub
              </button>

              <p className="mt-4 text-center text-xs text-text-muted">
                Free — uses GitHub Models for AI-powered code review.
              </p>
            </>
          )}

          {/* ─── Requesting Code (loading) ────────────────────── */}
          {loginPhase === 'requesting_code' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
              <p className="text-sm text-text-secondary">
                Connecting to GitHub...
              </p>
            </div>
          )}

          {/* ─── Waiting for User (show code) ─────────────────── */}
          {loginPhase === 'waiting_for_user' && deviceCode && (
            <>
              <h2 className="mb-2 text-lg font-semibold text-text-primary">
                Enter this code on GitHub
              </h2>
              <p className="mb-6 text-sm text-text-secondary">
                A new tab has been opened. Enter the code below at{' '}
                <a
                  href={deviceCode.verification_uri}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary-400 hover:text-primary-300"
                >
                  github.com/login/device
                </a>
              </p>

              {/* User Code Display */}
              <button
                type="button"
                onClick={copyCode}
                className="group mb-6 flex w-full items-center justify-center gap-3 rounded-lg border border-surface-border bg-surface-bg px-6 py-4 transition hover:border-primary-500/50"
                title="Click to copy"
              >
                <span className="font-mono text-3xl font-bold tracking-[0.3em] text-text-primary">
                  {deviceCode.user_code}
                </span>
                <svg
                  className="h-5 w-5 text-text-muted transition group-hover:text-primary-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.666 3.888A2.25 2.25 0 0 0 13.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 0 1-.75.75H9.75a.75.75 0 0 1-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 0 1-2.25 2.25H6.75A2.25 2.25 0 0 1 4.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 0 1 1.927-.184"
                  />
                </svg>
              </button>

              {/* Polling indicator */}
              <div className="mb-4 flex items-center justify-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
                <span className="text-sm text-text-secondary">
                  Waiting for authorization...
                </span>
              </div>

              <button
                type="button"
                onClick={cancelLogin}
                className="flex w-full items-center justify-center rounded-lg border border-surface-border px-4 py-2 text-sm text-text-secondary transition hover:bg-surface-border/50"
              >
                Cancel
              </button>
            </>
          )}

          {/* ─── Exchanging Token ─────────────────────────────── */}
          {loginPhase === 'exchanging_token' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
              <p className="text-sm text-text-secondary">
                Authorized! Loading your profile...
              </p>
            </div>
          )}

          {/* ─── Success (brief flash before redirect) ────────── */}
          {loginPhase === 'success' && (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-4xl">✅</div>
              <p className="text-sm text-text-secondary">
                Logged in! Redirecting...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
