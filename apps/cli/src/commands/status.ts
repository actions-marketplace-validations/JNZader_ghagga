/**
 * Status command — shows current authentication and configuration.
 */

import { loadConfig, getConfigFilePath, isLoggedIn } from '../lib/config.js';
import { fetchGitHubUser } from '../lib/oauth.js';

export async function statusCommand(): Promise<void> {
  const config = loadConfig();
  const configPath = getConfigFilePath();

  console.log('\ud83e\udd16 GHAGGA Status\n');
  console.log(`   Config: ${configPath}`);

  if (!isLoggedIn()) {
    console.log('   Auth:   \x1b[31mNot logged in\x1b[0m');
    console.log('\n   Run "ghagga login" to authenticate with GitHub.\n');
    return;
  }

  console.log(`   Auth:   \x1b[32mLogged in\x1b[0m as \x1b[1m${config.githubLogin ?? 'unknown'}\x1b[0m`);
  console.log(`   Provider: ${config.defaultProvider ?? 'github'}`);
  console.log(`   Model:    ${config.defaultModel ?? 'gpt-4o-mini'}`);

  // Validate the token is still valid
  if (config.githubToken) {
    try {
      const user = await fetchGitHubUser(config.githubToken);
      console.log(`   Token:   \x1b[32mValid\x1b[0m (${user.login})`);
    } catch {
      console.log(`   Token:   \x1b[31mExpired or invalid\x1b[0m`);
      console.log('\n   Run "ghagga login" to re-authenticate.\n');
      return;
    }
  }

  console.log('');
}
