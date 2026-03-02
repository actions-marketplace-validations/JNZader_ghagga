/**
 * Static analysis tool runner.
 * Runs Semgrep, Trivy, and CPD in parallel and merges results.
 */

import { runSemgrep } from './semgrep.js';
import { runTrivy } from './trivy.js';
import { runCpd } from './cpd.js';
import type { StaticAnalysisResult, ReviewSettings, ToolResult } from '../types.js';

const SKIPPED_RESULT: ToolResult = {
  status: 'skipped',
  findings: [],
  error: 'Disabled in settings',
  executionTimeMs: 0,
};

/**
 * Run all enabled static analysis tools in parallel.
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
  const [semgrepResult, trivyResult, cpdResult] = await Promise.allSettled([
    settings.enableSemgrep ? runSemgrep(files) : Promise.resolve(SKIPPED_RESULT),
    settings.enableTrivy ? runTrivy(scanPath) : Promise.resolve(SKIPPED_RESULT),
    settings.enableCpd ? runCpd(scanPath) : Promise.resolve(SKIPPED_RESULT),
  ]);

  return {
    semgrep: semgrepResult.status === 'fulfilled'
      ? semgrepResult.value
      : { status: 'error', findings: [], error: String(semgrepResult.reason), executionTimeMs: 0 },
    trivy: trivyResult.status === 'fulfilled'
      ? trivyResult.value
      : { status: 'error', findings: [], error: String(trivyResult.reason), executionTimeMs: 0 },
    cpd: cpdResult.status === 'fulfilled'
      ? cpdResult.value
      : { status: 'error', findings: [], error: String(cpdResult.reason), executionTimeMs: 0 },
  };
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
    lines.push(`- **[${finding.source.toUpperCase()}]** [${finding.severity}] ${location}: ${finding.message}`);
  }

  lines.push('');
  lines.push('> These issues were detected by automated tools. Do NOT repeat them in your review.');
  lines.push('> Focus on logic, architecture, and issues that static analysis cannot detect.');

  return lines.join('\n');
}
