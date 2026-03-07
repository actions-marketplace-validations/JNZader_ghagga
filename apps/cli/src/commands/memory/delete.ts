/**
 * `ghagga memory delete` subcommand.
 *
 * Deletes a single observation by ID with confirmation prompt.
 * Supports --force to skip confirmation for non-interactive use.
 *
 * @see R10, S17–S24, S48
 */

import { Command } from 'commander';
import { openMemoryOrExit, confirmOrExit } from './utils.js';

export function registerDeleteCommand(parent: Command): void {
  parent
    .command('delete <id>')
    .description('Delete a single observation')
    .option('--force', 'Skip confirmation prompt')
    .action(async (idArg: string, opts: { force?: boolean }) => {
      const id = parseInt(idArg, 10);
      if (isNaN(id)) {
        console.log(`Invalid observation ID: "${idArg}". Expected a number.`);
        process.exit(1);
      }

      const { storage } = await openMemoryOrExit();
      try {
        const obs = await storage.getObservation(id);
        if (!obs) {
          console.log(`Observation not found: ${id}`);
          process.exit(1);
        }

        await confirmOrExit(
          `Delete observation ${id} "${obs.title}"? (y/N) `,
          opts.force ?? false,
        );

        await storage.deleteObservation(id);
        console.log(`Deleted observation ${id}.`);
      } finally {
        await storage.close();
      }
    });
}
