import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';

export function Login() {
  const [token, setToken] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // Redirect if already authenticated
  if (isAuthenticated) {
    navigate(from, { replace: true });
    return null;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    setIsValidating(true);
    setErrorMessage(null);

    try {
      await login(token.trim());
      navigate(from, { replace: true });
    } catch {
      setErrorMessage(
        'Invalid GitHub Personal Access Token. Please check and try again.',
      );
    } finally {
      setIsValidating(false);
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
          <h2 className="mb-4 text-lg font-semibold text-text-primary">
            Connect with GitHub
          </h2>
          <p className="mb-6 text-sm text-text-secondary">
            Enter your GitHub Personal Access Token to get started. You can
            create one at{' '}
            <a
              href="https://github.com/settings/tokens"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary-400 hover:text-primary-300"
            >
              github.com/settings/tokens
            </a>
            .
          </p>

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label
                htmlFor="token"
                className="mb-2 block text-sm font-medium text-text-primary"
              >
                Personal Access Token
              </label>
              <input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                className="input-field"
                autoFocus
                required
              />
            </div>

            {errorMessage && (
              <div className="mb-4 rounded-lg border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {errorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isValidating || !token.trim()}
              className="btn-primary flex w-full items-center justify-center gap-2"
            >
              {isValidating ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Validating...
                </>
              ) : (
                <>
                  <svg
                    className="h-5 w-5"
                    fill="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  Connect with GitHub
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-text-muted">
            Your token is stored locally and never shared with third parties.
          </p>
        </div>
      </div>
    </div>
  );
}
