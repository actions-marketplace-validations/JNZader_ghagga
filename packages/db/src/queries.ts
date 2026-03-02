import { eq, and, desc, sql, type SQL } from 'drizzle-orm';
import type { Database } from './client.js';
import {
  installations,
  repositories,
  reviews,
  memorySessions,
  memoryObservations,
  githubUserMappings,
  DEFAULT_REPO_SETTINGS,
  type RepoSettings,
} from './schema.js';
import { createHash } from 'node:crypto';

// ─── Installations ──────────────────────────────────────────────

export async function upsertInstallation(
  db: Database,
  data: {
    githubInstallationId: number;
    accountLogin: string;
    accountType: string;
  },
) {
  const existing = await db
    .select()
    .from(installations)
    .where(eq(installations.githubInstallationId, data.githubInstallationId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(installations)
      .set({
        accountLogin: data.accountLogin,
        accountType: data.accountType,
        isActive: true,
        updatedAt: new Date(),
      })
      .where(eq(installations.githubInstallationId, data.githubInstallationId));
    return existing[0]!;
  }

  const [result] = await db.insert(installations).values(data).returning();
  return result!;
}

export async function deactivateInstallation(db: Database, githubInstallationId: number) {
  await db
    .update(installations)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(installations.githubInstallationId, githubInstallationId));
}

// ─── Repositories ───────────────────────────────────────────────

export async function upsertRepository(
  db: Database,
  data: {
    githubRepoId: number;
    installationId: number;
    fullName: string;
  },
) {
  const existing = await db
    .select()
    .from(repositories)
    .where(eq(repositories.githubRepoId, data.githubRepoId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(repositories)
      .set({ fullName: data.fullName, isActive: true, updatedAt: new Date() })
      .where(eq(repositories.githubRepoId, data.githubRepoId));
    return existing[0]!;
  }

  const [result] = await db
    .insert(repositories)
    .values({ ...data, settings: DEFAULT_REPO_SETTINGS })
    .returning();
  return result!;
}

export async function getRepoByFullName(db: Database, fullName: string) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.fullName, fullName))
    .limit(1);
  return repo ?? null;
}

export async function getRepoByGithubId(db: Database, githubRepoId: number) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.githubRepoId, githubRepoId))
    .limit(1);
  return repo ?? null;
}

export async function updateRepoSettings(
  db: Database,
  repoId: number,
  updates: {
    settings?: RepoSettings;
    llmProvider?: string;
    llmModel?: string;
    reviewMode?: string;
  },
) {
  await db
    .update(repositories)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(repositories.id, repoId));
}

export async function saveRepoApiKey(db: Database, repoId: number, encryptedKey: string) {
  await db
    .update(repositories)
    .set({ encryptedApiKey: encryptedKey, updatedAt: new Date() })
    .where(eq(repositories.id, repoId));
}

export async function removeRepoApiKey(db: Database, repoId: number) {
  await db
    .update(repositories)
    .set({ encryptedApiKey: null, updatedAt: new Date() })
    .where(eq(repositories.id, repoId));
}

export async function getReposByInstallationId(db: Database, installationId: number) {
  return db
    .select()
    .from(repositories)
    .where(and(eq(repositories.installationId, installationId), eq(repositories.isActive, true)));
}

// ─── Reviews ────────────────────────────────────────────────────

export async function saveReview(
  db: Database,
  data: {
    repositoryId: number;
    prNumber: number;
    status: string;
    mode: string;
    summary?: string;
    findings?: unknown[];
    tokensUsed?: number;
    executionTimeMs?: number;
    metadata?: unknown;
  },
) {
  const [result] = await db.insert(reviews).values(data).returning();
  return result!;
}

