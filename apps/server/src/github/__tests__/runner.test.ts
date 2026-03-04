/**
 * Unit tests for runner.ts — GitHub Actions runner repo lifecycle.
 *
 * Tests: ensureRunnerRepo, dispatchAnalysis, deleteRunnerRepo, and internal
 * helpers (workflow integrity, HMAC signature, sealed box encryption).
 *
 * Mocking strategy:
 *   - `global.fetch` — mocked per-test to simulate GitHub API responses
 *   - `getInstallationToken` — mocked via vi.mock (returns fake token)
 *   - `libsodium-wrappers` — mocked (WASM doesn't load in Vitest)
 *   - `node:fs` readFileSync — mocked to return a known workflow template
 *   - Logger — mocked to suppress output
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash, createHmac } from 'node:crypto';

// ─── Constants ──────────────────────────────────────────────────

const FAKE_TOKEN = 'ghs_fake_installation_token_abc123';
const FAKE_OWNER = 'test-owner';
const FAKE_INSTALLATION_ID = 12345;
const FAKE_APP_ID = '99999';
const FAKE_PRIVATE_KEY = 'fake-private-key-pem';
const WEBHOOK_SECRET = 'test-webhook-secret-for-hmac';

// A minimal but recognizable workflow template for testing
const FAKE_WORKFLOW_CONTENT = `name: GHAGGA Static Analysis
on:
  repository_dispatch:
    types: [ghagga-analysis]
jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - name: Run analysis
        run: echo "analyzing"
`;

const FAKE_WORKFLOW_HASH = createHash('sha256')
  .update(FAKE_WORKFLOW_CONTENT)
  .digest('hex');

const FAKE_WORKFLOW_B64 = Buffer.from(FAKE_WORKFLOW_CONTENT).toString('base64');

// ─── Mocks ──────────────────────────────────────────────────────

// Mock getInstallationToken
const mockGetInstallationToken = vi.fn().mockResolvedValue(FAKE_TOKEN);
vi.mock('../client.js', () => ({
  getInstallationToken: (...args: unknown[]) => mockGetInstallationToken(...args),
}));

// Mock logger (suppress output)
vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// Mock libsodium-wrappers
const mockSodium = {
  ready: Promise.resolve(),
  from_base64: vi.fn().mockReturnValue(new Uint8Array(32)),
  from_string: vi.fn().mockReturnValue(new Uint8Array(10)),
  crypto_box_seal: vi.fn().mockReturnValue(new Uint8Array(48)),
  to_base64: vi.fn().mockReturnValue('bW9ja19lbmNyeXB0ZWRfdmFsdWU='),
  base64_variants: { ORIGINAL: 0 },
};
vi.mock('libsodium-wrappers', () => ({ default: mockSodium }));

// Mock node:fs readFileSync to return our known workflow content
vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>();
  return {
    ...original,
    readFileSync: vi.fn((...args: unknown[]) => {
      const filePath = args[0] as string;
      if (typeof filePath === 'string' && filePath.includes('runner-workflow.yml')) {
        return FAKE_WORKFLOW_CONTENT;
      }
      return original.readFileSync(...(args as Parameters<typeof original.readFileSync>));
    }),
  };
});

// ─── Fetch Mock Infrastructure ──────────────────────────────────

type FetchHandler = (url: string, init?: RequestInit) => Response | Promise<Response>;

let fetchHandlers: FetchHandler[];

function mockFetchResponse(
  status: number,
  body: unknown = {},
  headers?: Record<string, string>,
): Response {
  // 204 No Content must have null body per spec
  if (status === 204) {
    return new Response(null, { status, headers });
  }
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function mockFetchText(status: number, text: string): Response {
  return new Response(text, { status });
}

/**
 * Register a sequence of fetch handlers. Each call to fetch() consumes the next handler.
 * If a handler is a function of (url, init), it gets full control.
 */
function setupFetchSequence(handlers: Array<FetchHandler | Response>) {
  fetchHandlers = handlers.map((h) =>
    typeof h === 'function' ? h : () => h,
  );

  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (fetchHandlers.length === 0) {
      throw new Error(`Unexpected fetch call: ${init?.method ?? 'GET'} ${url}`);
    }
    const handler = fetchHandlers.shift()!;
    return handler(url, init);
  }) as unknown as typeof fetch;
}

