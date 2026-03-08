/**
 * Tests for markdownlint-cli2 plugin — parse function with fixture data.
 *
 * Validates Markdown linting, severity mapping, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { markdownlintPlugin, parseMarkdownlintOutput } from '../markdownlint.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'markdownlint-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('markdownlintPlugin metadata', () => {
  it('has correct name', () => {
    expect(markdownlintPlugin.name).toBe('markdownlint');
  });

  it('has correct category', () => {
    expect(markdownlintPlugin.category).toBe('docs');
  });

  it('has correct tier', () => {
    expect(markdownlintPlugin.tier).toBe('always-on');
  });

  it('has correct version', () => {
    expect(markdownlintPlugin.version).toBe('0.17.1');
  });

  it('has correct output format', () => {
    expect(markdownlintPlugin.outputFormat).toBe('json');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseMarkdownlintOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('all findings have info severity', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.severity).toBe('info');
    }
  });

  it('all findings have docs category', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('docs');
    }
  });

  it('sets source to markdownlint', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('markdownlint');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('README.md');
  });

  it('includes line numbers', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(5);
    expect(findings[1]?.line).toBe(12);
    expect(findings[2]?.line).toBe(30);
  });

  it('includes rule name and description in message', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('MD001');
    expect(findings[0]?.message).toContain('Heading levels should only increment');
  });

  it('includes error detail when present', () => {
    const findings = parseMarkdownlintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('Expected: h2; Actual: h3');
  });

  it('handles findings without error detail', () => {
    const json = JSON.stringify([
      {
        fileName: '/workspace/test.md',
        lineNumber: 1,
        ruleNames: ['MD041', 'first-line-heading'],
        ruleDescription: 'First line in a file should be a top-level heading',
        errorDetail: null,
      },
    ]);
    const findings = parseMarkdownlintOutput(makeRaw(json), '/workspace');
    expect(findings[0]?.message).toBe('MD041: First line in a file should be a top-level heading');
  });

  it('returns empty findings for empty array', () => {
    expect(parseMarkdownlintOutput(makeRaw('[]'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseMarkdownlintOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseMarkdownlintOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseMarkdownlintOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
