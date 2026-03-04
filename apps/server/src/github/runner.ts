/**
 * GitHub Actions runner repo management.
 *
 * Manages per-user runner repos under the central org (JNZader-Vault) that
 * execute static analysis tools (Semgrep, Trivy, PMD/CPD) via GitHub Actions.
 * This offloads the memory-heavy tools from the Render server (512MB) to
 * Actions runners (7GB).
 *
 * Repo naming: JNZader-Vault/runner-{user}
 *
 * Dual-token pattern:
 *   - runnerToken: from RUNNER_INSTALLATION_ID, used for all runner-repo operations
 *   - userToken: from per-user installationId, used for cloning user code
 *
 * Public API:
 *   - ensureRunnerRepo(): Create runner repo + workflow if missing, re-commit if tampered
 *   - dispatchAnalysis(): Trigger static analysis via repository_dispatch
 *   - deleteRunnerRepo(): Remove runner repo on App uninstall (best-effort)
 */

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sodium from 'libsodium-wrappers';
import { getInstallationToken } from './client.js';
import { logger as rootLogger } from '../lib/logger.js';

const logger = rootLogger.child({ module: 'runner' });

// ─── Constants ──────────────────────────────────────────────────

const RUNNER_ORG = process.env.RUNNER_ORG ?? 'JNZader-Vault';
const RUNNER_INSTALLATION_ID = Number(process.env.RUNNER_INSTALLATION_ID);

function runnerRepoName(owner: string): string {
  return `runner-${owner}`;
}

function runnerRepoFullName(owner: string): string {
  return `${RUNNER_ORG}/${runnerRepoName(owner)}`;
}

const WORKFLOW_PATH = '.github/workflows/ghagga-analysis.yml';
const GITHUB_API = 'https://api.github.com';
const API_HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'Content-Type': 'application/json',
};

// Load canonical workflow template and compute its hash at module load time
const __dirname = dirname(fileURLToPath(import.meta.url));
const CANONICAL_WORKFLOW = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'templates', 'runner-workflow.yml'),
  'utf8',
);
const CANONICAL_WORKFLOW_HASH = createHash('sha256')
  .update(CANONICAL_WORKFLOW)
  .digest('hex');

// ─── Public API ─────────────────────────────────────────────────

/**
 * Ensure the runner repo exists with the correct workflow file.
 * Creates repo if missing, re-commits workflow if tampered, no-ops if valid.
 */
export async function ensureRunnerRepo(
  owner: string,
  installationId: number,
  appId: string,
  privateKey: string,
): Promise<{ created: boolean; existed: boolean }> {
  if (!RUNNER_INSTALLATION_ID) {
    throw new Error('RUNNER_INSTALLATION_ID not configured');
  }
  const token = await getInstallationToken(RUNNER_INSTALLATION_ID, appId, privateKey);

  const exists = await repoExists(owner, token);

  if (!exists) {
    logger.info({ owner, repo: runnerRepoFullName(owner) }, 'Creating runner repo');
    await createRepo(owner, token);

    // Wait for GitHub to propagate the repo to the installation (longer delay)
    logger.info({ owner, repo: runnerRepoFullName(owner) }, 'Waiting for GitHub to propagate repo to installation...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // IMPORTANT: GitHub auto-adds the new repo to the installation, but the
    // current token was issued BEFORE the repo was added. We need a fresh token
    // that includes the new repo in its scope.
    logger.info({ owner, repo: runnerRepoFullName(owner) }, 'Refreshing token after repo creation');
    const freshToken = await getInstallationToken(RUNNER_INSTALLATION_ID, appId, privateKey);

    // Retry commit with exponential backoff (GitHub propagation can be slow)
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await commitWorkflowFile(owner, freshToken);
        await setLogRetention(owner, freshToken);
        return { created: true, existed: false };
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ owner, repo: runnerRepoFullName(owner), attempt, error: errorMsg }, 'Workflow commit failed, retrying...');
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
        }
      }
    }
    // If all retries fail, throw the error
    throw new Error(`Failed to commit workflow after ${maxRetries} attempts`);
  }

  // Repo exists — verify workflow integrity
  const integrity = await verifyWorkflowIntegrity(owner, token);
  if (!integrity.valid) {
    logger.warn({ owner, repo: runnerRepoFullName(owner) }, 'Workflow tampered — re-committing canonical version');
    await commitWorkflowFile(owner, token, integrity.existingSha);
  }

  return { created: false, existed: true };
}

