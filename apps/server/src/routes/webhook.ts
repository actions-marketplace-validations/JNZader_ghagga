/**
 * GitHub webhook handler.
 *
 * Processes incoming webhook events:
 *   - pull_request: Dispatch review via Inngest
 *   - installation: Track app installations
 *   - installation_repositories: Track repo additions/removals
 */

import { Hono } from 'hono';
import { verifyWebhookSignature } from '../github/client.js';
import { inngest } from '../inngest/client.js';
import {
  upsertInstallation,
  deactivateInstallation,
  upsertRepository,
  getRepoByGithubId,
} from 'ghagga-db';
import type { Database } from 'ghagga-db';
import type { RepoSettings } from 'ghagga-db';

// ─── Minimal Webhook Event Types ────────────────────────────────

interface PullRequestEvent {
  action: string;
  number: number;
  pull_request: {
    number: number;
    head: { sha: string };
    base: { ref: string };
  };
  repository: {
    id: number;
    full_name: string;
  };
  installation?: { id: number };
}

interface InstallationEvent {
  action: string;
  installation: {
    id: number;
    account: {
      login: string;
      type: string;
    };
  };
  repositories?: Array<{
    id: number;
    full_name: string;
  }>;
}

interface InstallationRepositoriesEvent {
  action: string;
  installation: {
    id: number;
    account: {
      login: string;
      type: string;
    };
  };
  repositories_added?: Array<{
    id: number;
    full_name: string;
  }>;
  repositories_removed?: Array<{
    id: number;
    full_name: string;
  }>;
}

// ─── Ignore Pattern Matching ────────────────────────────────────

/**
 * Simple glob pattern match (supports * and ** wildcards).
 * Used to check if files should be ignored.
 */
function matchesPattern(file: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(file);
}

function allFilesIgnored(files: string[], patterns: string[]): boolean {
  if (files.length === 0) return true;
  return files.every((file) =>
    patterns.some((pattern) => matchesPattern(file, pattern)),
  );
}

// ─── Route Factory ──────────────────────────────────────────────

export function createWebhookRouter(db: Database) {
  const router = new Hono();

  router.post('/webhook', async (c) => {
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error('[ghagga] GITHUB_WEBHOOK_SECRET is not set');
      return c.json({ error: 'Server misconfiguration' }, 500);
    }

    // Read raw body for signature verification
    const rawBody = await c.req.text();
    const signature = c.req.header('x-hub-signature-256') ?? null;

    // Verify signature
    const isValid = await verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValid) {
      return c.json({ error: 'Invalid signature' }, 401);
    }

    const eventType = c.req.header('x-github-event');

    if (!eventType) {
      return c.json({ error: 'Missing x-github-event header' }, 400);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return c.json({ error: 'Invalid JSON payload' }, 400);
    }

    try {
      switch (eventType) {
        case 'pull_request':
          return await handlePullRequest(c, db, payload as PullRequestEvent);

        case 'installation':
          return await handleInstallation(c, db, payload as InstallationEvent);

        case 'installation_repositories':
          return await handleInstallationRepositories(
            c,
            db,
            payload as InstallationRepositoriesEvent,
          );

        default:
          return c.json({ message: `Event ${eventType} ignored` }, 200);
      }
    } catch (error) {
      console.error(`[ghagga] Error handling ${eventType} webhook:`, error);
      return c.json({ error: 'Internal server error' }, 500);
    }
  });

  return router;
}

// ─── Event Handlers ─────────────────────────────────────────────

