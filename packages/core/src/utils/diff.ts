/**
 * Unified diff parsing utilities.
 *
 * Provides functions to extract structured file information from unified
 * diffs, filter out ignored files (e.g., lockfiles, docs), and truncate
 * large diffs to fit within LLM token budgets.
 */

import { minimatch } from 'minimatch';

// ─── Types ──────────────────────────────────────────────────────

/** Represents a single file extracted from a unified diff. */
export interface DiffFile {
  /** File path relative to the repository root */
  path: string;

  /** Number of added lines */
  additions: number;

  /** Number of deleted lines */
  deletions: number;

  /** Raw diff content for this file (including headers and hunks) */
  content: string;
}

// ─── Constants ──────────────────────────────────────────────────

/**
 * Regex to match the start of a file diff block.
 * Handles both `a/path` and `b/path` formats from git diff.
 */
const FILE_HEADER_RE = /^diff --git a\/.+ b\/(.+)$/;

// ─── Core Functions ─────────────────────────────────────────────

/**
 * Parse a unified diff string into structured file objects.
 *
 * Splits the diff by file boundaries (diff --git lines), extracts
 * file paths, and counts additions/deletions per file.
 *
 * @param diff - Full unified diff string
 * @returns Array of DiffFile objects
 */
export function parseDiffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diff.split('\n');

  let currentFile: DiffFile | null = null;
  const contentLines: string[] = [];

  function flushCurrent() {
    if (currentFile) {
      currentFile.content = contentLines.join('\n');
      files.push(currentFile);
      contentLines.length = 0;
    }
  }

  for (const line of lines) {
    const match = FILE_HEADER_RE.exec(line);
    if (match) {
      // Start of a new file — flush previous
      flushCurrent();
      currentFile = {
        path: match[1] ?? '',
        additions: 0,
        deletions: 0,
        content: '',
      };
      contentLines.push(line);
    } else if (currentFile) {
      contentLines.push(line);

      // Count additions and deletions (skip hunk headers and --- / +++ lines)
      if (line.startsWith('+') && !line.startsWith('+++')) {
        currentFile.additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        currentFile.deletions++;
      }
    }
  }

  // Flush last file
  flushCurrent();

  return files;
}

/**
 * Filter out files matching ignore patterns (e.g., lockfiles, docs).
 *
 * Uses minimatch for glob pattern matching, consistent with .gitignore style.
 *
 * @param files - Array of DiffFile objects to filter
 * @param patterns - Glob patterns to exclude (e.g., ["*.md", "*.lock"])
 * @returns Filtered array with ignored files removed
 */
export function filterIgnoredFiles(files: DiffFile[], patterns: string[]): DiffFile[] {
  if (patterns.length === 0) return files;

  return files.filter((file) => {
    // Keep the file if it does NOT match any ignore pattern
    return !patterns.some((pattern) => minimatch(file.path, pattern, { dot: true }));
  });
}

/**
 * Truncate a diff string to fit within a token budget.
 *
 * Uses a rough approximation of 1 token ≈ 4 characters, which is
 * a reasonable middle ground across different LLM tokenizers.
 *
 * @param diff - The diff string to truncate
 * @param maxTokens - Maximum number of tokens allowed
 * @returns Object with the (possibly truncated) diff and a flag indicating truncation
 */
export function truncateDiff(
  diff: string,
  maxTokens: number,
): { truncated: string; wasTruncated: boolean } {
  const maxChars = maxTokens * 4;

  if (diff.length <= maxChars) {
    return { truncated: diff, wasTruncated: false };
  }

  // Truncate at the character limit, then trim to the last complete line
  const cutoff = diff.lastIndexOf('\n', maxChars);
  const truncated =
    (cutoff > 0 ? diff.slice(0, cutoff) : diff.slice(0, maxChars)) +
    '\n\n[... diff truncated to fit token budget ...]';

  return { truncated, wasTruncated: true };
}
