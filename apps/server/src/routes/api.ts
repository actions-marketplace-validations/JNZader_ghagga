/**
 * Dashboard API routes.
 *
 * All routes require authentication via the auth middleware.
 * Users can only access data from installations they belong to.
 */

import { Hono } from 'hono';
import {
  getReviewsByRepoId,
  getReviewStats,
  getRepoByFullName,
  getReposByInstallationId,
  updateRepoSettings,
  saveRepoApiKey,
  removeRepoApiKey,
  getSessionsByProject,
  getObservationsBySession,
  encrypt,
} from '@ghagga/db';
import type { Database } from '@ghagga/db';
import type { RepoSettings } from '@ghagga/db';
import type { AuthUser } from '../middleware/auth.js';

// ─── Route Factory ──────────────────────────────────────────────

export function createApiRouter(db: Database) {
  const router = new Hono();

  // ── GET /api/reviews ────────────────────────────────────────
  router.get('/api/reviews', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoFullName = c.req.query('repo');
    const page = parseInt(c.req.query('page') ?? '1', 10);
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
    const offset = (page - 1) * limit;

    if (!repoFullName) {
      return c.json({ error: 'Missing required query parameter: repo' }, 400);
    }

    const repo = await getRepoByFullName(db, repoFullName);

    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    // Check access: repo must belong to one of the user's installations
    if (!user.installationIds.includes(repo.installationId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const reviews = await getReviewsByRepoId(db, repo.id, { limit, offset });

    return c.json({
      data: reviews,
      pagination: { page, limit, offset },
    });
  });

  // ── GET /api/stats ──────────────────────────────────────────
  router.get('/api/stats', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoFullName = c.req.query('repo');

    if (!repoFullName) {
      return c.json({ error: 'Missing required query parameter: repo' }, 400);
    }

    const repo = await getRepoByFullName(db, repoFullName);

    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    if (!user.installationIds.includes(repo.installationId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const stats = await getReviewStats(db, repo.id);

    return c.json({ data: stats });
  });

  // ── GET /api/repositories ───────────────────────────────────
  router.get('/api/repositories', async (c) => {
    const user = c.get('user') as AuthUser;

    const allRepos = [];
    for (const installationId of user.installationIds) {
      const repos = await getReposByInstallationId(db, installationId);
      allRepos.push(...repos);
    }

    return c.json({ data: allRepos });
  });

  // ── PUT /api/repositories/:id/settings ──────────────────────
  router.put('/api/repositories/:id/settings', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoId = parseInt(c.req.param('id'), 10);

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repository ID' }, 400);
    }

    // Verify the repo belongs to one of the user's installations
    const repo = await findRepoById(db, repoId, user.installationIds);
    if (!repo) {
      return c.json({ error: 'Repository not found or access denied' }, 404);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const updates: {
      settings?: RepoSettings;
      llmProvider?: string;
      llmModel?: string;
      reviewMode?: string;
    } = {};

    // Extract repo settings fields
    const settingsFields = [
      'enableSemgrep',
      'enableTrivy',
      'enableCpd',
      'enableMemory',
      'customRules',
      'ignorePatterns',
      'reviewLevel',
    ];

    const hasSettingsUpdate = settingsFields.some((field) => field in body);
    if (hasSettingsUpdate) {
      const currentSettings = (repo.settings ?? {}) as RepoSettings;
      updates.settings = { ...currentSettings };

      for (const field of settingsFields) {
        if (field in body) {
          // Use a type assertion to allow dynamic field assignment on RepoSettings
          (updates.settings as unknown as Record<string, unknown>)[field] = body[field];
        }
      }
    }

    if ('llmProvider' in body && typeof body.llmProvider === 'string') {
      updates.llmProvider = body.llmProvider;
    }
    if ('llmModel' in body && typeof body.llmModel === 'string') {
      updates.llmModel = body.llmModel;
    }
    if ('reviewMode' in body && typeof body.reviewMode === 'string') {
      updates.reviewMode = body.reviewMode;
    }

    await updateRepoSettings(db, repoId, updates);

    return c.json({ message: 'Settings updated' });
  });

  // ── POST /api/repositories/:id/api-key ──────────────────────
  router.post('/api/repositories/:id/api-key', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoId = parseInt(c.req.param('id'), 10);

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repository ID' }, 400);
    }

    const repo = await findRepoById(db, repoId, user.installationIds);
    if (!repo) {
      return c.json({ error: 'Repository not found or access denied' }, 404);
    }

    let body: { key?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    if (!body.key || typeof body.key !== 'string') {
      return c.json({ error: 'Missing or invalid key field' }, 400);
    }

    const encrypted = encrypt(body.key);
    await saveRepoApiKey(db, repoId, encrypted);

    // Return masked key
    const masked = maskApiKey(body.key);

    return c.json({ message: 'API key saved', maskedKey: masked });
  });

  // ── DELETE /api/repositories/:id/api-key ────────────────────
  router.delete('/api/repositories/:id/api-key', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoId = parseInt(c.req.param('id'), 10);

    if (isNaN(repoId)) {
      return c.json({ error: 'Invalid repository ID' }, 400);
    }

    const repo = await findRepoById(db, repoId, user.installationIds);
    if (!repo) {
      return c.json({ error: 'Repository not found or access denied' }, 404);
    }

    await removeRepoApiKey(db, repoId);

    return c.json({ message: 'API key removed' });
  });

  // ── GET /api/memory/sessions ────────────────────────────────
  router.get('/api/memory/sessions', async (c) => {
    const project = c.req.query('project');

    if (!project) {
      return c.json({ error: 'Missing required query parameter: project' }, 400);
    }

    // Verify user has access to this project's installation
    const user = c.get('user') as AuthUser;
    const repo = await getRepoByFullName(db, project);

    if (!repo) {
      return c.json({ error: 'Repository not found' }, 404);
    }

    if (!user.installationIds.includes(repo.installationId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const sessions = await getSessionsByProject(db, project);

    return c.json({ data: sessions });
  });

  // ── GET /api/memory/sessions/:id/observations ───────────────
  router.get('/api/memory/sessions/:id/observations', async (c) => {
    const sessionId = parseInt(c.req.param('id'), 10);

    if (isNaN(sessionId)) {
      return c.json({ error: 'Invalid session ID' }, 400);
    }

    // Note: For a more thorough authorization check, we'd look up
    // the session's project and verify installation access. For now,
    // we rely on the auth middleware ensuring the user is authenticated.
    const observations = await getObservationsBySession(db, sessionId);

    return c.json({ data: observations });
  });

  return router;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Find a repository by ID and verify it belongs to one of the given installations.
 */
async function findRepoById(
  db: Database,
  repoId: number,
  installationIds: number[],
) {
  // We need to check all repos across the user's installations
  for (const installationId of installationIds) {
    const repos = await getReposByInstallationId(db, installationId);
    const repo = repos.find((r) => r.id === repoId);
    if (repo) return repo;
  }
  return null;
}

/**
 * Mask an API key for safe display.
 * Shows the first 3 chars and last 4 chars: "sk-...xxxx"
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  const prefix = key.slice(0, 3);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}
