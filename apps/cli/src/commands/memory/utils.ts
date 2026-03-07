/**
 * Shared utilities for the `ghagga memory` command group.
 *
 * Provides database lifecycle management, confirmation prompts,
 * and plain-text formatting helpers used by all subcommands.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { SqliteMemoryStorage } from 'ghagga-core';
import { getConfigDir } from '../../lib/config.js';

// ─── Database Lifecycle ─────────────────────────────────────────

const NO_DB_MESSAGE =
  'No memory database found. Run "ghagga review" first to build memory.';

/**
 * Resolve the DB path, check existence, and open storage.
 * Prints a message and exits 0 if the DB file doesn't exist.
 * Returns the storage instance and resolved dbPath.
 */
export async function openMemoryOrExit(): Promise<{
  storage: SqliteMemoryStorage;
  dbPath: string;
}> {
  const configDir = getConfigDir();
  const dbPath = join(configDir, 'memory.db');

  if (!existsSync(dbPath)) {
    console.log(NO_DB_MESSAGE);
    process.exit(0);
  }

  const storage = await SqliteMemoryStorage.create(dbPath);
  return { storage, dbPath };
}

// ─── Confirmation ───────────────────────────────────────────────

/**
 * Handle confirmation flow for destructive operations.
 *
 * - force=true: returns immediately (no prompt)
 * - Non-TTY without force: prints error, exits 1
 * - TTY without force: prompts, exits 0 on cancel
 */
export async function confirmOrExit(
  message: string,
  force: boolean,
): Promise<void> {
  if (force) return;

  if (!process.stdin.isTTY) {
    console.error(
      'Error: Destructive operation requires --force in non-interactive mode.',
    );
    process.exit(1);
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(message);
    if (answer.trim().toLowerCase() !== 'y') {
      console.log('Cancelled.');
      process.exit(0);
    }
  } finally {
    rl.close();
  }
}

// ─── Formatting Helpers ─────────────────────────────────────────

/**
 * Format a plain-text table with headers, separator, and padded columns.
 * No ANSI colors — plain text only (CC3).
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  widths: number[],
): string {
  const lines: string[] = [];

  // Header row
  lines.push(headers.map((h, i) => h.padEnd(widths[i]!)).join('  '));

  // Separator row
  lines.push(widths.map((w) => '\u2500'.repeat(w)).join('  '));

  // Data rows
  for (const row of rows) {
    lines.push(row.map((cell, i) => cell.padEnd(widths[i]!)).join('  '));
  }

  return lines.join('\n');
}

/**
 * Format bytes as human-readable size (AD8).
 * < 1024: "N bytes", < 1MB: "N.N KB", else "N.N MB"
 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format observation ID as 8-char zero-padded string (AD5, CC5).
 * ID 42 -> "00000042"
 */
export function formatId(id: number): string {
  return String(id).padStart(8, '0');
}

/**
 * Truncate a string to maxLen characters, appending "..." if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
