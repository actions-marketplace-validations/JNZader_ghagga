#!/usr/bin/env node

/**
 * GHAGGA CLI — AI-powered code review from the command line.
 *
 * Quick start:
 *   ghagga login                   Authenticate with GitHub (free!)
 *   ghagga review [path]           Review staged or uncommitted changes
 *   ghagga status                  Show current auth and config
 *   ghagga logout                  Clear stored credentials
 *
 * After "ghagga login", reviews use GitHub Models (gpt-4o-mini) for free.
 * You can override with --provider, --model, --api-key for other providers.
 *
 * Environment variables (override stored config):
 *   GHAGGA_API_KEY          API key for the LLM provider
 *   GHAGGA_PROVIDER         LLM provider: anthropic, openai, google, github, ollama, qwen
 *   GHAGGA_MODEL            Model identifier
 *   GITHUB_TOKEN            GitHub token (fallback for github provider)
 *   GHAGGA_MEMORY_BACKEND   Memory backend: sqlite (default) or engram
 */

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import type { LLMProvider, ReviewMode } from 'ghagga-core';
import { DEFAULT_MODELS } from 'ghagga-core';
import { hooksCommand } from './commands/hooks/index.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { memoryCommand } from './commands/memory/index.js';
import { reviewCommand } from './commands/review.js';
import { statusCommand } from './commands/status.js';
import { getStoredToken, loadConfig } from './lib/config.js';
import * as tui from './ui/tui.js';

// Read version from package.json at runtime (no hardcoded strings)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('ghagga')
  .description('AI-powered code review CLI')
  .version(pkg.version)
  .option('--plain', 'Disable styled terminal output');

// Initialize TUI mode before any command runs (Design AD3)
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.optsWithGlobals() as { plain?: boolean };
  tui.init({ plain: opts.plain });
});

// ─── Login ──────────────────────────────────────────────────────

program
  .command('login')
  .description('Authenticate with GitHub (uses free AI models)')
  .action(async () => {
    await loginCommand();
  });

// ─── Logout ─────────────────────────────────────────────────────

program
  .command('logout')
  .description('Clear stored GitHub credentials')
  .action(() => {
    logoutCommand();
  });

// ─── Status ─────────────────────────────────────────────────────

program
  .command('status')
  .description('Show current authentication and configuration')
  .action(async () => {
    await statusCommand();
  });

// ─── Review ─────────────────────────────────────────────────────

