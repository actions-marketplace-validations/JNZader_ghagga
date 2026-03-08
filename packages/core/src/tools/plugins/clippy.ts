/**
 * Clippy plugin — Rust linting (auto-detect).
 *
 * Runs cargo clippy for Rust code analysis.
 * Activates when Cargo.toml or .rs files are detected.
 * Parses line-delimited JSON (compiler messages).
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { FindingSeverity, ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

/**
 * Map Rust compiler message level to GHAGGA FindingSeverity.
 * error→high, warning→medium, note→low, help→info
 */
export function mapClippySeverity(level: string): FindingSeverity {
  switch (level.toLowerCase()) {
    case 'error':
      return 'high';
    case 'warning':
      return 'medium';
    case 'note':
      return 'low';
    case 'help':
      return 'info';
    default:
      return 'low';
  }
}

/** Clippy compiler message structure */
interface ClippyMessage {
  reason: string;
  message?: {
    level: string;
    message: string;
    spans: Array<{
      file_name: string;
      line_start: number;
    }>;
  };
}

/**
 * Parse Clippy line-delimited JSON output into ReviewFinding[].
 * Each line is a separate JSON object (not a JSON array).
 * Only includes compiler-message entries with spans.
 * Exported for direct testing with fixture data.
 */
export function parseClippyOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: ReviewFinding[] = [];
    const lines = raw.stdout.trim().split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      const entry: ClippyMessage = JSON.parse(line);

      // Only process compiler messages with spans
      if (entry.reason !== 'compiler-message' || !entry.message?.spans?.length) continue;

      const msg = entry.message;
      const span = msg.spans[0];
      if (!span) continue;

      findings.push({
        severity: mapClippySeverity(msg.level),
        category: 'quality',
        file: span.file_name.replace(`${repoDir}/`, ''),
        line: span.line_start,
        message: msg.message,
        source: 'clippy' as const,
      });
    }

    return findings;
  } catch {
    return [];
  }
}

export const clippyPlugin: ToolDefinition = {
  name: 'clippy',
  displayName: 'Clippy',
  category: 'quality',
  tier: 'auto-detect',
  version: 'toolchain',
  outputFormat: 'json',

  detect(files: string[]): boolean {
    return files.some((f) => f === 'Cargo.toml' || f.endsWith('.rs'));
  },

  async install(ctx: ExecutionContext): Promise<void> {
    // Clippy comes with rustup — just verify cargo is available
    try {
      await ctx.exec('cargo', ['--version'], { timeoutMs: 10_000 });
      return;
    } catch {
      throw new Error(
        'Rust toolchain (cargo) is not available. clippy requires a Rust installation.',
      );
    }
  },

  async run(
    ctx: ExecutionContext,
    repoDir: string,
    _files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    return ctx.exec('cargo', ['clippy', '--message-format=json', '--', '-W', 'clippy::all'], {
      timeoutMs: timeout,
      cwd: repoDir,
      allowExitCodes: [1, 101], // clippy may return non-zero on findings or compilation errors
    });
  },

  parse: parseClippyOutput,
};
