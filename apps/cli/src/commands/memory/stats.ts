/**
 * `ghagga memory stats` subcommand.
 *
 * Displays aggregate statistics about the memory database including
 * observation counts by type and project, file size, and date range.
 *
 * @see R11, S25–S27
 */

import { statSync } from 'node:fs';
import { Command } from 'commander';
import { openMemoryOrExit, formatSize } from './utils.js';

export function registerStatsCommand(parent: Command): void {
  parent
    .command('stats')
    .description('Show memory database statistics')
    .action(async () => {
      const { storage, dbPath } = await openMemoryOrExit();
      try {
        const stats = await storage.getStats();
        const fileSize = statSync(dbPath).size;

        console.log('Memory Database Statistics');
        console.log('\u2500'.repeat(26));
        console.log('');
        console.log(`Database:     ${dbPath}`);
        console.log(`File Size:    ${formatSize(fileSize)}`);
        console.log(`Observations: ${stats.totalObservations} total`);
        console.log('');

        const oldest = stats.oldestObservation
          ? stats.oldestObservation.slice(0, 10)
          : '(none)';
        const newest = stats.newestObservation
          ? stats.newestObservation.slice(0, 10)
          : '(none)';
        console.log(`Date Range:   ${oldest} \u2014 ${newest}`);
        console.log('');

        console.log('By Type:');
        const typeEntries = Object.entries(stats.byType);
        if (typeEntries.length === 0) {
          console.log('  (none)');
        } else {
          for (const [type, count] of typeEntries) {
            console.log(`  ${type.padEnd(14)}${count}`);
          }
        }
        console.log('');

        console.log('By Project:');
        const projectEntries = Object.entries(stats.byProject);
        if (projectEntries.length === 0) {
          console.log('  (none)');
        } else {
          for (const [project, count] of projectEntries) {
            console.log(`  ${project.padEnd(14)}${count}`);
          }
        }
      } finally {
        await storage.close();
      }
    });
}
