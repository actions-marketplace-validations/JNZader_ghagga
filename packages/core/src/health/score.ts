/**
 * Health scoring — deterministic score from static analysis findings.
 */

import type { FindingSeverity, ReviewFinding } from '../types.js';

/** Severity weights for health score computation. */
export const SEVERITY_WEIGHTS: Record<FindingSeverity, number> = {
  critical: -20,
  high: -10,
  medium: -3,
  low: -1,
  info: 0,
};

/** Health score result. */
export interface HealthScore {
  /** Score 0-100 (higher is better). */
  score: number;
  /** Letter grade: A (80+), B (60-79), C (40-59), D (20-39), F (0-19). */
  grade: string;
  /** Finding counts per severity level. */
  findingCounts: Record<FindingSeverity, number>;
  /** Total number of findings. */
  totalFindings: number;
}

/** Grade thresholds. */
const GRADES: [number, string][] = [
  [80, 'A'],
  [60, 'B'],
  [40, 'C'],
  [20, 'D'],
  [0, 'F'],
];

/**
 * Compute health score from findings.
 * Base score = 100. Each finding subtracts its severity weight.
 * Result clamped to [0, 100].
 */
export function computeHealthScore(findings: ReviewFinding[]): HealthScore {
  const findingCounts: Record<FindingSeverity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0,
  };

  let deductions = 0;
  for (const finding of findings) {
    findingCounts[finding.severity] = (findingCounts[finding.severity] ?? 0) + 1;
    deductions += Math.abs(SEVERITY_WEIGHTS[finding.severity] ?? 0);
  }

  const score = Math.max(0, Math.min(100, 100 - deductions));
  const grade = GRADES.find(([threshold]) => score >= threshold)?.[1] ?? 'F';

  return {
    score,
    grade,
    findingCounts,
    totalFindings: findings.length,
  };
}

/**
 * Get color category for a health score.
 */
export function getScoreColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 50) return 'yellow';
  return 'red';
}

/** Severity sort order (critical first). */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Get top N issues sorted by severity (critical first).
 */
export function formatTopIssues(findings: ReviewFinding[], limit: number): ReviewFinding[] {
  return [...findings]
    .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 5) - (SEVERITY_ORDER[b.severity] ?? 5))
    .slice(0, limit);
}
