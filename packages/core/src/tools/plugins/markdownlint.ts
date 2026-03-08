/**
 * markdownlint-cli2 plugin — Markdown documentation linting (always-on).
 *
 * Lints Markdown files for style and formatting issues.
 * Only runs on *.md files; returns empty findings if none found.
 *
 * Uses ExecutionContext for DI instead of direct child_process.
 */

import type { ReviewFinding } from '../../types.js';
import type { ExecutionContext, RawToolOutput, ToolDefinition } from '../types.js';

const MARKDOWNLINT_VERSION = '0.17.1';

/** markdownlint-cli2 JSON finding structure */
interface MarkdownlintFinding {
  fileName: string;
  lineNumber: number;
  ruleNames: string[];
  ruleDescription: string;
  errorDetail: string | null;
}

/**
 * Parse markdownlint-cli2 JSON output into ReviewFinding[].
 * Exported for direct testing with fixture data.
 */
export function parseMarkdownlintOutput(raw: RawToolOutput, repoDir: string): ReviewFinding[] {
  if (raw.timedOut) return [];

  try {
    const findings: MarkdownlintFinding[] = JSON.parse(raw.stdout);

    return findings.map((f) => {
      const ruleName = f.ruleNames[0] ?? 'unknown';
      const detail = f.errorDetail ? ` (${f.errorDetail})` : '';

      return {
        severity: 'info' as const,
        category: 'docs',
        file: f.fileName.replace(`${repoDir}/`, ''),
        line: f.lineNumber,
        message: `${ruleName}: ${f.ruleDescription}${detail}`,
        source: 'markdownlint' as const,
      };
    });
  } catch {
    return [];
  }
}

export const markdownlintPlugin: ToolDefinition = {
  name: 'markdownlint',
  displayName: 'markdownlint-cli2',
  category: 'docs',
  tier: 'always-on',
  version: MARKDOWNLINT_VERSION,
  outputFormat: 'json',

  async install(ctx: ExecutionContext): Promise<void> {
    try {
      await ctx.exec('markdownlint-cli2', ['--help'], { timeoutMs: 10_000 });
      return;
    } catch {
      ctx.log('info', 'markdownlint-cli2 not found, installing...');
    }

    await ctx.exec('npm', ['install', '-g', `markdownlint-cli2@${MARKDOWNLINT_VERSION}`], {
      timeoutMs: 120_000,
    });
    await ctx.exec('markdownlint-cli2', ['--help'], { timeoutMs: 10_000 });
  },

  async run(
    ctx: ExecutionContext,
    _repoDir: string,
    files: string[],
    timeout: number,
  ): Promise<RawToolOutput> {
    // Filter to only Markdown files
    const mdFiles = files.filter((f) => f.endsWith('.md'));

    if (mdFiles.length === 0) {
      // No Markdown files — return empty output
      return { stdout: '[]', stderr: '', exitCode: 0, timedOut: false };
    }

    return ctx.exec('markdownlint-cli2', ['--config', '{}', ...mdFiles], {
      timeoutMs: timeout,
      allowExitCodes: [1], // markdownlint returns 1 when findings are present
    });
  },

  parse: parseMarkdownlintOutput,
};
