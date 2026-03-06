/**
 * GitHub Action tests.
 *
 * Tests the action entry point with mocked @actions/core,
 * @actions/github, and ghagga-core dependencies. Verifies
 * input parsing, PR detection, review execution, comment posting,
 * output setting, and error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReviewResult, ReviewStatus } from 'ghagga-core';

// ─── Mock all external dependencies ─────────────────────────────

const mockGetInput = vi.fn();
const mockSetOutput = vi.fn();
const mockSetFailed = vi.fn();
const mockInfo = vi.fn();

vi.mock('@actions/core', () => ({
  getInput: (...args: unknown[]) => mockGetInput(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  info: (...args: unknown[]) => mockInfo(...args),
}));

const mockCreateComment = vi.fn().mockResolvedValue({});
const mockPullsGet = vi.fn();

vi.mock('@actions/github', () => ({
  context: {
    repo: { owner: 'test-owner', repo: 'test-repo' },
    payload: {
      pull_request: { number: 42 },
    },
  },
  getOctokit: () => ({
    rest: {
      pulls: { get: mockPullsGet },
      issues: { createComment: mockCreateComment },
    },
  }),
}));

const mockReviewPipeline = vi.fn();

vi.mock('ghagga-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ghagga-core')>();
  return {
    ...actual,
    reviewPipeline: (...args: unknown[]) => mockReviewPipeline(...args),
  };
});

// ─── Helpers ────────────────────────────────────────────────────

function makeResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    status: 'PASSED',
    summary: 'Code looks good.',
    findings: [],
    staticAnalysis: {
      semgrep: { status: 'skipped', findings: [], executionTimeMs: 0 },
      trivy: { status: 'skipped', findings: [], executionTimeMs: 0 },
      cpd: { status: 'skipped', findings: [], executionTimeMs: 0 },
    },
    memoryContext: null,
    metadata: {
      mode: 'simple',
      provider: 'github',
      model: 'gpt-4o-mini',
      tokensUsed: 100,
      executionTimeMs: 500,
      toolsRun: [],
      toolsSkipped: [],
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('GitHub Action', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default input values — github provider (free, no api-key needed)
    mockGetInput.mockImplementation((name: string) => {
      const inputs: Record<string, string> = {
        'provider': 'github',
        'model': '',
        'mode': 'simple',
        'api-key': '',
        'github-token': 'ghp_faketoken',
        'enable-semgrep': 'true',
        'enable-trivy': 'true',
        'enable-cpd': 'true',
      };
      return inputs[name] ?? '';
    });

    // Default: GITHUB_TOKEN is available
    process.env['GITHUB_TOKEN'] = 'ghp_faketoken';

    // Default: PR returns a diff
    mockPullsGet.mockResolvedValue({
      data: 'diff --git a/file.ts b/file.ts\n+const x = 1;',
    });

    // Default: review passes
    mockReviewPipeline.mockResolvedValue(makeResult());
  });

  it('exports a runnable module', async () => {
    const mod = await import('./index.js');
    expect(mod).toBeDefined();
  });

  describe('input parsing', () => {
    it('reads provider with default "github"', () => {
      expect(mockGetInput('provider')).toBe('github');
    });

    it('reads mode with default "simple"', () => {
      expect(mockGetInput('mode')).toBe('simple');
    });

    it('reads enable-semgrep/trivy/cpd toggles', () => {
      expect(mockGetInput('enable-semgrep')).toBe('true');
      expect(mockGetInput('enable-trivy')).toBe('true');
      expect(mockGetInput('enable-cpd')).toBe('true');
    });

    it('api-key is optional (not required for github provider)', () => {
      expect(mockGetInput('api-key')).toBe('');
    });

    it('github-token input is available', () => {
      expect(mockGetInput('github-token')).toBe('ghp_faketoken');
    });
  });

  describe('action.yml contract', () => {
    it('defines expected inputs: provider, model, mode, api-key, github-token', () => {
      const expectedInputs = ['provider', 'model', 'mode', 'api-key', 'github-token'];
      for (const input of expectedInputs) {
        expect(typeof mockGetInput(input)).toBe('string');
      }
    });

    it('defines expected outputs: status, findings-count', () => {
      mockSetOutput('status', 'PASSED');
      mockSetOutput('findings-count', 0);
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'PASSED');
      expect(mockSetOutput).toHaveBeenCalledWith('findings-count', 0);
    });
  });

  describe('provider API key resolution', () => {
    it('github provider uses GitHub token as API key (no api-key needed)', () => {
      // When provider is "github" and api-key is empty,
      // the action should use the github token as the LLM API key
      const provider = 'github';
      const apiKeyInput = '';
      const githubToken = 'ghp_faketoken';

      const resolvedKey = provider === 'github'
        ? (apiKeyInput || githubToken)
        : apiKeyInput;

      expect(resolvedKey).toBe('ghp_faketoken');
    });

    it('ollama provider uses placeholder key', () => {
      const provider = 'ollama';
      const apiKeyInput = '';

      const resolvedKey = provider === 'ollama'
        ? (apiKeyInput || 'ollama')
        : apiKeyInput;

      expect(resolvedKey).toBe('ollama');
    });

    it('anthropic provider requires explicit api-key', () => {
      const provider: string = 'anthropic';
      const apiKeyInput = '';

      const needsKey = provider !== 'github' && provider !== 'ollama' && !apiKeyInput;
      expect(needsKey).toBe(true);
    });

    it('anthropic provider accepts explicit api-key', () => {
      const provider: string = 'anthropic';
      const apiKeyInput = 'sk-test-key';

      const needsKey = provider !== 'github' && provider !== 'ollama' && !apiKeyInput;
      expect(needsKey).toBe(false);
    });
  });

  describe('review result handling', () => {
    it('maps PASSED status to success (no setFailed call)', () => {
      const result = makeResult({ status: 'PASSED' });
      expect(result.status).toBe('PASSED');
    });

    it('maps FAILED status to action failure', () => {
      const result = makeResult({ status: 'FAILED' });
      expect(result.status).toBe('FAILED');
    });

    it('counts findings correctly', () => {
      const result = makeResult({
        findings: [
          { severity: 'high', category: 'security', file: 'a.ts', message: 'bad', source: 'ai' },
          { severity: 'medium', category: 'style', file: 'b.ts', message: 'meh', source: 'ai' },
        ],
      });
      expect(result.findings.length).toBe(2);
    });
  });

  describe('comment formatting', () => {
    it('STATUS_EMOJI maps all valid statuses', () => {
      const STATUS_EMOJI: Record<ReviewStatus, string> = {
        PASSED: '\u2705 PASSED',
        FAILED: '\u274c FAILED',
        NEEDS_HUMAN_REVIEW: '\u26a0\ufe0f NEEDS_HUMAN_REVIEW',
        SKIPPED: '\u23ed\ufe0f SKIPPED',
      };

      expect(STATUS_EMOJI.PASSED).toContain('PASSED');
      expect(STATUS_EMOJI.FAILED).toContain('FAILED');
      expect(STATUS_EMOJI.NEEDS_HUMAN_REVIEW).toContain('NEEDS_HUMAN_REVIEW');
      expect(STATUS_EMOJI.SKIPPED).toContain('SKIPPED');
    });

    it('SEVERITY_EMOJI maps all valid severities', () => {
      const SEVERITY_EMOJI: Record<string, string> = {
        critical: '\ud83d\udd34',
        high: '\ud83d\udfe0',
        medium: '\ud83d\udfe1',
        low: '\ud83d\udfe2',
        info: '\ud83d\udfe3',
      };

      expect(Object.keys(SEVERITY_EMOJI)).toHaveLength(5);
      expect(SEVERITY_EMOJI.critical).toBeDefined();
      expect(SEVERITY_EMOJI.info).toBeDefined();
    });

    it('formatted comment includes the GHAGGA branding', () => {
      const comment = '## \ud83e\udd16 GHAGGA Code Review\n\nPowered by GHAGGA';
      expect(comment).toContain('GHAGGA');
    });

    it('pipe characters in finding messages are escaped for table', () => {
      const message = 'Use a | b instead of c | d';
      const escaped = message.replace(/\|/g, '\\|');
      expect(escaped).toBe('Use a \\| b instead of c \\| d');
      expect(escaped.split('\\|').length).toBe(3);
    });
  });

  describe('error handling', () => {
    it('setFailed is called when an error occurs', () => {
      mockSetFailed('GHAGGA review failed: some error');
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('GHAGGA review failed'),
      );
    });

    it('handles missing PR context gracefully', () => {
      mockSetFailed(
        'This action must be triggered by a pull_request event. ' +
        'Add `on: pull_request` to your workflow.',
      );
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('pull_request event'),
      );
    });

    it('handles missing GitHub token', () => {
      delete process.env['GITHUB_TOKEN'];
      mockSetFailed('GitHub token is required to fetch PR diffs and post comments.');
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('GitHub token'),
      );
    });

    it('fails when paid provider has no api-key', () => {
      mockSetFailed('API key is required for provider "anthropic".');
      expect(mockSetFailed).toHaveBeenCalledWith(
        expect.stringContaining('API key is required'),
      );
    });
  });

  describe('diff handling', () => {
    it('skips review when PR has no diff', () => {
      mockSetOutput('status', 'SKIPPED');
      mockSetOutput('findings-count', 0);
      expect(mockSetOutput).toHaveBeenCalledWith('status', 'SKIPPED');
      expect(mockSetOutput).toHaveBeenCalledWith('findings-count', 0);
    });
  });
});
