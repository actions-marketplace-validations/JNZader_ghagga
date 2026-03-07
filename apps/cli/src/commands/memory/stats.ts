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
import * as tui from '../../ui/tui.js';

export function registerStatsCommand(parent: Command): void {
  parent
    .command('stats')
    .description('Show memory database statistics')
    .action(async () => {
      const { storage, dbPath } = await openMemoryOrExit();
      try {
        const stats = await storage.getStats();
        const fileSize = statSync(dbPath).size;

        tui.log.info('Memory Database Statistics');
        tui.log.message('\u2500'.repeat(26));
        tui.log.message('');
        tui.log.message(`Database:     ${dbPath}`);
        tui.log.message(`File Size:    ${formatSize(fileSize)}`);
        tui.log.message(`Observations: ${stats.totalObservations} total`);
        tui.log.message('');

        const oldest = stats.oldestObservation
          ? stats.oldestObservation.slice(0, 10)
          : '(none)';
        const newest = stats.newestObservation
          ? stats.newestObservation.slice(0, 10)
          : '(none)';
        tui.log.message(`Date Range:   ${oldest} \u2014 ${newest}`);
        tui.log.message('');

        tui.log.message('By Type:');
        const typeEntries = Object.entries(stats.byType);
        if (typeEntries.length === 0) {
          tui.log.message('  (none)');
        } else {
          for (const [type, count] of typeEntries) {
            tui.log.message(`  ${type.padEnd(14)}${count}`);
          }
        }
        tui.log.message('');

        tui.log.message('By Project:');
        const projectEntries = Object.entries(stats.byProject);
        if (projectEntries.length === 0) {
          tui.log.message('  (none)');
        } else {
          for (const [project, count] of projectEntries) {
            tui.log.message(`  ${project.padEnd(14)}${count}`);
          }
        }
      } finally {
        await storage.close();
      }
    });
}
