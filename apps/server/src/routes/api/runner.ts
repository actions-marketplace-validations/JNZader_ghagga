/**
 * Runner-related API routes:
 *   GET /api/runner/status
 *   POST /api/runner/create
 *   POST /api/runner/configure-secret
 */

import type { Database } from 'ghagga-db';
import { Hono } from 'hono';
import {
  createRunnerRepo,
  discoverRunnerRepo,
  RunnerCreationError,
  setRunnerSecret,
} from '../../github/runner.js';
import type { AuthUser } from '../../middleware/auth.js';
import { logger } from './utils.js';

export function createRunnerRouter(_db: Database) {
  const router = new Hono();

  // ── GET /api/runner/status ──────────────────────────────────
  router.get('/api/runner/status', async (c) => {
    const user = c.get('user') as AuthUser;
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    try {
      const runner = await discoverRunnerRepo(user.githubLogin, token);

      if (!runner) {
        return c.json({ data: { exists: false } });
      }

      const response: Record<string, unknown> = {
        exists: true,
        repoFullName: runner.fullName,
      };

      if (runner.isPrivate) {
        response.isPrivate = true;
        response.warning =
          'Runner repo is private — GitHub Actions minutes will be consumed from your quota (2000 min/month for free accounts).';
      }

      return c.json({ data: response });
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to check runner status');
      return c.json(
        {
          error: 'github_unavailable',
          message: 'Could not check runner status. Please try again.',
        },
        502,
      );
    }
  });

  // ── POST /api/runner/create ─────────────────────────────────
  router.post('/api/runner/create', async (c) => {
    const user = c.get('user') as AuthUser;
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    try {
      const result = await createRunnerRepo({
        ownerLogin: user.githubLogin,
        token,
        callbackSecretValue: process.env.GHAGGA_WEBHOOK_SECRET!,
      });

      const response: Record<string, unknown> = {
        created: true,
        repoFullName: result.repoFullName,
        secretConfigured: result.secretConfigured,
        isPrivate: result.isPrivate,
      };

      if (result.isPrivate) {
        response.warning =
          'The runner repo was created as private. Private repos consume your GitHub Actions minutes quota (2000 min/month).';
      }

      return c.json({ data: response }, 201);
    } catch (err) {
      if (err instanceof RunnerCreationError) {
        const userMessages: Record<string, string> = {
          insufficient_scope:
            'Your token does not have permission to create repositories. Please re-authenticate.',
          already_exists: 'Runner repo already exists.',
          rate_limited: 'GitHub API rate limit exceeded. Please try again later.',
          template_unavailable:
            'The runner template is temporarily unavailable. Please try again later.',
          org_permission_denied:
            'You do not have permission to create repositories in this organization.',
          creation_timeout: 'Repository creation timed out. Please check GitHub and try again.',
          secret_failed: 'Runner operation failed.',
          github_error: 'GitHub communication failed. Please try again later.',
        };

        switch (err.code) {
          case 'insufficient_scope':
            return c.json(
              { error: 'insufficient_scope', message: userMessages.insufficient_scope },
              403,
            );
          case 'already_exists':
            return c.json({ error: 'already_exists', repoFullName: err.repoFullName }, 409);
          case 'rate_limited':
            return c.json({ error: 'rate_limited', retryAfter: err.retryAfter }, 429);
          case 'template_unavailable':
            logger.error('Runner template repo JNZader/ghagga-runner-template is not accessible');
            return c.json(
              { error: 'template_unavailable', message: userMessages.template_unavailable },
              502,
            );
          case 'org_permission_denied':
            return c.json(
              { error: 'org_permission_denied', message: userMessages.org_permission_denied },
              403,
            );
          case 'creation_timeout':
            return c.json({ error: 'github_error', message: userMessages.creation_timeout }, 502);
          case 'secret_failed':
            return c.json(
              {
                data: {
                  created: true,
                  repoFullName: err.repoFullName,
                  secretConfigured: false,
                  isPrivate: false,
                },
              },
              201,
            );
          default:
            return c.json({ error: 'github_error', message: userMessages.github_error }, 502);
        }
      }

      logger.error({ err, user: user.githubLogin }, 'Failed to create runner repo');
      return c.json({ error: 'github_error', message: 'Failed to create runner repository.' }, 502);
    }
  });

  // ── POST /api/runner/configure-secret ───────────────────────
  router.post('/api/runner/configure-secret', async (c) => {
    const user = c.get('user') as AuthUser;
    const authHeader = c.req.header('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const runnerRepo = `${user.githubLogin}/ghagga-runner`;

    try {
      const runner = await discoverRunnerRepo(user.githubLogin, token);
      if (!runner) {
        return c.json(
          { error: 'runner_not_found', message: 'Runner repo not found. Create it first.' },
          404,
        );
      }

      await setRunnerSecret(
        runnerRepo,
        'GHAGGA_CALLBACK_SECRET',
        process.env.GHAGGA_WEBHOOK_SECRET!,
        token,
      );

      return c.json({ data: { configured: true } });
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to configure runner secret');
      return c.json({ error: 'github_error', message: 'Failed to configure runner secret.' }, 502);
    }
  });

  return router;
}
