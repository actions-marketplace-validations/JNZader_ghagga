/**
 * Integration tests for the Inngest review function.
 *
 * Strategy: We mock all external dependencies (GitHub client, runner, DB,
 * core pipeline, logger) and invoke the raw function handler (`reviewFunction.fn`)
 * with a mocked Inngest step API. This lets us test the full orchestration logic —
 * step ordering, conditional dispatch/wait, data flow between steps — without
 * needing a running Inngest server.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ReviewResult, StaticAnalysisResult } from 'ghagga-core';

// ─── Mocks ──────────────────────────────────────────────────────

// GitHub client
const mockFetchPRDiff = vi.fn();
const mockGetPRCommitMessages = vi.fn();
const mockGetPRFileList = vi.fn();
const mockGetInstallationToken = vi.fn();
const mockPostComment = vi.fn();
const mockAddCommentReaction = vi.fn();

vi.mock('../github/client.js', () => ({
  fetchPRDiff: mockFetchPRDiff,
  getPRCommitMessages: mockGetPRCommitMessages,
  getPRFileList: mockGetPRFileList,
  getInstallationToken: mockGetInstallationToken,
  postComment: mockPostComment,
  addCommentReaction: mockAddCommentReaction,
}));

// Runner integration
const mockDiscoverRunnerRepo = vi.fn();
const mockDispatchWorkflow = vi.fn();

vi.mock('../github/runner.js', () => ({
  discoverRunnerRepo: mockDiscoverRunnerRepo,
  dispatchWorkflow: mockDispatchWorkflow,
}));

// Core review pipeline
const mockReviewPipeline = vi.fn();

vi.mock('ghagga-core', () => ({
  reviewPipeline: mockReviewPipeline,
}));

// Database
const mockCreateDatabaseFromEnv = vi.fn();
const mockSaveReview = vi.fn();
const mockDecrypt = vi.fn((v: string) => `decrypted-${v}`);

vi.mock('ghagga-db', () => ({
  createDatabaseFromEnv: mockCreateDatabaseFromEnv,
  saveReview: mockSaveReview,
  decrypt: mockDecrypt,
}));

// Logger — provide a silent child logger
vi.mock('../lib/logger.js', () => ({
  logger: {
    child: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// ─── Test Data Factories ────────────────────────────────────────

function makeSettings(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    enableSemgrep: false,
    enableTrivy: false,
    enableCpd: false,
    enableMemory: false,
    customRules: [] as string[],
    ignorePatterns: [] as string[],
    reviewLevel: 'standard',
    ...overrides,
  };
}

function makeEventData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    installationId: 12345,
    repoFullName: 'acme/widgets',
    prNumber: 42,
    repositoryId: 100,
    headSha: 'abc123',
    baseBranch: 'main',
    triggerCommentId: undefined,
    providerChain: undefined,
    aiReviewEnabled: true,
    llmProvider: 'anthropic',
    llmModel: 'claude-sonnet-4-20250514',
    reviewMode: 'standard',
    encryptedApiKey: 'encrypted-key-123',
    settings: makeSettings(),
    ...overrides,
  };
}

function makeReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    status: 'PASSED',
    summary: 'All good!',
    findings: [],
    staticAnalysis: {
      semgrep: { status: 'skipped', findings: [], executionTimeMs: 0 },
      trivy: { status: 'skipped', findings: [], executionTimeMs: 0 },
      cpd: { status: 'skipped', findings: [], executionTimeMs: 0 },
    },
    memoryContext: null,
    metadata: {
      mode: 'standard' as const,
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-20250514',
      tokensUsed: 1500,
      executionTimeMs: 3200,
      toolsRun: [],
      toolsSkipped: [],
    },
    ...overrides,
  };
}

function makeStaticAnalysis(): StaticAnalysisResult {
  return {
    semgrep: {
      status: 'success',
      findings: [
        {
          severity: 'medium',
          category: 'security',
          file: 'src/app.ts',
          line: 10,
          message: 'Potential injection',
          source: 'semgrep',
        },
      ],
      executionTimeMs: 2000,
    },
    trivy: { status: 'skipped', findings: [], executionTimeMs: 0 },
    cpd: { status: 'skipped', findings: [], executionTimeMs: 0 },
  };
}

// ─── Mock Step Builder ──────────────────────────────────────────

/**
 * Creates a mock Inngest step API that records all calls and lets
 * us configure return values per step name.
 *
 * `step.run(name, callback)` — executes the callback by default,
 * but can return a preconfigured value via `stepReturns`.
 *
 * `step.waitForEvent(name, opts)` — returns the preconfigured
 * value from `waitReturns[name]` or `null` (simulating timeout).
 */
