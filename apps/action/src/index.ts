/**
 * GHAGGA GitHub Action — AI-powered code review for pull requests.
 *
 * Runs the core review pipeline on PR diffs and posts results
 * as comments. Designed to be used in GitHub Actions workflows:
 *
 *   - uses: ghagga/action@v2
 *     with:
 *       provider: anthropic
 *       api-key: ${{ secrets.ANTHROPIC_API_KEY }}
 */

import * as core from '@actions/core';
import * as github from '@actions/github';
import {
  reviewPipeline,
  DEFAULT_SETTINGS,
  DEFAULT_MODELS,
} from '@ghagga/core';
import type {
  LLMProvider,
  ReviewMode,
  ReviewResult,
  ReviewStatus,
} from '@ghagga/core';

// ─── Main ───────────────────────────────────────────────────────

async function run(): Promise<void> {
  try {
    // Step 1: Read action inputs
    const provider = core.getInput('provider', { required: false }) as LLMProvider || 'anthropic';
    const modelInput = core.getInput('model', { required: false });
    const mode = core.getInput('mode', { required: false }) as ReviewMode || 'simple';
    const apiKey = core.getInput('api-key', { required: true });

    const enableSemgrep = core.getInput('enable-semgrep') !== 'false';
    const enableTrivy = core.getInput('enable-trivy') !== 'false';
    const enableCpd = core.getInput('enable-cpd') !== 'false';

    // Resolve model: use input, or default based on provider
    const model = modelInput || DEFAULT_MODELS[provider];

    // Step 2: Get PR context
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

    core.info(`\ud83e\udd16 GHAGGA reviewing PR #${prNumber} on ${repoFullName}`);
    core.info(`   Mode: ${mode} | Provider: ${provider} | Model: ${model}`);

    // Step 3: Fetch the PR diff
    const token = process.env['GITHUB_TOKEN'] ?? core.getInput('github-token', { required: false });
    if (!token) {
      core.setFailed(
        'GitHub token is required to fetch PR diff. ' +
        'The GITHUB_TOKEN is usually available automatically in Actions.',
      );
      return;
    }

    const octokit = github.getOctokit(token);

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
      core.info('\u23ed\ufe0f  PR has no diff content. Skipping review.');
      core.setOutput('status', 'SKIPPED');
      core.setOutput('findings-count', 0);
      return;
    }

    // Step 4: Run the review pipeline
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
        enableMemory: false, // No memory in Action mode
      },
      context: {
        repoFullName,
        prNumber,
        commitMessages: [],
        fileList: [],
      },
      db: undefined,
    });

    // Step 5: Post the review comment
    const comment = formatReviewComment(result);

    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: prNumber,
      body: comment,
    });

    core.info(`\u2705 Review posted to PR #${prNumber}`);

    // Step 6: Set outputs
    core.setOutput('status', result.status);
    core.setOutput('findings-count', result.findings.length);

    // Step 7: Fail the action if review status is FAILED
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

/**
 * Format the review result as a GitHub PR comment.
 * Mirrors the server's formatReviewComment for consistency.
 */
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

// ─── Execute ────────────────────────────────────────────────────

run();
