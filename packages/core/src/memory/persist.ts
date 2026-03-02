/**
 * Persist review observations to memory.
 *
 * After a review completes, this module extracts key findings
 * and saves them as memory observations so future reviews of
 * the same project can benefit from past context.
 */

import { saveObservation, createMemorySession, endMemorySession } from 'ghagga-db';
import { stripPrivateData } from './privacy.js';
import type { ReviewResult, ReviewFinding, ObservationType } from '../types.js';

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Map a finding's category to an observation type.
 * This determines how the finding is stored and retrieved.
 */
function findingToObservationType(finding: ReviewFinding): ObservationType {
  switch (finding.category) {
    case 'security':
      return 'discovery';
    case 'bug':
      return 'bugfix';
    case 'performance':
      return 'pattern';
    case 'style':
    case 'maintainability':
      return 'pattern';
    case 'error-handling':
      return 'learning';
    default:
      return 'learning';
  }
}

/**
 * Check if a finding is significant enough to persist.
 * We only save high and critical findings to avoid noise.
 */
function isSignificantFinding(finding: ReviewFinding): boolean {
  return finding.severity === 'critical' || finding.severity === 'high';
}

// ─── Main Function ──────────────────────────────────────────────

/**
 * Persist notable review findings as memory observations.
 *
 * Creates a memory session for the review, extracts significant
 * findings, strips private data, and saves them via ghagga-db.
 * Gracefully handles database errors without propagating them.
 *
 * @param db - Database instance (typed as unknown for loose coupling)
 * @param project - Project identifier (e.g., "owner/repo")
 * @param prNumber - Pull request number
 * @param result - The completed review result
 */
export async function persistReviewObservations(
  db: unknown,
  project: string,
  prNumber: number,
  result: ReviewResult,
): Promise<void> {
  try {
    if (!db) return;

    const typedDb = db as Parameters<typeof saveObservation>[0];

    // Create a memory session for this review
    const session = await createMemorySession(typedDb, { project, prNumber });

    // Extract significant findings as observations
    const significantFindings = result.findings.filter(isSignificantFinding);

    for (const finding of significantFindings) {
      const sanitizedMessage = stripPrivateData(finding.message);
      const sanitizedSuggestion = finding.suggestion
        ? stripPrivateData(finding.suggestion)
        : undefined;

      const content = [
        `[${finding.severity.toUpperCase()}] ${finding.category}`,
        `File: ${finding.file}${finding.line ? `:${finding.line}` : ''}`,
        `Issue: ${sanitizedMessage}`,
        sanitizedSuggestion ? `Fix: ${sanitizedSuggestion}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      await saveObservation(typedDb, {
        sessionId: session.id,
        project,
        type: findingToObservationType(finding),
        title: `${finding.category}: ${sanitizedMessage.slice(0, 80)}`,
        content,
        filePaths: [finding.file],
      });
    }

    // Save a summary observation for the overall review
    if (significantFindings.length > 0) {
      await saveObservation(typedDb, {
        sessionId: session.id,
        project,
        type: 'decision',
        title: `PR #${prNumber} review: ${result.status}`,
        content: stripPrivateData(result.summary),
        topicKey: `pr-${prNumber}-review`,
        filePaths: significantFindings.map((f) => f.file),
      });
    }

    // End the session with a summary
    await endMemorySession(
      typedDb,
      session.id,
      `Review of PR #${prNumber}: ${result.status} with ${significantFindings.length} significant findings.`,
    );
  } catch (error) {
    // Memory persistence is optional — never let it break the pipeline
    console.warn(
      '[ghagga] Failed to persist review observations (non-fatal):',
      error instanceof Error ? error.message : String(error),
    );
  }
}
