#!/usr/bin/env node

/**
 * GHAGGA CLI — AI-powered code review from the command line.
 *
 * Usage:
 *   ghagga review [path]          Review staged or uncommitted changes
 *   ghagga review --mode workflow  Use workflow mode (5 specialist agents)
 *   ghagga review --format json    Output raw JSON
 *
 * Environment variables:
 *   GHAGGA_API_KEY     API key for the LLM provider (required)
 *   GHAGGA_PROVIDER    LLM provider: anthropic, openai, google, github (default: anthropic)
 *   GHAGGA_MODEL       Model identifier (default: auto based on provider)
 *
 * GitHub Models provider:
 *   Uses your GitHub PAT (with models:read scope) to access AI models
 *   for free via https://models.inference.ai.azure.com. Pass your token
 *   via GHAGGA_API_KEY, GITHUB_TOKEN, or --api-key. Default model: gpt-4o-mini.
 */

import 'dotenv/config';

import { Command } from 'commander';
import { DEFAULT_MODELS } from '@ghagga/core';
import type { LLMProvider, ReviewMode } from '@ghagga/core';
import { reviewCommand } from './commands/review.js';

const program = new Command();

program
  .name('ghagga')
  .description('AI-powered code review CLI')
  .version('2.0.0');

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
    'LLM provider',
    process.env['GHAGGA_PROVIDER'] ?? 'anthropic',
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
  .action(async (path: string, options: ReviewCommandOptions) => {
    // Validate mode
    const validModes: ReviewMode[] = ['simple', 'workflow', 'consensus'];
    if (!validModes.includes(options.mode as ReviewMode)) {
      console.error(
        `\u274c Invalid mode "${options.mode}". Choose from: ${validModes.join(', ')}`,
      );
      process.exit(1);
    }

    // Validate provider
    const validProviders: LLMProvider[] = ['anthropic', 'openai', 'google', 'github'];
    if (!validProviders.includes(options.provider as LLMProvider)) {
      console.error(
        `\u274c Invalid provider "${options.provider}". Choose from: ${validProviders.join(', ')}`,
      );
      process.exit(1);
    }

    // For GitHub Models provider, fall back to GITHUB_TOKEN if no API key set
    if (options.provider === 'github' && !options.apiKey) {
      options.apiKey = process.env['GITHUB_TOKEN'];
    }

    // Validate format
    const validFormats = ['markdown', 'json'];
    if (!validFormats.includes(options.format)) {
      console.error(
        `\u274c Invalid format "${options.format}". Choose from: ${validFormats.join(', ')}`,
      );
      process.exit(1);
    }

    // Validate API key
    if (!options.apiKey) {
      console.error(
        '\u274c API key is required. Set GHAGGA_API_KEY or pass --api-key.',
      );
      process.exit(1);
    }

    // Resolve model default from provider if not set
    const provider = options.provider as LLMProvider;
    const model = options.model ?? DEFAULT_MODELS[provider];

    await reviewCommand(path, {
      mode: options.mode as ReviewMode,
      provider,
      model,
      apiKey: options.apiKey,
      format: options.format as 'markdown' | 'json',
      semgrep: options.semgrep,
      trivy: options.trivy,
      cpd: options.cpd,
      config: options.config,
    });
  });

program.parse();

// ─── Types ──────────────────────────────────────────────────────

interface ReviewCommandOptions {
  mode: string;
  provider: string;
  model?: string;
  apiKey?: string;
  format: string;
  semgrep: boolean;
  trivy: boolean;
  cpd: boolean;
  config?: string;
}
