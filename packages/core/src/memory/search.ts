/**
 * Memory search — retrieves relevant past observations for prompt injection.
 *
 * Builds a search query from the file paths in the current diff,
 * then uses the MemoryStorage interface to find observations from
 * past reviews of the same project.
 */

import { formatMemoryContext } from './context.js';
import type { MemoryStorage } from '../types.js';

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
 * or null if no relevant observations are found (or if storage is unavailable).
 *
 * @param storage - Memory storage backend (SQLite or PostgreSQL)
 * @param project - Project identifier (e.g., "owner/repo")
 * @param fileList - List of file paths in the current diff
 * @returns Formatted memory context string, or null
 */
export async function searchMemoryForContext(
  storage: MemoryStorage,
  project: string,
  fileList: string[],
): Promise<string | null> {
  try {
    if (!storage) return null;

    const query = buildSearchQuery(fileList);
    if (!query) return null;

    // Search with a reasonable limit — we don't want to flood the prompt
    const observations = await storage.searchObservations(
      project,
      query,
      { limit: 3 },
    );

    if (!observations || observations.length === 0) return null;

    // Format observations for prompt injection
    return formatMemoryContext(
      observations.map((obs) => ({
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
