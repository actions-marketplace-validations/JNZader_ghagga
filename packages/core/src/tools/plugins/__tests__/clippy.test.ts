/**
 * Tests for Clippy plugin — parse function with fixture data.
 *
 * Validates Rust linting, severity mapping, line-delimited JSON parsing,
 * detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { clippyPlugin, mapClippySeverity, parseClippyOutput } from '../clippy.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'clippy-output.jsonl');
const FIXTURE_JSONL = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('clippyPlugin metadata', () => {
  it('has correct name', () => {
    expect(clippyPlugin.name).toBe('clippy');
  });

  it('has correct category', () => {
    expect(clippyPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(clippyPlugin.tier).toBe('auto-detect');
  });

  it('has correct output format', () => {
    expect(clippyPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('clippyPlugin detect', () => {
  it('detects Cargo.toml', () => {
    expect(clippyPlugin.detect?.(['Cargo.toml', 'README.md'])).toBe(true);
  });

  it('detects .rs files', () => {
    expect(clippyPlugin.detect?.(['src/main.rs', 'README.md'])).toBe(true);
  });

  it('does not detect non-Rust files', () => {
    expect(clippyPlugin.detect?.(['src/app.ts', 'package.json'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(clippyPlugin.detect?.([])).toBe(false);
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapClippySeverity', () => {
  it('maps error to high', () => {
    expect(mapClippySeverity('error')).toBe('high');
  });

  it('maps warning to medium', () => {
    expect(mapClippySeverity('warning')).toBe('medium');
  });

  it('maps note to low', () => {
    expect(mapClippySeverity('note')).toBe('low');
  });

  it('maps help to info', () => {
    expect(mapClippySeverity('help')).toBe('info');
  });

  it('maps unknown to low', () => {
    expect(mapClippySeverity('unknown')).toBe('low');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseClippyOutput', () => {
  it('parses fixture JSONL into 4 compiler-message findings', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    // 4 compiler-message entries with spans + 1 build-finished (skipped)
    expect(findings).toHaveLength(4);
  });

  it('maps warning level to medium severity', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    const warningFinding = findings.find((f) => f.message.includes('unused variable'));
    expect(warningFinding?.severity).toBe('medium');
  });

  it('maps error level to high severity', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    const errorFinding = findings.find((f) => f.message.includes('moved value'));
    expect(errorFinding?.severity).toBe('high');
  });

  it('maps note level to low severity', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    const noteFinding = findings.find((f) => f.message.includes('clone'));
    expect(noteFinding?.severity).toBe('low');
  });

  it('maps help level to info severity', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    const helpFinding = findings.find((f) => f.message.includes('#[derive(Clone)]'));
    expect(helpFinding?.severity).toBe('info');
  });

  it('skips non-compiler-message entries (build-finished)', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    const buildFinished = findings.find((f) => f.message.includes('build-finished'));
    expect(buildFinished).toBeUndefined();
  });

  it('sets source to clippy', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('clippy');
    }
  });

  it('sets category to quality', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('includes file paths from spans', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    expect(findings[0]?.file).toBe('src/main.rs');
    expect(findings[1]?.file).toBe('src/lib.rs');
  });

  it('includes line numbers from spans', () => {
    const findings = parseClippyOutput(makeRaw(FIXTURE_JSONL), '/workspace');
    expect(findings[0]?.line).toBe(12);
    expect(findings[1]?.line).toBe(25);
  });

  it('returns empty findings for empty output', () => {
    expect(parseClippyOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseClippyOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSONL', () => {
    expect(parseClippyOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('handles single-line output', () => {
    const singleLine = JSON.stringify({
      reason: 'compiler-message',
      message: {
        level: 'warning',
        message: 'test warning',
        spans: [{ file_name: 'src/test.rs', line_start: 5 }],
      },
    });
    const findings = parseClippyOutput(makeRaw(singleLine), '/workspace');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.message).toBe('test warning');
  });
});