function createMockStep(
  stepReturns: Record<string, unknown> = {},
  waitReturns: Record<string, unknown> = {},
) {
  const calls: Array<{ type: string; name: string; args?: unknown }> = [];

  const step = {
    run: vi.fn(async (name: string, callback: () => Promise<unknown>) => {
      calls.push({ type: 'run', name });

      // If a preconfigured return is provided, use it instead of the callback
      if (name in stepReturns) {
        return stepReturns[name];
      }

      // Execute the actual callback (integration-level test)
      return callback();
    }),

    waitForEvent: vi.fn(async (name: string, opts: unknown) => {
      calls.push({ type: 'waitForEvent', name, args: opts });
      return waitReturns[name] ?? null;
    }),
  };

  return { step, calls };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('inngest/review — function definition', () => {
  it('exports reviewFunction', async () => {
    const mod = await import('./review.js');
    expect(mod.reviewFunction).toBeDefined();
  });

  it('has correct id, trigger event, and retries', async () => {
    const mod = await import('./review.js');
    const fn = mod.reviewFunction;

    expect(fn).toBeTruthy();
    expect(typeof fn).toBe('object');
    // Inngest function opts contain id, retries, and triggers
    expect(fn.opts).toMatchObject({
      id: 'ghagga-review',
      retries: 3,
      triggers: [{ event: 'ghagga/review.requested' }],
    });
  });

  it('has a callable fn property (the raw handler)', async () => {
    const mod = await import('./review.js');
    expect(typeof mod.reviewFunction.fn).toBe('function');
  });
});

describe('inngest/review — dispatch-runner step', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = 'app-123';
    process.env.GITHUB_PRIVATE_KEY = 'private-key';
    process.env.ANTHROPIC_API_KEY = 'env-api-key';

    // Default mocks for happy path through all steps
    mockGetInstallationToken.mockResolvedValue('ghs_test-token');
    mockFetchPRDiff.mockResolvedValue('diff content');
    mockGetPRCommitMessages.mockResolvedValue(['feat: add widget']);
    mockGetPRFileList.mockResolvedValue(['src/widget.ts']);
    mockCreateDatabaseFromEnv.mockReturnValue({});
    mockSaveReview.mockResolvedValue(undefined);
    mockPostComment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('skips dispatch when no static analysis tools are enabled', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      settings: makeSettings({
        enableSemgrep: false,
        enableTrivy: false,
        enableCpd: false,
      }),
    });

    const { step, calls } = createMockStep();
    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // dispatch-runner was called but it should NOT trigger discoverRunnerRepo
    expect(mockDiscoverRunnerRepo).not.toHaveBeenCalled();
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();

    // waitForEvent should NOT have been called
    const waitCalls = calls.filter((c) => c.type === 'waitForEvent');
    expect(waitCalls).toHaveLength(0);
  });

  it('skips dispatch when runner repo is not found', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    mockDiscoverRunnerRepo.mockResolvedValue(null);

    const eventData = makeEventData({
      settings: makeSettings({ enableSemgrep: true }),
    });

    const { step, calls } = createMockStep();
    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // discoverRunnerRepo was called (since semgrep is enabled)
    expect(mockDiscoverRunnerRepo).toHaveBeenCalledWith('acme', 'ghs_test-token');

    // But dispatchWorkflow should NOT be called
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();

    // waitForEvent should NOT have been called
    const waitCalls = calls.filter((c) => c.type === 'waitForEvent');
    expect(waitCalls).toHaveLength(0);
  });

  it('dispatches runner and waits → receives static analysis results', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    mockDiscoverRunnerRepo.mockResolvedValue({
      repoId: 999,
      fullName: 'acme/ghagga-runner',
    });
    mockDispatchWorkflow.mockResolvedValue('callback-id-001');

    const staticAnalysis = makeStaticAnalysis();

    const eventData = makeEventData({
      settings: makeSettings({ enableSemgrep: true }),
    });

    const { step, calls } = createMockStep(
      {}, // No step.run overrides — let callbacks execute
      {
        // waitForEvent returns a simulated runner completion event
        'wait-for-runner': {
          data: {
            callbackId: 'callback-id-001',
            repoFullName: 'acme/widgets',
            prNumber: 42,
            headSha: 'abc123',
            staticAnalysis,
          },
        },
      },
    );

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // Runner discovery and dispatch both called
    expect(mockDiscoverRunnerRepo).toHaveBeenCalledWith('acme', 'ghs_test-token');
    expect(mockDispatchWorkflow).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerLogin: 'acme',
        repoFullName: 'acme/widgets',
        prNumber: 42,
        enableSemgrep: true,
        enableTrivy: false,
        enableCpd: false,
      }),
    );

    // waitForEvent called with correct event name and match
    const waitCalls = calls.filter((c) => c.type === 'waitForEvent');
    expect(waitCalls).toHaveLength(1);
    expect(waitCalls[0]!.name).toBe('wait-for-runner');
    expect(waitCalls[0]!.args).toMatchObject({
      event: 'ghagga/runner.completed',
      timeout: '10m',
    });
    expect(waitCalls[0]!.args.if).toContain('async.data.callbackId');

    // reviewPipeline should have received the precomputed static analysis
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        precomputedStaticAnalysis: staticAnalysis,
      }),
    );
  });

  it('dispatches runner and waits → timeout (null) → review runs without precomputed', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    mockDiscoverRunnerRepo.mockResolvedValue({
      repoId: 999,
      fullName: 'acme/ghagga-runner',
    });
    mockDispatchWorkflow.mockResolvedValue('callback-id-timeout');

    const eventData = makeEventData({
      settings: makeSettings({ enableSemgrep: true, enableTrivy: true }),
    });

    // waitForEvent returns null (simulating 10m timeout)
    const { step } = createMockStep(
      {},
      { 'wait-for-runner': null },
    );

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // Dispatch happened
    expect(mockDispatchWorkflow).toHaveBeenCalled();

    // waitForEvent was called
    expect(step.waitForEvent).toHaveBeenCalled();

    // reviewPipeline should NOT receive precomputedStaticAnalysis
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        precomputedStaticAnalysis: undefined,
      }),
    );
  });

  it('dispatch throws → fallback to no static analysis (graceful degradation)', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    mockDiscoverRunnerRepo.mockResolvedValue({
      repoId: 999,
      fullName: 'acme/ghagga-runner',
    });
    mockDispatchWorkflow.mockRejectedValue(new Error('GitHub API error: 422'));

    const eventData = makeEventData({
      settings: makeSettings({ enableSemgrep: true }),
    });

    // When dispatch throws inside step.run('dispatch-runner'), the catch
    // block returns { dispatched: false, callbackId: null }
    const { step, calls } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // dispatch was attempted
    expect(mockDispatchWorkflow).toHaveBeenCalled();

    // waitForEvent should NOT be called (dispatched === false)
    const waitCalls = calls.filter((c) => c.type === 'waitForEvent');
    expect(waitCalls).toHaveLength(0);

    // Review still runs — without precomputed
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        precomputedStaticAnalysis: undefined,
      }),
    );
  });

  it('skips dispatch when GITHUB_APP_ID is missing in dispatch-runner step', async () => {
    const mod = await import('./review.js');

    // fetch-context runs before dispatch-runner, and it also needs GITHUB_APP_ID.
    // post-comment also needs it. To isolate the dispatch-runner credential
    // check, we pre-supply return values for steps that would throw.
    delete process.env.GITHUB_APP_ID;

    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      settings: makeSettings({ enableSemgrep: true }),
    });

    // Pre-supply return values for steps that read GITHUB_APP_ID
    const { step, calls } = createMockStep({
      'fetch-context': {
        token: 'ghs_test-token',
        diff: 'diff',
        commitMessages: ['commit'],
        fileList: ['file.ts'],
      },
      'post-comment': undefined,
    });

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // dispatch-runner sees missing credentials → returns dispatched: false
    expect(mockDiscoverRunnerRepo).not.toHaveBeenCalled();
    expect(mockDispatchWorkflow).not.toHaveBeenCalled();

    // No wait
    const waitCalls = calls.filter((c) => c.type === 'waitForEvent');
    expect(waitCalls).toHaveLength(0);
  });
});

