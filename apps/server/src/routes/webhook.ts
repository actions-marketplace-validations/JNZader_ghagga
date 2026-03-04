/**
 * GitHub webhook handler.
 *
 * Processes incoming webhook events:
 *   - pull_request: Dispatch review via Inngest
 *   - issue_comment: Re-trigger review on "ghagga review" keyword
 *   - installation: Track app installations
 *   - installation_repositories: Track repo additions/removals
 */

import { Hono } from 'hono';
import {
  verifyWebhookSignature,
  addCommentReaction,
  getInstallationToken,
} from '../github/client.js';
import { ensureRunnerRepo, deleteRunnerRepo } from '../github/runner.js';
import { inngest } from '../inngest/client.js';
import { logger as rootLogger } from '../lib/logger.js';
import {
  upsertInstallation,
  deactivateInstallation,
  upsertRepository,
  getRepoByGithubId,
  getEffectiveRepoSettings,
} from 'ghagga-db';
import type { Database } from 'ghagga-db';

const logger = rootLogger.child({ module: 'webhook' });

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

interface IssueCommentEvent {
  action: string;
  comment: {
    id: number;
    body: string;
    user: {
      login: string;
      type: string; // "User" | "Bot"
    };
    author_association: string;
  };
  issue: {
    number: number;
    pull_request?: { url: string }; // Present only if the issue is a PR
  };
  repository: {
    id: number;
    full_name: string;
  };
  installation?: { id: number };
}

/** Associations allowed to trigger reviews via comment keyword */
const ALLOWED_ASSOCIATIONS = new Set([
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
  'CONTRIBUTOR',
  'FIRST_TIMER',
  'FIRST_TIME_CONTRIBUTOR',
]);

/** Regex to detect "ghagga review" keyword (case-insensitive, allows leading whitespace/punctuation) */
const REVIEW_TRIGGER_REGEX = /\bghagga\s+review\b/i;

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
      logger.error('GITHUB_WEBHOOK_SECRET is not set');
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

        case 'issue_comment':
          return await handleIssueComment(c, db, payload as IssueCommentEvent);

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
      logger.error({ eventType, error: String(error) }, 'Error handling webhook event');
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
    logger.warn({ repo: payload.repository.full_name }, 'Received PR webhook for unknown repo');
    return c.json({ message: 'Repository not tracked' }, 200);
  }

  // Check if all changed files match ignore patterns
  // We'll do the full file check in the Inngest function,
  // but we can skip dispatch if the repo has very broad patterns.
  // For now, dispatch unconditionally and let the pipeline handle filtering.

  // Resolve effective settings (global vs per-repo)
  const effective = await getEffectiveRepoSettings(db, repo);

  // Dispatch review to Inngest
  await inngest.send({
    name: 'ghagga/review.requested',
    data: {
      installationId: payload.installation.id,
      repoFullName: payload.repository.full_name,
      prNumber: payload.number,
      repositoryId: repo.id,
      // PR context for runner dispatch
      headSha: payload.pull_request.head.sha,
      baseBranch: payload.pull_request.base.ref,
      // Resolved provider chain (from global or repo)
      providerChain: effective.providerChain,
      aiReviewEnabled: effective.aiReviewEnabled,
      // Legacy flat fields (kept for backward compat during transition)
      llmProvider: repo.llmProvider,
      llmModel: repo.llmModel ?? 'gpt-4o-mini',
      reviewMode: effective.reviewMode,
      encryptedApiKey: repo.encryptedApiKey,
      settings: {
        enableSemgrep: effective.settings.enableSemgrep,
        enableTrivy: effective.settings.enableTrivy,
        enableCpd: effective.settings.enableCpd,
        enableMemory: effective.settings.enableMemory,
        customRules: effective.settings.customRules,
        ignorePatterns: effective.settings.ignorePatterns,
        reviewLevel: effective.settings.reviewLevel,
      },
    },
  });

  logger.info({ repo: payload.repository.full_name, pr: payload.number }, 'Review dispatched');

  return c.json(
    {
      message: 'Review dispatched',
      pr: payload.number,
      repo: payload.repository.full_name,
    },
    202,
  );
}

