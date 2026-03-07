/**
 * `ghagga memory clear` subcommand.
 *
 * Deletes all observations (or scoped to a repository) with
 * confirmation prompt. Supports --force for non-interactive use.
 *
 * @see R12, S28–S35, S49
 */

import type { Command } from 'commander';
import * as tui from '../../ui/tui.js';
import { confirmOrExit, openMemoryOrExit } from './utils.js';

export function registerClearCommand(parent: Command): void {
  parent
    .command('clear')
    .description('Clear all observations')
    .option('--repo <owner/repo>', 'Scope deletion to a single repository')
    .option('--force', 'Skip confirmation prompt')
    .action(async (opts: { repo?: string; force?: boolean }) => {
      const { storage } = await openMemoryOrExit();
      try {
        const stats = await storage.getStats();
        const total = opts.repo
          ? (
              await storage.listObservations({
                project: opts.repo,
                limit: 100_000,
              })
            ).length
          : stats.totalObservations;

        if (total === 0) {
          tui.log.info('No observations to clear.');
          return;
        }

        const message = opts.repo
          ? `Clear ${total} observations for ${opts.repo}? (y/N) `
          : `Clear all ${total} observations? (y/N) `;

        await confirmOrExit(message, opts.force ?? false);

        const deleted = await storage.clearObservations({
          project: opts.repo,
        });
        tui.log.success(`Cleared ${deleted} observations.`);
      } finally {
        await storage.close();
      }
    });
}
