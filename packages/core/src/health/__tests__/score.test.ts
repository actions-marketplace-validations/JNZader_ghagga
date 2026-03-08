/**
 * Health scoring unit tests.
 *
 * Tests computeHealthScore (deterministic scoring from findings),
 * getScoreColor (color categories), and formatTopIssues (severity sorting).
 */

import { describe, expect, it } from 'vitest';

import type { ReviewFinding } from '../../types.js';
import { computeHealthScore, formatTopIssues, getScoreColor, SEVERITY_WEIGHTS } from '../score.js';

// ─── Helpers ────────────────────────────────────────────────────

function mockFinding(overrides?: Partial<ReviewFinding>): ReviewFinding {
  return {
    file: 'src/app.ts',
    line: 10,
    severity: 'medium',
    category: 'quality',
    message: 'Test finding',
    source: 'semgrep',
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────

describe('computeHealthScore', () => {
  it('returns perfect score (100, grade A) for zero findings', () => {
    const result = computeHealthScore([]);

    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.totalFindings).toBe(0);
    expect(result.findingCounts).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    });
  });

  it('deducts severity weight per finding from base score of 100', () => {
    // 1 critical = -20 → score 80
    const result = computeHealthScore([mockFinding({ severity: 'critical' })]);

    expect(result.score).toBe(80);
    expect(result.grade).toBe('A');
    expect(result.totalFindings).toBe(1);
    expect(result.findingCounts.critical).toBe(1);
  });

  it('handles a single high severity finding', () => {
    // 1 high = -10 → score 90
    const result = computeHealthScore([mockFinding({ severity: 'high' })]);

    expect(result.score).toBe(90);
    expect(result.grade).toBe('A');
    expect(result.findingCounts.high).toBe(1);
  });

  it('handles a single medium severity finding', () => {
    // 1 medium = -3 → score 97
    const result = computeHealthScore([mockFinding({ severity: 'medium' })]);

    expect(result.score).toBe(97);
    expect(result.findingCounts.medium).toBe(1);
  });

  it('handles a single low severity finding', () => {
    // 1 low = -1 → score 99
    const result = computeHealthScore([mockFinding({ severity: 'low' })]);

    expect(result.score).toBe(99);
    expect(result.findingCounts.low).toBe(1);
  });

  it('does not deduct anything for info findings', () => {
    // info = 0 weight → score 100
    const result = computeHealthScore([mockFinding({ severity: 'info' })]);

    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.totalFindings).toBe(1);
    expect(result.findingCounts.info).toBe(1);
  });

  it('accumulates deductions from mixed severities', () => {
    const findings = [
      mockFinding({ severity: 'critical' }), // -20
      mockFinding({ severity: 'high' }), // -10
      mockFinding({ severity: 'medium' }), // -3
      mockFinding({ severity: 'low' }), // -1
      mockFinding({ severity: 'info' }), // -0
    ];
    // 100 - 20 - 10 - 3 - 1 - 0 = 66
    const result = computeHealthScore(findings);

    expect(result.score).toBe(66);
    expect(result.grade).toBe('B');
    expect(result.totalFindings).toBe(5);
  });

  it('clamps score to 0 when deductions exceed 100', () => {
    // 6 critical findings = 6 * 20 = 120 deductions → clamped to 0
    const findings = Array.from({ length: 6 }, () => mockFinding({ severity: 'critical' }));
    const result = computeHealthScore(findings);

    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
    expect(result.totalFindings).toBe(6);
    expect(result.findingCounts.critical).toBe(6);
  });

  it('correctly counts findings per severity level', () => {
    const findings = [
      mockFinding({ severity: 'critical' }),
      mockFinding({ severity: 'critical' }),
      mockFinding({ severity: 'high' }),
      mockFinding({ severity: 'medium' }),
      mockFinding({ severity: 'medium' }),
      mockFinding({ severity: 'medium' }),
      mockFinding({ severity: 'low' }),
      mockFinding({ severity: 'info' }),
      mockFinding({ severity: 'info' }),
    ];

    const result = computeHealthScore(findings);

    expect(result.findingCounts).toEqual({
      critical: 2,
      high: 1,
      medium: 3,
      low: 1,
      info: 2,
    });
    expect(result.totalFindings).toBe(9);
  });

  // ── Grade thresholds ──────────────────────────────────────────

  it('assigns grade A for score >= 80', () => {
    // 1 critical = -20 → score 80 → exactly grade A
    const result = computeHealthScore([mockFinding({ severity: 'critical' })]);
    expect(result.score).toBe(80);
    expect(result.grade).toBe('A');
  });

  it('assigns grade B for score 60-79', () => {
    // 2 critical + 1 low = -41 → score 59? No: 2*20 + 1 = 41 → 59
    // Actually, we want score in [60,79]. 2 critical = -40 → score 60
    const findings = [mockFinding({ severity: 'critical' }), mockFinding({ severity: 'critical' })];
    const result = computeHealthScore(findings);
    expect(result.score).toBe(60);
    expect(result.grade).toBe('B');
  });

  it('assigns grade C for score 40-59', () => {
    // 3 critical = -60 → score 40
    const findings = Array.from({ length: 3 }, () => mockFinding({ severity: 'critical' }));
    const result = computeHealthScore(findings);
    expect(result.score).toBe(40);
    expect(result.grade).toBe('C');
  });

  it('assigns grade D for score 20-39', () => {
    // 4 critical = -80 → score 20
    const findings = Array.from({ length: 4 }, () => mockFinding({ severity: 'critical' }));
    const result = computeHealthScore(findings);
    expect(result.score).toBe(20);
    expect(result.grade).toBe('D');
  });

  it('assigns grade F for score 0-19', () => {
    // 5 critical = -100 → score 0
    const findings = Array.from({ length: 5 }, () => mockFinding({ severity: 'critical' }));
    const result = computeHealthScore(findings);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
  });

  it('assigns grade B for score 79 (just below A threshold)', () => {
    // 1 critical + 1 low = -21 → score 79
    const findings = [mockFinding({ severity: 'critical' }), mockFinding({ severity: 'low' })];
    const result = computeHealthScore(findings);
    expect(result.score).toBe(79);
    expect(result.grade).toBe('B');
  });

  it('handles many info-only findings without score drop', () => {
    const findings = Array.from({ length: 50 }, () => mockFinding({ severity: 'info' }));
    const result = computeHealthScore(findings);

    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.totalFindings).toBe(50);
  });
});