describe('inngest/review — full step orchestration', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = 'app-123';
    process.env.GITHUB_PRIVATE_KEY = 'private-key';
    process.env.ANTHROPIC_API_KEY = 'env-api-key';

    mockGetInstallationToken.mockResolvedValue('ghs_test-token');
    mockFetchPRDiff.mockResolvedValue('diff --git a/f.ts b/f.ts\n+new line');
    mockGetPRCommitMessages.mockResolvedValue(['feat: add widget', 'fix: typo']);
    mockGetPRFileList.mockResolvedValue(['src/widget.ts', 'README.md']);
    mockCreateDatabaseFromEnv.mockReturnValue({ db: 'mock' });
    mockSaveReview.mockResolvedValue(undefined);
    mockPostComment.mockResolvedValue(undefined);
    mockAddCommentReaction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('executes all 7 steps in order for a comment-triggered review', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      triggerCommentId: 9999,
      settings: makeSettings({ enableSemgrep: false }),
    });

    const { step, calls } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // Verify step execution order
    const stepNames = calls.map((c) => c.name);
    expect(stepNames).toEqual([
      'fetch-context',
      'dispatch-runner',
      'run-review',
      'save-review',
      'post-comment',
      'react-to-trigger',
    ]);
  });

  it('executes 6 steps (no react-to-trigger) when not comment-triggered', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      triggerCommentId: undefined,
      settings: makeSettings(),
    });

    const { step, calls } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    const stepNames = calls.map((c) => c.name);
    expect(stepNames).toEqual([
      'fetch-context',
      'dispatch-runner',
      'run-review',
      'save-review',
      'post-comment',
    ]);

    // react-to-trigger NOT called
    expect(mockAddCommentReaction).not.toHaveBeenCalled();
  });

  it('executes 7 steps with waitForEvent when runner dispatched (8 total calls)', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    mockDiscoverRunnerRepo.mockResolvedValue({
      repoId: 999,
      fullName: 'acme/ghagga-runner',
    });
    mockDispatchWorkflow.mockResolvedValue('cb-full-flow');

    const staticAnalysis = makeStaticAnalysis();
    const eventData = makeEventData({
      triggerCommentId: 7777,
      settings: makeSettings({ enableSemgrep: true, enableTrivy: true }),
    });

    const { step, calls } = createMockStep(
      {},
      {
        'wait-for-runner': {
          data: {
            callbackId: 'cb-full-flow',
            repoFullName: 'acme/widgets',
            prNumber: 42,
            headSha: 'abc123',
            staticAnalysis,
          },
        },
      },
    );

    const result = await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // Full flow: fetch-context, dispatch-runner, wait-for-runner,
    //            run-review, save-review, post-comment, react-to-trigger
    const stepNames = calls.map((c) => c.name);
    expect(stepNames).toEqual([
      'fetch-context',
      'dispatch-runner',
      'wait-for-runner',
      'run-review',
      'save-review',
      'post-comment',
      'react-to-trigger',
    ]);

    // Verify return value
    expect(result).toEqual({
      status: 'PASSED',
      prNumber: 42,
      repoFullName: 'acme/widgets',
    });
  });

  it('saves review with correct metadata', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult({
      status: 'FAILED',
      summary: 'Found issues',
      findings: [
        {
          severity: 'high',
          category: 'security',
          file: 'src/auth.ts',
          line: 55,
          message: 'SQL injection risk',
          source: 'ai',
        },
      ],
    });
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData();
    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    expect(mockSaveReview).toHaveBeenCalledWith(
      { db: 'mock' },
      expect.objectContaining({
        repositoryId: 100,
        prNumber: 42,
        status: 'FAILED',
        mode: 'standard',
        summary: 'Found issues',
        findings: reviewResult.findings,
        tokensUsed: 1500,
        executionTimeMs: 3200,
        metadata: reviewResult.metadata,
      }),
    );
  });

  it('posts a formatted comment to GitHub', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData();
    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    expect(mockPostComment).toHaveBeenCalledWith(
      'acme',          // owner
      'widgets',       // repo
      42,              // prNumber
      expect.stringContaining('GHAGGA Code Review'),
      'ghs_test-token',
    );
  });

  it('adds rocket reaction when comment-triggered', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({ triggerCommentId: 5555 });
    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    expect(mockAddCommentReaction).toHaveBeenCalledWith(
      'acme',
      'widgets',
      5555,
      'rocket',
      'ghs_test-token',
    );
  });
});

