/**
 * Inngest durable function for running code reviews.
 *
 * Orchestrates the full review lifecycle:
 *   1. Fetch PR context from GitHub
 *   2. Dispatch static analysis to GitHub Actions runner
 *   3. Wait for runner callback with results (10m timeout)
 *   4. Run the core review pipeline (with precomputed static analysis)
 *   5. Save results to the database
 *   6. Post the review comment to GitHub
 *   7. React to trigger comment (if applicable)
 */

import { inngest } from './client.js';
import {
  fetchPRDiff,
  getPRCommitMessages,
  getPRFileList,
  getInstallationToken,
  postComment,
  addCommentReaction,
} from '../github/client.js';
import { dispatchAnalysis } from '../github/runner.js';
import { logger as rootLogger } from '../lib/logger.js';
import { reviewPipeline } from 'ghagga-core';

const logger = rootLogger.child({ module: 'review' });
import type { ReviewInput, ReviewResult, ReviewStatus, ReviewMode, LLMProvider, ReviewLevel, ProviderChainEntry, StaticAnalysisResult } from 'ghagga-core';
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
      headSha,
      baseBranch,
      // Comment trigger metadata
      triggerCommentId,
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

    // Step 2: Dispatch static analysis to GitHub Actions runner
    const dispatchResult = await step.run('dispatch-runner', async () => {
      const appId = process.env.GITHUB_APP_ID;
      const privateKey = process.env.GITHUB_PRIVATE_KEY;

      if (!appId || !privateKey) {
        logger.warn('Missing GITHUB_APP_ID or GITHUB_PRIVATE_KEY, skipping runner dispatch');
        return { dispatched: false as const, reason: 'Missing GitHub App credentials' };
      }

      if (!headSha) {
        logger.warn({ repoFullName, prNumber }, 'Missing headSha, skipping runner dispatch');
        return { dispatched: false as const, reason: 'Missing headSha' };
      }

      try {
        const callbackUrl = `${process.env.RENDER_EXTERNAL_URL ?? 'https://ghagga.onrender.com'}/api/runner-callback`;

        return await dispatchAnalysis(owner, installationId, appId, privateKey, {
          repoFullName,
          prNumber,
          headSha,
          baseBranch: baseBranch ?? 'main',
          toolSettings: {
            enableSemgrep: settings.enableSemgrep,
            enableTrivy: settings.enableTrivy,
            enableCpd: settings.enableCpd,
          },
          callbackUrl,
        });
      } catch (error) {
        logger.warn({ repoFullName, prNumber, error: String(error) }, 'Runner dispatch failed, proceeding with LLM-only');
        return { dispatched: false as const, reason: String(error) };
      }
    });

    // Step 3: Wait for runner callback with static analysis results
    let precomputedStaticAnalysis: StaticAnalysisResult | undefined;

    if (dispatchResult.dispatched) {
      const runnerEvent = await step.waitForEvent('wait-for-runner', {
        event: 'ghagga/runner.completed',
        match: 'data.callbackId',
        timeout: '10m',
      });

      if (runnerEvent) {
        precomputedStaticAnalysis = runnerEvent.data.staticAnalysis as StaticAnalysisResult;
      } else {
        // Timeout — construct all-skipped result so review can proceed with LLM-only
        logger.warn({ repoFullName, prNumber }, 'Runner timed out after 10 minutes, proceeding with LLM-only');
        const skippedTool = {
          status: 'skipped' as const,
          findings: [],
          error: 'Runner timeout (10 min)',
          executionTimeMs: 0,
        };
        precomputedStaticAnalysis = {
          semgrep: skippedTool,
          trivy: skippedTool,
          cpd: skippedTool,
        };
      }
    }

    // Step 4: Run the core review pipeline
    const result = await step.run('run-review', async () => {
      // Build the provider chain (decrypt API keys)
      const dbChain = (rawProviderChain ?? []) as DbProviderChainEntry[];
      let providerChain: ProviderChainEntry[] | undefined;

      if (dbChain.length > 0) {
        // New provider chain mode — decrypt API keys and filter unusable entries.
        // GitHub Models requires a user PAT (models:read scope), but in SaaS mode
        // we only have an installation token (ghs_*) which does NOT have models permission.
        // Skip 'github' provider entries without an explicit API key.
        providerChain = dbChain
          .filter((entry) => {
            if (entry.provider === 'github' && !entry.encryptedApiKey) {
              logger.warn(
                { repoFullName, provider: 'github' },
                'Skipping "github" provider in SaaS mode — installation tokens cannot access GitHub Models',
              );
              return false;
            }
            return true;
          })
          .map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            apiKey: entry.encryptedApiKey
              ? decrypt(entry.encryptedApiKey)
              : '',
          }));

        // If all providers were filtered out, clear the chain so we fall through
        // to the legacy path or return a clear error
        if (providerChain.length === 0) {
          providerChain = undefined;
        }
      }

      // Fallback: legacy single provider (for repos not yet migrated to chain)
      let legacyApiKey: string | undefined;
      let legacyProvider: LLMProvider | undefined;
      let legacyModel: string | undefined;

      if (!providerChain || providerChain.length === 0) {
        legacyProvider = llmProvider as LLMProvider;
        legacyModel = llmModel;

        // GitHub Models cannot work in SaaS mode (installation tokens lack models:read)
        if (legacyProvider === 'github' && !encryptedApiKey) {
          logger.warn(
            { repoFullName, provider: 'github' },
            'Provider "github" (GitHub Models) not available in SaaS/webhook mode — disabling AI review',
          );
          // Disable AI review — will return static-only results
          legacyProvider = undefined;
          legacyApiKey = undefined;
        } else if (encryptedApiKey) {
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
        logger.warn({ repoFullName }, 'Database unavailable for memory features');
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
        precomputedStaticAnalysis,
      };

      return await reviewPipeline(input);
    });

    // Step 5: Save review to database
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

    // Step 6: Post comment to GitHub PR
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

    // Step 7: React with 🚀 to the trigger comment (if review was triggered by comment)
    if (triggerCommentId) {
      await step.run('react-to-trigger', async () => {
        const appId = process.env.GITHUB_APP_ID;
        const privateKey = process.env.GITHUB_PRIVATE_KEY;

        if (!appId || !privateKey) return;

        try {
          const token = await getInstallationToken(installationId, appId, privateKey);
          await addCommentReaction(owner, repo, triggerCommentId, 'rocket', token);
        } catch (error) {
          // Non-critical — don't fail the review
          logger.warn({ repoFullName, prNumber, error: String(error) }, 'Failed to add completion reaction');
        }
      });
    }

    return { status: result.status, prNumber, repoFullName };
  },
);
