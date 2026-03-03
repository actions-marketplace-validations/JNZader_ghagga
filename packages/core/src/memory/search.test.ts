import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ──────────────────────────────────────────────────────

vi.mock('ghagga-db', () => ({
  searchObservations: vi.fn(),
}));

vi.mock('./context.js', () => ({
  formatMemoryContext: vi.fn((obs: any[]) => `Formatted: ${obs.length} observations`),
}));

import { searchObservations } from 'ghagga-db';
import { formatMemoryContext } from './context.js';
import { searchMemoryForContext } from './search.js';

// ─── Helpers ────────────────────────────────────────────────────

const mockSearchObservations = vi.mocked(searchObservations);
const mockFormatMemoryContext = vi.mocked(formatMemoryContext);

function makeObservation(overrides: Partial<{ type: string; title: string; content: string; filePaths: string[] | null }> = {}) {
  return {
    type: 'pattern',
    title: 'Test observation',
    content: 'Some content here.',
    filePaths: ['src/auth.ts'],
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('searchMemoryForContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchObservations.mockResolvedValue([]);
  });

  // ── Null returns for falsy db ──

  it('returns null when db is null', async () => {
    const result = await searchMemoryForContext(null, 'owner/repo', ['src/auth.ts']);
    expect(result).toBeNull();
    expect(mockSearchObservations).not.toHaveBeenCalled();
  });

  it('returns null when db is undefined', async () => {
    const result = await searchMemoryForContext(undefined, 'owner/repo', ['src/auth.ts']);
    expect(result).toBeNull();
  });

  it('returns null when db is empty string (falsy)', async () => {
    const result = await searchMemoryForContext('', 'owner/repo', ['src/auth.ts']);
    expect(result).toBeNull();
  });

  // ── Empty/excluded file lists ──

  it('returns null when file list is empty', async () => {
    const result = await searchMemoryForContext({ db: true }, 'project', []);
    expect(result).toBeNull();
    expect(mockSearchObservations).not.toHaveBeenCalled();
  });

  it('returns null when all files are in excluded directories', async () => {
    const result = await searchMemoryForContext(
      { db: true },
      'project',
      ['src/a.ts', 'lib/b.ts', 'dist/c.js'],
    );
    // All segments after split: 'src' (excluded), 'a' (name, but 'a'.length == 1 ≤ 2),
    // 'lib' (excluded), 'b' (too short), 'dist' (excluded), 'c' (too short)
    // → query is empty string → returns null
    expect(result).toBeNull();
  });

  it('returns null when all file names are too short (≤ 2 chars)', async () => {
    const result = await searchMemoryForContext(
      { db: true },
      'project',
      ['ab.ts'],  // 'ab' has length 2, which is ≤ 2
    );
    expect(result).toBeNull();
  });

  // ── buildSearchQuery logic ──

  it('extracts meaningful path segments as search terms', async () => {
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);

    await searchMemoryForContext({ db: true }, 'project', [
      'src/auth/login.ts',
      'lib/db/pool.ts',
    ]);

    // 'src' excluded, 'auth' kept, 'login' kept (extension removed)
    // 'lib' excluded, 'db' too short (2), 'pool' kept
    expect(mockSearchObservations).toHaveBeenCalledWith(
      { db: true },
      'project',
      expect.stringContaining('auth'),
      { limit: 8 },
    );
    const query = mockSearchObservations.mock.calls[0]![2] as string;
    expect(query).toContain('login');
    expect(query).toContain('pool');
    expect(query).not.toContain('src');
    expect(query).not.toContain('lib');
  });

  it('skips node_modules, test, tests, build directories', async () => {
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);

    await searchMemoryForContext({ db: true }, 'project', [
      'node_modules/lodash/debounce.js',
      'test/checker.spec.ts',
      'tests/integration/runner.spec.ts',
      'build/output.js',
    ]);

    const query = mockSearchObservations.mock.calls[0]![2] as string;
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
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);

    await searchMemoryForContext({ db: true }, 'project', [
      'src/services/payment.service.ts',
    ]);

    const query = mockSearchObservations.mock.calls[0]![2] as string;
    // 'payment.service' → removes last extension → 'payment.service' (only last ext removed)
    // Actually regex: /\.[^.]+$/ removes '.ts' → 'payment.service'
    expect(query).toContain('services');
    expect(query).toContain('payment.service');
    expect(query).not.toContain('.ts');
  });

  it('deduplicates terms using a Set', async () => {
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);

    await searchMemoryForContext({ db: true }, 'project', [
      'src/auth/login.ts',
      'src/auth/logout.ts',
    ]);

    const query = mockSearchObservations.mock.calls[0]![2] as string;
    // 'auth' should appear only once
    const terms = query.split(' ');
    const authCount = terms.filter(t => t === 'auth').length;
    expect(authCount).toBe(1);
  });

  it('limits search terms to 10', async () => {
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);

    const files = Array.from({ length: 15 }, (_, i) => `dir${i}/file${i}.ts`);
    await searchMemoryForContext({ db: true }, 'project', files);

    const query = mockSearchObservations.mock.calls[0]![2] as string;
    const terms = query.split(' ');
    expect(terms.length).toBeLessThanOrEqual(10);
  });

  // ── searchObservations call ──

  it('calls searchObservations with correct db, project, query, and limit', async () => {
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);

    await searchMemoryForContext({ db: true }, 'owner/repo', ['src/services/auth.ts']);

    expect(mockSearchObservations).toHaveBeenCalledWith(
      { db: true },
      'owner/repo',
      expect.any(String),
      { limit: 8 },
    );
  });

  // ── No observations found ──

  it('returns null when searchObservations returns empty array', async () => {
    mockSearchObservations.mockResolvedValue([] as any);

    const result = await searchMemoryForContext({ db: true }, 'project', ['src/services/auth.ts']);
    expect(result).toBeNull();
  });

  it('returns null when searchObservations returns null', async () => {
    mockSearchObservations.mockResolvedValue(null as any);

    const result = await searchMemoryForContext({ db: true }, 'project', ['src/services/auth.ts']);
    expect(result).toBeNull();
  });

  // ── Successful formatting ──

  it('formats observations and returns the context string', async () => {
    const observations = [
      makeObservation({ type: 'pattern', title: 'Auth pattern', content: 'Uses JWT tokens' }),
      makeObservation({ type: 'bugfix', title: 'Race condition', content: 'Fixed async issue' }),
    ];
    mockSearchObservations.mockResolvedValue(observations as any);

    const result = await searchMemoryForContext({ db: true }, 'project', ['src/services/auth.ts']);

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
    mockSearchObservations.mockResolvedValue(observations as any);

    await searchMemoryForContext({ db: true }, 'project', ['src/services/auth.ts']);

    expect(mockFormatMemoryContext).toHaveBeenCalledWith([
      { type: 'discovery', title: 'Test', content: 'Content' },
    ]);
  });

  // ── Error handling ──

  it('returns null when searchObservations throws', async () => {
    mockSearchObservations.mockRejectedValue(new Error('DB timeout'));

    const result = await searchMemoryForContext({ db: true }, 'project', ['src/auth/login.ts']);
    expect(result).toBeNull();
  });

  it('logs a warning when an error occurs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSearchObservations.mockRejectedValue(new Error('Connection lost'));

    await searchMemoryForContext({ db: true }, 'project', ['src/auth/login.ts']);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[ghagga]'),
      expect.stringContaining('Connection lost'),
    );

    warnSpy.mockRestore();
  });

  it('returns null when formatMemoryContext throws', async () => {
    mockSearchObservations.mockResolvedValue([makeObservation()] as any);
    mockFormatMemoryContext.mockImplementation(() => { throw new Error('Format error'); });

    const result = await searchMemoryForContext({ db: true }, 'project', ['src/auth/login.ts']);
    expect(result).toBeNull();
  });
});
