/**
 * Tests for git hook utilities (install, uninstall, status).
 *
 * Mocks node:fs, node:child_process, and node:path to test
 * isGitRepo, getHooksDir, getHookStatus, installHook, and uninstallHook
 * without touching the real filesystem or git.
 *
 * @see Phase 4, Test 2
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HOOK_MARKER } from './hooks-types.js';

// ─── Mocks ──────────────────────────────────────────────────────

const {
  mockExecSync,
  mockExistsSync,
  mockReadFileSync,
  mockWriteFileSync,
  mockUnlinkSync,
  mockRenameSync,
  mockChmodSync,
} = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockChmodSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: (...args: unknown[]) => mockExecSync(...args),
}));

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  chmodSync: (...args: unknown[]) => mockChmodSync(...args),
}));

import {
  isGitRepo,
  getHooksDir,
  getHookStatus,
  installHook,
  uninstallHook,
} from './git-hooks.js';

// ─── Setup ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── isGitRepo ──────────────────────────────────────────────────

describe('isGitRepo', () => {
  it('returns true when inside a git repository', () => {
    mockExecSync.mockReturnValue('.git');

    expect(isGitRepo()).toBe(true);
    expect(mockExecSync).toHaveBeenCalledWith('git rev-parse --git-dir', { stdio: 'pipe' });
  });

  it('returns false when outside a git repository', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });

    expect(isGitRepo()).toBe(false);
  });
});

// ─── getHooksDir ────────────────────────────────────────────────

describe('getHooksDir', () => {
  it('returns default .git/hooks when no core.hooksPath is set', () => {
    mockExecSync
      .mockImplementationOnce(() => {
        // core.hooksPath fails (not set)
        throw new Error('key does not exist');
      })
      .mockReturnValueOnce('.git\n'); // git rev-parse --git-dir

    const result = getHooksDir();
    expect(result).toMatch(/\.git[/\\]hooks$/);
  });

  it('respects core.hooksPath config when set', () => {
    mockExecSync.mockReturnValueOnce('/custom/hooks-dir\n'); // core.hooksPath

    const result = getHooksDir();
    expect(result).toBe('/custom/hooks-dir');
  });
});

// ─── getHookStatus ──────────────────────────────────────────────

describe('getHookStatus', () => {
  it('returns not installed when hook file does not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const status = getHookStatus('/repo/.git/hooks', 'pre-commit');

    expect(status.installed).toBe(false);
    expect(status.managedByGhagga).toBe(false);
    expect(status.type).toBe('pre-commit');
  });

  it('returns managed when GHAGGA marker is found in hook file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`#!/bin/sh\n${HOOK_MARKER}\nexec ghagga review`);

    const status = getHookStatus('/repo/.git/hooks', 'pre-commit');

    expect(status.installed).toBe(true);
    expect(status.managedByGhagga).toBe(true);
  });

  it('returns not managed when external hook exists (no marker)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('#!/bin/sh\necho "custom hook"');

    const status = getHookStatus('/repo/.git/hooks', 'commit-msg');

    expect(status.installed).toBe(true);
    expect(status.managedByGhagga).toBe(false);
    expect(status.type).toBe('commit-msg');
  });
});

// ─── installHook ────────────────────────────────────────────────

describe('installHook', () => {
  const hookContent = `#!/bin/sh\n${HOOK_MARKER}\nexec ghagga review`;

  it('creates a new hook file when none exists', () => {
    mockExistsSync.mockReturnValue(false);

    const result = installHook('/repo/.git/hooks', 'pre-commit', hookContent, false);

    expect(result.success).toBe(true);
    expect(result.type).toBe('pre-commit');
    expect(result.message).toContain('Installed pre-commit hook');
    expect(result.backedUp).toBeFalsy();
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      expect.stringContaining('pre-commit'),
      hookContent,
      { mode: 0o755 },
    );
    expect(mockChmodSync).toHaveBeenCalled();
  });

  it('overwrites GHAGGA-managed hooks without --force', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`#!/bin/sh\n${HOOK_MARKER}\nold content`);

    const result = installHook('/repo/.git/hooks', 'pre-commit', hookContent, false);

    expect(result.success).toBe(true);
    expect(result.backedUp).toBeFalsy();
    expect(mockWriteFileSync).toHaveBeenCalled();
    // Should NOT have been backed up (renamed)
    expect(mockRenameSync).not.toHaveBeenCalled();
  });

  it('refuses to overwrite external hooks without --force', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('#!/bin/sh\necho "external"');

    const result = installHook('/repo/.git/hooks', 'pre-commit', hookContent, false);

    expect(result.success).toBe(false);
    expect(result.message).toContain('already exists');
    expect(result.message).toContain('--force');
    expect(mockWriteFileSync).not.toHaveBeenCalled();
  });

  it('backs up external hooks with --force and installs', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('#!/bin/sh\necho "external"');

    const result = installHook('/repo/.git/hooks', 'pre-commit', hookContent, true);

    expect(result.success).toBe(true);
    expect(result.backedUp).toBe(true);
    expect(result.message).toContain('backed up');
    expect(result.message).toContain('.ghagga-backup');
    expect(mockRenameSync).toHaveBeenCalledWith(
      expect.stringContaining('pre-commit'),
      expect.stringContaining('pre-commit.ghagga-backup'),
    );
    expect(mockWriteFileSync).toHaveBeenCalled();
  });
});

// ─── uninstallHook ──────────────────────────────────────────────

describe('uninstallHook', () => {
  it('removes GHAGGA-managed hooks', () => {
    mockExistsSync
      .mockReturnValueOnce(true) // hook exists
      .mockReturnValueOnce(false); // no backup
    mockReadFileSync.mockReturnValue(`#!/bin/sh\n${HOOK_MARKER}\nexec ghagga review`);

    const result = uninstallHook('/repo/.git/hooks', 'pre-commit');

    expect(result.success).toBe(true);
    expect(result.message).toContain('Removed pre-commit hook');
    expect(mockUnlinkSync).toHaveBeenCalled();
  });

  it('skips external hooks (not managed by GHAGGA)', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('#!/bin/sh\necho "external"');

    const result = uninstallHook('/repo/.git/hooks', 'commit-msg');

    expect(result.success).toBe(false);
    expect(result.message).toContain('not managed by GHAGGA');
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it('restores backup when present after removing GHAGGA hook', () => {
    mockExistsSync
      .mockReturnValueOnce(true) // hook exists
      .mockReturnValueOnce(true); // backup exists
    mockReadFileSync.mockReturnValue(`#!/bin/sh\n${HOOK_MARKER}\nexec ghagga review`);

    const result = uninstallHook('/repo/.git/hooks', 'pre-commit');

    expect(result.success).toBe(true);
    expect(result.message).toContain('restored previous hook from backup');
    expect(mockUnlinkSync).toHaveBeenCalled();
    expect(mockRenameSync).toHaveBeenCalledWith(
      expect.stringContaining('.ghagga-backup'),
      expect.stringContaining('pre-commit'),
    );
  });

  it('handles not-installed case gracefully', () => {
    mockExistsSync.mockReturnValue(false);

    const result = uninstallHook('/repo/.git/hooks', 'pre-commit');

    expect(result.success).toBe(true);
    expect(result.message).toContain('not installed');
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });
});
