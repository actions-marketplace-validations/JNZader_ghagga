/**
 * `ghagga hooks uninstall` subcommand.
 *
 * Removes GHAGGA-managed hooks from the current git repository.
 * Only removes hooks that contain the GHAGGA marker comment.
 * Restores backed-up hooks if they exist.
 *
 * @see Phase 3, Task 3.3
 */

import type { Command } from 'commander';
import { getHooksDir, isGitRepo, uninstallHook } from '../../lib/git-hooks.js';
import type { HookType } from '../../lib/hooks-types.js';
import * as tui from '../../ui/tui.js';

const HOOK_TYPES: HookType[] = ['pre-commit', 'commit-msg'];

export function registerUninstallCommand(parent: Command): void {
  parent
    .command('uninstall')
    .description('Remove GHAGGA-managed git hooks')
    .action(() => {
      if (!isGitRepo()) {
        tui.log.error('Not a git repository. Run this command from inside a git repo.');
        process.exit(1);
      }

      const hooksDir = getHooksDir();
      let removed = 0;

      for (const hookType of HOOK_TYPES) {
        const result = uninstallHook(hooksDir, hookType);

        if (result.success) {
          tui.log.success(result.message);
          if (result.message.includes('Removed')) {
            removed++;
          }
        } else {
          tui.log.warn(result.message);
        }
      }

      if (removed > 0) {
        tui.log.info(`\nRemoved ${removed} GHAGGA hook(s) from ${hooksDir}`);
      } else {
        tui.log.info('\nNo GHAGGA hooks were found to remove.');
      }
    });
}
