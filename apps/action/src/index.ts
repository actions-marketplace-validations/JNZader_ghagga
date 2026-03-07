/**
 * GHAGGA GitHub Action — AI-powered code review for pull requests.
 *
 * Runs the core review pipeline on PR diffs and posts results
 * as comments. Designed to be used in GitHub Actions workflows:
 *
 *   # Free with GitHub Models (default, no API key needed):
 *   - uses: JNZader/ghagga@v2
 *
 *   # With a paid provider:
 *   - uses: JNZader/ghagga@v2
 *     with:
 *       provider: anthropic
 *       api-key: ${{ secrets.ANTHROPIC_API_KEY }}
 *
 *   # With Qwen (Alibaba Cloud DashScope):
 *   - uses: JNZader/ghagga@v2
 *     with:
 *       provider: qwen
 *       api-key: ${{ secrets.DASHSCOPE_API_KEY }}
 */

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import * as github from '@actions/github';
import type { LLMProvider, MemoryStorage, ReviewMode } from 'ghagga-core';
import {
  DEFAULT_MODELS,
  DEFAULT_SETTINGS,
  formatReviewComment,
  reviewPipeline,
  SqliteMemoryStorage,
} from 'ghagga-core';
import { runLocalAnalysis } from './tools/index.js';

// ─── Main ───────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    // Step 1: Read action inputs
    const provider = (core.getInput('provider') || 'github') as LLMProvider;
    const modelInput = core.getInput('model');
    const mode = (core.getInput('mode') || 'simple') as ReviewMode;
    const apiKeyInput = core.getInput('api-key');

    const enableSemgrep = core.getInput('enable-semgrep') !== 'false';
    const enableTrivy = core.getInput('enable-trivy') !== 'false';
    const enableCpd = core.getInput('enable-cpd') !== 'false';
    const enableMemory = core.getInput('enable-memory') !== 'false';

    // Step 2: Resolve GitHub token (for PR diff fetching + GitHub Models API)
    const githubToken = core.getInput('github-token') || process.env.GITHUB_TOKEN || '';

    if (!githubToken) {
      core.setFailed(
        'GitHub token is required to fetch PR diffs and post comments. ' +
          'The GITHUB_TOKEN is usually available automatically in Actions.',
      );
      return;
    }

    // Step 3: Resolve API key — for "github" provider, use GitHub token
    let apiKey: string;
    if (provider === 'github') {
      apiKey = apiKeyInput || githubToken;
      core.info('🆓 Using GitHub Models (free tier) — no API key needed');
    } else if (provider === 'ollama') {
      apiKey = apiKeyInput || 'ollama';
    } else {
      apiKey = apiKeyInput;
      if (!apiKey) {
        core.setFailed(
          `API key is required for provider "${provider}". ` +
            `Set the "api-key" input, or use provider "github" for free reviews.`,
        );
        return;
      }
    }

    // Resolve model: use input, or default based on provider
    const model = modelInput || DEFAULT_MODELS[provider];

    // Step 4: Get PR context
    const { context } = github;
    const pr = context.payload.pull_request;

    if (!pr) {
      core.setFailed(
        'This action must be triggered by a pull_request event. ' +
          'Add `on: pull_request` to your workflow.',
      );
      return;
    }

    const repoFullName = `${context.repo.owner}/${context.repo.repo}`;
    const prNumber = pr.number as number;

    core.info(`🤖 GHAGGA reviewing PR #${prNumber} on ${repoFullName}`);
    core.info(`   Mode: ${mode} | Provider: ${provider} | Model: ${model}`);

    // Step 5: Fetch the PR diff
    const octokit = github.getOctokit(githubToken);

    const diffResponse = await octokit.rest.pulls.get({
      owner: context.repo.owner,
      repo: context.repo.repo,
      pull_number: prNumber,
      mediaType: {
        format: 'diff',
      },
    });

    // The diff comes back as a string when requesting diff format
    const diff = diffResponse.data as unknown as string;

    if (!diff || (typeof diff === 'string' && diff.trim().length === 0)) {
      core.info('⏭️  PR has no diff content. Skipping review.');
      core.setOutput('status', 'SKIPPED');
      core.setOutput('findings-count', 0);
      return;
    }

    // Step 5.5: Run local static analysis
    core.info('Running static analysis tools...');
    const repoDir = process.env.GITHUB_WORKSPACE ?? '.';
    const staticAnalysis = await runLocalAnalysis({
      enableSemgrep,
      enableTrivy,
      enableCpd,
      repoDir,
    });

    // Log a summary of static analysis results
    const semgrepCount = staticAnalysis.semgrep.findings.length;
    const trivyCount = staticAnalysis.trivy.findings.length;
    const cpdCount = staticAnalysis.cpd.findings.length;
    const totalFindings = semgrepCount + trivyCount + cpdCount;
    core.info(
      `Static analysis summary: ${totalFindings} findings ` +
        `(Semgrep: ${semgrepCount}, Trivy: ${trivyCount}, CPD: ${cpdCount})`,
    );

    // Step 5.6: Initialize review memory (SQLite + @actions/cache)
    const MEMORY_DB_PATH = '/tmp/ghagga-memory.db';
    const cacheKey = `ghagga-memory-${repoFullName.replace('/', '-')}`;
    let memoryStorage: MemoryStorage | undefined;

    if (enableMemory) {
      // Restore cached database file
      try {
        const hitKey = await cache.restoreCache([MEMORY_DB_PATH], cacheKey, [cacheKey]);
        if (hitKey) {
          core.info(`🧠 Memory cache hit (key: ${hitKey})`);
        } else {
          core.info('🧠 Memory cache miss — starting with fresh database');
        }
      } catch (error) {
        core.warning(
          `[ghagga] Failed to restore memory cache (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      // Create SQLite memory storage
      try {
        memoryStorage = await SqliteMemoryStorage.create(MEMORY_DB_PATH);
        core.info('🧠 Memory storage initialized');
      } catch (error) {
        core.warning(
          `[ghagga] Failed to initialize memory (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
        memoryStorage = undefined;
      }
    }

    // Step 6: Run the review pipeline
    const result = await reviewPipeline({
      diff: typeof diff === 'string' ? diff : String(diff),
      mode,
      provider,
      model,
      apiKey,
      settings: {
        ...DEFAULT_SETTINGS,
        enableSemgrep,
        enableTrivy,
        enableCpd,
        enableMemory,
      },
      context: {
        repoFullName,
        prNumber,
        commitMessages: [],
        fileList: [],
      },
      memoryStorage,
      precomputedStaticAnalysis: staticAnalysis,
    });

    // Step 7: Post the review comment
    const comment = formatReviewComment(result);

    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: comment,
    });

    core.info(`✅ Review posted to PR #${prNumber}`);

    // Step 7.5: Persist memory to cache
    if (memoryStorage) {
      try {
        await memoryStorage.close();
        core.info('🧠 Memory database persisted to disk');
      } catch (error) {
        core.warning(
          `[ghagga] Failed to close memory storage (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      try {
        await cache.saveCache([MEMORY_DB_PATH], cacheKey);
        core.info('🧠 Memory cache saved');
      } catch (error) {
        core.warning(
          `[ghagga] Failed to save memory cache (non-fatal): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    // Step 8: Set outputs
    core.setOutput('status', result.status);
    core.setOutput('findings-count', result.findings.length);

    // Step 9: Fail the action if review status is FAILED
    if (result.status === 'FAILED') {
      core.setFailed(
        `Code review found critical issues. Status: ${result.status} | ` +
          `Findings: ${result.findings.length}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    core.setFailed(`GHAGGA review failed: ${message}`);
  }
}

// ─── Execute ────────────────────────────────────────────────────

export { run };

// Only auto-run when executed directly (not imported by tests)
if (process.env.NODE_ENV !== 'test') {
  run();
}
