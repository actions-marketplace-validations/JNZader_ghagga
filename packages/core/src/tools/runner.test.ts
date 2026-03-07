import { describe, expect, it } from 'vitest';
import type { ReviewFinding, StaticAnalysisResult } from '../types.js';
import { formatStaticAnalysisContext } from './runner.js';

/** Helper to create an empty ToolResult */
function emptyToolResult() {
  return { status: 'success' as const, findings: [], executionTimeMs: 0 };
}

/** Helper to create a finding */
function makeFinding(overrides: Partial<ReviewFinding> = {}): ReviewFinding {
  return {
    severity: 'medium',
    category: 'security',
    file: 'src/index.ts',
    line: 10,
    message: 'Potential issue found',
    source: 'semgrep',
    ...overrides,
  };
}

describe('formatStaticAnalysisContext', () => {
  it('returns empty string when all findings arrays are empty', () => {
    const result: StaticAnalysisResult = {
      semgrep: emptyToolResult(),
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };
    expect(formatStaticAnalysisContext(result)).toBe('');
  });

  it('formats findings from multiple tools', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding({ source: 'semgrep', message: 'SQL injection risk' })],
        executionTimeMs: 100,
      },
      trivy: {
        status: 'success',
        findings: [
          makeFinding({
            source: 'trivy',
            severity: 'high',
            file: 'Dockerfile',
            line: 5,
            message: 'Vulnerable base image',
          }),
        ],
        executionTimeMs: 200,
      },
      cpd: {
        status: 'success',
        findings: [
          makeFinding({
            source: 'cpd',
            severity: 'low',
            file: 'src/utils.ts',
            line: 20,
            message: 'Duplicate code block',
          }),
        ],
        executionTimeMs: 50,
      },
    };

    const formatted = formatStaticAnalysisContext(result);

    expect(formatted).toContain('[SEMGREP]');
    expect(formatted).toContain('SQL injection risk');
    expect(formatted).toContain('[TRIVY]');
    expect(formatted).toContain('Vulnerable base image');
    expect(formatted).toContain('[CPD]');
    expect(formatted).toContain('Duplicate code block');
  });

  it('includes source, severity, file, line, and message', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [
          makeFinding({
            source: 'semgrep',
            severity: 'critical',
            file: 'src/auth.ts',
            line: 42,
            message: 'Hardcoded credentials',
          }),
        ],
        executionTimeMs: 100,
      },
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);

    expect(formatted).toContain('[SEMGREP]');
    expect(formatted).toContain('[critical]');
    expect(formatted).toContain('src/auth.ts:42');
    expect(formatted).toContain('Hardcoded credentials');
  });

  it('includes "do NOT repeat" instruction', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding()],
        executionTimeMs: 100,
      },
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);
    expect(formatted).toContain('do NOT repeat');
  });

  it('handles findings without line numbers', () => {
    const result: StaticAnalysisResult = {
      semgrep: emptyToolResult(),
      trivy: {
        status: 'success',
        findings: [
          makeFinding({
            source: 'trivy',
            file: 'package.json',
            line: undefined,
            message: 'Outdated dependency',
          }),
        ],
        executionTimeMs: 100,
      },
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);

    // When no line number, should show just the file path without ":line"
    expect(formatted).toContain('package.json:');
    // Shouldn't have "package.json:undefined"
    expect(formatted).not.toContain('undefined');
    // The file should be shown as just path
    expect(formatted).toContain('package.json');
    expect(formatted).toContain('Outdated dependency');
  });

  it('includes the header line about pre-review static analysis', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding()],
        executionTimeMs: 100,
      },
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);
    expect(formatted).toContain('Pre-Review Static Analysis');
    expect(formatted).toContain('confirmed issues');
  });

  it('includes the footer guidance about static analysis and focusing on logic', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding()],
        executionTimeMs: 100,
      },
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);
    expect(formatted).toContain('automated tools');
    expect(formatted).toContain('Focus on logic');
    expect(formatted).toContain('static analysis cannot detect');
  });

  it('uppercases source name in finding line', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding({ source: 'semgrep', message: 'test' })],
        executionTimeMs: 0,
      },
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);
    expect(formatted).toContain('[SEMGREP]');
    expect(formatted).not.toContain('[semgrep]');
  });

  it('formats location as file:line when line is present', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding({ file: 'src/db.ts', line: 99 })],
        executionTimeMs: 0,
      },
      trivy: emptyToolResult(),
      cpd: emptyToolResult(),
    };

    const formatted = formatStaticAnalysisContext(result);
    expect(formatted).toContain('src/db.ts:99');
  });

  it('formats location as just file when line is absent', () => {
    const result: StaticAnalysisResult = {
      semgrep: emptyToolResult(),
      trivy: emptyToolResult(),
      cpd: {
        status: 'success',
        findings: [makeFinding({ source: 'cpd', file: 'Makefile', line: undefined })],
        executionTimeMs: 0,
      },
    };

    const formatted = formatStaticAnalysisContext(result);
    expect(formatted).toContain('Makefile:');
    expect(formatted).not.toContain('Makefile:undefined');
  });

  it('combines findings from all three tools in order', () => {
    const result: StaticAnalysisResult = {
      semgrep: {
        status: 'success',
        findings: [makeFinding({ source: 'semgrep', message: 'FIRST' })],
        executionTimeMs: 0,
      },
      trivy: {
        status: 'success',
        findings: [makeFinding({ source: 'trivy', message: 'SECOND' })],
        executionTimeMs: 0,
      },
      cpd: {
        status: 'success',
        findings: [makeFinding({ source: 'cpd', message: 'THIRD' })],
        executionTimeMs: 0,
      },
    };

    const formatted = formatStaticAnalysisContext(result);
    const firstIdx = formatted.indexOf('FIRST');
    const secondIdx = formatted.indexOf('SECOND');
    const thirdIdx = formatted.indexOf('THIRD');
    expect(firstIdx).toBeLessThan(secondIdx);
    expect(secondIdx).toBeLessThan(thirdIdx);
  });
});
