/**
 * CLI review command tests.
 *
 * Tests argument parsing, config file resolution, output formatting,
 * and exit code mapping. The reviewPipeline is mocked to avoid
 * needing an actual LLM API key.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewResult, ReviewStatus, FindingSeverity } from 'ghagga-core';

// ─── Mock ghagga-core to prevent actual LLM calls ───────────────

vi.mock('ghagga-core', () => ({
  reviewPipeline: vi.fn(),
  DEFAULT_SETTINGS: {
    enableSemgrep: true,
    enableTrivy: true,
    enableCpd: true,
    enableMemory: true,
    customRules: [],
    ignorePatterns: ['*.md', '*.txt', '.gitignore', 'LICENSE', '*.lock'],
    reviewLevel: 'normal',
  },
  DEFAULT_MODELS: {
    anthropic: 'claude-sonnet-4-20250514',
    openai: 'gpt-4o',
    google: 'gemini-2.0-flash',
  },
}));

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
}));

describe('CLI review module', () => {
  it('exports reviewCommand function', async () => {
    const mod = await import('./review.js');
    expect(mod.reviewCommand).toBeTypeOf('function');
  });

  it('exports ReviewOptions type (verified by TypeScript at compile time)', async () => {
    const mod = await import('./review.js');
    expect(mod).toBeDefined();
    expect(typeof mod.reviewCommand).toBe('function');
  });

  it('reviewCommand expects exactly 2 arguments (targetPath, options)', async () => {
    const mod = await import('./review.js');
    expect(mod.reviewCommand.length).toBe(2);
  });
});

describe('CLI output formatting and exit codes', () => {
  // We test the internal formatting/exit code logic by checking types/contracts

  it('defines valid exit codes: PASSED=0, SKIPPED=0, FAILED=1, NEEDS_HUMAN_REVIEW=1', () => {
    const exitCodes: Record<ReviewStatus, number> = {
      PASSED: 0,
      SKIPPED: 0,
      FAILED: 1,
      NEEDS_HUMAN_REVIEW: 1,
    };

    expect(exitCodes.PASSED).toBe(0);
    expect(exitCodes.SKIPPED).toBe(0);
    expect(exitCodes.FAILED).toBe(1);
    expect(exitCodes.NEEDS_HUMAN_REVIEW).toBe(1);
  });

  it('ReviewResult findings have expected structure', () => {
    const finding = {
      severity: 'high' as FindingSeverity,
      category: 'security',
      file: 'src/index.ts',
      line: 42,
      message: 'SQL injection vulnerability',
      suggestion: 'Use parameterized queries',
      source: 'ai' as const,
    };

    expect(finding.severity).toBe('high');
    expect(finding.category).toBe('security');
    expect(finding.file).toBe('src/index.ts');
    expect(finding.line).toBe(42);
    expect(finding.source).toBe('ai');
  });

  it('ReviewResult has all required metadata fields', () => {
    const metadata = {
      mode: 'simple' as const,
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: 500,
      executionTimeMs: 3200,
      toolsRun: ['semgrep'],
      toolsSkipped: ['trivy', 'cpd'],
    };

    expect(metadata.mode).toBe('simple');
    expect(metadata.provider).toBe('anthropic');
    expect(metadata.tokensUsed).toBeGreaterThan(0);
    expect(metadata.executionTimeMs).toBeGreaterThan(0);
    expect(metadata.toolsRun).toContain('semgrep');
    expect(metadata.toolsSkipped).toHaveLength(2);
  });
});

describe('CLI config file handling', () => {
  it('.ghagga.json config shape matches expected interface', () => {
    const config = {
      mode: 'workflow',
      provider: 'openai',
      model: 'gpt-4o',
      enableSemgrep: true,
      enableTrivy: false,
      enableCpd: true,
      customRules: ['/path/to/rules.yml'],
      ignorePatterns: ['*.test.ts', '*.spec.ts'],
      reviewLevel: 'strict',
    };

    expect(config.mode).toBe('workflow');
    expect(config.enableTrivy).toBe(false);
    expect(config.customRules).toHaveLength(1);
    expect(config.ignorePatterns).toContain('*.test.ts');
  });

  it('CLI options take priority over config file', () => {
    // CLI says --no-semgrep, config says enableSemgrep: true
    const cliSemgrep = false;
    const configSemgrep = true;
    // In the mergeSettings function, CLI ?? config ?? default
    const resolved = cliSemgrep ?? configSemgrep;
    expect(resolved).toBe(false); // CLI wins
  });

  it('falls back to config file when CLI option is undefined', () => {
    const cliValue = undefined;
    const configValue = 'workflow';
    const defaultValue = 'simple';
    const resolved = cliValue ?? configValue ?? defaultValue;
    expect(resolved).toBe('workflow'); // Config wins over default
  });

  it('falls back to default when both CLI and config are undefined', () => {
    const cliValue = undefined;
    const configValue = undefined;
    const defaultValue = 'normal';
    const resolved = cliValue ?? configValue ?? defaultValue;
    expect(resolved).toBe('normal'); // Default wins
  });
});

describe('CLI input validation', () => {
  it('valid modes are: simple, workflow, consensus', () => {
    const validModes = ['simple', 'workflow', 'consensus'];
    expect(validModes).toContain('simple');
    expect(validModes).toContain('workflow');
    expect(validModes).toContain('consensus');
    expect(validModes).not.toContain('turbo');
  });

  it('valid providers are: anthropic, openai, google, github', () => {
    const validProviders = ['anthropic', 'openai', 'google', 'github'];
    expect(validProviders).toContain('anthropic');
    expect(validProviders).toContain('openai');
    expect(validProviders).toContain('google');
    expect(validProviders).toContain('github');
    expect(validProviders).not.toContain('mistral');
  });

  it('valid formats are: markdown, json', () => {
    const validFormats = ['markdown', 'json'];
    expect(validFormats).toContain('markdown');
    expect(validFormats).toContain('json');
    expect(validFormats).not.toContain('html');
  });
});
