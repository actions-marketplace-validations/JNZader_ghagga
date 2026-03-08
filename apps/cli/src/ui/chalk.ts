/**
 * Chalk adapter — single choke point for the chalk dependency.
 *
 * Only tui.ts and theme.ts import from this module.
 * Commands NEVER import chalk directly (Design AD2).
 */

import chalk from 'chalk';
import type { FindingSeverity } from 'ghagga-core';

export { chalk };

/** Map severity level to a chalk color function. */
export const SEVERITY_COLOR_FNS: Record<FindingSeverity, (text: string) => string> = {
  critical: (t) => chalk.red(t),
  high: (t) => chalk.hex('#FFA500')(t),
  medium: (t) => chalk.yellow(t),
  low: (t) => chalk.blue(t),
  info: (t) => chalk.gray(t),
};

/**
 * Apply severity coloring to text.
 * Returns plain text for unknown levels.
 */
export function colorSeverity(text: string, level: FindingSeverity): string {
  const fn = SEVERITY_COLOR_FNS[level];
  return fn ? fn(text) : text;
}
