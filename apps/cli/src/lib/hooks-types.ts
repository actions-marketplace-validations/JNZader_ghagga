/**
 * Hook-related type definitions for the GHAGGA CLI.
 *
 * Used by git-hooks utilities, hook templates, and the hooks
 * command group (install, uninstall, status).
 */

/** Marker comment identifying GHAGGA-managed hooks */
export const HOOK_MARKER = '# GHAGGA-MANAGED-HOOK — do not edit';

/** Supported git hook types */
export type HookType = 'pre-commit' | 'commit-msg';

/** Result of a hook status check */
export interface HookStatus {
  type: HookType;
  installed: boolean;
  managedByGhagga: boolean;
  path: string;
}

/** Options for hook installation */
export interface HookInstallOptions {
  force?: boolean;
}

/** Result of install/uninstall operations */
export interface HookOperationResult {
  type: HookType;
  success: boolean;
  message: string;
  /** Previous hook content if backed up */
  backedUp?: boolean;
}