async function handleIssueComment(
  c: { json: (data: unknown, status?: number) => Response },
  db: Database,
  payload: IssueCommentEvent,
) {
  // Only handle new comments (not edits or deletions)
  if (payload.action !== 'created') {
    return c.json({ message: `Comment action ${payload.action} ignored` }, 200);
  }

  // Only handle comments on PRs (not regular issues)
  if (!payload.issue.pull_request) {
    return c.json({ message: 'Comment is not on a pull request' }, 200);
  }

  // Skip bot comments to prevent self-triggering loops
  if (payload.comment.user.type === 'Bot') {
    return c.json({ message: 'Bot comment ignored' }, 200);
  }

  // Check for the trigger keyword
  if (!REVIEW_TRIGGER_REGEX.test(payload.comment.body)) {
    return c.json({ message: 'No review trigger keyword found' }, 200);
  }

  // Check author association (only contributors/members can trigger)
  if (!ALLOWED_ASSOCIATIONS.has(payload.comment.author_association)) {
    logger.info(
      { user: payload.comment.user.login, association: payload.comment.author_association, repo: payload.repository.full_name },
      'Review trigger rejected: insufficient permissions',
    );
    return c.json({ message: 'Insufficient permissions to trigger review' }, 200);
  }

  if (!payload.installation?.id) {
    return c.json({ error: 'Missing installation ID' }, 400);
  }

  // Look up the repository
  const repo = await getRepoByGithubId(db, payload.repository.id);

  if (!repo) {
    logger.warn({ repo: payload.repository.full_name }, 'Comment trigger for unknown repo');
    return c.json({ message: 'Repository not tracked' }, 200);
  }

  // React with 👀 to acknowledge the trigger
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY;
  const [owner, repoName] = payload.repository.full_name.split('/') as [string, string];

  if (appId && privateKey) {
    try {
      const token = await getInstallationToken(payload.installation.id, appId, privateKey);
      await addCommentReaction(owner, repoName, payload.comment.id, 'eyes', token);
    } catch (error) {
      // Non-critical — don't fail the review
      logger.warn({ repo: payload.repository.full_name, error: String(error) }, 'Failed to add acknowledgment reaction');
    }
  }

  // Resolve effective settings and dispatch review
  const effective = await getEffectiveRepoSettings(db, repo);
  const prNumber = payload.issue.number;

  await inngest.send({
    name: 'ghagga/review.requested',
    data: {
      installationId: payload.installation.id,
      repoFullName: payload.repository.full_name,
      prNumber,
      repositoryId: repo.id,
      triggerCommentId: payload.comment.id,
      providerChain: effective.providerChain,
      aiReviewEnabled: effective.aiReviewEnabled,
      llmProvider: repo.llmProvider,
      llmModel: repo.llmModel ?? 'gpt-4o-mini',
      reviewMode: effective.reviewMode,
      encryptedApiKey: repo.encryptedApiKey,
      settings: {
        enableSemgrep: effective.settings.enableSemgrep,
        enableTrivy: effective.settings.enableTrivy,
        enableCpd: effective.settings.enableCpd,
        enableMemory: effective.settings.enableMemory,
        customRules: effective.settings.customRules,
        ignorePatterns: effective.settings.ignorePatterns,
        reviewLevel: effective.settings.reviewLevel,
      },
    },
  });

  logger.info(
    { repo: payload.repository.full_name, pr: prNumber, triggeredBy: payload.comment.user.login },
    'Review re-triggered via comment',
  );

  return c.json(
    {
      message: 'Review dispatched (comment trigger)',
      pr: prNumber,
      repo: payload.repository.full_name,
      triggeredBy: payload.comment.user.login,
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

    logger.info(
      { account: installation.account.login, installationId: installation.id },
      'Installation created',
    );

    // Create runner repo for static analysis (fire-and-forget)
    const appId = process.env.GITHUB_APP_ID!;
    const privateKey = process.env.GITHUB_PRIVATE_KEY!;
    ensureRunnerRepo(installation.account.login, installation.id, appId, privateKey)
      .then((result) => {
        logger.info({ owner: installation.account.login, created: result.created }, 'Runner repo ensured');
      })
      .catch((err) => {
        logger.warn({ owner: installation.account.login, error: err instanceof Error ? err.message : String(err) }, 'Runner repo creation failed');
      });

    return c.json({ message: 'Installation tracked' }, 200);
  }

  if (action === 'deleted') {
    await deactivateInstallation(db, installation.id);

    logger.info(
      { account: installation.account.login, installationId: installation.id },
      'Installation deactivated',
    );

    // Delete runner repo (fire-and-forget, best-effort)
    const appId = process.env.GITHUB_APP_ID!;
    const privateKey = process.env.GITHUB_PRIVATE_KEY!;
    deleteRunnerRepo(installation.account.login, installation.id, appId, privateKey)
      .catch((err) => {
        logger.warn({ owner: installation.account.login, error: err instanceof Error ? err.message : String(err) }, 'Runner repo deletion failed');
      });

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

    logger.info(
      { installationId: installation.id, count: payload.repositories_added.length },
      'Repositories added to installation',
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
        logger.info({ repo: repo.full_name, installationId: installation.id }, 'Repo removed from installation');
      }
    }
  }

  return c.json({ message: 'Repositories updated' }, 200);
}
