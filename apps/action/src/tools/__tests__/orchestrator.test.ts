import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('../semgrep.js', () => ({
  executeSemgrep: vi.fn(),
}));

vi.mock('../trivy.js', () => ({
  executeTrivy: vi.fn(),
}));

vi.mock('../cpd.js', () => ({
  executeCpd: vi.fn(),
}));

import * as core from '@actions/core';
import { executeCpd } from '../cpd.js';
import { runLocalAnalysis } from '../orchestrator.js';
import { executeSemgrep } from '../semgrep.js';
import { executeTrivy } from '../trivy.js';
import type { ToolResult } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

const mockExecuteSemgrep = vi.mocked(executeSemgrep);
const mockExecuteTrivy = vi.mocked(executeTrivy);
const mockExecuteCpd = vi.mocked(executeCpd);
const mockInfo = vi.mocked(core.info);

function makeSuccessResult(findingCount = 0, timeMs = 100): ToolResult {
  return {
    status: 'success',
    findings: Array.from({ length: findingCount }, (_, i) => ({
      severity: 'medium' as const,
      category: 'test',
      file: `file${i}.ts`,
      line: i + 1,
      message: `Finding ${i}`,
      source: 'semgrep' as const,
    })),
    executionTimeMs: timeMs,
  };
}

function makeErrorResult(error = 'Tool failed', timeMs = 50): ToolResult {
  return {
    status: 'error',
    findings: [],
    error,
    executionTimeMs: timeMs,
  };
}

const SKIPPED: ToolResult = {
  status: 'skipped',
  findings: [],
  executionTimeMs: 0,
};

// ─── Tests ──────────────────────────────────────────────────────