describe('SEVERITY_WEIGHTS', () => {
  it('has expected weight values', () => {
    expect(SEVERITY_WEIGHTS.critical).toBe(-20);
    expect(SEVERITY_WEIGHTS.high).toBe(-10);
    expect(SEVERITY_WEIGHTS.medium).toBe(-3);
    expect(SEVERITY_WEIGHTS.low).toBe(-1);
    expect(SEVERITY_WEIGHTS.info).toBe(0);
  });
});

describe('getScoreColor', () => {
  it('returns green for score >= 80', () => {
    expect(getScoreColor(80)).toBe('green');
    expect(getScoreColor(100)).toBe('green');
    expect(getScoreColor(95)).toBe('green');
  });

  it('returns yellow for score 50-79', () => {
    expect(getScoreColor(50)).toBe('yellow');
    expect(getScoreColor(79)).toBe('yellow');
    expect(getScoreColor(65)).toBe('yellow');
  });

  it('returns red for score < 50', () => {
    expect(getScoreColor(49)).toBe('red');
    expect(getScoreColor(0)).toBe('red');
    expect(getScoreColor(25)).toBe('red');
  });

  it('handles boundary values precisely', () => {
    expect(getScoreColor(80)).toBe('green');
    expect(getScoreColor(79)).toBe('yellow');
    expect(getScoreColor(50)).toBe('yellow');
    expect(getScoreColor(49)).toBe('red');
  });
});

describe('formatTopIssues', () => {
  it('returns empty array for empty findings', () => {
    expect(formatTopIssues([], 5)).toEqual([]);
  });

  it('sorts findings by severity — critical first, info last', () => {
    const findings = [
      mockFinding({ severity: 'low', message: 'Low issue' }),
      mockFinding({ severity: 'critical', message: 'Critical issue' }),
      mockFinding({ severity: 'info', message: 'Info issue' }),
      mockFinding({ severity: 'high', message: 'High issue' }),
      mockFinding({ severity: 'medium', message: 'Medium issue' }),
    ];

    const result = formatTopIssues(findings, 5);

    expect(result).toHaveLength(5);
    expect(result[0].severity).toBe('critical');
    expect(result[1].severity).toBe('high');
    expect(result[2].severity).toBe('medium');
    expect(result[3].severity).toBe('low');
    expect(result[4].severity).toBe('info');
  });

  it('limits results to the specified count', () => {
    const findings = [
      mockFinding({ severity: 'critical', message: 'Issue 1' }),
      mockFinding({ severity: 'high', message: 'Issue 2' }),
      mockFinding({ severity: 'medium', message: 'Issue 3' }),
      mockFinding({ severity: 'low', message: 'Issue 4' }),
      mockFinding({ severity: 'info', message: 'Issue 5' }),
    ];

    const result = formatTopIssues(findings, 3);

    expect(result).toHaveLength(3);
    // Should be the top 3 by severity
    expect(result[0].severity).toBe('critical');
    expect(result[1].severity).toBe('high');
    expect(result[2].severity).toBe('medium');
  });

  it('returns all findings when limit exceeds count', () => {
    const findings = [
      mockFinding({ severity: 'high', message: 'Issue 1' }),
      mockFinding({ severity: 'low', message: 'Issue 2' }),
    ];

    const result = formatTopIssues(findings, 10);

    expect(result).toHaveLength(2);
  });

  it('does not mutate the original findings array', () => {
    const findings = [
      mockFinding({ severity: 'low', message: 'Low' }),
      mockFinding({ severity: 'critical', message: 'Critical' }),
    ];

    const originalOrder = findings.map((f) => f.severity);
    formatTopIssues(findings, 5);

    expect(findings.map((f) => f.severity)).toEqual(originalOrder);
  });

  it('handles limit of 0', () => {
    const findings = [mockFinding({ severity: 'critical', message: 'Issue' })];
    const result = formatTopIssues(findings, 0);
    expect(result).toEqual([]);
  });

  it('preserves all finding fields in returned objects', () => {
    const finding = mockFinding({
      severity: 'high',
      file: 'src/auth.ts',
      line: 42,
      category: 'security',
      message: 'SQL injection',
      source: 'semgrep',
    });

    const result = formatTopIssues([finding], 1);

    expect(result[0]).toEqual(finding);
  });
});
