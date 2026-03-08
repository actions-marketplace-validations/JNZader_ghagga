/**
 * Tests for Biome plugin — parse function with fixture data.
 *
 * Validates JS/TS linting, severity mapping, detect function, and edge cases.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RawToolOutput } from '../../types.js';
import { biomePlugin, mapBiomeSeverity, parseBiomeOutput } from '../biome.js';

// ─── Fixture Data ───────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname, 'fixtures', 'biome-output.json');
const FIXTURE_JSON = readFileSync(FIXTURE_PATH, 'utf8');

function makeRaw(stdout: string, exitCode = 0, timedOut = false): RawToolOutput {
  return { stdout, stderr: '', exitCode, timedOut };
}

// ─── Plugin Metadata ────────────────────────────────────────────

describe('biomePlugin metadata', () => {
  it('has correct name', () => {
    expect(biomePlugin.name).toBe('biome');
  });

  it('has correct category', () => {
    expect(biomePlugin.category).toBe('quality');
  });

  it('has correct tier', () => {
    expect(biomePlugin.tier).toBe('auto-detect');
  });

  it('has correct version', () => {
    expect(biomePlugin.version).toBe('1.9.4');
  });

  it('has correct output format', () => {
    expect(biomePlugin.outputFormat).toBe('json');
  });
});

// ─── Detect Function ────────────────────────────────────────────

describe('biomePlugin detect', () => {
  it('detects .ts files', () => {
    expect(biomePlugin.detect?.(['src/app.ts'])).toBe(true);
  });

  it('detects .tsx files', () => {
    expect(biomePlugin.detect?.(['src/App.tsx'])).toBe(true);
  });

  it('detects .js files', () => {
    expect(biomePlugin.detect?.(['src/index.js'])).toBe(true);
  });

  it('detects .jsx files', () => {
    expect(biomePlugin.detect?.(['src/App.jsx'])).toBe(true);
  });

  it('detects .mts files', () => {
    expect(biomePlugin.detect?.(['src/utils.mts'])).toBe(true);
  });

  it('detects .mjs files', () => {
    expect(biomePlugin.detect?.(['src/config.mjs'])).toBe(true);
  });

  it('detects .cts files', () => {
    expect(biomePlugin.detect?.(['src/utils.cts'])).toBe(true);
  });

  it('detects .cjs files', () => {
    expect(biomePlugin.detect?.(['src/config.cjs'])).toBe(true);
  });

  it('does not detect non-JS/TS files', () => {
    expect(biomePlugin.detect?.(['src/main.py', 'go.mod', 'README.md'])).toBe(false);
  });

  it('does not detect on empty file list', () => {
    expect(biomePlugin.detect?.([])).toBe(false);
  });
});

// ─── Severity Mapping ───────────────────────────────────────────

describe('mapBiomeSeverity', () => {
  it('maps error to high', () => {
    expect(mapBiomeSeverity('error')).toBe('high');
  });

  it('maps warning to medium', () => {
    expect(mapBiomeSeverity('warning')).toBe('medium');
  });

  it('maps information to low', () => {
    expect(mapBiomeSeverity('information')).toBe('low');
  });

  it('maps hint to info', () => {
    expect(mapBiomeSeverity('hint')).toBe('info');
  });

  it('maps unknown to low', () => {
    expect(mapBiomeSeverity('unknown')).toBe('low');
  });
});

// ─── Parse Function ─────────────────────────────────────────────

describe('parseBiomeOutput', () => {
  it('parses fixture JSON into 3 findings', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings).toHaveLength(3);
  });

  it('maps error severity to high', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const errorFinding = findings.find((f) => f.message.includes('noUnusedVariables'));
    expect(errorFinding?.severity).toBe('high');
  });

  it('maps warning severity to medium', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const warningFinding = findings.find((f) => f.message.includes('noDoubleEquals'));
    expect(warningFinding?.severity).toBe('medium');
  });

  it('maps information severity to low', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    const infoFinding = findings.find((f) => f.message.includes('useConst'));
    expect(infoFinding?.severity).toBe('low');
  });

  it('includes category and description in message', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    expect(findings[0]?.message).toContain('lint/correctness/noUnusedVariables');
    expect(findings[0]?.message).toContain('unused');
  });

  it('sets source to biome', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.source).toBe('biome');
    }
  });

  it('sets category to quality', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.category).toBe('quality');
    }
  });

  it('strips repoDir prefix from file paths', () => {
    const findings = parseBiomeOutput(makeRaw(FIXTURE_JSON), '/workspace');
    for (const finding of findings) {
      expect(finding.file).not.toContain('/workspace/');
    }
    expect(findings[0]?.file).toBe('src/app.tsx');
  });

  it('returns empty findings for empty diagnostics', () => {
    const raw = makeRaw(JSON.stringify({ diagnostics: [] }));
    expect(parseBiomeOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for missing diagnostics', () => {
    const raw = makeRaw(JSON.stringify({}));
    expect(parseBiomeOutput(raw, '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for malformed JSON', () => {
    expect(parseBiomeOutput(makeRaw('not json {{{'), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings on timeout', () => {
    expect(parseBiomeOutput(makeRaw('', 0, true), '/workspace')).toHaveLength(0);
  });

  it('returns empty findings for empty stdout', () => {
    expect(parseBiomeOutput(makeRaw(''), '/workspace')).toHaveLength(0);
  });
});
