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

  // ── Mutant killers: cover ALL extension mappings ──

  it('detects javascript from .js files', () => {
    expect(detectStacks(['app.js'])).toContain('javascript');
  });

  it('detects javascript + react from .jsx files', () => {
    const stacks = detectStacks(['Component.jsx']);
    expect(stacks).toContain('javascript');
    expect(stacks).toContain('react');
  });

  it('detects javascript from .mjs files', () => {
    expect(detectStacks(['module.mjs'])).toContain('javascript');
  });

  it('detects javascript from .cjs files', () => {
    expect(detectStacks(['config.cjs'])).toContain('javascript');
  });

  it('detects java from .java files', () => {
    expect(detectStacks(['Main.java'])).toContain('java');
  });

  it('detects kotlin from .kt files', () => {
    expect(detectStacks(['App.kt'])).toContain('kotlin');
  });

  it('detects kotlin from .kts files', () => {
    expect(detectStacks(['build.gradle.kts'])).toContain('kotlin');
  });

  it('detects rust from .rs files', () => {
    expect(detectStacks(['main.rs'])).toContain('rust');
  });

  it('detects sql from .sql files', () => {
    expect(detectStacks(['migration.sql'])).toContain('sql');
  });

  it('detects csharp from .cs files', () => {
    expect(detectStacks(['Program.cs'])).toContain('csharp');
  });

  it('detects ruby from .rb files', () => {
    expect(detectStacks(['app.rb'])).toContain('ruby');
  });

  it('detects php from .php files', () => {
    expect(detectStacks(['index.php'])).toContain('php');
  });

  it('detects swift from .swift files', () => {
    expect(detectStacks(['ViewController.swift'])).toContain('swift');
  });

  it('detects scala from .scala files', () => {
    expect(detectStacks(['Main.scala'])).toContain('scala');
  });

  it('detects elixir from .ex files', () => {
    expect(detectStacks(['router.ex'])).toContain('elixir');
  });

  it('detects elixir from .exs files', () => {
    expect(detectStacks(['test_helper.exs'])).toContain('elixir');
  });

  it('detects go from .go files', () => {
    expect(detectStacks(['main.go'])).toContain('go');
  });

  it('detects python from .py files', () => {
    expect(detectStacks(['script.py'])).toContain('python');
  });

  // Verify exact mapping values (kills "" replacement mutants)
  it('maps .js to exactly "javascript" (not empty string)', () => {
    const stacks = detectStacks(['file.js']);
    expect(stacks).toEqual(['javascript']);
  });

  it('maps .jsx to exactly ["javascript", "react"]', () => {
    const stacks = detectStacks(['file.jsx']);
    expect(stacks).toContain('javascript');
    expect(stacks).toContain('react');
    expect(stacks).toHaveLength(2);
  });

  it('maps .java to exactly "java" (not empty string)', () => {
    const stacks = detectStacks(['File.java']);
    expect(stacks).toEqual(['java']);
  });
});