async function handlePullRequest(
  c: { json: (data: unknown, status?: number) => Response },
  db: Database,
  payload: PullRequestEvent,
) {
  const validActions = ['opened', 'synchronize', 'reopened'];

  if (!validActions.includes(payload.action)) {
    return c.json({ message: `Action ${payload.action} ignored` }, 200);
  }

  if (!payload.installation?.id) {
    return c.json({ error: 'Missing installation ID' }, 400);
  }

  // Look up the repository in our database
  const repo = await getRepoByGithubId(db, payload.repository.id);

  if (!repo) {
    console.warn(
      `[ghagga] Received PR webhook for unknown repo ${payload.repository.full_name}`,
    );
    return c.json({ message: 'Repository not tracked' }, 200);
  }

  // Check if all changed files match ignore patterns
  // We'll do the full file check in the Inngest function,
  // but we can skip dispatch if the repo has very broad patterns.
  // For now, dispatch unconditionally and let the pipeline handle filtering.

  const settings = repo.settings as RepoSettings;

  // Dispatch review to Inngest
  await inngest.send({
    name: 'ghagga/review.requested',
    data: {
      installationId: payload.installation.id,
      repoFullName: payload.repository.full_name,
      prNumber: payload.number,
      repositoryId: repo.id,
      llmProvider: repo.llmProvider,
      llmModel: repo.llmModel ?? 'claude-sonnet-4-20250514',
      reviewMode: repo.reviewMode,
      encryptedApiKey: repo.encryptedApiKey,
      settings: {
        enableSemgrep: settings.enableSemgrep,
        enableTrivy: settings.enableTrivy,
        enableCpd: settings.enableCpd,
        enableMemory: settings.enableMemory,
        customRules: settings.customRules,
        ignorePatterns: settings.ignorePatterns,
        reviewLevel: settings.reviewLevel,
      },
    },
  });

  console.log(
    `[ghagga] Dispatched review for ${payload.repository.full_name}#${payload.number}`,
  );

  return c.json(
    {
      message: 'Review dispatched',
      pr: payload.number,
      repo: payload.repository.full_name,
    },
    202,
  );
}

async function handleInstallation(
  c: { json: (data: unknown, status?: number) => Response },
  db: Database,
  payload: InstallationEvent,
) {
  const { action, installation } = payload;

  if (action === 'created') {
    // Upsert installation record
    const inst = await upsertInstallation(db, {
      githubInstallationId: installation.id,
      accountLogin: installation.account.login,
      accountType: installation.account.type,
    });

    // Upsert any repositories included in the installation event
    if (payload.repositories) {
      for (const repo of payload.repositories) {
        await upsertRepository(db, {
          githubRepoId: repo.id,
          installationId: inst.id,
          fullName: repo.full_name,
        });
      }
    }

    console.log(
      `[ghagga] Installation created: ${installation.account.login} (${installation.id})`,
    );

    return c.json({ message: 'Installation tracked' }, 200);
  }

  if (action === 'deleted') {
    await deactivateInstallation(db, installation.id);

    console.log(
      `[ghagga] Installation deactivated: ${installation.account.login} (${installation.id})`,
    );

    return c.json({ message: 'Installation deactivated' }, 200);
  }

  return c.json({ message: `Installation action ${action} ignored` }, 200);
}

async function handleInstallationRepositories(
  c: { json: (data: unknown, status?: number) => Response },
  db: Database,
  payload: InstallationRepositoriesEvent,
) {
  const { installation } = payload;

  // First ensure the installation exists
  const inst = await upsertInstallation(db, {
    githubInstallationId: installation.id,
    accountLogin: installation.account.login,
    accountType: installation.account.type,
  });

  // Handle added repositories
  if (payload.repositories_added) {
    for (const repo of payload.repositories_added) {
      await upsertRepository(db, {
        githubRepoId: repo.id,
        installationId: inst.id,
        fullName: repo.full_name,
      });
    }

    console.log(
      `[ghagga] Added ${payload.repositories_added.length} repos to installation ${installation.id}`,
    );
  }

  // Handle removed repositories
  if (payload.repositories_removed) {
    for (const repo of payload.repositories_removed) {
      // We mark as inactive by looking up the repo first
      const existing = await getRepoByGithubId(db, repo.id);
      if (existing) {
        // We don't have a dedicated deactivateRepository function,
        // but we can update settings to mark it
        // For now, just log — the repo will still exist but won't receive webhooks
        console.log(`[ghagga] Repo removed from installation: ${repo.full_name}`);
      }
    }
  }

  return c.json({ message: 'Repositories updated' }, 200);
}