describe('inngest/review — provider chain / API key handling', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = 'app-123';
    process.env.GITHUB_PRIVATE_KEY = 'private-key';

    mockGetInstallationToken.mockResolvedValue('ghs_test-token');
    mockFetchPRDiff.mockResolvedValue('diff');
    mockGetPRCommitMessages.mockResolvedValue(['commit']);
    mockGetPRFileList.mockResolvedValue(['file.ts']);
    mockCreateDatabaseFromEnv.mockReturnValue({});
    mockSaveReview.mockResolvedValue(undefined);
    mockPostComment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('decrypts API key from encryptedApiKey (legacy single provider)', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      llmProvider: 'openai',
      llmModel: 'gpt-4o',
      encryptedApiKey: 'enc-openai-key',
      providerChain: undefined,
    });

    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    expect(mockDecrypt).toHaveBeenCalledWith('enc-openai-key');
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openai',
        model: 'gpt-4o',
        apiKey: 'decrypted-enc-openai-key',
      }),
    );
  });

  it('uses env variable API key when no encrypted key provided', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    process.env.ANTHROPIC_API_KEY = 'env-anthropic-key';

    const eventData = makeEventData({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      encryptedApiKey: null,
      providerChain: undefined,
    });

    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        apiKey: 'env-anthropic-key',
      }),
    );
  });

  it('decrypts provider chain entries and passes to pipeline', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      providerChain: [
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc-a' },
        { provider: 'openai', model: 'gpt-4o', encryptedApiKey: 'enc-o' },
      ],
    });

    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    expect(mockDecrypt).toHaveBeenCalledWith('enc-a');
    expect(mockDecrypt).toHaveBeenCalledWith('enc-o');
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        providerChain: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'decrypted-enc-a' },
          { provider: 'openai', model: 'gpt-4o', apiKey: 'decrypted-enc-o' },
        ],
      }),
    );
  });

  it('filters out github provider without API key (SaaS mode)', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      providerChain: [
        { provider: 'github', model: 'gpt-4o', encryptedApiKey: null },
        { provider: 'anthropic', model: 'claude-sonnet-4-20250514', encryptedApiKey: 'enc-a' },
      ],
    });

    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // github entry filtered, anthropic kept
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        providerChain: [
          { provider: 'anthropic', model: 'claude-sonnet-4-20250514', apiKey: 'decrypted-enc-a' },
        ],
      }),
    );
  });

  it('falls back to legacy when all chain entries are filtered out', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);
    process.env.ANTHROPIC_API_KEY = 'env-fallback-key';

    const eventData = makeEventData({
      llmProvider: 'anthropic',
      llmModel: 'claude-sonnet-4-20250514',
      encryptedApiKey: null,
      providerChain: [
        { provider: 'github', model: 'gpt-4o', encryptedApiKey: null },
      ],
    });

    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // All chain entries filtered → providerChain undefined → falls back to legacy
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        providerChain: undefined,
        provider: 'anthropic',
        apiKey: 'env-fallback-key',
      }),
    );
  });

  it('disables AI when legacy github provider has no API key (SaaS mode)', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      llmProvider: 'github',
      llmModel: 'gpt-4o',
      encryptedApiKey: null,
      providerChain: undefined,
    });

    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // Legacy github without key → AI disabled
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: undefined,
        apiKey: undefined,
      }),
    );
  });
});

