/**
 * Integration test: Dispatch → Callback → Resume flow.
 *
 * Tests the Inngest review function's step orchestration logic
 * for the dispatch-wait-resume pattern (steps 2-4). Validates
 * that data flows correctly between:
 *   dispatch-runner → wait-for-runner → run-review
 *
 * Strategy:
 *   - Mock `inngest.createFunction` to capture the handler
 *   - Invoke the handler with a mocked `step` object
 *   - Mock ALL external calls (GitHub, LLM, DB)
 *   - Assert data flow between steps
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StaticAnalysisResult } from 'ghagga-core';

// ─── Constants ──────────────────────────────────────────────────

const MOCK_REVIEW_RESULT = {
  status: 'PASSED' as const,
  summary: 'Code looks good',
  findings: [],
  staticAnalysis: {
    semgrep: { status: 'success' as const, findings: [], executionTimeMs: 100 },
    trivy: { status: 'success' as const, findings: [], executionTimeMs: 80 },
    cpd: { status: 'success' as const, findings: [], executionTimeMs: 50 },
  },
  memoryContext: null,
  metadata: {
    mode: 'quick' as const,
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    tokensUsed: 1000,
    executionTimeMs: 2500,
    toolsRun: ['semgrep', 'trivy'],
    toolsSkipped: ['cpd'],
  },
};

const MOCK_EVENT_DATA = {
  installationId: 12345,
  repoFullName: 'test-owner/test-repo',
  prNumber: 42,
  repositoryId: 1,
  headSha: 'abc123def456',
  baseBranch: 'main',
  llmProvider: 'anthropic',
  llmModel: 'claude-sonnet-4-20250514',
  reviewMode: 'quick',
  encryptedApiKey: null,
  settings: {
    enableSemgrep: true,
    enableTrivy: true,
    enableCpd: true,
    enableMemory: false,
    customRules: [],
    ignorePatterns: [],
    reviewLevel: 'standard',
  },
};

const MOCK_CONTEXT = {
  token: 'ghs_fake_token',
  diff: 'diff --git a/file.ts b/file.ts\n+console.log("hello")',
  commitMessages: ['feat: add hello'],
  fileList: ['file.ts'],
};

// ─── Mocks ──────────────────────────────────────────────────────

// Capture the handler passed to inngest.createFunction
let capturedHandler: (args: { event: unknown; step: unknown }) => Promise<unknown>;

vi.mock('../client.js', () => ({
  inngest: {
    createFunction: (
      _config: unknown,
      _trigger: unknown,
      handler: (args: { event: unknown; step: unknown }) => Promise<unknown>,
    ) => {
      capturedHandler = handler;
      return { id: 'ghagga-review', __handler: handler };
    },
  },
}));

// Mock reviewPipeline — captures the input for assertions
const mockReviewPipeline = vi.fn().mockResolvedValue(MOCK_REVIEW_RESULT);
vi.mock('ghagga-core', () => ({
  reviewPipeline: (...args: unknown[]) => mockReviewPipeline(...args),
}));

// Mock GitHub client
vi.mock('../../github/client.js', () => ({
  getInstallationToken: vi.fn().mockResolvedValue('ghs_fake_token'),
  fetchPRDiff: vi.fn().mockResolvedValue('mock-diff'),
  getPRCommitMessages: vi.fn().mockResolvedValue(['feat: mock']),
  getPRFileList: vi.fn().mockResolvedValue(['file.ts']),
  postComment: vi.fn().mockResolvedValue(undefined),
  addCommentReaction: vi.fn().mockResolvedValue(undefined),
}));

// Mock dispatchAnalysis
vi.mock('../../github/runner.js', () => ({
  dispatchAnalysis: vi.fn(),
}));

// Mock ghagga-db
vi.mock('ghagga-db', () => ({
  createDatabaseFromEnv: vi.fn().mockReturnValue({}),
  saveReview: vi.fn().mockResolvedValue(undefined),
  decrypt: vi.fn((v: string) => `decrypted-${v}`),
}));

// ─── Step Mock Factory ──────────────────────────────────────────

interface StepMockConfig {
  runResults: Record<string, unknown>;
  waitForEventResult?: unknown;
}

/**
 * Creates a mock Inngest `step` object that records calls and returns
 * configured results for each named step.
 */
