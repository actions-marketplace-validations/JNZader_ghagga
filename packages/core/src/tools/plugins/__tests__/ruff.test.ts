/**
 * Tests for Ruff plugin — parse function with fixture data.
 *
 * Validates Python linting, severity mapping, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { mapRuffSeverity, parseRuffOutput, ruffPlugin } from '../ruff.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'ruff-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('ruffPlugin metadata', () => {
  it('has correct name', () => {
    expect(ruffPlugin.name).toBe('ruff');
  });

  it('has correct category', () => {
    expect(ruffPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(ruffPlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(ruffPlugin.version).toBe('0.9.7');
  });

  it('has correct output format', () => {
    expect(ruffPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('ruffPlugin detect', () => {
  it('detects Python files (.py)', () => {
    expect(ruffPlugin.detect?.(['src/main.py', 'README.md'])).toBe(true);
  });

  it('detects Python stub files (.pyi)', () => {
    expect(ruffPlugin.detect?.(['src/types.pyi'])).toBe(true);
  });

  it('does not detect non-Python files', () => {
    expect(ruffPlugin.detect?.(['src/app.ts', 'package.json'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(ruffPlugin.detect?.([])).toBe(false);
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapRuffSeverity', () => {
  it('maps F codes to high', () => {
    expect(mapRuffSeverity('F401')).toBe('high');
    expect(mapRuffSeverity('F841')).toBe('high');
  });

  it('maps E codes to medium', () => {
    expect(mapRuffSeverity('E501')).toBe('medium');
    expect(mapRuffSeverity('E711')).toBe('medium');
  });

  it('maps W codes to low', () => {
    expect(mapRuffSeverity('W291')).toBe('low');
    expect(mapRuffSeverity('W605')).toBe('low');
  });

  it('maps other codes to low', () => {
    expect(mapRuffSeverity('C901')).toBe('low');
    expect(mapRuffSeverity('I001')).toBe('low');
    expect(mapRuffSeverity('R001')).toBe('low');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseRuffOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('maps F code to high severity', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const fFinding = findings.find((f) => f.message.includes('F401'));
    expect(fFinding?.severity).toBe('high');
  });

  it('maps E code to medium severity', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const eFinding = findings.find((f) => f.message.includes('E501'));
    expect(eFinding?.severity).toBe('medium');
  });

  it('maps W code to low severity', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const wFinding = findings.find((f) => f.message.includes('W291'));
    expect(wFinding?.severity).toBe('low');
  });

  it('includes ruff code and message text', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('F401');
    expect(findings[0]?.message).toContain('imported but unused');
  });

  it('sets source to ruff', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('ruff');
    }
  });

  it('sets category to quality', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/main.py');
  });

  it('includes line numbers from location.row', () => {
    const findings = parseRuffOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(3);
    expect(findings[1]?.line).toBe(15);
    expect(findings[2]?.line).toBe(22);
  });

  it('returns empty findings for empty array', () => {
    expect(parseRuffOutput(makeRaw('[]'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseRuffOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseRuffOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseRuffOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