/**
 * Dispatch static analysis to the runner repo via repository_dispatch.
 * Sets the installation token as a repo secret, verifies workflow integrity,
 * then sends the dispatch event.
 */
export async function dispatchAnalysis(
  owner: string,
  installationId: number,
  appId: string,
  privateKey: string,
  context: {
    repoFullName: string;
    prNumber: number;
    headSha: string;
    baseBranch: string;
    toolSettings: { enableSemgrep: boolean; enableTrivy: boolean; enableCpd: boolean };
    callbackUrl: string;
  },
): Promise<
  | { dispatched: true; callbackId: string; callbackSignature: string }
  | { dispatched: false; reason: string }
> {
  if (!RUNNER_INSTALLATION_ID) {
    return { dispatched: false, reason: 'RUNNER_INSTALLATION_ID not configured' };
  }
  const runnerToken = await getInstallationToken(RUNNER_INSTALLATION_ID, appId, privateKey);
  const userToken = await getInstallationToken(installationId, appId, privateKey);

  // Ensure runner repo exists and workflow is valid
  const exists = await repoExists(owner, runnerToken);
  if (!exists) {
    try {
      await createRepo(owner, runnerToken);
      await commitWorkflowFile(owner, runnerToken);
      await setLogRetention(owner, runnerToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ owner, repo: runnerRepoFullName(owner), error: msg }, 'Failed to create runner repo');
      return { dispatched: false, reason: `Failed to create runner repo: ${msg}` };
    }
  } else {
    // Verify workflow integrity
    const integrity = await verifyWorkflowIntegrity(owner, runnerToken);
    if (!integrity.valid) {
      logger.warn({ owner, repo: runnerRepoFullName(owner) }, 'Workflow tampered — re-committing before dispatch');
      try {
        await commitWorkflowFile(owner, runnerToken, integrity.existingSha);
        // Re-verify after commit
        const recheck = await verifyWorkflowIntegrity(owner, runnerToken);
        if (!recheck.valid) {
          return { dispatched: false, reason: 'Workflow integrity check failed after re-commit' };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { dispatched: false, reason: `Workflow re-commit failed: ${msg}` };
      }
    }
  }

  // Set secrets: userToken for cloning user code, runnerToken for runner repo operations
  try {
    await setRepoSecret(owner, 'GHAGGA_TOKEN', userToken, runnerToken);
    await setRepoSecret(owner, 'RUNNER_TOKEN', runnerToken, runnerToken);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ owner, error: msg }, 'Failed to set repo secrets');
    return { dispatched: false, reason: `Failed to set token secret: ${msg}` };
  }

  // Generate callback ID and HMAC signature
  const callbackId = randomUUID();
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return { dispatched: false, reason: 'GITHUB_WEBHOOK_SECRET not configured' };
  }
  const callbackSignature = 'sha256=' + createHmac('sha256', webhookSecret)
    .update(callbackId)
    .digest('hex');

  // Send repository_dispatch
  const dispatchRes = await fetch(
    `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/dispatches`,
    {
      method: 'POST',
      headers: { ...API_HEADERS, Authorization: `Bearer ${runnerToken}` },
      body: JSON.stringify({
        event_type: 'ghagga-analysis',
        client_payload: {
          callbackId,
          repoFullName: context.repoFullName,
          prNumber: context.prNumber,
          headSha: context.headSha,
          baseBranch: context.baseBranch,
          toolSettings: context.toolSettings,
          callbackUrl: context.callbackUrl,
          callbackSignature,
        },
      }),
    },
  );

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text();
    logger.error({ owner, status: dispatchRes.status, body: text }, 'Dispatch failed');
    return { dispatched: false, reason: `Dispatch failed: ${dispatchRes.status}` };
  }

  logger.info({ owner, callbackId, prNumber: context.prNumber, repo: runnerRepoFullName(owner) }, 'Analysis dispatched');
  return { dispatched: true, callbackId, callbackSignature };
}