/**
 * Route-based fetch mock: matches URL patterns and methods.
 */
function setupFetchRoutes(
  routes: Array<{ match: string | RegExp; method?: string; response: Response | FetchHandler }>,
) {
  global.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? 'GET';

    for (const route of routes) {
      const urlMatch =
        typeof route.match === 'string'
          ? url.includes(route.match)
          : route.match.test(url);
      const methodMatch = !route.method || route.method === method;

      if (urlMatch && methodMatch) {
        if (typeof route.response === 'function') {
          return route.response(url, init);
        }
        return route.response.clone();
      }
    }
    throw new Error(`Unmatched fetch: ${method} ${url}`);
  }) as unknown as typeof fetch;
}

// ─── Setup / Teardown ───────────────────────────────────────────

let originalFetch: typeof fetch;
let originalEnv: Record<string, string | undefined>;

beforeEach(() => {
  vi.clearAllMocks();
  originalFetch = global.fetch;
  originalEnv = {
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET,
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_PRIVATE_KEY: process.env.GITHUB_PRIVATE_KEY,
  };
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.GITHUB_APP_ID = FAKE_APP_ID;
  process.env.GITHUB_PRIVATE_KEY = FAKE_PRIVATE_KEY;
  mockGetInstallationToken.mockResolvedValue(FAKE_TOKEN);
});

afterEach(() => {
  global.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// ─── Dynamic import (must happen after mocks are set up) ────────

async function importRunner() {
  // Clear module cache to ensure fresh import with our mocks
  const mod = await import('../runner.js');
  return mod;
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite
// ═══════════════════════════════════════════════════════════════════

describe('ensureRunnerRepo', () => {
  it('creates repo + commits workflow when repo does not exist', async () => {
    const apiCalls: string[] = [];

    setupFetchRoutes([
      // 1. repoExists check → 404
      {
        match: `/repos/${FAKE_OWNER}/ghagga-runner`,
        method: 'GET',
        response: (url) => {
          // Only match exact repo check, not contents
          if (url.includes('/contents/')) return mockFetchResponse(404);
          apiCalls.push('GET repo');
          return mockFetchResponse(404);
        },
      },
      // 2. isOrganization check
      {
        match: `/users/${FAKE_OWNER}`,
        method: 'GET',
        response: () => {
          apiCalls.push('GET user');
          return mockFetchResponse(200, { type: 'User' });
        },
      },
      // 3. createRepo (user repos)
      {
        match: '/user/repos',
        method: 'POST',
        response: () => {
          apiCalls.push('POST user/repos');
          return mockFetchResponse(201, { full_name: `${FAKE_OWNER}/ghagga-runner` });
        },
      },
      // 4. commitWorkflowFile (PUT contents)
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'PUT',
        response: () => {
          apiCalls.push('PUT workflow');
          return mockFetchResponse(201, { content: { sha: 'abc123' } });
        },
      },
      // 5. setLogRetention (PUT retention)
      {
        match: '/actions/permissions/artifact-and-log-retention',
        method: 'PUT',
        response: () => {
          apiCalls.push('PUT retention');
          return mockFetchResponse(204);
        },
      },
      // 6. setLogRetention (PUT actions permissions)
      {
        match: '/actions/permissions',
        method: 'PUT',
        response: () => {
          apiCalls.push('PUT actions-perms');
          return mockFetchResponse(204);
        },
      },
    ]);

    const { ensureRunnerRepo } = await importRunner();
    const result = await ensureRunnerRepo(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
    );

    // Assert return value
    expect(result).toEqual({ created: true, existed: false });

    // Assert getInstallationToken was called
    expect(mockGetInstallationToken).toHaveBeenCalledWith(
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
    );

    // Assert repo creation API was called
    expect(apiCalls).toContain('POST user/repos');

    // Assert workflow commit API was called
    expect(apiCalls).toContain('PUT workflow');
  });

  it('no-ops when repo exists and workflow is valid (correct hash)', async () => {
    const apiCalls: string[] = [];

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: () => {
          apiCalls.push('GET repo');
          return mockFetchResponse(200, { full_name: `${FAKE_OWNER}/ghagga-runner` });
        },
      },
      // 2. verifyWorkflowIntegrity → return content with CORRECT hash
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: () => {
          apiCalls.push('GET workflow-content');
          return mockFetchResponse(200, {
            content: FAKE_WORKFLOW_B64,
            sha: 'existing-sha-abc',
          });
        },
      },
    ]);

    const { ensureRunnerRepo } = await importRunner();
    const result = await ensureRunnerRepo(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
    );

    // Assert return value
    expect(result).toEqual({ created: false, existed: true });

    // Assert NO creation API calls were made
    expect(apiCalls).not.toContain('POST user/repos');
    expect(apiCalls).not.toContain('POST org/repos');

    // Assert workflow content was checked
    expect(apiCalls).toContain('GET workflow-content');
  });

  it('re-commits workflow when tampered (wrong hash)', async () => {
    const apiCalls: string[] = [];
    const tamperedContent = 'name: HACKED WORKFLOW\nrun: echo "pwned"';
    const tamperedB64 = Buffer.from(tamperedContent).toString('base64');

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: () => {
          apiCalls.push('GET repo');
          return mockFetchResponse(200, { full_name: `${FAKE_OWNER}/ghagga-runner` });
        },
      },
      // 2. verifyWorkflowIntegrity → tampered content (wrong hash)
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: () => {
          apiCalls.push('GET workflow-content');
          return mockFetchResponse(200, {
            content: tamperedB64,
            sha: 'tampered-sha-xyz',
          });
        },
      },
      // 3. commitWorkflowFile (re-commit with existing sha)
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'PUT',
        response: (_url, init) => {
          apiCalls.push('PUT workflow-recommit');
          // Verify the request includes the existing sha for update
          const body = JSON.parse(init?.body as string);
          expect(body.sha).toBe('tampered-sha-xyz');
          expect(body.message).toContain('update');
          return mockFetchResponse(200, { content: { sha: 'new-sha-123' } });
        },
      },
    ]);

    const { ensureRunnerRepo } = await importRunner();
    const result = await ensureRunnerRepo(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
    );

    // Assert return value — existed but not freshly created
    expect(result).toEqual({ created: false, existed: true });

    // Assert workflow was re-committed via PUT Contents API
    expect(apiCalls).toContain('PUT workflow-recommit');
  });
});

