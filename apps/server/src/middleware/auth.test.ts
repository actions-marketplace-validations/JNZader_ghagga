/**
 * Auth middleware tests.
 *
 * Tests token verification via GitHub API, user-installation lookups,
 * and auto-discovery of installations on first login.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockGetInstallationsByUserId = vi.fn();
const mockGetInstallationsByAccountLogin = vi.fn();
const mockUpsertUserMapping = vi.fn();

vi.mock('ghagga-db', () => ({
  getInstallationsByUserId: (...args: unknown[]) => mockGetInstallationsByUserId(...args),
  getInstallationsByAccountLogin: (...args: unknown[]) => mockGetInstallationsByAccountLogin(...args),
  upsertUserMapping: (...args: unknown[]) => mockUpsertUserMapping(...args),
}));

vi.mock('../lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

const mockFetch = vi.fn();
const mockDb = {} as any;

function createApp() {
  const app = new Hono();
  app.use('*', authMiddleware(mockDb));
  // Test route that returns the user context
  app.get('/test', (c) => {
    const user = c.get('user');
    return c.json({ user });
  });
  return app;
}

function makeAuthRequest(token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return new Request('http://localhost/test', { headers });
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
});

// ─── Missing/Invalid Authorization ──────────────────────────────

describe('auth middleware — missing or invalid token', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = createApp();
    const res = await app.request('/test');

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Missing or invalid Authorization header');
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Basic abc123' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Missing or invalid Authorization header');
  });

  it('returns 401 when token is empty after Bearer prefix', async () => {
    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer ' },
    });

    expect(res.status).toBe(401);
    // Hono may trim trailing space, causing "Bearer " to fail the startsWith check
    const json = await res.json();
    expect(json.error).toMatch(/Missing/);
  });
});

// ─── GitHub API Verification ────────────────────────────────────

describe('auth middleware — GitHub API verification', () => {
  it('returns 401 when GitHub API returns non-OK status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
    });

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer invalid-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Invalid or expired token');
  });

  it('returns 401 when GitHub API throws', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer some-token' },
    });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Failed to verify token');
  });

  it('calls GitHub /user API with correct headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'testuser' }),
    });
    mockGetInstallationsByUserId.mockResolvedValueOnce([
      { id: 100, accountLogin: 'testuser' },
    ]);

    const app = createApp();
    await app.request('/test', {
      headers: { Authorization: 'Bearer my-gh-token' },
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer my-gh-token',
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      }),
    );
  });
});

// ─── Successful Auth with Existing Mappings ─────────────────────

describe('auth middleware — successful auth', () => {
  it('sets user context with existing installation mappings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 42, login: 'octocat' }),
    });
    mockGetInstallationsByUserId.mockResolvedValueOnce([
      { id: 100, accountLogin: 'octocat' },
      { id: 200, accountLogin: 'org-a' },
    ]);

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user).toEqual({
      githubUserId: 42,
      githubLogin: 'octocat',
      installationIds: [100, 200],
    });

    // Should NOT trigger auto-discovery
    expect(mockGetInstallationsByAccountLogin).not.toHaveBeenCalled();
    expect(mockUpsertUserMapping).not.toHaveBeenCalled();
  });

  it('passes the db to getInstallationsByUserId', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'testuser' }),
    });
    mockGetInstallationsByUserId.mockResolvedValueOnce([{ id: 100 }]);

    const app = createApp();
    await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(mockGetInstallationsByUserId).toHaveBeenCalledWith(mockDb, 1);
  });
});

// ─── Auto-Discovery ─────────────────────────────────────────────

describe('auth middleware — auto-discovery', () => {
  it('auto-discovers and maps installations when no existing mappings', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 55, login: 'newuser' }),
    });
    // No existing mappings
    mockGetInstallationsByUserId.mockResolvedValueOnce([]);
    // Discover matching installations
    mockGetInstallationsByAccountLogin.mockResolvedValueOnce([
      { id: 300, accountLogin: 'newuser' },
      { id: 400, accountLogin: 'newuser' },
    ]);
    mockUpsertUserMapping.mockResolvedValue({});

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.installationIds).toEqual([300, 400]);

    // Should create mappings for each discovered installation
    expect(mockUpsertUserMapping).toHaveBeenCalledTimes(2);
    expect(mockUpsertUserMapping).toHaveBeenCalledWith(mockDb, {
      githubUserId: 55,
      githubLogin: 'newuser',
      installationId: 300,
    });
    expect(mockUpsertUserMapping).toHaveBeenCalledWith(mockDb, {
      githubUserId: 55,
      githubLogin: 'newuser',
      installationId: 400,
    });
  });

  it('returns empty installationIds when no matching installations found', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 99, login: 'loner' }),
    });
    mockGetInstallationsByUserId.mockResolvedValueOnce([]);
    mockGetInstallationsByAccountLogin.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.installationIds).toEqual([]);
    expect(mockUpsertUserMapping).not.toHaveBeenCalled();
  });

  it('returns empty installationIds when auto-discovery throws', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 99, login: 'erroruser' }),
    });
    mockGetInstallationsByUserId.mockResolvedValueOnce([]);
    mockGetInstallationsByAccountLogin.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    // Auto-discovery catches errors and returns []
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.user.installationIds).toEqual([]);
  });
});

// ─── DB Error During Lookup ─────────────────────────────────────

describe('auth middleware — DB errors', () => {
  it('returns 500 when getInstallationsByUserId throws', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 1, login: 'testuser' }),
    });
    mockGetInstallationsByUserId.mockRejectedValueOnce(new Error('DB connection lost'));

    const app = createApp();
    const res = await app.request('/test', {
      headers: { Authorization: 'Bearer valid-token' },
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Internal server error');
  });
});
