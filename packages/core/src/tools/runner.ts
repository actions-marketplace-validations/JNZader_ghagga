/**
 * Static analysis tool runner.
 * Runs Semgrep, Trivy, and CPD sequentially to avoid memory pressure.
 *
 * These tools are run one at a time because running them in parallel
 * (Python + JVM + Go) can exceed container memory limits (2GB on Cloud Run).
 *
 * Feature flag `GHAGGA_TOOL_REGISTRY`:
 * - When true: uses the new registry-driven orchestrator (Phase 2+)
 * - When false/unset: uses the existing hardcoded 3-tool path
 */

import type { ReviewFinding, ReviewSettings, StaticAnalysisResult, ToolResult } from '../types.js';
import { runCpd } from './cpd.js';
import { createNodeExecutionContext } from './execution.js';
import { runTools } from './orchestrator.js';
import { initializeDefaultTools } from './plugins/index.js';
import { toolRegistry } from './registry.js';
import { resolveActivatedTools } from './resolve.js';
import { runSemgrep } from './semgrep.js';
import { runTrivy } from './trivy.js';

const SKIPPED_RESULT: ToolResult = {
  status: 'skipped',
  findings: [],
  error: 'Disabled in settings',
  executionTimeMs: 0,
};

/** Maximum number of findings to include in LLM context */
const FINDING_CAP = 200;

/**
 * Check if the tool registry feature flag is enabled.
 */
export function isToolRegistryEnabled(): boolean {
  return process.env.GHAGGA_TOOL_REGISTRY === 'true';
}

/**
 * Safely run a tool, catching any errors.
 */
async function safeRun(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (error) {
    return {
      status: 'error',
      findings: [],
      error: String(error instanceof Error ? error.message : error),
      executionTimeMs: 0,
    };
  }
}

/**
 * Run all enabled static analysis tools sequentially.
 *
 * When GHAGGA_TOOL_REGISTRY=true, uses the registry-driven orchestrator.
 * Otherwise, falls back to the hardcoded 3-tool path.
 *
 * @param files - Map of file paths to file contents (for Semgrep)
 * @param scanPath - Directory path on disk (for Trivy and CPD)
 * @param settings - Which tools are enabled
 */
export async function runStaticAnalysis(
  files: Map<string, string>,
  scanPath: string,
  settings: Pick<
    ReviewSettings,
    'enableSemgrep' | 'enableTrivy' | 'enableCpd' | 'customRules' | 'enabledTools' | 'disabledTools'
  >,
): Promise<StaticAnalysisResult> {
  // ── Registry-driven path (feature flag) ──────────────────────
  if (isToolRegistryEnabled()) {
    return runStaticAnalysisWithRegistry(scanPath, Array.from(files.keys()), settings);
  }

  // ── Legacy hardcoded path ────────────────────────────────────
  // Run sequentially to avoid OOM in memory-constrained containers.
  // Order: Trivy (lightest, Go binary) → Semgrep (Python) → CPD (JVM, heaviest)
  console.log('[ghagga:tools] Running static analysis sequentially...');

  const trivyResult = settings.enableTrivy
    ? await safeRun(() => runTrivy(scanPath))
    : SKIPPED_RESULT;
  console.log(
    `[ghagga:tools] Trivy: ${trivyResult.status} (${trivyResult.findings.length} findings)`,
  );

  const semgrepResult = settings.enableSemgrep
    ? await safeRun(() => runSemgrep(files))
    : SKIPPED_RESULT;
  console.log(
    `[ghagga:tools] Semgrep: ${semgrepResult.status} (${semgrepResult.findings.length} findings)`,
  );

  const cpdResult = settings.enableCpd ? await safeRun(() => runCpd(scanPath)) : SKIPPED_RESULT;
  console.log(`[ghagga:tools] CPD: ${cpdResult.status} (${cpdResult.findings.length} findings)`);

  return { semgrep: semgrepResult, trivy: trivyResult, cpd: cpdResult };
}

/**
 * Run static analysis using the registry-driven orchestrator.
 * @internal
 */
async function runStaticAnalysisWithRegistry(
  scanPath: string,
  fileList: string[],
  settings: Pick<
    ReviewSettings,
    'enableSemgrep' | 'enableTrivy' | 'enableCpd' | 'enabledTools' | 'disabledTools'
  >,
): Promise<StaticAnalysisResult> {
  console.log('[ghagga:tools] Using registry-driven orchestrator (GHAGGA_TOOL_REGISTRY=true)');

  // Ensure plugins are registered
  initializeDefaultTools();

  // Resolve which tools should run
  const activatedTools = resolveActivatedTools({
    registry: toolRegistry,
    files: fileList,
    enabledTools: settings.enabledTools,
    disabledTools: settings.disabledTools,
    enableSemgrep: settings.enableSemgrep,
    enableTrivy: settings.enableTrivy,
    enableCpd: settings.enableCpd,
  });

  // Run tools with Node execution context
  const ctx = createNodeExecutionContext();
  const results = await runTools(ctx, activatedTools, scanPath, fileList);

  return results as StaticAnalysisResult;
}

/** Severity sort order for finding cap (most severe first) */
const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

/**
 * Format static analysis findings into a prompt context block.
 * This is injected into LLM prompts so agents don't repeat findings.
 *
 * Iterates all tool results dynamically (not hardcoded to semgrep/trivy/cpd).
 * Applies a finding cap of 200 with severity-priority sorting.
 */
export function formatStaticAnalysisContext(result: StaticAnalysisResult): string {
  // Collect findings from ALL tools dynamically
  const allFindings: ReviewFinding[] = [];
  for (const toolResult of Object.values(result)) {
    if (toolResult && typeof toolResult === 'object' && 'findings' in toolResult) {
      allFindings.push(...(toolResult as ToolResult).findings);
    }
  }

  if (allFindings.length === 0) return '';

  // Sort by severity (most severe first) for the cap
  allFindings.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 4) - (SEVERITY_ORDER[b.severity] ?? 4));

  // Apply finding cap
  const totalCount = allFindings.length;
  const cappedFindings = allFindings.slice(0, FINDING_CAP);

  const lines = ['## Pre-Review Static Analysis (confirmed issues - do NOT repeat these)', ''];

  for (const finding of cappedFindings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    lines.push(
      `- **[${finding.source.toUpperCase()}]** [${finding.severity}] ${location}: ${finding.message}`,
    );
  }

  if (totalCount > FINDING_CAP) {
    lines.push('');
    lines.push(`> Showing ${FINDING_CAP} of ${totalCount} findings (sorted by severity).`);
  }

  lines.push('');
  lines.push('> These issues were detected by automated tools. Do NOT repeat them in your review.');
  lines.push('> Focus on logic, architecture, and issues that static analysis cannot detect.');

  return lines.join('\n');
}