describe('dispatchAnalysis', () => {
  const dispatchContext = {
    repoFullName: 'test-owner/my-app',
    prNumber: 42,
    headSha: 'abc123def456',
    baseBranch: 'main',
    toolSettings: { enableSemgrep: true, enableTrivy: true, enableCpd: false },
    callbackUrl: 'https://ghagga.example.com/api/runner-callback',
  };

  it('happy path returns dispatched: true with callbackId', async () => {
    let dispatchBody: Record<string, unknown> | undefined;

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(200, { full_name: `${FAKE_OWNER}/ghagga-runner` }),
      },
      // 2. verifyWorkflowIntegrity → valid
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: mockFetchResponse(200, {
          content: FAKE_WORKFLOW_B64,
          sha: 'valid-sha',
        }),
      },
      // 3. getRepoPublicKey (for setRepoSecret)
      {
        match: '/actions/secrets/public-key',
        method: 'GET',
        response: mockFetchResponse(200, {
          key: Buffer.from('a'.repeat(32)).toString('base64'),
          key_id: 'key-id-123',
        }),
      },
      // 4. PUT secret
      {
        match: '/actions/secrets/GHAGGA_TOKEN',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
      // 5. repository_dispatch
      {
        match: '/dispatches',
        method: 'POST',
        response: (_url, init) => {
          dispatchBody = JSON.parse(init?.body as string);
          return mockFetchResponse(204);
        },
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    // Assert dispatched successfully
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) throw new Error('Expected dispatched to be true');

    // Assert callbackId is a valid UUID-like string
    expect(result.callbackId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // Assert callbackSignature is present and has correct format
    expect(result.callbackSignature).toMatch(/^sha256=[0-9a-f]{64}$/);

    // Assert dispatch payload was sent with correct event_type
    expect(dispatchBody?.event_type).toBe('ghagga-analysis');
    const clientPayload = dispatchBody?.client_payload as Record<string, unknown>;
    expect(clientPayload.callbackId).toBe(result.callbackId);
    expect(clientPayload.repoFullName).toBe('test-owner/my-app');
    expect(clientPayload.prNumber).toBe(42);
    expect(clientPayload.headSha).toBe('abc123def456');
    expect(clientPayload.callbackUrl).toBe(dispatchContext.callbackUrl);
  });

  it('returns dispatched: false when workflow integrity fails after re-commit', async () => {
    const tamperedContent = 'name: TAMPERED';
    const tamperedB64 = Buffer.from(tamperedContent).toString('base64');

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(200, {}),
      },
      // 2. verifyWorkflowIntegrity → tampered
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: mockFetchResponse(200, {
          content: tamperedB64,
          sha: 'tampered-sha',
        }),
      },
      // 3. Re-commit workflow (PUT)
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'PUT',
        response: mockFetchResponse(200, { content: { sha: 'new-sha' } }),
      },
      // 4. Re-verify integrity → STILL tampered (simulates persistent compromise)
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: mockFetchResponse(200, {
          content: tamperedB64, // still wrong
          sha: 'still-tampered-sha',
        }),
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('Expected dispatched to be false');
    expect(result.reason).toContain('integrity');
  });

  it('returns dispatched: false when GITHUB_WEBHOOK_SECRET is not set', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(200, {}),
      },
      // 2. verifyWorkflowIntegrity → valid
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: mockFetchResponse(200, {
          content: FAKE_WORKFLOW_B64,
          sha: 'valid-sha',
        }),
      },
      // 3. getRepoPublicKey
      {
        match: '/actions/secrets/public-key',
        method: 'GET',
        response: mockFetchResponse(200, {
          key: Buffer.from('a'.repeat(32)).toString('base64'),
          key_id: 'key-id-123',
        }),
      },
      // 4. PUT secret
      {
        match: '/actions/secrets/GHAGGA_TOKEN',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('Expected dispatched to be false');
    expect(result.reason).toContain('GITHUB_WEBHOOK_SECRET');
  });
});

