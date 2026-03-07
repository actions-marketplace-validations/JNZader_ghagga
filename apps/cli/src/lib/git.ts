/**
 * Git remote utilities for project identification.
 *
 * Resolves the project identifier from the git remote origin URL,
 * normalizing it to "owner/repo" format for memory scoping.
 */

import { execSync } from 'node:child_process';

/**
 * Resolve the project identifier from the git remote origin.
 * Normalizes various URL formats to "owner/repo".
 * Falls back to "local/unknown" if no remote is configured.
 */
export function resolveProjectId(repoPath: string): string {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: repoPath,
      encoding: 'utf-8',
    }).trim();

    return normalizeRemoteUrl(remoteUrl);
  } catch {
    return 'local/unknown';
  }
}

/**
 * Normalize a git remote URL to "owner/repo" format.
 *
 * Handles:
 *   https://github.com/owner/repo.git  → owner/repo
 *   git@github.com:owner/repo.git      → owner/repo
 *   ssh://git@github.com/owner/repo    → owner/repo
 *   https://gitlab.com/owner/repo.git  → owner/repo
 */
export function normalizeRemoteUrl(url: string): string {
  let cleaned = url;

  // Strip .git suffix
  cleaned = cleaned.replace(/\.git$/, '');

  // SSH format: git@host:owner/repo
  const sshMatch = cleaned.match(/^[\w-]+@[\w.-]+:(.+)$/);
  if (sshMatch) return sshMatch[1]!;

  // HTTPS / SSH protocol: extract path after host
  try {
    const parsed = new URL(cleaned);
    // Remove leading slash
    return parsed.pathname.replace(/^\//, '');
  } catch {
    // Not a valid URL — return as-is or fallback
    return 'local/unknown';
  }
}
