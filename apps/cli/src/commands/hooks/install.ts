/**
 * `ghagga hooks install` subcommand.
 *
 * Installs GHAGGA-managed pre-commit and/or commit-msg hooks into the
 * current git repository. Handles backup of existing non-GHAGGA hooks,
 * idempotent reinstall of GHAGGA hooks, and the --force flag for
 * overwriting external hooks.
 *
 * @see Phase 3, Task 3.2
 */

import { Command } from 'commander';
import { isGitRepo, getHooksDir, installHook } from '../../lib/git-hooks.js';
import { generatePreCommitHook, generateCommitMsgHook } from '../../lib/hook-templates.js';
import type { HookType } from '../../lib/hooks-types.js';
import * as tui from '../../ui/tui.js';

interface InstallOptions {
  force?: boolean;
  preCommit?: boolean;
  commitMsg?: boolean;
}

export function registerInstallCommand(parent: Command): void {
  parent
    .command('install')
    .description('Install git hooks for automated code review')
    .option('--force', 'Overwrite existing non-GHAGGA hooks (with backup)')
    .option('--pre-commit', 'Install only the pre-commit hook')
    .option('--commit-msg', 'Install only the commit-msg hook')
    .action((opts: InstallOptions) => {
      if (!isGitRepo()) {
        tui.log.error('Not a git repository. Run this command from inside a git repo.');
        process.exit(1);
      }

      const hooksDir = getHooksDir();
      const force = opts.force ?? false;

      // Determine which hooks to install.
      // If neither flag is set, install both. If one or both are set, install only those.
      const installPreCommit = opts.preCommit || (!opts.preCommit && !opts.commitMsg);
      const installCommitMsg = opts.commitMsg || (!opts.preCommit && !opts.commitMsg);

      const hooks: Array<{ type: HookType; content: string }> = [];

      if (installPreCommit) {
        hooks.push({
          type: 'pre-commit',
          content: generatePreCommitHook(),
        });
      }

      if (installCommitMsg) {
        hooks.push({
          type: 'commit-msg',
          content: generateCommitMsgHook(),
        });
      }

      let installed = 0;

      for (const hook of hooks) {
        const result = installHook(hooksDir, hook.type, hook.content, force);

        if (result.success) {
          tui.log.success(result.message);
          installed++;
        } else {
          tui.log.error(result.message);
        }
      }

      if (installed > 0) {
        tui.log.info(`\nInstalled ${installed} hook(s) to ${hooksDir}`);
      } else {
        tui.log.warn('No hooks were installed.');
      }
    });
}
