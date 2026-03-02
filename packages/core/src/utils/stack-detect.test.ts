import { describe, it, expect } from 'vitest';
import { detectStacks } from './stack-detect.js';

describe('detectStacks', () => {
  it('detects TypeScript from .ts files', () => {
    const stacks = detectStacks(['src/index.ts', 'src/utils.ts']);
    expect(stacks).toContain('typescript');
  });

  it('detects TypeScript + React from .tsx files', () => {
    const stacks = detectStacks(['src/App.tsx']);
    expect(stacks).toContain('typescript');
    expect(stacks).toContain('react');
  });

  it('detects multiple stacks from mixed file list', () => {
    const stacks = detectStacks([
      'src/index.ts',
      'lib/utils.py',
      'cmd/main.go',
      'src/App.tsx',
    ]);
    expect(stacks).toContain('typescript');
    expect(stacks).toContain('python');
    expect(stacks).toContain('go');
    expect(stacks).toContain('react');
  });

  it('returns empty array for empty file list', () => {
    expect(detectStacks([])).toEqual([]);
  });

  it('returns empty array for unrecognized extensions', () => {
    const stacks = detectStacks(['data.xml', 'config.json', 'image.png', 'styles.css']);
    expect(stacks).toEqual([]);
  });

  it('deduplicates stack entries', () => {
    // Both .ts and .tsx map to 'typescript'; it should only appear once
    const stacks = detectStacks(['src/index.ts', 'src/App.tsx', 'src/utils.ts']);
    const typescriptCount = stacks.filter((s) => s === 'typescript').length;
    expect(typescriptCount).toBe(1);
  });

  it('handles files with multiple dots', () => {
    // extname('utils.test.ts') returns '.ts'
    const stacks = detectStacks(['src/utils.test.ts', 'src/app.spec.tsx']);
    expect(stacks).toContain('typescript');
    expect(stacks).toContain('react');
  });

  it('is case-insensitive for extensions', () => {
    const stacks = detectStacks(['FILE.TS', 'Component.TSX', 'script.Py']);
    expect(stacks).toContain('typescript');
    expect(stacks).toContain('react');
    expect(stacks).toContain('python');
  });
});
