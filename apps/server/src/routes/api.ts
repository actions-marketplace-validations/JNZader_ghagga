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
  getInstallationSettings,
  upsertInstallationSettings,
  getInstallationById,
  getSessionsByProject,
  getObservationsBySession,
  encrypt,
  decrypt,
  DEFAULT_REPO_SETTINGS,
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

  // ── GET /api/installations ──────────────────────────────────
  router.get('/api/installations', async (c) => {
    const user = c.get('user') as AuthUser;

    try {
      const results = [];
      for (const id of user.installationIds) {
        const inst = await getInstallationById(db, id);
        if (inst) {
          results.push({
            id: inst.id,
            accountLogin: inst.accountLogin,
            accountType: inst.accountType,
          });
        }
      }
      return c.json({ data: results });
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to fetch installations');
      return c.json({ error: 'Failed to fetch installations' }, 500);
    }
  });

  // ── GET /api/installation-settings ─────────────────────────
  router.get('/api/installation-settings', async (c) => {
    const user = c.get('user') as AuthUser;
    const installationId = parseInt(c.req.query('installation_id') ?? '', 10);

    if (isNaN(installationId)) {
      return c.json({ error: 'Missing or invalid installation_id parameter' }, 400);
    }

    if (!user.installationIds.includes(installationId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    try {
      const inst = await getInstallationById(db, installationId);
      const row = await getInstallationSettings(db, installationId);

      if (row) {
        const chain = (row.providerChain ?? []) as DbProviderChainEntry[];
        const settings = (row.settings ?? DEFAULT_REPO_SETTINGS) as RepoSettings;

        return c.json({
          data: {
            installationId,
            accountLogin: inst?.accountLogin ?? '',
            providerChain: chain.map((entry) => ({
              provider: entry.provider,
              model: entry.model,
              hasApiKey: entry.encryptedApiKey != null,
              maskedApiKey: entry.encryptedApiKey
                ? maskApiKey(decrypt(entry.encryptedApiKey))
                : undefined,
            })),
            aiReviewEnabled: row.aiReviewEnabled,
            reviewMode: row.reviewMode,
            enableSemgrep: settings.enableSemgrep,
            enableTrivy: settings.enableTrivy,
            enableCpd: settings.enableCpd,
            enableMemory: settings.enableMemory,
            customRules: (settings.customRules ?? []).join('\n'),
            ignorePatterns: settings.ignorePatterns ?? [],
          },
        });
      }

      // No settings exist yet — return defaults
      return c.json({
        data: {
          installationId,
          accountLogin: inst?.accountLogin ?? '',
          providerChain: [],
          aiReviewEnabled: true,
          reviewMode: 'simple',
          enableSemgrep: true,
          enableTrivy: true,
          enableCpd: true,
          enableMemory: true,
          customRules: '',
          ignorePatterns: DEFAULT_REPO_SETTINGS.ignorePatterns,
        },
      });
    } catch (err) {
      logger.error({ err, installationId, user: user.githubLogin }, 'Failed to fetch installation settings');
      return c.json({ error: 'Failed to fetch installation settings' }, 500);
    }
  });

  // ── PUT /api/installation-settings ─────────────────────────
  router.put('/api/installation-settings', async (c) => {
    const user = c.get('user') as AuthUser;

    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }

    const installationId = body.installationId as number | undefined;
    if (!installationId || typeof installationId !== 'number') {
      return c.json({ error: 'Missing or invalid installationId' }, 400);
    }

    if (!user.installationIds.includes(installationId)) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    try {
      // Validate and merge provider chain
      const incomingChain = (body.providerChain ?? []) as Array<{
        provider: string;
        model: string;
        apiKey?: string;
      }>;

      const VALID_SAAS_PROVIDERS = ['anthropic', 'openai', 'google', 'github', 'qwen'];
      for (const entry of incomingChain) {
        if (!VALID_SAAS_PROVIDERS.includes(entry.provider)) {
          return c.json(
            { error: `Provider '${entry.provider}' is not available in the SaaS dashboard` },
            400,
          );
        }
      }

      // Merge API keys with existing
      const existingRow = await getInstallationSettings(db, installationId);
      const existingChain = existingRow
        ? ((existingRow.providerChain ?? []) as DbProviderChainEntry[])
        : [];

      const mergedChain: DbProviderChainEntry[] = incomingChain.map((entry) => {
        if (entry.apiKey) {
          return {
            provider: entry.provider as SaaSProvider,
            model: entry.model,
            encryptedApiKey: encrypt(entry.apiKey),
          };
        }
        if (entry.provider === 'github') {
          return { provider: 'github' as const, model: entry.model, encryptedApiKey: null };
        }
        const existing = existingChain.find((e) => e.provider === entry.provider);
        return {
          provider: entry.provider as SaaSProvider,
          model: entry.model,
          encryptedApiKey: existing?.encryptedApiKey ?? null,
        };
      });

      // Build settings JSONB
      const currentSettings = existingRow
        ? ((existingRow.settings ?? DEFAULT_REPO_SETTINGS) as RepoSettings)
        : DEFAULT_REPO_SETTINGS;

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

      await upsertInstallationSettings(db, installationId, {
        providerChain: mergedChain,
        aiReviewEnabled: typeof body.aiReviewEnabled === 'boolean' ? body.aiReviewEnabled : undefined,
        reviewMode: typeof body.reviewMode === 'string' ? body.reviewMode : undefined,
        settings: settingsUpdate,
      });

      logger.info({ installationId, user: user.githubLogin, chainLength: mergedChain.length }, 'Installation settings updated');
      return c.json({ message: 'Installation settings updated' });
    } catch (err) {
      logger.error({ err, installationId, user: user.githubLogin }, 'Failed to update installation settings');
      return c.json({ error: 'Failed to update installation settings' }, 500);
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

      // Fetch global settings for reference
      const globalRow = await getInstallationSettings(db, repo.installationId);
      let globalSettings = undefined;
      if (globalRow) {
        const gChain = (globalRow.providerChain ?? []) as DbProviderChainEntry[];
        const gSettings = (globalRow.settings ?? DEFAULT_REPO_SETTINGS) as RepoSettings;
        globalSettings = {
          providerChain: gChain.map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            hasApiKey: entry.encryptedApiKey != null,
            maskedApiKey: entry.encryptedApiKey
              ? maskApiKey(decrypt(entry.encryptedApiKey))
              : undefined,
          })),
          aiReviewEnabled: globalRow.aiReviewEnabled,
          reviewMode: globalRow.reviewMode,
          enableSemgrep: gSettings.enableSemgrep,
          enableTrivy: gSettings.enableTrivy,
          enableCpd: gSettings.enableCpd,
          enableMemory: gSettings.enableMemory,
          customRules: (gSettings.customRules ?? []).join('\n'),
          ignorePatterns: gSettings.ignorePatterns ?? [],
        };
      }

      return c.json({
        data: {
          repoId: repo.id,
          repoFullName: repo.fullName,
          useGlobalSettings: repo.useGlobalSettings,
          aiReviewEnabled: repo.aiReviewEnabled,
          providerChain: providerChainView,
          reviewMode: repo.reviewMode,
          enableSemgrep: settings.enableSemgrep,
          enableTrivy: settings.enableTrivy,
          enableCpd: settings.enableCpd,
          enableMemory: settings.enableMemory,
          customRules: (settings.customRules ?? []).join('\n'),
          ignorePatterns: settings.ignorePatterns ?? [],
          globalSettings,
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

      const VALID_SAAS_PROVIDERS = ['anthropic', 'openai', 'google', 'github', 'qwen'];
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
        useGlobalSettings: typeof body.useGlobalSettings === 'boolean' ? body.useGlobalSettings : undefined,
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

    const validProviders = ['anthropic', 'openai', 'google', 'github', 'qwen'];
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
 * Mask an API key for safe display.
 * Shows the first 3 chars and last 4 chars: "sk-...xxxx"
 */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '***';
  const prefix = key.slice(0, 3);
  const suffix = key.slice(-4);
  return `${prefix}...${suffix}`;
}