describe('HMAC signature generation', () => {
  it('produces correct sha256= prefixed HMAC signature format', async () => {
    const dispatchContext = {
      repoFullName: 'test-owner/my-app',
      prNumber: 1,
      headSha: 'abc',
      baseBranch: 'main',
      toolSettings: { enableSemgrep: true, enableTrivy: false, enableCpd: false },
      callbackUrl: 'https://example.com/callback',
    };

    let capturedCallbackId: string | undefined;
    let capturedSignature: string | undefined;

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(200, {}),
      },
      // 2. verifyWorkflowIntegrity → valid
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: mockFetchResponse(200, {
          content: FAKE_WORKFLOW_B64,
          sha: 'valid',
        }),
      },
      // 3. getRepoPublicKey
      {
        match: '/actions/secrets/public-key',
        method: 'GET',
        response: mockFetchResponse(200, {
          key: Buffer.from('a'.repeat(32)).toString('base64'),
          key_id: 'key-123',
        }),
      },
      // 4. PUT secret
      {
        match: '/actions/secrets/GHAGGA_TOKEN',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
      // 5. dispatch — capture the payload
      {
        match: '/dispatches',
        method: 'POST',
        response: (_url, init) => {
          const body = JSON.parse(init?.body as string);
          capturedCallbackId = body.client_payload.callbackId;
          capturedSignature = body.client_payload.callbackSignature;
          return mockFetchResponse(204);
        },
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    expect(result.dispatched).toBe(true);
    if (!result.dispatched) throw new Error('Expected dispatched');

    // Verify signature format: "sha256=" + 64 hex chars
    expect(result.callbackSignature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(capturedSignature).toBe(result.callbackSignature);

    // Verify the HMAC can be independently recomputed
    const expectedSignature =
      'sha256=' +
      createHmac('sha256', WEBHOOK_SECRET)
        .update(result.callbackId)
        .digest('hex');

    expect(result.callbackSignature).toBe(expectedSignature);

    // Verify that the captured payload matches the return value
    expect(capturedCallbackId).toBe(result.callbackId);
  });

  it('different callbackIds produce different signatures', async () => {
    // Test the HMAC property directly using Node.js crypto
    const id1 = 'callback-id-aaa';
    const id2 = 'callback-id-bbb';

    const sig1 = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(id1).digest('hex');
    const sig2 = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET).update(id2).digest('hex');

    expect(sig1).not.toBe(sig2);
    expect(sig1).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(sig2).toMatch(/^sha256=[0-9a-f]{64}$/);
  });
});

