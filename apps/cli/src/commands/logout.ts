/**
 * Logout command — clears stored GitHub credentials.
 */

import { clearConfig, isLoggedIn, loadConfig } from '../lib/config.js';
import * as tui from '../ui/tui.js';

export function logoutCommand(): void {
  if (!isLoggedIn()) {
    tui.log.info('ℹ️  Not currently logged in.\n');
    return;
  }

  const config = loadConfig();
  const login = config.githubLogin ?? 'unknown';

  clearConfig();

  tui.log.success(`✅ Logged out from ${login}.`);
  tui.log.info('   Stored credentials have been removed.\n');
}
