/**
 * Git hook utilities for install, uninstall, and status operations.
 *
 * Handles detection of the hooks directory (respects core.hooksPath),
 * GHAGGA marker detection, hook installation with backup, and
 * clean uninstallation with backup restoration.
 */

import { execSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  HOOK_MARKER,
  type HookOperationResult,
  type HookStatus,
  type HookType,
} from './hooks-types.js';

/** Get the git hooks directory (respects core.hooksPath config) */
export function getHooksDir(): string {
  // Try core.hooksPath first
  try {
    const hooksPath = execSync('git config core.hooksPath', { encoding: 'utf-8' }).trim();
    if (hooksPath) return hooksPath;
  } catch {
    // Not set, use default
  }

  // Default: .git/hooks
  const gitDir = execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim();
  return join(gitDir, 'hooks');
}

/** Check if we're in a git repository */
export function isGitRepo(): boolean {
  try {
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/** Get the status of a specific hook */
export function getHookStatus(hooksDir: string, hookType: HookType): HookStatus {
  const hookPath = join(hooksDir, hookType);
  const exists = existsSync(hookPath);
  let managedByGhagga = false;

  if (exists) {
    try {
      const content = readFileSync(hookPath, 'utf-8');
      managedByGhagga = content.includes(HOOK_MARKER);
    } catch {
      // Can't read, not managed
    }
  }

  return {
    type: hookType,
    installed: exists,
    managedByGhagga,
    path: hookPath,
  };
}

/** Install a hook script */
export function installHook(
  hooksDir: string,
  hookType: HookType,
  content: string,
  force: boolean,
): HookOperationResult {
  const hookPath = join(hooksDir, hookType);
  const exists = existsSync(hookPath);
  let backedUp = false;

  if (exists) {
    const existing = readFileSync(hookPath, 'utf-8');
    if (existing.includes(HOOK_MARKER)) {
      // Already GHAGGA-managed, overwrite
    } else if (!force) {
      return {
        type: hookType,
        success: false,
        message: `Hook ${hookType} already exists (not managed by GHAGGA). Use --force to overwrite.`,
      };
    } else {
      // Backup existing hook
      const backupPath = `${hookPath}.ghagga-backup`;
      renameSync(hookPath, backupPath);
      backedUp = true;
    }
  }

  writeFileSync(hookPath, content, { mode: 0o755 });
  // Also chmod explicitly for systems where writeFileSync mode doesn't work
  chmodSync(hookPath, 0o755);

  return {
    type: hookType,
    success: true,
    message: backedUp
      ? `Installed ${hookType} hook (existing hook backed up to ${hookType}.ghagga-backup)`
      : `Installed ${hookType} hook`,
    backedUp,
  };
}

/** Uninstall a hook if it's managed by GHAGGA */
export function uninstallHook(hooksDir: string, hookType: HookType): HookOperationResult {
  const hookPath = join(hooksDir, hookType);

  if (!existsSync(hookPath)) {
    return {
      type: hookType,
      success: true,
      message: `Hook ${hookType} not installed, nothing to remove`,
    };
  }

  const content = readFileSync(hookPath, 'utf-8');
  if (!content.includes(HOOK_MARKER)) {
    return {
      type: hookType,
      success: false,
      message: `Hook ${hookType} exists but is not managed by GHAGGA. Skipping.`,
    };
  }

  unlinkSync(hookPath);

  // Restore backup if exists
  const backupPath = `${hookPath}.ghagga-backup`;
  if (existsSync(backupPath)) {
    renameSync(backupPath, hookPath);
    return {
      type: hookType,
      success: true,
      message: `Removed ${hookType} hook (restored previous hook from backup)`,
    };
  }

  return {
    type: hookType,
    success: true,
    message: `Removed ${hookType} hook`,
  };
}
