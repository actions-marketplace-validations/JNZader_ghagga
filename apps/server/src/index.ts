/**
 * @ghagga/server — Hono API server entry point.
 *
 * Serves the GitHub webhook endpoint, Inngest durable functions,
 * and the dashboard REST API.
 */

import 'dotenv/config';

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { serve as serveInngest } from 'inngest/hono';

import { createDatabaseFromEnv } from 'ghagga-db';

import { inngest } from './inngest/client.js';
import { reviewFunction } from './inngest/review.js';
import { createWebhookRouter } from './routes/webhook.js';
import { createOAuthRouter } from './routes/oauth.js';
import { createApiRouter } from './routes/api.js';
import { authMiddleware } from './middleware/auth.js';

// ─── Database ───────────────────────────────────────────────────

const db = createDatabaseFromEnv();

// ─── App ────────────────────────────────────────────────────────

const app = new Hono();

// CORS — allow all origins for the GitHub Pages dashboard
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook routes (no auth required — verified by signature)
const webhookRouter = createWebhookRouter(db);
app.route('/', webhookRouter);

// OAuth proxy routes (no auth required — used during login)
const oauthRouter = createOAuthRouter();
app.route('/', oauthRouter);

// Inngest serve endpoint (before auth middleware — Inngest uses its own signing)
app.on(
  ['GET', 'POST', 'PUT'],
  '/api/inngest',
  serveInngest({ client: inngest, functions: [reviewFunction] }),
);

// Dashboard API routes (auth required — must be after Inngest mount)
app.use('/api/*', authMiddleware(db));
const apiRouter = createApiRouter(db);
app.route('/', apiRouter);

// ─── Start Server ───────────────────────────────────────────────

const port = parseInt(process.env.PORT ?? '3000', 10);

serve(
  { fetch: app.fetch, port },
  (info) => {
    console.log(`[ghagga] Server running on http://localhost:${info.port}`);

    // Keepalive: self-ping every 5 minutes to prevent Render free tier cold starts.
    // Render spins down after 15 min of inactivity — webhooks would fail on cold start.
    if (process.env.NODE_ENV === 'production' && process.env.RENDER_EXTERNAL_URL) {
      const url = `${process.env.RENDER_EXTERNAL_URL}/health`;
      const FIVE_MINUTES = 5 * 60 * 1000;

      setInterval(async () => {
        try {
          await fetch(url);
        } catch {
          // Silently ignore — if we can't reach ourselves, something else is wrong
        }
      }, FIVE_MINUTES);

      console.log(`[ghagga] Keepalive enabled: pinging ${url} every 5m`);
    }
  },
);
