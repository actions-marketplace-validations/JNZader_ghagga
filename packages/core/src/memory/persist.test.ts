import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('ghagga-db', () => ({
  saveObservation: vi.fn(),
  createMemorySession: vi.fn(),
  endMemorySession: vi.fn(),
}));

vi.mock('./privacy.js', () => ({
  stripPrivateData: vi.fn((text: string) => `[STRIPPED]${text}`),
}));

import { saveObservation, createMemorySession, endMemorySession } from 'ghagga-db';
import { stripPrivateData } from './privacy.js';
import { persistReviewObservations } from './persist.js';
import type { ReviewResult, ReviewFinding } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

const mockSaveObservation = vi.mocked(saveObservation);
const mockCreateMemorySession = vi.mocked(createMemorySession);
const mockEndMemorySession = vi.mocked(endMemorySession);
const mockStripPrivateData = vi.mocked(stripPrivateData);

function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: 'high',
    category: 'security',
    file: 'src/auth.ts',
    line: 42,
    message: 'SQL injection vulnerability',
    suggestion: 'Use parameterized queries',
    source: 'ai',
    ...overrides,
  };
}

function makeResult(findings: ReviewFinding[] = [], overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    status: 'PASSED',
    summary: 'Review completed successfully.',
    findings,
    staticAnalysis: {
      semgrep: { status: 'skipped', findings: [], executionTimeMs: 0 },
      trivy: { status: 'skipped', findings: [], executionTimeMs: 0 },
      cpd: { status: 'skipped', findings: [], executionTimeMs: 0 },
    },
    memoryContext: null,
    metadata: {
      mode: 'simple',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      tokensUsed: 150,
      executionTimeMs: 1200,
      toolsRun: [],
      toolsSkipped: [],
    },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('persistReviewObservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateMemorySession.mockResolvedValue({ id: 1 } as any);
    mockSaveObservation.mockResolvedValue(undefined as any);
    mockEndMemorySession.mockResolvedValue(undefined as any);
  });

  // ── Early return on null/falsy db ──

  it('returns early when db is null', async () => {
    await persistReviewObservations(null, 'owner/repo', 1, makeResult());

    expect(mockCreateMemorySession).not.toHaveBeenCalled();
    expect(mockSaveObservation).not.toHaveBeenCalled();
    expect(mockEndMemorySession).not.toHaveBeenCalled();
  });

  it('returns early when db is undefined', async () => {
    await persistReviewObservations(undefined, 'owner/repo', 1, makeResult());

    expect(mockCreateMemorySession).not.toHaveBeenCalled();
  });

  it('returns early when db is empty string (falsy)', async () => {
    await persistReviewObservations('', 'owner/repo', 1, makeResult());

    expect(mockCreateMemorySession).not.toHaveBeenCalled();
  });

  // ── Session lifecycle ──

  it('creates a memory session with project and prNumber', async () => {
    const db = { connection: true };
    await persistReviewObservations(db, 'owner/repo', 42, makeResult());

    expect(mockCreateMemorySession).toHaveBeenCalledWith(db, {
      project: 'owner/repo',
      prNumber: 42,
    });
  });

  it('ends the memory session with a summary', async () => {
    const db = { connection: true };
    const result = makeResult([makeFinding({ severity: 'critical' })], { status: 'FAILED' });

    await persistReviewObservations(db, 'owner/repo', 7, result);

    expect(mockEndMemorySession).toHaveBeenCalledWith(
      db,
      1,
      expect.stringContaining('PR #7'),
    );
    expect(mockEndMemorySession).toHaveBeenCalledWith(
      db,
      1,
      expect.stringContaining('1 significant findings'),
    );
  });

  // ── Filtering: only critical and high ──

  it('only persists critical and high severity findings', async () => {
    const findings = [
      makeFinding({ severity: 'critical', message: 'Critical issue' }),
      makeFinding({ severity: 'high', message: 'High issue' }),
      makeFinding({ severity: 'medium', message: 'Medium issue' }),
      makeFinding({ severity: 'low', message: 'Low issue' }),
      makeFinding({ severity: 'info', message: 'Info issue' }),
    ];
    const result = makeResult(findings);

    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    // 2 finding observations + 1 summary = 3 saveObservation calls
    expect(mockSaveObservation).toHaveBeenCalledTimes(3);
  });

  it('does not persist medium, low, or info findings', async () => {
    const findings = [
      makeFinding({ severity: 'medium', message: 'Medium' }),
      makeFinding({ severity: 'low', message: 'Low' }),
      makeFinding({ severity: 'info', message: 'Info' }),
    ];
    const result = makeResult(findings);

    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    // No significant findings → no observations, no summary
    expect(mockSaveObservation).not.toHaveBeenCalled();
  });

  // ── Category → ObservationType mapping ──

  it('maps security category to discovery observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'critical', category: 'security' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'discovery' }));
  });

  it('maps bug category to bugfix observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'high', category: 'bug' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'bugfix' }));
  });

  it('maps performance category to pattern observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'high', category: 'performance' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'pattern' }));
  });

  it('maps style category to pattern observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'high', category: 'style' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'pattern' }));
  });

  it('maps maintainability category to pattern observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'high', category: 'maintainability' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'pattern' }));
  });

  it('maps error-handling category to learning observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'high', category: 'error-handling' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'learning' }));
  });

  it('maps unknown category to learning observation type', async () => {
    const result = makeResult([makeFinding({ severity: 'high', category: 'unknown-cat' })]);
    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    const findingCall = mockSaveObservation.mock.calls[0]!;
    expect(findingCall[1]).toEqual(expect.objectContaining({ type: 'learning' }));
  });

  // ── Private data stripping ──

  it('strips private data from finding message and suggestion', async () => {
    const result = makeResult([
      makeFinding({
        severity: 'critical',
        message: 'Secret: sk-ant-12345',
        suggestion: 'Remove the key: sk-ant-12345',
      }),
    ]);

    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    expect(mockStripPrivateData).toHaveBeenCalledWith('Secret: sk-ant-12345');
    expect(mockStripPrivateData).toHaveBeenCalledWith('Remove the key: sk-ant-12345');
  });

  it('does not strip suggestion when it is undefined', async () => {
    const result = makeResult([
      makeFinding({ severity: 'critical', suggestion: undefined }),
    ]);

    await persistReviewObservations({ db: true }, 'owner/repo', 1, result);

    // stripPrivateData called for message and summary, but NOT for suggestion
    const calls = mockStripPrivateData.mock.calls.map(c => c[0]);
    // Should be called for message, and for summary (in summary observation)
    // but not for undefined suggestion
    expect(calls).not.toContain(undefined);
  });

  // ── Observation content structure ──

  it('builds observation content with severity, category, file, and message', async () => {
    const finding = makeFinding({
      severity: 'critical',
      category: 'security',
      file: 'src/db.ts',
      line: 99,
      message: 'SQL injection detected',
      suggestion: 'Use prepared statements',
    });
    const result = makeResult([finding]);

    await persistReviewObservations({ db: true }, 'project', 1, result);

    const savedObs = mockSaveObservation.mock.calls[0]![1] as any;
    expect(savedObs.content).toContain('[CRITICAL]');
    expect(savedObs.content).toContain('security');
    expect(savedObs.content).toContain('src/db.ts:99');
    expect(savedObs.content).toContain('[STRIPPED]SQL injection detected');
    expect(savedObs.content).toContain('[STRIPPED]Use prepared statements');
  });

  it('omits line number when finding has no line', async () => {
    const finding = makeFinding({
      severity: 'high',
      file: 'package.json',
      line: undefined,
    });
    const result = makeResult([finding]);

    await persistReviewObservations({ db: true }, 'project', 1, result);

    const savedObs = mockSaveObservation.mock.calls[0]![1] as any;
    expect(savedObs.content).toContain('File: package.json');
    expect(savedObs.content).not.toContain('package.json:');
  });

  it('saves observation with correct sessionId, project, and filePaths', async () => {
    const finding = makeFinding({ severity: 'high', file: 'src/core.ts' });
    const result = makeResult([finding]);

    await persistReviewObservations({ db: true }, 'org/repo', 5, result);

    const savedObs = mockSaveObservation.mock.calls[0]![1] as any;
    expect(savedObs.sessionId).toBe(1);
    expect(savedObs.project).toBe('org/repo');
    expect(savedObs.filePaths).toEqual(['src/core.ts']);
  });

  it('truncates title to 80 chars of sanitized message', async () => {
    const longMessage = 'A'.repeat(200);
    const result = makeResult([
      makeFinding({ severity: 'high', category: 'bug', message: longMessage }),
    ]);

    await persistReviewObservations({ db: true }, 'project', 1, result);

    const savedObs = mockSaveObservation.mock.calls[0]![1] as any;
    // Title format: "category: sanitized_message.slice(0, 80)"
    // The sanitized message is [STRIPPED] + longMessage
    expect(savedObs.title.length).toBeLessThanOrEqual('bug: '.length + 80);
  });

  // ── Summary observation ──

  it('saves a summary observation when there are significant findings', async () => {
    const result = makeResult(
      [makeFinding({ severity: 'critical' }), makeFinding({ severity: 'high' })],
      { status: 'FAILED', summary: 'Critical issues found in auth.' },
    );

    await persistReviewObservations({ db: true }, 'org/repo', 10, result);

    // 2 finding observations + 1 summary = 3 calls
    const lastCall = mockSaveObservation.mock.calls[2]![1] as any;
    expect(lastCall.type).toBe('decision');
    expect(lastCall.title).toBe('PR #10 review: FAILED');
    expect(lastCall.topicKey).toBe('pr-10-review');
    expect(lastCall.filePaths).toHaveLength(2);
  });

  it('strips private data from summary content', async () => {
    const result = makeResult(
      [makeFinding({ severity: 'critical' })],
      { summary: 'Found key: sk-test-123' },
    );

    await persistReviewObservations({ db: true }, 'project', 1, result);

    expect(mockStripPrivateData).toHaveBeenCalledWith('Found key: sk-test-123');
  });

  it('does not save summary observation when no significant findings', async () => {
    const result = makeResult([
      makeFinding({ severity: 'medium' }),
      makeFinding({ severity: 'low' }),
    ]);

    await persistReviewObservations({ db: true }, 'project', 1, result);

    expect(mockSaveObservation).not.toHaveBeenCalled();
  });

  it('does not save summary when findings array is empty', async () => {
    const result = makeResult([]);

    await persistReviewObservations({ db: true }, 'project', 1, result);

    expect(mockSaveObservation).not.toHaveBeenCalled();
  });

  // ── Error handling ──

  it('catches errors from createMemorySession and does not throw', async () => {
    mockCreateMemorySession.mockRejectedValue(new Error('DB connection failed'));

    await expect(
      persistReviewObservations({ db: true }, 'project', 1, makeResult([makeFinding({ severity: 'critical' })]))
    ).resolves.toBeUndefined();
  });

  it('catches errors from saveObservation and does not throw', async () => {
    mockSaveObservation.mockRejectedValue(new Error('Write failed'));

    await expect(
      persistReviewObservations({ db: true }, 'project', 1, makeResult([makeFinding({ severity: 'critical' })]))
    ).resolves.toBeUndefined();
  });

  it('catches errors from endMemorySession and does not throw', async () => {
    mockEndMemorySession.mockRejectedValue(new Error('Session end failed'));

    await expect(
      persistReviewObservations({ db: true }, 'project', 1, makeResult([]))
    ).resolves.toBeUndefined();
  });

  it('logs a warning when an error occurs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreateMemorySession.mockRejectedValue(new Error('DB down'));

    await persistReviewObservations({ db: true }, 'project', 1, makeResult([makeFinding({ severity: 'critical' })]));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ghagga]'),
      expect.stringContaining('DB down'),
    );

    warnSpy.mockRestore();
  });

  it('logs string errors correctly', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockCreateMemorySession.mockRejectedValue('string error');

    await persistReviewObservations({ db: true }, 'project', 1, makeResult([makeFinding({ severity: 'critical' })]));

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ghagga]'),
      'string error',
    );

    warnSpy.mockRestore();
  });
});
