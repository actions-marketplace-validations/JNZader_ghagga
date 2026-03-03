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
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Diagnostic endpoint — check static analysis tool availability
app.get('/health/tools', async (c) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const exec = promisify(execFile);

  const checkTool = async (cmd: string, args: string[]): Promise<{ available: boolean; version?: string; error?: string; path?: string }> => {
    try {
      const { stdout } = await exec(cmd, args, { timeout: 10_000 });
      return { available: true, version: stdout.trim().split('\n')[0] };
    } catch (e) {
      // Also try to find the binary
      let path: string | undefined;
      try {
        const { stdout: which } = await exec('which', [cmd], { timeout: 3_000 });
        path = which.trim();
      } catch {
        // Try common paths
        const { access } = await import('node:fs/promises');
        for (const p of [`/usr/local/bin/${cmd}`, `/opt/semgrep-venv/bin/${cmd}`, `/opt/pmd/bin/${cmd}`]) {
          try { await access(p); path = `found at ${p} (but not in PATH)`; break; } catch {}
        }
      }
      return { available: false, error: e instanceof Error ? e.message : String(e), path };
    }
  };

  const [semgrep, trivy, pmd] = await Promise.all([
    checkTool('semgrep', ['--version']),
    checkTool('trivy', ['--version']),
    checkTool('pmd', ['--version']),
  ]);

  // Also check PATH and symlinks
  let pathInfo: string | undefined;
  try {
    const { stdout } = await exec('sh', ['-c', 'echo $PATH && ls -la /usr/local/bin/semgrep /usr/local/bin/pmd 2>&1'], { timeout: 5_000 });
    pathInfo = stdout.trim();
  } catch (e) {
    pathInfo = e instanceof Error ? e.message : String(e);
  }

  return c.json({ semgrep, trivy, pmd, pathInfo, env: { NODE_ENV: process.env.NODE_ENV, cwd: process.cwd() } });
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
