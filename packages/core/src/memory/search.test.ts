import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryStorage, MemoryObservationRow } from '../types.js';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('./context.js', () => ({
  formatMemoryContext: vi.fn((obs: any[]) => `Formatted: ${obs.length} observations`),
}));

import { formatMemoryContext } from './context.js';
import { searchMemoryForContext } from './search.js';

// ─── Helpers ────────────────────────────────────────────────────

const mockFormatMemoryContext = vi.mocked(formatMemoryContext);

function makeObservation(overrides: Partial<MemoryObservationRow> = {}): MemoryObservationRow {
  return {
    id: 1,
    type: 'pattern',
    title: 'Test observation',
    content: 'Some content here.',
    filePaths: ['src/auth.ts'],
    ...overrides,
  };
}

function createMockStorage(overrides: Partial<MemoryStorage> = {}): MemoryStorage {
  return {
    searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([]),
    saveObservation: vi.fn<MemoryStorage['saveObservation']>().mockResolvedValue(makeObservation()),
    createSession: vi.fn<MemoryStorage['createSession']>().mockResolvedValue({ id: 1 }),
    endSession: vi.fn<MemoryStorage['endSession']>().mockResolvedValue(undefined),
    close: vi.fn<MemoryStorage['close']>().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('searchMemoryForContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Null returns for falsy storage ──

  it('returns null when storage is null', async () => {
    const result = await searchMemoryForContext(null as any, 'owner/repo', ['src/auth.ts']);
    expect(result).toBeNull();
  });

  it('returns null when storage is undefined', async () => {
    const result = await searchMemoryForContext(undefined as any, 'owner/repo', ['src/auth.ts']);
    expect(result).toBeNull();
  });

  it('returns null when storage is empty string (falsy)', async () => {
    const result = await searchMemoryForContext('' as any, 'owner/repo', ['src/auth.ts']);
    expect(result).toBeNull();
  });

  // ── Empty/excluded file lists ──

  it('returns null when file list is empty', async () => {
    const storage = createMockStorage();
    const result = await searchMemoryForContext(storage, 'project', []);
    expect(result).toBeNull();
    expect(storage.searchObservations).not.toHaveBeenCalled();
  });

  it('returns null when all files are in excluded directories', async () => {
    const storage = createMockStorage();
    const result = await searchMemoryForContext(
      storage,
      'project',
      ['src/a.ts', 'lib/b.ts', 'dist/c.js'],
    );
    // All segments after split: 'src' (excluded), 'a' (name, but 'a'.length == 1 ≤ 2),
    // 'lib' (excluded), 'b' (too short), 'dist' (excluded), 'c' (too short)
    // → query is empty string → returns null
    expect(result).toBeNull();
  });

  it('returns null when all file names are too short (≤ 2 chars)', async () => {
    const storage = createMockStorage();
    const result = await searchMemoryForContext(
      storage,
      'project',
      ['ab.ts'],  // 'ab' has length 2, which is ≤ 2
    );
    expect(result).toBeNull();
  });

  // ── buildSearchQuery logic ──

  it('extracts meaningful path segments as search terms', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });

    await searchMemoryForContext(storage, 'project', [
      'src/auth/login.ts',
      'lib/db/pool.ts',
    ]);

    // 'src' excluded, 'auth' kept, 'login' kept (extension removed)
    // 'lib' excluded, 'db' too short (2), 'pool' kept
    expect(storage.searchObservations).toHaveBeenCalledWith(
      'project',
      expect.stringContaining('auth'),
      { limit: 3 },
    );
    const call = vi.mocked(storage.searchObservations).mock.calls[0]!;
    const query = call[1];
    expect(query).toContain('login');
    expect(query).toContain('pool');
    expect(query).not.toContain('src');
    expect(query).not.toContain('lib');
  });

  it('skips node_modules, test, tests, build directories', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });

    await searchMemoryForContext(storage, 'project', [
      'node_modules/lodash/debounce.js',
      'test/checker.spec.ts',
      'tests/integration/runner.spec.ts',
      'build/output.js',
    ]);

    const call = vi.mocked(storage.searchObservations).mock.calls[0]!;
    const query = call[1];
    // Verify excluded dirs are not in query as standalone terms
    const terms = query.split(' ');
    expect(terms).not.toContain('node_modules');
    expect(terms).not.toContain('test');
    expect(terms).not.toContain('tests');
    expect(terms).not.toContain('build');
    // But meaningful segments should be kept
    expect(query).toContain('lodash');
    expect(query).toContain('debounce');
  });

  it('removes file extensions from names', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });

    await searchMemoryForContext(storage, 'project', [
      'src/services/payment.service.ts',
    ]);

    const call = vi.mocked(storage.searchObservations).mock.calls[0]!;
    const query = call[1];
    // 'payment.service' → removes last extension → 'payment.service' (only last ext removed)
    // Actually regex: /\.[^.]+$/ removes '.ts' → 'payment.service'
    expect(query).toContain('services');
    expect(query).toContain('payment.service');
    expect(query).not.toContain('.ts');
  });

  it('deduplicates terms using a Set', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });

    await searchMemoryForContext(storage, 'project', [
      'src/auth/login.ts',
      'src/auth/logout.ts',
    ]);

    const call = vi.mocked(storage.searchObservations).mock.calls[0]!;
    const query = call[1];
    // 'auth' should appear only once
    const terms = query.split(' ');
    const authCount = terms.filter(t => t === 'auth').length;
    expect(authCount).toBe(1);
  });

  it('limits search terms to 10', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });

    const files = Array.from({ length: 15 }, (_, i) => `dir${i}/file${i}.ts`);
    await searchMemoryForContext(storage, 'project', files);

    const call = vi.mocked(storage.searchObservations).mock.calls[0]!;
    const query = call[1];
    const terms = query.split(' ');
    expect(terms.length).toBeLessThanOrEqual(10);
  });

  // ── searchObservations call ──

  it('calls storage.searchObservations with correct project, query, and limit', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });

    await searchMemoryForContext(storage, 'owner/repo', ['src/services/auth.ts']);

    expect(storage.searchObservations).toHaveBeenCalledWith(
      'owner/repo',
      expect.any(String),
      { limit: 3 },
    );
  });

  // ── No observations found ──

  it('returns null when searchObservations returns empty array', async () => {
    const storage = createMockStorage();

    const result = await searchMemoryForContext(storage, 'project', ['src/services/auth.ts']);
    expect(result).toBeNull();
  });

  it('returns null when searchObservations returns null', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue(null as any),
    });

    const result = await searchMemoryForContext(storage, 'project', ['src/services/auth.ts']);
    expect(result).toBeNull();
  });

  // ── Successful formatting ──

  it('formats observations and returns the context string', async () => {
    const observations = [
      makeObservation({ type: 'pattern', title: 'Auth pattern', content: 'Uses JWT tokens' }),
      makeObservation({ type: 'bugfix', title: 'Race condition', content: 'Fixed async issue' }),
    ];
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue(observations),
    });

    const result = await searchMemoryForContext(storage, 'project', ['src/services/auth.ts']);

    expect(mockFormatMemoryContext).toHaveBeenCalledWith([
      { type: 'pattern', title: 'Auth pattern', content: 'Uses JWT tokens' },
      { type: 'bugfix', title: 'Race condition', content: 'Fixed async issue' },
    ]);
    expect(result).toBe('Formatted: 2 observations');
  });

  it('maps observations to type/title/content only (strips filePaths)', async () => {
    const observations = [
      makeObservation({
        type: 'discovery',
        title: 'Test',
        content: 'Content',
        filePaths: ['a.ts', 'b.ts'],
      }),
    ];
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue(observations),
    });

    await searchMemoryForContext(storage, 'project', ['src/services/auth.ts']);

    expect(mockFormatMemoryContext).toHaveBeenCalledWith([
      { type: 'discovery', title: 'Test', content: 'Content' },
    ]);
  });

  // ── Error handling ──

  it('returns null when searchObservations throws', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockRejectedValue(new Error('DB timeout')),
    });

    const result = await searchMemoryForContext(storage, 'project', ['src/auth/login.ts']);
    expect(result).toBeNull();
  });

  it('logs a warning when an error occurs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockRejectedValue(new Error('Connection lost')),
    });

    await searchMemoryForContext(storage, 'project', ['src/auth/login.ts']);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ghagga]'),
      expect.stringContaining('Connection lost'),
    );

    warnSpy.mockRestore();
  });

  it('returns null when formatMemoryContext throws', async () => {
    const storage = createMockStorage({
      searchObservations: vi.fn<MemoryStorage['searchObservations']>().mockResolvedValue([makeObservation()]),
    });
    mockFormatMemoryContext.mockImplementation(() => { throw new Error('Format error'); });

    const result = await searchMemoryForContext(storage, 'project', ['src/auth/login.ts']);
    expect(result).toBeNull();
  });
});
