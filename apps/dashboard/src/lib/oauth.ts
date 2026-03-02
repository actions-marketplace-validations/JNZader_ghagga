/**
 * GitHub OAuth Device Flow for the Dashboard (browser).
 *
 * Because GitHub's Device Flow endpoints don't support CORS,
 * requests are proxied through the GHAGGA server (/auth/device/*).
 * When no server is available, the dashboard falls back to manual
 * PAT (Personal Access Token) entry.
 */

/** GHAGGA OAuth App Client ID (public — safe to embed in code) */
export const GITHUB_CLIENT_ID = 'Ov23liyYpSgDqOLUFa5k';

/** Server base URL — used for OAuth proxy endpoints */
const API_URL =
  import.meta.env.VITE_API_URL ||
  (window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://ghagga.onrender.com');

// ─── Types ──────────────────────────────────────────────────────

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface AccessTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

interface DeviceFlowError {
  error: string;
  error_description?: string;
  interval?: number;
}

export interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
}

// ─── Server Availability ────────────────────────────────────────

/**
 * Check if the GHAGGA backend server is reachable.
 * Returns true if the server responds to /health within 3 seconds.
 */
export async function isServerAvailable(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${API_URL}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

// ─── Device Flow (via server proxy) ─────────────────────────────

/**
 * Step 1: Request device and user verification codes.
 * Proxied through the GHAGGA server to avoid CORS issues.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch(`${API_URL}/auth/device/code`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => 'Unknown error');
    throw new Error(`Failed to request device code: ${response.status} ${text}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

/**
 * Step 3: Poll for access token.
 * Proxied through the GHAGGA server to avoid CORS issues.
 *
 * @param deviceCode - The device_code from step 1
 * @param interval - Polling interval in seconds
 * @param expiresIn - Expiry in seconds
 * @param signal - AbortSignal for cancellation
 */
export async function pollForAccessToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  signal?: AbortSignal,
): Promise<string> {
  let currentInterval = interval;
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    if (signal?.aborted) {
      throw new Error('Login cancelled');
    }

    await sleep(currentInterval * 1000);

    if (signal?.aborted) {
      throw new Error('Login cancelled');
    }

    const response = await fetch(`${API_URL}/auth/device/token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    const data = (await response.json()) as AccessTokenResponse | DeviceFlowError;

    if ('access_token' in data && data.access_token) {
      return data.access_token;
    }

    const error = data as DeviceFlowError;

    switch (error.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        currentInterval = (error.interval ?? currentInterval) + 5;
        continue;
      case 'expired_token':
        throw new Error('Code expired. Please try again.');
      case 'access_denied':
        throw new Error('Login was cancelled.');
      default:
        throw new Error(error.error_description ?? error.error);
    }
  }

  throw new Error('Code expired. Please try again.');
}

// ─── GitHub API (direct — api.github.com supports CORS) ─────────

/**
 * Fetch the authenticated user's GitHub profile.
 * This calls api.github.com directly (supports CORS).
 */
export async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!response.ok) {
    throw new Error('Invalid or expired token');
  }

  return response.json() as Promise<GitHubUser>;
}

// ─── Helpers ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
