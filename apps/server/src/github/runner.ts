/**
 * GitHub Actions runner integration.
 *
 * Manages dispatching static analysis workflows to per-user
 * `ghagga-runner` repos and verifying callback signatures.
 *
 * Architecture: Each user who enables Actions-based static analysis
 * creates a `ghagga-runner` repo in their org/account. This module
 * discovers it, sets the callback secret, and dispatches the
 * `ghagga-analysis.yml` workflow via `workflow_dispatch`.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { logger as rootLogger } from '../lib/logger.js';

// libsodium-wrappers ESM build is broken in 0.7.16 (missing libsodium.mjs).
// Use createRequire to load the CJS version which works correctly.
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers') as typeof import('libsodium-wrappers');

const logger = rootLogger.child({ module: 'runner' });

// ─── Runner Creation Types ──────────────────────────────────────

export type RunnerErrorCode =
  | 'insufficient_scope'
  | 'already_exists'
  | 'template_unavailable'
  | 'rate_limited'
  | 'org_permission_denied'
  | 'creation_timeout'
  | 'secret_failed'
  | 'github_error';

export class RunnerCreationError extends Error {
  constructor(
    public code: RunnerErrorCode,
    message: string,
    public retryAfter?: number,
    public repoFullName?: string,
  ) {
    super(message);
    this.name = 'RunnerCreationError';
  }
}

/** Result from the createRunnerRepo() function */
export interface RunnerCreationResult {
  created: boolean;
  repoFullName: string;
  isPrivate: boolean;
  secretConfigured: boolean;
}

/** Options for createRunnerRepo() */
export interface CreateRunnerRepoOptions {
  ownerLogin: string;
  token: string;
  /** Callback secret value to set on the new repo */
  callbackSecretValue: string;
}

/** Template repository constants */
export const TEMPLATE_OWNER = 'JNZader';
export const TEMPLATE_REPO = 'ghagga-runner-template';

// ─── Types ──────────────────────────────────────────────────────

export interface WorkflowDispatchInputs {
  callbackId: string;
  repoFullName: string;
  prNumber: string;
  headSha: string;
  baseBranch: string;
  callbackUrl: string;
  callbackSecret: string;
  enableSemgrep: string;
  enableTrivy: string;
  enableCpd: string;
}

export interface DispatchParams {
  ownerLogin: string;
  repoFullName: string;
  prNumber: number;
  headSha: string;
  baseBranch: string;
  callbackUrl: string;
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  token: string;
}

export interface DiscoveredRunner {
  repoId: number;
  fullName: string;
  isPrivate: boolean;
}

// ─── In-Memory Secret Store ─────────────────────────────────────
// Each workflow dispatch gets a unique callback secret stored here.
// Secrets expire after 11 minutes (workflow_dispatch timeout is ~10min).
// Secrets are one-time use — consumed on first verification.

const CALLBACK_SECRET_TTL_MS = 11 * 60 * 1000; // 11 minutes

interface StoredSecret {
  secret: string;
  expires: number;
}

const secretStore = new Map<string, StoredSecret>();

// Cleanup expired secrets every 2 minutes
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of secretStore) {
    if (entry.expires <= now) {
      secretStore.delete(id);
    }
  }
}, 2 * 60 * 1000);

// Allow the process to exit cleanly
cleanupInterval.unref();

/**
 * Store a callback secret for a dispatch. Returns the callbackId.
 */
export function storeCallbackSecret(callbackId: string, secret: string): void {
  secretStore.set(callbackId, {
    secret,
    expires: Date.now() + CALLBACK_SECRET_TTL_MS,
  });
}

/**
 * Verify and consume a callback secret (one-time use).
 * Returns true if the HMAC signature matches, false otherwise.
 */
export function verifyAndConsumeSecret(
  callbackId: string,
  payload: string,
  signatureHeader: string,
): boolean {
  const entry = secretStore.get(callbackId);
  if (!entry) {
    logger.warn({ callbackId }, 'Callback secret not found (expired or already consumed)');
    return false;
  }

  if (entry.expires <= Date.now()) {
    secretStore.delete(callbackId);
    logger.warn({ callbackId }, 'Callback secret expired');
    return false;
  }

  // Verify HMAC-SHA256 signature
  // Expected format: sha256=<hex>
  const expectedPrefix = 'sha256=';
  if (!signatureHeader.startsWith(expectedPrefix)) {
    logger.warn({ callbackId }, 'Invalid signature format — missing sha256= prefix');
    return false;
  }

  const signatureHex = signatureHeader.slice(expectedPrefix.length);
  const computed = createHmac('sha256', entry.secret)
    .update(payload)
    .digest('hex');

  try {
    const sigBuffer = Buffer.from(signatureHex, 'hex');
    const computedBuffer = Buffer.from(computed, 'hex');

    if (sigBuffer.length !== computedBuffer.length) {
      secretStore.delete(callbackId);
      return false;
    }

    const valid = timingSafeEqual(sigBuffer, computedBuffer);

    // Always consume (one-time use)
    secretStore.delete(callbackId);

    if (!valid) {
      logger.warn({ callbackId }, 'Callback HMAC verification failed');
    }

    return valid;
  } catch {
    secretStore.delete(callbackId);
    return false;
  }
}