describe('runLocalAnalysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── All tools enabled, all succeed ──

  it('returns full StaticAnalysisResult when all tools succeed', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult(2, 100));
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult(1, 200));
    mockExecuteCpd.mockResolvedValue(makeSuccessResult(3, 150));

    const result = await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(result.semgrep.status).toBe('success');
    expect(result.semgrep.findings).toHaveLength(2);
    expect(result.trivy.status).toBe('success');
    expect(result.trivy.findings).toHaveLength(1);
    expect(result.cpd.status).toBe('success');
    expect(result.cpd.findings).toHaveLength(3);
  });

  it('passes repoDir to each tool', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult());
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult());
    mockExecuteCpd.mockResolvedValue(makeSuccessResult());

    await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/my/repo',
    });

    expect(mockExecuteSemgrep).toHaveBeenCalledWith('/my/repo');
    expect(mockExecuteTrivy).toHaveBeenCalledWith('/my/repo');
    expect(mockExecuteCpd).toHaveBeenCalledWith('/my/repo');
  });

  // ── Tool disabled → skipped ──

  it('skips semgrep when disabled', async () => {
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult());
    mockExecuteCpd.mockResolvedValue(makeSuccessResult());

    const result = await runLocalAnalysis({
      enableSemgrep: false,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(result.semgrep).toEqual(SKIPPED);
    expect(mockExecuteSemgrep).not.toHaveBeenCalled();
  });

  it('skips trivy when disabled', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult());
    mockExecuteCpd.mockResolvedValue(makeSuccessResult());

    const result = await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: false,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(result.trivy).toEqual(SKIPPED);
    expect(mockExecuteTrivy).not.toHaveBeenCalled();
  });

  it('skips cpd when disabled', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult());
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult());

    const result = await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: false,
      repoDir: '/workspace',
    });

    expect(result.cpd).toEqual(SKIPPED);
    expect(mockExecuteCpd).not.toHaveBeenCalled();
  });

  // ── All tools disabled ──

  it('returns all skipped when all tools disabled', async () => {
    const result = await runLocalAnalysis({
      enableSemgrep: false,
      enableTrivy: false,
      enableCpd: false,
      repoDir: '/workspace',
    });

    expect(result.semgrep).toEqual(SKIPPED);
    expect(result.trivy).toEqual(SKIPPED);
    expect(result.cpd).toEqual(SKIPPED);
    expect(mockExecuteSemgrep).not.toHaveBeenCalled();
    expect(mockExecuteTrivy).not.toHaveBeenCalled();
    expect(mockExecuteCpd).not.toHaveBeenCalled();
  });

  // ── One tool fails ──

  it('runs other tools when one fails', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeErrorResult('Semgrep crashed'));
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult(2));
    mockExecuteCpd.mockResolvedValue(makeSuccessResult(1));

    const result = await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(result.semgrep.status).toBe('error');
    expect(result.trivy.status).toBe('success');
    expect(result.trivy.findings).toHaveLength(2);
    expect(result.cpd.status).toBe('success');
    expect(result.cpd.findings).toHaveLength(1);
  });

  // ── All tools fail ──

  it('returns all error statuses when all tools fail', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeErrorResult('Semgrep failed'));
    mockExecuteTrivy.mockResolvedValue(makeErrorResult('Trivy failed'));
    mockExecuteCpd.mockResolvedValue(makeErrorResult('CPD failed'));

    const result = await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(result.semgrep.status).toBe('error');
    expect(result.trivy.status).toBe('error');
    expect(result.cpd.status).toBe('error');
  });

  it('never throws even when all tools fail', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeErrorResult());
    mockExecuteTrivy.mockResolvedValue(makeErrorResult());
    mockExecuteCpd.mockResolvedValue(makeErrorResult());

    // Should not throw
    await expect(
      runLocalAnalysis({
        enableSemgrep: true,
        enableTrivy: true,
        enableCpd: true,
        repoDir: '/workspace',
      }),
    ).resolves.toBeDefined();
  });

  // ── Sequential execution ──

  it('executes tools sequentially: Semgrep → Trivy → CPD', async () => {
    const executionOrder: string[] = [];

    mockExecuteSemgrep.mockImplementation(async () => {
      executionOrder.push('semgrep');
      return makeSuccessResult();
    });
    mockExecuteTrivy.mockImplementation(async () => {
      executionOrder.push('trivy');
      return makeSuccessResult();
    });
    mockExecuteCpd.mockImplementation(async () => {
      executionOrder.push('cpd');
      return makeSuccessResult();
    });

    await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(executionOrder).toEqual(['semgrep', 'trivy', 'cpd']);
  });

  it('Semgrep completes before Trivy starts', async () => {
    let semgrepDone = false;
    let trivyStartedAfterSemgrep = false;

    mockExecuteSemgrep.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      semgrepDone = true;
      return makeSuccessResult();
    });
    mockExecuteTrivy.mockImplementation(async () => {
      trivyStartedAfterSemgrep = semgrepDone;
      return makeSuccessResult();
    });
    mockExecuteCpd.mockResolvedValue(makeSuccessResult());

    await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(trivyStartedAfterSemgrep).toBe(true);
  });

  // ── Mixed results ──

  it('assembles mixed results correctly (success + error + skipped)', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult(3, 100));
    mockExecuteTrivy.mockResolvedValue(makeErrorResult('Trivy timeout'));

    const result = await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: false,
      repoDir: '/workspace',
    });

    expect(result.semgrep.status).toBe('success');
    expect(result.semgrep.findings).toHaveLength(3);
    expect(result.trivy.status).toBe('error');
    expect(result.trivy.error).toBe('Trivy timeout');
    expect(result.cpd).toEqual(SKIPPED);
  });

  // ── Logging ──

  it('logs status for each tool', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult(2, 100));
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult(0, 200));
    mockExecuteCpd.mockResolvedValue(makeSuccessResult(1, 150));

    await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Starting local static analysis'),
    );
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Semgrep: success'));
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Trivy: success'));
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('CPD: success'));
    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('Static analysis complete'));
  });

  it('logs finding counts', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult(5));
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult());
    mockExecuteCpd.mockResolvedValue(makeSuccessResult());

    await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    expect(mockInfo).toHaveBeenCalledWith(expect.stringContaining('5 findings'));
  });

  // ── Timing arithmetic ──

  it('logs total time in seconds (not milliseconds)', async () => {
    mockExecuteSemgrep.mockResolvedValue(makeSuccessResult());
    mockExecuteTrivy.mockResolvedValue(makeSuccessResult());
    mockExecuteCpd.mockResolvedValue(makeSuccessResult());

    await runLocalAnalysis({
      enableSemgrep: true,
      enableTrivy: true,
      enableCpd: true,
      repoDir: '/workspace',
    });

    // Find the "Static analysis complete in X.Xs" log call
    const completeCall = mockInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('Static analysis complete'),
    );
    expect(completeCall).toBeDefined();
    // Extract the number — should be small (< 10s), not huge (Date.now() + start would be ~3 trillion)
    const match = (completeCall?.[0] as string).match(/([\d.]+)s/);
    expect(match).toBeDefined();
    const seconds = parseFloat(match?.[1]!);
    expect(seconds).toBeLessThan(10);
  });
});
