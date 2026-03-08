import { describe, expect, it } from 'vitest';
import {
  fromEngramContent,
  toEngramContent,
  toEngramSaveData,
  toMemoryObservationDetail,
  toMemoryObservationRow,
} from './engram-mapping.js';
import type { EngramObservation } from './engram-types.js';

// ─── Helpers ────────────────────────────────────────────────────

function makeEngramObservation(overrides: Partial<EngramObservation> = {}): EngramObservation {
  return {
    id: 42,
    type: 'pattern',
    title: 'Test observation',
    content: 'Some content\n---\nSource: ghagga',
    project: 'owner/repo',
    topic_key: 'test-key',
    revision_count: 1,
    created_at: '2025-06-01T10:00:00Z',
    updated_at: '2025-06-01T12:00:00Z',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('toEngramContent()', () => {
  it('returns content + Source footer for content-only input', () => {
    const result = toEngramContent({ content: 'Hello world' });

    expect(result).toBe('Hello world\n---\nSource: ghagga');
  });

  it('prepends [severity:xxx] when severity is provided', () => {
    const result = toEngramContent({ content: 'Bug found', severity: 'high' });

    expect(result).toBe('[severity:high]\nBug found\n---\nSource: ghagga');
  });

  it('appends Files footer when filePaths are provided', () => {
    const result = toEngramContent({
      content: 'Auth issue',
      filePaths: ['src/auth.ts', 'src/login.ts'],
    });

    expect(result).toBe('Auth issue\n---\nFiles: src/auth.ts, src/login.ts\n---\nSource: ghagga');
  });

  it('includes both severity and filePaths', () => {
    const result = toEngramContent({
      content: 'Critical bug',
      severity: 'critical',
      filePaths: ['a.ts', 'b.ts'],
    });

    expect(result).toBe(
      '[severity:critical]\nCritical bug\n---\nFiles: a.ts, b.ts\n---\nSource: ghagga',
    );
  });

  it('produces clean output when severity is null and filePaths is null', () => {
    const result = toEngramContent({
      content: 'Clean content',
      severity: null,
      filePaths: null,
    });

    expect(result).toBe('Clean content\n---\nSource: ghagga');
  });

  it('produces clean output when severity is undefined and filePaths is undefined', () => {
    const result = toEngramContent({ content: 'Clean content' });

    expect(result).toBe('Clean content\n---\nSource: ghagga');
  });

  it('skips empty filePaths array', () => {
    const result = toEngramContent({
      content: 'No files',
      filePaths: [],
    });

    expect(result).toBe('No files\n---\nSource: ghagga');
  });

  it('includes single file in Files footer', () => {
    const result = toEngramContent({
      content: 'Issue',
      filePaths: ['only-one.ts'],
    });

    expect(result).toBe('Issue\n---\nFiles: only-one.ts\n---\nSource: ghagga');
  });

  it('does not include severity when severity is empty string', () => {
    const result = toEngramContent({
      content: 'Content',
      severity: '',
    });

    // Empty string is falsy so severity should not be prepended
    expect(result).toBe('Content\n---\nSource: ghagga');
    expect(result).not.toContain('[severity:');
  });
});

describe('fromEngramContent()', () => {
  it('returns raw content with null severity and null filePaths for plain content', () => {
    const result = fromEngramContent('Just plain text with no markers');

    expect(result).toEqual({
      content: 'Just plain text with no markers',
      severity: null,
      filePaths: null,
    });
  });

  it('extracts severity from [severity:high] marker', () => {
    const result = fromEngramContent('[severity:high]\nSome content\n---\nSource: ghagga');

    expect(result.severity).toBe('high');
    expect(result.content).toBe('Some content');
  });

  it('extracts filePaths from Files footer', () => {
    const result = fromEngramContent('Content here\n---\nFiles: a.ts, b.ts\n---\nSource: ghagga');

    expect(result.filePaths).toEqual(['a.ts', 'b.ts']);
    expect(result.content).toBe('Content here');
  });

  it('extracts both severity and filePaths', () => {
    const result = fromEngramContent(
      '[severity:critical]\nBug details\n---\nFiles: x.ts, y.ts\n---\nSource: ghagga',
    );

    expect(result.severity).toBe('critical');
    expect(result.filePaths).toEqual(['x.ts', 'y.ts']);
    expect(result.content).toBe('Bug details');
  });

  it('returns non-GHAGGA content as-is', () => {
    const result = fromEngramContent('This was written by another tool');

    expect(result).toEqual({
      content: 'This was written by another tool',
      severity: null,
      filePaths: null,
    });
  });

  it('strips Source: ghagga footer from content', () => {
    const result = fromEngramContent('Clean body\n---\nSource: ghagga');

    expect(result.content).toBe('Clean body');
    expect(result.content).not.toContain('Source: ghagga');
  });

  it('handles content with multi-line body', () => {
    const result = fromEngramContent(
      '[severity:medium]\nLine 1\nLine 2\nLine 3\n---\nSource: ghagga',
    );

    expect(result.severity).toBe('medium');
    expect(result.content).toBe('Line 1\nLine 2\nLine 3');
  });

  it('does not extract severity when bracket content contains non-word chars', () => {
    const result = fromEngramContent('[severity:]\nContent\n---\nSource: ghagga');

    // The regex (\w+) requires at least one word character, so empty value won't match
    expect(result.severity).toBeNull();
    expect(result.content).toBe('[severity:]\nContent');
  });

  it('does not extract severity when bracket has spaces', () => {
    const result = fromEngramContent('[severity:very high]\nContent\n---\nSource: ghagga');

    // The regex (\w+) won't match "very high" (space not a word char)
    expect(result.severity).toBeNull();
  });

  it('extracts single file from Files footer', () => {
    const result = fromEngramContent(
      'Content here\n---\nFiles: single-file.ts\n---\nSource: ghagga',
    );

    expect(result.filePaths).toEqual(['single-file.ts']);
    expect(result.content).toBe('Content here');
  });

  it('filters out empty file entries from Files footer', () => {
    const result = fromEngramContent('Content\n---\nFiles: a.ts, , b.ts, \n---\nSource: ghagga');

    // Empty entries should be filtered out by .filter(f => f.length > 0)
    expect(result.filePaths).toEqual(['a.ts', 'b.ts']);
  });

  it('handles Files footer with only whitespace entries', () => {
    const result = fromEngramContent('Content\n---\nFiles:  ,  ,  \n---\nSource: ghagga');

    // After trim + filter(f => f.length > 0), no entries remain
    expect(result.filePaths).toEqual([]);
  });

  it('handles content with --- separator inside the body', () => {
    const result = fromEngramContent('Line 1\n---\nLine 2\n---\nSource: ghagga');

    // The lastIndexOf for Source: ghagga finds the last one.
    // The content before Source footer is "Line 1\n---\nLine 2"
    // No "Files: " found in that, so body = "Line 1\n---\nLine 2"
    expect(result.content).toBe('Line 1\n---\nLine 2');
    expect(result.filePaths).toBeNull();
  });

  it('trims whitespace from file paths', () => {
    const result = fromEngramContent('Content\n---\nFiles:  a.ts ,  b.ts \n---\nSource: ghagga');

    expect(result.filePaths).toEqual(['a.ts', 'b.ts']);
  });

  it('handles many files in Files footer', () => {
    const files = Array.from({ length: 20 }, (_, i) => `file${i}.ts`);
    const result = fromEngramContent(
      `Content\n---\nFiles: ${files.join(', ')}\n---\nSource: ghagga`,
    );

    expect(result.filePaths).toEqual(files);
    expect(result.filePaths).toHaveLength(20);
  });
});

describe('toMemoryObservationRow()', () => {
  it('maps Engram observation to GHAGGA row correctly', () => {
    const obs = makeEngramObservation({
      id: 42,
      type: 'pattern',
      title: 'Auth pattern',
      content: '[severity:high]\nUse JWT\n---\nFiles: src/auth.ts\n---\nSource: ghagga',
    });

    const row = toMemoryObservationRow(obs);

    expect(row).toEqual({
      id: 42,
      type: 'pattern',
      title: 'Auth pattern',
      content: 'Use JWT',
      filePaths: ['src/auth.ts'],
      severity: 'high',
    });
  });

  it('handles missing optional fields', () => {
    const obs: EngramObservation = {
      id: 7,
      type: 'observation',
      title: 'Simple',
      content: 'No metadata\n---\nSource: ghagga',
    };

    const row = toMemoryObservationRow(obs);

    expect(row.id).toBe(7);
    expect(row.type).toBe('observation');
    expect(row.title).toBe('Simple');
    expect(row.content).toBe('No metadata');
    expect(row.severity).toBeNull();
    expect(row.filePaths).toBeNull();
  });

  it('converts string numeric ID to number', () => {
    const obs = makeEngramObservation({ id: '123' });
    const row = toMemoryObservationRow(obs);

    expect(row.id).toBe(123);
  });

  it('hashes non-numeric string ID to positive integer', () => {
    const obs = makeEngramObservation({ id: 'abc-def-uuid-123' });
    const row = toMemoryObservationRow(obs);

    expect(typeof row.id).toBe('number');
    expect(row.id).toBeGreaterThanOrEqual(0);
  });

  it('defaults type to "observation" when missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock cast
    const obs = makeEngramObservation({ type: undefined as any });
    const row = toMemoryObservationRow(obs);

    expect(row.type).toBe('observation');
  });

  it('defaults title to empty string when missing', () => {
    // biome-ignore lint/suspicious/noExplicitAny: mock cast
    const obs = makeEngramObservation({ title: undefined as any });
    const row = toMemoryObservationRow(obs);

    expect(row.title).toBe('');
  });

  it('produces deterministic hash for same string ID', () => {
    const obs1 = makeEngramObservation({ id: 'abc-def-uuid-123' });
    const obs2 = makeEngramObservation({ id: 'abc-def-uuid-123' });

    const row1 = toMemoryObservationRow(obs1);
    const row2 = toMemoryObservationRow(obs2);

    expect(row1.id).toBe(row2.id);
  });

  it('produces different hashes for different string IDs', () => {
    const obs1 = makeEngramObservation({ id: 'uuid-aaa' });
    const obs2 = makeEngramObservation({ id: 'uuid-zzz' });

    const row1 = toMemoryObservationRow(obs1);
    const row2 = toMemoryObservationRow(obs2);

    expect(row1.id).not.toBe(row2.id);
  });

  it('returns number ID directly without parsing', () => {
    const obs = makeEngramObservation({ id: 0 });
    const row = toMemoryObservationRow(obs);

    expect(row.id).toBe(0);
  });
});

describe('toMemoryObservationDetail()', () => {
  it('maps all detail fields correctly', () => {
    const obs = makeEngramObservation({
      id: 99,
      type: 'bugfix',
      title: 'Fix SQL injection',
      content:
        '[severity:critical]\nUse parameterized queries\n---\nFiles: src/db.ts\n---\nSource: ghagga',
      project: 'acme/widgets',
      topic_key: 'sql-injection',
      revision_count: 3,
      created_at: '2025-01-15T08:00:00Z',
      updated_at: '2025-01-16T12:00:00Z',
    });

    const detail = toMemoryObservationDetail(obs);

    expect(detail).toEqual({
      id: 99,
      type: 'bugfix',
      title: 'Fix SQL injection',
      content: 'Use parameterized queries',
      filePaths: ['src/db.ts'],
      severity: 'critical',
      project: 'acme/widgets',
      topicKey: 'sql-injection',
      revisionCount: 3,
      createdAt: '2025-01-15T08:00:00Z',
      updatedAt: '2025-01-16T12:00:00Z',
    });
  });

  it('handles timestamps defaulting when created_at and updated_at are missing', () => {
    const obs: EngramObservation = {
      id: 1,
      type: 'pattern',
      title: 'Test',
      content: 'Content\n---\nSource: ghagga',
    };

    const detail = toMemoryObservationDetail(obs);

    // Should use fallback timestamps (new Date().toISOString())
    expect(detail.createdAt).toEqual(expect.any(String));
    expect(detail.updatedAt).toEqual(expect.any(String));
    // Both should be valid ISO strings
    expect(new Date(detail.createdAt).toISOString()).toBe(detail.createdAt);
    expect(new Date(detail.updatedAt).toISOString()).toBe(detail.updatedAt);
  });

  it('uses created_at for updatedAt when updated_at is missing', () => {
    const obs = makeEngramObservation({
      created_at: '2025-03-01T10:00:00Z',
      updated_at: undefined,
    });

    const detail = toMemoryObservationDetail(obs);

    expect(detail.updatedAt).toBe('2025-03-01T10:00:00Z');
  });

  it('defaults project to empty string when missing', () => {
    const obs: EngramObservation = {
      id: 1,
      type: 'pattern',
      title: 'Test',
      content: 'Content',
    };

    const detail = toMemoryObservationDetail(obs);

    expect(detail.project).toBe('');
  });

  it('defaults topicKey to null when missing', () => {
    const obs = makeEngramObservation({ topic_key: undefined });

    const detail = toMemoryObservationDetail(obs);

    expect(detail.topicKey).toBeNull();
  });

  it('defaults revisionCount to 1 when missing', () => {
    const obs = makeEngramObservation({ revision_count: undefined });

    const detail = toMemoryObservationDetail(obs);

    expect(detail.revisionCount).toBe(1);
  });
});

describe('toEngramSaveData()', () => {
  it('maps save data correctly', () => {
    const payload = toEngramSaveData({
      project: 'acme/widgets',
      type: 'pattern',
      title: 'Auth pattern',
      content: 'Use JWT tokens',
    });

    expect(payload.type).toBe('pattern');
    expect(payload.title).toBe('Auth pattern');
    expect(payload.project).toBe('acme/widgets');
    expect(payload.content).toContain('Use JWT tokens');
    expect(payload.content).toContain('Source: ghagga');
  });

  it('includes topic_key when topicKey is present', () => {
    const payload = toEngramSaveData({
      project: 'acme/widgets',
      type: 'pattern',
      title: 'Test',
      content: 'Content',
      topicKey: 'auth-topic',
    });

    expect(payload.topic_key).toBe('auth-topic');
  });

  it('omits topic_key when topicKey is not present', () => {
    const payload = toEngramSaveData({
      project: 'acme/widgets',
      type: 'pattern',
      title: 'Test',
      content: 'Content',
    });

    expect(payload.topic_key).toBeUndefined();
  });

  it('embeds severity in content', () => {
    const payload = toEngramSaveData({
      project: 'acme/widgets',
      type: 'discovery',
      title: 'Security issue',
      content: 'SQL injection found',
      severity: 'critical',
    });

    expect(payload.content).toContain('[severity:critical]');
    expect(payload.content).toContain('SQL injection found');
  });

  it('embeds filePaths in content', () => {
    const payload = toEngramSaveData({
      project: 'acme/widgets',
      type: 'pattern',
      title: 'File pattern',
      content: 'Pattern details',
      filePaths: ['src/auth.ts', 'src/db.ts'],
    });

    expect(payload.content).toContain('Files: src/auth.ts, src/db.ts');
  });

  it('embeds both severity and filePaths in content', () => {
    const payload = toEngramSaveData({
      project: 'acme/widgets',
      type: 'discovery',
      title: 'Combined',
      content: 'Issue details',
      severity: 'high',
      filePaths: ['a.ts'],
    });

    expect(payload.content).toContain('[severity:high]');
    expect(payload.content).toContain('Issue details');
    expect(payload.content).toContain('Files: a.ts');
    expect(payload.content).toContain('Source: ghagga');
  });
});
