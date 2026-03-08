/**
 * Biome plugin — JavaScript/TypeScript linting (auto-detect).
 *
 * Fast linter and formatter for JS/TS. Activates when JS/TS files are detected.
 * Maps diagnostic severity to FindingSeverity.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const BIOME_VERSION = '1.9.4';

/**
 * Map Biome diagnostic severity to GHAGGA FindingSeverity.
 * error→high, warning→medium, information→low, hint→info
 */
export function mapBiomeSeverity(severity: string): FindingSeverity {
  switch (severity.toLowerCase()) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'information':
      return 'low';
    case 'hint':
      return 'info';
    default:
      return 'low';
  }
}

/** Biome JSON diagnostic structure */
interface BiomeDiagnostic {
  category: string;
  description: string;
  severity: string;
  location: {
    path: { file: string };
    span?: [number, number];
    sourceCode?: string;
  };
  message?: Array<{ content: string }>;
}

/** Biome JSON output structure */
interface BiomeOutput {
  diagnostics?: BiomeDiagnostic[];
}

/**
 * Parse Biome JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseBiomeOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const result: BiomeOutput = JSON.parse(raw.stdout);

    return (result.diagnostics ?? []).map((d) => ({
      severity: mapBiomeSeverity(d.severity),
      category: 'quality',
      file: d.location.path.file.replace(`${repoDir}/`, ''),
      message: `${d.category}: ${d.description}`,
      source: 'biome' as const,
    }));
  } catch {
    return [];
  }
}

export const biomePlugin: ToolDefinition = {
  name: 'biome',
  displayName: 'Biome',
  category: 'quality',
  tier: 'auto-detect',
  version: BIOME_VERSION,
  outputFormat: 'json',

  detect(files: string[]): boolean {
    return files.some((f) => /\.(ts|js|tsx|jsx|mts|mjs|cts|cjs)$/.test(f));
  },

  async install(ctx: ExecutionContext): Promise<void> {
    try {
      await ctx.exec('biome', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'Biome not found, installing...');
    }

    await ctx.exec('npm', ['install', '-g', `@biomejs/biome@${BIOME_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('biome', ['--version'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('biome', ['lint', '--reporter', 'json', repoDir], {
      timeoutMs: timeout,
      allowExitCodes: [1], // biome returns 1 when findings are present
    });
  },

  parse: parseBiomeOutput,
};
