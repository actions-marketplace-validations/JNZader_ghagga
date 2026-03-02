import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
} from 'drizzle-orm/pg-core';

// ─── Installations ──────────────────────────────────────────────

export const installations = pgTable('installations', {
  id: serial('id').primaryKey(),
  githubInstallationId: integer('github_installation_id').unique().notNull(),
  accountLogin: varchar('account_login', { length: 255 }).notNull(),
  accountType: varchar('account_type', { length: 20 }).notNull(), // 'User' | 'Organization'
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Shared Types ───────────────────────────────────────────────

export interface RepoSettings {
  enableSemgrep: boolean;
  enableTrivy: boolean;
  enableCpd: boolean;
  enableMemory: boolean;
  customRules: string[];
  ignorePatterns: string[];
  reviewLevel: 'soft' | 'normal' | 'strict';
}

export const DEFAULT_REPO_SETTINGS: RepoSettings = {
  enableSemgrep: true,
  enableTrivy: true,
  enableCpd: true,
  enableMemory: true,
  customRules: [],
  ignorePatterns: ['*.md', '*.txt', '.gitignore', 'LICENSE', '*.lock'],
  reviewLevel: 'normal',
};

/**
 * Shape of each entry stored in the provider_chain JSONB column.
 * Encrypted API keys are stored here (one per provider entry).
 */
export interface DbProviderChainEntry {
  provider: 'anthropic' | 'openai' | 'google' | 'github';
  model: string;
  encryptedApiKey: string | null; // null for GitHub Models (uses session token)
}

// ─── Installation Settings ──────────────────────────────────────

export const installationSettings = pgTable('installation_settings', {
  id: serial('id').primaryKey(),
  installationId: integer('installation_id')
    .references(() => installations.id)
    .unique()
    .notNull(),
  providerChain: jsonb('provider_chain').$type<DbProviderChainEntry[]>().default([]).notNull(),
  aiReviewEnabled: boolean('ai_review_enabled').default(true).notNull(),
  reviewMode: varchar('review_mode', { length: 20 }).default('simple').notNull(),
  settings: jsonb('settings').$type<RepoSettings>().default(DEFAULT_REPO_SETTINGS).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ─── Repositories ───────────────────────────────────────────────

export const repositories = pgTable(
  'repositories',
  {
    id: serial('id').primaryKey(),
    githubRepoId: integer('github_repo_id').unique().notNull(),
    installationId: integer('installation_id')
      .references(() => installations.id)
      .notNull(),
    fullName: varchar('full_name', { length: 255 }).notNull(), // "owner/repo"
    isActive: boolean('is_active').default(true).notNull(),
    settings: jsonb('settings').$type<RepoSettings>().default(DEFAULT_REPO_SETTINGS).notNull(),
    reviewMode: varchar('review_mode', { length: 20 }).default('simple').notNull(),

    // ── Global settings inheritance ──
    useGlobalSettings: boolean('use_global_settings').default(true).notNull(),

    // ── Provider chain (replaces flat llm_provider/llm_model/encrypted_api_key) ──
    providerChain: jsonb('provider_chain').$type<DbProviderChainEntry[]>().default([]).notNull(),
    aiReviewEnabled: boolean('ai_review_enabled').default(true).notNull(),

    // ── Old columns (kept for rollback safety, will be dropped in a future migration) ──
    encryptedApiKey: text('encrypted_api_key'),
    llmProvider: varchar('llm_provider', { length: 50 }).default('github').notNull(),
    llmModel: varchar('llm_model', { length: 100 }),

    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_repositories_installation').on(t.installationId),
    index('idx_repositories_full_name').on(t.fullName),
  ],
);

// ─── Reviews ────────────────────────────────────────────────────

export const reviews = pgTable(
  'reviews',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .references(() => repositories.id)
      .notNull(),
    prNumber: integer('pr_number').notNull(),
    status: varchar('status', { length: 30 }).notNull(), // PASSED | FAILED | NEEDS_HUMAN_REVIEW | SKIPPED
    mode: varchar('mode', { length: 20 }).notNull(),
    summary: text('summary'),
    findings: jsonb('findings').$type<unknown[]>(),
    tokensUsed: integer('tokens_used').default(0),
    executionTimeMs: integer('execution_time_ms'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_reviews_repository').on(t.repositoryId),
    index('idx_reviews_created_at').on(t.createdAt),
  ],
);

// ─── Memory: Sessions ───────────────────────────────────────────

export const memorySessions = pgTable(
  'memory_sessions',
  {
    id: serial('id').primaryKey(),
    project: varchar('project', { length: 255 }).notNull(), // "owner/repo"
    prNumber: integer('pr_number'),
    summary: text('summary'),
    startedAt: timestamp('started_at').defaultNow().notNull(),
    endedAt: timestamp('ended_at'),
  },
  (t) => [index('idx_memory_sessions_project').on(t.project)],
);

// ─── Memory: Observations ───────────────────────────────────────
// Note: tsvector column + GIN index + update trigger are created
// via a raw SQL migration (see migrations/0001_add_tsvector.sql)

export const memoryObservations = pgTable(
  'memory_observations',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id').references(() => memorySessions.id),
    project: varchar('project', { length: 255 }).notNull(),
    type: varchar('type', { length: 30 }).notNull(), // decision | pattern | bugfix | learning | architecture | config | discovery
    title: varchar('title', { length: 500 }).notNull(),
    content: text('content').notNull(),
    topicKey: varchar('topic_key', { length: 255 }),
    filePaths: jsonb('file_paths').$type<string[]>().default([]),
    contentHash: varchar('content_hash', { length: 64 }),
    revisionCount: integer('revision_count').default(1).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (t) => [
    index('idx_observations_project').on(t.project),
    index('idx_observations_topic_key').on(t.topicKey),
    index('idx_observations_type').on(t.type),
    index('idx_observations_content_hash').on(t.contentHash),
  ],
);

// ─── GitHub User Mappings ───────────────────────────────────────

export const githubUserMappings = pgTable(
  'github_user_mappings',
  {
    id: serial('id').primaryKey(),
    githubUserId: integer('github_user_id').unique().notNull(),
    githubLogin: varchar('github_login', { length: 255 }).notNull(),
    installationId: integer('installation_id')
      .references(() => installations.id)
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => [index('idx_user_mappings_github_user').on(t.githubUserId)],
);
