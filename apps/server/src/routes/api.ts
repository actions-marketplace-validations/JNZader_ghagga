/**
 * Dashboard API routes.
 *
 * All routes require authentication via the auth middleware.
 * Users can only access data from installations they belong to.
 */

import type { SaaSProvider } from 'ghagga-core';
import type { Database, DbProviderChainEntry, RepoSettings } from 'ghagga-db';
import {
  clearAllMemoryObservations,
  clearEmptyMemorySessions,
  clearMemoryObservationsByProject,
  DEFAULT_REPO_SETTINGS,
  decrypt,
  deleteMemoryObservation,
  deleteMemorySession,
  encrypt,
  getInstallationById,
  getInstallationSettings,
  getObservationsBySession,
  getRepoByFullName,
  getReposByInstallationId,
  getReviewStats,
  getReviewsByDay,
  getReviewsByRepoId,
  getSessionsByProject,
  updateRepoSettings,
  upsertInstallationSettings,
} from 'ghagga-db';
import { Hono } from 'hono';
import {
  createRunnerRepo,
  discoverRunnerRepo,
  RunnerCreationError,
  setRunnerSecret,
} from '../github/runner.js';
import { logger as rootLogger } from '../lib/logger.js';
import { validateProviderKey } from '../lib/provider-models.js';
import type { AuthUser } from '../middleware/auth.js';

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

    if (Number.isNaN(installationId)) {
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
      logger.error(
        { err, installationId, user: user.githubLogin },
        'Failed to fetch installation settings',
      );
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
        enableSemgrep:
          typeof body.enableSemgrep === 'boolean'
            ? body.enableSemgrep
            : currentSettings.enableSemgrep,
        enableTrivy:
          typeof body.enableTrivy === 'boolean' ? body.enableTrivy : currentSettings.enableTrivy,
        enableCpd: typeof body.enableCpd === 'boolean' ? body.enableCpd : currentSettings.enableCpd,
        enableMemory:
          typeof body.enableMemory === 'boolean' ? body.enableMemory : currentSettings.enableMemory,
        customRules:
          typeof body.customRules === 'string'
            ? (body.customRules as string)
                .split('\n')
                .map((r: string) => r.trim())
                .filter(Boolean)
            : currentSettings.customRules,
        ignorePatterns: Array.isArray(body.ignorePatterns)
          ? (body.ignorePatterns as string[])
          : currentSettings.ignorePatterns,
        reviewLevel:
          typeof body.reviewLevel === 'string'
            ? (body.reviewLevel as RepoSettings['reviewLevel'])
            : currentSettings.reviewLevel,
      };

      await upsertInstallationSettings(db, installationId, {
        providerChain: mergedChain,
        aiReviewEnabled:
          typeof body.aiReviewEnabled === 'boolean' ? body.aiReviewEnabled : undefined,
        reviewMode: typeof body.reviewMode === 'string' ? body.reviewMode : undefined,
        settings: settingsUpdate,
      });

      logger.info(
        { installationId, user: user.githubLogin, chainLength: mergedChain.length },
        'Installation settings updated',
      );
      return c.json({ message: 'Installation settings updated' });
    } catch (err) {
      logger.error(
        { err, installationId, user: user.githubLogin },
        'Failed to update installation settings',
      );
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
      let globalSettings;
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
        enableSemgrep:
          typeof body.enableSemgrep === 'boolean'
            ? body.enableSemgrep
            : currentSettings.enableSemgrep,
        enableTrivy:
          typeof body.enableTrivy === 'boolean' ? body.enableTrivy : currentSettings.enableTrivy,
        enableCpd: typeof body.enableCpd === 'boolean' ? body.enableCpd : currentSettings.enableCpd,
        enableMemory:
          typeof body.enableMemory === 'boolean' ? body.enableMemory : currentSettings.enableMemory,
        customRules:
          typeof body.customRules === 'string'
            ? (body.customRules as string)
                .split('\n')
                .map((r: string) => r.trim())
                .filter(Boolean)
            : currentSettings.customRules,
        ignorePatterns: Array.isArray(body.ignorePatterns)
          ? (body.ignorePatterns as string[])
          : currentSettings.ignorePatterns,
        reviewLevel:
          typeof body.reviewLevel === 'string'
            ? (body.reviewLevel as RepoSettings['reviewLevel'])
            : currentSettings.reviewLevel,
      };

      await updateRepoSettings(db, repo.id, {
        settings: settingsUpdate,
        reviewMode: typeof body.reviewMode === 'string' ? body.reviewMode : undefined,
        aiReviewEnabled:
          typeof body.aiReviewEnabled === 'boolean' ? body.aiReviewEnabled : undefined,
        providerChain: mergedChain,
        useGlobalSettings:
          typeof body.useGlobalSettings === 'boolean' ? body.useGlobalSettings : undefined,
      });

      logger.info(
        { repo: repoFullName, user: user.githubLogin, chainLength: mergedChain.length },
        'Settings updated',
      );
      return c.json({ message: 'Settings updated' });
    } catch (err) {
      logger.error(
        { err, repo: repoFullName, user: user.githubLogin },
        'Failed to update settings',
      );
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
      return c.json(
        { error: 'Ollama is not available in the SaaS dashboard. Use CLI or Action instead.' },
        400,
      );
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

    if (Number.isNaN(sessionId)) {
      return c.json({ error: 'Invalid session ID' }, 400);
    }

    // Note: For a more thorough authorization check, we'd look up
    // the session's project and verify installation access. For now,
    // we rely on the auth middleware ensuring the user is authenticated.
    const observations = await getObservationsBySession(db, sessionId);

    return c.json({ data: observations });
  });

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
        switch (err.code) {
          case 'insufficient_scope':
            return c.json({ error: 'insufficient_scope', message: err.message }, 403);
          case 'already_exists':
            return c.json({ error: 'already_exists', repoFullName: err.repoFullName }, 409);
          case 'rate_limited':
            return c.json({ error: 'rate_limited', retryAfter: err.retryAfter }, 429);
          case 'template_unavailable':
            logger.error('Runner template repo JNZader/ghagga-runner-template is not accessible');
            return c.json({ error: 'template_unavailable', message: err.message }, 502);
          case 'org_permission_denied':
            return c.json({ error: 'org_permission_denied', message: err.message }, 403);
          case 'creation_timeout':
            return c.json(
              {
                error: 'github_error',
                message: 'Repository creation timed out. Please check GitHub and try again.',
              },
              502,
            );
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
            return c.json({ error: 'github_error', message: err.message }, 502);
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
      logger.error({ err, user: user.githubLogin }, 'Failed to purge all memory observations');
      return c.json({ error: 'Failed to purge all memory observations' }, 500);
    }
  });

  // ── DELETE /api/memory/observations/:id ────────────────────────
  router.delete('/api/memory/observations/:id', async (c) => {
    const user = c.get('user') as AuthUser;
    const id = parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid observation ID' }, 400);
    }

    try {
      for (const installationId of user.installationIds) {
        const deleted = await deleteMemoryObservation(db, installationId, id);
        if (deleted) {
          return c.json({ data: { deleted: true } });
        }
      }
      return c.json({ error: 'Observation not found' }, 404);
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to delete memory observation');
      return c.json({ error: 'Failed to delete memory observation' }, 500);
    }
  });

  // ── DELETE /api/memory/projects/:project/observations ──────────
  router.delete('/api/memory/projects/:project/observations', async (c) => {
    const user = c.get('user') as AuthUser;
    const project = decodeURIComponent(c.req.param('project'));

    try {
      const repo = await getRepoByFullName(db, project);
      if (!repo) {
        return c.json({ error: 'Repository not found' }, 404);
      }

      if (!user.installationIds.includes(repo.installationId)) {
        return c.json({ error: 'Forbidden' }, 403);
      }

      const cleared = await clearMemoryObservationsByProject(db, repo.installationId, project);
      return c.json({ data: { cleared } });
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to clear project memory observations');
      return c.json({ error: 'Failed to clear project memory observations' }, 500);
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
      logger.error({ err, user: user.githubLogin }, 'Failed to cleanup empty memory sessions');
      return c.json({ error: 'Failed to cleanup empty memory sessions' }, 500);
    }
  });

  // ── DELETE /api/memory/sessions/:id ───────────────────────────
  router.delete('/api/memory/sessions/:id', async (c) => {
    const user = c.get('user') as AuthUser;
    const id = parseInt(c.req.param('id'), 10);

    if (Number.isNaN(id)) {
      return c.json({ error: 'Invalid session ID' }, 400);
    }

    try {
      for (const installationId of user.installationIds) {
        const { deleted } = await deleteMemorySession(db, installationId, id);
        if (deleted) {
          return c.json({ data: { deleted: true } });
        }
      }
      return c.json({ error: 'Session not found' }, 404);
    } catch (err) {
      logger.error({ err, user: user.githubLogin }, 'Failed to delete memory session');
      return c.json({ error: 'Failed to delete memory session' }, 500);
    }
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
