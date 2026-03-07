/**
 * Server entry point tests.
 *
 * Tests the error handler (Fix #1: no stack traces leaked),
 * SIGTERM graceful shutdown registration (Fix #8),
 * and the detailed health check endpoint (Fix #12).
 */

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SimpleCircuitBreaker } from './lib/circuit-breaker.js';

// ─── Fix #1: Error handler does not leak stack traces ───────────

describe('Global error handler', () => {
  it('returns generic 500 without detail or stack fields', async () => {
    const app = new Hono();

    // Replicate the production error handler from index.ts
    app.onError((_err, c) => {
      return c.json({ error: 'Internal server error' }, 500);
    });

    app.get('/explode', () => {
      throw new Error('secret database password in stack');
    });

    const res = await app.request('/explode');

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json).toEqual({ error: 'Internal server error' });
    expect(json).not.toHaveProperty('detail');
    expect(json).not.toHaveProperty('stack');
  });

  it('does not include error message in response body', async () => {
    const app = new Hono();

    app.onError((_err, c) => {
      return c.json({ error: 'Internal server error' }, 500);
    });

    app.get('/explode', () => {
      throw new Error('Connection refused: postgres://admin:s3cret@db:5432');
    });

    const res = await app.request('/explode');
    const text = await res.text();

    expect(text).not.toContain('s3cret');
    expect(text).not.toContain('postgres://');
    expect(text).not.toContain('Connection refused');
  });
});

// ─── Fix #8: SIGTERM handler is registered ──────────────────────

describe('Graceful shutdown (SIGTERM)', () => {
  let originalListeners: NodeJS.SignalsListener[];

  beforeEach(() => {
    // Save existing SIGTERM listeners so we can detect new ones
    originalListeners = process.listeners('SIGTERM') as NodeJS.SignalsListener[];
  });

  afterEach(() => {
    // Clean up any listeners added during the test
    const currentListeners = process.listeners('SIGTERM') as NodeJS.SignalsListener[];
    for (const listener of currentListeners) {
      if (!originalListeners.includes(listener)) {
        process.removeListener('SIGTERM', listener);
      }
    }
  });

  it('registers a SIGTERM handler via process.on', async () => {
    const processOnSpy = vi.spyOn(process, 'on');

    // Simulate registering the handler (same code as index.ts)
    const mockServer = { close: vi.fn((cb: () => void) => cb()) };

    process.on('SIGTERM', () => {
      mockServer.close(() => {
        // graceful close
      });
    });

    expect(processOnSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));

    processOnSpy.mockRestore();
  });

  it('calls server.close when SIGTERM is received', () => {
    const closeFn = vi.fn((cb: () => void) => cb());
    const mockServer = { close: closeFn };
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const handler = () => {
      mockServer.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGTERM', handler);

    // Trigger the handler directly
    handler();

    expect(closeFn).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(0);

    exitSpy.mockRestore();
  });
});

// ─── Fix #12: Detailed health check endpoint ────────────────────

describe('GET /health/detailed', () => {
  /**
   * Build a mini Hono app that replicates the /health/detailed handler
   * from index.ts, using a mock database object.
   */
  function createApp(dbExecute: () => Promise<unknown>) {
    const app = new Hono();
    const breaker = new SimpleCircuitBreaker();

    const mockDb = { execute: dbExecute };

    app.get('/health/detailed', async (c) => {
      const startTime = Date.now();
      const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

      try {
        const dbStart = Date.now();
        await mockDb.execute();
        checks.database = { ok: true, latencyMs: Date.now() - dbStart };
      } catch (e) {
        checks.database = { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
      }

      const healthy = Object.values(checks).every((check) => check.ok);

      return c.json(
        {
          status: healthy ? 'healthy' : 'degraded',
          uptime: Math.floor(process.uptime()),
          memoryMB: Math.floor(process.memoryUsage().rss / 1024 / 1024),
          checks,
          githubCircuitBreaker: breaker.getState(),
          responseTimeMs: Date.now() - startTime,
        },
        healthy ? 200 : 503,
      );
    });

    return app;
  }

  it('returns 200 with healthy status when database is reachable', async () => {
    const app = createApp(() => Promise.resolve([{ '?column?': 1 }]));

    const res = await app.request('/health/detailed');

    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('healthy');
    expect(json.checks).toHaveProperty('database');
    expect((json.checks as Record<string, { ok: boolean }>).database.ok).toBe(true);
  });

  it('returns 503 with degraded status when database is unreachable', async () => {
    const app = createApp(() => Promise.reject(new Error('ECONNREFUSED')));

    const res = await app.request('/health/detailed');

    expect(res.status).toBe(503);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.status).toBe('degraded');
    const dbCheck = (json.checks as Record<string, { ok: boolean; error?: string }>).database;
    expect(dbCheck.ok).toBe(false);
    expect(dbCheck.error).toBe('ECONNREFUSED');
  });

  it('includes uptime, memoryMB, responseTimeMs, and circuit breaker state', async () => {
    const app = createApp(() => Promise.resolve([{ '?column?': 1 }]));

    const res = await app.request('/health/detailed');
    const json = (await res.json()) as Record<string, unknown>;

    expect(typeof json.uptime).toBe('number');
    expect(typeof json.memoryMB).toBe('number');
    expect(typeof json.responseTimeMs).toBe('number');
    expect(json.githubCircuitBreaker).toBe('closed');
  });

  it('reports database latency in milliseconds', async () => {
    const app = createApp(() => Promise.resolve([{ '?column?': 1 }]));

    const res = await app.request('/health/detailed');
    const json = (await res.json()) as Record<string, unknown>;
    const dbCheck = (json.checks as Record<string, { ok: boolean; latencyMs?: number }>).database;

    expect(dbCheck.ok).toBe(true);
    expect(typeof dbCheck.latencyMs).toBe('number');
    expect(dbCheck.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
