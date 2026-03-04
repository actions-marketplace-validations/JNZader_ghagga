/**
 * Inngest client configuration.
 *
 * Defines the Inngest client instance and event schemas
 * used across all durable functions.
 */

import { EventSchemas, Inngest } from 'inngest';

// ─── Event Types ────────────────────────────────────────────────

export interface ReviewRequestedData {
  /** GitHub installation ID for token exchange */
  installationId: number;

  /** Repository full name (e.g., "owner/repo") */
  repoFullName: string;

  /** Pull request number */
  prNumber: number;

  /** Internal repository ID in our database */
  repositoryId: number;

  /** HEAD commit SHA for the PR (used by runner dispatch) */
  headSha?: string;

  /** Base branch name (used by runner dispatch for shallow clone) */
  baseBranch?: string;

  // ── Provider chain (new) ──────────────────────────────────

  /** Ordered provider chain from DB (entries have encrypted keys) */
  providerChain?: Array<{
    provider: string;
    model: string;
    encryptedApiKey: string | null;
  }>;

  /** Whether AI review is enabled for this repo */
  aiReviewEnabled?: boolean;

  // ── Comment trigger metadata (optional) ────────────────────

  /** If review was triggered by a comment, the comment ID for reaction feedback */
  triggerCommentId?: number;

  // ── Legacy flat fields (backward compat) ──────────────────

  /** LLM provider to use */
  llmProvider: string;

  /** LLM model to use */
  llmModel: string;

  /** Review mode */
  reviewMode: string;

  /** Encrypted API key (will be decrypted at runtime) */
  encryptedApiKey: string | null;

  /** Review settings from repo configuration */
  settings: {
    enableSemgrep: boolean;
    enableTrivy: boolean;
    enableCpd: boolean;
    enableMemory: boolean;
    customRules: string[];
    ignorePatterns: string[];
    reviewLevel: string;
  };
}

// ─── Event Schemas ──────────────────────────────────────────────

/** Static analysis results returned from the GitHub Actions runner */
export interface RunnerCompletedData {
  /** Correlation ID matching the dispatch request */
  callbackId: string;

  /** Static analysis results from Semgrep, Trivy, and CPD */
  staticAnalysis: {
    semgrep: { status: string; findings: unknown[]; error?: string; executionTimeMs: number };
    trivy: { status: string; findings: unknown[]; error?: string; executionTimeMs: number };
    cpd: { status: string; findings: unknown[]; error?: string; executionTimeMs: number };
  };
}

type Events = {
  'ghagga/review.requested': {
    data: ReviewRequestedData;
  };
  'ghagga/runner.completed': {
    data: RunnerCompletedData;
  };
};

// ─── Client ─────────────────────────────────────────────────────

export const inngest = new Inngest({
  id: 'ghagga',
  schemas: new EventSchemas().fromRecord<Events>(),
});