// ─── Runner Discovery ───────────────────────────────────────────

/**
 * Discover if the user/org has a `ghagga-runner` repository.
 * Returns repo info if found, null otherwise.
 */
export async function discoverRunnerRepo(
  ownerLogin: string,
  token: string,
): Promise<DiscoveredRunner | null> {
  const url = `https://api.github.com/repos/${ownerLogin}/ghagga-runner`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `GitHub API error discovering runner repo: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as { id: number; full_name: string; private: boolean };
  return { repoId: data.id, fullName: data.full_name, isPrivate: data.private };
}

// ─── Set Runner Secret ──────────────────────────────────────────

/**
 * Set (or update) a GitHub Actions secret on the runner repo.
 * Uses libsodium sealed box encryption as required by the GitHub API.
 */
export async function setRunnerSecret(
  repoFullName: string,
  secretName: string,
  secretValue: string,
  token: string,
): Promise<void> {
  // Step 1: Get the repo's public key for secret encryption
  const keyUrl = `https://api.github.com/repos/${repoFullName}/actions/secrets/public-key`;
  const keyResponse = await fetch(keyUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });

  if (!keyResponse.ok) {
    throw new Error(
      `GitHub API error fetching public key: ${keyResponse.status} ${keyResponse.statusText}`,
    );
  }

  const { key: publicKeyB64, key_id: keyId } = (await keyResponse.json()) as {
    key: string;
    key_id: string;
  };

  // Step 2: Encrypt the secret value with libsodium sealed box
  await sodium.ready;
  const publicKey = sodium.from_base64(publicKeyB64, sodium.base64_variants.ORIGINAL);
  const secretBytes = sodium.from_string(secretValue);
  const encrypted = sodium.crypto_box_seal(secretBytes, publicKey);
  const encryptedB64 = sodium.to_base64(encrypted, sodium.base64_variants.ORIGINAL);

  // Step 3: Set the encrypted secret via the GitHub API
  const secretUrl = `https://api.github.com/repos/${repoFullName}/actions/secrets/${secretName}`;
  const response = await fetch(secretUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      encrypted_value: encryptedB64,
      key_id: keyId,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `GitHub API error setting secret: ${response.status} ${response.statusText}`,
    );
  }
}

// ─── Dispatch Workflow ──────────────────────────────────────────

/**
 * Dispatch the `ghagga-analysis.yml` workflow on the user's runner repo.
 *
 * Generates a unique callbackId and per-dispatch secret, stores the
 * secret in-memory, sets it as a GitHub Actions secret on the runner
 * repo, and dispatches the workflow with all required inputs.
 *
 * Returns the callbackId for correlation with the callback.
 */
export async function dispatchWorkflow(params: DispatchParams): Promise<string> {
  const {
    ownerLogin,
    repoFullName,
    prNumber,
    headSha,
    baseBranch,
    callbackUrl,
    enableSemgrep,
    enableTrivy,
    enableCpd,
    token,
  } = params;

  const callbackId = randomUUID();
  const callbackSecret = randomBytes(32).toString('hex');

  // Store secret in-memory for callback verification
  storeCallbackSecret(callbackId, callbackSecret);

  // Set secrets on the runner repo before dispatching
  const runnerRepo = `${ownerLogin}/ghagga-runner`;
  await setRunnerSecret(runnerRepo, 'GHAGGA_TOKEN', token, token);
  await setRunnerSecret(runnerRepo, 'GHAGGA_CALLBACK_SECRET', callbackSecret, token);

  // Dispatch the workflow — send the raw secret so it can compute HMAC over the actual payload
  const inputs: WorkflowDispatchInputs = {
    callbackId,
    repoFullName,
    prNumber: String(prNumber),
    headSha,
    baseBranch,
    callbackUrl,
    callbackSecret,
    enableSemgrep: String(enableSemgrep),
    enableTrivy: String(enableTrivy),
    enableCpd: String(enableCpd),
  };

  const dispatchUrl = `https://api.github.com/repos/${runnerRepo}/actions/workflows/ghagga-analysis.yml/dispatches`;

  const response = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs,
    }),
  });

  if (!response.ok) {
    // Clean up the stored secret since dispatch failed
    secretStore.delete(callbackId);
    const body = await response.text();
    throw new Error(
      `GitHub API error dispatching workflow: ${response.status} ${response.statusText} — ${body}`,
    );
  }

  logger.info(
    { callbackId, runnerRepo, repoFullName, prNumber },
    'Dispatched runner workflow',
  );

  return callbackId;
}

