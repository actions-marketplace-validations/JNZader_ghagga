/**
 * PR comment formatting for GHAGGA code reviews.
 *
 * Renders a ReviewResult as a GitHub-flavored Markdown comment
 * suitable for posting to a PR via the GitHub API.
 */

import type { ReviewResult, ReviewStatus } from './types.js';

// ─── Constants ──────────────────────────────────────────────────

export const STATUS_EMOJI: Record<ReviewStatus, string> = {
  PASSED: '\u2705 PASSED',
  FAILED: '\u274c FAILED',
  NEEDS_HUMAN_REVIEW: '\u26a0\ufe0f NEEDS_HUMAN_REVIEW',
  SKIPPED: '\u23ed\ufe0f SKIPPED',
};

export const SEVERITY_EMOJI: Record<string, string> = {
  critical: '\ud83d\udd34',
  high: '\ud83d\udfe0',
  medium: '\ud83d\udfe1',
  low: '\ud83d\udfe2',
  info: '\ud83d\udfe3',
};

// ─── Formatting ─────────────────────────────────────────────────

export function formatReviewComment(result: ReviewResult): string {
  const status = STATUS_EMOJI[result.status] ?? result.status;
  const timeSeconds = (result.metadata.executionTimeMs / 1000).toFixed(1);

  let comment = `## \ud83e\udd16 GHAGGA Code Review\n\n`;
  comment += `**Status:** ${status}\n`;
  comment += `**Mode:** ${result.metadata.mode} | **Model:** ${result.metadata.model} | **Time:** ${timeSeconds}s\n\n`;

  // Summary
  comment += `### Summary\n${result.summary}\n\n`;

  // Findings grouped by source
  if (result.findings.length > 0) {
    comment += `### Findings (${result.findings.length})\n\n`;

    // Group findings by source
    const grouped = new Map<string, typeof result.findings>();
    for (const finding of result.findings) {
      const src = finding.source ?? 'ai';
      if (!grouped.has(src)) grouped.set(src, []);
      grouped.get(src)?.push(finding);
    }

    // Render order: static tools first, then AI
    const SOURCE_LABELS: Record<string, string> = {
      semgrep: '\ud83d\udd0d Semgrep',
      trivy: '\ud83d\udee1\ufe0f Trivy',
      cpd: '\ud83d\udccb CPD',
      ai: '\ud83e\udd16 AI Review',
    };
    const renderOrder = ['semgrep', 'trivy', 'cpd', 'ai'];

    for (const src of renderOrder) {
      const findings = grouped.get(src);
      if (!findings || findings.length === 0) continue;

      const label = SOURCE_LABELS[src] ?? src;
      comment += `**${label} (${findings.length})**\n`;
      comment += `| Severity | Category | File | Message |\n`;
      comment += `|----------|----------|------|----------|\n`;

      for (const finding of findings) {
        const emoji = SEVERITY_EMOJI[finding.severity] ?? '';
        const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
        const message = finding.message.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        comment += `| ${emoji} ${finding.severity} | ${finding.category} | ${location} | ${message} |\n`;
      }
      comment += '\n';
    }
  }

  // Static analysis summary
  const staticTools = result.metadata.toolsRun;
  const skippedTools = result.metadata.toolsSkipped;
  if (staticTools.length > 0 || skippedTools.length > 0) {
    comment += `### Static Analysis\n`;
    if (staticTools.length > 0) {
      comment += `\u2705 Tools run: ${staticTools.join(', ')}\n`;
    }
    if (skippedTools.length > 0) {
      comment += `\u23ed\ufe0f Tools skipped: ${skippedTools.join(', ')}\n`;
    }
    comment += '\n';
  }

  comment += `---\n*Powered by [GHAGGA](https://github.com/JNZader/ghagga) \u2014 AI Code Review*`;

  return comment;
}