function createMockStep(config: StepMockConfig) {
  const calls: {
    run: Array<{ name: string; fn: () => unknown }>;
    waitForEvent: Array<{ name: string; opts: unknown }>;
  } = { run: [], waitForEvent: [] };

  const step = {
    run: vi.fn(async (name: string, fn: () => unknown) => {
      // If we have a pre-configured result, return it (simulates step replay)
      if (name in config.runResults) {
        calls.run.push({ name, fn });
        return config.runResults[name];
      }
      // Otherwise execute the function (for steps we want to observe)
      calls.run.push({ name, fn });
      return fn();
    }),

    waitForEvent: vi.fn(async (name: string, opts: unknown) => {
      calls.waitForEvent.push({ name, opts });
      return config.waitForEventResult;
    }),
  };

  return { step, calls };
}

// ─── Setup ──────────────────────────────────────────────────────

let originalEnv: Record<string, string | undefined>;

beforeEach(async () => {
  vi.clearAllMocks();

  // Set required env vars
  originalEnv = {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID,
    GITHUB_PRIVATE_KEY: process.env.GITHUB_PRIVATE_KEY,
    RENDER_EXTERNAL_URL: process.env.RENDER_EXTERNAL_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  };
  process.env.GITHUB_APP_ID = 'test-app-id';
  process.env.GITHUB_PRIVATE_KEY = 'test-private-key';
  process.env.RENDER_EXTERNAL_URL = 'https://test.example.com';
  process.env.ANTHROPIC_API_KEY = 'sk-test-key';

  // Import the module to trigger createFunction and capture the handler
  await import('../review.js');
});

// Restore env
import { afterEach } from 'vitest';
afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// ═══════════════════════════════════════════════════════════════════
// Test Suite: Dispatch → Callback → Resume Flow
// ═══════════════════════════════════════════════════════════════════

