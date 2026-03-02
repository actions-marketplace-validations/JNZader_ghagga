/**
 * Memory search — retrieves relevant past observations for prompt injection.
 *
 * Builds a search query from the file paths in the current diff,
 * then uses PostgreSQL full-text search (via ghagga-db) to find
 * observations from past reviews of the same project.
 */

import { searchObservations } from 'ghagga-db';
import { formatMemoryContext } from './context.js';

// ─── Types ──────────────────────────────────────────────────────

/** Observation shape returned from the database */
interface Observation {
  type: string;
  title: string;
  content: string;
  filePaths: string[] | null;
}

// ─── Helpers ────────────────────────────────────────────────────

/**
 * Build a search query from file paths.
 *
 * Extracts meaningful segments from file paths (directory names,
 * file names without extensions) to use as search terms.
 *
 * @example
 *   ["src/auth/login.ts", "lib/db/pool.ts"]
 *   → "auth login db pool"
 */
function buildSearchQuery(fileList: string[]): string {
  const terms = new Set<string>();

  for (const filePath of fileList) {
    // Split path into segments
    const segments = filePath.split('/').filter(Boolean);

    for (const segment of segments) {
      // Skip common uninformative directories
      if (['src', 'lib', 'dist', 'build', 'node_modules', 'test', 'tests'].includes(segment)) {
        continue;
      }

      // Remove file extension and add as a search term
      const name = segment.replace(/\.[^.]+$/, '');
      if (name.length > 2) {
        terms.add(name);
      }
    }
  }

  return [...terms].slice(0, 10).join(' ');
}

// ─── Main Function ──────────────────────────────────────────────

/**
 * Search past review observations for context relevant to the current diff.
 *
 * Returns a formatted string suitable for injection into agent prompts,
 * or null if no relevant observations are found (or if db is unavailable).
 *
 * @param db - Database instance (from ghagga-db). Typed as unknown for loose coupling.
 * @param project - Project identifier (e.g., "owner/repo")
 * @param fileList - List of file paths in the current diff
 * @returns Formatted memory context string, or null
 */
export async function searchMemoryForContext(
  db: unknown,
  project: string,
  fileList: string[],
): Promise<string | null> {
  try {
    if (!db) return null;

    const query = buildSearchQuery(fileList);
    if (!query) return null;

    // Search with a reasonable limit — we don't want to flood the prompt
    const observations = await searchObservations(
      db as Parameters<typeof searchObservations>[0],
      project,
      query,
      { limit: 8 },
    );

    if (!observations || observations.length === 0) return null;

    // Format observations for prompt injection
    return formatMemoryContext(
      observations.map((obs: Observation) => ({
        type: obs.type,
        title: obs.title,
        content: obs.content,
      })),
    );
  } catch (error) {
    // Memory is optional — never let it break the review pipeline
    console.warn(
      '[ghagga] Memory search failed (degrading gracefully):',
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
