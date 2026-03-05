import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import {
  requestDeviceCode,
  pollForAccessToken,
  fetchGitHubUser,
  type DeviceCodeResponse,
  type GitHubUser,
} from './oauth';
import type { User } from './types';

// ─── Types ──────────────────────────────────────────────────────

export type LoginPhase =
  | 'idle'
  | 'requesting_code'
  | 'waiting_for_user'
  | 'exchanging_token'
  | 'success'
  | 'error';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  /** Start the Device Flow login process (requires backend) */
  startLogin: () => Promise<void>;

  /** Login with a manually entered Personal Access Token (fallback) */
  loginWithToken: (token: string) => Promise<void>;

  /** Cancel an in-progress login */
  cancelLogin: () => void;

  /** Log out and clear credentials */
  logout: () => void;

  /** Clear credentials and restart Device Flow (for scope upgrade) */
  reAuthenticate: () => Promise<void>;

  /** Current phase of the Device Flow */
  loginPhase: LoginPhase;

  /** Device code info (user_code, verification_uri) during flow */
  deviceCode: DeviceCodeResponse | null;

  /** Error message if login failed */
  error: string | null;
}

// ─── Constants ──────────────────────────────────────────────────

const TOKEN_KEY = 'ghagga_token';
const USER_KEY = 'ghagga_user';

// ─── Context ────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextType | null>(null);

// ─── Provider ───────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(USER_KEY);
    if (stored) {
      try {
        return JSON.parse(stored) as User;
      } catch {
        return null;
      }
    }
    return null;
  });
  const [token, setToken] = useState<string | null>(
    () => localStorage.getItem(TOKEN_KEY),
  );
  const [isLoading, setIsLoading] = useState(false);
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle');
  const [deviceCode, setDeviceCode] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Validate stored token on mount
  useEffect(() => {
    if (token && !user) {
      setIsLoading(true);
      fetchGitHubUser(token)
        .then((githubUser: GitHubUser) => {
          const appUser: User = {
            githubLogin: githubUser.login,
            githubUserId: githubUser.id,
            avatarUrl: githubUser.avatar_url,
          };
          setUser(appUser);
          localStorage.setItem(USER_KEY, JSON.stringify(appUser));
        })
        .catch(() => {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
          setToken(null);
          setUser(null);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Device Flow Login ───────────────────────────────────────

  const startLogin = useCallback(async () => {
    setError(null);
    setLoginPhase('requesting_code');
    setIsLoading(true);

    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Step 1: Request device code
      const codeResponse = await requestDeviceCode();
      setDeviceCode(codeResponse);
      setLoginPhase('waiting_for_user');

      // Open GitHub device page in new tab
      window.open(codeResponse.verification_uri, '_blank', 'noopener');

      // Step 2: Poll for access token
      setLoginPhase('waiting_for_user');
      const accessToken = await pollForAccessToken(
        codeResponse.device_code,
        codeResponse.interval,
        codeResponse.expires_in,
        controller.signal,
      );

      // Step 3: Fetch user profile
      setLoginPhase('exchanging_token');
      const githubUser = await fetchGitHubUser(accessToken);

      const appUser: User = {
        githubLogin: githubUser.login,
        githubUserId: githubUser.id,
        avatarUrl: githubUser.avatar_url,
      };

      // Step 4: Save credentials
      localStorage.setItem(TOKEN_KEY, accessToken);
      localStorage.setItem(USER_KEY, JSON.stringify(appUser));
      setToken(accessToken);
      setUser(appUser);
      setLoginPhase('success');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message !== 'Login cancelled') {
        setError(message);
        setLoginPhase('error');
      } else {
        setLoginPhase('idle');
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  }, []);

  // ── PAT Login (fallback when no backend) ─────────────────────

  const loginWithToken = useCallback(async (newToken: string) => {
    setError(null);
    setIsLoading(true);
    setLoginPhase('exchanging_token');

    try {
      const githubUser = await fetchGitHubUser(newToken);

      const appUser: User = {
        githubLogin: githubUser.login,
        githubUserId: githubUser.id,
        avatarUrl: githubUser.avatar_url,
      };

      localStorage.setItem(TOKEN_KEY, newToken);
      localStorage.setItem(USER_KEY, JSON.stringify(appUser));
      setToken(newToken);
      setUser(appUser);
      setLoginPhase('success');
    } catch {
      setError('Invalid token. Make sure it has not expired.');
      setLoginPhase('error');
      throw new Error('Invalid token');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const cancelLogin = useCallback(() => {
    abortController?.abort();
    setLoginPhase('idle');
    setDeviceCode(null);
    setError(null);
    setIsLoading(false);
  }, [abortController]);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setError(null);
    setLoginPhase('idle');
    setDeviceCode(null);
  }, []);

  const reAuthenticate = useCallback(async () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    await startLogin();
  }, [startLogin]);

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated: !!user && !!token,
    isLoading,
    startLogin,
    loginWithToken,
    cancelLogin,
    logout,
    reAuthenticate,
    loginPhase,
    deviceCode,
    error,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ─── Hooks & Guards ─────────────────────────────────────────────

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-surface-bg">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
