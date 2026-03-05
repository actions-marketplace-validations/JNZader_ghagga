/**
 * Runner callback route tests.
 *
 * Tests POST /api/runner/callback with mocked HMAC verification
 * and Inngest event dispatching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// ─── Mocks ──────────────────────────────────────────────────────

const mockVerifyAndConsumeSecret = vi.fn();
const mockInngestSend = vi.fn();

vi.mock('../github/runner.js', () => ({
  verifyAndConsumeSecret: (...args: unknown[]) => mockVerifyAndConsumeSecret(...args),
}));

vi.mock('../inngest/client.js', () => ({
  inngest: { send: (...args: unknown[]) => mockInngestSend(...args) },
}));

// Shared mock logger instance so tests can assert on calls
const { mockLoggerChild, mockChildFn } = vi.hoisted(() => {
  const mockLoggerChild = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  const mockChildFn = vi.fn().mockReturnValue(mockLoggerChild);
  return { mockLoggerChild, mockChildFn };
});

vi.mock('../lib/logger.js', () => ({
  logger: {
    child: (...args: unknown[]) => mockChildFn(...args),
  },
}));

// ─── Helpers ────────────────────────────────────────────────────

import { createRunnerCallbackRouter } from './runner-callback.js';

function createApp() {
  const app = new Hono();
  app.route('', createRunnerCallbackRouter());
  return app;
}

const VALID_PAYLOAD = {
  callbackId: 'cb-123',
  repoFullName: 'owner/repo',
  prNumber: 42,
  headSha: 'abc123def456',
  staticAnalysis: {
    semgrep: { findings: [] },
    trivy: { findings: [] },
  },
};

function postCallback(
  app: Hono,
  body: string,
  headers: Record<string, string> = {},
) {
  return app.request('/api/runner/callback', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body,
  });
}

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  mockVerifyAndConsumeSecret.mockReset();
  mockInngestSend.mockReset();
  mockInngestSend.mockResolvedValue(undefined);
  mockLoggerChild.info.mockClear();
  mockLoggerChild.warn.mockClear();
  mockLoggerChild.error.mockClear();
  mockLoggerChild.debug.mockClear();
  // NOTE: Do NOT clear mockChildFn — it was called at module load time
  // and we assert on that call in the logger initialisation test.
});

// ═══════════════════════════════════════════════════════════════════
// Logger assertions — kill StringLiteral/ObjectLiteral mutations
// ═══════════════════════════════════════════════════════════════════

describe('logger initialisation', () => {
  it('creates a child logger with { module: "runner-callback" }', async () => {
    // The child call happens at module load time
    expect(mockChildFn).toHaveBeenCalledWith({ module: 'runner-callback' });
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/runner/callback — Valid callback
// ═══════════════════════════════════════════════════════════════════

describe('POST /api/runner/callback', () => {
  describe('valid callback', () => {
    it('returns 200 { ok: true } when HMAC and all fields are valid', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(true);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      const res = await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=validhex',
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ ok: true });
    });

    it('logs info with callbackId, repoFullName, and prNumber on success', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(true);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=validhex',
      });

      expect(mockLoggerChild.info).toHaveBeenCalledOnce();
      expect(mockLoggerChild.info).toHaveBeenCalledWith(
        { callbackId: 'cb-123', repoFullName: 'owner/repo', prNumber: 42 },
        'Runner callback accepted — dispatched Inngest event',
      );
    });

    it('calls verifyAndConsumeSecret with callbackId, rawBody, and signature', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(true);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      const signature = 'sha256=deadbeef';
      await postCallback(app, body, { 'x-ghagga-signature': signature });

      expect(mockVerifyAndConsumeSecret).toHaveBeenCalledOnce();
      expect(mockVerifyAndConsumeSecret).toHaveBeenCalledWith(
        VALID_PAYLOAD.callbackId,
        body,
        signature,
      );
    });

    it('sends inngest event with correct shape', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(true);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockInngestSend).toHaveBeenCalledOnce();
      expect(mockInngestSend).toHaveBeenCalledWith({
        name: 'ghagga/runner.completed',
        data: {
          callbackId: VALID_PAYLOAD.callbackId,
          repoFullName: VALID_PAYLOAD.repoFullName,
          prNumber: VALID_PAYLOAD.prNumber,
          headSha: VALID_PAYLOAD.headSha,
          staticAnalysis: VALID_PAYLOAD.staticAnalysis,
        },
      });
    });

    it('inngest event name is exactly "ghagga/runner.completed"', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(true);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=abc',
      });

      const sentEvent = mockInngestSend.mock.calls[0][0];
      expect(sentEvent.name).toBe('ghagga/runner.completed');
    });

    it('inngest event data includes all payload fields', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(true);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=abc',
      });

      const sentEvent = mockInngestSend.mock.calls[0][0];
      expect(sentEvent.data.callbackId).toBe('cb-123');
      expect(sentEvent.data.repoFullName).toBe('owner/repo');
      expect(sentEvent.data.prNumber).toBe(42);
      expect(sentEvent.data.headSha).toBe('abc123def456');
      expect(sentEvent.data.staticAnalysis).toEqual(VALID_PAYLOAD.staticAnalysis);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Missing signature header
  // ═══════════════════════════════════════════════════════════════════

  describe('missing signature header', () => {
    it('returns 401 with { error: "Missing signature" }', async () => {
      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      // No x-ghagga-signature header
      const res = await postCallback(app, body);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing signature' });
    });

    it('logs a warning with callbackId when signature header is missing', async () => {
      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body);

      expect(mockLoggerChild.warn).toHaveBeenCalledWith(
        { callbackId: 'cb-123' },
        'Runner callback: missing x-ghagga-signature header',
      );
    });

    it('error field is exactly "Missing signature"', async () => {
      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      const res = await postCallback(app, body);

      const json = await res.json();
      expect(json.error).toBe('Missing signature');
    });

    it('does not call verifyAndConsumeSecret', async () => {
      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body);

      expect(mockVerifyAndConsumeSecret).not.toHaveBeenCalled();
    });

    it('does not send inngest event', async () => {
      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body);

      expect(mockInngestSend).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Invalid HMAC
  // ═══════════════════════════════════════════════════════════════════

  describe('invalid HMAC', () => {
    it('returns 401 with { error: "Invalid signature" }', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(false);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      const res = await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=badhex',
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toEqual({ error: 'Invalid signature' });
    });

    it('logs a warning with callbackId when HMAC verification fails', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(false);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=badhex',
      });

      expect(mockLoggerChild.warn).toHaveBeenCalledWith(
        { callbackId: 'cb-123' },
        'Runner callback: HMAC verification failed',
      );
    });

    it('error field is exactly "Invalid signature"', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(false);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      const res = await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=badhex',
      });

      const json = await res.json();
      expect(json.error).toBe('Invalid signature');
    });

    it('does not send inngest event when HMAC fails', async () => {
      mockVerifyAndConsumeSecret.mockReturnValue(false);

      const app = createApp();
      const body = JSON.stringify(VALID_PAYLOAD);
      await postCallback(app, body, {
        'x-ghagga-signature': 'sha256=badhex',
      });

      expect(mockInngestSend).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Malformed JSON
  // ═══════════════════════════════════════════════════════════════════

  describe('malformed JSON body', () => {
    it('returns 400 with { error: "Invalid JSON body" }', async () => {
      const app = createApp();
      const res = await postCallback(app, 'not-valid-json{{{', {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Invalid JSON body' });
    });

    it('logs a warning for invalid JSON body', async () => {
      const app = createApp();
      await postCallback(app, 'not-valid-json{{{', {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockLoggerChild.warn).toHaveBeenCalledWith(
        'Runner callback: invalid JSON body',
      );
    });

    it('error field is exactly "Invalid JSON body"', async () => {
      const app = createApp();
      const res = await postCallback(app, '{{bad', {
        'x-ghagga-signature': 'sha256=abc',
      });

      const json = await res.json();
      expect(json.error).toBe('Invalid JSON body');
    });

    it('does not call verifyAndConsumeSecret for bad JSON', async () => {
      const app = createApp();
      await postCallback(app, '<<<invalid>>>', {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockVerifyAndConsumeSecret).not.toHaveBeenCalled();
    });

    it('does not send inngest event for bad JSON', async () => {
      const app = createApp();
      await postCallback(app, '<<<invalid>>>', {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockInngestSend).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Missing required fields
  // ═══════════════════════════════════════════════════════════════════

  describe('missing required fields', () => {
    it('returns 400 when callbackId is missing', async () => {
      const { callbackId: _, ...payloadWithoutCallbackId } = VALID_PAYLOAD;
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payloadWithoutCallbackId), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing required fields' });
    });

    it('logs a warning with callbackId when required fields are missing', async () => {
      const { repoFullName: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockLoggerChild.warn).toHaveBeenCalledWith(
        { callbackId: 'cb-123' },
        'Runner callback: missing required fields',
      );
    });

    it('returns 400 when repoFullName is missing', async () => {
      const { repoFullName: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing required fields' });
    });

    it('returns 400 when prNumber is missing', async () => {
      const { prNumber: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing required fields' });
    });

    it('returns 400 when headSha is missing', async () => {
      const { headSha: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing required fields' });
    });

    it('returns 400 when staticAnalysis is missing', async () => {
      const { staticAnalysis: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing required fields' });
    });

    it('error field is exactly "Missing required fields"', async () => {
      const { callbackId: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      const json = await res.json();
      expect(json.error).toBe('Missing required fields');
    });

    it('does not call verifyAndConsumeSecret for missing fields', async () => {
      const { callbackId: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockVerifyAndConsumeSecret).not.toHaveBeenCalled();
    });

    it('does not send inngest event for missing fields', async () => {
      const { callbackId: _, ...payload } = VALID_PAYLOAD;
      const app = createApp();
      await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(mockInngestSend).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // Empty body
  // ═══════════════════════════════════════════════════════════════════

  describe('edge cases', () => {
    it('returns 400 for empty body', async () => {
      const app = createApp();
      const res = await postCallback(app, '', {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Invalid JSON body' });
    });

    it('returns 400 when fields are present but callbackId is empty string', async () => {
      const payload = { ...VALID_PAYLOAD, callbackId: '' };
      const app = createApp();
      const res = await postCallback(app, JSON.stringify(payload), {
        'x-ghagga-signature': 'sha256=abc',
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json).toEqual({ error: 'Missing required fields' });
    });
  });
});
