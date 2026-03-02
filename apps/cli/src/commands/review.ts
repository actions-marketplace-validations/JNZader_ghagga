/**
 * Review command handler.
 *
 * Gets the local git diff, merges configuration from CLI options,
 * environment, and optional .ghagga.json file, then runs the
 * core review pipeline and formats the output.
 */

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  reviewPipeline,
  DEFAULT_SETTINGS,
} from '@ghagga/core';
import type {
  ReviewMode,
  LLMProvider,
  ReviewSettings,
  ReviewResult,
  ReviewStatus,
  FindingSeverity,
  ProgressCallback,
  ProgressEvent,
} from '@ghagga/core';

// ─── Types ──────────────────────────────────────────────────────

export interface ReviewOptions {
  mode: ReviewMode;
  provider: LLMProvider;
  model: string;
  apiKey: string;
  format: 'markdown' | 'json';
  semgrep: boolean;
  trivy: boolean;
  cpd: boolean;
  config?: string;
  verbose: boolean;
}

interface GhaggaConfig {
  mode?: string;
  provider?: string;
  model?: string;
  enableSemgrep?: boolean;
  enableTrivy?: boolean;
  enableCpd?: boolean;
  customRules?: string[];
  ignorePatterns?: string[];
  reviewLevel?: string;
}

// ─── Main Command ───────────────────────────────────────────────

