/**
 * Commit message review — lightweight validation + optional LLM review.
 *
 * Used by `ghagga review --commit-msg <file>` for the commit-msg hook.
 * Validates basic commit message format (heuristics) and optionally
 * calls a single LLM prompt for quality assessment.
 *
 * Returns a ReviewResult-compatible structure for consistent exit-code handling.
 */

import type {
  LLMProvider,
  ReviewResult,
  ReviewFinding,
  ReviewStatus,
  FindingSeverity,
} from 'ghagga-core';

// ─── Types ──────────────────────────────────────────────────────

export interface CommitMsgReviewOptions {
  /** Raw commit message string (file contents) */
  message: string;
  /** LLM provider */
  provider: LLMProvider;
  /** LLM model identifier */
  model: string;
  /** API key for the LLM provider */
  apiKey: string;
  /** When true, skip LLM and use heuristics only */
  quick?: boolean;
}

// ─── Heuristic Validations ──────────────────────────────────────

interface HeuristicFinding {
  severity: FindingSeverity;
  message: string;
  suggestion?: string;
}

/**
 * Strip comment lines (starting with #) from a commit message.
 * Git includes these as hints in the COMMIT_EDITMSG file.
 */
function stripComments(message: string): string {
  return message
    .split('\n')
    .filter((line) => !line.startsWith('#'))
    .join('\n')
    .trim();
}

/**
 * Run heuristic validations on a commit message.
 * Returns an array of findings (empty = message is fine).
 */
function validateHeuristics(message: string): HeuristicFinding[] {
  const findings: HeuristicFinding[] = [];
  const cleaned = stripComments(message);

  // Empty message
  if (cleaned.length === 0) {
    findings.push({
      severity: 'high',
      message: 'Commit message is empty',
      suggestion: 'Write a descriptive commit message explaining the change',
    });
    return findings; // No point checking further
  }

  // Too short (likely meaningless like "fix" or "wip")
  if (cleaned.length <= 3) {
    findings.push({
      severity: 'high',
      message: `Commit message is too short (${cleaned.length} chars)`,
      suggestion: 'Write a descriptive message explaining what changed and why',
    });
  }

  const lines = cleaned.split('\n');
  const subject = lines[0] ?? '';

  // Subject line > 72 chars
  if (subject.length > 72) {
    findings.push({
      severity: 'medium',
      message: `Subject line is ${subject.length} characters (recommended max: 72)`,
      suggestion: 'Keep the subject line concise; move details to the body',
    });
  }

  // Subject ends with period
  if (subject.endsWith('.')) {
    findings.push({
      severity: 'low',
      message: 'Subject line ends with a period',
      suggestion: 'Remove the trailing period from the subject line',
    });
  }

  // Body not separated by blank line
  if (lines.length > 1 && lines[1] !== '') {
    findings.push({
      severity: 'medium',
      message: 'Body is not separated from subject by a blank line',
      suggestion: 'Add a blank line between the subject and body',
    });
  }

  return findings;
}

// ─── Main Function ──────────────────────────────────────────────

/**
 * Validate a commit message using heuristics and optional LLM review.
 * Returns a ReviewResult for consistent exit-code and output handling.
 */
export async function reviewCommitMessage(
  opts: CommitMsgReviewOptions,
): Promise<ReviewResult> {
  const startTime = Date.now();
  const findings: ReviewFinding[] = [];

  // ── Step 1: Heuristic validation ──────────────────────────
  const heuristicFindings = validateHeuristics(opts.message);

  for (const hf of heuristicFindings) {
    findings.push({
      severity: hf.severity,
      category: hf.severity === 'low' ? 'style' : 'convention',
      file: 'COMMIT_EDITMSG',
      message: hf.message,
      suggestion: hf.suggestion,
      source: 'ai', // Use 'ai' as closest match in FindingSource union
    });
  }

  // ── Step 2: LLM review (skip in quick mode) ───────────────
  // Note: LLM commit message review is a future enhancement.
  // For now, heuristic validation covers the essential checks.
  // When --quick is NOT set and we have a non-empty message,
  // a future version will call a single LLM prompt here.

  // ── Step 3: Determine status ──────────────────────────────
  const hasBlockingIssues = findings.some(
    (f) => f.severity === 'critical' || f.severity === 'high',
  );

  const status: ReviewStatus = hasBlockingIssues ? 'FAILED' : 'PASSED';
  const executionTimeMs = Date.now() - startTime;

  const summary =
    findings.length === 0
      ? 'Commit message looks good.'
      : `Found ${findings.length} issue(s) in commit message.`;

  return {
    status,
    summary,
    findings,
    staticAnalysis: {
      semgrep: { status: 'skipped', findings: [], executionTimeMs: 0 },
      trivy: { status: 'skipped', findings: [], executionTimeMs: 0 },
      cpd: { status: 'skipped', findings: [], executionTimeMs: 0 },
    },
    memoryContext: null,
    metadata: {
      mode: 'simple',
      provider: opts.quick ? 'none' : opts.provider,
      model: opts.quick ? 'static-only' : opts.model,
      tokensUsed: 0,
      executionTimeMs,
      toolsRun: [],
      toolsSkipped: ['semgrep', 'trivy', 'cpd'],
    },
  };
}