export async function getReviewsByRepoId(
  db: Database,
  repositoryId: number,
  options: { limit?: number; offset?: number } = {},
) {
  const { limit = 50, offset = 0 } = options;
  return db
    .select()
    .from(reviews)
    .where(eq(reviews.repositoryId, repositoryId))
    .orderBy(desc(reviews.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getReviewStats(db: Database, repositoryId: number) {
  const result = await db
    .select({
      total: sql<number>`count(*)::int`,
      passed: sql<number>`count(*) filter (where ${reviews.status} = 'PASSED')::int`,
      failed: sql<number>`count(*) filter (where ${reviews.status} = 'FAILED')::int`,
      skipped: sql<number>`count(*) filter (where ${reviews.status} = 'SKIPPED')::int`,
    })
    .from(reviews)
    .where(eq(reviews.repositoryId, repositoryId));
  return result[0]!;
}

// ─── Memory: Sessions ───────────────────────────────────────────

export async function createMemorySession(
  db: Database,
  data: { project: string; prNumber?: number },
) {
  const [session] = await db.insert(memorySessions).values(data).returning();
  return session!;
}

export async function endMemorySession(db: Database, sessionId: number, summary: string) {
  await db
    .update(memorySessions)
    .set({ endedAt: new Date(), summary })
    .where(eq(memorySessions.id, sessionId));
}

export async function getSessionsByProject(
  db: Database,
  project: string,
  options: { limit?: number } = {},
) {
  const { limit = 20 } = options;
  return db
    .select()
    .from(memorySessions)
    .where(eq(memorySessions.project, project))
    .orderBy(desc(memorySessions.startedAt))
    .limit(limit);
}

// ─── Memory: Observations ───────────────────────────────────────

function computeContentHash(content: string, type: string, title: string): string {
  return createHash('sha256').update(`${type}:${title}:${content}`).digest('hex');
}

const DEDUP_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

export async function saveObservation(
  db: Database,
  data: {
    sessionId?: number;
    project: string;
    type: string;
    title: string;
    content: string;
    topicKey?: string;
    filePaths?: string[];
  },
) {
  const contentHash = computeContentHash(data.content, data.type, data.title);
  const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);

  // Deduplication: check for same content hash within rolling window
  const [existing] = await db
    .select()
    .from(memoryObservations)
    .where(
      and(
        eq(memoryObservations.contentHash, contentHash),
        eq(memoryObservations.project, data.project),
        sql`${memoryObservations.createdAt} > ${windowStart}`,
      ),
    )
    .limit(1);

  if (existing) {
    return existing; // Skip duplicate
  }

  // Topic-key upsert: update existing observation with same topic_key
  if (data.topicKey) {
    const [existingByTopic] = await db
      .select()
      .from(memoryObservations)
      .where(
        and(
          eq(memoryObservations.topicKey, data.topicKey),
          eq(memoryObservations.project, data.project),
        ),
      )
      .limit(1);

    if (existingByTopic) {
      const [updated] = await db
        .update(memoryObservations)
        .set({
          content: data.content,
          title: data.title,
          contentHash,
          filePaths: data.filePaths ?? [],
          revisionCount: sql`${memoryObservations.revisionCount} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(memoryObservations.id, existingByTopic.id))
        .returning();
      return updated!;
    }
  }

  // New observation
  const [result] = await db
    .insert(memoryObservations)
    .values({
      ...data,
      contentHash,
      filePaths: data.filePaths ?? [],
    })
    .returning();
  return result!;
}

/**
 * Full-text search observations using PostgreSQL tsvector.
 * The search_observations SQL column is maintained by a trigger.
 */
export async function searchObservations(
  db: Database,
  project: string,
  query: string,
  options: { limit?: number; type?: string } = {},
) {
  const { limit = 10, type } = options;

  // Sanitize query: wrap each word in quotes for tsquery
  const sanitizedQuery = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => `'${w.replace(/'/g, "''")}'`)
    .join(' & ');

  if (!sanitizedQuery) return [];

  const conditions: SQL[] = [
    eq(memoryObservations.project, project),
    sql`search_observations @@ to_tsquery('english', ${sanitizedQuery})`,
  ];

  if (type) {
    conditions.push(eq(memoryObservations.type, type));
  }

  return db
    .select()
    .from(memoryObservations)
    .where(and(...conditions))
    .orderBy(sql`ts_rank(search_observations, to_tsquery('english', ${sanitizedQuery})) DESC`)
    .limit(limit);
}

export async function getObservationsBySession(db: Database, sessionId: number) {
  return db
    .select()
    .from(memoryObservations)
    .where(eq(memoryObservations.sessionId, sessionId))
    .orderBy(desc(memoryObservations.createdAt));
}

// ─── User Mappings ──────────────────────────────────────────────

export async function upsertUserMapping(
  db: Database,
  data: {
    githubUserId: number;
    githubLogin: string;
    installationId: number;
  },
) {
  const existing = await db
    .select()
    .from(githubUserMappings)
    .where(eq(githubUserMappings.githubUserId, data.githubUserId))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(githubUserMappings)
      .set({ githubLogin: data.githubLogin, installationId: data.installationId })
      .where(eq(githubUserMappings.githubUserId, data.githubUserId));
    return existing[0]!;
  }

  const [result] = await db.insert(githubUserMappings).values(data).returning();
  return result!;
}

export async function getInstallationsByUserId(db: Database, githubUserId: number) {
  const mappings = await db
    .select()
    .from(githubUserMappings)
    .where(eq(githubUserMappings.githubUserId, githubUserId));

  if (mappings.length === 0) return [];

  const installationIds = mappings.map((m) => m.installationId);
  return db
    .select()
    .from(installations)
    .where(
      and(
        sql`${installations.id} = ANY(${installationIds})`,
        eq(installations.isActive, true),
      ),
    );
}
