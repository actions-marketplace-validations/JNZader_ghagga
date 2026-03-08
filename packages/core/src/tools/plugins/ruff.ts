/**
 * Ruff plugin — Python linting (auto-detect).
 *
 * Fast Python linter. Activates when Python files are detected.
 * Maps ruff rule code prefixes to severity levels.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const RUFF_VERSION = '0.9.7';

/**
 * Map Ruff code prefix to GHAGGA FindingSeverity.
 * F (Pyflakes) → high, E (errors) → medium, W (warnings) → low, others → low
 */
export function mapRuffSeverity(code: string): FindingSeverity {
  const prefix = code.charAt(0).toUpperCase();
  switch (prefix) {
    case 'F':
      return 'high';
    case 'E':
      return 'medium';
    case 'W':
      return 'low';
    default:
      return 'low';
  }
}

/** Ruff JSON finding structure */
interface RuffFinding {
  code: string;
  filename: string;
  location: { column: number; row: number };
  message: string;
  url?: string;
}

/**
 * Parse Ruff JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseRuffOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: RuffFinding[] = JSON.parse(raw.stdout);

    return findings.map((f) => ({
      severity: mapRuffSeverity(f.code),
      category: 'quality',
      file: f.filename.replace(`${repoDir}/`, ''),
      line: f.location.row,
      message: `${f.code}: ${f.message}`,
      source: 'ruff' as const,
    }));
  } catch {
    return [];
  }
}

export const ruffPlugin: ToolDefinition = {
  name: 'ruff',
  displayName: 'Ruff',
  category: 'quality',
  tier: 'auto-detect',
  version: RUFF_VERSION,
  outputFormat: 'json',

  detect(files: string[]): boolean {
    return files.some((f) => f.endsWith('.py') || f.endsWith('.pyi'));
  },

  async install(ctx: ExecutionContext): Promise<void> {
    try {
      await ctx.exec('ruff', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'Ruff not found, installing...');
    }

    await ctx.exec('pip', ['install', '--quiet', `ruff==${RUFF_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('ruff', ['--version'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('ruff', ['check', '--output-format', 'json', repoDir], {
      timeoutMs: timeout,
      allowExitCodes: [1], // ruff returns 1 when findings are present
    });
  },

  parse: parseRuffOutput,
};