program
  .command('review')
  .description('Review local code changes using AI')
  .argument('[path]', 'Path to the repository', '.')
  .option('-m, --mode <mode>', 'Review mode', 'simple')
  .option(
    '-p, --provider <provider>',
    'LLM provider (auto-detected from login)',
    process.env.GHAGGA_PROVIDER,
  )
  .option('--model <model>', 'LLM model identifier', process.env.GHAGGA_MODEL)
  .option('--api-key <key>', 'LLM provider API key', process.env.GHAGGA_API_KEY)
  .option('-f, --format <format>', 'Output format', 'markdown')
  .option('--no-semgrep', 'Disable Semgrep static analysis')
  .option('--no-trivy', 'Disable Trivy vulnerability scanning')
  .option('--no-cpd', 'Disable CPD duplicate detection')
  .option('--no-memory', 'Disable review memory')
  .option('-c, --config <path>', 'Path to .ghagga.json config file')
  .option('-v, --verbose', 'Show detailed progress during review')
  .option('--staged', 'Review only staged changes (for pre-commit hooks)')
  .option('--commit-msg <file>', 'Validate commit message from file path')
  .option('--exit-on-issues', 'Exit with code 1 if critical/high issues found')
  .option('--quick', 'Static analysis only — skip LLM review')
  .option(
    '--memory-backend <type>',
    'Memory backend: sqlite (default) or engram (env: GHAGGA_MEMORY_BACKEND)',
    'sqlite',
  )
  .action(async (path: string, options: ReviewCommandOptions) => {
    // ── Auto-resolve auth from stored config ──────────────────
    const config = loadConfig();
    const storedToken = getStoredToken();

    // Priority: CLI flag > env var > stored config
    if (!options.provider) {
      options.provider = config.defaultProvider ?? 'github';
    }

    if (!options.model) {
      options.model = config.defaultModel ?? undefined;
    }

    // Auto-resolve API key: CLI flag > env var > GITHUB_TOKEN > stored token
    if (!options.apiKey) {
      if (options.provider === 'github') {
        options.apiKey = process.env.GITHUB_TOKEN ?? storedToken ?? undefined;
      }
    }

    // ── Validate mode ─────────────────────────────────────────
    const validModes: ReviewMode[] = ['simple', 'workflow', 'consensus'];
    if (!validModes.includes(options.mode as ReviewMode)) {
      tui.log.error(`❌ Invalid mode "${options.mode}". Choose from: ${validModes.join(', ')}`);
      process.exit(1);
    }

    // ── Validate provider ─────────────────────────────────────
    const validProviders: LLMProvider[] = [
      'anthropic',
      'openai',
      'google',
      'github',
      'ollama',
      'qwen',
    ];
    if (!validProviders.includes(options.provider as LLMProvider)) {
      tui.log.error(
        `❌ Invalid provider "${options.provider}". Choose from: ${validProviders.join(', ')}`,
      );
      process.exit(1);
    }

    // ── Validate format ───────────────────────────────────────
    const validFormats = ['markdown', 'json'];
    if (!validFormats.includes(options.format)) {
      tui.log.error(
        `❌ Invalid format "${options.format}". Choose from: ${validFormats.join(', ')}`,
      );
      process.exit(1);
    }

    // ── Validate API key (not required for ollama or --quick mode) ──
    if (!options.apiKey && options.provider !== 'ollama' && !options.quick) {
      tui.log.error('❌ No API key available.\n');
      tui.log.error('   Quick fix: run "ghagga login" to authenticate with GitHub (free!)');
      tui.log.error('   Or pass --api-key <key> or set GHAGGA_API_KEY.');
      tui.log.error('   Or use --provider ollama for local models (no key needed).\n');
      process.exit(1);
    }

    // Ollama doesn't need an API key — use a placeholder
    if (options.provider === 'ollama' && !options.apiKey) {
      options.apiKey = 'ollama';
    }

    // ── Resolve model default ─────────────────────────────────
    const provider = options.provider as LLMProvider;
    const model = options.model ?? DEFAULT_MODELS[provider];

    await reviewCommand(path, {
      mode: options.mode as ReviewMode,
      provider,
      model,
      apiKey: options.apiKey ?? '',
      format: options.format as 'markdown' | 'json',
      semgrep: options.semgrep,
      trivy: options.trivy,
      cpd: options.cpd,
      memory: options.memory,
      memoryBackend: options.memoryBackend as 'sqlite' | 'engram' | undefined,
      config: options.config,
      verbose: options.verbose ?? false,
      staged: options.staged ?? false,
      commitMsg: options.commitMsg,
      exitOnIssues: options.exitOnIssues ?? false,
      quick: options.quick ?? false,
    });
  });

// ─── Memory ─────────────────────────────────────────────────────

program.addCommand(memoryCommand);

// ─── Hooks ──────────────────────────────────────────────────────

program.addCommand(hooksCommand);

program.parse();

// ─── Types ──────────────────────────────────────────────────────

interface ReviewCommandOptions {
  mode: string;
  provider?: string;
  model?: string;
  apiKey?: string;
  format: string;
  semgrep: boolean;
  trivy: boolean;
  cpd: boolean;
  memory: boolean;
  memoryBackend?: string;
  config?: string;
  verbose: boolean;
  // Hook-oriented flags (Phase 2: cli-git-hooks)
  staged?: boolean;
  commitMsg?: string;
  exitOnIssues?: boolean;
  quick?: boolean;
}
