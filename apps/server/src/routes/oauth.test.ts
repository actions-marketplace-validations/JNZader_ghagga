/**
 * OAuth proxy route tests.
 *
 * Verifies:
 * - Device Flow code request sends scope: 'public_repo'
 * - Token exchange forwards device_code correctly
 * - Error handling for both endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { createOAuthRouter } from './oauth.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Helpers ────────────────────────────────────────────────────

function createApp() {
  const app = new Hono();
  app.route('/', createOAuthRouter());
  return app;
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device/code
// ═══════════════════════════════════════════════════════════════════

describe('POST /auth/device/code', () => {
  it('sends scope: "public_repo" to GitHub (not empty string)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          device_code: 'dc-abc',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const app = createApp();
    const res = await app.request('/auth/device/code', { method: 'POST' });

    expect(res.status).toBe(200);

    // Verify the fetch call to GitHub
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://github.com/login/device/code');

    const body = JSON.parse(options.body as string);
    expect(body.scope).toBe('public_repo');
    expect(body.scope).not.toBe('');
    expect(body.client_id).toBe('Ov23liyYpSgDqOLUFa5k');
  });

  it('proxies GitHub response back to client', async () => {
    const githubResponse = {
      device_code: 'dc-xyz',
      user_code: 'WXYZ-5678',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    };

    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify(githubResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = createApp();
    const res = await app.request('/auth/device/code', { method: 'POST' });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(githubResponse);
  });

  it('sends correct headers to GitHub', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ device_code: 'dc' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const app = createApp();
    await app.request('/auth/device/code', { method: 'POST' });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    });
  });

  it('returns github_error when GitHub responds with error', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Bad Request', { status: 400 }),
    );

    const app = createApp();
    const res = await app.request('/auth/device/code', { method: 'POST' });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('github_error');
    expect(json.message).toBe('Bad Request');
  });

  it('returns proxy_error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const app = createApp();
    const res = await app.request('/auth/device/code', { method: 'POST' });

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('proxy_error');
    expect(json.message).toBe('Network failure');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device/token
// ═══════════════════════════════════════════════════════════════════

describe('POST /auth/device/token', () => {
  it('forwards device_code to GitHub token endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: 'gho_test-token',
          token_type: 'bearer',
          scope: 'public_repo',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const app = createApp();
    const res = await app.request('/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'dc-abc' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.access_token).toBe('gho_test-token');

    // Verify the fetch call
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://github.com/login/oauth/access_token');

    const body = JSON.parse(options.body as string);
    expect(body.device_code).toBe('dc-abc');
    expect(body.client_id).toBe('Ov23liyYpSgDqOLUFa5k');
    expect(body.grant_type).toBe('urn:ietf:params:oauth:grant-type:device_code');
  });

  it('returns authorization_pending during polling', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'authorization_pending',
          error_description: 'The authorization request is still pending.',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const app = createApp();
    const res = await app.request('/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'dc-pending' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.error).toBe('authorization_pending');
  });

  it('returns 400 when device_code is missing', async () => {
    const app = createApp();
    const res = await app.request('/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('missing_field');
    expect(json.message).toBe('device_code is required');
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = createApp();
    const res = await app.request('/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-valid-json{{{',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_body');
  });

  it('returns github_error when GitHub responds with error', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error', { status: 500 }),
    );

    const app = createApp();
    const res = await app.request('/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'dc-fail' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('github_error');
  });

  it('returns proxy_error when fetch throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const app = createApp();
    const res = await app.request('/auth/device/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_code: 'dc-net-err' }),
    });

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toBe('proxy_error');
    expect(json.message).toBe('Connection refused');
  });
});
