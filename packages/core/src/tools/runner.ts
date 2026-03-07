/**
 * Static analysis tool runner.
 * Runs Semgrep, Trivy, and CPD sequentially to avoid memory pressure.
 *
 * These tools are run one at a time because running them in parallel
 * (Python + JVM + Go) can exceed container memory limits (2GB on Cloud Run).
 */

import type { ReviewSettings, StaticAnalysisResult, ToolResult } from '../types.js';
import { runCpd } from './cpd.js';
import { runSemgrep } from './semgrep.js';
import { runTrivy } from './trivy.js';

const SKIPPED_RESULT: ToolResult = {
  status: 'skipped',
  findings: [],
  error: 'Disabled in settings',
  executionTimeMs: 0,
};

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
 * @param files - Map of file paths to file contents (for Semgrep)
 * @param scanPath - Directory path on disk (for Trivy and CPD)
 * @param settings - Which tools are enabled
 */
export async function runStaticAnalysis(
  files: Map<string, string>,
  scanPath: string,
  settings: Pick<ReviewSettings, 'enableSemgrep' | 'enableTrivy' | 'enableCpd' | 'customRules'>,
): Promise<StaticAnalysisResult> {
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
 * Format static analysis findings into a prompt context block.
 * This is injected into LLM prompts so agents don't repeat findings.
 */
export function formatStaticAnalysisContext(result: StaticAnalysisResult): string {
  const allFindings = [
    ...result.semgrep.findings,
    ...result.trivy.findings,
    ...result.cpd.findings,
  ];

  if (allFindings.length === 0) return '';

  const lines = ['## Pre-Review Static Analysis (confirmed issues - do NOT repeat these)', ''];

  for (const finding of allFindings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    lines.push(
      `- **[${finding.source.toUpperCase()}]** [${finding.severity}] ${location}: ${finding.message}`,
    );
  }

  lines.push('');
  lines.push('> These issues were detected by automated tools. Do NOT repeat them in your review.');
  lines.push('> Focus on logic, architecture, and issues that static analysis cannot detect.');

  return lines.join('\n');
}
