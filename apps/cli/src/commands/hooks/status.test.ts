/**
 * Tests for `ghagga hooks status` subcommand.
 *
 * Mocks git-hooks utilities and the TUI layer.
 * Tests display of hook status for both hooks, non-git-repo error,
 * and correct labels for not-installed / GHAGGA / external hooks.
 *
 * @see Phase 4, Test 6
 */

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

const { mockIsGitRepo, mockGetHooksDir, mockGetHookStatus } = vi.hoisted(() => ({
  mockIsGitRepo: vi.fn(),
  mockGetHooksDir: vi.fn(),
  mockGetHookStatus: vi.fn(),
}));

vi.mock('../../lib/git-hooks.js', () => ({
  isGitRepo: (...args: unknown[]) => mockIsGitRepo(...args),
  getHooksDir: (...args: unknown[]) => mockGetHooksDir(...args),
  getHookStatus: (...args: unknown[]) => mockGetHookStatus(...args),
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
import { registerStatusCommand } from './status.js';

// ─── Helpers ────────────────────────────────────────────────────

class ProcessExitError extends Error {
  constructor(public code: number | undefined) {
    super(`process.exit(${code})`);
  }
}

async function runStatusCommand(args: string[] = []): Promise<void> {
  const parent = new Command('hooks');
  registerStatusCommand(parent);
  try {
    await parent.parseAsync(['status', ...args], { from: 'user' });
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

describe('ghagga hooks status', () => {
  it('shows status for both pre-commit and commit-msg hooks', async () => {
    mockGetHookStatus
      .mockReturnValueOnce({
        type: 'pre-commit',
        installed: true,
        managedByGhagga: true,
        path: '/repo/.git/hooks/pre-commit',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        installed: false,
        managedByGhagga: false,
        path: '/repo/.git/hooks/commit-msg',
      });

    await runStatusCommand();

    expect(mockGetHookStatus).toHaveBeenCalledTimes(2);
    expect(mockGetHookStatus).toHaveBeenCalledWith('/repo/.git/hooks', 'pre-commit');
    expect(mockGetHookStatus).toHaveBeenCalledWith('/repo/.git/hooks', 'commit-msg');
  });

  it('exits with error when not in a git repo', async () => {
    mockIsGitRepo.mockReturnValue(false);

    await runStatusCommand();

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(tui.log.error).toHaveBeenCalledWith(expect.stringContaining('Not a git repository'));
    expect(mockGetHookStatus).not.toHaveBeenCalled();
  });

  it('shows "not installed" for hooks that do not exist', async () => {
    mockGetHookStatus.mockReturnValue({
      type: 'pre-commit',
      installed: false,
      managedByGhagga: false,
      path: '/repo/.git/hooks/pre-commit',
    });

    await runStatusCommand();

    expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('not installed'));
  });

  it('shows "GHAGGA-managed" for installed GHAGGA hooks', async () => {
    mockGetHookStatus.mockReturnValue({
      type: 'pre-commit',
      installed: true,
      managedByGhagga: true,
      path: '/repo/.git/hooks/pre-commit',
    });

    await runStatusCommand();

    expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('GHAGGA-managed'));
  });

  it('shows "external" for installed non-GHAGGA hooks', async () => {
    mockGetHookStatus.mockReturnValue({
      type: 'pre-commit',
      installed: true,
      managedByGhagga: false,
      path: '/repo/.git/hooks/pre-commit',
    });

    await runStatusCommand();

    expect(tui.log.warn).toHaveBeenCalledWith(expect.stringContaining('external'));
  });

  it('shows hooks directory path', async () => {
    mockGetHookStatus.mockReturnValue({
      type: 'pre-commit',
      installed: false,
      managedByGhagga: false,
      path: '/repo/.git/hooks/pre-commit',
    });

    await runStatusCommand();

    expect(tui.log.info).toHaveBeenCalledWith(expect.stringContaining('/repo/.git/hooks'));
  });

  it('shows mixed status for different hooks', async () => {
    mockGetHookStatus
      .mockReturnValueOnce({
        type: 'pre-commit',
        installed: true,
        managedByGhagga: true,
        path: '/repo/.git/hooks/pre-commit',
      })
      .mockReturnValueOnce({
        type: 'commit-msg',
        installed: true,
        managedByGhagga: false,
        path: '/repo/.git/hooks/commit-msg',
      });

    await runStatusCommand();

    expect(tui.log.success).toHaveBeenCalledWith(expect.stringContaining('pre-commit'));
    expect(tui.log.warn).toHaveBeenCalledWith(expect.stringContaining('commit-msg'));
  });
});
