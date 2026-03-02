/**
 * Trivy dependency vulnerability scanner.
 * Executes trivy as a child process and parses JSON output.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolResult, ReviewFinding, FindingSeverity } from '../types.js';

const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 120_000; // Trivy can be slow on first run (downloading DB)

interface TrivyResult {
  Results?: Array<{
    Target: string;
    Type: string;
    Vulnerabilities?: Array<{
      VulnerabilityID: string;
      PkgName: string;
      InstalledVersion: string;
      FixedVersion?: string;
      Severity: string;
      Title?: string;
      Description?: string;
    }>;
  }>;
}

function mapSeverity(trivySeverity: string): FindingSeverity {
  switch (trivySeverity.toUpperCase()) {
    case 'CRITICAL':
      return 'critical';
    case 'HIGH':
      return 'high';
    case 'MEDIUM':
      return 'medium';
    case 'LOW':
      return 'low';
    default:
      return 'info';
  }
}

/**
 * Run Trivy against a directory to scan for dependency vulnerabilities.
 */
export async function runTrivy(scanPath: string): Promise<ToolResult> {
  const start = Date.now();

  try {
    // Check if trivy is available
    await execFileAsync('trivy', ['--version'], { timeout: 5_000 });
  } catch {
    return {
      status: 'skipped',
      findings: [],
      error: 'Trivy not available. Install from: https://trivy.dev',
      executionTimeMs: Date.now() - start,
    };
  }

  try {
    const { stdout } = await execFileAsync(
      'trivy',
      ['fs', '--format', 'json', '--scanners', 'vuln', '--quiet', scanPath],
      { timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 },
    );

    const result: TrivyResult = JSON.parse(stdout);
    const findings: ReviewFinding[] = [];

    for (const target of result.Results ?? []) {
      for (const vuln of target.Vulnerabilities ?? []) {
        const fixInfo = vuln.FixedVersion ? ` (fix: upgrade to ${vuln.FixedVersion})` : ' (no fix available)';

        findings.push({
          severity: mapSeverity(vuln.Severity),
          category: 'dependency-vulnerability',
          file: target.Target,
          message: `${vuln.VulnerabilityID}: ${vuln.PkgName}@${vuln.InstalledVersion} - ${vuln.Title ?? vuln.Description ?? 'Known vulnerability'}${fixInfo}`,
          suggestion: vuln.FixedVersion
            ? `Upgrade ${vuln.PkgName} to ${vuln.FixedVersion}`
            : undefined,
          source: 'trivy' as const,
        });
      }
    }

    return {
      status: 'success',
      findings,
      executionTimeMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'error',
      findings: [],
      error: `Trivy failed: ${error instanceof Error ? error.message : String(error)}`,
      executionTimeMs: Date.now() - start,
    };
  }
}
