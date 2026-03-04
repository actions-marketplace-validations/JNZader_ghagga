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

  /** HEAD commit SHA for the PR */
  headSha?: string;

  /** Base branch name */
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

type Events = {
  'ghagga/review.requested': {
    data: ReviewRequestedData;
  };
};

// ─── Client ─────────────────────────────────────────────────────

export const inngest = new Inngest({
  id: 'ghagga',
  schemas: new EventSchemas().fromRecord<Events>(),
});
