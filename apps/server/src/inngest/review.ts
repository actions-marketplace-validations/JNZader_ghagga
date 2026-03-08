/**
 * Inngest durable function for running code reviews.
 *
 * Orchestrates the full review lifecycle:
 *   1. Fetch PR context from GitHub
 *   2. Run the core review pipeline (LLM + local static analysis)
 *   3. Save results to the database
 *   4. Post the review comment to GitHub
 *   5. React to trigger comment (if applicable)
 */

import { formatReviewComment, reviewPipeline } from 'ghagga-core';
import {
  addCommentReaction,
  fetchPRDiff,
  getInstallationToken,
  getPRCommitMessages,
  getPRFileList,
  postComment,
} from '../github/client.js';
import { discoverRunnerRepo, dispatchWorkflow } from '../github/runner.js';
import { logger as rootLogger } from '../lib/logger.js';
import type { RunnerCompletedData } from './client.js';
import { inngest } from './client.js';

const logger = rootLogger.child({ module: 'review' });

import type {
  LLMProvider,
  ProviderChainEntry,
  ReviewInput,
  ReviewLevel,
  ReviewMode,
  StaticAnalysisResult,
} from 'ghagga-core';
import type { Database, DbProviderChainEntry } from 'ghagga-db';
import { createDatabaseFromEnv, decrypt, saveReview } from 'ghagga-db';
import { PostgresMemoryStorage } from '../memory/postgres.js';

// ─── Inngest Function ───────────────────────────────────────────