// ─── Runner Creation ────────────────────────────────────────────

const creationLogger = rootLogger.child({ module: 'runner-creation' });

const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 15; // 30 seconds total

/**
 * Create a ghagga-runner repo from the template and configure its secret.
 *
 * Steps:
 * 1. Check if repo already exists via discoverRunnerRepo()
 * 2. Call GitHub Template API to generate {owner}/ghagga-runner
 * 3. Poll until repo is accessible (max 15 attempts, 2s interval)
 * 4. Set GHAGGA_CALLBACK_SECRET via setRunnerSecret()
 *
 * @throws {RunnerCreationError} with specific error codes
 */
export async function createRunnerRepo(
  options: CreateRunnerRepoOptions,
): Promise<RunnerCreationResult> {
  const { ownerLogin, token, callbackSecretValue } = options;
  const repoFullName = `${ownerLogin}/ghagga-runner`;

  // Step 1: Check if repo already exists
  const existing = await discoverRunnerRepo(ownerLogin, token);
  if (existing) {
    throw new RunnerCreationError(
      'already_exists',
      'Runner repo already exists',
      undefined,
      repoFullName,
    );
  }

  // Step 2: Create from template
  const generateUrl = `https://api.github.com/repos/${TEMPLATE_OWNER}/${TEMPLATE_REPO}/generate`;
  const generateResponse = await fetch(generateUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({
      owner: ownerLogin,
      name: 'ghagga-runner',
      description:
        'GHAGGA static analysis runner — auto-created by the GHAGGA Dashboard',
      include_all_branches: false,
      private: false,
    }),
  });

  // Handle error responses
  if (!generateResponse.ok) {
    const status = generateResponse.status;

    if (status === 422) {
      // Name conflict — repo was created between our check and the generate call
      throw new RunnerCreationError(
        'already_exists',
        'Runner repo already exists',
        undefined,
        repoFullName,
      );
    }

    if (status === 403) {
      // Distinguish rate limiting from insufficient scope
      const remaining = generateResponse.headers.get('X-RateLimit-Remaining');
      if (remaining === '0') {
        const resetHeader = generateResponse.headers.get('X-RateLimit-Reset');
        const retryAfter = resetHeader
          ? Math.max(
              0,
              parseInt(resetHeader, 10) - Math.floor(Date.now() / 1000),
            )
          : 60;
        throw new RunnerCreationError(
          'rate_limited',
          'GitHub API rate limit exceeded',
          retryAfter,
        );
      }

      // Check if this is an org permission issue
      const body = await generateResponse.text();
      if (body.includes('organization') || body.includes('permission')) {
        throw new RunnerCreationError(
          'org_permission_denied',
          `You don't have permission to create repositories in ${ownerLogin}`,
        );
      }

      throw new RunnerCreationError(
        'insufficient_scope',
        "Your token doesn't have permission to create repositories. Please re-authenticate.",
      );
    }

    if (status === 404) {
      throw new RunnerCreationError(
        'template_unavailable',
        'The runner template is temporarily unavailable. Please try again later or contact support.',
      );
    }

    const body = await generateResponse.text();
    throw new RunnerCreationError(
      'github_error',
      `GitHub API error: ${status} — ${body}`,
    );
  }

  const createData = (await generateResponse.json()) as {
    full_name: string;
    private: boolean;
  };

  // Step 3: Poll until repo is accessible
  let repoReady = false;
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    try {
      const discovered = await discoverRunnerRepo(ownerLogin, token);
      if (discovered) {
        repoReady = true;
        break;
      }
    } catch {
      // Ignore errors during polling — repo may not be ready yet
    }
  }

  if (!repoReady) {
    throw new RunnerCreationError(
      'creation_timeout',
      'Repository was created but is not accessible yet. Please try again in a few moments.',
      undefined,
      repoFullName,
    );
  }

  // Step 4: Set GHAGGA_CALLBACK_SECRET
  let secretConfigured = true;
  try {
    await setRunnerSecret(
      repoFullName,
      'GHAGGA_CALLBACK_SECRET',
      callbackSecretValue,
      token,
    );
  } catch (err) {
    creationLogger.error(
      { err, repoFullName },
      'Failed to set runner secret after repo creation',
    );
    secretConfigured = false;
  }

  creationLogger.info(
    { repoFullName, secretConfigured, isPrivate: createData.private },
    'Runner repo created',
  );

  return {
    created: true,
    repoFullName: createData.full_name,
    isPrivate: createData.private,
    secretConfigured,
  };
}
