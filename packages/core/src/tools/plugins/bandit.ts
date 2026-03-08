/**
 * Bandit plugin — Python security analysis (auto-detect).
 *
 * Scans Python code for common security issues.
 * Activates when Python files are detected.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const BANDIT_VERSION = '1.8.3';

/**
 * Map Bandit severity to GHAGGA FindingSeverity.
 * HIGH→high, MEDIUM→medium, LOW→low, default→info
 */
export function mapBanditSeverity(banditSeverity: string): FindingSeverity {
  switch (banditSeverity.toUpperCase()) {
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

/** Bandit JSON result structure */
interface BanditResult {
  results?: Array<{
    filename: string;
    issue_severity: string;
    issue_confidence: string;
    issue_text: string;
    line_number: number;
    test_id: string;
  }>;
}

/**
 * Parse Bandit JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseBanditOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const result: BanditResult = JSON.parse(raw.stdout);

    return (result.results ?? []).map((r) => ({
      severity: mapBanditSeverity(r.issue_severity),
      category: 'security',
      file: r.filename.replace(`${repoDir}/`, ''),
      line: r.line_number,
      message: `${r.test_id}: ${r.issue_text} (confidence: ${r.issue_confidence})`,
      source: 'bandit' as const,
    }));
  } catch {
    return [];
  }
}

export const banditPlugin: ToolDefinition = {
  name: 'bandit',
  displayName: 'Bandit',
  category: 'security',
  tier: 'auto-detect',
  version: BANDIT_VERSION,
  outputFormat: 'json',

  detect(files: string[]): boolean {
    return files.some((f) => f.endsWith('.py'));
  },

  async install(ctx: ExecutionContext): Promise<void> {
    try {
      await ctx.exec('bandit', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'Bandit not found, installing...');
    }

    await ctx.exec('pip', ['install', '--quiet', `bandit==${BANDIT_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('bandit', ['--version'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('bandit', ['-r', repoDir, '-f', 'json', '--quiet'], {
      timeoutMs: timeout,
      allowExitCodes: [1], // bandit returns 1 when findings are present
    });
  },

  parse: parseBanditOutput,
};
