import { describe, expect, it } from 'vitest';
import { parseFindingsBlock, parseReviewResponse } from './simple.js';

// ─── parseReviewResponse ────────────────────────────────────────

describe('parseReviewResponse', () => {
  const defaultArgs = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-20250514',
    tokensUsed: 150,
    executionTimeMs: 1200,
    memoryContext: null as string | null,
  };

  function callParse(text: string, overrides: Partial<typeof defaultArgs> = {}) {
    const args = { ...defaultArgs, ...overrides };
    return parseReviewResponse(
      text,
      args.provider,
      args.model,
      args.tokensUsed,
      args.executionTimeMs,
      args.memoryContext,
    );
  }

  it('parses PASSED status correctly', () => {
    const text = 'STATUS: PASSED\nSUMMARY: All good.\nFINDINGS:\n';
    const result = callParse(text);
    expect(result.status).toBe('PASSED');
  });

  it('parses FAILED status correctly', () => {
    const text = 'STATUS: FAILED\nSUMMARY: Critical issues found.\nFINDINGS:\n';
    const result = callParse(text);
    expect(result.status).toBe('FAILED');
  });

  it('defaults to NEEDS_HUMAN_REVIEW when STATUS line is missing', () => {
    const text = 'SUMMARY: Could not determine status.\nFINDINGS:\n';
    const result = callParse(text);
    expect(result.status).toBe('NEEDS_HUMAN_REVIEW');
  });

  it('extracts summary text', () => {
    const text =
      'STATUS: PASSED\nSUMMARY: The code changes look good. No critical issues found.\nFINDINGS:\n';
    const result = callParse(text);
    expect(result.summary).toBe('The code changes look good. No critical issues found.');
  });

  it('sets metadata correctly', () => {
    const text = 'STATUS: PASSED\nSUMMARY: Looks good.\nFINDINGS:\n';
    const result = callParse(text, {
      provider: 'openai',
      model: 'gpt-4o',
      tokensUsed: 250,
      executionTimeMs: 3000,
    });

    expect(result.metadata).toEqual(
      expect.objectContaining({
        mode: 'simple',
        provider: 'openai',
        model: 'gpt-4o',
        tokensUsed: 250,
        executionTimeMs: 3000,
      }),
    );
  });

  it('sets memoryContext', () => {
    const text = 'STATUS: PASSED\nSUMMARY: OK.\nFINDINGS:\n';
    const memCtx = 'This repo uses strict null checks';
    const result = callParse(text, { memoryContext: memCtx });
    expect(result.memoryContext).toBe(memCtx);
  });

  it('sets memoryContext to null when not provided', () => {
    const text = 'STATUS: PASSED\nSUMMARY: OK.\nFINDINGS:\n';
    const result = callParse(text, { memoryContext: null });
    expect(result.memoryContext).toBeNull();
  });

  it('parses a realistic LLM response', () => {
    const text = [
      'STATUS: PASSED',
      'SUMMARY: The code changes look good. No critical issues found.',
      'FINDINGS:',
      '- SEVERITY: low',
      '  CATEGORY: style',
      '  FILE: src/utils.ts',
      '  LINE: 10',
      '  MESSAGE: Consider using const instead of let',
      '  SUGGESTION: Replace let with const where variable is not reassigned',
    ].join('\n');

    const result = callParse(text);

    expect(result.status).toBe('PASSED');
    expect(result.summary).toBe('The code changes look good. No critical issues found.');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]?.severity).toBe('low');
    expect(result.findings[0]?.file).toBe('src/utils.ts');
  });

  it('includes staticAnalysis skeleton with skipped tools', () => {
    const text = 'STATUS: PASSED\nSUMMARY: OK.\nFINDINGS:\n';
    const result = callParse(text);

    expect(result.staticAnalysis.semgrep.status).toBe('skipped');
    expect(result.staticAnalysis.trivy.status).toBe('skipped');
    expect(result.staticAnalysis.cpd.status).toBe('skipped');
  });
});

// ─── parseFindingsBlock ─────────────────────────────────────────

