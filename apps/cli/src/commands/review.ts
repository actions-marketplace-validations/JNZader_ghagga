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
  SqliteMemoryStorage,
} from 'ghagga-core';
import type {
  ReviewMode,
  LLMProvider,
  ReviewSettings,
  ReviewStatus,
  ProgressCallback,
  ProgressEvent,
  MemoryStorage,
} from 'ghagga-core';
import { resolveProjectId } from '../lib/git.js';
import { getConfigDir } from '../lib/config.js';
import * as tui from '../ui/tui.js';
import { formatMarkdownResult } from '../ui/format.js';
import { resolveStepIcon } from '../ui/theme.js';

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
  memory: boolean;
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

  let memoryStorage: MemoryStorage | undefined;

  try {
    // Step 1: Get the git diff
    const diff = getGitDiff(repoPath);

    if (!diff || diff.trim().length === 0) {
      tui.log.info('ℹ️  No changes detected. Stage some changes or make commits to review.');
      process.exit(0);
    }

    // Step 2: Load optional config file
    const fileConfig = loadConfigFile(repoPath, options.config);

    // Step 3: Merge settings (CLI options take priority over config file)
    const settings = mergeSettings(options, fileConfig);

    // Step 4: Show progress
    if (options.format !== 'json') {
      tui.intro('🤖 GHAGGA Code Review');
      tui.log.message(`   Mode: ${options.mode} | Provider: ${options.provider} | Model: ${options.model}`);
      tui.log.step('   Analyzing...\n');
    }

    // Step 4.5: Initialize memory storage (SQLite, file-backed)
    const repoFullName = resolveProjectId(repoPath);

    if (options.memory) {
      try {
        const dbPath = join(getConfigDir(), 'memory.db');
        memoryStorage = await SqliteMemoryStorage.create(dbPath);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        tui.log.warn(`⚠️  Failed to initialize memory: ${msg}`);
        memoryStorage = undefined;
      }
    }

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
        repoFullName,
        prNumber: 0,
        commitMessages: [],
        fileList: [],
      },
      memoryStorage,
      onProgress,
    });

    // Step 5.5: Persist memory to disk
    await memoryStorage?.close();

    // Step 6: Output the result
    if (options.format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else {
      tui.log.message(formatMarkdownResult(result));
    }

    // Step 7: Exit code based on status
    const exitCode = getExitCode(result.status);
    if (options.format !== 'json') {
      tui.outro('Review complete');
    }
    process.exit(exitCode);
  } catch (error) {
    // Ensure memory is persisted even on error
    await memoryStorage?.close().catch(() => {});

    const message = error instanceof Error ? error.message : String(error);
    tui.log.error(`\n❌ Review failed: ${message}`);
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
    tui.log.warn(`⚠️  Could not parse config file: ${message}`);
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
    enableMemory: options.memory ?? true, // Memory enabled by default, --no-memory disables
    customRules: fileConfig.customRules ?? DEFAULT_SETTINGS.customRules,
    ignorePatterns: fileConfig.ignorePatterns ?? DEFAULT_SETTINGS.ignorePatterns,
    reviewLevel: (fileConfig.reviewLevel as ReviewSettings['reviewLevel']) ?? DEFAULT_SETTINGS.reviewLevel,
  };
}

// ─── Verbose Progress ───────────────────────────────────────────

/**
 * Create a progress callback that prints real-time verbose output.
 * Each step prints a single line with an icon, step name, and message.
 * Specialist/vote steps (dynamic names) get a generic icon.
 */
function createProgressHandler(): ProgressCallback {
  return (event: ProgressEvent) => {
    const icon = resolveStepIcon(event.step);

    const prefix = `  ${icon} [${event.step}]`;
    tui.log.step(`${prefix} ${event.message}`);

    if (event.detail) {
      // Indent detail lines for readability
      const indented = event.detail
        .split('\n')
        .map((line) => `      ${line}`)
        .join('\n');
      tui.log.message(indented);
    }
  };
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
