/**
 * golangci-lint plugin — Go code analysis (auto-detect).
 *
 * Runs multiple Go linters in a single pass.
 * Activates when Go files or go.mod is detected.
 * Maps gosec linter findings to security/high, others to quality/medium.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const GOLANGCI_LINT_VERSION = '1.63.4';
const GOLANGCI_LINT_BIN = '/usr/local/bin/golangci-lint';

/**
 * Map golangci-lint issue to GHAGGA FindingSeverity and category.
 * gosec linter → security category with high severity.
 * Other linters → quality category with medium severity.
 */
export function mapGolangciLintFinding(fromLinter: string): {
  severity: FindingSeverity;
  category: string;
} {
  if (fromLinter === 'gosec') {
    return { severity: 'high', category: 'security' };
  }
  return { severity: 'medium', category: 'quality' };
}

/** golangci-lint JSON output structure */
interface GolangciLintResult {
  Issues?: Array<{
    FromLinter: string;
    Text: string;
    Severity: string;
    Pos: {
      Filename: string;
      Line: number;
      Column: number;
    };
  }>;
}

/**
 * Parse golangci-lint JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseGolangciLintOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const result: GolangciLintResult = JSON.parse(raw.stdout);

    return (result.Issues ?? []).map((issue) => {
      const { severity, category } = mapGolangciLintFinding(issue.FromLinter);

      return {
        severity,
        category,
        file: issue.Pos.Filename.replace(`${repoDir}/`, ''),
        line: issue.Pos.Line,
        message: `[${issue.FromLinter}] ${issue.Text}`,
        source: 'golangci-lint' as const,
      };
    });
  } catch {
    return [];
  }
}

export const golangciLintPlugin: ToolDefinition = {
  name: 'golangci-lint',
  displayName: 'golangci-lint',
  category: 'quality',
  tier: 'auto-detect',
  version: GOLANGCI_LINT_VERSION,
  outputFormat: 'json',
  cachePaths: [GOLANGCI_LINT_BIN],

  detect(files: string[]): boolean {
    return files.some((f) => f === 'go.mod' || f.endsWith('.go'));
  },

  async install(ctx: ExecutionContext): Promise<void> {
    const cached = await ctx.cacheRestore('golangci-lint', [GOLANGCI_LINT_BIN]);
    if (cached) {
      try {
        await ctx.exec('golangci-lint', ['--version'], { timeoutMs: 10_000 });
        return;
      } catch {
        ctx.log('warn', 'golangci-lint cache restored but binary not functional, reinstalling');
      }
    }

    await ctx.exec(
      'bash',
      [
        '-c',
        `curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b /usr/local/bin v${GOLANGCI_LINT_VERSION}`,
      ],
      { timeoutMs: 120_000 },
    );
    await ctx.exec('golangci-lint', ['--version'], { timeoutMs: 10_000 });
    await ctx.cacheSave('golangci-lint', [GOLANGCI_LINT_BIN]);
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    const timeoutSec = Math.max(60, Math.floor(timeout / 1000));

    return ctx.exec(
      'golangci-lint',
      ['run', '--out-format', 'json', '--timeout', `${timeoutSec}s`],
      {
        timeoutMs: timeout,
        cwd: repoDir,
        allowExitCodes: [1], // returns 1 when findings are present
      },
    );
  },

  parse: parseGolangciLintOutput,
};
