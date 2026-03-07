/**
 * Status command — shows current authentication and configuration.
 */

import { loadConfig, getConfigFilePath, isLoggedIn } from '../lib/config.js';
import { fetchGitHubUser } from '../lib/oauth.js';
import * as tui from '../ui/tui.js';

export async function statusCommand(): Promise<void> {
  const config = loadConfig();
  const configPath = getConfigFilePath();

  tui.intro('🤖 GHAGGA Status');
  tui.log.message(`   Config: ${configPath}`);

  if (!isLoggedIn()) {
    tui.log.info('   Auth:   Not logged in');
    tui.log.info('\n   Run "ghagga login" to authenticate with GitHub.\n');
    return;
  }

  tui.log.message(`   Auth:   Logged in as ${config.githubLogin ?? 'unknown'}`);
  tui.log.message(`   Provider: ${config.defaultProvider ?? 'github'}`);
  tui.log.message(`   Model:    ${config.defaultModel ?? 'gpt-4o-mini'}`);

  // Validate the stored credential is still valid
  if (config.githubToken) {
    try {
      const user = await fetchGitHubUser(config.githubToken);
      tui.log.success(`   Session: Valid (${user.login})`);
    } catch {
      tui.log.warn('   Session: Expired or invalid');
      tui.log.info('\n   Run "ghagga login" to re-authenticate.\n');
      return;
    }
  }

  tui.outro('Done');
}