export async function reviewCommand(
  targetPath: string,
  options: ReviewOptions,
): Promise<void> {
  const repoPath = resolve(targetPath);

  try {
    // Step 1: Get the git diff
    const diff = getGitDiff(repoPath);

    if (!diff || diff.trim().length === 0) {
      console.log('\u2139\ufe0f  No changes detected. Stage some changes or make commits to review.');
      process.exit(0);
    }

    // Step 2: Load optional config file
    const fileConfig = loadConfigFile(repoPath, options.config);

    // Step 3: Merge settings (CLI options take priority over config file)
    const settings = mergeSettings(options, fileConfig);

    // Step 4: Show progress
    console.log('\ud83e\udd16 GHAGGA Code Review');
    console.log(`   Mode: ${options.mode} | Provider: ${options.provider} | Model: ${options.model}`);
    console.log('   Analyzing...\n');

    // Step 5: Run the review pipeline
    const onProgress: ProgressCallback | undefined = options.verbose
      ? createProgressHandler()
      : undefined;

    const result = await reviewPipeline({
      diff,
      mode: options.mode,
      provider: options.provider,
      model: options.model,
      apiKey: options.apiKey,
      settings,
      context: {
        repoFullName: 'local/review',
        prNumber: 0,
        commitMessages: [],
        fileList: [],
      },
      db: undefined,
      onProgress,
    });

    // Step 6: Output the result
    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatMarkdownResult(result));
    }

    // Step 7: Exit code based on status
    const exitCode = getExitCode(result.status);
    process.exit(exitCode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n\u274c Review failed: ${message}`);
    process.exit(1);
  }
}

// ─── Git Diff ───────────────────────────────────────────────────

/**
 * Get the diff from git. Uses staged changes if available,
 * otherwise falls back to `git diff HEAD`.
 */
function getGitDiff(repoPath: string): string {
  const execOpts = { cwd: repoPath, encoding: 'utf-8' as const, maxBuffer: 10 * 1024 * 1024 };

  // Check for staged changes first
  try {
    const staged = execSync('git diff --staged', execOpts).toString();
    if (staged.trim().length > 0) {
      return staged;
    }
  } catch {
    // git diff --staged failed, try HEAD
  }

  // Fall back to diff against HEAD
  try {
    const headDiff = execSync('git diff HEAD', execOpts).toString();
    if (headDiff.trim().length > 0) {
      return headDiff;
    }
  } catch {
    // HEAD might not exist (fresh repo), try unstaged diff
  }

  // Last resort: unstaged diff
  try {
    return execSync('git diff', execOpts).toString();
  } catch {
    throw new Error(
      `Could not get git diff from "${repoPath}". ` +
      'Make sure the path is a git repository with changes.',
    );
  }
}

// ─── Config File ────────────────────────────────────────────────

/**
 * Load and parse an optional .ghagga.json config file.
 */
function loadConfigFile(repoPath: string, configPath?: string): GhaggaConfig {
  const filePath = configPath
    ? resolve(configPath)
    : join(repoPath, '.ghagga.json');

  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as GhaggaConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`\u26a0\ufe0f  Could not parse config file: ${message}`);
    return {};
  }
}

// ─── Settings Merge ─────────────────────────────────────────────

/**
 * Merge CLI options, config file, and defaults.
 * Priority: CLI options > config file > defaults.
 */
function mergeSettings(
  options: ReviewOptions,
  fileConfig: GhaggaConfig,
): ReviewSettings {
  return {
    enableSemgrep: options.semgrep ?? fileConfig.enableSemgrep ?? DEFAULT_SETTINGS.enableSemgrep,
    enableTrivy: options.trivy ?? fileConfig.enableTrivy ?? DEFAULT_SETTINGS.enableTrivy,
    enableCpd: options.cpd ?? fileConfig.enableCpd ?? DEFAULT_SETTINGS.enableCpd,
    enableMemory: false, // Memory is disabled in CLI mode
    customRules: fileConfig.customRules ?? DEFAULT_SETTINGS.customRules,
    ignorePatterns: fileConfig.ignorePatterns ?? DEFAULT_SETTINGS.ignorePatterns,
    reviewLevel: (fileConfig.reviewLevel as ReviewSettings['reviewLevel']) ?? DEFAULT_SETTINGS.reviewLevel,
  };
}

// ─── Verbose Progress ───────────────────────────────────────────

/** Step-to-emoji mapping for verbose output. */
const STEP_ICON: Record<string, string> = {
  'validate':          '🔍',
  'parse-diff':        '📄',
  'detect-stacks':     '🧩',
  'token-budget':      '📊',
  'static-analysis':   '🛡️',
  'static-results':    '📋',
  'agent-start':       '🤖',
  'workflow-start':    '🔄',
  'workflow-synthesis': '🧬',
  'consensus-start':   '🗳️',
  'consensus-voting':  '🏛️',
};

/**
 * Create a progress callback that prints real-time verbose output.
 * Each step prints a single line with an icon, step name, and message.
 * Specialist/vote steps (dynamic names) get a generic icon.
 */
function createProgressHandler(): ProgressCallback {
  return (event: ProgressEvent) => {
    const icon = STEP_ICON[event.step]
      ?? (event.step.startsWith('specialist-') ? '👤' : undefined)
      ?? (event.step.startsWith('vote-') ? '🗳️' : undefined)
      ?? '▸';

    const prefix = `  ${icon} [${event.step}]`;
    console.log(`${prefix} ${event.message}`);

    if (event.detail) {
      // Indent detail lines for readability
      const indented = event.detail
        .split('\n')
        .map((line) => `      ${line}`)
        .join('\n');
      console.log(indented);
    }
  };
}

// ─── Output Formatting ──────────────────────────────────────────

const STATUS_EMOJI: Record<ReviewStatus, string> = {
  PASSED: '\u2705 PASSED',
  FAILED: '\u274c FAILED',
  NEEDS_HUMAN_REVIEW: '\u26a0\ufe0f  NEEDS HUMAN REVIEW',
  SKIPPED: '\u23ed\ufe0f  SKIPPED',
};

const SEVERITY_EMOJI: Record<FindingSeverity, string> = {
  critical: '\ud83d\udd34',
  high: '\ud83d\udfe0',
  medium: '\ud83d\udfe1',
  low: '\ud83d\udfe2',
  info: '\ud83d\udfe3',
};

/**
 * Format a ReviewResult as a human-readable markdown string for the terminal.
 */
function formatMarkdownResult(result: ReviewResult): string {
  const status = STATUS_EMOJI[result.status] ?? result.status;
  const timeSeconds = (result.metadata.executionTimeMs / 1000).toFixed(1);

  const lines: string[] = [];

  // Header
  lines.push('---');
  lines.push(`\ud83e\udd16 GHAGGA Code Review  |  ${status}`);
  lines.push(`Mode: ${result.metadata.mode} | Model: ${result.metadata.model} | Time: ${timeSeconds}s | Tokens: ${result.metadata.tokensUsed}`);
  lines.push('---');
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push(result.summary);
  lines.push('');

  // Findings
  if (result.findings.length > 0) {
    lines.push(`## Findings (${result.findings.length})`);
    lines.push('');

    for (const finding of result.findings) {
      const emoji = SEVERITY_EMOJI[finding.severity] ?? '';
      const location = finding.line
        ? `${finding.file}:${finding.line}`
        : finding.file;

      lines.push(`${emoji} [${finding.severity.toUpperCase()}] ${finding.category}`);
      lines.push(`   ${location}`);
      lines.push(`   ${finding.message}`);

      if (finding.suggestion) {
        lines.push(`   \ud83d\udca1 ${finding.suggestion}`);
      }

      lines.push('');
    }
  } else {
    lines.push('No findings. Nice work! \ud83c\udf89');
    lines.push('');
  }

  // Static analysis summary
  const { toolsRun, toolsSkipped } = result.metadata;
  if (toolsRun.length > 0 || toolsSkipped.length > 0) {
    lines.push('## Static Analysis');
    if (toolsRun.length > 0) {
      lines.push(`\u2705 Tools run: ${toolsRun.join(', ')}`);
    }
    if (toolsSkipped.length > 0) {
      lines.push(`\u23ed\ufe0f  Tools skipped: ${toolsSkipped.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('Powered by GHAGGA \u2014 AI Code Review');

  return lines.join('\n');
}

// ─── Exit Code ──────────────────────────────────────────────────

/**
 * Map review status to process exit code.
 * PASSED and SKIPPED = 0, everything else = 1.
 */
function getExitCode(status: ReviewStatus): number {
  switch (status) {
    case 'PASSED':
    case 'SKIPPED':
      return 0;
    case 'FAILED':
    case 'NEEDS_HUMAN_REVIEW':
      return 1;
    default: {
      const _exhaustive: never = status;
      console.warn(`Unknown status: ${_exhaustive as string}`);
      return 1;
    }
  }
}
