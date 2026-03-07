/**
 * Tests for `ghagga hooks uninstall` subcommand.
 *
 * Mocks git-hooks utilities and the TUI layer.
 * Tests uninstall of both hooks, non-git-repo error, and result messages.
 *
 * @see Phase 4, Test 5
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

const { mockIsGitRepo, mockGetHooksDir, mockUninstallHook } = vi.hoisted(() => ({
  mockIsGitRepo: vi.fn(),
  mockGetHooksDir: vi.fn(),
  mockUninstallHook: vi.fn(),
}));

vi.mock('../../lib/git-hooks.js', () => ({
  isGitRepo: (...args: unknown[]) => mockIsGitRepo(...args),
  getHooksDir: (...args: unknown[]) => mockGetHooksDir(...args),
  uninstallHook: (...args: unknown[]) => mockUninstallHook(...args),
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
import { registerUninstallCommand } from './uninstall.js';

// ─── Helpers ────────────────────────────────────────────────────

class ProcessExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

async function runUninstallCommand(args: string[] = []): Promise<void> {
  const parent = new Command('hooks');
  registerUninstallCommand(parent);
  try {
    await parent.parseAsync(['uninstall', ...args], { from: 'user' });
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

  mockIsGitRepo.mockReturnValue(true);
  mockGetHooksDir.mockReturnValue('/repo/.git/hooks');
});

afterEach(() => {
  exitSpy.mockRestore();
});

// ─── Tests ──────────────────────────────────────────────────────

describe('ghagga hooks uninstall', () => {
  it('calls uninstallHook for both pre-commit and commit-msg', async () => {
    mockUninstallHook
      .mockReturnValueOnce({
        type: 'pre-commit',
        success: true,
        message: 'Removed pre-commit hook',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        success: true,
        message: 'Removed commit-msg hook',
      });

    await runUninstallCommand();

    expect(mockUninstallHook).toHaveBeenCalledTimes(2);
    expect(mockUninstallHook).toHaveBeenCalledWith('/repo/.git/hooks', 'pre-commit');
    expect(mockUninstallHook).toHaveBeenCalledWith('/repo/.git/hooks', 'commit-msg');
  });

  it('exits with error when not in a git repo', async () => {
    mockIsGitRepo.mockReturnValue(false);

    await runUninstallCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(tui.log.error).toHaveBeenCalledWith(expect.stringContaining('Not a git repository'));
    expect(mockUninstallHook).not.toHaveBeenCalled();
  });

  it('shows success messages for removed hooks', async () => {
    mockUninstallHook
      .mockReturnValueOnce({
        type: 'pre-commit',
        success: true,
        message: 'Removed pre-commit hook',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        success: true,
        message: 'Removed commit-msg hook',
      });

    await runUninstallCommand();

    expect(tui.log.success).toHaveBeenCalledWith('Removed pre-commit hook');
    expect(tui.log.success).toHaveBeenCalledWith('Removed commit-msg hook');
    expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('Removed 2 GHAGGA hook(s)'));
  });

  it('shows warn for skipped external hooks', async () => {
    mockUninstallHook.mockReturnValue({
      type: 'pre-commit',
      success: false,
      message: 'Hook pre-commit exists but is not managed by GHAGGA. Skipping.',
    });

    await runUninstallCommand();

    expect(tui.log.warn).toHaveBeenCalledWith(expect.stringContaining('not managed by GHAGGA'));
  });

  it('shows info when no GHAGGA hooks were found', async () => {
    mockUninstallHook.mockReturnValue({
      type: 'pre-commit',
      success: true,
      message: 'Hook pre-commit not installed, nothing to remove',
    });

    await runUninstallCommand();

    expect(tui.log.info).toHaveBeenCalledWith(
      expect.stringContaining('No GHAGGA hooks were found to remove'),
    );
  });

  it('shows correct count when only one hook is actually removed', async () => {
    mockUninstallHook
      .mockReturnValueOnce({
        type: 'pre-commit',
        success: true,
        message: 'Removed pre-commit hook',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        success: true,
        message: 'Hook commit-msg not installed, nothing to remove',
      });

    await runUninstallCommand();

    expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('Removed 1 GHAGGA hook(s)'));
  });
});
