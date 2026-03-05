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

// ─── Types ──────────────────────────────────────────────────────

export interface WorkflowDispatchInputs {
  callbackId: string;
  repoFullName: string;
  prNumber: string;
  headSha: string;
  baseBranch: string;
  callbackUrl: string;
  callbackSignature: string;
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

  const data = (await response.json()) as { id: number; full_name: string };
  return { repoId: data.id, fullName: data.full_name };
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

  // Set the callback secret on the runner repo so the workflow can sign its callback
  const runnerRepo = `${ownerLogin}/ghagga-runner`;
  await setRunnerSecret(runnerRepo, 'GHAGGA_CALLBACK_SECRET', callbackSecret, token);

  // Generate the HMAC signature the workflow should include in its callback
  // This lets the workflow sign the callback payload
  const callbackSignature = createHmac('sha256', callbackSecret)
    .update(callbackId)
    .digest('hex');

  // Dispatch the workflow
  const inputs: WorkflowDispatchInputs = {
    callbackId,
    repoFullName,
    prNumber: String(prNumber),
    headSha,
    baseBranch,
    callbackUrl,
    callbackSignature: `sha256=${callbackSignature}`,
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