describe('inngest/review — error handling', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = 'app-123';
    process.env.GITHUB_PRIVATE_KEY = 'private-key';

    mockGetInstallationToken.mockResolvedValue('ghs_test-token');
    mockFetchPRDiff.mockResolvedValue('diff');
    mockGetPRCommitMessages.mockResolvedValue(['commit']);
    mockGetPRFileList.mockResolvedValue(['file.ts']);
    mockCreateDatabaseFromEnv.mockReturnValue({});
    mockSaveReview.mockResolvedValue(undefined);
    mockPostComment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('throws when GITHUB_APP_ID is missing in fetch-context step', async () => {
    const mod = await import('./review.js');
    delete process.env.GITHUB_APP_ID;

    const eventData = makeEventData();
    const { step } = createMockStep();

    await expect(
      mod.reviewFunction.fn({
        event: { data: eventData } as any,
        step: step as any,
      } as any),
    ).rejects.toThrow('GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set');
  });

  it('throws when GITHUB_PRIVATE_KEY is missing in fetch-context step', async () => {
    const mod = await import('./review.js');
    delete process.env.GITHUB_PRIVATE_KEY;

    const eventData = makeEventData();
    const { step } = createMockStep();

    await expect(
      mod.reviewFunction.fn({
        event: { data: eventData } as any,
        step: step as any,
      } as any),
    ).rejects.toThrow('GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set');
  });

  it('throws when no API key configured for provider (no env, no encrypted)', async () => {
    const mod = await import('./review.js');
    delete process.env.ANTHROPIC_API_KEY;

    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData({
      llmProvider: 'anthropic',
      encryptedApiKey: null,
      providerChain: undefined,
    });

    const { step } = createMockStep();

    await expect(
      mod.reviewFunction.fn({
        event: { data: eventData } as any,
        step: step as any,
      } as any),
    ).rejects.toThrow(/No API key configured for provider anthropic/);
  });

  it('degrades gracefully when database is unavailable for memory', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult();
    mockReviewPipeline.mockResolvedValue(reviewResult);

    // First call (in run-review) throws, second call (in save-review) succeeds
    mockCreateDatabaseFromEnv
      .mockImplementationOnce(() => { throw new Error('DB connection failed'); })
      .mockReturnValueOnce({ db: 'ok' });

    const eventData = makeEventData();
    const { step } = createMockStep();

    // Should NOT throw — gracefully degrades
    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    // reviewPipeline should have been called with db: undefined
    expect(mockReviewPipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        db: undefined,
      }),
    );
  });
});

