import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('@actions/cache', () => ({
  restoreCache: vi.fn(),
  saveCache: vi.fn(),
}));

vi.mock('@actions/core', () => ({
  info: vi.fn(),
  warning: vi.fn(),
}));

import * as cache from '@actions/cache';
import * as core from '@actions/core';
import { restoreToolCache, saveToolCache } from '../cache.js';
import { TOOL_VERSIONS } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

const mockRestoreCache = vi.mocked(cache.restoreCache);
const mockSaveCache = vi.mocked(cache.saveCache);
const mockInfo = vi.mocked(core.info);
const mockWarning = vi.mocked(core.warning);

// ─── Tests ──────────────────────────────────────────────────────

describe('restoreToolCache', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, RUNNER_OS: 'Linux' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Cache hit ──

  it('returns true on cache hit', async () => {
    mockRestoreCache.mockResolvedValue('ghagga-semgrep-1.90.0-Linux');

    const result = await restoreToolCache('semgrep');

    expect(result).toBe(true);
  });

  it('logs info on cache hit', async () => {
    mockRestoreCache.mockResolvedValue('ghagga-trivy-0.58.1-Linux');

    await restoreToolCache('trivy');

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Cache hit for trivy'),
    );
  });

  // ── Cache miss ──

  it('returns false on cache miss', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    const result = await restoreToolCache('semgrep');

    expect(result).toBe(false);
  });

  it('logs info on cache miss', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('cpd');

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Cache miss for cpd'),
    );
  });

  // ── Cache key format ──

  it('uses correct key format: ghagga-{tool}-{version}-{os}', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('semgrep');

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      `ghagga-semgrep-${TOOL_VERSIONS.semgrep}-Linux`,
    );
  });

  it('uses pmd version for cpd tool', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('cpd');

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      `ghagga-cpd-${TOOL_VERSIONS.pmd}-Linux`,
    );
  });

  it('uses RUNNER_OS from environment', async () => {
    process.env.RUNNER_OS = 'macOS';
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('trivy');

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      `ghagga-trivy-${TOOL_VERSIONS.trivy}-macOS`,
    );
  });

  it('defaults to Linux when RUNNER_OS is not set', async () => {
    delete process.env.RUNNER_OS;
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('semgrep');

    expect(mockRestoreCache).toHaveBeenCalledWith(
      expect.any(Array),
      expect.stringContaining('-Linux'),
    );
  });

  // ── Cache paths per tool ──

  it('uses correct paths for semgrep', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('semgrep');

    const paths = mockRestoreCache.mock.calls[0]![0];
    expect(paths).toContain('~/.local/bin/semgrep');
    expect(paths).toContain(
      '~/.local/lib/python3*/site-packages/semgrep*',
    );
  });

  it('uses correct paths for trivy', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('trivy');

    const paths = mockRestoreCache.mock.calls[0]![0];
    expect(paths).toContain('/usr/local/bin/trivy');
  });

  it('uses correct paths for cpd', async () => {
    mockRestoreCache.mockResolvedValue(undefined);

    await restoreToolCache('cpd');

    const paths = mockRestoreCache.mock.calls[0]![0];
    expect(paths).toContain('/opt/pmd');
  });

  // ── Error handling ──

  it('returns false and logs warning on cache restore error', async () => {
    mockRestoreCache.mockRejectedValue(new Error('Network timeout'));

    const result = await restoreToolCache('semgrep');

    expect(result).toBe(false);
    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Cache restore failed for semgrep'),
    );
  });

  it('never throws on error', async () => {
    mockRestoreCache.mockRejectedValue(new Error('Catastrophic failure'));

    // Should not throw
    const result = await restoreToolCache('trivy');

    expect(result).toBe(false);
  });
});

// ─── saveToolCache ──────────────────────────────────────────────

describe('saveToolCache', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv, RUNNER_OS: 'Linux' };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ── Success ──

  it('saves cache with correct key', async () => {
    mockSaveCache.mockResolvedValue(12345);

    await saveToolCache('semgrep');

    expect(mockSaveCache).toHaveBeenCalledWith(
      expect.any(Array),
      `ghagga-semgrep-${TOOL_VERSIONS.semgrep}-Linux`,
    );
  });

  it('logs info on successful save', async () => {
    mockSaveCache.mockResolvedValue(12345);

    await saveToolCache('trivy');

    expect(mockInfo).toHaveBeenCalledWith(
      expect.stringContaining('Cache saved for trivy'),
    );
  });

  it('uses pmd version for cpd tool key', async () => {
    mockSaveCache.mockResolvedValue(12345);

    await saveToolCache('cpd');

    expect(mockSaveCache).toHaveBeenCalledWith(
      expect.any(Array),
      `ghagga-cpd-${TOOL_VERSIONS.pmd}-Linux`,
    );
  });

  // ── Error handling ──

  it('logs warning on save failure', async () => {
    mockSaveCache.mockRejectedValue(new Error('Storage quota exceeded'));

    await saveToolCache('semgrep');

    expect(mockWarning).toHaveBeenCalledWith(
      expect.stringContaining('Cache save failed for semgrep'),
    );
  });

  it('never throws on error', async () => {
    mockSaveCache.mockRejectedValue(new Error('Catastrophic failure'));

    // Should not throw
    await expect(saveToolCache('cpd')).resolves.toBeUndefined();
  });

  // ── Version bump invalidates cache ──

  it('cache key changes when tool version changes', async () => {
    mockSaveCache.mockResolvedValue(12345);

    await saveToolCache('semgrep');

    const key = mockSaveCache.mock.calls[0]![1];
    // Key includes the version — if TOOL_VERSIONS.semgrep changes, key changes
    expect(key).toContain(TOOL_VERSIONS.semgrep);
  });
});
