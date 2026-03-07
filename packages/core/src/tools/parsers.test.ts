/**
 * Static analysis tool parser tests.
 *
 * Tests the actual parsing functions exported from semgrep.ts, trivy.ts,
 * and cpd.ts using fixture data that mirrors real tool output.
 * These tests verify the REAL parsers WITHOUT requiring the tools installed.
 */

import { describe, expect, it } from 'vitest';
import { parseCpdXml } from './cpd.js';
import { mapSeverity as mapSemgrepSeverity } from './semgrep.js';
import { mapSeverity as mapTrivySeverity } from './trivy.js';

// ─── Semgrep Severity Mapping ───────────────────────────────────

describe('semgrep mapSeverity', () => {
  it('maps ERROR to high', () => {
    expect(mapSemgrepSeverity('ERROR')).toBe('high');
  });

  it('maps WARNING to medium', () => {
    expect(mapSemgrepSeverity('WARNING')).toBe('medium');
  });

  it('maps INFO to info', () => {
    expect(mapSemgrepSeverity('INFO')).toBe('info');
  });

  it('maps unknown severity to low', () => {
    expect(mapSemgrepSeverity('UNKNOWN')).toBe('low');
  });

  it('maps empty string to low', () => {
    expect(mapSemgrepSeverity('')).toBe('low');
  });

  it('is case-insensitive (lowercase error)', () => {
    expect(mapSemgrepSeverity('error')).toBe('high');
  });

  it('is case-insensitive (mixed case Warning)', () => {
    expect(mapSemgrepSeverity('Warning')).toBe('medium');
  });
});

// ─── Trivy Severity Mapping ────────────────────────────────────

describe('trivy mapSeverity', () => {
  it('maps CRITICAL to critical', () => {
    expect(mapTrivySeverity('CRITICAL')).toBe('critical');
  });

  it('maps HIGH to high', () => {
    expect(mapTrivySeverity('HIGH')).toBe('high');
  });

  it('maps MEDIUM to medium', () => {
    expect(mapTrivySeverity('MEDIUM')).toBe('medium');
  });

  it('maps LOW to low', () => {
    expect(mapTrivySeverity('LOW')).toBe('low');
  });

  it('maps unknown severity to info', () => {
    expect(mapTrivySeverity('UNKNOWN')).toBe('info');
  });

  it('maps empty string to info', () => {
    expect(mapTrivySeverity('')).toBe('info');
  });

  it('is case-insensitive (lowercase critical)', () => {
    expect(mapTrivySeverity('critical')).toBe('critical');
  });
});

// ─── CPD XML Parsing ───────────────────────────────────────────

describe('parseCpdXml', () => {
  const CPD_XML = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<pmd-cpd>',
    '  <duplication lines="15" tokens="120">',
    '    <file path="/project/src/serviceA.ts" line="10" endline="24" />',
    '    <file path="/project/src/serviceB.ts" line="55" endline="69" />',
    '    <codefragment><![CDATA[function processData() { return []; }]]></codefragment>',
    '  </duplication>',
    '  <duplication lines="8" tokens="75">',
    '    <file path="/project/src/utils/format.ts" line="20" endline="27" />',
    '    <file path="/project/src/utils/display.ts" line="30" endline="37" />',
    '    <file path="/project/src/utils/export.ts" line="15" endline="22" />',
    '    <codefragment><![CDATA[const x = 1;]]></codefragment>',
    '  </duplication>',
    '</pmd-cpd>',
  ].join('\n');

  it('parses all duplication blocks', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    expect(findings).toHaveLength(2);
  });

  it('extracts line count and token count into message', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    expect(findings[0]?.message).toContain('15 lines');
    expect(findings[0]?.message).toContain('120 tokens');
  });

  it('strips base path from file paths', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    expect(findings[0]?.file).toBe('src/serviceA.ts');
    expect(findings[0]?.message).toContain('src/serviceA.ts');
    expect(findings[0]?.message).toContain('src/serviceB.ts');
  });

  it('uses first file as primary finding location', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    expect(findings[0]?.file).toBe('src/serviceA.ts');
    expect(findings[0]?.line).toBe(10);
  });

  it('handles 3+ file duplications', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    expect(findings[1]?.message).toContain('src/utils/format.ts');
    expect(findings[1]?.message).toContain('src/utils/display.ts');
    expect(findings[1]?.message).toContain('src/utils/export.ts');
  });

  it('sets severity to medium for all duplications', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    for (const f of findings) {
      expect(f.severity).toBe('medium');
    }
  });

  it('sets source to cpd', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    for (const f of findings) {
      expect(f.source).toBe('cpd');
    }
  });

  it('includes extraction suggestion', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    for (const f of findings) {
      expect(f.suggestion).toContain('shared function');
    }
  });

  it('returns empty array for empty CPD output', () => {
    const emptyXml = '<?xml version="1.0" encoding="UTF-8"?>\n<pmd-cpd>\n</pmd-cpd>';
    const findings = parseCpdXml(emptyXml, '/project');
    expect(findings).toHaveLength(0);
  });

  it('skips single-file duplication (fewer than 2 files)', () => {
    const singleFile = `<pmd-cpd>
  <duplication lines="5" tokens="50">
    <file path="/project/src/a.ts" line="10" endline="14" />
    <codefragment><![CDATA[const x = 1;]]></codefragment>
  </duplication>
</pmd-cpd>`;
    const findings = parseCpdXml(singleFile, '/project');
    expect(findings).toHaveLength(0);
  });

  it('handles second duplication block independently', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    expect(findings[1]?.file).toBe('src/utils/format.ts');
    expect(findings[1]?.line).toBe(20);
    expect(findings[1]?.message).toContain('8 lines');
    expect(findings[1]?.message).toContain('75 tokens');
  });

  it('category is duplication for all findings', () => {
    const findings = parseCpdXml(CPD_XML, '/project');
    for (const f of findings) {
      expect(f.category).toBe('duplication');
    }
  });

  it('handles base path without trailing slash', () => {
    const xml = `<pmd-cpd>
  <duplication lines="5" tokens="50">
    <file path="/my-project/src/a.ts" line="1" endline="5" />
    <file path="/my-project/src/b.ts" line="1" endline="5" />
    <codefragment><![CDATA[x]]></codefragment>
  </duplication>
</pmd-cpd>`;
    const findings = parseCpdXml(xml, '/my-project');
    expect(findings[0]?.file).toBe('src/a.ts');
  });
});
