/**
 * Tool Orchestrator — runs all enabled static analysis tools sequentially.
 *
 * Uses the registry-driven orchestrator to run up to 15 static analysis
 * tools via plugins. Each tool's failure is isolated — one tool failing
 * does not prevent others from running.
 *
 * Returns a StaticAnalysisResult matching the core type contract.
 */

import * as core from '@actions/core';
import { initializeDefaultTools, resolveActivatedTools, runTools, toolRegistry } from 'ghagga-core';
import { createActionsExecutionContext } from './execution.js';
import type { StaticAnalysisResult } from './types.js';

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
  return runLocalAnalysisWithRegistry(options);
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
  core.info('[ghagga:tools] Running static analysis with registry-driven orchestrator');

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
