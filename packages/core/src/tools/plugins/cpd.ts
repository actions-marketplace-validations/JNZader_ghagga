/**
 * CPD plugin — duplication detection (always-on).
 *
 * Adapted from:
 * - packages/core/src/tools/cpd.ts (parseCpdXml logic)
 * - apps/action/src/tools/cpd.ts (install/run flow)
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 * CPD exits with code 4 when duplications are found — successExitCodes: [4].
 */

import type { ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const PMD_VERSION = '7.8.0';
const PMD_HOME = '/opt/pmd';
const PMD_BIN = `${PMD_HOME}/bin/pmd`;

/**
 * Parse CPD XML output into ReviewFinding[].
 * Regex-based XML parsing — same logic as packages/core/src/tools/cpd.ts.
 * Exported for direct testing with fixture data.
 */
export function parseCpdOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  const xml = raw.stdout;
  if (!xml) return [];

  try {
    const findings: ReviewFinding[] = [];
    const dupRegex = /<duplication lines="(\d+)" tokens="(\d+)">([\s\S]*?)<\/duplication>/g;
    const fileRegex = /<file\s+path="([^"]+)"\s+line="(\d+)"/g;

    let dupMatch = dupRegex.exec(xml);
    while (dupMatch !== null) {
      const lines = parseInt(dupMatch[1] ?? '0', 10);
      const tokens = parseInt(dupMatch[2] ?? '0', 10);
      const inner = dupMatch[3] ?? '';

      const files: Array<{ path: string; line: number }> = [];
      fileRegex.lastIndex = 0;
      let fileMatch = fileRegex.exec(inner);
      while (fileMatch !== null) {
        files.push({
          path: (fileMatch[1] ?? '').replace(`${repoDir}/`, ''),
          line: parseInt(fileMatch[2] ?? '0', 10),
        });
        fileMatch = fileRegex.exec(inner);
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
      dupMatch = dupRegex.exec(xml);
    }

    return findings;
  } catch {
    return [];
  }
}

export const cpdPlugin: ToolDefinition = {
  name: 'cpd',
  displayName: 'PMD/CPD',
  category: 'duplication',
  tier: 'always-on',
  version: PMD_VERSION,
  outputFormat: 'xml',
  cachePaths: [PMD_HOME],
  successExitCodes: [4], // CPD returns 4 when duplications are found

  async install(ctx: ExecutionContext): Promise<void> {
    const cached = await ctx.cacheRestore('cpd', [PMD_HOME]);
    if (cached) {
      try {
        await ctx.exec(PMD_BIN, ['--version'], { timeoutMs: 10_000 });
        return;
      } catch {
        ctx.log('warn', 'PMD cache restored but binary not functional, reinstalling');
      }
    }

    // Download PMD zip from GitHub Releases and extract to /opt/pmd/
    await ctx.exec(
      'bash',
      [
        '-c',
        `curl -sL "https://github.com/pmd/pmd/releases/download/pmd_releases%2F${PMD_VERSION}/pmd-dist-${PMD_VERSION}-bin.zip" -o /tmp/pmd.zip && ` +
          `unzip -q /tmp/pmd.zip -d /opt && ` +
          `mv /opt/pmd-bin-${PMD_VERSION} ${PMD_HOME} && ` +
          `rm -f /tmp/pmd.zip`,
      ],
      { timeoutMs: 120_000 },
    );
    await ctx.exec(PMD_BIN, ['--version'], { timeoutMs: 10_000 });
    await ctx.cacheSave('cpd', [PMD_HOME]);
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec(
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
      {
        timeoutMs: timeout,
        allowExitCodes: [4], // CPD returns 4 when duplications are found
      },
    );
  },

  parse: parseCpdOutput,
};
