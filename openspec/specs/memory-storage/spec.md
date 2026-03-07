# Spec: Memory Storage

> **Domain**: Memory  
> **Change**: `sqlite-memory`  
> **Type**: FULL (new domain — no prior main spec)  
> **Status**: Draft  

## Overview

This specification defines a storage-agnostic memory subsystem for GHAGGA. Memory enables progressive review intelligence by persisting observations from past reviews and injecting relevant context into future reviews. Today memory only works in SaaS mode (PostgreSQL via `ghagga-db`). This spec introduces an abstract `MemoryStorage` interface with two implementations — SQLite (via sql.js) for CLI and Action, and PostgreSQL for SaaS — and decouples `packages/core` from `ghagga-db` entirely.

---

## Requirements

### R1: MemoryStorage Interface

The system MUST define a `MemoryStorage` interface in `packages/core/src/types.ts` with the following method signatures:

```typescript
export interface MemoryStorage {
  searchObservations(
    project: string,
    query: string,
    options?: { limit?: number; type?: string },
  ): Promise<MemoryObservationRow[]>;

  saveObservation(data: {
    sessionId?: number;
    project: string;
    type: string;
    title: string;
    content: string;
    topicKey?: string;
    filePaths?: string[];
  }): Promise<MemoryObservationRow>;

  createSession(data: {
    project: string;
    prNumber?: number;
  }): Promise<{ id: number }>;

  endSession(sessionId: number, summary: string): Promise<void>;

  close(): Promise<void>;
}

export interface MemoryObservationRow {
  id: number;
  type: string;
  title: string;
  content: string;
  filePaths: string[] | null;
}
```

All consumers of memory operations (currently `packages/core/src/memory/search.ts` and `packages/core/src/memory/persist.ts`) MUST call methods on this interface instead of importing functions from `ghagga-db`.

The `close()` method MUST be called when the consumer is done with the storage instance. For SQLite this flushes to disk and frees WASM memory; for PostgreSQL it is a no-op.

### R2: ReviewInput Type Update

`ReviewInput` in `packages/core/src/types.ts` MUST replace the field:

```typescript
db?: unknown;
```

with:

```typescript
memoryStorage?: MemoryStorage;
```

The field MUST be typed as `MemoryStorage | undefined`. The old `db` field MUST be removed. All call sites (server, CLI, Action) MUST be updated to use the new field name.

### R3: SqliteMemoryStorage Implementation

The system MUST provide a `SqliteMemoryStorage` class in `packages/core/src/memory/sqlite.ts` that implements `MemoryStorage` using sql.js (pure WASM SQLite, `^1.11.0`).

#### R3.1: Schema Initialization

On construction, `SqliteMemoryStorage` MUST create the following tables if they do not exist:

```sql
CREATE TABLE IF NOT EXISTS memory_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL,
  pr_number INTEGER,
  summary TEXT,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS memory_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER REFERENCES memory_sessions(id),
  project TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topic_key TEXT,
  file_paths TEXT DEFAULT '[]',
  content_hash TEXT,
  revision_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_obs_project ON memory_observations(project);
CREATE INDEX IF NOT EXISTS idx_obs_topic_key ON memory_observations(topic_key);
CREATE INDEX IF NOT EXISTS idx_obs_content_hash ON memory_observations(content_hash);
```

#### R3.2: FTS5 Virtual Table

`SqliteMemoryStorage` MUST create an FTS5 virtual table for full-text search:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS memory_observations_fts
  USING fts5(title, content, content='memory_observations', content_rowid='id');
