/**
 * `ghagga memory list` subcommand.
 *
 * Lists stored observations in a plain-text table with optional
 * filtering by repository, type, and result limit.
 *
 * @see R7, S1–S7
 */

import type { Command } from 'commander';
import * as tui from '../../ui/tui.js';
import { formatId, formatTable, openMemoryOrExit, truncate } from './utils.js';

export function registerListCommand(parent: Command): void {
  parent
    .command('list')
    .description('List stored observations')
    .option('--repo <owner/repo>', 'Filter by repository')
    .option('--type <type>', 'Filter by observation type')
    .option('--limit <n>', 'Maximum rows to display', '20')
    .action(async (opts: { repo?: string; type?: string; limit: string }) => {
      const limit = parseInt(opts.limit, 10);

      const { storage } = await openMemoryOrExit();
      try {
        const observations = await storage.listObservations({
          project: opts.repo,
          type: opts.type,
          limit,
        });

        if (observations.length === 0) {
          tui.log.info('No observations found.');
          return;
        }

        const headers = ['ID', 'Type', 'Title', 'Repo', 'Date'];
        const widths = [10, 12, 42, 18, 12];

        const rows = observations.map((obs) => [
          formatId(obs.id),
          truncate(obs.type, 10),
          truncate(obs.title, 40),
          truncate(obs.project, 16),
          obs.createdAt.slice(0, 10),
        ]);

        tui.log.message(formatTable(headers, rows, widths));
      } finally {
        await storage.close();
      }
    });
}