/**
 * Attempt to delete the runner repo (best-effort, for uninstall).
 */
export async function deleteRunnerRepo(
  owner: string,
  installationId: number,
  appId: string,
  privateKey: string,
): Promise<void> {
  if (!RUNNER_INSTALLATION_ID) {
    logger.warn({ owner }, 'RUNNER_INSTALLATION_ID not configured — skipping runner repo deletion');
    return;
  }
  try {
    const token = await getInstallationToken(RUNNER_INSTALLATION_ID, appId, privateKey);
    const res = await fetch(`${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}`, {
      method: 'DELETE',
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    });
    if (res.ok || res.status === 404) {
      logger.info({ owner, repo: runnerRepoFullName(owner) }, 'Runner repo deleted');
    } else {
      logger.warn({ owner, repo: runnerRepoFullName(owner), status: res.status }, 'Failed to delete runner repo');
    }
  } catch (err) {
    logger.warn({ owner, repo: runnerRepoFullName(owner), error: err instanceof Error ? err.message : String(err) }, 'Runner repo deletion error');
  }
}

// ─── Internal Helpers ───────────────────────────────────────────

/** Check if runner repo exists. */
async function repoExists(owner: string, token: string): Promise<boolean> {
  const res = await fetch(`${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}`, {
    headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

/** Create public runner repo in the runner org. */
async function createRepo(owner: string, token: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/orgs/${RUNNER_ORG}/repos`, {
    method: 'POST',
    headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: runnerRepoName(owner),
      description: `GHAGGA AI Code Review — static analysis runner for ${owner} (auto-managed, do not modify)`,
      private: false,
      auto_init: true,
      has_issues: false,
      has_projects: false,
      has_wiki: false,
    }),
  });

  if (!res.ok && res.status !== 422) {
    // 422 = repo already exists (race condition), which is fine
    throw new Error(`Failed to create repo: ${res.status} ${await res.text()}`);
  }

  // Brief delay for GitHub to finalize repo creation
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

/** Commit or update the workflow file. */
async function commitWorkflowFile(
  owner: string,
  token: string,
  existingSha?: string,
): Promise<void> {
  const content = Buffer.from(CANONICAL_WORKFLOW).toString('base64');
  const body: Record<string, string> = {
    message: existingSha
      ? 'chore: update GHAGGA analysis workflow (auto-managed)'
      : 'chore: initialize GHAGGA analysis workflow',
    content,
  };
  if (existingSha) {
    body.sha = existingSha;
  }

  const res = await fetch(
    `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/contents/${WORKFLOW_PATH}`,
    {
      method: 'PUT',
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    throw new Error(`Failed to commit workflow: ${res.status} ${await res.text()}`);
  }
}

/** Verify workflow file SHA-256 hash matches canonical. */
async function verifyWorkflowIntegrity(
  owner: string,
  token: string,
): Promise<{ valid: boolean; existingSha?: string }> {
  const res = await fetch(
    `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/contents/${WORKFLOW_PATH}`,
    {
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    },
  );

  if (res.status === 404) {
    // Workflow file doesn't exist — invalid, needs to be created
    return { valid: false };
  }

  if (!res.ok) {
    // API error — treat as valid to avoid blocking dispatches on transient errors
    logger.warn({ owner, status: res.status }, 'Could not verify workflow integrity');
    return { valid: true };
  }

  const data = (await res.json()) as { content: string; sha: string };
  const remoteContent = Buffer.from(data.content, 'base64').toString('utf8');
  const remoteHash = createHash('sha256').update(remoteContent).digest('hex');

  if (remoteHash === CANONICAL_WORKFLOW_HASH) {
    return { valid: true };
  }

  return { valid: false, existingSha: data.sha };
}

/** Set a repository secret using sealed box encryption. */
async function setRepoSecret(
  owner: string,
  secretName: string,
  secretValue: string,
  token: string,
): Promise<void> {
  // Ensure libsodium is ready
  await sodium.ready;

  // 1. Get the repo's public key
  const keyRes = await fetch(
    `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/actions/secrets/public-key`,
    {
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
    },
  );

  if (!keyRes.ok) {
    throw new Error(`Failed to get repo public key: ${keyRes.status}`);
  }

  const { key, key_id } = (await keyRes.json()) as { key: string; key_id: string };

  // 2. Encrypt with libsodium sealed box
  const pubKeyBytes = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
  const messageBytes = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(messageBytes, pubKeyBytes);
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  // 3. PUT the encrypted secret
  const putRes = await fetch(
    `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/actions/secrets/${secretName}`,
    {
      method: 'PUT',
      headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        encrypted_value: encryptedB64,
        key_id,
      }),
    },
  );

  if (!putRes.ok) {
    throw new Error(`Failed to set secret ${secretName}: ${putRes.status}`);
  }
}

/**
 * Set log retention to minimum (1 day) and harden repo settings.
 *
 * This is a belt-and-suspenders security measure — the workflow already
 * deletes its own logs after each run, but if that step fails, logs
 * should auto-expire in 1 day instead of GitHub's default 90 days.
 *
 * Non-fatal: if any call fails (e.g., free-tier account without the
 * retention API, or insufficient permissions), repo creation still
 * succeeds. The explicit log deletion in the workflow is the primary
 * protection; this is just the safety net.
 */
async function setLogRetention(owner: string, token: string): Promise<void> {
  // 1. Set artifact and log retention to 1 day (minimum)
  //    API: PUT /repos/{owner}/{repo}/actions/permissions/artifact-and-log-retention
  //    Note: This may require GitHub Pro/Team/Enterprise — free accounts may get 403/404.
  try {
    const retentionRes = await fetch(
      `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/actions/permissions/artifact-and-log-retention`,
      {
        method: 'PUT',
        headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({ days: 1 }),
      },
    );

    if (retentionRes.ok || retentionRes.status === 204) {
      logger.info({ owner }, 'Log retention set to 1 day');
    } else {
      // 403 = not available on this plan, 404 = endpoint not found
      logger.warn(
        { owner, status: retentionRes.status },
        'Could not set log retention to 1 day (may require GitHub Pro/Team plan) — workflow log deletion is the primary protection',
      );
    }
  } catch (err) {
    logger.warn(
      { owner, error: err instanceof Error ? err.message : String(err) },
      'Failed to set log retention (non-fatal)',
    );
  }

  // 2. Restrict Actions permissions: only allow selected actions (reduce attack surface)
  try {
    const permRes = await fetch(
      `${GITHUB_API}/repos/${RUNNER_ORG}/${runnerRepoName(owner)}/actions/permissions`,
      {
        method: 'PUT',
        headers: { ...API_HEADERS, Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          enabled: true,
          allowed_actions: 'selected',
        }),
      },
    );

    if (!permRes.ok && permRes.status !== 204) {
      logger.warn(
        { owner, status: permRes.status },
        'Could not restrict Actions permissions (non-fatal)',
      );
    }
  } catch {
    // Non-fatal — best effort hardening
    logger.warn({ owner }, 'Failed to set Actions permissions (non-fatal)');
  }
}
