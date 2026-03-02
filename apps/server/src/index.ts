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

import { logger } from './lib/logger.js';
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

// ── Global error handler ────────────────────────────────────────
// Catches any unhandled error in routes/middleware and logs it.
app.onError((err, c) => {
  const path = new URL(c.req.url).pathname;
  logger.error(
    { err, method: c.req.method, path, status: 500 },
    `Unhandled error on ${c.req.method} ${path}`,
  );

  return c.json(
    {
      error: 'Internal server error',
      ...(process.env.NODE_ENV !== 'production' && { detail: err.message, stack: err.stack }),
    },
    500,
  );
});

// ── Request logging middleware ───────────────────────────────────
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  const path = new URL(c.req.url).pathname;
  const status = c.res.status;

  // Skip noisy health checks from keepalive
  if (path === '/health') return;

  const logData = { method: c.req.method, path, status, ms };
  if (status >= 500) {
    logger.error(logData, `${c.req.method} ${path} ${status} (${ms}ms)`);
  } else if (status >= 400) {
    logger.warn(logData, `${c.req.method} ${path} ${status} (${ms}ms)`);
  } else {
    logger.info(logData, `${c.req.method} ${path} ${status} (${ms}ms)`);
  }
});

// CORS — allow all origins for the GitHub Pages dashboard
app.use('*', cors());

// Health check
app.get('/health', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString(), commit: '60a2af3' });
});

// Debug endpoint — temporary, remove after fixing the 500
app.get('/debug/auth-test', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader) return c.json({ error: 'No auth header' }, 401);

  const token = authHeader.slice('Bearer '.length);
  try {
    // Step 1: Verify GitHub token
    const ghRes = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!ghRes.ok) return c.json({ step: 'github_verify', error: ghRes.status });
    const user = await ghRes.json() as { id: number; login: string };

    // Step 2: Check DB for user mappings
    const { getInstallationsByUserId, getInstallationsByAccountLogin, getReposByInstallationId } = await import('ghagga-db');

    const mappings = await getInstallationsByUserId(db, user.id);

    // Step 3: Try account login fallback
    const byLogin = await getInstallationsByAccountLogin(db, user.login);

    // Step 4: Get repos
    const repos = [];
    const installationIds = mappings.length > 0
      ? mappings.map(m => m.id)
      : byLogin.map(m => m.id);

    for (const id of installationIds) {
      const r = await getReposByInstallationId(db, id);
      repos.push(...r.map(repo => repo.fullName));
    }

    return c.json({
      user: { id: user.id, login: user.login },
      mappings: mappings.length,
      byLogin: byLogin.length,
      installationIds,
      repoCount: repos.length,
      repos: repos.slice(0, 5),
    });
  } catch (err) {
    const msg = err instanceof Error ? { message: err.message, stack: err.stack } : String(err);
    return c.json({ error: 'debug_failed', detail: msg }, 500);
  }
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
    logger.info({ port: info.port }, `Server running on http://localhost:${info.port}`);

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

      logger.info({ url, intervalMs: FIVE_MINUTES }, 'Keepalive enabled');
    }
  },
);
