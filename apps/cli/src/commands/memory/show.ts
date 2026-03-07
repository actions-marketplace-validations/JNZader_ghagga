/**
 * `ghagga memory show` subcommand.
 *
 * Displays full details of a single observation in key-value format.
 *
 * @see R9, S13–S16
 */

import type { Command } from 'commander';
import * as tui from '../../ui/tui.js';
import { openMemoryOrExit } from './utils.js';

export function registerShowCommand(parent: Command): void {
  parent
    .command('show <id>')
    .description('Show full observation details')
    .action(async (idArg: string) => {
      const id = parseInt(idArg, 10);
      if (Number.isNaN(id)) {
        tui.log.info(`Invalid observation ID: "${idArg}". Expected a number.`);
        process.exit(1);
      }

      const { storage } = await openMemoryOrExit();
      try {
        const obs = await storage.getObservation(id);
        if (!obs) {
          tui.log.info(`Observation not found: ${id}`);
          process.exit(1);
        }

        const label = (name: string) => `${name}:`.padEnd(16);

        tui.log.message(`${label('ID')}${obs.id}`);
        tui.log.message(`${label('Type')}${obs.type}`);
        tui.log.message(`${label('Title')}${obs.title}`);
        tui.log.message(`${label('Project')}${obs.project}`);
        tui.log.message(`${label('Topic Key')}${obs.topicKey ?? '(none)'}`);
        tui.log.message(`${label('Revision Count')}${obs.revisionCount}`);
        tui.log.message(`${label('Created')}${obs.createdAt.replace('T', ' ').replace('Z', '')}`);
        tui.log.message(`${label('Updated')}${obs.updatedAt.replace('T', ' ').replace('Z', '')}`);

        const filePaths =
          obs.filePaths && obs.filePaths.length > 0 ? obs.filePaths.join(', ') : '(none)';
        tui.log.message(`${label('File Paths')}${filePaths}`);

        tui.log.message('Content:');
        const contentLines = obs.content.split('\n');
        for (const line of contentLines) {
          tui.log.message(`  ${line}`);
        }
      } finally {
        await storage.close();
      }
    });
}
