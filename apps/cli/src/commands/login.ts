/**
 * Login command — authenticates with GitHub via Device Flow.
 *
 * Opens the browser to github.com/login/device, shows the user code,
 * and polls until the user authorizes. Saves the token to config.
 */

import { loadConfig, saveConfig } from '../lib/config.js';
import {
  requestDeviceCode,
  pollForAccessToken,
  fetchGitHubUser,
} from '../lib/oauth.js';

/**
 * Try to open a URL in the default browser.
 * Fails silently if no browser is available (e.g., headless server).
 */
async function tryOpenBrowser(url: string): Promise<boolean> {
  try {
    const { exec } = await import('node:child_process');
    const { platform } = await import('node:os');

    const cmd =
      platform() === 'darwin'
        ? `open "${url}"`
        : platform() === 'win32'
          ? `start "${url}"`
          : `xdg-open "${url}"`;

    exec(cmd);
    return true;
  } catch {
    return false;
  }
}

export async function loginCommand(): Promise<void> {
  const config = loadConfig();

  // Check if already logged in
  if (config.githubToken && config.githubLogin) {
    console.log(`\u2139\ufe0f  Already logged in as ${config.githubLogin}.`);
    console.log('   Run "ghagga logout" first to switch accounts.\n');
    return;
  }

  console.log('\ud83d\udd10 Authenticating with GitHub...\n');

  try {
    // Step 1: Request device code
    const deviceCode = await requestDeviceCode();

    // Step 2: Show user code and open browser
    console.log('   \u2794 Open this URL in your browser:\n');
    console.log(`     \x1b[1m\x1b[36mhttps://github.com/login/device\x1b[0m\n`);
    console.log(`   \u2794 Enter this code:\n`);
    console.log(`     \x1b[1m\x1b[33m${deviceCode.user_code}\x1b[0m\n`);

    const opened = await tryOpenBrowser(deviceCode.verification_uri);
    if (opened) {
      console.log('   (Browser opened automatically)\n');
    }

    console.log('   Waiting for authorization...');

    // Step 3: Poll for access token
    const tokenResponse = await pollForAccessToken(
      deviceCode.device_code,
      deviceCode.interval,
      deviceCode.expires_in,
    );

    // Step 4: Fetch user profile
    const user = await fetchGitHubUser(tokenResponse.access_token);

    // Step 5: Save to config
    saveConfig({
      ...config,
      githubToken: tokenResponse.access_token,
      githubLogin: user.login,
      defaultProvider: 'github',
      defaultModel: 'gpt-4o-mini',
    });

    console.log(`\n\u2705 Logged in as \x1b[1m${user.login}\x1b[0m`);
    console.log('   Provider: github (gpt-4o-mini) — free tier');
    console.log('\n   Run "ghagga review ." to review your code!\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`\n\u274c Login failed: ${message}\n`);
    process.exit(1);
  }
}
