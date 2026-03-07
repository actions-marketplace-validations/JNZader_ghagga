/**
 * Security headers middleware tests.
 *
 * Verifies that secureHeaders middleware adds all required security headers
 * to API responses, webhook responses, and error responses.
 */

import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { describe, expect, it } from 'vitest';

function createApp() {
  const app = new Hono();

  app.use(
    '*',
    secureHeaders({
      xFrameOptions: 'DENY',
      xContentTypeOptions: 'nosniff',
      strictTransportSecurity: 'max-age=31536000; includeSubDomains',
      referrerPolicy: 'strict-origin-when-cross-origin',
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
      },
    }),
  );

  // Normal API route
  app.get('/api/reviews', (c) => c.json({ data: [] }));

  // Webhook route
  app.post('/webhook', (c) => c.json({ message: 'ok' }));

  // Error-triggering route
  app.get('/error', () => {
    throw new Error('Test error');
  });

  // Global error handler
  app.onError((_err, c) => {
    return c.json({ error: 'Internal server error' }, 500);
  });

  return app;
}

const REQUIRED_HEADERS = [
  ['x-frame-options', 'DENY'],
  ['x-content-type-options', 'nosniff'],
  ['strict-transport-security', 'max-age=31536000; includeSubDomains'],
  ['content-security-policy', "default-src 'self'"],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
] as const;

describe('Security Headers Middleware', () => {
  const app = createApp();

  describe('API response includes security headers', () => {
    it('should include all 5 security headers on GET /api/reviews', async () => {
      const res = await app.request('/api/reviews');

      expect(res.status).toBe(200);
      for (const [header, value] of REQUIRED_HEADERS) {
        expect(res.headers.get(header)).toBe(value);
      }
    });
  });

  describe('Webhook response includes security headers', () => {
    it('should include all security headers on POST /webhook', async () => {
      const res = await app.request('/webhook', { method: 'POST' });

      expect(res.status).toBe(200);
      for (const [header, value] of REQUIRED_HEADERS) {
        expect(res.headers.get(header)).toBe(value);
      }
    });
  });

  describe('Error response includes security headers', () => {
    it('should include all security headers on 500 error', async () => {
      const res = await app.request('/error');

      expect(res.status).toBe(500);
      for (const [header, value] of REQUIRED_HEADERS) {
        expect(res.headers.get(header)).toBe(value);
      }
    });
  });
});
