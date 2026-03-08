/**
 * Repository-related API routes: GET /api/repositories
 */

import type { Database } from 'ghagga-db';
import { getReposByInstallationId } from 'ghagga-db';
import { Hono } from 'hono';
import type { AuthUser } from '../../middleware/auth.js';
import { logger } from './utils.js';

export function createRepositoriesRouter(db: Database) {
  const router = new Hono();

  // ── GET /api/repositories ───────────────────────────────────
  router.get('/api/repositories', async (c) => {
    const user = c.get('user') as AuthUser;

    try {
      const repoArrays = await Promise.all(
        user.installationIds.map((id) => getReposByInstallationId(db, id)),
      );
      const allRepos = repoArrays.flat();

      return c.json({ data: allRepos });
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to fetch repositories');
      return c.json({ error: 'FETCH_FAILED', message: 'Failed to fetch repositories' }, 500);
    }
  });

  return router;
}
