/**
 * Hooks command group barrel.
 *
 * Registers the `ghagga hooks` subcommands (install, uninstall, status)
 * and exports the parent Command for registration in the CLI entry point.
 */

import { Command } from 'commander';
import { registerInstallCommand } from './install.js';
import { registerStatusCommand } from './status.js';
import { registerUninstallCommand } from './uninstall.js';

export const hooksCommand = new Command('hooks').description(
  'Manage git hooks for automated code review',
);

registerInstallCommand(hooksCommand);
registerUninstallCommand(hooksCommand);
registerStatusCommand(hooksCommand);
