/**
 * Semgrep plugin — security analysis (always-on).
 *
 * Adapted from:
 * - packages/core/src/tools/semgrep.ts (parsing logic)
 * - apps/action/src/tools/semgrep.ts (install/run flow)
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const SEMGREP_VERSION = '1.90.0';

/**
 * Map Semgrep severity to GHAGGA FindingSeverity.
 * ERROR -> high, WARNING -> medium, INFO -> info, default -> low
 */
export function mapSemgrepSeverity(semgrepSeverity: string): FindingSeverity {
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
 * Parse Semgrep JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseSemgrepOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const result = JSON.parse(raw.stdout) as {
      results?: Array<{
        path: string;
        start: { line: number };
        extra: { severity: string; message: string };
      }>;
    };

    return (result.results ?? []).map((r) => ({
      severity: mapSemgrepSeverity(r.extra.severity),
      category: 'security',
      file: r.path.replace(`${repoDir}/`, ''),
      line: r.start.line,
      message: r.extra.message,
      source: 'semgrep' as const,
    }));
  } catch {
    return [];
  }
}

export const semgrepPlugin: ToolDefinition = {
  name: 'semgrep',
  displayName: 'Semgrep',
  category: 'security',
  tier: 'always-on',
  version: SEMGREP_VERSION,
  outputFormat: 'json',
  cachePaths: ['/usr/local/bin/semgrep'],

  async install(ctx: ExecutionContext): Promise<void> {
    const cached = await ctx.cacheRestore('semgrep', ['/usr/local/bin/semgrep']);
    if (cached) {
      try {
        await ctx.exec('semgrep', ['--version'], { timeoutMs: 10_000 });
        return;
      } catch {
        ctx.log('warn', 'Semgrep cache restored but binary not functional, reinstalling');
      }
    }

    await ctx.exec('pip', ['install', '--quiet', `semgrep==${SEMGREP_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('semgrep', ['--version'], { timeoutMs: 10_000 });
    await ctx.cacheSave('semgrep', ['/usr/local/bin/semgrep']);
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('semgrep', ['--json', '--config', 'auto', '--quiet', repoDir], {
      timeoutMs: timeout,
      allowExitCodes: [1], // semgrep returns 1 when findings are present
    });
  },

  parse: parseSemgrepOutput,
};
