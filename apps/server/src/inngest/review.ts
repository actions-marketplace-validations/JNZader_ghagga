/**
 * Inngest durable function for running code reviews.
 *
 * Orchestrates the full review lifecycle:
 *   1. Fetch PR context from GitHub
 *   2. Run the core review pipeline
 *   3. Save results to the database
 *   4. Post the review comment to GitHub
 */

import { inngest } from './client.js';
import {
  fetchPRDiff,
  getPRCommitMessages,
  getPRFileList,
  getInstallationToken,
  postComment,
} from '../github/client.js';
import { reviewPipeline } from 'ghagga-core';
import type { ReviewInput, ReviewResult, ReviewStatus, ReviewMode, LLMProvider, ReviewLevel, ProviderChainEntry } from 'ghagga-core';
import { createDatabaseFromEnv, saveReview, decrypt } from 'ghagga-db';
import type { Database, DbProviderChainEntry } from 'ghagga-db';

// ─── Comment Formatting ─────────────────────────────────────────

const STATUS_EMOJI: Record<ReviewStatus, string> = {
  PASSED: '\u2705 PASSED',
  FAILED: '\u274c FAILED',
  NEEDS_HUMAN_REVIEW: '\u26a0\ufe0f NEEDS_HUMAN_REVIEW',
  SKIPPED: '\u23ed\ufe0f SKIPPED',
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\ud83d\udd34',
  high: '\ud83d\udfe0',
  medium: '\ud83d\udfe1',
  low: '\ud83d\udfe2',
  info: '\ud83d\udfe3',
};

function formatReviewComment(result: ReviewResult): string {
  const status = STATUS_EMOJI[result.status] ?? result.status;
  const timeSeconds = (result.metadata.executionTimeMs / 1000).toFixed(1);

  let comment = `## \ud83e\udd16 GHAGGA Code Review\n\n`;
  comment += `**Status:** ${status}\n`;
  comment += `**Mode:** ${result.metadata.mode} | **Model:** ${result.metadata.model} | **Time:** ${timeSeconds}s\n\n`;

  // Summary
  comment += `### Summary\n${result.summary}\n\n`;

  // Findings table
  if (result.findings.length > 0) {
    comment += `### Findings (${result.findings.length})\n`;
    comment += `| Severity | Category | File | Message |\n`;
    comment += `|----------|----------|------|----------|\n`;

    for (const finding of result.findings) {
      const emoji = SEVERITY_EMOJI[finding.severity] ?? '';
      const location = finding.line
        ? `${finding.file}:${finding.line}`
        : finding.file;
      // Escape pipe characters in the message for table formatting
      const message = finding.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
      comment += `| ${emoji} ${finding.severity} | ${finding.category} | ${location} | ${message} |\n`;
    }
    comment += '\n';
  }

  // Static analysis summary
  const staticTools = result.metadata.toolsRun;
  const skippedTools = result.metadata.toolsSkipped;
  if (staticTools.length > 0 || skippedTools.length > 0) {
    comment += `### Static Analysis\n`;
    if (staticTools.length > 0) {
      comment += `\u2705 Tools run: ${staticTools.join(', ')}\n`;
    }
    if (skippedTools.length > 0) {
      comment += `\u23ed\ufe0f Tools skipped: ${skippedTools.join(', ')}\n`;
    }
    comment += '\n';
  }

  comment += `---\n*Powered by [GHAGGA](https://github.com/JNZader/ghagga) \u2014 AI Code Review*`;

  return comment;
}

// ─── Inngest Function ───────────────────────────────────────────

