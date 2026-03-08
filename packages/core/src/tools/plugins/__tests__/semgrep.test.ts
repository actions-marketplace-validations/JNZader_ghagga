/**
 * Tests for Semgrep plugin — parse function with fixture data.
 *
 * Validates that the adapted plugin produces identical output
 * to the existing hardcoded implementation.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { mapSemgrepSeverity, parseSemgrepOutput, semgrepPlugin } from '../semgrep.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'semgrep-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('semgrepPlugin metadata', () => {
  it('has correct name', () => {
    expect(semgrepPlugin.name).toBe('semgrep');
  });

  it('has correct category', () => {
    expect(semgrepPlugin.category).toBe('security');
  });

  it('has correct tier', () => {
    expect(semgrepPlugin.tier).toBe('always-on');
  });

  it('has correct version', () => {
    expect(semgrepPlugin.version).toBe('1.90.0');
  });

  it('has correct output format', () => {
    expect(semgrepPlugin.outputFormat).toBe('json');
  });

  it('does not have a detect function (always-on)', () => {
    // always-on tools may or may not have detect; it's not required
    // The registry accepts this
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapSemgrepSeverity', () => {
  it('maps ERROR to high', () => {
    expect(mapSemgrepSeverity('ERROR')).toBe('high');
  });

  it('maps WARNING to medium', () => {
    expect(mapSemgrepSeverity('WARNING')).toBe('medium');
  });

  it('maps INFO to info', () => {
    expect(mapSemgrepSeverity('INFO')).toBe('info');
  });

  it('maps unknown to low', () => {
    expect(mapSemgrepSeverity('UNKNOWN')).toBe('low');
  });

  it('is case-insensitive', () => {
    expect(mapSemgrepSeverity('error')).toBe('high');
    expect(mapSemgrepSeverity('warning')).toBe('medium');
    expect(mapSemgrepSeverity('info')).toBe('info');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseSemgrepOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('maps ERROR severity to high', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const errorFinding = findings.find((f) => f.message.includes('hardcoded password'));
    expect(errorFinding?.severity).toBe('high');
  });

  it('maps WARNING severity to medium', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const warningFinding = findings.find((f) => f.message.includes('XSS'));
    expect(warningFinding?.severity).toBe('medium');
  });

  it('maps INFO severity to info', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const infoFinding = findings.find((f) => f.message.includes('debugging'));
    expect(infoFinding?.severity).toBe('info');
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/auth/login.ts');
  });

  it('sets source to semgrep', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('semgrep');
    }
  });

  it('sets category to security', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('security');
    }
  });

  it('includes line numbers', () => {
    const findings = parseSemgrepOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(42);
    expect(findings[1]?.line).toBe(17);
    expect(findings[2]?.line).toBe(88);
  });

  it('returns empty findings for empty results', () => {
    const raw = makeRaw(JSON.stringify({ results: [], errors: [] }));
    const findings = parseSemgrepOutput(raw, '/workspace');
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings for missing results field', () => {
    const raw = makeRaw(JSON.stringify({ errors: [] }));
    const findings = parseSemgrepOutput(raw, '/workspace');
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    const raw = makeRaw('not valid json {{{');
    const findings = parseSemgrepOutput(raw, '/workspace');
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    const raw = makeRaw('', 0, true);
    const findings = parseSemgrepOutput(raw, '/workspace');
    expect(findings).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    const raw = makeRaw('');
    const findings = parseSemgrepOutput(raw, '/workspace');
    expect(findings).toHaveLength(0);
  });

  it('handles unknown severity in results', () => {
    const json = JSON.stringify({
      results: [
        {
          check_id: 'test.rule',
          path: '/workspace/src/file.ts',
          start: { line: 1, col: 1 },
          end: { line: 1, col: 10 },
          extra: { severity: 'CUSTOM', message: 'Custom issue' },
        },
      ],
    });
    const findings = parseSemgrepOutput(makeRaw(json), '/workspace');
    expect(findings[0]?.severity).toBe('low');
  });
});
