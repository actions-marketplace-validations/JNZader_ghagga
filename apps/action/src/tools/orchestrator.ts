/**
 * Tool Orchestrator — runs all enabled static analysis tools sequentially.
 *
 * Orchestrates Semgrep → Trivy → CPD in sequence (not parallel) to keep
 * peak memory under 4GB on the GitHub Actions runner. Each tool's failure
 * is isolated — one tool failing does not prevent others from running.
 *
 * Returns a StaticAnalysisResult matching the core type contract.
 */

import * as core from '@actions/core';
import { executeSemgrep } from './semgrep.js';
import { executeTrivy } from './trivy.js';
import { executeCpd } from './cpd.js';
import type { StaticAnalysisResult, ToolResult } from './types.js';

/** Sentinel value for disabled/skipped tools */
const SKIPPED: ToolResult = {
  status: 'skipped',
  findings: [],
  executionTimeMs: 0,
};

/**
 * Run all enabled static analysis tools locally on the runner.
 * Tools run sequentially to keep peak memory under 4GB.
 * Never throws — each tool failure is isolated.
 */
export async function runLocalAnalysis(options: {
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  repoDir: string;
}): Promise<StaticAnalysisResult> {
  const totalStart = Date.now();

  core.info('Starting local static analysis...');

  // Sequential execution — memory safety
  const semgrep = options.enableSemgrep
    ? await executeSemgrep(options.repoDir)
    : SKIPPED;
  core.info(
    `Semgrep: ${semgrep.status} (${semgrep.findings.length} findings, ${semgrep.executionTimeMs}ms)`,
  );

  const trivy = options.enableTrivy
    ? await executeTrivy(options.repoDir)
    : SKIPPED;
  core.info(
    `Trivy: ${trivy.status} (${trivy.findings.length} findings, ${trivy.executionTimeMs}ms)`,
  );

  const cpd = options.enableCpd
    ? await executeCpd(options.repoDir)
    : SKIPPED;
  core.info(
    `CPD: ${cpd.status} (${cpd.findings.length} findings, ${cpd.executionTimeMs}ms)`,
  );

  const totalMs = Date.now() - totalStart;
  core.info(`Static analysis complete in ${(totalMs / 1000).toFixed(1)}s`);

  return { semgrep, trivy, cpd };
}
