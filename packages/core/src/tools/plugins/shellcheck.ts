/**
 * ShellCheck plugin — shell script linting (always-on).
 *
 * Lints shell scripts for common issues and portability problems.
 * Only runs on *.sh and *.bash files; returns empty findings if none found.
 *
 * Pre-installed on GitHub Actions runners — install is a verification step.
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const SHELLCHECK_VERSION = '0.10.0';

/**
 * Map ShellCheck level to GHAGGA FindingSeverity.
 * error→high, warning→medium, info→info, style→low
 */
export function mapShellCheckSeverity(level: string): FindingSeverity {
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

/** ShellCheck JSON finding structure */
interface ShellCheckFinding {
  file: string;
  line: number;
  column: number;
  level: string;
  code: number;
  message: string;
}

/**
 * Parse ShellCheck JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseShellCheckOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: ShellCheckFinding[] = JSON.parse(raw.stdout);

    return findings.map((f) => ({
      severity: mapShellCheckSeverity(f.level),
      category: 'quality',
      file: f.file.replace(`${repoDir}/`, ''),
      line: f.line,
      message: `SC${f.code}: ${f.message}`,
      source: 'shellcheck' as const,
    }));
  } catch {
    return [];
  }
}

export const shellcheckPlugin: ToolDefinition = {
  name: 'shellcheck',
  displayName: 'ShellCheck',
  category: 'quality',
  tier: 'always-on',
  version: SHELLCHECK_VERSION,
  outputFormat: 'json',

  async install(ctx: ExecutionContext): Promise<void> {
    // ShellCheck is typically pre-installed on GitHub Actions runners
    try {
      await ctx.exec('shellcheck', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'ShellCheck not found, installing...');
    }

    await ctx.exec(
      'bash',
      [
        '-c',
        `curl -sL "https://github.com/koalaman/shellcheck/releases/download/v${SHELLCHECK_VERSION}/shellcheck-v${SHELLCHECK_VERSION}.linux.x86_64.tar.xz" | tar xJ --strip-components=1 -C /usr/local/bin shellcheck-v${SHELLCHECK_VERSION}/shellcheck`,
      ],
      { timeoutMs: 120_000 },
    );
    await ctx.exec('shellcheck', ['--version'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    _repoDir: string,
    files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    // Filter to only shell script files
    const shellFiles = files.filter((f) => /\.(sh|bash)$/.test(f));

    if (shellFiles.length === 0) {
      // No shell files — return empty output (will parse to empty findings)
      return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false };
    }

    return ctx.exec('shellcheck', ['--format=json', ...shellFiles], {
      timeoutMs: timeout,
      allowExitCodes: [1], // shellcheck returns 1 when findings are present
    });
  },

  parse: parseShellCheckOutput,
};
