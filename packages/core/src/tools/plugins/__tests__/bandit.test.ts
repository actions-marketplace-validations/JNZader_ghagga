/**
 * Tests for Bandit plugin — parse function with fixture data.
 *
 * Validates Python security analysis, severity mapping, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { banditPlugin, mapBanditSeverity, parseBanditOutput } from '../bandit.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'bandit-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('banditPlugin metadata', () => {
  it('has correct name', () => {
    expect(banditPlugin.name).toBe('bandit');
  });

  it('has correct category', () => {
    expect(banditPlugin.category).toBe('security');
  });

  it('has correct tier', () => {
    expect(banditPlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(banditPlugin.version).toBe('1.8.3');
  });

  it('has correct output format', () => {
    expect(banditPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('banditPlugin detect', () => {
  it('detects Python files (.py)', () => {
    expect(banditPlugin.detect?.(['src/main.py', 'README.md'])).toBe(true);
  });

  it('does not detect non-Python files', () => {
    expect(banditPlugin.detect?.(['src/app.ts', 'go.mod'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(banditPlugin.detect?.([])).toBe(false);
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapBanditSeverity', () => {
  it('maps HIGH to high', () => {
    expect(mapBanditSeverity('HIGH')).toBe('high');
  });

  it('maps MEDIUM to medium', () => {
    expect(mapBanditSeverity('MEDIUM')).toBe('medium');
  });

  it('maps LOW to low', () => {
    expect(mapBanditSeverity('LOW')).toBe('low');
  });

  it('maps unknown to info', () => {
    expect(mapBanditSeverity('UNKNOWN')).toBe('info');
  });

  it('is case-insensitive', () => {
    expect(mapBanditSeverity('high')).toBe('high');
    expect(mapBanditSeverity('medium')).toBe('medium');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseBanditOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('maps HIGH severity correctly', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const highFinding = findings.find((f) => f.message.includes('B307'));
    expect(highFinding?.severity).toBe('high');
  });

  it('maps MEDIUM severity correctly', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const mediumFinding = findings.find((f) => f.message.includes('B602'));
    expect(mediumFinding?.severity).toBe('medium');
  });

  it('maps LOW severity correctly', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const lowFinding = findings.find((f) => f.message.includes('B403'));
    expect(lowFinding?.severity).toBe('low');
  });

  it('includes test_id and issue_text in message', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('B307');
    expect(findings[0]?.message).toContain('eval()');
  });

  it('includes confidence in message', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('confidence: HIGH');
  });

  it('sets source to bandit', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('bandit');
    }
  });

  it('sets category to security', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('security');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/utils.py');
  });

  it('includes line numbers', () => {
    const findings = parseBanditOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(45);
    expect(findings[1]?.line).toBe(20);
    expect(findings[2]?.line).toBe(1);
  });

  it('returns empty findings for empty results', () => {
    const raw = makeRaw(JSON.stringify({ results: [], errors: [] }));
    expect(parseBanditOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for missing results field', () => {
    const raw = makeRaw(JSON.stringify({ errors: [] }));
    expect(parseBanditOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseBanditOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseBanditOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseBanditOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
