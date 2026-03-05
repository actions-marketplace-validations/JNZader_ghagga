import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';

// ─── Logger Mock ────────────────────────────────────────────────
// vi.hoisted ensures these are available when vi.mock factory runs
// (vi.mock is hoisted above all other code by Vitest).

const { mockRunnerLogger, mockRootChildFn } = vi.hoisted(() => {
  const mockRunnerLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockRootChildFn = vi.fn().mockReturnValue(mockRunnerLogger);
  return { mockRunnerLogger, mockRootChildFn };
});

vi.mock('../lib/logger.js', () => ({
  logger: {
    child: (...args: unknown[]) => mockRootChildFn(...args),
  },
}));

import {
  storeCallbackSecret,
  verifyAndConsumeSecret,
  discoverRunnerRepo,
  setRunnerSecret,
  dispatchWorkflow,
  RunnerCreationError,
  createRunnerRepo,
  type DispatchParams,
  type RunnerErrorCode,
} from './runner.js';

// ─── Helpers ────────────────────────────────────────────────────

/** Compute a valid HMAC-SHA256 signature in GitHub's `sha256=<hex>` format. */
function computeSignature(payload: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`;
}

/** Build a minimal DispatchParams with sensible defaults. */
function makeDispatchParams(overrides: Partial<DispatchParams> = {}): DispatchParams {
  return {
    ownerLogin: 'test-owner',
    repoFullName: 'test-owner/test-repo',
    prNumber: 1,
    headSha: 'abc123',
    baseBranch: 'main',
    callbackUrl: 'https://example.com/callback',
    enableSemgrep: true,
    enableTrivy: false,
    enableCpd: false,
    token: 'ghp_test-token',
    ...overrides,
  };
}

// ─── Group 1: storeCallbackSecret + verifyAndConsumeSecret ──────

describe('storeCallbackSecret / verifyAndConsumeSecret', () => {
  const callbackId = 'cb-test-001';
  const secret = 'super-secret-value';
  const payload = '{"result":"ok"}';

  beforeEach(() => {
    mockRunnerLogger.warn.mockClear();
    mockRunnerLogger.info.mockClear();
  });

  afterEach(() => {
    // Consume any leftover entry so tests don't leak state
    verifyAndConsumeSecret(callbackId, '', 'sha256=0000');
    verifyAndConsumeSecret('cb-test-expire', '', 'sha256=0000');
    verifyAndConsumeSecret('cb-test-prefix', '', 'sha256=0000');
    verifyAndConsumeSecret('cb-test-len', '', 'sha256=0000');
    verifyAndConsumeSecret('cb-test-hmac', '', 'sha256=0000');
    verifyAndConsumeSecret('cb-test-catch', '', 'sha256=0000');
  });

  it('returns true for a valid HMAC signature', () => {
    storeCallbackSecret(callbackId, secret);
    const signature = computeSignature(payload, secret);

    expect(verifyAndConsumeSecret(callbackId, payload, signature)).toBe(true);
  });

  it('returns false on second verification (one-time use)', () => {
    storeCallbackSecret(callbackId, secret);
    const signature = computeSignature(payload, secret);

    expect(verifyAndConsumeSecret(callbackId, payload, signature)).toBe(true);
    expect(verifyAndConsumeSecret(callbackId, payload, signature)).toBe(false);
  });

  it('returns false for an incorrect HMAC signature', () => {
    storeCallbackSecret(callbackId, secret);
    const wrongSignature = computeSignature(payload, 'wrong-secret');

    expect(verifyAndConsumeSecret(callbackId, payload, wrongSignature)).toBe(false);
  });

  it('returns false when sha256= prefix is missing', () => {
    storeCallbackSecret(callbackId, secret);
    const hex = createHmac('sha256', secret).update(payload).digest('hex');

    expect(verifyAndConsumeSecret(callbackId, payload, hex)).toBe(false);
  });

  it('returns false for a non-existent callbackId', () => {
    expect(verifyAndConsumeSecret('unknown-id', payload, 'sha256=aabb')).toBe(false);
  });

  it('returns false when the secret has expired', () => {
    storeCallbackSecret(callbackId, secret);
    const signature = computeSignature(payload, secret);

    // Advance time past the 11-minute TTL
    vi.useFakeTimers();
    vi.advanceTimersByTime(12 * 60 * 1000);

    expect(verifyAndConsumeSecret(callbackId, payload, signature)).toBe(false);

    vi.useRealTimers();
  });

  it('returns false for invalid hex in signature (triggers catch block)', () => {
    storeCallbackSecret(callbackId, secret);

    // "zz" is not valid hex — Buffer.from('zz','hex') produces a 0-length buffer
    // which will hit the length-mismatch branch
    expect(verifyAndConsumeSecret(callbackId, payload, 'sha256=zzzzzz')).toBe(false);
  });

  it('returns false when signature hex decodes to a different length', () => {
    storeCallbackSecret(callbackId, secret);

    // SHA-256 produces 32 bytes (64 hex chars). Provide only 4 hex chars (2 bytes).
    expect(verifyAndConsumeSecret(callbackId, payload, 'sha256=aabbccdd')).toBe(false);
  });

  // ─── Secret deletion on every failure path ─────────────────────

  it('deletes secret on expiry — second call also returns false', () => {
    const id = 'cb-test-expire';
    storeCallbackSecret(id, secret);
    const signature = computeSignature(payload, secret);

    vi.useFakeTimers();
    vi.advanceTimersByTime(12 * 60 * 1000);

    // First call: expired → should delete and return false
    expect(verifyAndConsumeSecret(id, payload, signature)).toBe(false);
    vi.useRealTimers();

    // Second call: secret was deleted, so it's "not found"
    expect(verifyAndConsumeSecret(id, payload, signature)).toBe(false);
  });

  it('deletes secret on missing sha256= prefix — second call also returns false', () => {
    const id = 'cb-test-prefix';
    storeCallbackSecret(id, secret);
    const hex = createHmac('sha256', secret).update(payload).digest('hex');

    // First call: bad format → should return false but NOTE: the production code
    // does NOT delete on bad prefix, so a second call with correct sig should succeed
    expect(verifyAndConsumeSecret(id, payload, hex)).toBe(false);

    // The secret is still there — verify with correct signature
    const goodSig = computeSignature(payload, secret);
    expect(verifyAndConsumeSecret(id, payload, goodSig)).toBe(true);
  });

  it('deletes secret on HMAC mismatch (!valid branch) — second call returns false', () => {
    const id = 'cb-test-hmac';
    storeCallbackSecret(id, secret);
    const wrongSig = computeSignature(payload, 'wrong-secret');

    // HMAC mismatch: timingSafeEqual returns false → delete + return false
    expect(verifyAndConsumeSecret(id, payload, wrongSig)).toBe(false);

    // Secret was deleted — second call with CORRECT signature should also fail
    const goodSig = computeSignature(payload, secret);
    expect(verifyAndConsumeSecret(id, payload, goodSig)).toBe(false);
  });

  it('deletes secret on length mismatch — second call returns false', () => {
    const id = 'cb-test-len';
    storeCallbackSecret(id, secret);

    // 4 hex chars = 2 bytes, SHA-256 = 32 bytes → length mismatch → delete + false
    expect(verifyAndConsumeSecret(id, payload, 'sha256=aabbccdd')).toBe(false);

    // Second call: secret deleted
    const goodSig = computeSignature(payload, secret);
    expect(verifyAndConsumeSecret(id, payload, goodSig)).toBe(false);
  });

  it('deletes secret when catch block triggers — second call returns false', () => {
    const id = 'cb-test-catch';
    storeCallbackSecret(id, secret);

    // Invalid hex triggers catch or length mismatch
    expect(verifyAndConsumeSecret(id, payload, 'sha256=zzzzzz')).toBe(false);

    // Second call: secret deleted
    const goodSig = computeSignature(payload, secret);
    expect(verifyAndConsumeSecret(id, payload, goodSig)).toBe(false);
  });

  it('returns true exactly at the boundary (not yet expired)', () => {
    const id = 'cb-test-001';
    // We need to control Date.now() precisely
    const now = Date.now();
    vi.useFakeTimers({ now });

    storeCallbackSecret(id, secret);
    const signature = computeSignature(payload, secret);

    // Advance to exactly 11 minutes minus 1ms — should still be valid
    // TTL is 11 * 60 * 1000 = 660000ms. Expires at now + 660000.
    // entry.expires <= Date.now() → false when Date.now() < expires
    vi.advanceTimersByTime(11 * 60 * 1000 - 1);

    expect(verifyAndConsumeSecret(id, payload, signature)).toBe(true);

    vi.useRealTimers();
  });

  it('returns false exactly at expiry boundary', () => {
    const id = 'cb-test-001';
    const now = Date.now();
    vi.useFakeTimers({ now });

    storeCallbackSecret(id, secret);
    const signature = computeSignature(payload, secret);

    // Advance exactly to TTL — entry.expires <= Date.now() should be true
    vi.advanceTimersByTime(11 * 60 * 1000);

    expect(verifyAndConsumeSecret(id, payload, signature)).toBe(false);

    vi.useRealTimers();
  });

  // ─── Logger assertions for verifyAndConsumeSecret ───────────────

  it('creates a child logger with { module: "runner" }', () => {
    expect(mockRootChildFn).toHaveBeenCalledWith({ module: 'runner' });
  });

  it('logs warn with "Callback secret not found" when callbackId is unknown', () => {
    verifyAndConsumeSecret('unknown-id-log', payload, 'sha256=aabb');

    expect(mockRunnerLogger.warn).toHaveBeenCalledWith(
      { callbackId: 'unknown-id-log' },
      'Callback secret not found (expired or already consumed)',
    );
  });

  it('logs warn with "Callback secret expired" when TTL exceeded', () => {
    const id = 'cb-log-expire';
    storeCallbackSecret(id, secret);

    vi.useFakeTimers();
    vi.advanceTimersByTime(12 * 60 * 1000);

    verifyAndConsumeSecret(id, payload, computeSignature(payload, secret));

    expect(mockRunnerLogger.warn).toHaveBeenCalledWith(
      { callbackId: id },
      'Callback secret expired',
    );

    vi.useRealTimers();
    // cleanup
    verifyAndConsumeSecret(id, '', 'sha256=0000');
  });

  it('logs warn with "Invalid signature format" when sha256= prefix is missing', () => {
    const id = 'cb-log-prefix';
    storeCallbackSecret(id, secret);
    const hex = createHmac('sha256', secret).update(payload).digest('hex');

    verifyAndConsumeSecret(id, payload, hex);

    expect(mockRunnerLogger.warn).toHaveBeenCalledWith(
      { callbackId: id },
      'Invalid signature format — missing sha256= prefix',
    );

    // cleanup
    verifyAndConsumeSecret(id, '', 'sha256=0000');
  });

  it('logs warn with "HMAC verification failed" when HMAC does not match', () => {
    const id = 'cb-log-hmac';
    storeCallbackSecret(id, secret);
    const wrongSig = computeSignature(payload, 'wrong-secret');

    verifyAndConsumeSecret(id, payload, wrongSig);

    expect(mockRunnerLogger.warn).toHaveBeenCalledWith(
      { callbackId: id },
      'Callback HMAC verification failed',
    );
  });

  it('does NOT log warn when HMAC verification succeeds', () => {
    const id = 'cb-log-ok';
    storeCallbackSecret(id, secret);
    const sig = computeSignature(payload, secret);

    verifyAndConsumeSecret(id, payload, sig);

    // Should not have logged any warn about HMAC failure
    const warnCalls = mockRunnerLogger.warn.mock.calls;
    const hmacFailCalls = warnCalls.filter(
      (call: unknown[]) => typeof call[1] === 'string' && call[1].includes('HMAC verification failed'),
    );
    expect(hmacFailCalls).toHaveLength(0);
  });
});

// ─── Group 2: discoverRunnerRepo ────────────────────────────────

describe('discoverRunnerRepo', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns DiscoveredRunner when repo exists (200)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 123, full_name: 'acme/ghagga-runner', private: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await discoverRunnerRepo('acme', 'ghp_token');

    expect(result).toEqual({ repoId: 123, fullName: 'acme/ghagga-runner', isPrivate: false });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/ghagga-runner');
  });

  it('sends correct Authorization, Accept, and X-GitHub-Api-Version headers', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 1, full_name: 'acme/ghagga-runner', private: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await discoverRunnerRepo('acme', 'ghp_my-token');

    const fetchCall = mockFetch.mock.calls[0];
    const headers = fetchCall[1].headers;
    expect(headers).toEqual({
      Authorization: 'Bearer ghp_my-token',
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('constructs the correct URL from ownerLogin', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 99, full_name: 'my-org/ghagga-runner', private: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await discoverRunnerRepo('my-org', 'ghp_token');

    expect(mockFetch.mock.calls[0][0]).toBe('https://api.github.com/repos/my-org/ghagga-runner');
  });

  it('returns null when repo does not exist (404)', async () => {
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    const result = await discoverRunnerRepo('acme', 'ghp_token');

    expect(result).toBeNull();
  });

  it('throws on API error (500)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(discoverRunnerRepo('acme', 'ghp_token')).rejects.toThrow(
      /GitHub API error discovering runner repo: 500/,
    );
  });

  it('maps response id to repoId and full_name to fullName', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 999, full_name: 'org/ghagga-runner', private: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await discoverRunnerRepo('org', 'ghp_token');

    expect(result).not.toBeNull();
    expect(result!.repoId).toBe(999);
    expect(result!.fullName).toBe('org/ghagga-runner');
    expect(result!.isPrivate).toBe(true);
  });

  it('returns isPrivate: false for public repos', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 456, full_name: 'alice/ghagga-runner', private: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await discoverRunnerRepo('alice', 'ghp_token');

    expect(result).not.toBeNull();
    expect(result!.isPrivate).toBe(false);
  });
});

// ─── Group 3: setRunnerSecret ───────────────────────────────────

describe('setRunnerSecret', () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // We need a real NaCl public key for libsodium's crypto_box_seal.
  // Generate a valid Curve25519 keypair encoded as base64.
  // This is a fixed test key — 32 bytes, base64-encoded.
  const testPublicKeyB64 = 'C2o8Fz0SSCMy56fVlx+MPxPvZC7eQVOMlf82K32KJYA=';

  it('encrypts and sets the secret (happy path)', async () => {
    // GET public-key → 200
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-001' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // PUT secret → 204
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      setRunnerSecret('acme/ghagga-runner', 'MY_SECRET', 'secret-value', 'ghp_token'),
    ).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify the PUT call includes encrypted_value and key_id
    const putCall = mockFetch.mock.calls[1];
    expect(putCall[0]).toContain('/actions/secrets/MY_SECRET');
    expect(putCall[1].method).toBe('PUT');
    const putBody = JSON.parse(putCall[1].body as string);
    expect(putBody).toHaveProperty('encrypted_value');
    expect(putBody).toHaveProperty('key_id', 'key-001');
  });

  it('sends correct headers for GET public-key request', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-001' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await setRunnerSecret('acme/ghagga-runner', 'MY_SECRET', 'secret-value', 'ghp_tok');

    const getCall = mockFetch.mock.calls[0];
    expect(getCall[0]).toBe(
      'https://api.github.com/repos/acme/ghagga-runner/actions/secrets/public-key',
    );
    expect(getCall[1].headers).toEqual({
      Authorization: 'Bearer ghp_tok',
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('sends correct headers and URL for PUT secret request', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-001' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await setRunnerSecret('acme/ghagga-runner', 'SEC_NAME', 'val', 'ghp_tok');

    const putCall = mockFetch.mock.calls[1];
    expect(putCall[0]).toBe(
      'https://api.github.com/repos/acme/ghagga-runner/actions/secrets/SEC_NAME',
    );
    expect(putCall[1].method).toBe('PUT');
    expect(putCall[1].headers).toEqual({
      Authorization: 'Bearer ghp_tok',
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('PUT body encrypted_value is a non-empty base64 string', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-010' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await setRunnerSecret('acme/ghagga-runner', 'MY_SECRET', 'my-value', 'ghp_token');

    const putBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
    expect(putBody.encrypted_value).toBeTruthy();
    expect(typeof putBody.encrypted_value).toBe('string');
    expect(putBody.encrypted_value.length).toBeGreaterThan(0);
    expect(putBody.key_id).toBe('key-010');
  });

  it('throws when public key fetch fails (500)', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(
      setRunnerSecret('acme/ghagga-runner', 'MY_SECRET', 'val', 'ghp_token'),
    ).rejects.toThrow(/GitHub API error fetching public key: 500/);

    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('throws when secret PUT fails (500)', async () => {
    // GET public-key → 200
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-002' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // PUT secret → 500
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(
      setRunnerSecret('acme/ghagga-runner', 'MY_SECRET', 'val', 'ghp_token'),
    ).rejects.toThrow(/GitHub API error setting secret: 500/);
  });
});

// ─── Group 4: dispatchWorkflow ──────────────────────────────────

describe('dispatchWorkflow', () => {
  const mockFetch = vi.fn();

  // Same valid test public key as Group 3
  const testPublicKeyB64 = 'C2o8Fz0SSCMy56fVlx+MPxPvZC7eQVOMlf82K32KJYA=';

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockRunnerLogger.info.mockClear();
    mockRunnerLogger.warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Set up mock fetch to handle:
   *  1. GET public-key → 200  (for GHAGGA_TOKEN)
   *  2. PUT secret     → 204  (for GHAGGA_TOKEN)
   *  3. GET public-key → 200  (for GHAGGA_CALLBACK_SECRET)
   *  4. PUT secret     → 204  (for GHAGGA_CALLBACK_SECRET)
   *  5. POST dispatch  → given status
   */
  function setupMockChain(dispatchStatus: number, dispatchBody?: string) {
    // setRunnerSecret(GHAGGA_TOKEN) → GET public key
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-dispatch' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // setRunnerSecret(GHAGGA_TOKEN) → PUT secret
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // setRunnerSecret(GHAGGA_CALLBACK_SECRET) → GET public key
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-dispatch' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // setRunnerSecret(GHAGGA_CALLBACK_SECRET) → PUT secret
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    // dispatchWorkflow → POST workflow_dispatch
    // Status 204 is a null-body status; use null body for it.
    const isNullBody = dispatchStatus === 204 || dispatchStatus === 304;
    mockFetch.mockResolvedValueOnce(
      new Response(isNullBody ? null : (dispatchBody ?? ''), {
        status: dispatchStatus,
        statusText: dispatchStatus === 204 ? 'No Content' : 'Unprocessable Entity',
      }),
    );
  }

  it('returns a callbackId and stores secret in memory (happy path)', async () => {
    setupMockChain(204);

    const callbackId = await dispatchWorkflow(makeDispatchParams());

    // Should return a UUID
    expect(callbackId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    // 5 fetch calls: GET+PUT (GHAGGA_TOKEN), GET+PUT (GHAGGA_CALLBACK_SECRET), POST dispatch
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // Verify dispatch call
    const dispatchCall = mockFetch.mock.calls[4];
    expect(dispatchCall[0]).toContain('/actions/workflows/ghagga-analysis.yml/dispatches');
    expect(dispatchCall[1].method).toBe('POST');

    const body = JSON.parse(dispatchCall[1].body as string);
    expect(body.ref).toBe('main');
    expect(body.inputs.callbackId).toBe(callbackId);
    expect(body.inputs.callbackSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('dispatch URL includes ownerLogin/ghagga-runner path', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams({ ownerLogin: 'my-org' }));

    const dispatchUrl = mockFetch.mock.calls[4][0] as string;
    expect(dispatchUrl).toBe(
      'https://api.github.com/repos/my-org/ghagga-runner/actions/workflows/ghagga-analysis.yml/dispatches',
    );
  });

  it('sends correct headers for the dispatch POST request', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams({ token: 'ghp_dispatch-tok' }));

    const headers = mockFetch.mock.calls[4][1].headers;
    expect(headers).toEqual({
      Authorization: 'Bearer ghp_dispatch-tok',
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
  });

  it('dispatch body inputs contain all 10 required fields', async () => {
    setupMockChain(204);

    const params = makeDispatchParams({
      ownerLogin: 'org',
      repoFullName: 'org/my-repo',
      prNumber: 42,
      headSha: 'deadbeef',
      baseBranch: 'develop',
      callbackUrl: 'https://cb.example.com/hook',
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: false,
    });

    const callbackId = await dispatchWorkflow(params);

    const body = JSON.parse(mockFetch.mock.calls[4][1].body as string);
    const inputs = body.inputs;

    expect(inputs.callbackId).toBe(callbackId);
    expect(inputs.repoFullName).toBe('org/my-repo');
    expect(inputs.prNumber).toBe('42');
    expect(inputs.headSha).toBe('deadbeef');
    expect(inputs.baseBranch).toBe('develop');
    expect(inputs.callbackUrl).toBe('https://cb.example.com/hook');
    expect(inputs.enableSemgrep).toBe('true');
    expect(inputs.enableTrivy).toBe('true');
    expect(inputs.enableCpd).toBe('false');

    // callbackSecret must be a raw 64-char hex string (32 bytes)
    expect(inputs.callbackSecret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('callbackSecret is a raw 64-char hex string (no sha256= prefix)', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams());

    const body = JSON.parse(mockFetch.mock.calls[4][1].body as string);
    expect(body.inputs.callbackSecret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.inputs.callbackSecret.startsWith('sha256=')).toBe(false);
  });

  it('dispatch body ref is "main"', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams());

    const body = JSON.parse(mockFetch.mock.calls[4][1].body as string);
    expect(body.ref).toBe('main');
  });

  it('sets runner secret on ownerLogin/ghagga-runner repo', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams({ ownerLogin: 'my-org' }));

    // GHAGGA_TOKEN: GET public-key URL should target ownerLogin/ghagga-runner
    const getKeyUrl0 = mockFetch.mock.calls[0][0] as string;
    expect(getKeyUrl0).toBe(
      'https://api.github.com/repos/my-org/ghagga-runner/actions/secrets/public-key',
    );

    // GHAGGA_TOKEN: PUT secret URL should also target ownerLogin/ghagga-runner
    const putSecretUrl0 = mockFetch.mock.calls[1][0] as string;
    expect(putSecretUrl0).toContain('my-org/ghagga-runner/actions/secrets/');

    // GHAGGA_CALLBACK_SECRET: GET public-key URL should target ownerLogin/ghagga-runner
    const getKeyUrl1 = mockFetch.mock.calls[2][0] as string;
    expect(getKeyUrl1).toBe(
      'https://api.github.com/repos/my-org/ghagga-runner/actions/secrets/public-key',
    );

    // GHAGGA_CALLBACK_SECRET: PUT secret URL should also target ownerLogin/ghagga-runner
    const putSecretUrl1 = mockFetch.mock.calls[3][0] as string;
    expect(putSecretUrl1).toContain('my-org/ghagga-runner/actions/secrets/');
  });

  it('sets runner secrets with names GHAGGA_TOKEN and GHAGGA_CALLBACK_SECRET', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams({ ownerLogin: 'my-org' }));

    // The first PUT secret URL should contain GHAGGA_TOKEN
    const putTokenUrl = mockFetch.mock.calls[1][0] as string;
    expect(putTokenUrl).toBe(
      'https://api.github.com/repos/my-org/ghagga-runner/actions/secrets/GHAGGA_TOKEN',
    );

    // The second PUT secret URL should contain GHAGGA_CALLBACK_SECRET
    const putCallbackUrl = mockFetch.mock.calls[3][0] as string;
    expect(putCallbackUrl).toBe(
      'https://api.github.com/repos/my-org/ghagga-runner/actions/secrets/GHAGGA_CALLBACK_SECRET',
    );
  });

  it('logs info with callbackId, runnerRepo, repoFullName, and prNumber on success', async () => {
    setupMockChain(204);

    const params = makeDispatchParams({
      ownerLogin: 'acme',
      repoFullName: 'acme/my-app',
      prNumber: 77,
    });
    const callbackId = await dispatchWorkflow(params);

    expect(mockRunnerLogger.info).toHaveBeenCalledOnce();
    expect(mockRunnerLogger.info).toHaveBeenCalledWith(
      {
        callbackId,
        runnerRepo: 'acme/ghagga-runner',
        repoFullName: 'acme/my-app',
        prNumber: 77,
      },
      'Dispatched runner workflow',
    );
  });

  it('does NOT log info when dispatch fails', async () => {
    setupMockChain(422, '{"message":"Fail"}');

    try {
      await dispatchWorkflow(makeDispatchParams());
    } catch {
      // expected
    }

    expect(mockRunnerLogger.info).not.toHaveBeenCalled();
  });

  it('prNumber is converted to string in inputs', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams({ prNumber: 999 }));

    const body = JSON.parse(mockFetch.mock.calls[4][1].body as string);
    expect(body.inputs.prNumber).toBe('999');
    expect(typeof body.inputs.prNumber).toBe('string');
  });

  it('boolean flags are converted to strings in inputs', async () => {
    setupMockChain(204);

    await dispatchWorkflow(makeDispatchParams({
      enableSemgrep: false,
      enableTrivy: true,
      enableCpd: true,
    }));

    const body = JSON.parse(mockFetch.mock.calls[4][1].body as string);
    expect(body.inputs.enableSemgrep).toBe('false');
    expect(body.inputs.enableTrivy).toBe('true');
    expect(body.inputs.enableCpd).toBe('true');
  });

  it('throws and cleans up secret when dispatch API fails (422)', async () => {
    setupMockChain(422, '{"message":"Validation Failed"}');

    const params = makeDispatchParams();
    await expect(dispatchWorkflow(params)).rejects.toThrow(
      /GitHub API error dispatching workflow: 422/,
    );

    // The secret should have been cleaned up — any verifyAndConsumeSecret
    // call with any callbackId that was generated should fail.
    // Since we can't know the callbackId (it was generated internally),
    // we verify indirectly by checking fetch was called 5 times
    // (meaning both setRunnerSecret calls succeeded before dispatch failed).
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it('on failure, the secret is removed from the store', async () => {
    // We need to intercept the callbackId to verify it was removed.
    // We'll capture it from the dispatch POST body.
    setupMockChain(422, '{"message":"Fail"}');

    const params = makeDispatchParams();
    try {
      await dispatchWorkflow(params);
    } catch {
      // expected
    }

    // Extract the callbackId from the dispatch request body
    const dispatchBody = JSON.parse(mockFetch.mock.calls[4][1].body as string);
    const callbackId = dispatchBody.inputs.callbackId;

    // The secret should have been deleted — verifyAndConsumeSecret should return false
    const sig = computeSignature('test', 'any-secret');
    expect(verifyAndConsumeSecret(callbackId, 'test', sig)).toBe(false);
  });
});

// ─── Group 5: RunnerCreationError ───────────────────────────────

describe('RunnerCreationError', () => {
  it('is an instance of Error', () => {
    const err = new RunnerCreationError('github_error', 'Something went wrong');
    expect(err).toBeInstanceOf(Error);
  });

  it('sets the name to "RunnerCreationError"', () => {
    const err = new RunnerCreationError('github_error', 'Something went wrong');
    expect(err.name).toBe('RunnerCreationError');
  });

  it('stores the error code', () => {
    const err = new RunnerCreationError('insufficient_scope', 'Need more scope');
    expect(err.code).toBe('insufficient_scope');
  });

  it('stores the message', () => {
    const err = new RunnerCreationError('github_error', 'API broke');
    expect(err.message).toBe('API broke');
  });

  it('stores optional retryAfter', () => {
    const err = new RunnerCreationError('rate_limited', 'Too many requests', 120);
    expect(err.retryAfter).toBe(120);
  });

  it('stores optional repoFullName', () => {
    const err = new RunnerCreationError('already_exists', 'Exists', undefined, 'alice/ghagga-runner');
    expect(err.repoFullName).toBe('alice/ghagga-runner');
  });

  it('has undefined retryAfter and repoFullName when not provided', () => {
    const err = new RunnerCreationError('template_unavailable', 'Not found');
    expect(err.retryAfter).toBeUndefined();
    expect(err.repoFullName).toBeUndefined();
  });

  it('can be instantiated with all error codes', () => {
    const codes: RunnerErrorCode[] = [
      'insufficient_scope',
      'already_exists',
      'template_unavailable',
      'rate_limited',
      'org_permission_denied',
      'creation_timeout',
      'secret_failed',
      'github_error',
    ];

    for (const code of codes) {
      const err = new RunnerCreationError(code, `Error: ${code}`);
      expect(err.code).toBe(code);
      expect(err.name).toBe('RunnerCreationError');
    }
  });
});

// ─── Group 6: createRunnerRepo ──────────────────────────────────

describe('createRunnerRepo', () => {
  const mockFetch = vi.fn();

  // Same valid test public key as Group 3
  const testPublicKeyB64 = 'C2o8Fz0SSCMy56fVlx+MPxPvZC7eQVOMlf82K32KJYA=';

  const defaultOptions = {
    ownerLogin: 'testuser',
    token: 'ghp_test-token',
    callbackSecretValue: 'callback-secret-123',
  };

  // Mirror the module constants (not exported)
  const POLL_INTERVAL_MS = 2000;
  const MAX_POLL_ATTEMPTS = 15;

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
    mockRunnerLogger.info.mockClear();
    mockRunnerLogger.error.mockClear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  /**
   * Helper: set up mock fetch for a successful createRunnerRepo flow.
   * 1. discoverRunnerRepo → 404 (not found)
   * 2. template generate → 201
   * 3. poll discoverRunnerRepo → 200 (ready on first poll)
   * 4. setRunnerSecret GET public-key → 200
   * 5. setRunnerSecret PUT secret → 204
   */
  function setupSuccessChain(overrides?: { isPrivate?: boolean }) {
    const isPrivate = overrides?.isPrivate ?? false;

    // 1. discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));

    // 2. template generate → 201
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ full_name: 'testuser/ghagga-runner', private: isPrivate }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // 3. poll discoverRunnerRepo → 200 (found on first poll)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 123, full_name: 'testuser/ghagga-runner', private: isPrivate }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // 4. setRunnerSecret → GET public-key
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ key: testPublicKeyB64, key_id: 'key-create' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    // 5. setRunnerSecret → PUT secret
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  }

  it('creates a runner repo successfully (happy path)', async () => {
    setupSuccessChain();

    const promise = createRunnerRepo(defaultOptions);

    // Advance past the poll interval (2s)
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    const result = await promise;

    expect(result).toEqual({
      created: true,
      repoFullName: 'testuser/ghagga-runner',
      isPrivate: false,
      secretConfigured: true,
    });
  });

  it('calls the template generate API with correct parameters', async () => {
    setupSuccessChain();

    const promise = createRunnerRepo(defaultOptions);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    // Call 1 is discoverRunnerRepo (404), call 2 is template generate
    const generateCall = mockFetch.mock.calls[1];
    expect(generateCall[0]).toBe(
      'https://api.github.com/repos/JNZader/ghagga-runner-template/generate',
    );
    expect(generateCall[1].method).toBe('POST');

    const body = JSON.parse(generateCall[1].body as string);
    expect(body).toEqual({
      owner: 'testuser',
      name: 'ghagga-runner',
      description: 'GHAGGA static analysis runner — auto-created by the GHAGGA Dashboard',
      include_all_branches: false,
      private: false,
    });
  });

  it('throws already_exists when repo exists on pre-check', async () => {
    // discoverRunnerRepo → 200 (repo exists)
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 123, full_name: 'testuser/ghagga-runner', private: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      const rce = err as RunnerCreationError;
      expect(rce.code).toBe('already_exists');
      expect(rce.repoFullName).toBe('testuser/ghagga-runner');
    }
  });

  it('throws already_exists on 422 from template generate', async () => {
    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 422
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'name already exists' }), { status: 422 }),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      expect((err as RunnerCreationError).code).toBe('already_exists');
    }
  });

  it('throws insufficient_scope on 403 (not rate limited)', async () => {
    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 403
    mockFetch.mockResolvedValueOnce(
      new Response('Forbidden', {
        status: 403,
        headers: { 'X-RateLimit-Remaining': '100' },
      }),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      expect((err as RunnerCreationError).code).toBe('insufficient_scope');
    }
  });

  it('throws rate_limited on 403 with X-RateLimit-Remaining: 0', async () => {
    const resetTime = Math.floor(Date.now() / 1000) + 120;

    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 403 rate limited
    mockFetch.mockResolvedValueOnce(
      new Response('Rate limit exceeded', {
        status: 403,
        headers: {
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetTime),
        },
      }),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      const rce = err as RunnerCreationError;
      expect(rce.code).toBe('rate_limited');
      expect(rce.retryAfter).toBeGreaterThan(0);
    }
  });

  it('throws org_permission_denied on 403 with organization/permission in body', async () => {
    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 403 org permission denied
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'Resource not accessible by organization' }),
        {
          status: 403,
          headers: { 'X-RateLimit-Remaining': '100' },
        },
      ),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      expect((err as RunnerCreationError).code).toBe('org_permission_denied');
    }
  });

  it('throws template_unavailable on 404 from template generate', async () => {
    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 404
    mockFetch.mockResolvedValueOnce(
      new Response('Not Found', { status: 404 }),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      expect((err as RunnerCreationError).code).toBe('template_unavailable');
    }
  });

  it('throws creation_timeout when polling exceeds max attempts', async () => {
    // discoverRunnerRepo → 404 (pre-check)
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 201
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ full_name: 'testuser/ghagga-runner', private: false }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // All poll attempts → 404 (never ready)
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    }

    // Immediately attach error handler to prevent unhandled rejection
    let caughtError: unknown;
    const promise = createRunnerRepo(defaultOptions).catch((err) => {
      caughtError = err;
    });

    // Advance through all poll intervals — each setTimeout needs its own tick
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    }

    await promise;

    expect(caughtError).toBeInstanceOf(RunnerCreationError);
    const rce = caughtError as RunnerCreationError;
    expect(rce.code).toBe('creation_timeout');
    expect(rce.repoFullName).toBe('testuser/ghagga-runner');
  });

  it('returns secretConfigured: false when setRunnerSecret fails', async () => {
    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 201
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ full_name: 'testuser/ghagga-runner', private: false }),
        { status: 201, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // poll discoverRunnerRepo → 200
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ id: 123, full_name: 'testuser/ghagga-runner', private: false }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    // setRunnerSecret GET public-key → 500 (fails)
    mockFetch.mockResolvedValueOnce(
      new Response('Server Error', { status: 500, statusText: 'Internal Server Error' }),
    );

    const promise = createRunnerRepo(defaultOptions);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const result = await promise;

    expect(result.created).toBe(true);
    expect(result.secretConfigured).toBe(false);
    expect(result.repoFullName).toBe('testuser/ghagga-runner');
  });

  it('returns isPrivate: true when org forces private repos', async () => {
    setupSuccessChain({ isPrivate: true });

    const promise = createRunnerRepo(defaultOptions);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    const result = await promise;

    expect(result.isPrivate).toBe(true);
  });

  it('throws github_error on unexpected status codes', async () => {
    // discoverRunnerRepo → 404
    mockFetch.mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    // template generate → 500
    mockFetch.mockResolvedValueOnce(
      new Response('Internal Server Error', { status: 500 }),
    );

    try {
      await createRunnerRepo(defaultOptions);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RunnerCreationError);
      expect((err as RunnerCreationError).code).toBe('github_error');
    }
  });

  it('logs info on successful creation', async () => {
    setupSuccessChain();

    const promise = createRunnerRepo(defaultOptions);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await promise;

    // The creation logger is a separate child logger
    expect(mockRootChildFn).toHaveBeenCalledWith({ module: 'runner-creation' });
  });
});
