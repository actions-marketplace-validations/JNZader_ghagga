import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

import { execSync } from 'node:child_process';
import { resolveProjectId, normalizeRemoteUrl } from './git.js';

const mockExecSync = vi.mocked(execSync);

// ─── Tests ──────────────────────────────────────────────────────

describe('normalizeRemoteUrl', () => {
  it('normalizes HTTPS URL with .git suffix', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widgets.git')).toBe('acme/widgets');
  });

  it('normalizes HTTPS URL without .git suffix', () => {
    expect(normalizeRemoteUrl('https://github.com/acme/widgets')).toBe('acme/widgets');
  });

  it('normalizes SSH URL (git@host:owner/repo.git)', () => {
    expect(normalizeRemoteUrl('git@github.com:acme/widgets.git')).toBe('acme/widgets');
  });

  it('normalizes SSH URL without .git suffix', () => {
    expect(normalizeRemoteUrl('git@github.com:acme/widgets')).toBe('acme/widgets');
  });

  it('normalizes ssh:// protocol URL', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/acme/widgets.git')).toBe('acme/widgets');
  });

  it('normalizes ssh:// protocol URL without .git suffix', () => {
    expect(normalizeRemoteUrl('ssh://git@github.com/acme/widgets')).toBe('acme/widgets');
  });

  it('normalizes GitLab HTTPS URL', () => {
    expect(normalizeRemoteUrl('https://gitlab.com/acme/widgets.git')).toBe('acme/widgets');
  });

  it('normalizes GitLab SSH URL', () => {
    expect(normalizeRemoteUrl('git@gitlab.com:acme/widgets.git')).toBe('acme/widgets');
  });

  it('returns local/unknown for invalid URL', () => {
    expect(normalizeRemoteUrl('not-a-valid-url')).toBe('local/unknown');
  });
});

describe('resolveProjectId', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves HTTPS remote to owner/repo', () => {
    mockExecSync.mockReturnValue('https://github.com/acme/widgets.git\n');

    expect(resolveProjectId('/path/to/repo')).toBe('acme/widgets');
    expect(mockExecSync).toHaveBeenCalledWith('git remote get-url origin', {
      cwd: '/path/to/repo',
      encoding: 'utf-8',
    });
  });

  it('resolves SSH remote to owner/repo', () => {
    mockExecSync.mockReturnValue('git@github.com:acme/widgets.git\n');

    expect(resolveProjectId('/path/to/repo')).toBe('acme/widgets');
  });

  it('falls back to local/unknown when no remote is configured', () => {
    mockExecSync.mockImplementation(() => { throw new Error('fatal: No such remote'); });

    expect(resolveProjectId('/path/to/repo')).toBe('local/unknown');
  });

  it('passes repoPath as cwd to execSync', () => {
    mockExecSync.mockReturnValue('https://github.com/org/repo.git\n');

    resolveProjectId('/custom/work/dir');

    expect(mockExecSync).toHaveBeenCalledWith(
      'git remote get-url origin',
      expect.objectContaining({ cwd: '/custom/work/dir' }),
    );
  });
});