describe('deleteRunnerRepo', () => {
  it('succeeds when repo exists (200)', async () => {
    setupFetchRoutes([
      {
        match: `/repos/${FAKE_OWNER}/ghagga-runner`,
        method: 'DELETE',
        response: mockFetchResponse(204),
      },
    ]);

    const { deleteRunnerRepo } = await importRunner();
    // Should not throw
    await expect(
      deleteRunnerRepo(FAKE_OWNER, FAKE_INSTALLATION_ID, FAKE_APP_ID, FAKE_PRIVATE_KEY),
    ).resolves.toBeUndefined();
  });

  it('succeeds when repo does not exist (404)', async () => {
    setupFetchRoutes([
      {
        match: `/repos/${FAKE_OWNER}/ghagga-runner`,
        method: 'DELETE',
        response: mockFetchResponse(404),
      },
    ]);

    const { deleteRunnerRepo } = await importRunner();
    // Should not throw on 404 — best-effort deletion
    await expect(
      deleteRunnerRepo(FAKE_OWNER, FAKE_INSTALLATION_ID, FAKE_APP_ID, FAKE_PRIVATE_KEY),
    ).resolves.toBeUndefined();
  });

  it('does not throw when deletion fails (500)', async () => {
    setupFetchRoutes([
      {
        match: `/repos/${FAKE_OWNER}/ghagga-runner`,
        method: 'DELETE',
        response: mockFetchResponse(500, { message: 'Internal Server Error' }),
      },
    ]);

    const { deleteRunnerRepo } = await importRunner();
    // Best-effort — should NOT throw
    await expect(
      deleteRunnerRepo(FAKE_OWNER, FAKE_INSTALLATION_ID, FAKE_APP_ID, FAKE_PRIVATE_KEY),
    ).resolves.toBeUndefined();
  });
});

describe('ensureRunnerRepo — organization path', () => {
  it('creates repo via orgs API when owner is an Organization', async () => {
    let repoCreateUrl = '';

    setupFetchRoutes([
      // 1. repoExists → 404
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(404),
      },
      // 2. isOrganization → true
      {
        match: `/users/${FAKE_OWNER}`,
        method: 'GET',
        response: mockFetchResponse(200, { type: 'Organization' }),
      },
      // 3. createRepo — org endpoint
      {
        match: `/orgs/${FAKE_OWNER}/repos`,
        method: 'POST',
        response: (_url) => {
          repoCreateUrl = `/orgs/${FAKE_OWNER}/repos`;
          return mockFetchResponse(201, { full_name: `${FAKE_OWNER}/ghagga-runner` });
        },
      },
      // 4. commitWorkflowFile
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'PUT',
        response: mockFetchResponse(201, { content: { sha: 'abc' } }),
      },
      // 5-6. setLogRetention
      {
        match: '/actions/permissions/artifact-and-log-retention',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
      {
        match: '/actions/permissions',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
    ]);

    const { ensureRunnerRepo } = await importRunner();
    const result = await ensureRunnerRepo(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
    );

    expect(result).toEqual({ created: true, existed: false });
    expect(repoCreateUrl).toBe(`/orgs/${FAKE_OWNER}/repos`);
  });
});

