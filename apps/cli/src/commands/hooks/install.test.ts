/**
 * Tests for `ghagga hooks install` subcommand.
 *
 * Mocks git-hooks utilities, hook-templates, and the TUI layer.
 * Tests hook selection (both, --pre-commit, --commit-msg),
 * --force flag, non-git-repo error, and success/failure messages.
 *
 * @see Phase 4, Test 4
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

const { mockIsGitRepo, mockGetHooksDir, mockInstallHook, mockGenPreCommit, mockGenCommitMsg } =
  vi.hoisted(() => ({
    mockIsGitRepo: vi.fn(),
    mockGetHooksDir: vi.fn(),
    mockInstallHook: vi.fn(),
    mockGenPreCommit: vi.fn(),
    mockGenCommitMsg: vi.fn(),
  }));

vi.mock('../../lib/git-hooks.js', () => ({
  isGitRepo: (...args: unknown[]) => mockIsGitRepo(...args),
  getHooksDir: (...args: unknown[]) => mockGetHooksDir(...args),
  installHook: (...args: unknown[]) => mockInstallHook(...args),
}));

vi.mock('../../lib/hook-templates.js', () => ({
  generatePreCommitHook: (...args: unknown[]) => mockGenPreCommit(...args),
  generateCommitMsgHook: (...args: unknown[]) => mockGenCommitMsg(...args),
}));

vi.mock('../../ui/tui.js', () => ({
  log: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import * as tui from '../../ui/tui.js';
import { registerInstallCommand } from './install.js';

// ─── Helpers ────────────────────────────────────────────────────

class ProcessExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

async function runInstallCommand(args: string[] = []): Promise<void> {
  const parent = new Command('hooks');
  registerInstallCommand(parent);
  try {
    await parent.parseAsync(['install', ...args], { from: 'user' });
  } catch (err) {
    if (!(err instanceof ProcessExitError)) throw err;
  }
}

// ─── Setup ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let exitSpy: any;

beforeEach(() => {
  vi.clearAllMocks();
  exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new ProcessExitError(code);
  }) as never);

  // Defaults: in a git repo, hooks dir exists
  mockIsGitRepo.mockReturnValue(true);
  mockGetHooksDir.mockReturnValue('/repo/.git/hooks');
  mockGenPreCommit.mockReturnValue('pre-commit-content');
  mockGenCommitMsg.mockReturnValue('commit-msg-content');
  mockInstallHook.mockReturnValue({
    type: 'pre-commit',
    success: true,
    message: 'Installed pre-commit hook',
  });
});

afterEach(() => {
  exitSpy.mockRestore();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('ghagga hooks install', () => {
  it('installs both hooks by default', async () => {
    mockInstallHook
      .mockReturnValueOnce({
        type: 'pre-commit',
        success: true,
        message: 'Installed pre-commit hook',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        success: true,
        message: 'Installed commit-msg hook',
      });

    await runInstallCommand();

    expect(mockInstallHook).toHaveBeenCalledTimes(2);
    expect(mockInstallHook).toHaveBeenCalledWith(
      '/repo/.git/hooks',
      'pre-commit',
      'pre-commit-content',
      false,
    );
    expect(mockInstallHook).toHaveBeenCalledWith(
      '/repo/.git/hooks',
      'commit-msg',
      'commit-msg-content',
      false,
    );
    expect(tui.log.success).toHaveBeenCalledTimes(2);
  });

  it('installs only pre-commit when --pre-commit is passed', async () => {
    mockInstallHook.mockReturnValue({
      type: 'pre-commit',
      success: true,
      message: 'Installed pre-commit hook',
    });

    await runInstallCommand(['--pre-commit']);

    expect(mockInstallHook).toHaveBeenCalledTimes(1);
    expect(mockInstallHook).toHaveBeenCalledWith(
      '/repo/.git/hooks',
      'pre-commit',
      'pre-commit-content',
      false,
    );
  });

  it('installs only commit-msg when --commit-msg is passed', async () => {
    mockInstallHook.mockReturnValue({
      type: 'commit-msg',
      success: true,
      message: 'Installed commit-msg hook',
    });

    await runInstallCommand(['--commit-msg']);

    expect(mockInstallHook).toHaveBeenCalledTimes(1);
    expect(mockInstallHook).toHaveBeenCalledWith(
      '/repo/.git/hooks',
      'commit-msg',
      'commit-msg-content',
      false,
    );
  });

  it('passes force flag when --force is used', async () => {
    mockInstallHook.mockReturnValue({
      type: 'pre-commit',
      success: true,
      message: 'Installed',
    });

    await runInstallCommand(['--force', '--pre-commit']);

    expect(mockInstallHook).toHaveBeenCalledWith(
      '/repo/.git/hooks',
      'pre-commit',
      'pre-commit-content',
      true,
    );
  });

  it('exits with error when not in a git repo', async () => {
    mockIsGitRepo.mockReturnValue(false);

    await runInstallCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(tui.log.error).toHaveBeenCalledWith(expect.stringContaining('Not a git repository'));
    expect(mockInstallHook).not.toHaveBeenCalled();
  });

  it('shows error message when install fails', async () => {
    mockInstallHook
      .mockReturnValueOnce({
        type: 'pre-commit',
        success: false,
        message:
          'Hook pre-commit already exists (not managed by GHAGGA). Use --force to overwrite.',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        success: true,
        message: 'Installed commit-msg hook',
      });

    await runInstallCommand();

    expect(tui.log.error).toHaveBeenCalledWith(expect.stringContaining('--force'));
    expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('Installed commit-msg'));
  });

  it('shows "no hooks installed" warning when all installs fail', async () => {
    mockInstallHook.mockReturnValue({
      type: 'pre-commit',
      success: false,
      message: 'Failed',
    });

    await runInstallCommand();

    expect(tui.log.warn).toHaveBeenCalledWith(expect.stringContaining('No hooks were installed'));
  });

  it('shows install count summary on success', async () => {
    mockInstallHook
      .mockReturnValueOnce({ type: 'pre-commit', success: true, message: 'ok' })
      .mockReturnValueOnce({ type: 'commit-msg', success: true, message: 'ok' });

    await runInstallCommand();

    expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('Installed 2 hook(s)'));
  });
});
