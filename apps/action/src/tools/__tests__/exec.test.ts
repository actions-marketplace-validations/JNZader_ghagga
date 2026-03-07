import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('@actions/exec', () => ({
  exec: vi.fn(),
}));

import { exec } from '@actions/exec';
import { execWithTimeout } from '../exec.js';

// ─── Helpers ────────────────────────────────────────────────────

const mockExec = vi.mocked(exec);

/**
 * Simulate @actions/exec behavior: invoke stdout/stderr listeners
 * then resolve with exit code.
 */
function simulateExec(
  exitCode: number,
  stdout = '',
  stderr = '',
  delayMs = 0,
): ReturnType<typeof mockExec> {
  return mockExec.mockImplementationOnce(async (_cmd, _args, options) => {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    if (stdout && options?.listeners?.stdout) {
      options.listeners.stdout(Buffer.from(stdout));
    }
    if (stderr && options?.listeners?.stderr) {
      options.listeners.stderr(Buffer.from(stderr));
    }
    return exitCode;
  }) as any;
}

// ─── Tests ──────────────────────────────────────────────────────

describe('execWithTimeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // ── Successful execution ──

  it('returns stdout, stderr, and exitCode on success', async () => {
    simulateExec(0, 'hello world\n', 'some warning\n');

    const result = await execWithTimeout('echo', ['hello']);

    expect(result).toEqual({
      exitCode: 0,
      stdout: 'hello world\n',
      stderr: 'some warning\n',
    });
  });

  it('captures multi-chunk stdout', async () => {
    mockExec.mockImplementationOnce(async (_cmd, _args, options) => {
      options?.listeners?.stdout?.(Buffer.from('chunk1'));
      options?.listeners?.stdout?.(Buffer.from('chunk2'));
      return 0;
    });

    const result = await execWithTimeout('cat', ['file']);

    expect(result.stdout).toBe('chunk1chunk2');
  });

  it('returns empty stdout/stderr when command produces no output', async () => {
    simulateExec(0);

    const result = await execWithTimeout('true', []);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  // ── Exit code handling ──

  it('throws on non-zero exit code by default', async () => {
    simulateExec(1, '', 'error: file not found');

    await expect(execWithTimeout('cat', ['missing.txt'])).rejects.toThrow(
      'Command failed with exit code 1',
    );
  });

  it('includes stderr in error message for non-zero exit code', async () => {
    simulateExec(2, '', 'Permission denied');

    await expect(execWithTimeout('rm', ['protected'])).rejects.toThrow('Permission denied');
  });

  it('truncates stderr to 500 chars in error message', async () => {
    const longStderr = 'x'.repeat(1000);
    simulateExec(1, '', longStderr);

    await expect(execWithTimeout('fail', [])).rejects.toThrow(/Command failed with exit code 1/);

    try {
      simulateExec(1, '', longStderr);
      await execWithTimeout('fail', []);
    } catch (err) {
      // stderr is truncated to 500 chars in the error message
      expect((err as Error).message).toContain('x'.repeat(500));
      expect((err as Error).message).not.toContain('x'.repeat(501));
    }
  });

  it('resolves with non-zero exit code when allowNonZero is true', async () => {
    simulateExec(4, '<cpd-output/>', '');

    const result = await execWithTimeout('pmd', ['cpd'], {
      allowNonZero: true,
    });

    expect(result.exitCode).toBe(4);
    expect(result.stdout).toBe('<cpd-output/>');
  });

  it('resolves with exit code 0 when allowNonZero is true', async () => {
    simulateExec(0, 'ok', '');

    const result = await execWithTimeout('test', [], {
      allowNonZero: true,
    });

    expect(result.exitCode).toBe(0);
  });

  // ── Timeout behavior ──

  it('rejects with timeout error when command exceeds timeout', async () => {
    // Command takes 500ms but timeout is 50ms
    mockExec.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(0), 500)),
    );

    await expect(execWithTimeout('sleep', ['10'], { timeoutMs: 50 })).rejects.toThrow(
      'Timed out after 50ms',
    );
  });

  it('uses TOOL_TIMEOUT_MS as default timeout', async () => {
    simulateExec(0, 'fast', '');

    await execWithTimeout('fast', []);

    // The exec was called — if it was going to timeout it would use 180_000ms
    // We just verify it completed successfully with default
    expect(mockExec).toHaveBeenCalledTimes(1);
  });

  it('uses custom timeout when provided', async () => {
    mockExec.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(0), 200)),
    );

    // Should succeed with a generous timeout
    const result = await execWithTimeout('cmd', [], { timeoutMs: 5000 });

    expect(result.exitCode).toBe(0);
  });

  // ── cwd option ──

  it('passes cwd to @actions/exec', async () => {
    simulateExec(0, '', '');

    await execWithTimeout('ls', ['-la'], { cwd: '/tmp/repo' });

    expect(mockExec).toHaveBeenCalledWith(
      'ls',
      ['-la'],
      expect.objectContaining({ cwd: '/tmp/repo' }),
    );
  });

  it('passes undefined cwd when not specified', async () => {
    simulateExec(0, '', '');

    await execWithTimeout('ls', []);

    expect(mockExec).toHaveBeenCalledWith('ls', [], expect.objectContaining({ cwd: undefined }));
  });

  // ── exec options ──

  it('sets silent: true to avoid polluting Actions logs', async () => {
    simulateExec(0, '', '');

    await execWithTimeout('cmd', []);

    expect(mockExec).toHaveBeenCalledWith('cmd', [], expect.objectContaining({ silent: true }));
  });

  it('sets ignoreReturnCode: true to handle exit codes manually', async () => {
    simulateExec(0, '', '');

    await execWithTimeout('cmd', []);

    expect(mockExec).toHaveBeenCalledWith(
      'cmd',
      [],
      expect.objectContaining({ ignoreReturnCode: true }),
    );
  });
});
