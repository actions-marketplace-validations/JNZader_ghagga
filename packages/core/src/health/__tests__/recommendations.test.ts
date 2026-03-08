/**
 * Health recommendations unit tests.
 *
 * Tests generateRecommendations — grouping by category,
 * impact ranking, template application, and edge cases.
 */

import { describe, expect, it } from 'vitest';

import type { ReviewFinding } from '../../types.js';
import { generateRecommendations } from '../recommendations.js';

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

describe('generateRecommendations', () => {
  it('returns empty array for zero findings', () => {
    const result = generateRecommendations([]);
    expect(result).toEqual([]);
  });

  it('groups findings by source category and generates correct recommendations', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'high' }),
      mockFinding({ source: 'semgrep', severity: 'critical' }),
      mockFinding({ source: 'trivy', severity: 'medium' }),
    ];

    const result = generateRecommendations(findings);

    // semgrep → security, trivy → dependencies
    expect(result).toHaveLength(2);

    const categories = result.map((r) => r.category);
    expect(categories).toContain('security');
    expect(categories).toContain('dependencies');
  });

  it('applies template with correct finding count substitution', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'high' }),
      mockFinding({ source: 'semgrep', severity: 'medium' }),
      mockFinding({ source: 'semgrep', severity: 'low' }),
    ];

    const result = generateRecommendations(findings);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('security');
    expect(result[0].action).toContain('3 security finding(s)');
    expect(result[0].findingCount).toBe(3);
  });

  it('sorts recommendations by impact — highest first', () => {
    const findings = [
      mockFinding({ source: 'shellcheck', severity: 'low' }), // scripts, impact=1
      mockFinding({ source: 'semgrep', severity: 'critical' }), // security, impact=20
      mockFinding({ source: 'trivy', severity: 'medium' }), // dependencies, impact=3
    ];

    const result = generateRecommendations(findings);

    expect(result[0].category).toBe('security');
    expect(result[1].category).toBe('dependencies');
    expect(result[2].category).toBe('scripts');
  });

  it('assigns high impact for categories with impact >= 20', () => {
    // 1 critical = 20 impact weight
    const findings = [mockFinding({ source: 'semgrep', severity: 'critical' })];

    const result = generateRecommendations(findings);

    expect(result[0].impact).toBe('high');
  });

  it('assigns medium impact for categories with impact 5-19', () => {
    // 1 high = 10 impact weight
    const findings = [mockFinding({ source: 'semgrep', severity: 'high' })];

    const result = generateRecommendations(findings);

    expect(result[0].impact).toBe('medium');
  });

  it('assigns low impact for categories with impact < 5', () => {
    // 1 medium = 3 impact weight
    const findings = [mockFinding({ source: 'semgrep', severity: 'medium' })];

    const result = generateRecommendations(findings);

    expect(result[0].impact).toBe('low');
  });

  it('limits results to specified count (default 5)', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'critical' }),
      mockFinding({ source: 'trivy', severity: 'high' }),
      mockFinding({ source: 'gitleaks', severity: 'high' }),
      mockFinding({ source: 'shellcheck', severity: 'medium' }),
      mockFinding({ source: 'lizard', severity: 'medium' }),
      mockFinding({ source: 'cpd', severity: 'medium' }),
      mockFinding({ source: 'eslint', severity: 'medium' }),
      mockFinding({ source: 'hadolint', severity: 'medium' }),
    ];

    const result = generateRecommendations(findings);
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it('respects custom limit parameter', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'critical' }),
      mockFinding({ source: 'trivy', severity: 'high' }),
      mockFinding({ source: 'gitleaks', severity: 'high' }),
    ];

    const result = generateRecommendations(findings, 2);
    expect(result).toHaveLength(2);
  });

  // ── Source → category mapping ─────────────────────────────────

  it('maps semgrep and bandit to security category', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'high' }),
      mockFinding({ source: 'bandit', severity: 'high' }),
    ];

    const result = generateRecommendations(findings);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('security');
    expect(result[0].findingCount).toBe(2);
  });

  it('maps trivy to dependencies category', () => {
    const findings = [mockFinding({ source: 'trivy', severity: 'high' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('dependencies');
    expect(result[0].action).toContain('dependency issue(s)');
  });

  it('maps gitleaks to secrets category', () => {
    const findings = [mockFinding({ source: 'gitleaks', severity: 'critical' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('secrets');
    expect(result[0].action).toContain('exposed secret(s)');
  });

  it('maps shellcheck to scripts category', () => {
    const findings = [mockFinding({ source: 'shellcheck', severity: 'medium' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('scripts');
    expect(result[0].action).toContain('shell script issue(s)');
  });

  it('maps lizard to complexity category', () => {
    const findings = [mockFinding({ source: 'lizard', severity: 'medium' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('complexity');
    expect(result[0].action).toContain('complex function(s)');
  });

  it('maps cpd to duplication category', () => {
    const findings = [mockFinding({ source: 'cpd', severity: 'medium' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('duplication');
    expect(result[0].action).toContain('code duplication');
  });

  it('maps eslint, ruff, phpstan, checkstyle, detekt, clippy to quality category', () => {
    for (const source of ['eslint', 'ruff', 'phpstan', 'checkstyle', 'detekt', 'clippy']) {
      const findings = [mockFinding({ source: source as any, severity: 'medium' })];
      const result = generateRecommendations(findings);
      expect(result[0].category).toBe('quality');
    }
  });

  it('maps hadolint to containers category', () => {
    const findings = [mockFinding({ source: 'hadolint' as any, severity: 'medium' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('containers');
    expect(result[0].action).toContain('Dockerfile issue(s)');
  });

  it('defaults unknown sources to quality category', () => {
    const findings = [mockFinding({ source: 'unknown-tool' as any, severity: 'high' })];
    const result = generateRecommendations(findings);
    expect(result[0].category).toBe('quality');
  });

  // ── Edge cases ────────────────────────────────────────────────

  it('filters out categories with only info findings (zero impact)', () => {
    const findings = [
      mockFinding({ source: 'eslint', severity: 'info' }),
      mockFinding({ source: 'eslint', severity: 'info' }),
    ];

    const result = generateRecommendations(findings);
    expect(result).toEqual([]);
  });

  it('includes categories with mixed info and non-info findings', () => {
    const findings = [
      mockFinding({ source: 'eslint', severity: 'info' }),
      mockFinding({ source: 'eslint', severity: 'low' }),
    ];

    const result = generateRecommendations(findings);

    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('quality');
    expect(result[0].findingCount).toBe(2);
  });

  it('aggregates impact across multiple findings in same category', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'high' }), // 10
      mockFinding({ source: 'semgrep', severity: 'high' }), // 10
    ];

    const result = generateRecommendations(findings);

    // Combined impact = 20, should be 'high'
    expect(result[0].impact).toBe('high');
    expect(result[0].findingCount).toBe(2);
  });

  it('handles a clean codebase scenario (all info)', () => {
    const findings = [
      mockFinding({ source: 'semgrep', severity: 'info' }),
      mockFinding({ source: 'trivy', severity: 'info' }),
      mockFinding({ source: 'eslint', severity: 'info' }),
    ];

    const result = generateRecommendations(findings);
    expect(result).toEqual([]);
  });
});