describe('parseFindingsBlock', () => {
  it('parses a single finding with all fields', () => {
    const text = [
      'FINDINGS:',
      '- SEVERITY: high',
      '  CATEGORY: security',
      '  FILE: src/auth.ts',
      '  LINE: 42',
      '  MESSAGE: SQL injection vulnerability in query builder',
      '  SUGGESTION: Use parameterized queries instead',
    ].join('\n');

    const findings = parseFindingsBlock(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual(
      expect.objectContaining({
        severity: 'high',
        category: 'security',
        file: 'src/auth.ts',
        line: 42,
        message: 'SQL injection vulnerability in query builder',
        suggestion: 'Use parameterized queries instead',
        source: 'ai',
      }),
    );
  });

  it('parses multiple findings', () => {
    const text = [
      'FINDINGS:',
      '- SEVERITY: high',
      '  CATEGORY: security',
      '  FILE: src/auth.ts',
      '  LINE: 42',
      '  MESSAGE: SQL injection vulnerability in query builder',
      '  SUGGESTION: Use parameterized queries instead',
      '- SEVERITY: low',
      '  CATEGORY: style',
      '  FILE: src/utils.ts',
      '  LINE: 10',
      '  MESSAGE: Consider using const instead of let',
      '  SUGGESTION: Replace let with const where variable is not reassigned',
    ].join('\n');

    const findings = parseFindingsBlock(text);

    expect(findings).toHaveLength(2);
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.file).toBe('src/auth.ts');
    expect(findings[1]?.severity).toBe('low');
    expect(findings[1]?.file).toBe('src/utils.ts');
  });

  it('returns empty array when no findings match the pattern', () => {
    const text = 'STATUS: PASSED\nSUMMARY: All good.\nFINDINGS:\n';
    const findings = parseFindingsBlock(text);
    expect(findings).toEqual([]);
  });

  it('handles LINE: N/A (sets line to undefined)', () => {
    const text = [
      'FINDINGS:',
      '- SEVERITY: low',
      '  CATEGORY: style',
      '  FILE: src/utils.ts',
      '  LINE: N/A',
      '  MESSAGE: Consider using const instead of let',
      '  SUGGESTION: Replace let with const where variable is not reassigned',
    ].join('\n');

    const findings = parseFindingsBlock(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.line).toBeUndefined();
  });

  it('maps unknown severity to info', () => {
    const text = [
      'FINDINGS:',
      '- SEVERITY: warning',
      '  CATEGORY: style',
      '  FILE: src/utils.ts',
      '  LINE: 5',
      '  MESSAGE: Minor issue found',
      '  SUGGESTION: Consider refactoring',
    ].join('\n');

    const findings = parseFindingsBlock(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('info');
  });

  it('handles text with no FINDINGS section', () => {
    const text = 'Just some random text without any findings.';
    const findings = parseFindingsBlock(text);
    expect(findings).toEqual([]);
  });

  it('sets source to "ai" for all findings', () => {
    const text = [
      'FINDINGS:',
      '- SEVERITY: medium',
      '  CATEGORY: bug',
      '  FILE: src/app.ts',
      '  LINE: 100',
      '  MESSAGE: Potential null reference',
      '  SUGGESTION: Add null check before access',
    ].join('\n');

    const findings = parseFindingsBlock(text);
    expect(findings[0]?.source).toBe('ai');
  });

  it('trims whitespace from all fields', () => {
    const text = [
      'FINDINGS:',
      '- SEVERITY:   medium  ',
      '  CATEGORY:   performance  ',
      '  FILE:   src/heavy.ts  ',
      '  LINE:   77  ',
      '  MESSAGE:   O(n^2) loop detected  ',
      '  SUGGESTION:   Use a hash map for O(n) lookup  ',
    ].join('\n');

    const findings = parseFindingsBlock(text);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.category).toBe('performance');
    expect(findings[0]?.file).toBe('src/heavy.ts');
    expect(findings[0]?.line).toBe(77);
    expect(findings[0]?.message).toBe('O(n^2) loop detected');
    expect(findings[0]?.suggestion).toBe('Use a hash map for O(n) lookup');
  });
});