```

It MUST create triggers to keep the FTS index in sync with the base table:

```sql
CREATE TRIGGER IF NOT EXISTS obs_fts_insert AFTER INSERT ON memory_observations BEGIN
  INSERT INTO memory_observations_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS obs_fts_update AFTER UPDATE ON memory_observations BEGIN
  INSERT INTO memory_observations_fts(memory_observations_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
  INSERT INTO memory_observations_fts(rowid, title, content)
    VALUES (new.id, new.title, new.content);
END;
```

#### R3.3: Content-Hash Deduplication

`saveObservation` MUST compute a SHA-256 content hash from `"${type}:${title}:${content}"` (matching the PostgreSQL implementation in `packages/db/src/queries.ts:364-366`). If an observation with the same `contentHash` AND `project` exists within a 15-minute rolling window, the method MUST return the existing row without inserting a duplicate.

#### R3.4: TopicKey Upsert

When `topicKey` is provided and a row with the same `topicKey` AND `project` already exists, `saveObservation` MUST update the existing row's `content`, `title`, `contentHash`, `filePaths`, and `updatedAt`, and MUST increment `revisionCount` by 1. It MUST return the updated row.

#### R3.5: RETURNING Clause

All INSERT and UPDATE operations that return a `MemoryObservationRow` MUST use SQLite's `RETURNING` clause (available in sql.js since SQLite 3.35+; sql.js ships 3.46+).

#### R3.6: File Persistence

The constructor MUST accept a `filePath: string` parameter. On construction, if the file exists, it MUST be loaded into the sql.js in-memory database. The `close()` method MUST export the database bytes and write them to the provided `filePath`, creating parent directories as needed.

#### R3.7: Static Factory

`SqliteMemoryStorage` MUST expose a static async factory method:

```typescript
static async create(filePath: string): Promise<SqliteMemoryStorage>
```

This factory MUST handle WASM initialization (loading sql.js) and return a ready-to-use instance. If the file at `filePath` exists, it MUST load its contents. If the file does not exist, it MUST initialize an empty database with the full schema.

#### R3.8: file_paths Column Encoding

The `file_paths` column MUST store data as a JSON-encoded string (e.g., `'["src/auth.ts","lib/pool.ts"]'`). `saveObservation` MUST serialize the `filePaths` array to JSON before INSERT. `searchObservations` MUST deserialize it back to `string[] | null` in the returned `MemoryObservationRow`.

### R4: PostgresMemoryStorage Implementation

The system MUST provide a `PostgresMemoryStorage` class in `apps/server/src/memory/postgres.ts` that implements the `MemoryStorage` interface by wrapping existing `ghagga-db` query functions:

| Interface Method | Delegates To |
|---|---|
| `searchObservations` | `ghagga-db.searchObservations` |
| `saveObservation` | `ghagga-db.saveObservation` |
| `createSession` | `ghagga-db.createMemorySession` |
| `endSession` | `ghagga-db.endMemorySession` |
| `close` | No-op (PostgreSQL connection is managed externally) |

The constructor MUST accept the Drizzle `Database` instance (the existing `db` parameter used throughout the server).

The returned `MemoryObservationRow` MUST match the interface shape: `{ id, type, title, content, filePaths }`. The adapter MUST map from the full Drizzle row to this subset.

### R5: FTS5 Search Parity

#### R5.1: Keyword Matching

`SqliteMemoryStorage.searchObservations` MUST use the FTS5 virtual table to perform keyword matching against the `title` and `content` columns. The query string (space-separated keywords) MUST be converted to FTS5 match syntax (e.g., `"auth pool config"` becomes an FTS5 query matching rows containing any of those terms).

#### R5.2: BM25 Ranking

Results SHOULD be ranked by FTS5's built-in `bm25()` ranking function so that more relevant observations appear first.

#### R5.3: Project Scoping

Search results MUST be filtered to observations matching the given `project` parameter. Observations from other projects MUST NOT appear in results.

#### R5.4: Type Filtering

When `options.type` is provided, results MUST be further filtered to observations matching that type.

#### R5.5: Limit

Results MUST be capped at `options.limit` (defaulting to 10 if not specified), matching the PostgreSQL implementation's default.

#### R5.6: Parity Expectations

Exact search parity with PostgreSQL `tsvector` (English dictionary with stemming) is NOT required. FTS5 with the default `unicode61` tokenizer does not perform stemming. For the domain of code review observations (keywords like "auth", "pool", "config", "security"), exact keyword matching is sufficient.

### R6: CLI Memory Integration

#### R6.1: Database Path

The CLI MUST create the SQLite database at the XDG-compliant path: `${XDG_CONFIG_HOME || ~/.config}/ghagga/memory.db`. It MUST use the `getConfigDir()` logic already present in `apps/cli/src/lib/config.ts` (which resolves `XDG_CONFIG_HOME`).

#### R6.2: Project Identifier

The CLI MUST derive the project identifier from `git remote get-url origin`, normalized to `owner/repo` format:
- Strip protocol prefix (`https://github.com/`, `git@github.com:`, etc.)
- Strip `.git` suffix
- Result: `"owner/repo"`

If `git remote get-url origin` fails (no remote), the CLI MUST fall back to `"local/unknown"`.

The current hardcoded `repoFullName: 'local/review'` at `apps/cli/src/commands/review.ts:95` MUST be replaced with this derived value.

#### R6.3: Pipeline Integration

The CLI MUST:
1. Create a `SqliteMemoryStorage` instance via `SqliteMemoryStorage.create(dbPath)`
2. Pass it as `memoryStorage` in the `ReviewInput`
3. Set `enableMemory: true` in `ReviewSettings`
4. Set `context.repoFullName` to the derived project identifier
5. Call `memoryStorage.close()` after the pipeline completes (to persist to disk)

#### R6.4: Opt-Out Flag

The CLI MUST support a `--no-memory` flag that disables memory. When set:
- `memoryStorage` MUST be `undefined`
- `enableMemory` MUST be `false`
- No SQLite database file MUST be created or opened

#### R6.5: ReviewOptions Update

The `ReviewOptions` interface in `apps/cli/src/commands/review.ts` MUST add a `memory: boolean` field (defaulting to `true`). The Commander.js option MUST be `--no-memory` (which sets `memory: false`).

### R7: Action Memory Integration

#### R7.1: Database Path

The Action MUST create the SQLite database at `/tmp/ghagga-memory.db`.

#### R7.2: Cache Strategy

The Action MUST use `@actions/cache` to persist the database file between workflow runs:
- **Cache key**: `ghagga-memory-{github.repository}` (e.g., `ghagga-memory-owner/repo`)
- **Cache path**: `/tmp/ghagga-memory.db`
- **Restore**: At the start of the Action, before creating `SqliteMemoryStorage`
- **Save**: After the review pipeline completes and `memoryStorage.close()` is called

#### R7.3: Pipeline Integration

The Action MUST:
1. Attempt to restore the cached database file
2. Create a `SqliteMemoryStorage` instance via `SqliteMemoryStorage.create('/tmp/ghagga-memory.db')`
3. Pass it as `memoryStorage` in the `ReviewInput`
4. Set `enableMemory: true` in `ReviewSettings`
5. After the pipeline completes, call `memoryStorage.close()`
6. Save the database file to cache

#### R7.4: Opt-Out Input

The Action MUST support an `enable-memory` input (default: `true`). When set to `false`:
- No cache restore or save MUST occur
- `memoryStorage` MUST be `undefined`
- `enableMemory` MUST be `false`

#### R7.5: Cache Eviction

If the cache has been evicted (7-day inactivity in GitHub Actions), the Action MUST start with a fresh empty database. This MUST NOT be treated as an error.

### R8: Pipeline Refactor

#### R8.1: search.ts Refactor

`packages/core/src/memory/search.ts` MUST:
- Remove `import { searchObservations } from 'ghagga-db'`
- Change the `searchMemoryForContext` signature from `(db: unknown, ...)` to `(storage: MemoryStorage, ...)`
- Call `storage.searchObservations(project, query, { limit: 3 })` instead of `searchObservations(db as ..., ...)`
- The `!db` null-guard becomes `!storage`

#### R8.2: persist.ts Refactor

`packages/core/src/memory/persist.ts` MUST:
- Remove `import { saveObservation, createMemorySession, endMemorySession } from 'ghagga-db'`
- Change the `persistReviewObservations` signature from `(db: unknown, ...)` to `(storage: MemoryStorage, ...)`
- Replace `createMemorySession(typedDb, ...)` with `storage.createSession(...)`
- Replace `saveObservation(typedDb, ...)` with `storage.saveObservation(...)`
- Replace `endMemorySession(typedDb, ...)` with `storage.endSession(...)`

#### R8.3: pipeline.ts Refactor

`packages/core/src/pipeline.ts` MUST:
- Replace `input.db` references with `input.memoryStorage`
- Update `searchMemorySafe` (line 365-386) to pass `input.memoryStorage` instead of `input.db` to `searchMemoryForContext`
- Update step 8 (line 256-269) to pass `input.memoryStorage` instead of `input.db` to `persistReviewObservations`
- The null-guard `!input.db` becomes `!input.memoryStorage`

### R9: Core Independence

After this change:
- `packages/core/package.json` MUST NOT list `ghagga-db` as a dependency (remove `"ghagga-db": "workspace:^"`)
- `packages/core/package.json` MUST add `"sql.js": "^1.11.0"` as a dependency
- No file in `packages/core/src/` MUST contain `import ... from 'ghagga-db'`
- `packages/core` MUST be independently installable without PostgreSQL/Drizzle

### R10: Backward Compatibility

#### R10.1: SaaS Behavior

The SaaS server (`apps/server/`) MUST continue working exactly as before. The `PostgresMemoryStorage` adapter wraps the same `ghagga-db` functions with no behavioral changes. SaaS users MUST NOT notice any difference.

#### R10.2: Server Call Sites

All server call sites that currently pass `db: dbInstance` to `reviewPipeline` MUST be updated to pass `memoryStorage: new PostgresMemoryStorage(db)`. This includes webhook handlers, Inngest functions, and API routes.

#### R10.3: Memory-Disabled Path

When `memoryStorage` is `undefined`, the pipeline MUST behave identically to the current `db: undefined` behavior: memory search returns `null`, memory persist is skipped, review completes normally.

---

## Cross-Cutting Concerns

### CC1: Graceful Degradation

If memory initialization fails at any point (file permission errors, WASM load failure, sql.js import failure, corrupted database file, etc.), the review MUST still proceed without memory. Specifically:

- `SqliteMemoryStorage.create()` SHOULD be wrapped in a try/catch at the call site (CLI and Action). On failure, `memoryStorage` MUST be set to `undefined` and a warning MUST be logged.
- The pipeline's existing graceful degradation in `searchMemorySafe` and `persistReviewObservations` MUST remain: errors are caught, logged as warnings, and the pipeline continues.
- Memory failures MUST NOT cause the review to fail or throw.

### CC2: sql.js WASM Loading

The sql.js WASM binary (~1MB) MUST be loadable in both environments:

- **CLI** (direct Node.js): sql.js loads its WASM binary from its npm package's `dist/` directory by default. This MUST work without special configuration.
- **Action** (ncc-bundled): The Action uses `@vercel/ncc` for bundling. The WASM binary MUST be included as an asset. If ncc cannot inline the WASM, the `locateFile` option of sql.js MUST be used to load it from a known sibling path.

### CC3: Thread Safety

sql.js operates as an in-memory database with manual file persistence (via `close()`). Concurrent writes are NOT expected:
- The CLI is a single-process tool
- The Action runs one review per job

No file locking or write-ahead log is needed. This constraint MUST be documented in the `SqliteMemoryStorage` class JSDoc.

---

## Scenarios

### S1: CLI First Review with Memory

```gherkin
Given a CLI user runs `ghagga review .` in a git repository with a remote origin of "https://github.com/acme/widgets.git"
  And no memory database exists at ~/.config/ghagga/memory.db
  And the --no-memory flag is NOT set
When the review pipeline executes
Then SqliteMemoryStorage.create("~/.config/ghagga/memory.db") MUST be called
  And the database file MUST be created with all schema tables (memory_sessions, memory_observations, memory_observations_fts)
  And memoryStorage.searchObservations("acme/widgets", ...) MUST be called
  And the search MUST return an empty result (no prior observations)
  And memoryContext MUST be null in the ReviewResult
  And the review MUST complete with AI findings
  And memoryStorage.close() MUST be called after the pipeline completes
  And the database file MUST exist on disk at ~/.config/ghagga/memory.db
  And new observations from significant findings MUST be persisted in the database
```

### S2: CLI Second Review Same Repo

```gherkin
Given a CLI user has previously reviewed "acme/widgets" and observations exist in ~/.config/ghagga/memory.db
  And the user runs `ghagga review .` in the same repository
When the review pipeline executes
Then SqliteMemoryStorage.create("~/.config/ghagga/memory.db") MUST load the existing database file
  And memoryStorage.searchObservations("acme/widgets", ...) MUST return past observations
  And the returned observations MUST be formatted via formatMemoryContext
  And memoryContext MUST be a non-null string in the ReviewResult
  And the formatted context MUST be injected into agent prompts
```

### S3: CLI Review Different Repo

```gherkin
Given observations exist in the memory database for project "acme/widgets"
  And the CLI user runs `ghagga review .` in a repository with remote "https://github.com/acme/gadgets.git"
When memoryStorage.searchObservations("acme/gadgets", ...) is called
Then the search MUST return only observations where project = "acme/gadgets"
  And observations from "acme/widgets" MUST NOT appear in results
```

### S4: CLI with --no-memory Flag

```gherkin
Given a CLI user runs `ghagga review . --no-memory`
When the review command processes options
Then SqliteMemoryStorage MUST NOT be instantiated
  And the ReviewInput.memoryStorage MUST be undefined
  And ReviewSettings.enableMemory MUST be false
  And no database file MUST be created or opened
  And the review MUST complete normally without memory context
```

### S5: CLI with No Git Remote

```gherkin
Given a CLI user runs `ghagga review .` in a git repository with no configured remote
  And `git remote get-url origin` fails with a non-zero exit code
When the project identifier is resolved
Then the project identifier MUST fall back to "local/unknown"
  And the review MUST proceed with project = "local/unknown"
  And observations MUST be scoped to "local/unknown"
```

### S6: Action First Run (Cache Miss)

```gherkin
Given the GHAGGA Action runs on a PR in repository "owner/repo"
  And the enable-memory input is not set (defaults to true)
  And no cache entry exists for key "ghagga-memory-owner/repo"
When the Action executes
Then @actions/cache.restoreCache MUST be called for key "ghagga-memory-owner/repo"
  And the restore MUST return a cache miss (no hit)
  And SqliteMemoryStorage.create("/tmp/ghagga-memory.db") MUST create a fresh database
  And the review pipeline MUST run with memoryStorage set and enableMemory: true
  And after the pipeline, memoryStorage.close() MUST write the database to /tmp/ghagga-memory.db
  And @actions/cache.saveCache MUST be called with path "/tmp/ghagga-memory.db" and key "ghagga-memory-owner/repo"
```

### S7: Action Subsequent Run (Cache Hit)

```gherkin
Given the GHAGGA Action runs on a PR in repository "owner/repo"
  And a cache entry exists for key "ghagga-memory-owner/repo" with a populated database
When the Action executes
Then @actions/cache.restoreCache MUST return a cache hit
  And /tmp/ghagga-memory.db MUST contain the cached database file
  And SqliteMemoryStorage.create("/tmp/ghagga-memory.db") MUST load the existing data
  And memoryStorage.searchObservations("owner/repo", ...) MUST return past observations
  And the review MUST use the memory context for an enriched review
  And after the pipeline, the updated database MUST be saved to cache
```

### S8: Action with enable-memory: false

```gherkin
Given the GHAGGA Action runs with input enable-memory set to "false"
When the Action executes
Then @actions/cache.restoreCache MUST NOT be called
  And SqliteMemoryStorage MUST NOT be instantiated
  And ReviewInput.memoryStorage MUST be undefined
  And ReviewSettings.enableMemory MUST be false
  And @actions/cache.saveCache MUST NOT be called
  And the review MUST complete normally without memory
```

### S9: Action Cache Evicted

```gherkin
Given the GHAGGA Action runs on a PR in repository "owner/repo"
  And the cache entry for "ghagga-memory-owner/repo" was evicted (>7 days inactivity)
When @actions/cache.restoreCache is called
Then it MUST return a cache miss
  And no error MUST be thrown
  And the Action MUST create a fresh empty database
  And the review MUST proceed normally
  And the new database MUST be saved to cache after the review
```

### S10: Server SaaS Path Unchanged

```gherkin
Given the SaaS server processes a webhook for PR #42 on "owner/repo"
  And the server creates PostgresMemoryStorage wrapping the Drizzle db instance
When reviewPipeline is called with memoryStorage: postgresStorage and enableMemory: true
Then PostgresMemoryStorage.searchObservations MUST delegate to ghagga-db.searchObservations
  And PostgresMemoryStorage.saveObservation MUST delegate to ghagga-db.saveObservation
  And PostgresMemoryStorage.createSession MUST delegate to ghagga-db.createMemorySession
  And PostgresMemoryStorage.endSession MUST delegate to ghagga-db.endMemorySession
  And the review result MUST be identical to the pre-change behavior
```

### S11: Memory Search with Results

```gherkin
Given a MemoryStorage instance with 5 observations for project "acme/widgets"
  And the observations have titles containing "auth", "pool", "config", "deploy", "lint"
When searchObservations("acme/widgets", "auth config", { limit: 3 }) is called
Then the result MUST contain at most 3 observations
  And all returned observations MUST belong to project "acme/widgets"
  And each returned MemoryObservationRow MUST have: id (number), type (string), title (string), content (string), filePaths (string[] | null)
```

### S12: Memory Search No Results

```gherkin
Given a MemoryStorage instance with observations for project "acme/widgets"
When searchObservations("acme/widgets", "xyznonexistent", { limit: 3 }) is called
Then the result MUST be an empty array
  And the pipeline MUST set memoryContext to null
  And the review MUST proceed normally without memory context
```

### S13: Observation Content-Hash Deduplication

```gherkin
Given a MemoryStorage instance (SQLite or PostgreSQL)
  And an observation exists with contentHash = sha256("pattern:Auth config:OAuth patterns observed") created 5 minutes ago for project "acme/widgets"
When saveObservation is called with { project: "acme/widgets", type: "pattern", title: "Auth config", content: "OAuth patterns observed" }
Then the content hash sha256("pattern:Auth config:OAuth patterns observed") MUST match the existing row
  And the existing row's created_at MUST be within the 15-minute dedup window
  And the method MUST return the existing observation without inserting a new row
  And the total observation count MUST remain unchanged
```

### S14: Observation Dedup Window Expired

```gherkin
Given an observation exists with the same content hash but created 20 minutes ago
When saveObservation is called with the same type, title, and content
Then the content hash matches BUT the created_at is outside the 15-minute window
  And a new observation MUST be inserted
  And the total observation count MUST increase by 1
```

### S15: TopicKey Upsert

```gherkin
Given an observation exists with topicKey = "pr-42-review" and project = "acme/widgets"
  And it has revisionCount = 1 and content = "Original content"
When saveObservation is called with { project: "acme/widgets", topicKey: "pr-42-review", title: "Updated title", content: "Updated content", type: "decision" }
Then the existing observation MUST be updated (not a new row inserted)
  And the content MUST be "Updated content"
  And the title MUST be "Updated title"
  And the revisionCount MUST be 2
  And the updatedAt MUST be refreshed
  And the returned MemoryObservationRow MUST reflect the updated values
```

### S16: FTS5 Search Keyword Matching

```gherkin
Given a SqliteMemoryStorage instance with observations:
  | project       | title              | content                         |
  | acme/widgets  | Auth configuration | OAuth token refresh patterns     |
  | acme/widgets  | Database pooling   | Connection pool tuning for PG    |
  | acme/widgets  | CSS styling        | Tailwind utility class patterns  |
When searchObservations("acme/widgets", "auth pool") is called
Then observations matching "auth" (in title) and "pool" (in title) MUST be returned
  And the "CSS styling" observation MUST NOT be returned (no matching terms)
  And results MUST be ordered by BM25 relevance rank
```

### S17: Database File Does Not Exist Yet

```gherkin
Given no file exists at the path "/home/user/.config/ghagga/memory.db"
  And the directory "/home/user/.config/ghagga/" exists
When SqliteMemoryStorage.create("/home/user/.config/ghagga/memory.db") is called
Then a new in-memory database MUST be initialized
  And all schema tables (memory_sessions, memory_observations) MUST be created
  And the FTS5 virtual table and triggers MUST be created
  And the instance MUST be ready for search/save operations
  And when close() is called, the file MUST be written to disk
```

### S18: Database File Corrupted

```gherkin
Given a file exists at "/home/user/.config/ghagga/memory.db" but contains invalid/corrupted data
When SqliteMemoryStorage.create("/home/user/.config/ghagga/memory.db") is called
Then the create method MUST throw or return an error
  And the CLI/Action caller MUST catch the error
  And the caller MUST log a warning: "[ghagga] Memory database corrupted, starting fresh"
  And the caller MUST set memoryStorage to undefined (or retry with a fresh DB)
  And the review MUST proceed without memory
```

### S19: WASM Load Failure

```gherkin
Given the sql.js WASM binary cannot be loaded (e.g., file not found, WebAssembly not supported)
When SqliteMemoryStorage.create(...) is called
Then the create method MUST throw an error
  And the CLI/Action caller MUST catch the error
  And the caller MUST log a warning: "[ghagga] Failed to initialize memory: {error message}"
  And the caller MUST set memoryStorage to undefined
  And ReviewSettings.enableMemory MUST remain true (the setting is informational)
  And the review MUST proceed without memory context
```

### S20: Pipeline with memoryStorage undefined

```gherkin
Given reviewPipeline is called with memoryStorage: undefined and enableMemory: true
When the pipeline reaches step 5 (memory search)
Then searchMemorySafe MUST check !input.memoryStorage and return null
  And when the pipeline reaches step 8 (memory persist)
  Then the persist step MUST check !input.memoryStorage and skip persistence
  And the review MUST complete with memoryContext: null
  And no errors MUST be thrown
```

### S21: Core Package Independence

```gherkin
Given the packages/core/package.json after this change
When the dependencies are inspected
Then "ghagga-db" MUST NOT appear in dependencies or devDependencies
  And "sql.js" MUST appear in dependencies with version "^1.11.0"
  And running `grep -r "from 'ghagga-db'" packages/core/src/` MUST return zero matches
```

### S22: Session Lifecycle

```gherkin
Given a MemoryStorage instance
When createSession({ project: "acme/widgets", prNumber: 42 }) is called
Then it MUST return an object with { id: <number> } where id > 0
  And when endSession(sessionId, "Review complete") is called with the returned id
  Then the session's ended_at MUST be set
  And the session's summary MUST be "Review complete"
  And no error MUST be thrown
```

### S23: Git Remote URL Normalization

```gherkin
Given the following git remote URLs:
  | Remote URL                                     | Expected Project ID |
  | https://github.com/acme/widgets.git           | acme/widgets        |
  | git@github.com:acme/widgets.git               | acme/widgets        |
  | https://github.com/acme/widgets               | acme/widgets        |
  | ssh://git@github.com/acme/widgets.git         | acme/widgets        |
  | https://gitlab.com/acme/widgets.git           | acme/widgets        |
When the CLI resolves the project identifier
Then each URL MUST be normalized to the corresponding Expected Project ID
```

---

## Acceptance Criteria

1. `MemoryStorage` interface is defined in `packages/core/src/types.ts` with `searchObservations`, `saveObservation`, `createSession`, `endSession`, and `close` methods
2. `ReviewInput.db` is replaced by `ReviewInput.memoryStorage` typed as `MemoryStorage | undefined`
3. `SqliteMemoryStorage` passes unit tests: schema init, save + dedup, topicKey upsert, FTS5 search, session lifecycle, file persistence
4. `PostgresMemoryStorage` wraps `ghagga-db` functions and passes integration tests
5. `packages/core/package.json` has `sql.js` as dependency and no `ghagga-db` dependency
6. No file in `packages/core/src/` imports from `ghagga-db`
7. CLI creates memory DB at `~/.config/ghagga/memory.db`, derives project ID from git remote, enables memory by default, supports `--no-memory`
8. CLI memory persists across runs: first review saves observations, second review retrieves them
9. Action uses `@actions/cache` to persist memory DB between workflow runs
10. Action supports `enable-memory` input (default true) with opt-out
11. SaaS server uses `PostgresMemoryStorage`, behavior unchanged from pre-change
12. Pipeline works correctly with `memoryStorage: undefined` (graceful degradation)
13. ncc bundle of the Action succeeds with sql.js WASM included
14. All memory failures (WASM load, corrupted DB, file permissions) degrade gracefully with warnings, never breaking the review

---
---

## Memory Management Extension

> **Merged from**: `memory-management` delta spec (2026-03-06)  
> **Change**: `memory-management`  
> **Extends**: Requirements R1–R10 above with management capabilities (CLI commands for inspecting, searching, and pruning memory)

### Overview

This section extends the memory-storage domain with a `ghagga memory` CLI command group providing six subcommands (`list`, `search`, `show`, `delete`, `stats`, `clear`) that give users full visibility and control over their local SQLite memory database. It also extends the `MemoryStorage` interface with five new methods, adds a missing FTS5 delete trigger to the SQLite schema, and stubs the new methods in `PostgresMemoryStorage`.

All commands are CLI-only, output plain text tables (no TUI, no colors), and handle edge cases gracefully: no database file, empty results, invalid IDs, and non-interactive (piped) environments.

---

### Requirements

#### R11: MemoryStorage Interface Extension

The `MemoryStorage` interface in `packages/core/src/types.ts` MUST be extended with five new methods:

```typescript
/** List observations with optional filtering and pagination. */
listObservations(options?: {
  project?: string;
  type?: string;
  limit?: number;
  offset?: number;
}): Promise<MemoryObservationDetail[]>;

/** Get a single observation by ID (full or prefix). Returns null if not found. */
getObservation(id: number): Promise<MemoryObservationDetail | null>;

/** Delete a single observation by ID. Returns true if found and deleted, false otherwise. */
deleteObservation(id: number): Promise<boolean>;

/** Get aggregate statistics about the memory store. */
getStats(): Promise<MemoryStats>;

/** Delete all observations, optionally scoped to a project. Returns count of deleted rows. */
clearObservations(options?: { project?: string }): Promise<number>;
```

**Rationale**: The existing interface only supports search, save, and session management. Management commands (list, get, delete, stats, clear) require dedicated methods that don't exist today.

#### R12: New Types — MemoryObservationDetail, MemoryStats

Two new types MUST be added to `packages/core/src/types.ts`:

```typescript
export interface MemoryObservationDetail {
  id: number;
  type: string;
  title: string;
  content: string;
  filePaths: string[] | null;
  project: string;
  topicKey: string | null;
  revisionCount: number;
  createdAt: string;   // ISO 8601
  updatedAt: string;   // ISO 8601
}

export interface MemoryStats {
  totalObservations: number;
  byType: Record<string, number>;
  byProject: Record<string, number>;
  oldestObservation: string | null;  // ISO 8601, null if no observations
  newestObservation: string | null;  // ISO 8601, null if no observations
}
```

`MemoryObservationDetail` extends the existing `MemoryObservationRow` with all database columns needed for the `show` command. `MemoryStats` carries aggregate data for the `stats` command.

#### R13: FTS5 Delete Trigger

The `SCHEMA_SQL` constant in `packages/core/src/memory/sqlite.ts` MUST include an `obs_fts_delete` trigger:

```sql
CREATE TRIGGER IF NOT EXISTS obs_fts_delete AFTER DELETE ON memory_observations BEGIN
  INSERT INTO memory_observations_fts(memory_observations_fts, rowid, title, content)
    VALUES ('delete', old.id, old.title, old.content);
END;
```

This trigger MUST be appended to the existing `SCHEMA_SQL` alongside the existing `obs_fts_insert` and `obs_fts_update` triggers. Because `SCHEMA_SQL` runs via `db.run(SCHEMA_SQL)` on every `SqliteMemoryStorage.create()` call, and the trigger uses `CREATE TRIGGER IF NOT EXISTS`, existing databases MUST automatically gain the trigger the next time they are opened.

#### R14: SqliteMemoryStorage — New Method Implementations

`SqliteMemoryStorage` in `packages/core/src/memory/sqlite.ts` MUST implement all five new methods:

##### R14.1: listObservations

- Default `limit`: 20, default `offset`: 0.
- When `options.project` is provided, filter by `project = ?`. When omitted, return all projects.
- When `options.type` is provided, filter by `type = ?`. When omitted, return all types.
- Results MUST be ordered newest first (`created_at DESC`).
- The `file_paths` column MUST be deserialized from JSON string to `string[] | null`.
- MUST return `MemoryObservationDetail[]`.

##### R14.2: getObservation

- Accepts the integer observation ID.
- MUST return `MemoryObservationDetail | null`. Returns `null` if no row matches.
- The `file_paths` column MUST be deserialized from JSON string.

##### R14.3: deleteObservation

- The `obs_fts_delete` trigger (R13) MUST fire automatically to clean up the FTS index.
- MUST return `true` if a row was deleted, `false` if the ID was not found.
- After deletion, `close()` MUST be called by the consumer to persist the change to disk.

##### R14.4: getStats

Three queries for total/date range, count by type, and count by project.

- MUST return a `MemoryStats` object.
- If no observations exist, `totalObservations` MUST be 0, `byType` and `byProject` MUST be empty objects, `oldestObservation` and `newestObservation` MUST be `null`.

##### R14.5: clearObservations

- When `options.project` is provided, delete only that project's observations.
- When `options.project` is omitted, delete ALL observations.
- The `obs_fts_delete` trigger (R13) MUST fire for each deleted row to clean up the FTS index.
- MUST return the count of deleted rows.
- After clearing, `close()` MUST be called by the consumer to persist.

#### R15: PostgresMemoryStorage Stubs

All five new methods MUST be added to `PostgresMemoryStorage` in `apps/server/src/memory/postgres.ts`. Each MUST throw:

```typescript
throw new Error('Not implemented — use Dashboard for memory management');
```

#### R16: CLI Command Group — `ghagga memory`

A new `memory` command group MUST be registered in `apps/cli/src/index.ts`. The command group MUST be implemented as a subdirectory `apps/cli/src/commands/memory/` with one file per subcommand, a shared `utils.ts`, and an `index.ts` barrel.

#### R17: `ghagga memory list`

##### R17.1: Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--repo <owner/repo>` | string | (none) | Filter by project field |
| `--type <type>` | string | (none) | Filter by observation type |
| `--limit <n>` | number | 20 | Maximum rows to display |

##### R17.2: Output Format

A plain-text table with fixed-width columns using `String.padEnd()`:
- **ID**: First 8 characters of the integer ID, left-padded with zeros.
- **Type**: Observation type, max 10 chars.
- **Title**: Truncated to 40 characters with `...` suffix if longer.
- **Repo**: The `project` field value.
- **Date**: `createdAt` formatted as `YYYY-MM-DD`.

##### R17.3: Empty Results

When no observations match the filters, output: `No observations found.`

#### R18: `ghagga memory search <query>`

##### R18.1: Arguments and Options

- **Required argument**: `<query>` — the search terms (passed to `searchObservations`)
- `--repo <owner/repo>` — scope search to a specific project (inferred from git remote if omitted via `resolveProjectId`)
- `--limit <n>` — maximum results (default 10)

##### R18.2: Output Format

Numbered results showing type in brackets, title, ID (first 8 chars), and content snippet (first 80 characters with `...` suffix if longer).

##### R18.3: Empty Results

Output: `No matching observations found.`

#### R19: `ghagga memory show <id>`

##### R19.1: Arguments

- **Required argument**: `<id>` — the observation ID. The CLI MUST parse the argument as an integer. If parsing fails, print: `Invalid observation ID: "<input>". Expected a number.`

##### R19.2: Output Format

Key-value display, one field per line. Content MUST be displayed in full (no truncation), indented with 2 spaces per line. File paths as comma-separated list or `(none)`.

##### R19.3: Not Found

Output: `Observation not found: <id>` (exit code 1)

#### R20: `ghagga memory delete <id>`

##### R20.1: Arguments and Options

- **Required argument**: `<id>` — the observation ID
- `--force` — skip the confirmation prompt

##### R20.2: Confirmation Flow

Fetch observation → display summary → prompt `Are you sure? (y/N)` → only `y`/`Y` confirms → delete + close → success message. On cancel: `Cancelled.`

##### R20.3: Non-TTY Behavior

If `process.stdin.isTTY` is falsy and `--force` is not set: error and exit 1.

##### R20.4: Force Mode

Skip confirmation prompt entirely.

#### R21: `ghagga memory stats`

##### R21.1: Output Format

Shows: total observations, by type (sorted by count desc), by repository (top 10, sorted by count desc), database file path and size, oldest/newest observation dates.

##### R21.2: No Database

Print: `No memory database found. Run "ghagga review" first to build memory.`

#### R22: `ghagga memory clear`

##### R22.1: Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `--repo <owner/repo>` | string | (none) | Scope deletion to a single project |
| `--force` | boolean | false | Skip confirmation prompt |

##### R22.2: Confirmation Flow

Count observations → display scoped/unscoped prompt → only `y`/`Y` confirms → clear + close → success message with count.

##### R22.3: Non-TTY Behavior

Same as R20.3.

##### R22.4: Force Mode

Same as R20.4.

#### R23: Database Lifecycle in Commands

Every command handler MUST: check `existsSync(dbPath)` → open `SqliteMemoryStorage.create(dbPath)` → execute → close in `finally` block. If file does not exist: print `No memory database found. Run "ghagga review" first to build memory.` and exit 0. The database path MUST be `join(getConfigDir(), 'memory.db')`.

#### R24: Confirmation Prompt Implementation

Confirmation prompts MUST use Node.js built-in `readline/promises`. No external prompt library.

#### R25: No New Dependencies (Memory Management)

This extension MUST NOT add any new npm dependencies to `packages/core` or `apps/cli`.

---

### Cross-Cutting Concerns (Memory Management)

#### CC4: Graceful Degradation — No Database File

All six memory management commands MUST handle the case where `~/.config/ghagga/memory.db` does not exist. Check `existsSync(dbPath)` BEFORE opening storage. Print message and exit 0. MUST NOT create an empty database file.

#### CC5: Non-TTY Detection

Commands that require interactive confirmation (`delete`, `clear`) MUST detect non-TTY environments. Non-TTY without `--force`: error exit 1. Non-TTY with `--force`: proceed. TTY with `--force`: proceed. TTY without `--force`: show prompt.

#### CC6: Output Formatting — Plain Text Only

All command output MUST be plain text. No ANSI color codes, no TUI components, no external formatting libraries. Tables use `String.padEnd()`. Output is designed to be parseable by text processing tools.

#### CC7: Error Exit Codes

| Scenario | Exit Code |
|----------|-----------|
| Success (data found and displayed) | 0 |
| Success (no data / empty results) | 0 |
| No database file exists | 0 |
| Observation not found (show/delete) | 1 |
| Invalid input (bad ID format) | 1 |
| Non-TTY without --force | 1 |
| Database open/read error | 1 |
| Cancelled by user | 0 |

#### CC8: ID Display Format

Throughout all commands, observation IDs are displayed as the first 8 characters of the zero-padded integer ID (e.g., `42` → `00000042`).

---

### Scenarios (Memory Management)

#### S24: List — Happy Path, All Observations

```gherkin
Given a memory database exists with 25 observations across 2 projects
  And the user runs `ghagga memory list`
When the command executes
Then listObservations({ limit: 20, offset: 0 }) MUST be called
  And a table with 20 rows MUST be printed (respecting default limit)
  And rows MUST be ordered newest first
```

#### S25: List — Filtered by Repo

```gherkin
Given observations exist for "acme/widgets" and "acme/gadgets"
  And the user runs `ghagga memory list --repo acme/widgets`
Then only observations where project = "acme/widgets" MUST appear
```

#### S26: List — Filtered by Type

```gherkin
Given observations of types "pattern", "bugfix", "learning"
  And the user runs `ghagga memory list --type pattern`
Then only observations where type = "pattern" MUST appear
```

#### S27: List — Custom Limit

```gherkin
Given 50 observations exist
  And the user runs `ghagga memory list --limit 5`
Then exactly 5 rows MUST be printed
```

#### S28: List — Combined Filters

```gherkin
Given observations exist
  And the user runs `ghagga memory list --repo acme/widgets --type bugfix --limit 3`
Then only matching observations MUST appear
```

#### S29: List — Empty Results

```gherkin
Given a memory database with no observations
  And the user runs `ghagga memory list`
Then the output MUST be "No observations found."
  And the exit code MUST be 0
```

#### S30: List — No Database File

```gherkin
Given no memory database file exists
  And the user runs `ghagga memory list`
Then the output MUST be 'No memory database found. Run "ghagga review" first to build memory.'
  And the exit code MUST be 0
```

#### S31: Search — Happy Path

```gherkin
Given observations for "acme/widgets" containing "auth" terms
  And the user runs `ghagga memory search "auth" --repo acme/widgets`
Then results MUST be displayed as numbered entries ranked by BM25 relevance
```

#### S32: Search — Repo Inferred from Git Remote

```gherkin
Given the current directory is a git repo with remote "https://github.com/acme/widgets.git"
  And the user runs `ghagga memory search "auth"` (no --repo flag)
Then resolveProjectId MUST be called to derive "acme/widgets"
```

#### S33: Search — Custom Limit

```gherkin
Given many observations exist
  And the user runs `ghagga memory search "patterns" --repo acme/widgets --limit 3`
Then at most 3 results MUST be displayed
```

#### S34: Search — No Results

```gherkin
Given the user runs `ghagga memory search "xyznonexistent" --repo acme/widgets`
Then the output MUST be "No matching observations found."
```

#### S35: Search — No Database File

```gherkin
Given no memory database file exists
  And the user runs `ghagga memory search "auth" --repo acme/widgets`
Then the output MUST be 'No memory database found...'
```

#### S36: Show — Happy Path

```gherkin
Given observation ID 42 exists with all fields populated
  And the user runs `ghagga memory show 42`
Then ALL fields MUST be displayed in key-value format
  And content MUST be displayed in full (no truncation)
```

#### S37: Show — Not Found

```gherkin
Given no observation has ID 999
  And the user runs `ghagga memory show 999`
Then the output MUST be "Observation not found: 999"
  And the exit code MUST be 1
```

#### S38: Show — Invalid ID Format

```gherkin
Given the user runs `ghagga memory show abc`
Then the output MUST be 'Invalid observation ID: "abc". Expected a number.'
  And the exit code MUST be 1
```

#### S39: Show — No Database File

```gherkin
Given no memory database file exists
  And the user runs `ghagga memory show 42`
Then the no-DB message MUST be printed and exit 0
```

#### S40: Delete — Happy Path with Confirmation

```gherkin
Given observation ID 42 exists and the terminal is a TTY
  And the user runs `ghagga memory delete 42` and types "y"
Then deleteObservation(42) MUST be called
  And storage.close() MUST be called
  And the FTS5 index entry MUST be cleaned up
```

#### S41: Delete — User Cancels

```gherkin
Given the user runs `ghagga memory delete 42` and types "n"
Then deleteObservation MUST NOT be called
  And the output MUST show "Cancelled."
```

#### S42: Delete — Force Mode

```gherkin
Given the user runs `ghagga memory delete 42 --force`
Then no confirmation prompt MUST be shown
  And deleteObservation(42) MUST be called directly
```

#### S43: Delete — Not Found

```gherkin
Given no observation has ID 999
  And the user runs `ghagga memory delete 999`
Then the output MUST be "Observation not found: 999"
  And the exit code MUST be 1
```

#### S44: Delete — Non-TTY Without Force

```gherkin
Given process.stdin.isTTY is falsy
  And the user runs `echo "y" | ghagga memory delete 42`
Then error message MUST be printed and exit code MUST be 1
```

#### S45: Delete — Non-TTY With Force

```gherkin
Given process.stdin.isTTY is falsy
  And the user runs `ghagga memory delete 42 --force`
Then deletion MUST proceed without TTY check blocking
```

#### S46: Delete — FTS5 Cleanup

```gherkin
Given observation ID 42 is indexed in FTS5
  And the user deletes it
Then the obs_fts_delete trigger MUST fire
  And subsequent searches MUST NOT return observation 42
```

#### S47: Delete — Invalid ID / No DB

```gherkin
Given the user runs `ghagga memory delete abc`
Then the output MUST be 'Invalid observation ID: "abc". Expected a number.'
  And exit code MUST be 1

Given no database file exists and the user runs `ghagga memory delete 42`
Then the no-DB message MUST be printed and exit 0
```

#### S48: Stats — Happy Path

```gherkin
Given a populated memory database
  And the user runs `ghagga memory stats`
Then total observations, by-type breakdown, by-repo breakdown, DB file size, and date range MUST be shown
```

#### S49: Stats — Empty Database

```gherkin
Given an empty memory database
  And the user runs `ghagga memory stats`
Then "Total observations: 0" and "(none)" sections MUST be shown
```

#### S50: Stats — No Database File

```gherkin
Given no memory database file exists
  And the user runs `ghagga memory stats`
Then the no-DB message MUST be printed and exit 0
```

#### S51: Clear — Happy Path, All Observations

```gherkin
Given 147 observations exist and the terminal is a TTY
  And the user runs `ghagga memory clear` and types "y"
Then clearObservations() MUST be called with no project filter
  And storage.close() MUST be called
  And the output MUST show the count of deleted observations
```

#### S52: Clear — Scoped to Repository

```gherkin
Given observations exist for multiple projects
  And the user runs `ghagga memory clear --repo acme/widgets` and types "y"
Then clearObservations({ project: "acme/widgets" }) MUST be called
  And only that project's observations MUST be deleted
```

#### S53: Clear — User Cancels

```gherkin
Given the user runs `ghagga memory clear` and types "n"
Then clearObservations MUST NOT be called
  And the output MUST show "Cancelled."
```

#### S54: Clear — Force Mode

```gherkin
Given the user runs `ghagga memory clear --force`
Then no confirmation prompt MUST be shown
  And clearObservations() MUST be called directly
```

#### S55: Clear — No Observations

```gherkin
Given an empty database
  And the user runs `ghagga memory clear`
Then "No observations to clear." MUST be printed
  And no confirmation prompt MUST be shown
```

#### S56: Clear — Non-TTY Without Force

```gherkin
Given process.stdin.isTTY is falsy and --force is not set
Then error message MUST be printed and exit code MUST be 1
```

#### S57: Clear — Non-TTY With Force and Repo

```gherkin
Given process.stdin.isTTY is falsy
  And the user runs `ghagga memory clear --repo acme/widgets --force`
Then clearObservations({ project: "acme/widgets" }) MUST be called
```

#### S58: Clear — FTS5 Cleanup on Bulk Delete

```gherkin
Given 50 observations all indexed in FTS5
  And the user runs `ghagga memory clear --force`
Then obs_fts_delete trigger MUST fire once per deleted row
  And FTS index MUST be empty after the operation
```

#### S59: FTS5 Delete Trigger — Auto-Migration

```gherkin
Given a database created before this change (no obs_fts_delete trigger)
When SqliteMemoryStorage.create(dbPath) is called with the new code
Then CREATE TRIGGER IF NOT EXISTS obs_fts_delete MUST succeed
  And existing triggers MUST remain unchanged
```

#### S60: FTS5 Delete Trigger — Idempotent on New Database

```gherkin
Given SqliteMemoryStorage.create() is called on a non-existent path
When SCHEMA_SQL runs
Then all three triggers MUST be created without errors
```

#### S61: FTS5 Delete Trigger — Idempotent on Re-Open

```gherkin
Given a database created with the new code
When SqliteMemoryStorage.create(dbPath) is called again
Then CREATE TRIGGER IF NOT EXISTS obs_fts_delete MUST be a no-op
```

#### S62: PostgresMemoryStorage — Stub Methods Throw

```gherkin
Given a PostgresMemoryStorage instance
When listObservations, getObservation, deleteObservation, getStats, or clearObservations is called
Then each MUST throw Error('Not implemented — use Dashboard for memory management')
```

#### S63: PostgresMemoryStorage — Existing Methods Unchanged

```gherkin
Given a PostgresMemoryStorage instance
When existing methods (searchObservations, saveObservation, createSession, endSession, close) are called
Then behavior MUST be identical to pre-change implementation
```

#### S64: CLI Help Text

```gherkin
Given the user runs `ghagga memory --help`
Then all 6 subcommands MUST be listed: list, search, show, delete, stats, clear
```

#### S65: Command Registration

```gherkin
Given the CLI entry point at apps/cli/src/index.ts
Then memoryCommand MUST be registered
  And `ghagga memory` MUST appear in `ghagga --help` output
  And existing commands MUST NOT be affected
```

#### S66: Storage Close in Finally Block

```gherkin
Given a memory command opens storage and an error occurs
Then storage.close() MUST still be called (via finally block)
```

---

### Acceptance Criteria (Memory Management)

15. `MemoryStorage` interface has 5 new methods: `listObservations`, `getObservation`, `deleteObservation`, `getStats`, `clearObservations`
16. `MemoryObservationDetail` and `MemoryStats` types are exported from `packages/core/src/types.ts`
17. `obs_fts_delete` trigger is present in `SCHEMA_SQL`; existing databases gain it on next open
18. `SqliteMemoryStorage` implements all 5 new methods with correct SQL, JSON deserialization, and return types
19. `PostgresMemoryStorage` has all 5 new methods throwing `'Not implemented — use Dashboard for memory management'`
20. `ghagga memory` command group is registered and appears in `ghagga --help`
21. `ghagga memory list` displays table, supports `--repo`, `--type`, `--limit`
22. `ghagga memory search <query>` uses FTS5/BM25, supports `--repo` (inferred from git), `--limit`
23. `ghagga memory show <id>` displays all fields, errors on not-found and invalid IDs
24. `ghagga memory delete <id>` shows confirmation, respects `--force`, cleans FTS5
25. `ghagga memory stats` shows totals, by-type, by-repo, DB file size, date range
26. `ghagga memory clear` prompts, supports `--repo` scoping, `--force`, returns count
27. All 6 commands print no-DB message when `memory.db` does not exist, without creating one
28. `delete` and `clear` require `--force` in non-TTY environments
29. Confirmation prompts use `readline/promises`, accept only `y`/`Y`
30. No ANSI colors, no TUI, no external formatting libraries
31. No new npm dependencies added
32. All new methods have unit tests (101 memory-specific tests)
33. Existing commands (`review`, `login`, `logout`, `status`) unaffected