describe('Review function: Dispatch → Wait → Resume orchestration', () => {
  // ── Test 1: Happy path — callback received ──────────────────

  it('happy path: callback received → pipeline gets precomputed results', async () => {
    // Arrange
    const mockFindings = [
      {
        severity: 'high' as const,
        category: 'security',
        file: 'src/auth.ts',
        line: 42,
        message: 'Potential SQL injection',
        source: 'semgrep' as const,
      },
    ];

    const mockStaticAnalysis: StaticAnalysisResult = {
      semgrep: { status: 'success', findings: mockFindings, executionTimeMs: 150 },
      trivy: { status: 'success', findings: [], executionTimeMs: 90 },
      cpd: { status: 'skipped', findings: [], error: 'CPD disabled', executionTimeMs: 0 },
    };

    const { step, calls } = createMockStep({
      runResults: {
        'fetch-context': MOCK_CONTEXT,
        'dispatch-runner': { dispatched: true, callbackId: 'test-cb-123', callbackSignature: 'sha256=abc' },
        'run-review': MOCK_REVIEW_RESULT,
        'save-review': undefined,
        'post-comment': undefined,
      },
      waitForEventResult: {
        name: 'ghagga/runner.completed',
        data: {
          callbackId: 'test-cb-123',
          staticAnalysis: mockStaticAnalysis,
        },
      },
    });

    const event = { data: { ...MOCK_EVENT_DATA } };

    // Act
    const result = await capturedHandler({ event, step });

    // Assert: function completed successfully
    expect(result).toEqual({
      status: 'PASSED',
      prNumber: 42,
      repoFullName: 'test-owner/test-repo',
    });

    // Assert: waitForEvent was called with correct config
    expect(calls.waitForEvent).toHaveLength(1);
    expect(calls.waitForEvent[0]!.name).toBe('wait-for-runner');
    expect(calls.waitForEvent[0]!.opts).toEqual({
      event: 'ghagga/runner.completed',
      match: 'data.callbackId',
      timeout: '10m',
    });

    // Assert: run-review step was called (it's in our pre-configured results)
    const runReviewCall = calls.run.find((c) => c.name === 'run-review');
    expect(runReviewCall).toBeDefined();

    // To verify the data flow, we need to execute the run-review function
    // and inspect what it passes to reviewPipeline.
    // Re-run with a step mock that actually executes run-review's function:
    const { step: step2 } = createMockStep({
      runResults: {
        'fetch-context': MOCK_CONTEXT,
        'dispatch-runner': { dispatched: true, callbackId: 'test-cb-123', callbackSignature: 'sha256=abc' },
        // 'run-review' NOT in runResults → fn will execute
        'save-review': undefined,
        'post-comment': undefined,
      },
      waitForEventResult: {
        name: 'ghagga/runner.completed',
        data: {
          callbackId: 'test-cb-123',
          staticAnalysis: mockStaticAnalysis,
        },
      },
    });

    mockReviewPipeline.mockResolvedValue(MOCK_REVIEW_RESULT);
    await capturedHandler({ event, step: step2 });

    // Assert: reviewPipeline was called with precomputedStaticAnalysis
    expect(mockReviewPipeline).toHaveBeenCalled();
    const pipelineInput = mockReviewPipeline.mock.calls[0]![0];
    expect(pipelineInput.precomputedStaticAnalysis).toEqual(mockStaticAnalysis);
    expect(pipelineInput.precomputedStaticAnalysis.semgrep.status).toBe('success');
    expect(pipelineInput.precomputedStaticAnalysis.semgrep.findings).toEqual(mockFindings);
  });

  // ── Test 2: Timeout path — no callback ────────────────────

  it('timeout path: no callback → pipeline gets all-skipped results', async () => {
    // Arrange
    const { step } = createMockStep({
      runResults: {
        'fetch-context': MOCK_CONTEXT,
        'dispatch-runner': { dispatched: true, callbackId: 'test-cb-timeout', callbackSignature: 'sha256=xyz' },
        // 'run-review' NOT pre-configured → executes the real fn body
        'save-review': undefined,
        'post-comment': undefined,
      },
      // waitForEvent returns null → simulates 10 minute timeout
      waitForEventResult: null,
    });

    mockReviewPipeline.mockResolvedValue(MOCK_REVIEW_RESULT);
    const event = { data: { ...MOCK_EVENT_DATA } };

    // Act
    await capturedHandler({ event, step });

    // Assert: reviewPipeline was called
    expect(mockReviewPipeline).toHaveBeenCalled();
    const pipelineInput = mockReviewPipeline.mock.calls[0]![0];

    // Assert: precomputedStaticAnalysis has all-skipped results
    const staticAnalysis = pipelineInput.precomputedStaticAnalysis as StaticAnalysisResult;
    expect(staticAnalysis).toBeDefined();

    // All three tools should be 'skipped' with the timeout error
    for (const tool of ['semgrep', 'trivy', 'cpd'] as const) {
      expect(staticAnalysis[tool].status).toBe('skipped');
      expect(staticAnalysis[tool].findings).toEqual([]);
      expect(staticAnalysis[tool].error).toBe('Runner timeout (10 min)');
      expect(staticAnalysis[tool].executionTimeMs).toBe(0);
    }
  });

  // ── Test 3: Skip path — dispatch failed ───────────────────

  it('skip path: dispatch failed → pipeline runs without precomputedStaticAnalysis', async () => {
    // Arrange
    const { step, calls } = createMockStep({
      runResults: {
        'fetch-context': MOCK_CONTEXT,
        'dispatch-runner': { dispatched: false, reason: 'Missing GitHub App credentials' },
        // 'run-review' NOT pre-configured → executes the real fn body
        'save-review': undefined,
        'post-comment': undefined,
      },
      waitForEventResult: null,
    });

    mockReviewPipeline.mockResolvedValue(MOCK_REVIEW_RESULT);
    const event = { data: { ...MOCK_EVENT_DATA } };

    // Act
    await capturedHandler({ event, step });

    // Assert: waitForEvent was NOT called (dispatch failed → skip wait)
    expect(calls.waitForEvent).toHaveLength(0);
    expect(step.waitForEvent).not.toHaveBeenCalled();

    // Assert: reviewPipeline was called
    expect(mockReviewPipeline).toHaveBeenCalled();
    const pipelineInput = mockReviewPipeline.mock.calls[0]![0];

    // Assert: precomputedStaticAnalysis is undefined (pipeline will run local tools)
    expect(pipelineInput.precomputedStaticAnalysis).toBeUndefined();
  });

  // ── Test 4: Data integrity — dispatch result carries callbackId ──

  it('dispatch callbackId is used to correlate with waitForEvent match', async () => {
    // Arrange
    const { step, calls } = createMockStep({
      runResults: {
        'fetch-context': MOCK_CONTEXT,
        'dispatch-runner': { dispatched: true, callbackId: 'correlation-uuid-789', callbackSignature: 'sha256=sig' },
        'run-review': MOCK_REVIEW_RESULT,
        'save-review': undefined,
        'post-comment': undefined,
      },
      waitForEventResult: {
        name: 'ghagga/runner.completed',
        data: {
          callbackId: 'correlation-uuid-789',
          staticAnalysis: {
            semgrep: { status: 'success', findings: [], executionTimeMs: 10 },
            trivy: { status: 'success', findings: [], executionTimeMs: 10 },
            cpd: { status: 'success', findings: [], executionTimeMs: 10 },
          },
        },
      },
    });

    const event = { data: { ...MOCK_EVENT_DATA } };

    // Act
    await capturedHandler({ event, step });

    // Assert: waitForEvent uses data.callbackId for matching
    expect(calls.waitForEvent).toHaveLength(1);
    const waitOpts = calls.waitForEvent[0]!.opts as { event: string; match: string; timeout: string };
    expect(waitOpts.match).toBe('data.callbackId');
    expect(waitOpts.event).toBe('ghagga/runner.completed');
    expect(waitOpts.timeout).toBe('10m');
  });

  // ── Test 5: All steps execute in correct order ────────────

  it('steps execute in the correct order: fetch → dispatch → wait → review → save → post', async () => {
    // Arrange
    const executionOrder: string[] = [];

    const step = {
      run: vi.fn(async (name: string, fn: () => unknown) => {
        executionOrder.push(name);
        const results: Record<string, unknown> = {
          'fetch-context': MOCK_CONTEXT,
          'dispatch-runner': { dispatched: true, callbackId: 'order-test', callbackSignature: 'sha256=ord' },
          'run-review': MOCK_REVIEW_RESULT,
          'save-review': undefined,
          'post-comment': undefined,
        };
        if (name in results) return results[name];
        return fn();
      }),
      waitForEvent: vi.fn(async (name: string) => {
        executionOrder.push(name);
        return {
          name: 'ghagga/runner.completed',
          data: {
            callbackId: 'order-test',
            staticAnalysis: {
              semgrep: { status: 'success', findings: [], executionTimeMs: 0 },
              trivy: { status: 'success', findings: [], executionTimeMs: 0 },
              cpd: { status: 'success', findings: [], executionTimeMs: 0 },
            },
          },
        };
      }),
    };

    const event = { data: { ...MOCK_EVENT_DATA } };

    // Act
    await capturedHandler({ event, step });

    // Assert: correct order
    expect(executionOrder).toEqual([
      'fetch-context',
      'dispatch-runner',
      'wait-for-runner',
      'run-review',
      'save-review',
      'post-comment',
      // no 'react-to-trigger' because triggerCommentId is not set
    ]);
  });

  // ── Test 6: Trigger comment reaction step runs when triggerCommentId is set ──

  it('executes react-to-trigger step when triggerCommentId is provided', async () => {
    // Arrange
    const executionOrder: string[] = [];

    const step = {
      run: vi.fn(async (name: string) => {
        executionOrder.push(name);
        const results: Record<string, unknown> = {
          'fetch-context': MOCK_CONTEXT,
          'dispatch-runner': { dispatched: false, reason: 'test skip' },
          'run-review': MOCK_REVIEW_RESULT,
          'save-review': undefined,
          'post-comment': undefined,
          'react-to-trigger': undefined,
        };
        return results[name];
      }),
      waitForEvent: vi.fn(),
    };

    const event = {
      data: {
        ...MOCK_EVENT_DATA,
        triggerCommentId: 99999, // triggers the reaction step
      },
    };

    // Act
    await capturedHandler({ event, step });

    // Assert: react-to-trigger was called
    expect(executionOrder).toContain('react-to-trigger');
  });
});
