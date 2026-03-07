/**
 * Rate limiting middleware tests.
 *
 * Verifies per-route rate limits, IP tracking, 429 responses,
 * and Retry-After headers.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { rateLimiter } from 'hono-rate-limiter';

function createApp(options: { apiLimit?: number; webhookLimit?: number } = {}) {
  const app = new Hono();

  const apiLimit = options.apiLimit ?? 100;
  const webhookLimit = options.webhookLimit ?? 200;

  const apiLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: apiLimit,
    keyGenerator: (c) => c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
    standardHeaders: 'draft-6',
  });

  const webhookLimiter = rateLimiter({
    windowMs: 60 * 1000,
    limit: webhookLimit,
    keyGenerator: (c) => c.req.header('x-forwarded-for') ?? c.req.header('x-real-ip') ?? 'unknown',
    standardHeaders: 'draft-6',
  });

  app.use('/api/*', apiLimiter);
  app.use('/webhook', webhookLimiter);

  app.get('/api/reviews', (c) => c.json({ data: [] }));
  app.post('/webhook', (c) => c.json({ message: 'ok' }));

  return app;
}

describe('Rate Limiting Middleware', () => {
  describe('Request under rate limit passes through', () => {
    it('should process requests normally when under the limit', async () => {
      const app = createApp({ apiLimit: 5 });

      const res = await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.1' },
      });

      expect(res.status).toBe(200);
    });
  });

  describe('Request exceeding rate limit returns 429', () => {
    it('should return 429 after exceeding the API limit', async () => {
      const app = createApp({ apiLimit: 3 });

      // Make 3 requests to reach the limit
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/api/reviews', {
          headers: { 'x-forwarded-for': '10.0.0.2' },
        });
        expect(res.status).toBe(200);
      }

      // 4th request should be rate limited
      const res = await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.2' },
      });
      expect(res.status).toBe(429);
    });
  });

  describe('Different IPs tracked separately', () => {
    it('should not block a different IP when one is rate limited', async () => {
      const app = createApp({ apiLimit: 2 });

      // Exhaust limit for IP 10.0.0.3
      for (let i = 0; i < 2; i++) {
        await app.request('/api/reviews', {
          headers: { 'x-forwarded-for': '10.0.0.3' },
        });
      }

      // Verify 10.0.0.3 is limited
      const limitedRes = await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.3' },
      });
      expect(limitedRes.status).toBe(429);

      // Different IP should still work
      const otherRes = await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.4' },
      });
      expect(otherRes.status).toBe(200);
    });
  });

  describe('Retry-After header present on 429 responses', () => {
    it('should include Retry-After header when rate limited', async () => {
      const app = createApp({ apiLimit: 1 });

      // Exhaust limit
      await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.5' },
      });

      // Trigger 429
      const res = await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.5' },
      });

      expect(res.status).toBe(429);
      const retryAfter = res.headers.get('retry-after');
      expect(retryAfter).toBeTruthy();
      expect(Number(retryAfter)).toBeGreaterThan(0);
    });
  });

  describe('Webhook has higher limit than API', () => {
    it('should allow webhook requests beyond the API limit', async () => {
      // Use very small limits to test the relative difference
      const app = createApp({ apiLimit: 2, webhookLimit: 5 });

      // Exhaust API limit for this IP
      for (let i = 0; i < 2; i++) {
        await app.request('/api/reviews', {
          headers: { 'x-forwarded-for': '10.0.0.6' },
        });
      }
      const apiRes = await app.request('/api/reviews', {
        headers: { 'x-forwarded-for': '10.0.0.6' },
      });
      expect(apiRes.status).toBe(429);

      // Webhook should still work (different rate limiter, separate counter)
      const webhookRes = await app.request('/webhook', {
        method: 'POST',
        headers: { 'x-forwarded-for': '10.0.0.6' },
      });
      expect(webhookRes.status).toBe(200);
    });
  });
});