export const reviewFunction = inngest.createFunction(
  {
    id: 'ghagga-review',
    name: 'GHAGGA Code Review',
    retries: 3,
  },
  { event: 'ghagga/review.requested' },
  async ({ event, step }) => {
    const {
      installationId,
      repoFullName,
      prNumber,
      repositoryId,
      // Provider chain (new)
      providerChain: rawProviderChain,
      aiReviewEnabled,
      // Legacy flat fields (backward compat)
      llmProvider,
      llmModel,
      reviewMode,
      encryptedApiKey,
      settings,
    } = event.data;

    const [owner, repo] = repoFullName.split('/') as [string, string];

    // Step 1: Fetch context from GitHub
    const context = await step.run('fetch-context', async () => {
      const appId = process.env.GITHUB_APP_ID;
      const privateKey = process.env.GITHUB_PRIVATE_KEY;

      if (!appId || !privateKey) {
        throw new Error('GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set');
      }

      const token = await getInstallationToken(installationId, appId, privateKey);

      const [diff, commitMessages, fileList] = await Promise.all([
        fetchPRDiff(owner, repo, prNumber, token),
        getPRCommitMessages(owner, repo, prNumber, token),
        getPRFileList(owner, repo, prNumber, token),
      ]);

      return { token, diff, commitMessages, fileList };
    });

    // Step 2: Run the core review pipeline
    const result = await step.run('run-review', async () => {
      // Build the provider chain (decrypt API keys)
      const dbChain = (rawProviderChain ?? []) as DbProviderChainEntry[];
      let providerChain: ProviderChainEntry[] | undefined;

      if (dbChain.length > 0) {
        // New provider chain mode
        providerChain = dbChain.map((entry) => ({
          provider: entry.provider,
          model: entry.model,
          apiKey: entry.encryptedApiKey
            ? decrypt(entry.encryptedApiKey)
            : (context.token ?? ''), // GitHub Models: use installation token
        }));
      }

      // Fallback: legacy single provider (for repos not yet migrated to chain)
      let legacyApiKey: string | undefined;
      let legacyProvider: LLMProvider | undefined;
      let legacyModel: string | undefined;

      if (!providerChain || providerChain.length === 0) {
        legacyProvider = llmProvider as LLMProvider;
        legacyModel = llmModel;

        if (encryptedApiKey) {
          legacyApiKey = decrypt(encryptedApiKey);
        } else {
          const envKey = process.env[`${llmProvider?.toUpperCase()}_API_KEY`];
          if (!envKey) {
            throw new Error(
              `No API key configured for provider ${llmProvider}. ` +
              `Set a per-repo key or the ${llmProvider?.toUpperCase()}_API_KEY env var.`,
            );
          }
          legacyApiKey = envKey;
        }
      }

      let db: Database | undefined;
      try {
        db = createDatabaseFromEnv();
      } catch {
        // Memory features degrade gracefully without DB
        console.warn('[ghagga] Database unavailable for memory features');
      }

      const input: ReviewInput = {
        diff: context.diff,
        mode: reviewMode as ReviewMode,
        // Provider chain (new)
        providerChain,
        aiReviewEnabled: aiReviewEnabled ?? true,
        // Legacy single provider (backward compat)
        provider: legacyProvider,
        model: legacyModel,
        apiKey: legacyApiKey,
        settings: {
          enableSemgrep: settings.enableSemgrep,
          enableTrivy: settings.enableTrivy,
          enableCpd: settings.enableCpd,
          enableMemory: settings.enableMemory,
          customRules: settings.customRules,
          ignorePatterns: settings.ignorePatterns,
          reviewLevel: settings.reviewLevel as ReviewLevel,
        },
        context: {
          repoFullName,
          prNumber,
          commitMessages: context.commitMessages,
          fileList: context.fileList,
        },
        db,
      };

      return await reviewPipeline(input);
    });

    // Step 3: Save review to database
    await step.run('save-review', async () => {
      const db = createDatabaseFromEnv();
      await saveReview(db, {
        repositoryId,
        prNumber,
        status: result.status,
        mode: result.metadata.mode,
        summary: result.summary,
        findings: result.findings,
        tokensUsed: result.metadata.tokensUsed,
        executionTimeMs: result.metadata.executionTimeMs,
        metadata: result.metadata,
      });
    });

    // Step 4: Post comment to GitHub PR
    await step.run('post-comment', async () => {
      const appId = process.env.GITHUB_APP_ID;
      const privateKey = process.env.GITHUB_PRIVATE_KEY;

      if (!appId || !privateKey) {
        throw new Error('GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set');
      }

      // Get a fresh token (the previous one may have expired during review)
      const token = await getInstallationToken(installationId, appId, privateKey);
      const commentBody = formatReviewComment(result);
      await postComment(owner, repo, prNumber, commentBody, token);
    });

    return { status: result.status, prNumber, repoFullName };
  },
);
