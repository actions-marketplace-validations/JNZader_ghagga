/**
 * Lizard plugin — cyclomatic complexity analysis (always-on).
 *
 * Analyzes function-level cyclomatic complexity across all languages.
 * Flags functions exceeding complexity thresholds:
 *   CCN > 20 → high, CCN > 15 → medium, CCN > 10 → low, CCN ≤ 10 → skip
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const LIZARD_VERSION = '1.17.13';

/**
 * Map cyclomatic complexity to GHAGGA FindingSeverity.
 * Returns null for functions below threshold (CCN ≤ 10).
 */
export function mapComplexitySeverity(ccn: number): FindingSeverity | null {
  if (ccn > 20) return 'high';
  if (ccn > 15) return 'medium';
  if (ccn > 10) return 'low';
  return null;
}

/** Lizard JSON function structure */
interface LizardFunction {
  name: string;
  long_name: string;
  start_line: number;
  cyclomatic_complexity: number;
}

/** Lizard JSON file structure */
interface LizardFile {
  filename: string;
  function_list: LizardFunction[];
}

/**
 * Parse Lizard JSON output into ReviewFinding[].
 * Only includes functions with CCN > 10.
 * Exported for direct testing with fixture data.
 */
export function parseLizardOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const files: LizardFile[] = JSON.parse(raw.stdout);
    const findings: ReviewFinding[] = [];

    for (const file of files) {
      for (const func of file.function_list) {
        const severity = mapComplexitySeverity(func.cyclomatic_complexity);
        if (severity === null) continue;

        findings.push({
          severity,
          category: 'complexity',
          file: file.filename.replace(`${repoDir}/`, ''),
          line: func.start_line,
          message: `Function '${func.name}' has cyclomatic complexity of ${func.cyclomatic_complexity} (threshold: 10)`,
          source: 'lizard' as const,
        });
      }
    }

    return findings;
  } catch {
    return [];
  }
}

export const lizardPlugin: ToolDefinition = {
  name: 'lizard',
  displayName: 'Lizard',
  category: 'complexity',
  tier: 'always-on',
  version: LIZARD_VERSION,
  outputFormat: 'json',

  async install(ctx: ExecutionContext): Promise<void> {
    try {
      await ctx.exec('lizard', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'Lizard not found, installing...');
    }

    await ctx.exec('pip', ['install', '--quiet', `lizard==${LIZARD_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('lizard', ['--version'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('lizard', ['--json', repoDir], {
      timeoutMs: timeout,
    });
  },

  parse: parseLizardOutput,
};
