/**
 * Authentication middleware for the dashboard API.
 *
 * Verifies a GitHub personal access token by calling GET /user,
 * then looks up which installations the user has access to.
 * On first login, auto-discovers installations via the GitHub API
 * and creates the user-installation mappings in the database.
 */

import { createMiddleware } from 'hono/factory';
import type { Database } from 'ghagga-db';
import { getInstallationsByUserId, getInstallationsByAccountLogin, upsertUserMapping } from 'ghagga-db';

// ─── Types ──────────────────────────────────────────────────────

export interface AuthUser {
  githubUserId: number;
  githubLogin: string;
  installationIds: number[];
}

// Augment Hono's context variable map so c.get('user') is typed
declare module 'hono' {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

// ─── Middleware ──────────────────────────────────────────────────

/**
 * Create the auth middleware.
 * Requires a database instance for looking up user-installation mappings.
 */
export function authMiddleware(db: Database) {
  return createMiddleware(async (c, next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader.slice('Bearer '.length);

    if (!token) {
      return c.json({ error: 'Missing token' }, 401);
    }

    // Verify token by calling GitHub API
    let githubUserId: number;
    let githubLogin: string;

    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });

      if (!response.ok) {
        return c.json({ error: 'Invalid or expired token' }, 401);
      }

      const userData = (await response.json()) as {
        id: number;
        login: string;
      };

      githubUserId = userData.id;
      githubLogin = userData.login;
    } catch {
      return c.json({ error: 'Failed to verify token' }, 401);
    }

    // Look up which installations the user has access to
    try {
      let userInstallations = await getInstallationsByUserId(db, githubUserId);

      // If no mappings exist, auto-discover from GitHub API and create them
      if (userInstallations.length === 0) {
        console.log(`[ghagga] No mappings for user ${githubLogin} (${githubUserId}), auto-discovering installations...`);
        userInstallations = await discoverAndMapInstallations(db, githubUserId, githubLogin);
      }

      const installationIds = userInstallations.map((inst) => inst.id);

      c.set('user', {
        githubUserId,
        githubLogin,
        installationIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[ghagga] Error looking up user installations:', message, error);
      return c.json({ error: 'Internal server error', detail: message }, 500);
    }

    await next();
  });
}

// ─── Auto-Discovery ─────────────────────────────────────────────

/**
 * Find installations in our DB whose account_login matches the
 * user's GitHub login, and create the user-installation mappings.
 *
 * This is simpler and more reliable than calling the GitHub API
 * (which requires specific token scopes). Since we already have
 * the installation data from webhook events, we just match by login.
 */
async function discoverAndMapInstallations(
  db: Database,
  githubUserId: number,
  githubLogin: string,
) {
  try {
    const matchedInstallations = await getInstallationsByAccountLogin(db, githubLogin);

    if (matchedInstallations.length === 0) {
      console.log(`[ghagga] No installations found for account ${githubLogin}`);
      return [];
    }

    for (const installation of matchedInstallations) {
      console.log(`[ghagga] Mapping user ${githubLogin} → installation ${installation.id} (${installation.accountLogin})`);
      await upsertUserMapping(db, {
        githubUserId,
        githubLogin,
        installationId: installation.id,
      });
    }

    return matchedInstallations;
  } catch (error) {
    console.error('[ghagga] Error discovering installations:', error);
    return [];
  }
}
