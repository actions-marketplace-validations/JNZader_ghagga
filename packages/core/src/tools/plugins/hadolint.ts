/**
 * Hadolint plugin — Dockerfile linting (auto-detect).
 *
 * Lints Dockerfiles for best practices and common issues.
 * Activates when Dockerfile-named files are detected.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const HADOLINT_VERSION = '2.12.0';
const HADOLINT_BIN = '/usr/local/bin/hadolint';

/**
 * Map Hadolint level to GHAGGA FindingSeverity.
 * error→high, warning→medium, info→info, style→low
 */
export function mapHadolintSeverity(level: string): FindingSeverity {
  switch (level.toLowerCase()) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'info':
      return 'info';
    case 'style':
      return 'low';
    default:
      return 'low';
  }
}

/** Hadolint JSON finding structure */
interface HadolintFinding {
  line: number;
  code: string;
  message: string;
  column: number;
  file: string;
  level: string;
}

/**
 * Parse Hadolint JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseHadolintOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: HadolintFinding[] = JSON.parse(raw.stdout);

    return findings.map((f) => ({
      severity: mapHadolintSeverity(f.level),
      category: 'quality',
      file: f.file.replace(`${repoDir}/`, ''),
      line: f.line,
      message: `${f.code}: ${f.message}`,
      source: 'hadolint' as const,
    }));
  } catch {
    return [];
  }
}

export const hadolintPlugin: ToolDefinition = {
  name: 'hadolint',
  displayName: 'Hadolint',
  category: 'quality',
  tier: 'auto-detect',
  version: HADOLINT_VERSION,
  outputFormat: 'json',
  cachePaths: [HADOLINT_BIN],

  detect(files: string[]): boolean {
    return files.some((f) => {
      const basename = f.split('/').pop() ?? '';
      return /Dockerfile/.test(basename);
    });
  },

  async install(ctx: ExecutionContext): Promise<void> {
    const cached = await ctx.cacheRestore('hadolint', [HADOLINT_BIN]);
    if (cached) {
      try {
        await ctx.exec('hadolint', ['--version'], { timeoutMs: 10_000 });
        return;
      } catch {
        ctx.log('warn', 'Hadolint cache restored but binary not functional, reinstalling');
      }
    }

    await ctx.exec(
      'bash',
      [
        '-c',
        `curl -sL "https://github.com/hadolint/hadolint/releases/download/v${HADOLINT_VERSION}/hadolint-Linux-x86_64" -o ${HADOLINT_BIN} && chmod +x ${HADOLINT_BIN}`,
      ],
      { timeoutMs: 120_000 },
    );
    await ctx.exec('hadolint', ['--version'], { timeoutMs: 10_000 });
    await ctx.cacheSave('hadolint', [HADOLINT_BIN]);
  },

  async run(
    ctx: ExecutionContext,
    _repoDir: string,
    files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    // Filter to only Dockerfile-matching files
    const dockerfiles = files.filter((f) => {
      const basename = f.split('/').pop() ?? '';
      return /Dockerfile/.test(basename);
    });

    if (dockerfiles.length === 0) {
      return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false };
    }

    return ctx.exec('hadolint', ['--format', 'json', ...dockerfiles], {
      timeoutMs: timeout,
      allowExitCodes: [1], // hadolint returns 1 when findings are present
    });
  },

  parse: parseHadolintOutput,
};
