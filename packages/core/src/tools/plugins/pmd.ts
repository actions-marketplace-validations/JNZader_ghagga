/**
 * PMD plugin — Java code quality analysis (auto-detect).
 *
 * Runs PMD static analysis with the quickstart ruleset.
 * Shares installation with CPD (both use the PMD binary at /opt/pmd).
 * Activates when Java or Kotlin files are detected.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const PMD_VERSION = '7.8.0';
const PMD_HOME = '/opt/pmd';
const PMD_BIN = `${PMD_HOME}/bin/pmd`;

/**
 * Map PMD violation priority to GHAGGA FindingSeverity.
 * 1→critical, 2→high, 3→medium, 4→low, 5→info
 */
export function mapPmdPriority(priority: number): FindingSeverity {
  switch (priority) {
    case 1:
      return 'critical';
    case 2:
      return 'high';
    case 3:
      return 'medium';
    case 4:
      return 'low';
    case 5:
      return 'info';
    default:
      return 'low';
  }
}

/** PMD JSON output structure */
interface PmdOutput {
  files?: Array<{
    filename: string;
    violations: Array<{
      beginline: number;
      description: string;
      rule: string;
      ruleset: string;
      priority: number;
    }>;
  }>;
}

/**
 * Parse PMD JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parsePmdOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const result: PmdOutput = JSON.parse(raw.stdout);
    const findings: ReviewFinding[] = [];

    for (const file of result.files ?? []) {
      for (const violation of file.violations) {
        findings.push({
          severity: mapPmdPriority(violation.priority),
          category: 'quality',
          file: file.filename.replace(`${repoDir}/`, ''),
          line: violation.beginline,
          message: `[${violation.rule}] ${violation.description}`,
          source: 'pmd' as const,
        });
      }
    }

    return findings;
  } catch {
    return [];
  }
}

export const pmdPlugin: ToolDefinition = {
  name: 'pmd',
  displayName: 'PMD',
  category: 'quality',
  tier: 'auto-detect',
  version: PMD_VERSION,
  outputFormat: 'json',

  detect(files: string[]): boolean {
    return files.some((f) => /\.(java|kt)$/.test(f));
  },

  async install(ctx: ExecutionContext): Promise<void> {
    // PMD may already be installed via CPD plugin (shared binary)
    try {
      await ctx.exec(PMD_BIN, ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'PMD not found, installing (shared with CPD)...');
    }

    const cached = await ctx.cacheRestore('cpd', [PMD_HOME]);
    if (cached) {
      try {
        await ctx.exec(PMD_BIN, ['--version'], { timeoutMs: 10_000 });
        return;
      } catch {
        ctx.log('warn', 'PMD cache restored but binary not functional, reinstalling');
      }
    }

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
      ['check', '--format', 'json', '--dir', repoDir, '--rulesets', 'rulesets/java/quickstart.xml'],
      {
        timeoutMs: timeout,
        allowExitCodes: [4], // PMD returns 4 when violations are found
      },
    );
  },

  parse: parsePmdOutput,
};
