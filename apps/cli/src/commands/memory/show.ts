/**
 * `ghagga memory show` subcommand.
 *
 * Displays full details of a single observation in key-value format.
 *
 * @see R9, S13–S16
 */

import { Command } from 'commander';
import { openMemoryOrExit } from './utils.js';

export function registerShowCommand(parent: Command): void {
  parent
    .command('show <id>')
    .description('Show full observation details')
    .action(async (idArg: string) => {
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

        const label = (name: string) => `${name}:`.padEnd(16);

        console.log(`${label('ID')}${obs.id}`);
        console.log(`${label('Type')}${obs.type}`);
        console.log(`${label('Title')}${obs.title}`);
        console.log(`${label('Project')}${obs.project}`);
        console.log(
          `${label('Topic Key')}${obs.topicKey ?? '(none)'}`,
        );
        console.log(`${label('Revision Count')}${obs.revisionCount}`);
        console.log(
          `${label('Created')}${obs.createdAt.replace('T', ' ').replace('Z', '')}`,
        );
        console.log(
          `${label('Updated')}${obs.updatedAt.replace('T', ' ').replace('Z', '')}`,
        );

        const filePaths =
          obs.filePaths && obs.filePaths.length > 0
            ? obs.filePaths.join(', ')
            : '(none)';
        console.log(`${label('File Paths')}${filePaths}`);

        console.log('Content:');
        const contentLines = obs.content.split('\n');
        for (const line of contentLines) {
          console.log(`  ${line}`);
        }
      } finally {
        await storage.close();
      }
    });
}