export const reviewFunction = inngest.createFunction(
  {
    id: 'ghagga-review',
    name: 'GHAGGA Code Review',
    retries: 3,
  },
  { event: 'ghagga/review.requested' },
  async ({ event, step }) => {
    const reviewStartTime = Date.now();

    const {
      reviewId,
      installationId,
      repoFullName,
      prNumber,
      repositoryId,
      headSha: eventHeadSha,
      baseBranch: eventBaseBranch,
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

    // Create a child logger with reviewId for correlation across all steps
    const log = logger.child({ reviewId, repoFullName, prNumber });

    const [owner, repo] = repoFullName.split('/') as [string, string];

    // Step 1: Fetch context from GitHub
    const context = await step.run('fetch-context', async () => {
      const stepStart = Date.now();
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

      log.info(
        { metrics: { step: 'fetch-context', durationMs: Date.now() - stepStart } },
        'Fetch context completed',
      );

      return { token, diff, commitMessages, fileList };
    });

    // Step 2: Dispatch static analysis to runner (if available)
    const runnerResult = await step.run('dispatch-runner', async () => {
      // Check if any static analysis tool is enabled
      const anyToolEnabled = settings.enableSemgrep || settings.enableTrivy || settings.enableCpd;
      if (!anyToolEnabled) {
        log.info('No static analysis tools enabled — skipping runner');
        return { dispatched: false as const, callbackId: null };
      }

      const appId = process.env.GITHUB_APP_ID;
      const privateKey = process.env.GITHUB_PRIVATE_KEY;
      if (!appId || !privateKey) {
        log.warn('Missing app credentials — skipping runner dispatch');
        return { dispatched: false as const, callbackId: null };
      }

      const token = await getInstallationToken(installationId, appId, privateKey);

      // Discover if the user has a ghagga-runner repo
      const runner = await discoverRunnerRepo(owner, token);
      if (!runner) {
        log.info('No ghagga-runner repo found — static analysis will run locally on server');
        return { dispatched: false as const, callbackId: null };
      }

      // Resolve headSha and baseBranch — prefer event data, fallback to fetch
      const headSha = eventHeadSha ?? 'unknown';
      const baseBranch = eventBaseBranch ?? 'main';

      // Build callback URL
      const serverUrl =
        process.env.RENDER_EXTERNAL_URL ??
        process.env.SERVER_URL ??
        `http://localhost:${process.env.PORT ?? '3000'}`;
      const callbackUrl = `${serverUrl}/runner/callback`;

      try {
        const callbackId = await dispatchWorkflow({
          ownerLogin: owner,
          repoFullName,
          prNumber,
          headSha,
          baseBranch,
          callbackUrl,
          enableSemgrep: settings.enableSemgrep,
          enableTrivy: settings.enableTrivy,
          enableCpd: settings.enableCpd,
          token,
        });

        log.info(
          { callbackId, runner: runner.fullName },
          'Runner workflow dispatched — waiting for callback',
        );

        return { dispatched: true as const, callbackId };
      } catch (error) {
        log.warn(
          { error: String(error) },
          'Failed to dispatch runner workflow — static analysis will run locally on server',
        );
        return { dispatched: false as const, callbackId: null };
      }
    });

    // Step 3: Wait for runner callback (if dispatched)
    let precomputedStaticAnalysis: StaticAnalysisResult | undefined;

    if (runnerResult.dispatched && runnerResult.callbackId) {
      const runnerEvent = await step.waitForEvent('wait-for-runner', {
        event: 'ghagga/runner.completed',
        if: `async.data.callbackId == '${runnerResult.callbackId}'`,
        timeout: '10m',
      });

      if (runnerEvent) {
        precomputedStaticAnalysis = (runnerEvent.data as RunnerCompletedData).staticAnalysis;
        log.info(
          { callbackId: runnerResult.callbackId },
          'Received static analysis results from runner',
        );
      } else {
        log.warn(
          { callbackId: runnerResult.callbackId },
          'Runner callback timed out after 10 minutes — static analysis will run locally on server',
        );
      }
    }

    // Step 4: Run the core review pipeline
    const result = await step.run('run-review', async () => {
      const stepStart = Date.now();
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
              log.warn(
                { provider: 'github' },
                'Skipping "github" provider in SaaS mode — installation tokens cannot access GitHub Models',
              );
              return false;
            }
            return true;
          })
          .map((entry) => ({
            provider: entry.provider,
            model: entry.model,
            apiKey: entry.encryptedApiKey ? decrypt(entry.encryptedApiKey) : '',
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
          log.warn(
            { provider: 'github' },
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
        log.warn('Database unavailable for memory features');
      }

      const memoryStorage = db ? new PostgresMemoryStorage(db, installationId) : undefined;

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
        // Precomputed static analysis from runner (if available)
        precomputedStaticAnalysis,
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
        memoryStorage,
      };

      const reviewResult = await reviewPipeline(input);

      log.info(
        { metrics: { step: 'run-review', durationMs: Date.now() - stepStart } },
        'AI review analysis completed',
      );

      return reviewResult;
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
      const stepStart = Date.now();
      const appId = process.env.GITHUB_APP_ID;
      const privateKey = process.env.GITHUB_PRIVATE_KEY;

      if (!appId || !privateKey) {
        throw new Error('GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set');
      }

      // Get a fresh token (the previous one may have expired during review)
      const token = await getInstallationToken(installationId, appId, privateKey);
      let commentBody = formatReviewComment(result);
      // Append reviewId to the comment footer for traceability
      commentBody += `\n<!-- reviewId: ${reviewId} -->`;
      await postComment(owner, repo, prNumber, commentBody, token);

      log.info(
        { metrics: { step: 'post-comment', durationMs: Date.now() - stepStart } },
        'Review comment posted',
      );
    });

    // Step 7: React with rocket to the trigger comment (if review was triggered by comment)
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
          log.warn({ error: String(error) }, 'Failed to add completion reaction');
        }
      });
    }

    log.info(
      {
        metrics: {
          durationMs: Date.now() - reviewStartTime,
          provider: result.metadata.provider,
          model: result.metadata.model,
          status: result.status,
          findingsCount: result.findings?.length ?? 0,
          filesAnalyzed: context.fileList?.length ?? 0,
          tokensUsed: result.metadata.tokensUsed,
        },
      },
      'Review completed',
    );

    return { status: result.status, prNumber, repoFullName, reviewId };
  },
);
