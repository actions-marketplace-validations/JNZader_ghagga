/**
 * Review-related API routes: GET /api/reviews, GET /api/stats
 */

import type { Database } from 'ghagga-db';
import { getRepoByFullName, getReviewStats, getReviewsByDay, getReviewsByRepoId } from 'ghagga-db';
import { Hono } from 'hono';
import type { AuthUser } from '../../middleware/auth.js';
import { logger } from './utils.js';

export function createReviewsRouter(db: Database) {
  const router = new Hono();

  // ── GET /api/reviews ────────────────────────────────────────
  router.get('/api/reviews', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoFullName = c.req.query('repo');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = (page - 1) * limit;

    if (!repoFullName) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: 'Missing required query parameter: repo' },
        400,
      );
    }

    try {
      const repo = await getRepoByFullName(db, repoFullName);

      if (!repo) {
        return c.json({ error: 'NOT_FOUND', message: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'FORBIDDEN', message: 'Forbidden' }, 403);
      }

      const reviews = await getReviewsByRepoId(db, repo.id, { limit, offset });

      return c.json({
        data: reviews,
        pagination: { page, limit, offset },
      });
    } catch (err) {
      logger.error({ err, repo: repoFullName, user: user.githubLogin }, 'Failed to fetch reviews');
      return c.json({ error: 'FETCH_FAILED', message: 'Failed to fetch reviews' }, 500);
    }
  });

  // ── GET /api/stats ──────────────────────────────────────────
  router.get('/api/stats', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoFullName = c.req.query('repo');

    if (!repoFullName) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: 'Missing required query parameter: repo' },
        400,
      );
    }

    try {
      const repo = await getRepoByFullName(db, repoFullName);

      if (!repo) {
        return c.json({ error: 'NOT_FOUND', message: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'FORBIDDEN', message: 'Forbidden' }, 403);
      }

      const [raw, reviewsByDay] = await Promise.all([
        getReviewStats(db, repo.id),
        getReviewsByDay(db, repo.id),
      ]);

      // Map DB shape to dashboard Stats type
      const total = raw.total ?? 0;
      const passed = raw.passed ?? 0;
      const failed = raw.failed ?? 0;
      const skipped = raw.skipped ?? 0;
      const needsHumanReview = total - passed - failed - skipped;

      return c.json({
        data: {
          totalReviews: total,
          passed,
          failed,
          needsHumanReview,
          skipped,
          passRate: total > 0 ? (passed / total) * 100 : 0,
          reviewsByDay,
        },
      });
    } catch (err) {
      logger.error({ err, repo: repoFullName, user: user.githubLogin }, 'Failed to fetch stats');
      return c.json({ error: 'FETCH_FAILED', message: 'Failed to fetch stats' }, 500);
    }
  });

  return router;
}
