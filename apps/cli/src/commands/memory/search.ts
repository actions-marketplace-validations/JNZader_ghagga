/**
 * `ghagga memory search` subcommand.
 *
 * Searches observations by content using FTS5/BM25 full-text search.
 * If --repo is not specified, infers the project from the current
 * git remote via resolveProjectId.
 *
 * @see R8, S8–S12
 */

import { Command } from 'commander';
import { openMemoryOrExit, formatId, truncate } from './utils.js';
import { resolveProjectId } from '../../lib/git.js';

export function registerSearchCommand(parent: Command): void {
  parent
    .command('search <query>')
    .description('Search observations by content')
    .option('--repo <owner/repo>', 'Scope search to a specific repository')
    .option('--limit <n>', 'Maximum results', '10')
    .action(
      async (
        query: string,
        opts: { repo?: string; limit: string },
      ) => {
        const limit = parseInt(opts.limit, 10);
        const project = opts.repo ?? resolveProjectId(process.cwd());

        const { storage } = await openMemoryOrExit();
        try {
          const results = await storage.searchObservations(project, query, {
            limit,
          });

          if (results.length === 0) {
            console.log('No matching observations found.');
            return;
          }

          console.log(`Found ${results.length} results for "${query}" in ${project}:`);
          console.log('');

          results.forEach((obs, index) => {
            console.log(`  ${index + 1}. [${obs.type}] ${obs.title}`);
            console.log(
              `     ${formatId(obs.id)} | ${truncate(obs.content, 80)}`,
            );
            console.log('');
          });
        } finally {
          await storage.close();
        }
      },
    );
}
