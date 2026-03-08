/**
 * Gitleaks plugin — secret detection (always-on).
 *
 * Scans the repository for hardcoded secrets, API keys, and credentials.
 * All secret findings are reported as critical severity.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const GITLEAKS_VERSION = '8.21.2';
const GITLEAKS_BIN = '/usr/local/bin/gitleaks';

/** Gitleaks JSON finding structure */
interface GitleaksFinding {
  Description: string;
  StartLine: number;
  File: string;
  RuleID: string;
}

/**
 * Parse Gitleaks JSON output into ReviewFinding[].
 * Gitleaks writes results to a report file; we read from stdout or the report.
 * Exported for direct testing with fixture data.
 */
export function parseGitleaksOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: GitleaksFinding[] = JSON.parse(raw.stdout);

    return findings.map((f) => ({
      severity: 'critical' as const,
      category: 'secrets',
      file: f.File.replace(`${repoDir}/`, ''),
      line: f.StartLine,
      message: `${f.Description} (rule: ${f.RuleID})`,
      source: 'gitleaks' as const,
    }));
  } catch {
    return [];
  }
}

export const gitleaksPlugin: ToolDefinition = {
  name: 'gitleaks',
  displayName: 'Gitleaks',
  category: 'secrets',
  tier: 'always-on',
  version: GITLEAKS_VERSION,
  outputFormat: 'json',
  cachePaths: [GITLEAKS_BIN],

  async install(ctx: ExecutionContext): Promise<void> {
    const cached = await ctx.cacheRestore('gitleaks', [GITLEAKS_BIN]);
    if (cached) {
      try {
        await ctx.exec('gitleaks', ['version'], { timeoutMs: 10_000 });
        return;
      } catch {
        ctx.log('warn', 'Gitleaks cache restored but binary not functional, reinstalling');
      }
    }

    // Download Gitleaks binary from GitHub Releases
    await ctx.exec(
      'bash',
      [
        '-c',
        `curl -sL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" | tar xz -C /usr/local/bin gitleaks`,
      ],
      { timeoutMs: 120_000 },
    );
    await ctx.exec('gitleaks', ['version'], { timeoutMs: 10_000 });
    await ctx.cacheSave('gitleaks', [GITLEAKS_BIN]);
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    const reportPath = '/tmp/gitleaks-result.json';

    await ctx.exec(
      'gitleaks',
      [
        'detect',
        `--source=${repoDir}`,
        '--report-format=json',
        `--report-path=${reportPath}`,
        '--no-git',
        '--exit-code=0',
      ],
      {
        timeoutMs: timeout,
      },
    );

    // Read the report file and return it as stdout
    return ctx.exec('cat', [reportPath], {
      timeoutMs: 10_000,
      allowExitCodes: [1], // cat may fail if no findings file
    });
  },

  parse: parseGitleaksOutput,
};
