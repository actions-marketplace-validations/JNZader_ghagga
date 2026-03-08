/**
 * Tool Orchestrator — runs all enabled static analysis tools sequentially.
 *
 * Orchestrates Semgrep → Trivy → CPD in sequence (not parallel) to keep
 * peak memory under 4GB on the GitHub Actions runner. Each tool's failure
 * is isolated — one tool failing does not prevent others from running.
 *
 * Feature flag `GHAGGA_TOOL_REGISTRY`:
 * - When true: uses the registry-driven orchestrator (15 tools via plugins)
 * - When false/unset: uses the existing hardcoded 3-tool path
 *
 * Returns a StaticAnalysisResult matching the core type contract.
 */

import * as core from '@actions/core';
import {
  initializeDefaultTools,
  isToolRegistryEnabled,
  resolveActivatedTools,
  runTools,
  toolRegistry,
} from 'ghagga-core';
import { executeCpd } from './cpd.js';
import { createActionsExecutionContext } from './execution.js';
import { executeSemgrep } from './semgrep.js';
import { executeTrivy } from './trivy.js';
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
  enabledTools?: string[];
  disabledTools?: string[];
  repoDir: string;
}): Promise<StaticAnalysisResult> {
  // ── Registry-driven path (feature flag) ──────────────────────
  if (isToolRegistryEnabled()) {
    return runLocalAnalysisWithRegistry(options);
  }

  // ── Legacy hardcoded path ────────────────────────────────────
  const totalStart = Date.now();

  core.info('Starting local static analysis...');

  // Sequential execution — memory safety
  const semgrep = options.enableSemgrep ? await executeSemgrep(options.repoDir) : SKIPPED;
  core.info(
    `Semgrep: ${semgrep.status} (${semgrep.findings.length} findings, ${semgrep.executionTimeMs}ms)`,
  );

  const trivy = options.enableTrivy ? await executeTrivy(options.repoDir) : SKIPPED;
  core.info(
    `Trivy: ${trivy.status} (${trivy.findings.length} findings, ${trivy.executionTimeMs}ms)`,
  );

  const cpd = options.enableCpd ? await executeCpd(options.repoDir) : SKIPPED;
  core.info(`CPD: ${cpd.status} (${cpd.findings.length} findings, ${cpd.executionTimeMs}ms)`);

  const totalMs = Date.now() - totalStart;
  core.info(`Static analysis complete in ${(totalMs / 1000).toFixed(1)}s`);

  return { semgrep, trivy, cpd };
}

/**
 * Run static analysis using the registry-driven orchestrator.
 * Uses ActionsExecutionContext for @actions/exec + @actions/cache.
 * @internal
 */
async function runLocalAnalysisWithRegistry(options: {
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  enabledTools?: string[];
  disabledTools?: string[];
  repoDir: string;
}): Promise<StaticAnalysisResult> {
  core.info('[ghagga:tools] Using registry-driven orchestrator (GHAGGA_TOOL_REGISTRY=true)');

  // Ensure plugins are registered
  initializeDefaultTools();

  // List changed files from the repo dir (for auto-detect resolution)
  // In the Action, we don't have the file list here — pass empty and rely on always-on + settings
  const fileList: string[] = [];

  // Resolve which tools should run
  const activatedTools = resolveActivatedTools({
    registry: toolRegistry,
    files: fileList,
    enabledTools: options.enabledTools,
    disabledTools: options.disabledTools,
    enableSemgrep: options.enableSemgrep,
    enableTrivy: options.enableTrivy,
    enableCpd: options.enableCpd,
  });

  core.info(
    `[ghagga:tools] Activated tools: ${activatedTools.map((t) => t.definition.name).join(', ')}`,
  );

  // Run tools with Actions execution context
  const ctx = createActionsExecutionContext();
  const results = await runTools(ctx, activatedTools, options.repoDir, fileList);

  return results as StaticAnalysisResult;
}
