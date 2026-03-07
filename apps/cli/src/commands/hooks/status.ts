/**
 * `ghagga hooks status` subcommand.
 *
 * Shows the status of pre-commit and commit-msg hooks in the
 * current git repository: not installed, installed (GHAGGA-managed),
 * or installed (external).
 *
 * @see Phase 3, Task 3.4
 */

import { Command } from 'commander';
import { isGitRepo, getHooksDir, getHookStatus } from '../../lib/git-hooks.js';
import type { HookType } from '../../lib/hooks-types.js';
import * as tui from '../../ui/tui.js';

const HOOK_TYPES: HookType[] = ['pre-commit', 'commit-msg'];

export function registerStatusCommand(parent: Command): void {
  parent
    .command('status')
    .description('Show status of git hooks')
    .action(() => {
      if (!isGitRepo()) {
        tui.log.error('Not a git repository. Run this command from inside a git repo.');
        process.exit(1);
      }

      const hooksDir = getHooksDir();

      tui.log.info(`Hooks directory: ${hooksDir}\n`);

      for (const hookType of HOOK_TYPES) {
        const status = getHookStatus(hooksDir, hookType);

        if (!status.installed) {
          tui.log.info(`  ${hookType}: not installed`);
        } else if (status.managedByGhagga) {
          tui.log.success(`  ${hookType}: installed (GHAGGA-managed)`);
        } else {
          tui.log.warn(`  ${hookType}: installed (external — not managed by GHAGGA)`);
        }
      }
    });
}
