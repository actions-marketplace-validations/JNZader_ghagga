/**
 * Tests for ShellCheck plugin — parse function with fixture data.
 *
 * Validates shell script linting, severity mapping, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { mapShellCheckSeverity, parseShellCheckOutput, shellcheckPlugin } from '../shellcheck.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'shellcheck-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('shellcheckPlugin metadata', () => {
  it('has correct name', () => {
    expect(shellcheckPlugin.name).toBe('shellcheck');
  });

  it('has correct category', () => {
    expect(shellcheckPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(shellcheckPlugin.tier).toBe('always-on');
  });

  it('has correct version', () => {
    expect(shellcheckPlugin.version).toBe('0.10.0');
  });

  it('has correct output format', () => {
    expect(shellcheckPlugin.outputFormat).toBe('json');
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapShellCheckSeverity', () => {
  it('maps error to high', () => {
    expect(mapShellCheckSeverity('error')).toBe('high');
  });

  it('maps warning to medium', () => {
    expect(mapShellCheckSeverity('warning')).toBe('medium');
  });

  it('maps info to info', () => {
    expect(mapShellCheckSeverity('info')).toBe('info');
  });

  it('maps style to low', () => {
    expect(mapShellCheckSeverity('style')).toBe('low');
  });

  it('maps unknown to low', () => {
    expect(mapShellCheckSeverity('unknown')).toBe('low');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseShellCheckOutput', () => {
  it('parses fixture JSON into 4 findings', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(4);
  });

  it('maps error level to high severity', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const errorFinding = findings.find((f) => f.message.includes('SC2028'));
    expect(errorFinding?.severity).toBe('high');
  });

  it('maps warning level to medium severity', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const warningFinding = findings.find((f) => f.message.includes('SC2086'));
    expect(warningFinding?.severity).toBe('medium');
  });

  it('maps info level to info severity', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const infoFinding = findings.find((f) => f.message.includes('SC2034'));
    expect(infoFinding?.severity).toBe('info');
  });

  it('maps style level to low severity', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const styleFinding = findings.find((f) => f.message.includes('SC2148'));
    expect(styleFinding?.severity).toBe('low');
  });

  it('includes ShellCheck code in message', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('SC2086');
    expect(findings[0]?.message).toContain('Double quote');
  });

  it('sets source to shellcheck', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('shellcheck');
    }
  });

  it('sets category to quality', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('scripts/deploy.sh');
  });

  it('includes line numbers', () => {
    const findings = parseShellCheckOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(12);
    expect(findings[1]?.line).toBe(25);
  });

  it('returns empty findings for empty array', () => {
    expect(parseShellCheckOutput(makeRaw('[]'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseShellCheckOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseShellCheckOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseShellCheckOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
