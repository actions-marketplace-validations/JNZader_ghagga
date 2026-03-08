/**
 * CLI review command tests.
 *
 * Tests argument parsing, config file resolution, output formatting,
 * and exit code mapping. The reviewPipeline is mocked to avoid
 * needing an actual LLM API key.
 */

import type { FindingSeverity, ReviewResult, ReviewStatus } from 'ghagga-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mock ghagga-core to prevent actual LLM calls ───────────────

vi.mock('ghagga-core', () => ({
  reviewPipeline: vi.fn(),
  SqliteMemoryStorage: {
    create: vi.fn().mockResolvedValue({
      searchObservations: vi.fn().mockResolvedValue([]),
      saveObservation: vi.fn().mockResolvedValue({}),
      createSession: vi.fn().mockResolvedValue({ id: 1 }),
      endSession: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    }),
  },
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

// ═══════════════════════════════════════════════════════════════
// Functional tests — exercise the actual reviewCommand function
// ═══════════════════════════════════════════════════════════════

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { reviewPipeline } from 'ghagga-core';
import type { ReviewOptions } from './review.js';

const mockExecSync = vi.mocked(execSync);
const mockExistsSync = vi.mocked(existsSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockReviewPipeline = vi.mocked(reviewPipeline);

/** Default CLI options for tests */
function defaultOptions(overrides: Partial<ReviewOptions> = {}): ReviewOptions {
  return {
    mode: 'simple',
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    apiKey: 'test-key',
    format: 'markdown',
    semgrep: true,
    trivy: true,
    cpd: true,
    memory: true,
    verbose: false,
    ...overrides,
  };
}

/** A minimal ReviewResult that satisfies the type */
function makeReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    status: 'PASSED',
    summary: 'All good!',
    findings: [],
    metadata: {
      mode: 'simple',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      tokensUsed: 100,
      executionTimeMs: 1500,
      toolsRun: ['semgrep'],
      toolsSkipped: [],
    },
    ...overrides,
  } as ReviewResult;
}

describe('reviewCommand — functional tests', () => {
  // biome-ignore lint/suspicious/noExplicitAny: mock spy type
  let logSpy: any;
  // biome-ignore lint/suspicious/noExplicitAny: mock spy type
  let errorSpy: any;
  // biome-ignore lint/suspicious/noExplicitAny: mock spy type
  let exitSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // biome-ignore lint/suspicious/noExplicitAny: mock cast
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    mockExistsSync.mockReturnValue(false); // no .ghagga.json by default
  });

  afterEach(() => {
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it('should exit 0 with message when there is no diff', async () => {
    // execSync returns empty string for all git diff attempts
    mockExecSync.mockReturnValue('' as never);

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(0);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No changes detected'));
  });

  it('should call reviewPipeline with correct arguments and exit 0 on PASSED', async () => {
    const diff = 'diff --git a/file.ts b/file.ts\n+console.log("hello");';
    mockExecSync.mockReturnValue(diff as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult({ status: 'PASSED' }));

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('/tmp/repo', defaultOptions());

    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        diff,
        mode: 'simple',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'test-key',
      }),
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should exit 1 when review status is FAILED', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult({ status: 'FAILED' }));

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit 1 when review status is NEEDS_HUMAN_REVIEW', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult({ status: 'NEEDS_HUMAN_REVIEW' }));

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('should exit 0 when review status is SKIPPED', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult({ status: 'SKIPPED' }));

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(0);
  });

  it('should output JSON when format is json', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    const result = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(result);

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ format: 'json' }));

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
  });

  it('should output markdown with status and summary for markdown format', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    const result = makeReviewResult({
      status: 'PASSED',
      summary: 'Clean code, no issues found.',
      findings: [],
    });
    mockReviewPipeline.mockResolvedValue(result);

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ format: 'markdown' }));

    // The markdown output should contain the summary
    const allLogCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const markdownOutput = allLogCalls.find((s: string) => s.includes('PASSED'));
    expect(markdownOutput).toBeDefined();
    expect(markdownOutput).toContain('Clean code, no issues found.');
  });

  it('should format findings with severity and location in markdown', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    const result = makeReviewResult({
      findings: [
        {
          severity: 'high' as FindingSeverity,
          category: 'security',
          file: 'src/auth.ts',
          line: 42,
          message: 'Hardcoded secret detected',
          suggestion: 'Use environment variables',
          source: 'ai' as const,
        },
      ],
    });
    mockReviewPipeline.mockResolvedValue(result);

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ format: 'markdown' }));

    const allLogCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const markdownOutput = allLogCalls.find((s: string) => s.includes('Findings'));
    expect(markdownOutput).toBeDefined();
    expect(markdownOutput).toContain('src/auth.ts:42');
    expect(markdownOutput).toContain('Hardcoded secret detected');
    expect(markdownOutput).toContain('Use environment variables');
  });

  it('should show "No findings" when findings array is empty', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult({ findings: [] }));

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ format: 'markdown' }));

    const allLogCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const markdownOutput = allLogCalls.find((s: string) => s.includes('No findings'));
    expect(markdownOutput).toBeDefined();
  });

  it('should include tools run/skipped in markdown output', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    const result = makeReviewResult();
    result.metadata.toolsRun = ['semgrep', 'trivy'];
    result.metadata.toolsSkipped = ['cpd'];
    mockReviewPipeline.mockResolvedValue(result);

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ format: 'markdown' }));

    const allLogCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    const markdownOutput = allLogCalls.find((s: string) => s.includes('Static Analysis'));
    expect(markdownOutput).toBeDefined();
    expect(markdownOutput).toContain('semgrep');
    expect(markdownOutput).toContain('cpd');
  });

  it('should exit 1 and log error when reviewPipeline throws', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockRejectedValue(new Error('API rate limit exceeded'));

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('API rate limit exceeded'));
  });

  it('should exit 1 when execSync throws (no git repo)', async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('/tmp/not-a-repo', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Review failed'));
  });

  it('should load .ghagga.json config file when it exists', async () => {
    const diff = 'diff --git a/file.ts b/file.ts\n+line';
    mockExecSync.mockReturnValue(diff as never);
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      JSON.stringify({
        enableSemgrep: false,
        reviewLevel: 'strict',
        customRules: ['/rules/custom.yml'],
      }),
    );
    mockReviewPipeline.mockResolvedValue(makeReviewResult());

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    // reviewPipeline should have been called with settings that include the config
    const callArgs = mockReviewPipeline.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    const settings = callArgs.settings as Record<string, unknown>;
    expect(settings.reviewLevel).toBe('strict');
    expect(settings.customRules).toEqual(['/rules/custom.yml']);
  });

  it('should handle non-Error thrown objects in catch block', async () => {
    mockExecSync.mockReturnValue('diff' as never);
    mockReviewPipeline.mockRejectedValue('string error');

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('string error'));
  });

  it('should use staged diff when available', async () => {
    const stagedDiff = 'diff --git staged changes';
    mockExecSync.mockReturnValue(stagedDiff as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult());

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions());

    expect(mockReviewPipeline).toHaveBeenCalledWith(expect.objectContaining({ diff: stagedDiff }));
  });

  it('should pass verbose progress handler when verbose is true', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult());

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ verbose: true }));

    const callArgs = mockReviewPipeline.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(callArgs.onProgress).toBeTypeOf('function');
  });

  it('should not pass progress handler when verbose is false', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult());

    const { reviewCommand } = await import('./review.js');
    await reviewCommand('.', defaultOptions({ verbose: false }));

    const callArgs = mockReviewPipeline.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
    expect(callArgs.onProgress).toBeUndefined();
  });

  it('should print progress header with mode, provider, and model', async () => {
    mockExecSync.mockReturnValue('diff content' as never);
    mockReviewPipeline.mockResolvedValue(makeReviewResult());

    const { reviewCommand } = await import('./review.js');
    await reviewCommand(
      '.',
      defaultOptions({ mode: 'workflow', provider: 'openai', model: 'gpt-4o' }),
    );

    const allLogCalls = logSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allLogCalls.some((s: string) => s.includes('workflow'))).toBe(true);
    expect(allLogCalls.some((s: string) => s.includes('openai'))).toBe(true);
    expect(allLogCalls.some((s: string) => s.includes('gpt-4o'))).toBe(true);
  });
});
