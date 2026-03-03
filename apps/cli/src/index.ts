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
 *   GHAGGA_API_KEY     API key for the LLM provider
 *   GHAGGA_PROVIDER    LLM provider: anthropic, openai, google, github, ollama, qwen
 *   GHAGGA_MODEL       Model identifier
 *   GITHUB_TOKEN       GitHub token (fallback for github provider)
 */

import 'dotenv/config';

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Command } from 'commander';
import { DEFAULT_MODELS } from 'ghagga-core';
import type { LLMProvider, ReviewMode } from 'ghagga-core';
import { loadConfig, getStoredToken } from './lib/config.js';
import { reviewCommand } from './commands/review.js';
import { loginCommand } from './commands/login.js';
import { logoutCommand } from './commands/logout.js';
import { statusCommand } from './commands/status.js';

// Read version from package.json at runtime (no hardcoded strings)
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('ghagga')
  .description('AI-powered code review CLI')
  .version(pkg.version);

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
  .option(
    '-m, --mode <mode>',
    'Review mode',
    'simple',
  )
  .option(
    '-p, --provider <provider>',
    'LLM provider (auto-detected from login)',
    process.env['GHAGGA_PROVIDER'],
  )
  .option(
    '--model <model>',
    'LLM model identifier',
    process.env['GHAGGA_MODEL'],
  )
  .option(
    '--api-key <key>',
    'LLM provider API key',
    process.env['GHAGGA_API_KEY'],
  )
  .option(
    '-f, --format <format>',
    'Output format',
    'markdown',
  )
  .option('--no-semgrep', 'Disable Semgrep static analysis')
  .option('--no-trivy', 'Disable Trivy vulnerability scanning')
  .option('--no-cpd', 'Disable CPD duplicate detection')
  .option('-c, --config <path>', 'Path to .ghagga.json config file')
  .option('-v, --verbose', 'Show detailed progress during review')
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
        options.apiKey = process.env['GITHUB_TOKEN'] ?? storedToken ?? undefined;
      }
    }

    // ── Validate mode ─────────────────────────────────────────
    const validModes: ReviewMode[] = ['simple', 'workflow', 'consensus'];
    if (!validModes.includes(options.mode as ReviewMode)) {
      console.error(
        `\u274c Invalid mode "${options.mode}". Choose from: ${validModes.join(', ')}`,
      );
      process.exit(1);
    }

    // ── Validate provider ─────────────────────────────────────
    const validProviders: LLMProvider[] = ['anthropic', 'openai', 'google', 'github', 'ollama', 'qwen'];
    if (!validProviders.includes(options.provider as LLMProvider)) {
      console.error(
        `\u274c Invalid provider "${options.provider}". Choose from: ${validProviders.join(', ')}`,
      );
      process.exit(1);
    }

    // ── Validate format ───────────────────────────────────────
    const validFormats = ['markdown', 'json'];
    if (!validFormats.includes(options.format)) {
      console.error(
        `\u274c Invalid format "${options.format}". Choose from: ${validFormats.join(', ')}`,
      );
      process.exit(1);
    }

    // ── Validate API key (not required for ollama) ─────────────
    if (!options.apiKey && options.provider !== 'ollama') {
      console.error('\u274c No API key available.\n');
      console.error('   Quick fix: run "ghagga login" to authenticate with GitHub (free!)');
      console.error('   Or pass --api-key <key> or set GHAGGA_API_KEY.');
      console.error('   Or use --provider ollama for local models (no key needed).\n');
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
      apiKey: options.apiKey!,
      format: options.format as 'markdown' | 'json',
      semgrep: options.semgrep,
      trivy: options.trivy,
      cpd: options.cpd,
      config: options.config,
      verbose: options.verbose ?? false,
    });
  });

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
  config?: string;
  verbose: boolean;
}
