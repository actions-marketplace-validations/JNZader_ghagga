/**
 * Dashboard API route tests.
 *
 * Tests all routes in createApiRouter with mocked DB functions,
 * injected auth user context, and comprehensive edge cases.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createApiRouter } from './api.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockGetReviewsByRepoId = vi.fn();
const mockGetReviewStats = vi.fn();
const mockGetRepoByFullName = vi.fn();
const mockGetReposByInstallationId = vi.fn();
const mockUpdateRepoSettings = vi.fn();
const mockGetInstallationSettings = vi.fn();
const mockUpsertInstallationSettings = vi.fn();
const mockGetInstallationById = vi.fn();
const mockGetSessionsByProject = vi.fn();
const mockGetObservationsBySession = vi.fn();
const mockEncrypt = vi.fn();
const mockDecrypt = vi.fn();

vi.mock('ghagga-db', () => ({
  getReviewsByRepoId: (...args: unknown[]) => mockGetReviewsByRepoId(...args),
  getReviewStats: (...args: unknown[]) => mockGetReviewStats(...args),
  getRepoByFullName: (...args: unknown[]) => mockGetRepoByFullName(...args),
  getReposByInstallationId: (...args: unknown[]) => mockGetReposByInstallationId(...args),
  updateRepoSettings: (...args: unknown[]) => mockUpdateRepoSettings(...args),
  getInstallationSettings: (...args: unknown[]) => mockGetInstallationSettings(...args),
  upsertInstallationSettings: (...args: unknown[]) => mockUpsertInstallationSettings(...args),
  getInstallationById: (...args: unknown[]) => mockGetInstallationById(...args),
  getSessionsByProject: (...args: unknown[]) => mockGetSessionsByProject(...args),
  getObservationsBySession: (...args: unknown[]) => mockGetObservationsBySession(...args),
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
  DEFAULT_REPO_SETTINGS: {
    enableSemgrep: true,
    enableTrivy: true,
    enableCpd: true,
    enableMemory: true,
    customRules: [],
    ignorePatterns: ['*.md', '*.txt', '.gitignore', 'LICENSE', '*.lock'],
    reviewLevel: 'normal',
  },
}));

const mockValidateProviderKey = vi.fn();

vi.mock('../lib/provider-models.js', () => ({
  validateProviderKey: (...args: unknown[]) => mockValidateProviderKey(...args),
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

const mockDb = {} as any;

const DEFAULT_USER = {
  githubUserId: 1,
  githubLogin: 'testuser',
  installationIds: [100],
};

function createApp(user = DEFAULT_USER) {
  const app = new Hono();
  // Inject mock user for testing (simulates auth middleware)
  app.use('*', async (c, next) => {
    c.set('user', user);
    await next();
  });
  app.route('/', createApiRouter(mockDb));
  return app;
}

const FAKE_REPO = {
  id: 42,
  githubRepoId: 12345,
  installationId: 100,
  fullName: 'owner/repo',
  useGlobalSettings: false,
  aiReviewEnabled: true,
  reviewMode: 'simple',
  providerChain: [
    { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc-key-1' },
  ],
  settings: {
    enableSemgrep: true,
    enableTrivy: true,
    enableCpd: false,
    enableMemory: true,
    customRules: ['no-console', 'no-debugger'],
    ignorePatterns: ['*.md'],
    reviewLevel: 'strict',
  },
};

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockDecrypt.mockImplementation((v: string) => `decrypted-${v}`);
  mockEncrypt.mockImplementation((v: string) => `encrypted-${v}`);
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/reviews
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/reviews', () => {
  it('returns paginated reviews for an accessible repo', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    const fakeReviews = [
      { id: 1, prNumber: 10, status: 'PASSED' },
      { id: 2, prNumber: 11, status: 'FAILED' },
    ];
    mockGetReviewsByRepoId.mockResolvedValueOnce(fakeReviews);

    const app = createApp();
    const res = await app.request('/api/reviews?repo=owner/repo&page=1&limit=10');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(fakeReviews);
    expect(json.pagination).toEqual({ page: 1, limit: 10, offset: 0 });

    expect(mockGetReviewsByRepoId).toHaveBeenCalledWith(mockDb, 42, { limit: 10, offset: 0 });
  });

  it('uses default pagination when params not provided', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetReviewsByRepoId.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request('/api/reviews?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination).toEqual({ page: 1, limit: 50, offset: 0 });
  });

  it('caps limit at 100', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetReviewsByRepoId.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request('/api/reviews?repo=owner/repo&limit=500');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination.limit).toBe(100);
  });

  it('calculates correct offset for page 3', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetReviewsByRepoId.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request('/api/reviews?repo=owner/repo&page=3&limit=20');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.pagination).toEqual({ page: 3, limit: 20, offset: 40 });
  });

  it('returns 400 when repo param is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/reviews');

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing required query parameter: repo');
  });

  it('returns 404 when repo is not found', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/reviews?repo=unknown/repo');

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Repository not found');
  });

  it('returns 403 when user does not have access to repo installation', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      installationId: 999, // Not in user's installationIds
    });

    const app = createApp();
    const res = await app.request('/api/reviews?repo=owner/repo');

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 500 on DB error', async () => {
    mockGetRepoByFullName.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/reviews?repo=owner/repo');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch reviews');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/stats
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/stats', () => {
  it('returns mapped review stats', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetReviewStats.mockResolvedValueOnce({
      total: 100,
      passed: 70,
      failed: 10,
      skipped: 5,
    });

    const app = createApp();
    const res = await app.request('/api/stats?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.totalReviews).toBe(100);
    expect(json.data.passed).toBe(70);
    expect(json.data.failed).toBe(10);
    expect(json.data.skipped).toBe(5);
    expect(json.data.needsHumanReview).toBe(15); // 100 - 70 - 10 - 5
    expect(json.data.passRate).toBe(70); // (70/100) * 100
    expect(json.data.reviewsByDay).toEqual([]);
  });

  it('handles zero total reviews (passRate = 0)', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetReviewStats.mockResolvedValueOnce({
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
    });

    const app = createApp();
    const res = await app.request('/api/stats?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.passRate).toBe(0);
    expect(json.data.needsHumanReview).toBe(0);
  });

  it('handles null stat values', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetReviewStats.mockResolvedValueOnce({
      total: null,
      passed: null,
      failed: null,
      skipped: null,
    });

    const app = createApp();
    const res = await app.request('/api/stats?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.totalReviews).toBe(0);
    expect(json.data.passed).toBe(0);
    expect(json.data.failed).toBe(0);
    expect(json.data.skipped).toBe(0);
  });

  it('returns 400 when repo param is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/stats');

    expect(res.status).toBe(400);
  });

  it('returns 404 when repo not found', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/stats?repo=unknown/repo');

    expect(res.status).toBe(404);
  });

  it('returns 403 when user lacks access', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      installationId: 999,
    });

    const app = createApp();
    const res = await app.request('/api/stats?repo=owner/repo');

    expect(res.status).toBe(403);
  });

  it('returns 500 on DB error', async () => {
    mockGetRepoByFullName.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/stats?repo=owner/repo');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch stats');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/repositories
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/repositories', () => {
  it('returns repos from all user installations', async () => {
    const user = { ...DEFAULT_USER, installationIds: [100, 200] };
    mockGetReposByInstallationId
      .mockResolvedValueOnce([{ id: 1, fullName: 'org/repo-a' }])
      .mockResolvedValueOnce([{ id: 2, fullName: 'org/repo-b' }]);

    const app = createApp(user);
    const res = await app.request('/api/repositories');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[0].fullName).toBe('org/repo-a');
    expect(json.data[1].fullName).toBe('org/repo-b');

    expect(mockGetReposByInstallationId).toHaveBeenCalledTimes(2);
    expect(mockGetReposByInstallationId).toHaveBeenCalledWith(mockDb, 100);
    expect(mockGetReposByInstallationId).toHaveBeenCalledWith(mockDb, 200);
  });

  it('returns empty array when user has no installations', async () => {
    const user = { ...DEFAULT_USER, installationIds: [] };
    const app = createApp(user);
    const res = await app.request('/api/repositories');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  it('returns 500 on DB error', async () => {
    mockGetReposByInstallationId.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/repositories');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch repositories');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/installations
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/installations', () => {
  it('returns installations the user has access to', async () => {
    mockGetInstallationById.mockResolvedValueOnce({
      id: 100,
      accountLogin: 'my-org',
      accountType: 'Organization',
    });

    const app = createApp();
    const res = await app.request('/api/installations');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([
      { id: 100, accountLogin: 'my-org', accountType: 'Organization' },
    ]);
  });

  it('skips installations that are not found in DB', async () => {
    const user = { ...DEFAULT_USER, installationIds: [100, 200] };
    mockGetInstallationById
      .mockResolvedValueOnce({ id: 100, accountLogin: 'org', accountType: 'Organization' })
      .mockResolvedValueOnce(null); // Installation 200 not found

    const app = createApp(user);
    const res = await app.request('/api/installations');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe(100);
  });

  it('returns 500 on DB error', async () => {
    mockGetInstallationById.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/installations');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch installations');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/installation-settings
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/installation-settings', () => {
  it('returns existing installation settings with masked keys', async () => {
    mockGetInstallationById.mockResolvedValueOnce({
      id: 100,
      accountLogin: 'my-org',
    });
    mockGetInstallationSettings.mockResolvedValueOnce({
      providerChain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc-key' },
        { provider: 'github', model: 'gpt-4o', encryptedApiKey: null },
      ],
      aiReviewEnabled: true,
      reviewMode: 'consensus',
      settings: {
        enableSemgrep: true,
        enableTrivy: false,
        enableCpd: true,
        enableMemory: false,
        customRules: ['rule-a', 'rule-b'],
        ignorePatterns: ['*.lock'],
      },
    });

    const app = createApp();
    const res = await app.request('/api/installation-settings?installation_id=100');

    expect(res.status).toBe(200);
    const json = await res.json();
    const data = json.data;

    expect(data.installationId).toBe(100);
    expect(data.accountLogin).toBe('my-org');
    expect(data.aiReviewEnabled).toBe(true);
    expect(data.reviewMode).toBe('consensus');
    expect(data.enableSemgrep).toBe(true);
    expect(data.enableTrivy).toBe(false);
    expect(data.enableCpd).toBe(true);
    expect(data.enableMemory).toBe(false);
    expect(data.customRules).toBe('rule-a\nrule-b');
    expect(data.ignorePatterns).toEqual(['*.lock']);

    // Provider chain: first entry has key, second doesn't
    expect(data.providerChain).toHaveLength(2);
    expect(data.providerChain[0].hasApiKey).toBe(true);
    expect(data.providerChain[0].maskedApiKey).toBeDefined();
    expect(data.providerChain[1].hasApiKey).toBe(false);
    expect(data.providerChain[1].maskedApiKey).toBeUndefined();
  });

  it('returns defaults when no settings exist', async () => {
    mockGetInstallationById.mockResolvedValueOnce({
      id: 100,
      accountLogin: 'my-org',
    });
    mockGetInstallationSettings.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/installation-settings?installation_id=100');

    expect(res.status).toBe(200);
    const json = await res.json();
    const data = json.data;

    expect(data.providerChain).toEqual([]);
    expect(data.aiReviewEnabled).toBe(true);
    expect(data.reviewMode).toBe('simple');
    expect(data.enableSemgrep).toBe(true);
    expect(data.enableTrivy).toBe(true);
    expect(data.enableCpd).toBe(true);
    expect(data.enableMemory).toBe(true);
    expect(data.customRules).toBe('');
  });

  it('returns 400 when installation_id is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings');

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing or invalid installation_id');
  });

  it('returns 400 when installation_id is not a number', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings?installation_id=abc');

    expect(res.status).toBe(400);
  });

  it('returns 403 when user does not have access to installation', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings?installation_id=999');

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toBe('Forbidden');
  });

  it('returns 500 on DB error', async () => {
    mockGetInstallationById.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/installation-settings?installation_id=100');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to fetch installation settings');
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/installation-settings
// ═══════════════════════════════════════════════════════════════════

describe('PUT /api/installation-settings', () => {
  it('updates installation settings and encrypts new API keys', async () => {
    mockGetInstallationSettings.mockResolvedValueOnce(null); // No existing settings
    mockUpsertInstallationSettings.mockResolvedValueOnce({});

    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 100,
        providerChain: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'sk-ant-new-key' },
        ],
        aiReviewEnabled: false,
        reviewMode: 'consensus',
        enableSemgrep: false,
        enableTrivy: true,
        enableCpd: false,
        enableMemory: true,
        customRules: 'rule-one\nrule-two',
        ignorePatterns: ['*.lock', '*.md'],
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Installation settings updated');

    // Verify encrypt was called with the new key
    expect(mockEncrypt).toHaveBeenCalledWith('sk-ant-new-key');

    // Verify upsert was called with correct args
    expect(mockUpsertInstallationSettings).toHaveBeenCalledOnce();
    const [db, installId, updates] = mockUpsertInstallationSettings.mock.calls[0];
    expect(installId).toBe(100);
    expect(updates.providerChain[0].encryptedApiKey).toBe('encrypted-sk-ant-new-key');
    expect(updates.aiReviewEnabled).toBe(false);
    expect(updates.reviewMode).toBe('consensus');
    expect(updates.settings.enableSemgrep).toBe(false);
    expect(updates.settings.customRules).toEqual(['rule-one', 'rule-two']);
    expect(updates.settings.ignorePatterns).toEqual(['*.lock', '*.md']);
  });

  it('preserves existing API key when no new key provided', async () => {
    mockGetInstallationSettings.mockResolvedValueOnce({
      providerChain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'existing-enc-key' },
      ],
      settings: {
        enableSemgrep: true,
        enableTrivy: true,
        enableCpd: true,
        enableMemory: true,
        customRules: [],
        ignorePatterns: [],
        reviewLevel: 'normal',
      },
    });
    mockUpsertInstallationSettings.mockResolvedValueOnce({});

    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 100,
        providerChain: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // No apiKey
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockEncrypt).not.toHaveBeenCalled();

    const [, , updates] = mockUpsertInstallationSettings.mock.calls[0];
    expect(updates.providerChain[0].encryptedApiKey).toBe('existing-enc-key');
  });

  it('sets null encryptedApiKey for github provider', async () => {
    mockGetInstallationSettings.mockResolvedValueOnce(null);
    mockUpsertInstallationSettings.mockResolvedValueOnce({});

    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 100,
        providerChain: [
          { provider: 'github', model: 'gpt-4o' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const [, , updates] = mockUpsertInstallationSettings.mock.calls[0];
    expect(updates.providerChain[0].encryptedApiKey).toBeNull();
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json{{{',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when installationId is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerChain: [] }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing or invalid installationId');
  });

  it('returns 400 when installationId is not a number', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: 'not-a-number' }),
    });

    expect(res.status).toBe(400);
  });

  it('returns 403 when user does not have access', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ installationId: 999 }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid provider (ollama)', async () => {
    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 100,
        providerChain: [{ provider: 'ollama', model: 'llama3' }],
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Provider 'ollama' is not available");
  });

  it('returns 500 on DB error', async () => {
    mockGetInstallationSettings.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/installation-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installationId: 100,
        providerChain: [{ provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'key' }],
      }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to update installation settings');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/settings
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/settings', () => {
  it('returns repo settings with masked keys and global settings', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    // Global settings for reference
    mockGetInstallationSettings.mockResolvedValueOnce({
      providerChain: [
        { provider: 'openai', model: 'gpt-4o', encryptedApiKey: 'global-enc-key' },
      ],
      aiReviewEnabled: true,
      reviewMode: 'simple',
      settings: {
        enableSemgrep: true,
        enableTrivy: true,
        enableCpd: true,
        enableMemory: true,
        customRules: ['global-rule'],
        ignorePatterns: ['*.lock'],
      },
    });

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    const data = json.data;

    expect(data.repoId).toBe(42);
    expect(data.repoFullName).toBe('owner/repo');
    expect(data.useGlobalSettings).toBe(false);
    expect(data.aiReviewEnabled).toBe(true);
    expect(data.reviewMode).toBe('simple');
    expect(data.enableSemgrep).toBe(true);
    expect(data.enableTrivy).toBe(true);
    expect(data.enableCpd).toBe(false);
    expect(data.enableMemory).toBe(true);
    expect(data.customRules).toBe('no-console\nno-debugger');
    expect(data.ignorePatterns).toEqual(['*.md']);

    // Provider chain: keys are masked
    expect(data.providerChain).toHaveLength(1);
    expect(data.providerChain[0].provider).toBe('anthropic');
    expect(data.providerChain[0].hasApiKey).toBe(true);
    expect(data.providerChain[0].maskedApiKey).toBeDefined();
    // No encryptedApiKey exposed
    expect(data.providerChain[0].encryptedApiKey).toBeUndefined();

    // Global settings reference
    expect(data.globalSettings).toBeDefined();
    expect(data.globalSettings.providerChain[0].provider).toBe('openai');
    expect(data.globalSettings.providerChain[0].hasApiKey).toBe(true);
  });

  it('returns null globalSettings when no installation settings exist', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockGetInstallationSettings.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.globalSettings).toBeUndefined();
  });

  it('handles repo with empty providerChain and null settings fields', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      providerChain: [],
      settings: {
        enableSemgrep: false,
        enableTrivy: false,
        enableCpd: false,
        enableMemory: false,
        customRules: null,
        ignorePatterns: null,
        reviewLevel: 'soft',
      },
    });
    mockGetInstallationSettings.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.providerChain).toEqual([]);
    expect(json.data.customRules).toBe('');
    expect(json.data.ignorePatterns).toEqual([]);
  });

  it('returns 400 when repo param is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/settings');

    expect(res.status).toBe(400);
  });

  it('returns 404 when repo not found', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings?repo=unknown/repo');

    expect(res.status).toBe(404);
  });

  it('returns 403 when user lacks access', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      installationId: 999,
    });

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    expect(res.status).toBe(403);
  });

  it('returns 500 on DB error', async () => {
    mockGetRepoByFullName.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    expect(res.status).toBe(500);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PUT /api/settings
// ═══════════════════════════════════════════════════════════════════

describe('PUT /api/settings', () => {
  it('updates repo settings with encrypted new API keys', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockUpdateRepoSettings.mockResolvedValueOnce(undefined);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        providerChain: [
          { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-new-openai-key' },
        ],
        aiReviewEnabled: true,
        reviewMode: 'workflow',
        enableSemgrep: true,
        enableTrivy: false,
        enableCpd: true,
        enableMemory: false,
        customRules: 'my-rule-1\nmy-rule-2',
        ignorePatterns: ['*.md', '*.txt'],
        useGlobalSettings: false,
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toBe('Settings updated');

    expect(mockEncrypt).toHaveBeenCalledWith('sk-new-openai-key');
    expect(mockUpdateRepoSettings).toHaveBeenCalledOnce();

    const [db, repoId, updates] = mockUpdateRepoSettings.mock.calls[0];
    expect(repoId).toBe(42);
    expect(updates.providerChain[0].provider).toBe('openai');
    expect(updates.providerChain[0].encryptedApiKey).toBe('encrypted-sk-new-openai-key');
    expect(updates.aiReviewEnabled).toBe(true);
    expect(updates.reviewMode).toBe('workflow');
    expect(updates.useGlobalSettings).toBe(false);
    expect(updates.settings.enableSemgrep).toBe(true);
    expect(updates.settings.enableTrivy).toBe(false);
    expect(updates.settings.customRules).toEqual(['my-rule-1', 'my-rule-2']);
    expect(updates.settings.ignorePatterns).toEqual(['*.md', '*.txt']);
  });

  it('preserves existing encrypted key when no new key provided', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockUpdateRepoSettings.mockResolvedValueOnce(undefined);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        providerChain: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514' }, // No apiKey
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(mockEncrypt).not.toHaveBeenCalled();

    const [, , updates] = mockUpdateRepoSettings.mock.calls[0];
    // Should preserve existing encryptedApiKey from FAKE_REPO's providerChain
    expect(updates.providerChain[0].encryptedApiKey).toBe('enc-key-1');
  });

  it('sets null encryptedApiKey for github provider without key', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockUpdateRepoSettings.mockResolvedValueOnce(undefined);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        providerChain: [
          { provider: 'github', model: 'gpt-4o-mini' },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const [, , updates] = mockUpdateRepoSettings.mock.calls[0];
    expect(updates.providerChain[0].provider).toBe('github');
    expect(updates.providerChain[0].encryptedApiKey).toBeNull();
  });

  it('sets null for provider with no existing key and no new key', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockUpdateRepoSettings.mockResolvedValueOnce(undefined);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        providerChain: [
          { provider: 'google', model: 'gemini-2.0-flash' }, // No existing key in FAKE_REPO
        ],
      }),
    });

    expect(res.status).toBe(200);
    const [, , updates] = mockUpdateRepoSettings.mock.calls[0];
    expect(updates.providerChain[0].encryptedApiKey).toBeNull();
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when repoFullName is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerChain: [] }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Missing repoFullName');
  });

  it('returns 404 when repo not found', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoFullName: 'unknown/repo' }),
    });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user lacks access', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      installationId: 999,
    });

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoFullName: 'owner/repo' }),
    });

    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid provider (ollama)', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        providerChain: [{ provider: 'ollama', model: 'llama3' }],
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("Provider 'ollama' is not available");
  });

  it('handles empty providerChain', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockUpdateRepoSettings.mockResolvedValueOnce(undefined);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        providerChain: [],
      }),
    });

    expect(res.status).toBe(200);
    const [, , updates] = mockUpdateRepoSettings.mock.calls[0];
    expect(updates.providerChain).toEqual([]);
  });

  it('preserves current settings when fields are not provided', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    mockUpdateRepoSettings.mockResolvedValueOnce(undefined);

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repoFullName: 'owner/repo',
        // No settings fields provided — should preserve FAKE_REPO.settings
      }),
    });

    expect(res.status).toBe(200);
    const [, , updates] = mockUpdateRepoSettings.mock.calls[0];
    expect(updates.settings.enableSemgrep).toBe(true); // From FAKE_REPO
    expect(updates.settings.enableCpd).toBe(false); // From FAKE_REPO
    expect(updates.aiReviewEnabled).toBeUndefined(); // Not passed
    expect(updates.reviewMode).toBeUndefined(); // Not passed
    expect(updates.useGlobalSettings).toBeUndefined(); // Not passed
  });

  it('returns 500 on DB error', async () => {
    mockGetRepoByFullName.mockRejectedValueOnce(new Error('DB error'));

    const app = createApp();
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoFullName: 'owner/repo' }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe('Failed to update settings');
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/providers/validate
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/providers/validate', () => {
  it('validates an anthropic API key successfully', async () => {
    mockValidateProviderKey.mockResolvedValueOnce({
      valid: true,
      models: ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022'],
    });

    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-ant-key' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(true);
    expect(json.models).toHaveLength(2);

    expect(mockValidateProviderKey).toHaveBeenCalledWith('anthropic', 'sk-ant-key');
  });

  it('validates openai key', async () => {
    mockValidateProviderKey.mockResolvedValueOnce({
      valid: true,
      models: ['gpt-4o'],
    });

    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'openai', apiKey: 'sk-openai-key' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.valid).toBe(true);
  });

  it('uses user session token for github provider', async () => {
    mockValidateProviderKey.mockResolvedValueOnce({
      valid: true,
      models: ['gpt-4o-mini'],
    });

    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ghp-user-token',
      },
      body: JSON.stringify({ provider: 'github' }),
    });

    expect(res.status).toBe(200);
    // Should use the Bearer token, not body.apiKey
    expect(mockValidateProviderKey).toHaveBeenCalledWith('github', 'ghp-user-token');
  });

  it('returns 400 for invalid JSON body', async () => {
    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid JSON body');
  });

  it('returns 400 when provider is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: 'some-key' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Missing provider field');
  });

  it('returns 400 for ollama provider', async () => {
    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', apiKey: 'key' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Ollama is not available');
  });

  it('returns 400 for unknown provider', async () => {
    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'mistral', apiKey: 'key' }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Unknown provider');
  });

  it('returns 400 when apiKey missing for non-GitHub provider', async () => {
    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic' }), // No apiKey
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Missing apiKey for non-GitHub provider');
  });

  it('returns error result when validateProviderKey throws', async () => {
    mockValidateProviderKey.mockRejectedValueOnce(new Error('Network error'));

    const app = createApp();
    const res = await app.request('/api/providers/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'anthropic', apiKey: 'sk-key' }),
    });

    expect(res.status).toBe(200); // Returns 200 with error in body
    const json = await res.json();
    expect(json.valid).toBe(false);
    expect(json.error).toBe('Validation request failed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/memory/sessions
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/memory/sessions', () => {
  it('returns sessions for an accessible project', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(FAKE_REPO);
    const fakeSessions = [
      { id: 1, project: 'owner/repo', startedAt: '2025-01-01' },
      { id: 2, project: 'owner/repo', startedAt: '2025-01-02' },
    ];
    mockGetSessionsByProject.mockResolvedValueOnce(fakeSessions);

    const app = createApp();
    const res = await app.request('/api/memory/sessions?project=owner/repo');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(fakeSessions);
    expect(mockGetSessionsByProject).toHaveBeenCalledWith(mockDb, 'owner/repo');
  });

  it('returns 400 when project param is missing', async () => {
    const app = createApp();
    const res = await app.request('/api/memory/sessions');

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Missing required query parameter: project');
  });

  it('returns 404 when project repo not found', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/memory/sessions?project=unknown/repo');

    expect(res.status).toBe(404);
  });

  it('returns 403 when user lacks access', async () => {
    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      installationId: 999,
    });

    const app = createApp();
    const res = await app.request('/api/memory/sessions?project=owner/repo');

    expect(res.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/memory/sessions/:id/observations
// ═══════════════════════════════════════════════════════════════════

describe('GET /api/memory/sessions/:id/observations', () => {
  it('returns observations for a session', async () => {
    const fakeObservations = [
      { id: 1, title: 'Decision A', type: 'decision' },
      { id: 2, title: 'Pattern B', type: 'pattern' },
    ];
    mockGetObservationsBySession.mockResolvedValueOnce(fakeObservations);

    const app = createApp();
    const res = await app.request('/api/memory/sessions/5/observations');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual(fakeObservations);
    expect(mockGetObservationsBySession).toHaveBeenCalledWith(mockDb, 5);
  });

  it('returns 400 for invalid (non-numeric) session ID', async () => {
    const app = createApp();
    const res = await app.request('/api/memory/sessions/abc/observations');

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid session ID');
  });

  it('returns empty array when session has no observations', async () => {
    mockGetObservationsBySession.mockResolvedValueOnce([]);

    const app = createApp();
    const res = await app.request('/api/memory/sessions/99/observations');

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// maskApiKey helper (tested via GET routes that expose maskedApiKey)
// ═══════════════════════════════════════════════════════════════════

describe('maskApiKey (via GET /api/settings)', () => {
  it('masks normal-length keys showing prefix and suffix', async () => {
    // Use a key that when "decrypted" is long enough (> 8 chars)
    const longKey = 'sk-abcdef-long-key-1234';
    mockDecrypt.mockReturnValue(longKey);

    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      providerChain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc' },
      ],
    });
    mockGetInstallationSettings.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    const json = await res.json();
    const masked = json.data.providerChain[0].maskedApiKey;

    // Should show first 3 + "..." + last 4
    expect(masked).toBe('sk-...1234');
  });

  it('masks short keys (<=8 chars) as ***', async () => {
    mockDecrypt.mockReturnValue('shortkey'); // exactly 8 chars

    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      providerChain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc' },
      ],
    });
    mockGetInstallationSettings.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    const json = await res.json();
    expect(json.data.providerChain[0].maskedApiKey).toBe('***');
  });

  it('masks very short keys as ***', async () => {
    mockDecrypt.mockReturnValue('ab'); // 2 chars

    mockGetRepoByFullName.mockResolvedValueOnce({
      ...FAKE_REPO,
      providerChain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc' },
      ],
    });
    mockGetInstallationSettings.mockResolvedValueOnce(null);

    const app = createApp();
    const res = await app.request('/api/settings?repo=owner/repo');

    const json = await res.json();
    expect(json.data.providerChain[0].maskedApiKey).toBe('***');
  });
});
