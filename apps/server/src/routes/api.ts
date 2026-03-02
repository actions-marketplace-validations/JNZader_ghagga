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
  decrypt,
} from 'ghagga-db';
import type { Database } from 'ghagga-db';
import type { RepoSettings, DbProviderChainEntry } from 'ghagga-db';
import type { SaaSProvider } from 'ghagga-core';
import type { AuthUser } from '../middleware/auth.js';
import { logger as rootLogger } from '../lib/logger.js';
import { validateProviderKey } from '../lib/provider-models.js';

const logger = rootLogger.child({ module: 'api' });

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

    try {
      const repo = await getRepoByFullName(db, repoFullName);

      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const reviews = await getReviewsByRepoId(db, repo.id, { limit, offset });

      return c.json({
        data: reviews,
        pagination: { page, limit, offset },
      });
    } catch (err) {
      logger.error({ err, repo: repoFullName, user: user.githubLogin }, 'Failed to fetch reviews');
      return c.json({ error: 'Failed to fetch reviews' }, 500);
    }
  });

  // ── GET /api/stats ──────────────────────────────────────────
  router.get('/api/stats', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoFullName = c.req.query('repo');

    if (!repoFullName) {
      return c.json({ error: 'Missing required query parameter: repo' }, 400);
    }

    try {
      const repo = await getRepoByFullName(db, repoFullName);

      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const raw = await getReviewStats(db, repo.id);

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
          reviewsByDay: [], // TODO: implement daily aggregation query
        },
      });
    } catch (err) {
      logger.error({ err, repo: repoFullName, user: user.githubLogin }, 'Failed to fetch stats');
      return c.json({ error: 'Failed to fetch stats' }, 500);
    }
  });

  // ── GET /api/repositories ───────────────────────────────────
  router.get('/api/repositories', async (c) => {
    const user = c.get('user') as AuthUser;

    try {
      const allRepos = [];
      for (const installationId of user.installationIds) {
        const repos = await getReposByInstallationId(db, installationId);
        allRepos.push(...repos);
      }

      return c.json({ data: allRepos });
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to fetch repositories');
      return c.json({ error: 'Failed to fetch repositories' }, 500);
    }
  });

  // ── GET /api/settings ────────────────────────────────────────
  router.get('/api/settings', async (c) => {
    const user = c.get('user') as AuthUser;
    const repoFullName = c.req.query('repo');

    if (!repoFullName) {
      return c.json({ error: 'Missing required query parameter: repo' }, 400);
    }

    try {
      const repo = await getRepoByFullName(db, repoFullName);

      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const settings = repo.settings as RepoSettings;
      const chain = (repo.providerChain ?? []) as DbProviderChainEntry[];

      // Build view: mask keys, never expose encrypted values
      const providerChainView = chain.map((entry) => ({
        provider: entry.provider,
        model: entry.model,
        hasApiKey: entry.encryptedApiKey != null,
        maskedApiKey: entry.encryptedApiKey
          ? maskApiKey(decrypt(entry.encryptedApiKey))
          : undefined,
      }));

      return c.json({
        data: {
          repoId: repo.id,
          repoFullName: repo.fullName,
          aiReviewEnabled: repo.aiReviewEnabled,
          providerChain: providerChainView,
          reviewMode: repo.reviewMode,
          enableSemgrep: settings.enableSemgrep,
          enableTrivy: settings.enableTrivy,
          enableCpd: settings.enableCpd,
          enableMemory: settings.enableMemory,
          customRules: (settings.customRules ?? []).join('\n'),
          ignorePatterns: settings.ignorePatterns ?? [],
        },
      });
    } catch (err) {
      logger.error({ err, repo: repoFullName, user: user.githubLogin }, 'Failed to fetch settings');
      return c.json({ error: 'Failed to fetch settings' }, 500);
    }
  });

  // ── PUT /api/settings ───────────────────────────────────────
  router.put('/api/settings', async (c) => {
    const user = c.get('user') as AuthUser;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const repoFullName = body.repoFullName as string | undefined;
    if (!repoFullName) {
      return c.json({ error: 'Missing repoFullName' }, 400);
    }

    try {
      const repo = await getRepoByFullName(db, repoFullName);
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      // Validate no Ollama in the chain
      const incomingChain = (body.providerChain ?? []) as Array<{
        provider: string;
        model: string;
        apiKey?: string;
      }>;

      const VALID_SAAS_PROVIDERS = ['anthropic', 'openai', 'google', 'github'];
      for (const entry of incomingChain) {
        if (!VALID_SAAS_PROVIDERS.includes(entry.provider)) {
          return c.json(
            { error: `Provider '${entry.provider}' is not available in the SaaS dashboard` },
            400,
          );
        }
      }

      // Merge API keys: preserve existing encrypted keys when not provided
      const existingChain = (repo.providerChain ?? []) as DbProviderChainEntry[];

      const mergedChain: DbProviderChainEntry[] = incomingChain.map((entry) => {
        if (entry.apiKey) {
          // New key provided → encrypt it
          return {
            provider: entry.provider as SaaSProvider,
            model: entry.model,
            encryptedApiKey: encrypt(entry.apiKey),
          };
        }

        if (entry.provider === 'github') {
          // GitHub Models doesn't need an API key
          return {
            provider: 'github' as const,
            model: entry.model,
            encryptedApiKey: null,
          };
        }

        // No key provided → try to preserve existing key for this provider
        const existing = existingChain.find((e) => e.provider === entry.provider);
        return {
          provider: entry.provider as SaaSProvider,
          model: entry.model,
          encryptedApiKey: existing?.encryptedApiKey ?? null,
        };
      });

      // Build settings update
      const currentSettings = (repo.settings ?? {}) as RepoSettings;
      const settingsUpdate: RepoSettings = {
        enableSemgrep: typeof body.enableSemgrep === 'boolean' ? body.enableSemgrep : currentSettings.enableSemgrep,
        enableTrivy: typeof body.enableTrivy === 'boolean' ? body.enableTrivy : currentSettings.enableTrivy,
        enableCpd: typeof body.enableCpd === 'boolean' ? body.enableCpd : currentSettings.enableCpd,
        enableMemory: typeof body.enableMemory === 'boolean' ? body.enableMemory : currentSettings.enableMemory,
        customRules: typeof body.customRules === 'string'
          ? (body.customRules as string).split('\n').map((r: string) => r.trim()).filter(Boolean)
          : currentSettings.customRules,
        ignorePatterns: Array.isArray(body.ignorePatterns) ? body.ignorePatterns as string[] : currentSettings.ignorePatterns,
        reviewLevel: typeof body.reviewLevel === 'string' ? body.reviewLevel as RepoSettings['reviewLevel'] : currentSettings.reviewLevel,
      };

      await updateRepoSettings(db, repo.id, {
        settings: settingsUpdate,
        reviewMode: typeof body.reviewMode === 'string' ? body.reviewMode : undefined,
        aiReviewEnabled: typeof body.aiReviewEnabled === 'boolean' ? body.aiReviewEnabled : undefined,
        providerChain: mergedChain,
      });

      logger.info({ repo: repoFullName, user: user.githubLogin, chainLength: mergedChain.length }, 'Settings updated');
      return c.json({ message: 'Settings updated' });
    } catch (err) {
      logger.error({ err, repo: repoFullName, user: user.githubLogin }, 'Failed to update settings');
      return c.json({ error: 'Failed to update settings' }, 500);
    }
  });

  // ── POST /api/providers/validate ────────────────────────────
  router.post('/api/providers/validate', async (c) => {
    const user = c.get('user') as AuthUser;

    let body: { provider?: string; apiKey?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const provider = body.provider;
    if (!provider) {
      return c.json({ error: 'Missing provider field' }, 400);
    }

    if (provider === 'ollama') {
      return c.json({ error: 'Ollama is not available in the SaaS dashboard. Use CLI or Action instead.' }, 400);
    }

    const validProviders = ['anthropic', 'openai', 'google', 'github'];
    if (!validProviders.includes(provider)) {
      return c.json({ error: `Unknown provider: ${provider}` }, 400);
    }

    // For GitHub Models, use the user's session token
    let apiKey = body.apiKey;
    if (provider === 'github') {
      const authHeader = c.req.header('Authorization') ?? '';
      apiKey = authHeader.replace(/^Bearer\s+/i, '');
    } else if (!apiKey) {
      return c.json({ error: 'Missing apiKey for non-GitHub provider' }, 400);
    }

    try {
      const result = await validateProviderKey(provider as SaaSProvider, apiKey!);
      return c.json(result);
    } catch (err) {
      logger.error({ err, provider, user: user.githubLogin }, 'Provider validation error');
      return c.json({ valid: false, models: [], error: 'Validation request failed' });
    }
  });

  // ── PUT /api/repositories/:id/settings (LEGACY — kept for backward compat) ──
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
