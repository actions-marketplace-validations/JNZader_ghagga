/**
 * Webhook handler integration tests.
 *
 * Tests the actual HTTP routing, signature verification, event dispatching,
 * and error handling of the webhook router using mocked dependencies.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createWebhookRouter } from './webhook.js';

// ─── Mocks ──────────────────────────────────────────────────────

// Mock ghagga-db
const mockUpsertInstallation = vi.fn();
const mockDeactivateInstallation = vi.fn();
const mockUpsertRepository = vi.fn();
const mockGetRepoByGithubId = vi.fn();
const mockGetEffectiveRepoSettings = vi.fn();

vi.mock('ghagga-db', () => ({
  upsertInstallation: (...args: unknown[]) => mockUpsertInstallation(...args),
  deactivateInstallation: (...args: unknown[]) => mockDeactivateInstallation(...args),
  upsertRepository: (...args: unknown[]) => mockUpsertRepository(...args),
  getRepoByGithubId: (...args: unknown[]) => mockGetRepoByGithubId(...args),
  getEffectiveRepoSettings: (...args: unknown[]) => mockGetEffectiveRepoSettings(...args),
}));

// Mock inngest client
const mockInngestSend = vi.fn();
vi.mock('../inngest/client.js', () => ({
  inngest: { send: (...args: unknown[]) => mockInngestSend(...args) },
}));

// Mock GitHub client functions used by issue_comment handler
const mockAddCommentReaction = vi.fn();
const mockGetInstallationToken = vi.fn();
const mockFetchPRDetails = vi.fn();
vi.mock('../github/client.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../github/client.js')>();
  return {
    ...original,
    addCommentReaction: (...args: unknown[]) => mockAddCommentReaction(...args),
    getInstallationToken: (...args: unknown[]) => mockGetInstallationToken(...args),
    fetchPRDetails: (...args: unknown[]) => mockFetchPRDetails(...args),
  };
});

// ─── Helpers ────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-secret-key';

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

function makeRequest(
  body: string,
  eventType: string,
  options: { signature?: string | null; skipSignature?: boolean } = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-github-event': eventType,
  };

  if (!options.skipSignature) {
    headers['x-hub-signature-256'] = options.signature ?? sign(body);
  }

  return new Request('http://localhost/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

const FAKE_REPO = {
  id: 42,
  githubRepoId: 12345,
  installationId: 1,
  fullName: 'owner/repo',
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-20250514',
  reviewMode: 'simple',
  encryptedApiKey: 'encrypted-key-123',
  settings: {
    enableSemgrep: true,
    enableTrivy: true,
    enableCpd: false,
    enableMemory: true,
    customRules: [],
    ignorePatterns: ['*.md'],
    reviewLevel: 'standard',
  },
};

// ─── Setup ──────────────────────────────────────────────────────

let router: ReturnType<typeof createWebhookRouter>;
let originalEnv: string | undefined;
let originalAppId: string | undefined;
let originalPrivateKey: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalEnv = process.env.GITHUB_WEBHOOK_SECRET;
  originalAppId = process.env.GITHUB_APP_ID;
  originalPrivateKey = process.env.GITHUB_PRIVATE_KEY;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.GITHUB_APP_ID = '12345';
  process.env.GITHUB_PRIVATE_KEY = 'fake-private-key';
  router = createWebhookRouter({} as any); // db is mocked at module level

  // Default mock returns
  mockUpsertInstallation.mockResolvedValue({ id: 1 });
  mockUpsertRepository.mockResolvedValue({ id: 1 });
  mockDeactivateInstallation.mockResolvedValue(undefined);
  mockGetRepoByGithubId.mockResolvedValue(null);
  mockAddCommentReaction.mockResolvedValue(undefined);
  mockGetInstallationToken.mockResolvedValue('fake-installation-token');
  mockFetchPRDetails.mockResolvedValue({ headSha: 'pr-head-sha-abc', baseBranch: 'main' });
  mockGetEffectiveRepoSettings.mockResolvedValue({
    providerChain: [],
    aiReviewEnabled: true,
    reviewMode: 'simple',
    settings: {
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: false,
      enableMemory: true,
      customRules: [],
      ignorePatterns: ['*.md'],
      reviewLevel: 'standard',
    },
    source: 'repo',
  });
  mockInngestSend.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.GITHUB_WEBHOOK_SECRET = originalEnv;
  } else {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  }
  if (originalAppId !== undefined) {
    process.env.GITHUB_APP_ID = originalAppId;
  } else {
    delete process.env.GITHUB_APP_ID;
  }
  if (originalPrivateKey !== undefined) {
    process.env.GITHUB_PRIVATE_KEY = originalPrivateKey;
  } else {
    delete process.env.GITHUB_PRIVATE_KEY;
  }
});

// ─── Signature Verification ─────────────────────────────────────

describe('webhook signature verification', () => {
  it('returns 401 for missing signature', async () => {
    const body = JSON.stringify({ action: 'opened' });
    const req = makeRequest(body, 'pull_request', { skipSignature: true });
    const res = await router.fetch(req);
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Invalid signature');
  });

  it('returns 401 for invalid signature', async () => {
    const body = JSON.stringify({ action: 'opened' });
    const req = makeRequest(body, 'pull_request', { signature: 'sha256=invalid' });
    const res = await router.fetch(req);
    expect(res.status).toBe(401);
  });

  it('returns 500 when GITHUB_WEBHOOK_SECRET is not set', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const body = JSON.stringify({ action: 'opened' });
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Server misconfiguration');
  });
});

// ─── Event Routing ──────────────────────────────────────────────

describe('webhook event routing', () => {
  it('returns 400 when x-github-event header is missing', async () => {
    const body = JSON.stringify({ action: 'opened' });
    const signature = sign(body);
    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': signature,
      },
      body,
    });
    const res = await router.fetch(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Missing x-github-event header');
  });

  it('returns 400 for invalid JSON payload', async () => {
    const body = 'not-valid-json{{{';
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Invalid JSON payload');
  });

  it('returns 200 for unknown event types', async () => {
    const body = JSON.stringify({ action: 'whatever' });
    const req = makeRequest(body, 'star');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Event star ignored');
  });
});

// ─── Pull Request Events ────────────────────────────────────────

describe('pull_request event handling', () => {
  const prPayload = {
    action: 'opened',
    number: 42,
    pull_request: {
      number: 42,
      head: { sha: 'abc123' },
      base: { ref: 'main' },
    },
    repository: { id: 12345, full_name: 'owner/repo' },
    installation: { id: 999 },
  };

  it('dispatches review via Inngest for opened PR', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify(prPayload);
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Review dispatched');
    expect(json).toHaveProperty('pr', 42);
    expect(json).toHaveProperty('repo', 'owner/repo');

    expect(mockInngestSend).toHaveBeenCalledOnce();
    const sendArg = mockInngestSend.mock.calls[0]![0];
    expect(sendArg.name).toBe('ghagga/review.requested');
    expect(sendArg.data.installationId).toBe(999);
    expect(sendArg.data.repoFullName).toBe('owner/repo');
    expect(sendArg.data.prNumber).toBe(42);
  });

  it('dispatches review for synchronize action', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({ ...prPayload, action: 'synchronize' });
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('dispatches review for reopened action', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({ ...prPayload, action: 'reopened' });
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('ignores non-reviewable actions (closed, edited, labeled)', async () => {
    for (const action of ['closed', 'edited', 'labeled', 'assigned']) {
      vi.clearAllMocks();
      const body = JSON.stringify({ ...prPayload, action });
      const req = makeRequest(body, 'pull_request');
      const res = await router.fetch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toContain('ignored');
      expect(mockInngestSend).not.toHaveBeenCalled();
    }
  });

  it('returns 400 when installation ID is missing', async () => {
    const body = JSON.stringify({ ...prPayload, installation: undefined });
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Missing installation ID');
  });

  it('returns 200 when repository is not tracked', async () => {
    mockGetRepoByGithubId.mockResolvedValue(null);
    const body = JSON.stringify(prPayload);
    const req = makeRequest(body, 'pull_request');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('not tracked');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('passes repo settings to Inngest event data', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify(prPayload);
    const req = makeRequest(body, 'pull_request');
    await router.fetch(req);

    const sendArg = mockInngestSend.mock.calls[0]![0];
    expect(sendArg.data.settings.enableSemgrep).toBe(true);
    expect(sendArg.data.settings.enableTrivy).toBe(true);
    expect(sendArg.data.settings.enableCpd).toBe(false);
    expect(sendArg.data.settings.enableMemory).toBe(true);
    expect(sendArg.data.settings.ignorePatterns).toEqual(['*.md']);
    expect(sendArg.data.encryptedApiKey).toBe('encrypted-key-123');
    expect(sendArg.data.llmProvider).toBe('anthropic');
  });
});

// ─── Installation Events ────────────────────────────────────────

describe('installation event handling', () => {
  const installPayload = {
    action: 'created',
    installation: {
      id: 555,
      account: { login: 'my-org', type: 'Organization' },
    },
    repositories: [
      { id: 100, full_name: 'my-org/repo-a' },
      { id: 200, full_name: 'my-org/repo-b' },
    ],
  };

  it('creates installation and upserts repositories on created', async () => {
    const body = JSON.stringify(installPayload);
    const req = makeRequest(body, 'installation');
    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Installation tracked');

    expect(mockUpsertInstallation).toHaveBeenCalledOnce();
    expect(mockUpsertInstallation.mock.calls[0]![1]).toMatchObject({
      githubInstallationId: 555,
      accountLogin: 'my-org',
      accountType: 'Organization',
    });

    expect(mockUpsertRepository).toHaveBeenCalledTimes(2);
  });

  it('deactivates installation on deleted', async () => {
    const body = JSON.stringify({ ...installPayload, action: 'deleted' });
    const req = makeRequest(body, 'installation');
    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Installation deactivated');
    expect(mockDeactivateInstallation).toHaveBeenCalledOnce();
  });

  it('ignores unknown installation actions (suspend, etc)', async () => {
    const body = JSON.stringify({ ...installPayload, action: 'suspend' });
    const req = makeRequest(body, 'installation');
    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('ignored');
  });
});

// ─── Installation Repositories Events ───────────────────────────

describe('installation_repositories event handling', () => {
  const repoEvent = {
    action: 'added',
    installation: {
      id: 555,
      account: { login: 'my-org', type: 'Organization' },
    },
    repositories_added: [
      { id: 300, full_name: 'my-org/repo-c' },
    ],
    repositories_removed: [],
  };

  it('upserts added repositories', async () => {
    const body = JSON.stringify(repoEvent);
    const req = makeRequest(body, 'installation_repositories');
    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Repositories updated');

    // Ensures installation is upserted first
    expect(mockUpsertInstallation).toHaveBeenCalledOnce();
    expect(mockUpsertRepository).toHaveBeenCalledOnce();
    expect(mockUpsertRepository.mock.calls[0]![1]).toMatchObject({
      githubRepoId: 300,
      fullName: 'my-org/repo-c',
    });
  });

  it('handles removed repositories (looks up existing)', async () => {
    mockGetRepoByGithubId.mockResolvedValue({ id: 1, fullName: 'my-org/old-repo' });
    const body = JSON.stringify({
      ...repoEvent,
      repositories_added: [],
      repositories_removed: [{ id: 400, full_name: 'my-org/old-repo' }],
    });
    const req = makeRequest(body, 'installation_repositories');
    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    expect(mockGetRepoByGithubId).toHaveBeenCalledOnce();
  });
});

// ─── Issue Comment Events (ghagga review trigger) ───────────────

describe('issue_comment event handling', () => {
  const commentPayload = {
    action: 'created',
    comment: {
      id: 777,
      body: 'ghagga review',
      user: { login: 'contributor-user', type: 'User' },
      author_association: 'CONTRIBUTOR',
    },
    issue: {
      number: 42,
      pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/42' },
    },
    repository: { id: 12345, full_name: 'owner/repo' },
    installation: { id: 999 },
  };

  it('dispatches review when "ghagga review" keyword is found in PR comment', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify(commentPayload);
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json).toHaveProperty('message', 'Review dispatched (comment trigger)');
    expect(json).toHaveProperty('pr', 42);
    expect(json).toHaveProperty('triggeredBy', 'contributor-user');

    expect(mockInngestSend).toHaveBeenCalledOnce();
    const sendArg = mockInngestSend.mock.calls[0]![0];
    expect(sendArg.name).toBe('ghagga/review.requested');
    expect(sendArg.data.prNumber).toBe(42);
    expect(sendArg.data.triggerCommentId).toBe(777);
    expect(sendArg.data.headSha).toBe('pr-head-sha-abc');
    expect(sendArg.data.baseBranch).toBe('main');
  });

  it('fetches PR details to include headSha and baseBranch', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    mockFetchPRDetails.mockResolvedValue({ headSha: 'def456', baseBranch: 'develop' });
    const body = JSON.stringify(commentPayload);
    const req = makeRequest(body, 'issue_comment');
    await router.fetch(req);

    expect(mockFetchPRDetails).toHaveBeenCalledWith(
      'owner', 'repo', 42, 'fake-installation-token',
    );
    const sendArg = mockInngestSend.mock.calls[0]![0];
    expect(sendArg.data.headSha).toBe('def456');
    expect(sendArg.data.baseBranch).toBe('develop');
  });

  it('dispatches review without headSha when PR details fetch fails', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    mockFetchPRDetails.mockRejectedValue(new Error('API rate limit'));
    const body = JSON.stringify(commentPayload);
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);

    // Should still dispatch the review (LLM-only, no runner)
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
    const sendArg = mockInngestSend.mock.calls[0]![0];
    expect(sendArg.data.headSha).toBeUndefined();
    expect(sendArg.data.baseBranch).toBeUndefined();
  });

  it('adds 👀 reaction to acknowledge the trigger', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify(commentPayload);
    const req = makeRequest(body, 'issue_comment');
    await router.fetch(req);

    expect(mockGetInstallationToken).toHaveBeenCalledOnce();
    expect(mockAddCommentReaction).toHaveBeenCalledWith(
      'owner', 'repo', 777, 'eyes', 'fake-installation-token',
    );
  });

  it('triggers on case-insensitive "GHAGGA REVIEW"', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, body: 'Please GHAGGA REVIEW this PR' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('triggers when keyword is embedded in longer text', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, body: 'Hey can you do a ghagga review on this? Thanks!' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('ignores comments without the trigger keyword', async () => {
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, body: 'Looks good to me!' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('No review trigger keyword');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('ignores bot comments (self-trigger prevention)', async () => {
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, user: { login: 'ghagga[bot]', type: 'Bot' } },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('Bot comment ignored');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('ignores edited or deleted comment actions', async () => {
    for (const action of ['edited', 'deleted']) {
      vi.clearAllMocks();
      const body = JSON.stringify({ ...commentPayload, action });
      const req = makeRequest(body, 'issue_comment');
      const res = await router.fetch(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.message).toContain('ignored');
      expect(mockInngestSend).not.toHaveBeenCalled();
    }
  });

  it('ignores comments on regular issues (not PRs)', async () => {
    const body = JSON.stringify({
      ...commentPayload,
      issue: { number: 10 }, // No pull_request field
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('not on a pull request');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('rejects users with NONE association', async () => {
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, author_association: 'NONE' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('Insufficient permissions');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('rejects MANNEQUIN association', async () => {
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, author_association: 'MANNEQUIN' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('allows OWNER association', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, author_association: 'OWNER' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('allows MEMBER association', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, author_association: 'MEMBER' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('allows FIRST_TIMER association', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, author_association: 'FIRST_TIMER' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('allows FIRST_TIME_CONTRIBUTOR association', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    const body = JSON.stringify({
      ...commentPayload,
      comment: { ...commentPayload.comment, author_association: 'FIRST_TIME_CONTRIBUTOR' },
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });

  it('returns 400 when installation ID is missing', async () => {
    const body = JSON.stringify({
      ...commentPayload,
      installation: undefined,
    });
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(400);
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 200 when repository is not tracked', async () => {
    mockGetRepoByGithubId.mockResolvedValue(null);
    const body = JSON.stringify(commentPayload);
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.message).toContain('not tracked');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('continues dispatching even if reaction fails', async () => {
    mockGetRepoByGithubId.mockResolvedValue(FAKE_REPO);
    mockGetInstallationToken.mockRejectedValue(new Error('Token failed'));
    const body = JSON.stringify(commentPayload);
    const req = makeRequest(body, 'issue_comment');
    const res = await router.fetch(req);

    // Should still dispatch the review despite reaction failure
    expect(res.status).toBe(202);
    expect(mockInngestSend).toHaveBeenCalledOnce();
  });
});
