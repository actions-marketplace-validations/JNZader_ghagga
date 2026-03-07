/**
 * PMD/CPD (Copy-Paste Detector) — install, execute, parse.
 *
 * Installs PMD via zip download from GitHub Releases on the runner,
 * executes CPD against the repo checkout, and parses XML output into ReviewFinding[].
 *
 * XML parsing replicates packages/core/src/tools/cpd.ts parseCpdXml.
 * CPD exits non-zero (exit code 4) when duplications are found — this is expected.
 */

import * as core from '@actions/core';
import { restoreToolCache, saveToolCache } from './cache.js';
import { execWithTimeout } from './exec.js';
import type { ReviewFinding, ToolResult } from './types.js';
import { TOOL_TIMEOUT_MS, TOOL_VERSIONS } from './types.js';

/** PMD install path */
const PMD_HOME = '/opt/pmd';
const PMD_BIN = `${PMD_HOME}/bin/pmd`;

/**
 * Parse CPD XML output into ReviewFinding[].
 * Replicates the logic from packages/core/src/tools/cpd.ts parseCpdXml.
 *
 * CPD XML format:
 * <pmd-cpd>
 *   <duplication lines="N" tokens="N">
 *     <file path="..." line="N" endline="N" />
 *     <file path="..." line="N" endline="N" />
 *     <codefragment>...</codefragment>
 *   </duplication>
 * </pmd-cpd>
 */
function parseCpdXml(xml: string, basePath: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const dupRegex = /<duplication lines="(\d+)" tokens="(\d+)">([\s\S]*?)<\/duplication>/g;
  const fileRegex = /<file\s+path="([^"]+)"\s+line="(\d+)"/g;

  let dupMatch: RegExpExecArray | null;
  while ((dupMatch = dupRegex.exec(xml)) !== null) {
    const lines = parseInt(dupMatch[1]!, 10);
    const tokens = parseInt(dupMatch[2]!, 10);
    const inner = dupMatch[3]!;

    const files: Array<{ path: string; line: number }> = [];
    let fileMatch: RegExpExecArray | null;
    fileRegex.lastIndex = 0;
    while ((fileMatch = fileRegex.exec(inner)) !== null) {
      files.push({
        path: fileMatch[1]?.replace(`${basePath}/`, ''),
        line: parseInt(fileMatch[2]!, 10),
      });
    }

    if (files.length >= 2) {
      const locations = files.map((f) => `${f.path}:${f.line}`).join(', ');
      findings.push({
        severity: 'medium',
        category: 'duplication',
        file: files[0]?.path,
        line: files[0]?.line,
        message: `Duplicated code block (${lines} lines, ${tokens} tokens) found in: ${locations}`,
        source: 'cpd' as const,
      });
    }
  }

  return findings;
}

/**
 * Install PMD/CPD on the runner (skip if cached).
 * Downloads PMD zip from GitHub Releases and extracts to /opt/pmd/.
 * @returns true if installed/available, false if install failed
 */
export async function installCpd(): Promise<boolean> {
  const cached = await restoreToolCache('cpd');
  if (cached) {
    // Verify binary works after cache restore
    try {
      await execWithTimeout(PMD_BIN, ['--version'], { timeoutMs: 10_000 });
      return true;
    } catch {
      core.warning('PMD cache restored but binary not functional, reinstalling');
    }
  }

  try {
    const version = TOOL_VERSIONS.pmd;
    // Download PMD zip from GitHub Releases and extract to /opt/pmd/
    //   curl -sL "https://github.com/pmd/pmd/releases/download/pmd_releases%2F7.8.0/pmd-dist-7.8.0-bin.zip" -o /tmp/pmd.zip
    //   unzip -q /tmp/pmd.zip -d /opt
    //   mv /opt/pmd-bin-7.8.0 /opt/pmd
    await execWithTimeout(
      'bash',
      [
        '-c',
        `curl -sL "https://github.com/pmd/pmd/releases/download/pmd_releases%2F${version}/pmd-dist-${version}-bin.zip" -o /tmp/pmd.zip && ` +
          `unzip -q /tmp/pmd.zip -d /opt && ` +
          `mv /opt/pmd-bin-${version} ${PMD_HOME} && ` +
          `rm -f /tmp/pmd.zip`,
      ],
      { timeoutMs: 120_000 },
    );
    await saveToolCache('cpd');
    return true;
  } catch (error) {
    core.warning(`PMD/CPD install failed: ${error}`);
    return false;
  }
}

/**
 * Run CPD and parse results.
 * CPD exits non-zero (exit code 4) when duplications are found — use allowNonZero.
 * @returns ToolResult (never throws)
 */
export async function executeCpd(repoDir: string): Promise<ToolResult> {
  const start = Date.now();
  try {
    const installed = await installCpd();
    if (!installed) {
      return {
        status: 'error',
        findings: [],
        error: 'PMD/CPD installation failed',
        executionTimeMs: Date.now() - start,
      };
    }

    // CPD exits with code 4 when duplications are found (not an error)
    const { stdout } = await execWithTimeout(
      PMD_BIN,
      [
        'cpd',
        '--format',
        'xml',
        '--minimum-tokens',
        '100',
        '--dir',
        repoDir,
        '--skip-lexical-errors',
      ],
      { timeoutMs: TOOL_TIMEOUT_MS, allowNonZero: true },
    );

    const findings = parseCpdXml(stdout, repoDir);

    return {
      status: 'success',
      findings,
      executionTimeMs: Date.now() - start,
    };
  } catch (error) {
    return {
      status: 'error',
      findings: [],
      error: `CPD failed: ${error instanceof Error ? error.message : String(error)}`,
      executionTimeMs: Date.now() - start,
    };
  }
}
