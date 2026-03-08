/**
 * Psalm plugin — PHP static analysis (auto-detect).
 *
 * Runs Psalm for type checking and security analysis on PHP codebases.
 * Activates when PHP files or composer.json is detected.
 * Maps taint-related findings to critical severity.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const PSALM_VERSION = '6.5.1';

/**
 * Map Psalm finding to GHAGGA FindingSeverity.
 * Taint findings (e.g., TaintedHtml, TaintedSql) → critical.
 * error → high, info → low, default → medium
 */
export function mapPsalmSeverity(severity: string, type: string): FindingSeverity {
  // Taint findings are always critical regardless of severity
  if (type.toLowerCase().startsWith('tainted')) return 'critical';

  switch (severity.toLowerCase()) {
    case 'error':
      return 'high';
    case 'info':
      return 'low';
    default:
      return 'medium';
  }
}

/** Psalm JSON finding structure */
interface PsalmFinding {
  severity: string;
  line_from: number;
  type: string;
  message: string;
  file_name: string;
  file_path: string;
}

/**
 * Parse Psalm JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parsePsalmOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: PsalmFinding[] = JSON.parse(raw.stdout);

    return findings.map((f) => ({
      severity: mapPsalmSeverity(f.severity, f.type),
      category: 'quality',
      file: f.file_path.replace(`${repoDir}/`, ''),
      line: f.line_from,
      message: `[${f.type}] ${f.message}`,
      source: 'psalm' as const,
    }));
  } catch {
    return [];
  }
}

export const psalmPlugin: ToolDefinition = {
  name: 'psalm',
  displayName: 'Psalm',
  category: 'quality',
  tier: 'auto-detect',
  version: PSALM_VERSION,
  outputFormat: 'json',

  detect(files: string[]): boolean {
    return files.some((f) => f.endsWith('.php') || f === 'composer.json');
  },

  async install(ctx: ExecutionContext): Promise<void> {
    // Check if Psalm PHAR is already available
    try {
      await ctx.exec('psalm', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'Psalm not found, installing...');
    }

    // Install via Composer global
    await ctx.exec('composer', ['global', 'require', `vimeo/psalm:${PSALM_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('psalm', ['--version'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('psalm', ['--output-format=json', '--no-cache'], {
      timeoutMs: timeout,
      cwd: repoDir,
      allowExitCodes: [1, 2], // psalm returns 1 for info, 2 for errors
    });
  },

  parse: parsePsalmOutput,
};
