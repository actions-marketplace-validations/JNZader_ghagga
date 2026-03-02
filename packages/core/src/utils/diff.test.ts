import { describe, it, expect } from 'vitest';
import { parseDiffFiles, filterIgnoredFiles, truncateDiff } from './diff.js';

// ─── parseDiffFiles ─────────────────────────────────────────────

describe('parseDiffFiles', () => {
  it('parses a single file diff correctly', () => {
    const diff = [
      'diff --git a/src/index.ts b/src/index.ts',
      '--- a/src/index.ts',
      '+++ b/src/index.ts',
      '@@ -1,3 +1,4 @@',
      " import { foo } from './foo';",
      "+import { bar } from './bar';",
      ' ',
      ' export function main() {',
      '-  return foo();',
      '+  return bar(foo());',
      ' }',
    ].join('\n');

    const files = parseDiffFiles(diff);

    expect(files).toHaveLength(1);
    expect(files[0]!.path).toBe('src/index.ts');
    expect(files[0]!.additions).toBe(2);
    expect(files[0]!.deletions).toBe(1);
    expect(files[0]!.content).toContain('diff --git');
    expect(files[0]!.content).toContain("+import { bar } from './bar';");
  });

  it('parses multiple files in one diff', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' const x = 1;',
      '+const y = 2;',
      ' export { x };',
      'diff --git a/src/b.ts b/src/b.ts',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -1 +1 @@',
      '-const old = true;',
      '+const updated = true;',
    ].join('\n');

    const files = parseDiffFiles(diff);

    expect(files).toHaveLength(2);
    expect(files[0]!.path).toBe('src/a.ts');
    expect(files[1]!.path).toBe('src/b.ts');
  });

  it('counts additions and deletions correctly (ignores +++ and --- header lines)', () => {
    const diff = [
      'diff --git a/file.ts b/file.ts',
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,4 +1,4 @@',
      ' line1',
      '-removed1',
      '-removed2',
      '+added1',
      '+added2',
      '+added3',
      ' line4',
    ].join('\n');

    const files = parseDiffFiles(diff);

    expect(files).toHaveLength(1);
    // +++ should NOT be counted; only real additions: added1, added2, added3
    expect(files[0]!.additions).toBe(3);
    // --- should NOT be counted; only real deletions: removed1, removed2
    expect(files[0]!.deletions).toBe(2);
  });

  it('returns empty array for empty string', () => {
    expect(parseDiffFiles('')).toEqual([]);
  });

  it('returns empty array for non-diff content', () => {
    const text = 'This is just some plain text\nwith multiple lines\nbut no diff headers.';
    expect(parseDiffFiles(text)).toEqual([]);
  });
});

// ─── filterIgnoredFiles ─────────────────────────────────────────

describe('filterIgnoredFiles', () => {
  const makeFile = (path: string) => ({
    path,
    additions: 1,
    deletions: 0,
    content: `diff for ${path}`,
  });

  it('keeps files that do not match any pattern', () => {
    const files = [makeFile('src/index.ts'), makeFile('src/utils.ts')];
    const result = filterIgnoredFiles(files, ['*.md']);
    expect(result).toHaveLength(2);
  });

  it('filters out files matching *.md pattern', () => {
    const files = [makeFile('src/index.ts'), makeFile('README.md')];
    const result = filterIgnoredFiles(files, ['*.md']);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/index.ts');
  });

  it('filters out files matching *.lock pattern', () => {
    const files = [makeFile('src/app.ts'), makeFile('pnpm-lock.yaml'), makeFile('package-lock.json')];
    // *.lock won't match pnpm-lock.yaml; need to use the right pattern
    const result = filterIgnoredFiles(files, ['*.lock']);
    // pnpm-lock.yaml and package-lock.json don't end in .lock, so they're kept
    expect(result).toHaveLength(3);

    // Now test with an actual .lock file
    const files2 = [makeFile('src/app.ts'), makeFile('yarn.lock')];
    const result2 = filterIgnoredFiles(files2, ['*.lock']);
    expect(result2).toHaveLength(1);
    expect(result2[0]!.path).toBe('src/app.ts');
  });

  it('supports ** glob patterns', () => {
    const files = [
      makeFile('src/index.ts'),
      makeFile('dist/index.js'),
      makeFile('dist/utils/helper.js'),
    ];
    const result = filterIgnoredFiles(files, ['dist/**']);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/index.ts');
  });

  it('returns all files when patterns array is empty', () => {
    const files = [makeFile('a.md'), makeFile('b.lock'), makeFile('c.ts')];
    const result = filterIgnoredFiles(files, []);
    expect(result).toHaveLength(3);
  });

  it('handles multiple patterns simultaneously', () => {
    const files = [
      makeFile('src/index.ts'),
      makeFile('README.md'),
      makeFile('CHANGELOG.md'),
      makeFile('yarn.lock'),
      makeFile('dist/bundle.js'),
    ];
    const result = filterIgnoredFiles(files, ['*.md', '*.lock', 'dist/**']);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/index.ts');
  });

  it('filters based on basename matching for ** patterns', () => {
    const files = [
      makeFile('src/utils/diff.test.ts'),
      makeFile('src/index.ts'),
    ];
    const result = filterIgnoredFiles(files, ['**/*.test.ts']);
    expect(result).toHaveLength(1);
    expect(result[0]!.path).toBe('src/index.ts');
  });
});

// ─── truncateDiff ───────────────────────────────────────────────

describe('truncateDiff', () => {
  it('returns original diff unchanged when within budget', () => {
    const diff = 'short diff content';
    // 1 token ≈ 4 chars; 100 tokens = 400 chars. "short diff content" is well under.
    const result = truncateDiff(diff, 100);
    expect(result.truncated).toBe(diff);
    expect(result.wasTruncated).toBe(false);
  });

  it('truncates long diff at line boundaries', () => {
    // Create a diff with multiple lines
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}: ${'x'.repeat(40)}`);
    const diff = lines.join('\n');
    // Give a small budget to force truncation
    const result = truncateDiff(diff, 50); // 50 tokens = 200 chars
    // Should end at a line boundary (no partial lines)
    expect(result.truncated).not.toMatch(/line \d+: x+[^x\n]/);
    expect(result.wasTruncated).toBe(true);
  });

  it('sets wasTruncated flag correctly', () => {
    const shortDiff = 'abc';
    expect(truncateDiff(shortDiff, 100).wasTruncated).toBe(false);

    const longDiff = 'a'.repeat(1000);
    expect(truncateDiff(longDiff, 10).wasTruncated).toBe(true);
  });

  it('appends truncation notice', () => {
    const longDiff = 'a'.repeat(1000);
    const result = truncateDiff(longDiff, 10); // 10 tokens = 40 chars
    expect(result.truncated).toContain('[... diff truncated to fit token budget ...]');
  });

  it('handles very small budget', () => {
    const diff = 'line1\nline2\nline3';
    // 0 tokens = 0 chars
    const result0 = truncateDiff(diff, 0);
    expect(result0.wasTruncated).toBe(true);
    expect(result0.truncated).toContain('[... diff truncated to fit token budget ...]');

    // 1 token = 4 chars
    const result1 = truncateDiff(diff, 1);
    expect(result1.wasTruncated).toBe(true);
    expect(result1.truncated).toContain('[... diff truncated to fit token budget ...]');
  });
});
