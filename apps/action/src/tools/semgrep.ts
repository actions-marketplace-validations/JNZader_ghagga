/**
 * Semgrep static analysis — install, execute, parse.
 *
 * Installs Semgrep via pip on the GitHub Actions runner, executes it
 * against the repo checkout, and parses JSON output into ReviewFinding[].
 *
 * Severity mapping replicates packages/core/src/tools/semgrep.ts mapSeverity:
 *   ERROR   -> high
 *   WARNING -> medium
 *   INFO    -> info
 *   default -> low
 */

import * as core from '@actions/core';
import { execWithTimeout } from './exec.js';
import { restoreToolCache, saveToolCache } from './cache.js';
import { TOOL_VERSIONS, TOOL_TIMEOUT_MS } from './types.js';
import type { ToolResult, ReviewFinding, FindingSeverity } from './types.js';

/**
 * Map Semgrep severity to GHAGGA FindingSeverity.
 * Replicates the pattern from packages/core/src/tools/semgrep.ts.
 */
function mapSeverity(semgrepSeverity: string): FindingSeverity {
  switch (semgrepSeverity.toUpperCase()) {
    case 'ERROR':
      return 'high';
    case 'WARNING':
      return 'medium';
    case 'INFO':
      return 'info';
    default:
      return 'low';
  }
}

/**
 * Install Semgrep on the runner (skip if cached).
 * @returns true if installed/available, false if install failed
 */
export async function installSemgrep(): Promise<boolean> {
  const cached = await restoreToolCache('semgrep');
  if (cached) {
    // Verify binary works after cache restore
    try {
      await execWithTimeout('semgrep', ['--version'], { timeoutMs: 10_000 });
      return true;
    } catch {
      core.warning(
        'Semgrep cache restored but binary not functional, reinstalling',
      );
    }
  }

  try {
    await execWithTimeout(
      'pip',
      ['install', '--quiet', `semgrep==${TOOL_VERSIONS.semgrep}`],
      { timeoutMs: 120_000 }, // pip install can be slow
    );
    await saveToolCache('semgrep');
    return true;
  } catch (error) {
    core.warning(`Semgrep install failed: ${error}`);
    return false;
  }
}

/**
 * Run Semgrep and parse results.
 * @returns ToolResult (never throws)
 */
export async function executeSemgrep(repoDir: string): Promise<ToolResult> {
  const start = Date.now();
  try {
    const installed = await installSemgrep();
    if (!installed) {
      return {
        status: 'error',
        findings: [],
        error: 'Semgrep installation failed',
        executionTimeMs: Date.now() - start,
      };
    }

    const { stdout } = await execWithTimeout(
      'semgrep',
      ['--json', '--config', 'auto', '--quiet', repoDir],
      { timeoutMs: TOOL_TIMEOUT_MS, allowNonZero: true },
    );

    const result = JSON.parse(stdout);
    const findings: ReviewFinding[] = (result.results ?? []).map(
      (r: {
        path: string;
        start: { line: number };
        extra: { severity: string; message: string };
      }) => ({
        severity: mapSeverity(r.extra.severity),
        category: 'security',
        file: r.path.replace(repoDir + '/', ''),
        line: r.start.line,
        message: r.extra.message,
        source: 'semgrep' as const,
      }),
    );

    return {
      status: 'success',
      findings,
      executionTimeMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'error',
      findings: [],
      error: `Semgrep failed: ${error instanceof Error ? error.message : String(error)}`,
      executionTimeMs: Date.now() - start,
    };
  }
}
