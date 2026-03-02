/**
 * Authentication middleware for the dashboard API.
 *
 * Verifies a GitHub personal access token by calling GET /user,
 * then looks up which installations the user has access to.
 */

import { createMiddleware } from 'hono/factory';
import type { Database } from 'ghagga-db';
import { getInstallationsByUserId } from 'ghagga-db';

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
      const userInstallations = await getInstallationsByUserId(db, githubUserId);
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
