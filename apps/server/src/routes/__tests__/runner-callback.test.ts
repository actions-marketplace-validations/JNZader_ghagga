/**
 * Runner callback route unit tests.
 *
 * Tests HMAC-SHA256 signature verification, body validation,
 * and Inngest event emission for the POST /api/runner-callback endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createRunnerCallbackRouter } from '../runner-callback.js';

// ─── Mocks ──────────────────────────────────────────────────────

const mockInngestSend = vi.fn();
vi.mock('../../inngest/client.js', () => ({
  inngest: { send: (...args: unknown[]) => mockInngestSend(...args) },
}));

const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
vi.mock('../../lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: (...args: unknown[]) => mockLoggerInfo(...args),
      warn: (...args: unknown[]) => mockLoggerWarn(...args),
      error: (...args: unknown[]) => mockLoggerError(...args),
      debug: vi.fn(),
    }),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

const WEBHOOK_SECRET = 'test-runner-callback-secret';

function computeHmac(callbackId: string, secret = WEBHOOK_SECRET): string {
  return 'sha256=' + createHmac('sha256', secret).update(callbackId).digest('hex');
}

const VALID_BODY = {
  callbackId: 'cb-12345-abcde',
  staticAnalysis: {
    semgrep: { status: 'success', findings: [], executionTimeMs: 120 },
    trivy: { status: 'success', findings: [], executionTimeMs: 80 },
    cpd: { status: 'success', findings: [], executionTimeMs: 50 },
  },
};

function makeRequest(
  body: string,
  options: { signature?: string | null; skipSignature?: boolean; contentType?: string } = {},
): Request {
  const headers: Record<string, string> = {
    'Content-Type': options.contentType ?? 'application/json',
  };

  if (!options.skipSignature) {
    if (options.signature !== null) {
      headers['X-Ghagga-Signature'] = options.signature ?? computeHmac(VALID_BODY.callbackId);
    }
  }

  return new Request('http://localhost/api/runner-callback', {
    method: 'POST',
    headers,
    body,
  });
}

// ─── Setup ──────────────────────────────────────────────────────

let router: ReturnType<typeof createRunnerCallbackRouter>;
let originalSecret: string | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  originalSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  router = createRunnerCallbackRouter();
  mockInngestSend.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalSecret !== undefined) {
    process.env.GITHUB_WEBHOOK_SECRET = originalSecret;
  } else {
    delete process.env.GITHUB_WEBHOOK_SECRET;
  }
});

// ─── Tests ──────────────────────────────────────────────────────

describe('POST /api/runner-callback', () => {
  // ── Test 1: Valid callback ──────────────────────────────────

  it('returns 200 and emits Inngest event for valid callback', async () => {
    const body = JSON.stringify(VALID_BODY);
    const signature = computeHmac(VALID_BODY.callbackId);
    const req = makeRequest(body, { signature });

    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'accepted' });

    // Verify inngest.send() was called with correct event
    expect(mockInngestSend).toHaveBeenCalledOnce();
    const sendArg = mockInngestSend.mock.calls[0]![0];
    expect(sendArg.name).toBe('ghagga/runner.completed');
    expect(sendArg.data.callbackId).toBe('cb-12345-abcde');
    expect(sendArg.data.staticAnalysis).toEqual(VALID_BODY.staticAnalysis);
  });

  // ── Test 2: Missing signature header ───────────────────────

  it('returns 401 when X-Ghagga-Signature header is missing', async () => {
    const body = JSON.stringify(VALID_BODY);
    const req = makeRequest(body, { skipSignature: true });

    const res = await router.fetch(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Missing signature');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  // ── Test 3: Invalid HMAC signature ─────────────────────────

  it('returns 401 when HMAC signature is invalid', async () => {
    const body = JSON.stringify(VALID_BODY);
    const req = makeRequest(body, { signature: 'sha256=deadbeef0000000000000000000000000000000000000000000000000000cafe' });

    const res = await router.fetch(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Invalid signature');
    expect(mockInngestSend).not.toHaveBeenCalled();

    // Verify warning was logged
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  // ── Test 4: Malformed JSON body ────────────────────────────

  it('returns 400 for malformed JSON body', async () => {
    const body = 'this-is-not-valid-json{{{';
    // Signature header present but body is invalid JSON
    const req = new Request('http://localhost/api/runner-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ghagga-Signature': 'sha256=anything',
      },
      body,
    });

    const res = await router.fetch(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Invalid JSON');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  // ── Test 5: Missing required fields ────────────────────────

  it('returns 400 when callbackId is missing', async () => {
    const bodyObj = { staticAnalysis: VALID_BODY.staticAnalysis };
    const body = JSON.stringify(bodyObj);
    const req = new Request('http://localhost/api/runner-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ghagga-Signature': computeHmac(''), // won't matter — validation happens before HMAC
      },
      body,
    });

    const res = await router.fetch(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Missing required fields: callbackId, staticAnalysis');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 400 when staticAnalysis is missing', async () => {
    const bodyObj = { callbackId: 'cb-only' };
    const body = JSON.stringify(bodyObj);
    const req = new Request('http://localhost/api/runner-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ghagga-Signature': computeHmac('cb-only'),
      },
      body,
    });

    const res = await router.fetch(req);

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Missing required fields: callbackId, staticAnalysis');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  // ── Additional edge cases ──────────────────────────────────

  it('returns 500 when GITHUB_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.GITHUB_WEBHOOK_SECRET;
    const body = JSON.stringify(VALID_BODY);
    const req = new Request('http://localhost/api/runner-callback', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Ghagga-Signature': 'sha256=anything',
      },
      body,
    });

    const res = await router.fetch(req);

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Server misconfigured');
    expect(mockLoggerError).toHaveBeenCalled();
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('returns 401 when signature has wrong prefix format', async () => {
    const body = JSON.stringify(VALID_BODY);
    // Signature without sha256= prefix — different length causes timingSafeEqual to fail
    const req = makeRequest(body, { signature: 'not-a-valid-sig' });

    const res = await router.fetch(req);

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json).toHaveProperty('error', 'Invalid signature');
    expect(mockInngestSend).not.toHaveBeenCalled();
  });

  it('logs info on successful callback acceptance', async () => {
    const body = JSON.stringify(VALID_BODY);
    const signature = computeHmac(VALID_BODY.callbackId);
    const req = makeRequest(body, { signature });

    await router.fetch(req);

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      { callbackId: 'cb-12345-abcde' },
      'Runner callback accepted',
    );
  });

  it('verifies HMAC against callbackId, not full body', async () => {
    // This test ensures the HMAC is computed over callbackId only
    const customBody = {
      callbackId: 'unique-callback-42',
      staticAnalysis: VALID_BODY.staticAnalysis,
    };
    const body = JSON.stringify(customBody);
    // Compute HMAC over callbackId, not the full JSON body
    const signature = computeHmac('unique-callback-42');
    const req = makeRequest(body, { signature });

    const res = await router.fetch(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ status: 'accepted' });
  });
});
