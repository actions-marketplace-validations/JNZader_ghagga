/**
 * Body size limit middleware tests.
 *
 * Verifies that bodyLimit middleware enforces size limits:
 * - 1MB default for all routes
 * - 5MB override for /webhook
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';

function createApp() {
  const app = new Hono();

  // Conditional body limit — same approach as index.ts
  app.use('*', async (c, next) => {
    const path = new URL(c.req.url).pathname;
    const maxSize = path === '/webhook' ? 5 * 1024 * 1024 : 1024 * 1024;
    const limiter = bodyLimit({ maxSize });
    return limiter(c, next);
  });

  // API route that reads body
  app.post('/api/settings', async (c) => {
    const body = await c.req.json();
    return c.json({ received: true, size: JSON.stringify(body).length });
  });

  // Webhook route that reads body
  app.post('/webhook', async (c) => {
    const body = await c.req.text();
    return c.json({ received: true, size: body.length });
  });

  return app;
}

describe('Body Size Limit Middleware', () => {
  const app = createApp();

  describe('Normal-sized API payload passes through', () => {
    it('should accept a 10KB payload on POST /api/settings', async () => {
      const payload = JSON.stringify({ data: 'x'.repeat(10 * 1024) });

      const res = await app.request('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });
  });

  describe('Oversized API payload is rejected', () => {
    it('should return 413 for a 2MB payload on POST /api/settings', async () => {
      const payload = 'x'.repeat(2 * 1024 * 1024);

      const res = await app.request('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      expect(res.status).toBe(413);
    });
  });

  describe('Webhook payload up to 5MB passes through', () => {
    it('should accept a 3MB payload on POST /webhook', async () => {
      const payload = 'x'.repeat(3 * 1024 * 1024);

      const res = await app.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.received).toBe(true);
    });
  });

  describe('Webhook payload over 5MB is rejected', () => {
    it('should return 413 for a 6MB payload on POST /webhook', async () => {
      const payload = 'x'.repeat(6 * 1024 * 1024);

      const res = await app.request('/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: payload,
      });

      expect(res.status).toBe(413);
    });
  });
});
