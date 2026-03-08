/**
 * Tests for golangci-lint plugin — parse function with fixture data.
 *
 * Validates Go linting, severity/category mapping, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import {
  golangciLintPlugin,
  mapGolangciLintFinding,
  parseGolangciLintOutput,
} from '../golangci-lint.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'golangci-lint-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('golangciLintPlugin metadata', () => {
  it('has correct name', () => {
    expect(golangciLintPlugin.name).toBe('golangci-lint');
  });

  it('has correct category', () => {
    expect(golangciLintPlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(golangciLintPlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(golangciLintPlugin.version).toBe('1.63.4');
  });

  it('has correct output format', () => {
    expect(golangciLintPlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('golangciLintPlugin detect', () => {
  it('detects go.mod file', () => {
    expect(golangciLintPlugin.detect?.(['go.mod', 'README.md'])).toBe(true);
  });

  it('detects .go files', () => {
    expect(golangciLintPlugin.detect?.(['cmd/main.go', 'README.md'])).toBe(true);
  });

  it('does not detect non-Go files', () => {
    expect(golangciLintPlugin.detect?.(['src/app.ts', 'package.json'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(golangciLintPlugin.detect?.([])).toBe(false);
  });
});

// ─── Finding Mapping ────────────────────────────────────────────

describe('mapGolangciLintFinding', () => {
  it('maps gosec to security/high', () => {
    const result = mapGolangciLintFinding('gosec');
    expect(result.severity).toBe('high');
    expect(result.category).toBe('security');
  });

  it('maps errcheck to quality/medium', () => {
    const result = mapGolangciLintFinding('errcheck');
    expect(result.severity).toBe('medium');
    expect(result.category).toBe('quality');
  });

  it('maps staticcheck to quality/medium', () => {
    const result = mapGolangciLintFinding('staticcheck');
    expect(result.severity).toBe('medium');
    expect(result.category).toBe('quality');
  });

  it('maps unknown linter to quality/medium', () => {
    const result = mapGolangciLintFinding('custom-linter');
    expect(result.severity).toBe('medium');
    expect(result.category).toBe('quality');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseGolangciLintOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('maps gosec to security category with high severity', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const gosecFinding = findings.find((f) => f.message.includes('[gosec]'));
    expect(gosecFinding?.severity).toBe('high');
    expect(gosecFinding?.category).toBe('security');
  });

  it('maps errcheck to quality category with medium severity', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const errcheckFinding = findings.find((f) => f.message.includes('[errcheck]'));
    expect(errcheckFinding?.severity).toBe('medium');
    expect(errcheckFinding?.category).toBe('quality');
  });

  it('includes linter name in message', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('[gosec]');
    expect(findings[1]?.message).toContain('[errcheck]');
  });

  it('sets source to golangci-lint', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('golangci-lint');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('internal/auth/config.go');
  });

  it('includes line numbers', () => {
    const findings = parseGolangciLintOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.line).toBe(15);
    expect(findings[1]?.line).toBe(42);
    expect(findings[2]?.line).toBe(28);
  });

  it('returns empty findings for empty Issues', () => {
    const raw = makeRaw(JSON.stringify({ Issues: [], Report: {} }));
    expect(parseGolangciLintOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for missing Issues field', () => {
    const raw = makeRaw(JSON.stringify({ Report: {} }));
    expect(parseGolangciLintOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseGolangciLintOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseGolangciLintOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseGolangciLintOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
