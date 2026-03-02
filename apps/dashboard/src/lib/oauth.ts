/**
 * GitHub OAuth Device Flow for the Dashboard (browser).
 *
 * Same flow as the CLI but adapted for browser fetch APIs.
 * The user opens github.com/login/device in a new tab, enters
 * the code, and the dashboard polls until authorized.
 */

/** GHAGGA OAuth App Client ID (public — safe to embed in code) */
export const GITHUB_CLIENT_ID = 'Ov23liyYpSgDqOLUFa5k';

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

// ─── Device Flow ────────────────────────────────────────────────

/**
 * Step 1: Request device and user verification codes.
 */
export async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const response = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: GITHUB_CLIENT_ID,
      scope: '',
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to request device code: ${response.status}`);
  }

  return response.json() as Promise<DeviceCodeResponse>;
}

/**
 * Step 3: Poll for access token.
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

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
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

/**
 * Fetch the authenticated user's GitHub profile.
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
