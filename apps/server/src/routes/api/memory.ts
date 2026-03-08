/**
 * Memory-related API routes:
 *   GET /api/memory/sessions
 *   GET /api/memory/sessions/:id/observations
 *   DELETE /api/memory/observations
 *   DELETE /api/memory/observations/:id
 *   DELETE /api/memory/projects/:project/observations
 *   DELETE /api/memory/sessions/empty
 *   DELETE /api/memory/sessions/:id
 */

import type { Database } from 'ghagga-db';
import {
  clearAllMemoryObservations,
  clearEmptyMemorySessions,
  clearMemoryObservationsByProject,
  deleteMemoryObservation,
  deleteMemoryObservationsByIds,
  deleteMemorySession,
  getObservationsBySession,
  getRepoByFullName,
  getSessionById,
  getSessionsByProject,
} from 'ghagga-db';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AuthUser } from '../../middleware/auth.js';
import { generateErrorId, logger } from './utils.js';

export function createMemoryRouter(db: Database) {
  const router = new Hono();

  // ── GET /api/memory/sessions ────────────────────────────────
  router.get('/api/memory/sessions', async (c) => {
    const project = c.req.query('project');

    if (!project) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: 'Missing required query parameter: project' },
        400,
      );
    }

    // Verify user has access to this project's installation
    const user = c.get('user') as AuthUser;
    const repo = await getRepoByFullName(db, project);

    if (!repo) {
      return c.json({ error: 'NOT_FOUND', message: 'Repository not found' }, 404);
    }

    if (!user.installationIds.includes(repo.installationId)) {
      return c.json({ error: 'FORBIDDEN', message: 'Forbidden' }, 403);
    }

    const sessions = await getSessionsByProject(db, project);

    return c.json({ data: sessions });
  });

  // ── GET /api/memory/sessions/:id/observations ───────────────
  router.get('/api/memory/sessions/:id/observations', async (c) => {
    const user = c.get('user') as AuthUser;
    const sessionId = parseInt(c.req.param('id'), 10);

    if (Number.isNaN(sessionId)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid session ID' }, 400);
    }

    // Authorization: verify the session's project belongs to the user's installations
    const session = await getSessionById(db, sessionId);

    if (!session) {
      return c.json({ error: 'NOT_FOUND', message: 'Session not found' }, 404);
    }

    const repo = await getRepoByFullName(db, session.project);

    if (!repo || !user.installationIds.includes(repo.installationId)) {
      return c.json({ error: 'FORBIDDEN', message: 'Forbidden' }, 403);
    }

    const observations = await getObservationsBySession(db, sessionId);

    return c.json({ data: observations });
  });

  // ── DELETE /api/memory/observations ────────────────────────────
  // Purge ALL observations (registered before :id route — Decision 3)
  router.delete('/api/memory/observations', async (c) => {
    const user = c.get('user') as AuthUser;

    try {
      let totalCleared = 0;
      for (const installationId of user.installationIds) {
        totalCleared += await clearAllMemoryObservations(db, installationId);
      }
      return c.json({ data: { cleared: totalCleared } });
    } catch (err) {
      const errorId = generateErrorId();
      logger.error(
        { err, errorId, user: user.githubLogin },
        'Failed to purge all memory observations',
      );
      return c.json(
        { error: 'DELETE_FAILED', message: 'Failed to purge all memory observations', errorId },
        500,
      );
    }
  });

  // ── DELETE /api/memory/observations/batch ──────────────────────
  // Registered AFTER purge-all and BEFORE :id to ensure literal match first.
  const batchObservationsSchema = z.object({
    ids: z.array(z.number().int().positive()).min(1).max(100),
  });

  router.delete('/api/memory/observations/batch', async (c) => {
    const user = c.get('user') as AuthUser;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid JSON body' }, 400);
    }

    const parsed = batchObservationsSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: 'VALIDATION_ERROR', message: parsed.error.issues[0]?.message ?? 'Invalid input' },
        400,
      );
    }

    try {
      let deletedCount = 0;
      for (const installationId of user.installationIds) {
        deletedCount += await deleteMemoryObservationsByIds(db, installationId, parsed.data.ids);
      }
      return c.json({ data: { deletedCount } });
    } catch (err) {
      const errorId = generateErrorId();
      logger.error(
        { err, errorId, user: user.githubLogin },
        'Failed to batch delete memory observations',
      );
      return c.json(
        { error: 'DELETE_FAILED', message: 'Failed to batch delete memory observations', errorId },
        500,
      );
    }
  });

  // ── DELETE /api/memory/observations/:id ────────────────────────
  router.delete('/api/memory/observations/:id', async (c) => {
    const user = c.get('user') as AuthUser;
    const id = parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid observation ID' }, 400);
    }

    try {
      for (const installationId of user.installationIds) {
        const deleted = await deleteMemoryObservation(db, installationId, id);
        if (deleted) {
          return c.json({ data: { deleted: true } });
        }
      }
      return c.json({ error: 'NOT_FOUND', message: 'Observation not found' }, 404);
    } catch (err) {
      const errorId = generateErrorId();
      logger.error({ err, errorId, user: user.githubLogin }, 'Failed to delete memory observation');
      return c.json(
        { error: 'DELETE_FAILED', message: 'Failed to delete memory observation', errorId },
        500,
      );
    }
  });

  // ── DELETE /api/memory/projects/:project/observations ──────────
  router.delete('/api/memory/projects/:project/observations', async (c) => {
    const user = c.get('user') as AuthUser;
    const project = decodeURIComponent(c.req.param('project'));

    try {
      const repo = await getRepoByFullName(db, project);
      if (!repo) {
        return c.json({ error: 'NOT_FOUND', message: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'FORBIDDEN', message: 'Forbidden' }, 403);
      }

      const cleared = await clearMemoryObservationsByProject(db, repo.installationId, project);
      return c.json({ data: { cleared } });
    } catch (err) {
      const errorId = generateErrorId();
      logger.error(
        { err, errorId, user: user.githubLogin },
        'Failed to clear project memory observations',
      );
      return c.json(
        { error: 'DELETE_FAILED', message: 'Failed to clear project memory observations', errorId },
        500,
      );
    }
  });

  // ── DELETE /api/memory/sessions/empty ──────────────────────────
  // Cleanup empty sessions (registered before :id route)
  router.delete('/api/memory/sessions/empty', async (c) => {
    const user = c.get('user') as AuthUser;
    const project = c.req.query('project');

    try {
      let totalDeleted = 0;
      for (const installationId of user.installationIds) {
        const { deletedCount } = await clearEmptyMemorySessions(db, installationId, project);
        totalDeleted += deletedCount;
      }
      return c.json({ data: { deletedCount: totalDeleted } });
    } catch (err) {
      const errorId = generateErrorId();
      logger.error(
        { err, errorId, user: user.githubLogin },
        'Failed to cleanup empty memory sessions',
      );
      return c.json(
        { error: 'DELETE_FAILED', message: 'Failed to cleanup empty memory sessions', errorId },
        500,
      );
    }
  });

  // ── DELETE /api/memory/sessions/:id ───────────────────────────
  router.delete('/api/memory/sessions/:id', async (c) => {
    const user = c.get('user') as AuthUser;
    const id = parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'VALIDATION_ERROR', message: 'Invalid session ID' }, 400);
    }

    try {
      for (const installationId of user.installationIds) {
        const { deleted } = await deleteMemorySession(db, installationId, id);
        if (deleted) {
          return c.json({ data: { deleted: true } });
        }
      }
      return c.json({ error: 'NOT_FOUND', message: 'Session not found' }, 404);
    } catch (err) {
      const errorId = generateErrorId();
      logger.error({ err, errorId, user: user.githubLogin }, 'Failed to delete memory session');
      return c.json(
        { error: 'DELETE_FAILED', message: 'Failed to delete memory session', errorId },
        500,
      );
    }
  });

  return router;
}
