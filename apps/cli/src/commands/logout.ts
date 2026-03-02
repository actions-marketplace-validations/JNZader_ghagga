/**
 * Logout command — clears stored GitHub credentials.
 */

import { clearConfig, isLoggedIn, loadConfig } from '../lib/config.js';

export function logoutCommand(): void {
  if (!isLoggedIn()) {
    console.log('\u2139\ufe0f  Not currently logged in.\n');
    return;
  }

  const config = loadConfig();
  const login = config.githubLogin ?? 'unknown';

  clearConfig();

  console.log(`\u2705 Logged out from ${login}.`);
  console.log('   Stored credentials have been removed.\n');
}
