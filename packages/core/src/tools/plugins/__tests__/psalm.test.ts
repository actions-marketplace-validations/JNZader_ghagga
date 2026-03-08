/**
 * Tests for Psalm plugin — parse function with fixture data.
 *
 * Validates PHP analysis, severity mapping, taint detection, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { mapPsalmSeverity, parsePsalmOutput, psalmPlugin } from '../psalm.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'psalm-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('psalmPlugin metadata', () => {
  it('has correct name', () => {
    expect(psalmPlugin.name).toBe('psalm');
  });

  it('has correct category', () => {
    expect(psalmPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(psalmPlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(psalmPlugin.version).toBe('6.5.1');
  });

  it('has correct output format', () => {
    expect(psalmPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('psalmPlugin detect', () => {
  it('detects PHP files (.php)', () => {
    expect(psalmPlugin.detect?.(['src/Service.php'])).toBe(true);
  });

  it('detects composer.json', () => {
    expect(psalmPlugin.detect?.(['composer.json', 'README.md'])).toBe(true);
  });

  it('does not detect non-PHP files', () => {
    expect(psalmPlugin.detect?.(['src/app.ts', 'package.json'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(psalmPlugin.detect?.([])).toBe(false);
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapPsalmSeverity', () => {
  it('maps error to high', () => {
    expect(mapPsalmSeverity('error', 'InvalidArgument')).toBe('high');
  });

  it('maps info to low', () => {
    expect(mapPsalmSeverity('info', 'PossiblyUnusedMethod')).toBe('low');
  });

  it('maps taint types to critical regardless of severity', () => {
    expect(mapPsalmSeverity('error', 'TaintedHtml')).toBe('critical');
    expect(mapPsalmSeverity('info', 'TaintedSql')).toBe('critical');
    expect(mapPsalmSeverity('error', 'TaintedInput')).toBe('critical');
  });

  it('maps unknown severity to medium', () => {
    expect(mapPsalmSeverity('unknown', 'SomeType')).toBe('medium');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parsePsalmOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('maps error severity to high', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const errorFinding = findings.find((f) => f.message.includes('InvalidArgument'));
    expect(errorFinding?.severity).toBe('high');
  });

  it('maps info severity to low', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const infoFinding = findings.find((f) => f.message.includes('PossiblyUnusedMethod'));
    expect(infoFinding?.severity).toBe('low');
  });

  it('maps taint findings to critical severity', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const taintFinding = findings.find((f) => f.message.includes('TaintedHtml'));
    expect(taintFinding?.severity).toBe('critical');
  });

  it('includes type and message in finding message', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('[InvalidArgument]');
    expect(findings[0]?.message).toContain('array_map');
  });

  it('sets source to psalm', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('psalm');
    }
  });

  it('sets category to quality', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/Service.php');
  });

  it('includes line numbers', () => {
    const findings = parsePsalmOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(15);
    expect(findings[1]?.line).toBe(30);
    expect(findings[2]?.line).toBe(8);
  });

  it('returns empty findings for empty array', () => {
    expect(parsePsalmOutput(makeRaw('[]'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parsePsalmOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parsePsalmOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parsePsalmOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
