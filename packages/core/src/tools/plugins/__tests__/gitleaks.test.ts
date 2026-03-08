/**
 * Tests for Gitleaks plugin — parse function with fixture data.
 *
 * Validates secret detection parsing, severity mapping, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { gitleaksPlugin, parseGitleaksOutput } from '../gitleaks.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'gitleaks-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('gitleaksPlugin metadata', () => {
  it('has correct name', () => {
    expect(gitleaksPlugin.name).toBe('gitleaks');
  });

  it('has correct category', () => {
    expect(gitleaksPlugin.category).toBe('secrets');
  });

  it('has correct tier', () => {
    expect(gitleaksPlugin.tier).toBe('always-on');
  });

  it('has correct version', () => {
    expect(gitleaksPlugin.version).toBe('8.21.2');
  });

  it('has correct output format', () => {
    expect(gitleaksPlugin.outputFormat).toBe('json');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseGitleaksOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('all findings have critical severity', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.severity).toBe('critical');
    }
  });

  it('all findings have secrets category', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('secrets');
    }
  });

  it('sets source to gitleaks', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('gitleaks');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/config/aws.ts');
  });

  it('includes line numbers', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(15);
    expect(findings[1]?.line).toBe(8);
    expect(findings[2]?.line).toBe(3);
  });

  it('includes secret description and rule in message', () => {
    const findings = parseGitleaksOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('AWS Access Key');
    expect(findings[0]?.message).toContain('aws-access-key-id');
  });

  it('returns empty findings for empty array', () => {
    const raw = makeRaw('[]');
    expect(parseGitleaksOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseGitleaksOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseGitleaksOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseGitleaksOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
