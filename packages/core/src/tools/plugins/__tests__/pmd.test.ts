/**
 * Tests for PMD plugin — parse function with fixture data.
 *
 * Validates Java code quality analysis, priority mapping, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { mapPmdPriority, parsePmdOutput, pmdPlugin } from '../pmd.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'pmd-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('pmdPlugin metadata', () => {
  it('has correct name', () => {
    expect(pmdPlugin.name).toBe('pmd');
  });

  it('has correct category', () => {
    expect(pmdPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(pmdPlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(pmdPlugin.version).toBe('7.8.0');
  });

  it('has correct output format', () => {
    expect(pmdPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('pmdPlugin detect', () => {
  it('detects Java files (.java)', () => {
    expect(pmdPlugin.detect?.(['src/main/java/App.java'])).toBe(true);
  });

  it('detects Kotlin files (.kt)', () => {
    expect(pmdPlugin.detect?.(['src/main/kotlin/App.kt'])).toBe(true);
  });

  it('does not detect non-Java/Kotlin files', () => {
    expect(pmdPlugin.detect?.(['src/app.ts', 'package.json'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(pmdPlugin.detect?.([])).toBe(false);
  });
});

// ─── Priority Mapping ───────────────────────────────────────────

describe('mapPmdPriority', () => {
  it('maps priority 1 to critical', () => {
    expect(mapPmdPriority(1)).toBe('critical');
  });

  it('maps priority 2 to high', () => {
    expect(mapPmdPriority(2)).toBe('high');
  });

  it('maps priority 3 to medium', () => {
    expect(mapPmdPriority(3)).toBe('medium');
  });

  it('maps priority 4 to low', () => {
    expect(mapPmdPriority(4)).toBe('low');
  });

  it('maps priority 5 to info', () => {
    expect(mapPmdPriority(5)).toBe('info');
  });

  it('maps unknown priority to low', () => {
    expect(mapPmdPriority(99)).toBe('low');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parsePmdOutput', () => {
  it('parses fixture JSON into 5 findings', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(5);
  });

  it('maps priority 1 to critical severity', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const criticalFinding = findings.find((f) => f.message.includes('EmptyCatchBlock'));
    expect(criticalFinding?.severity).toBe('critical');
  });

  it('maps priority 2 to high severity', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const highFinding = findings.find((f) => f.message.includes('CyclomaticComplexity'));
    expect(highFinding?.severity).toBe('high');
  });

  it('maps priority 3 to medium severity', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const mediumFinding = findings.find((f) => f.message.includes('UnusedLocalVariable'));
    expect(mediumFinding?.severity).toBe('medium');
  });

  it('maps priority 4 to low severity', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const lowFinding = findings.find((f) => f.message.includes('SystemPrintln'));
    expect(lowFinding?.severity).toBe('low');
  });

  it('maps priority 5 to info severity', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const infoFinding = findings.find((f) => f.message.includes('CommentedOutCode'));
    expect(infoFinding?.severity).toBe('info');
  });

  it('includes rule name in message', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('[EmptyCatchBlock]');
    expect(findings[0]?.message).toContain('Avoid empty catch blocks');
  });

  it('sets source to pmd', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('pmd');
    }
  });

  it('sets category to quality', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/main/java/com/example/App.java');
  });

  it('includes line numbers', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(25);
    expect(findings[1]?.line).toBe(30);
  });

  it('handles multiple files', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const files = new Set(findings.map((f) => f.file));
    expect(files.size).toBe(2);
  });

  it('returns empty findings for empty files array', () => {
    const raw = makeRaw(JSON.stringify({ files: [] }));
    expect(parsePmdOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for missing files field', () => {
    const raw = makeRaw(JSON.stringify({}));
    expect(parsePmdOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parsePmdOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parsePmdOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parsePmdOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });

  it('handles exit code 4 (violations found)', () => {
    const findings = parsePmdOutput(makeRaw(FIXTURE_JSON, 4), '/workspace');
    expect(findings).toHaveLength(5);
  });
});
