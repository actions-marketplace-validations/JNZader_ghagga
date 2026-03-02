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
import { getInstallationsByUserId, getInstallationByGitHubId, upsertUserMapping } from 'ghagga-db';

// ─── Types ──────────────────────────────────────────────────────

export interface AuthUser {
  githubUserId: number;
  githubLogin: string;
  installationIds: number[];
}

interface GitHubInstallation {
  id: number;
  account: { login: string };
  app_id: number;
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
        userInstallations = await discoverAndMapInstallations(db, token, githubUserId, githubLogin);
      }

      const installationIds = userInstallations.map((inst) => inst.id);

      c.set('user', {
        githubUserId,
        githubLogin,
        installationIds,
      });
    } catch (error) {
      console.error('[ghagga] Error looking up user installations:', error);
      return c.json({ error: 'Internal server error' }, 500);
    }

    await next();
  });
}

// ─── Auto-Discovery ─────────────────────────────────────────────

/**
 * Fetch the user's accessible installations from GitHub API,
 * cross-reference with our database, and create mappings.
 *
 * Returns the installations that were matched in our database.
 */
async function discoverAndMapInstallations(
  db: Database,
  token: string,
  githubUserId: number,
  githubLogin: string,
) {
  try {
    // GitHub API: list installations accessible to the user's token
    const response = await fetch('https://api.github.com/user/installations', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      console.warn(`[ghagga] Failed to list user installations: ${response.status}`);
      return [];
    }

    const data = (await response.json()) as {
      total_count: number;
      installations: GitHubInstallation[];
    };

    console.log(`[ghagga] User ${githubLogin} has access to ${data.total_count} app installation(s)`);

    // For each GitHub installation, check if we have it in our DB
    // and create the user mapping
    const matched = [];

    for (const ghInstallation of data.installations) {
      const dbInstallation = await getInstallationByGitHubId(db, ghInstallation.id);

      if (dbInstallation) {
        console.log(`[ghagga] Mapping user ${githubLogin} → installation ${dbInstallation.id} (${dbInstallation.accountLogin})`);
        await upsertUserMapping(db, {
          githubUserId,
          githubLogin,
          installationId: dbInstallation.id,
        });
        matched.push(dbInstallation);
      }
    }

    return matched;
  } catch (error) {
    console.error('[ghagga] Error discovering installations:', error);
    return [];
  }
}
