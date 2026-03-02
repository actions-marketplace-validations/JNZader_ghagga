/**
 * OAuth proxy routes for the dashboard.
 *
 * The dashboard (a static SPA on GitHub Pages) cannot call
 * github.com directly due to CORS restrictions. These endpoints
 * proxy the GitHub Device Flow requests through the GHAGGA server,
 * which has CORS enabled for all origins.
 *
 * No auth middleware — these are public endpoints used BEFORE
 * the user is authenticated.
 *
 * Only the Client ID is needed (no Client Secret) because
 * Device Flow is designed for public clients.
 */

import { Hono } from 'hono';

/** GHAGGA OAuth App Client ID (public) */
const GITHUB_CLIENT_ID = 'Ov23liyYpSgDqOLUFa5k';

export function createOAuthRouter() {
  const router = new Hono();

  // ── POST /auth/device/code ──────────────────────────────────
  // Proxy: request device + user verification codes from GitHub
  router.post('/auth/device/code', async (c) => {
    try {
      const response = await fetch('https://github.com/login/device/code', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: '',
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return c.json(
          { error: 'github_error', message: text },
          response.status as 400 | 500,
        );
      }

      const data = await response.json();
      return c.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'proxy_error', message }, 502);
    }
  });

  // ── POST /auth/device/token ─────────────────────────────────
  // Proxy: poll for access token after user enters the code
  router.post('/auth/device/token', async (c) => {
    let body: { device_code?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_body', message: 'Invalid JSON body' }, 400);
    }

    if (!body.device_code) {
      return c.json({ error: 'missing_field', message: 'device_code is required' }, 400);
    }

    try {
      const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: body.device_code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        return c.json(
          { error: 'github_error', message: text },
          response.status as 400 | 500,
        );
      }

      const data = await response.json();
      return c.json(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: 'proxy_error', message }, 502);
    }
  });

  return router;
}
