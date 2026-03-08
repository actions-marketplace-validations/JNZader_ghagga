/**
 * Tests for Hadolint plugin — parse function with fixture data.
 *
 * Validates Dockerfile linting, severity mapping, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { hadolintPlugin, mapHadolintSeverity, parseHadolintOutput } from '../hadolint.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'hadolint-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('hadolintPlugin metadata', () => {
  it('has correct name', () => {
    expect(hadolintPlugin.name).toBe('hadolint');
  });

  it('has correct category', () => {
    expect(hadolintPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(hadolintPlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(hadolintPlugin.version).toBe('2.12.0');
  });

  it('has correct output format', () => {
    expect(hadolintPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('hadolintPlugin detect', () => {
  it('detects Dockerfile', () => {
    expect(hadolintPlugin.detect?.(['Dockerfile', 'README.md'])).toBe(true);
  });

  it('detects Dockerfile.prod', () => {
    expect(hadolintPlugin.detect?.(['Dockerfile.prod'])).toBe(true);
  });

  it('detects docker/Dockerfile.api', () => {
    expect(hadolintPlugin.detect?.(['docker/Dockerfile.api'])).toBe(true);
  });

  it('does not detect non-Dockerfile files', () => {
    expect(hadolintPlugin.detect?.(['src/app.ts', 'docker-compose.yml'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(hadolintPlugin.detect?.([])).toBe(false);
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapHadolintSeverity', () => {
  it('maps error to high', () => {
    expect(mapHadolintSeverity('error')).toBe('high');
  });

  it('maps warning to medium', () => {
    expect(mapHadolintSeverity('warning')).toBe('medium');
  });

  it('maps info to info', () => {
    expect(mapHadolintSeverity('info')).toBe('info');
  });

  it('maps style to low', () => {
    expect(mapHadolintSeverity('style')).toBe('low');
  });

  it('maps unknown to low', () => {
    expect(mapHadolintSeverity('unknown')).toBe('low');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseHadolintOutput', () => {
  it('parses fixture JSON into 5 findings', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(5);
  });

  it('maps error level to high severity', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const errorFinding = findings.find((f) => f.message.includes('DL3002'));
    expect(errorFinding?.severity).toBe('high');
  });

  it('maps warning level to medium severity', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const warningFinding = findings.find((f) => f.message.includes('DL3007'));
    expect(warningFinding?.severity).toBe('medium');
  });

  it('maps info level to info severity', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const infoFinding = findings.find((f) => f.message.includes('DL3015'));
    expect(infoFinding?.severity).toBe('info');
  });

  it('maps style level to low severity', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const styleFinding = findings.find((f) => f.message.includes('DL4006'));
    expect(styleFinding?.severity).toBe('low');
  });

  it('includes hadolint code and message', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('DL3007');
    expect(findings[0]?.message).toContain('Using latest is prone to errors');
  });

  it('sets source to hadolint', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('hadolint');
    }
  });

  it('sets category to quality', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('Dockerfile');
  });

  it('includes line numbers', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(1);
    expect(findings[1]?.line).toBe(5);
    expect(findings[2]?.line).toBe(10);
  });

  it('handles multiple Dockerfiles', () => {
    const findings = parseHadolintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const files = new Set(findings.map((f) => f.file));
    expect(files.size).toBe(2);
    expect(files).toContain('Dockerfile');
    expect(files).toContain('Dockerfile.prod');
  });

  it('returns empty findings for empty array', () => {
    expect(parseHadolintOutput(makeRaw('[]'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseHadolintOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseHadolintOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseHadolintOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
