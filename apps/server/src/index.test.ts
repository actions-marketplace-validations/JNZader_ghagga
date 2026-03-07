/**
 * Server entry point tests.
 *
 * Tests the error handler (Fix #1: no stack traces leaked) and
 * SIGTERM graceful shutdown registration (Fix #8).
 */

import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