describe('dispatchAnalysis — repo creation on dispatch', () => {
  const dispatchContext = {
    repoFullName: 'test-owner/my-app',
    prNumber: 10,
    headSha: 'sha123',
    baseBranch: 'main',
    toolSettings: { enableSemgrep: true, enableTrivy: true, enableCpd: true },
    callbackUrl: 'https://example.com/callback',
  };

  it('creates repo if it does not exist, then dispatches', async () => {
    const apiCalls: string[] = [];

    setupFetchRoutes([
      // 1. repoExists → 404
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: () => {
          apiCalls.push('GET repo → 404');
          return mockFetchResponse(404);
        },
      },
      // 2. isOrganization
      {
        match: `/users/${FAKE_OWNER}`,
        method: 'GET',
        response: mockFetchResponse(200, { type: 'User' }),
      },
      // 3. createRepo
      {
        match: '/user/repos',
        method: 'POST',
        response: () => {
          apiCalls.push('POST create-repo');
          return mockFetchResponse(201, {});
        },
      },
      // 4. commitWorkflowFile
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'PUT',
        response: () => {
          apiCalls.push('PUT workflow');
          return mockFetchResponse(201, { content: { sha: 'wf-sha' } });
        },
      },
      // 5-6. setLogRetention
      {
        match: '/actions/permissions/artifact-and-log-retention',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
      {
        match: '/actions/permissions',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
      // 7. setRepoSecret — public key
      {
        match: '/actions/secrets/public-key',
        method: 'GET',
        response: mockFetchResponse(200, {
          key: Buffer.from('b'.repeat(32)).toString('base64'),
          key_id: 'key-456',
        }),
      },
      // 8. setRepoSecret — PUT secret
      {
        match: '/actions/secrets/GHAGGA_TOKEN',
        method: 'PUT',
        response: mockFetchResponse(204),
      },
      // 9. dispatch
      {
        match: '/dispatches',
        method: 'POST',
        response: () => {
          apiCalls.push('POST dispatch');
          return mockFetchResponse(204);
        },
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    expect(result.dispatched).toBe(true);
    expect(apiCalls).toContain('POST create-repo');
    expect(apiCalls).toContain('PUT workflow');
    expect(apiCalls).toContain('POST dispatch');
  });

  it('returns dispatched: false when repo creation fails', async () => {
    setupFetchRoutes([
      // 1. repoExists → 404
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(404),
      },
      // 2. isOrganization
      {
        match: `/users/${FAKE_OWNER}`,
        method: 'GET',
        response: mockFetchResponse(200, { type: 'User' }),
      },
      // 3. createRepo → 403 (forbidden)
      {
        match: '/user/repos',
        method: 'POST',
        response: mockFetchText(403, 'Forbidden: insufficient permissions'),
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    expect(result.dispatched).toBe(false);
    if (result.dispatched) throw new Error('Expected dispatched to be false');
    expect(result.reason).toContain('Failed to create runner repo');
  });
});

describe('sealed box encryption (setRepoSecret)', () => {
  it('calls libsodium to encrypt and PUTs the encrypted secret', async () => {
    const dispatchContext = {
      repoFullName: 'test-owner/my-app',
      prNumber: 1,
      headSha: 'abc',
      baseBranch: 'main',
      toolSettings: { enableSemgrep: false, enableTrivy: false, enableCpd: false },
      callbackUrl: 'https://example.com/callback',
    };

    let secretPutBody: Record<string, unknown> | undefined;

    setupFetchRoutes([
      // 1. repoExists → 200
      {
        match: new RegExp(`/repos/${FAKE_OWNER}/ghagga-runner$`),
        method: 'GET',
        response: mockFetchResponse(200, {}),
      },
      // 2. verifyWorkflowIntegrity → valid
      {
        match: '/contents/.github/workflows/ghagga-analysis.yml',
        method: 'GET',
        response: mockFetchResponse(200, {
          content: FAKE_WORKFLOW_B64,
          sha: 'valid',
        }),
      },
      // 3. getRepoPublicKey
      {
        match: '/actions/secrets/public-key',
        method: 'GET',
        response: mockFetchResponse(200, {
          key: Buffer.from('x'.repeat(32)).toString('base64'),
          key_id: 'sealed-box-key-id',
        }),
      },
      // 4. PUT secret
      {
        match: '/actions/secrets/GHAGGA_TOKEN',
        method: 'PUT',
        response: (_url, init) => {
          secretPutBody = JSON.parse(init?.body as string);
          return mockFetchResponse(204);
        },
      },
      // 5. dispatch
      {
        match: '/dispatches',
        method: 'POST',
        response: mockFetchResponse(204),
      },
    ]);

    const { dispatchAnalysis } = await importRunner();
    const result = await dispatchAnalysis(
      FAKE_OWNER,
      FAKE_INSTALLATION_ID,
      FAKE_APP_ID,
      FAKE_PRIVATE_KEY,
      dispatchContext,
    );

    expect(result.dispatched).toBe(true);

    // Verify libsodium functions were called
    expect(mockSodium.from_base64).toHaveBeenCalled();
    expect(mockSodium.from_string).toHaveBeenCalledWith(FAKE_TOKEN);
    expect(mockSodium.crypto_box_seal).toHaveBeenCalled();
    expect(mockSodium.to_base64).toHaveBeenCalled();

    // Verify the PUT body contains encrypted_value and key_id
    expect(secretPutBody).toBeDefined();
    expect(secretPutBody!.encrypted_value).toBe('bW9ja19lbmNyeXB0ZWRfdmFsdWU=');
    expect(secretPutBody!.key_id).toBe('sealed-box-key-id');
  });
});