describe('inngest/review — formatReviewComment (via post-comment)', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GITHUB_APP_ID = 'app-123';
    process.env.GITHUB_PRIVATE_KEY = 'private-key';
    process.env.ANTHROPIC_API_KEY = 'test-key';

    mockGetInstallationToken.mockResolvedValue('ghs_test-token');
    mockFetchPRDiff.mockResolvedValue('diff');
    mockGetPRCommitMessages.mockResolvedValue(['commit']);
    mockGetPRFileList.mockResolvedValue(['file.ts']);
    mockCreateDatabaseFromEnv.mockReturnValue({});
    mockSaveReview.mockResolvedValue(undefined);
    mockPostComment.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('formats comment with findings table', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult({
      status: 'FAILED',
      summary: 'Security issues found',
      findings: [
        {
          severity: 'critical',
          category: 'security',
          file: 'src/auth.ts',
          line: 42,
          message: 'SQL injection vulnerability',
          source: 'ai',
        },
        {
          severity: 'low',
          category: 'style',
          file: 'src/utils.ts',
          message: 'Unused import',
          source: 'semgrep',
        },
      ],
      metadata: {
        mode: 'standard' as const,
        provider: 'anthropic' as const,
        model: 'claude-sonnet-4-20250514',
        tokensUsed: 2000,
        executionTimeMs: 5000,
        toolsRun: ['semgrep'],
        toolsSkipped: ['trivy'],
      },
    });
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData();
    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    const postedComment = mockPostComment.mock.calls[0]![3] as string;

    // Verify status line
    expect(postedComment).toContain('FAILED');

    // Verify summary
    expect(postedComment).toContain('Security issues found');

    // Verify findings table
    expect(postedComment).toContain('src/auth.ts:42');
    expect(postedComment).toContain('SQL injection vulnerability');
    expect(postedComment).toContain('src/utils.ts');
    expect(postedComment).toContain('Unused import');

    // Verify static analysis section
    expect(postedComment).toContain('Tools run: semgrep');
    expect(postedComment).toContain('Tools skipped: trivy');

    // Verify footer
    expect(postedComment).toContain('Powered by');
    expect(postedComment).toContain('GHAGGA');
  });

  it('formats comment without findings table when no findings', async () => {
    const mod = await import('./review.js');
    const reviewResult = makeReviewResult({
      status: 'PASSED',
      summary: 'Clean code!',
      findings: [],
      metadata: {
        mode: 'standard' as const,
        provider: 'anthropic' as const,
        model: 'claude-sonnet-4-20250514',
        tokensUsed: 1000,
        executionTimeMs: 2000,
        toolsRun: [],
        toolsSkipped: [],
      },
    });
    mockReviewPipeline.mockResolvedValue(reviewResult);

    const eventData = makeEventData();
    const { step } = createMockStep();

    await mod.reviewFunction.fn({
      event: { data: eventData } as any,
      step: step as any,
    } as any);

    const postedComment = mockPostComment.mock.calls[0]![3] as string;

    expect(postedComment).toContain('PASSED');
    expect(postedComment).toContain('Clean code!');
    // No findings table
    expect(postedComment).not.toContain('| Severity |');
  });
});
