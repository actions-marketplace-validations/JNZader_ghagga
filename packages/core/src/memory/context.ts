/**
 * Format memory observations for prompt injection.
 *
 * Takes raw observation objects from the database and formats them
 * into a human-readable context block that can be appended to
 * agent system prompts.
 */

// ─── Types ──────────────────────────────────────────────────────

export interface ObservationForContext {
  type: string;
  title: string;
  content: string;
}

// ─── Main Function ──────────────────────────────────────────────

/**
 * Format an array of memory observations into a prompt-ready string.
 *
 * The output is structured with headers and bullet points so the LLM
 * can easily parse and reference past knowledge during its review.
 *
 * @param observations - Array of observation objects with type, title, and content
 * @returns Formatted string for prompt injection, or empty string if no observations
 */
export function formatMemoryContext(observations: ObservationForContext[]): string {
  if (observations.length === 0) return '';

  const lines: string[] = [
    '## Past Review Memory',
    '',
    'The following observations were learned from previous reviews of this project:',
    '',
  ];

  for (const obs of observations) {
    lines.push(`### [${obs.type.toUpperCase()}] ${obs.title}`);
    lines.push('');
    lines.push(obs.content);
    lines.push('');
  }

  lines.push(
    '> Use these past observations to give more informed, context-aware reviews.',
    '> Do not repeat findings that match these known patterns unless the issue persists.',
  );

  return lines.join('\n');
}
