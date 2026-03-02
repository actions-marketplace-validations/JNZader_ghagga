import { describe, it, expect } from 'vitest';
import { formatStaticAnalysisContext } from './runner.js';
import type { StaticAnalysisResult, ReviewFinding } from '../types.js';

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
});
