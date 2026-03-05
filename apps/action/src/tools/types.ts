/**
 * Action Tool Infrastructure — Shared Types & Constants
 *
 * Types and pinned versions for running static analysis tools
 * directly on the GitHub Actions runner.
 */

import type {
  ToolResult,
  StaticAnalysisResult,
  ReviewFinding,
  FindingSeverity,
} from 'ghagga-core';

// Re-export core types for convenience
export type { ToolResult, StaticAnalysisResult, ReviewFinding, FindingSeverity };

/** Tool names matching the keys in StaticAnalysisResult */
export type ToolName = 'semgrep' | 'trivy' | 'cpd';

/**
 * Pinned tool versions — bump these to invalidate cache.
 * Versions sourced from design.md.
 */
export const TOOL_VERSIONS = {
  semgrep: '1.90.0',
  trivy: '0.69.3',
  pmd: '7.8.0',
} as const;

/** Per-tool timeout in milliseconds (3 minutes) */
export const TOOL_TIMEOUT_MS = 180_000;

/** Configuration for a single tool run */
export interface ToolRunConfig {
  enabled: boolean;
  repoDir: string; // GITHUB_WORKSPACE — the checkout directory
}

/** Result of executing a shell command */
export interface ExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}
