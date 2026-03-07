# Tasks: Memory Management — CLI Commands for Inspecting, Searching, and Pruning Memory

## Phase 1: Infrastructure — Types, Interface, Schema, Exports

- [x] 1.1 Add `MemoryObservationDetail`, `MemoryStats`, and `ListObservationsOptions` interfaces to `packages/core/src/types.ts` in the existing "Memory Types" section (R2)
- [x] 1.2 Add 5 new methods (`listObservations`, `getObservation`, `deleteObservation`, `getStats`, `clearObservations`) to the `MemoryStorage` interface in `packages/core/src/types.ts` (R1)
- [x] 1.3 Export `MemoryObservationDetail`, `MemoryStats`, and `ListObservationsOptions` from `packages/core/src/index.ts`
- [x] 1.4 Append the `obs_fts_delete` trigger to the `SCHEMA_SQL` constant in `packages/core/src/memory/sqlite.ts`, after the existing `obs_fts_update` trigger (R3, AD4)

## Phase 2: Core — SqliteMemoryStorage Method Implementations

- [x] 2.1 Add the private `mapToDetail(row)` helper method to `SqliteMemoryStorage` in `packages/core/src/memory/sqlite.ts` — maps raw SQL row to `MemoryObservationDetail` with `file_paths` JSON deserialization
- [x] 2.2 Implement `listObservations(options?)` in `SqliteMemoryStorage` — dynamic WHERE clause with optional `project`/`type` filters, `ORDER BY created_at DESC`, `LIMIT`/`OFFSET` with defaults 20/0 (R4.1)
- [x] 2.3 Implement `getObservation(id)` in `SqliteMemoryStorage` — single-row SELECT by id, returns `MemoryObservationDetail | null` (R4.2)
- [x] 2.4 Implement `deleteObservation(id)` in `SqliteMemoryStorage` — `DELETE WHERE id = ?`, returns `boolean` via `getRowsModified()` (R4.3)
- [x] 2.5 Implement `getStats()` in `SqliteMemoryStorage` — three queries: totals+date range, count by type, count by project. Returns `MemoryStats` (R4.4)
- [x] 2.6 Implement `clearObservations(options?)` in `SqliteMemoryStorage` — scoped or unscoped DELETE, returns count via `getRowsModified()` (R4.5)

## Phase 3: Core — SqliteMemoryStorage Unit Tests

- [x] 3.1 Add tests for `listObservations` to `packages/core/src/memory/sqlite.test.ts` — no filters (all rows, newest first), project filter, type filter, combined filters, custom limit, empty results (S1–S6)
- [x] 3.2 Add tests for `getObservation` to `packages/core/src/memory/sqlite.test.ts` — found returns full detail, not found returns null (S13, S14)
- [x] 3.3 Add tests for `deleteObservation` to `packages/core/src/memory/sqlite.test.ts` — found returns true, not found returns false, FTS5 cleanup verified via `searchObservations` returning empty after delete (S23)
- [x] 3.4 Add tests for `getStats` to `packages/core/src/memory/sqlite.test.ts` — populated DB with multiple types/projects, empty DB returns zeroes and nulls (S25, S26)
- [x] 3.5 Add tests for `clearObservations` to `packages/core/src/memory/sqlite.test.ts` — clear all returns count, clear by project only deletes that project, FTS5 cleanup verified (S28, S29, S35)
- [x] 3.6 Add test for FTS5 delete trigger idempotency to `packages/core/src/memory/sqlite.test.ts` — re-open existing DB, trigger still functions (S36, S37, S38)

## Phase 4: Integrations — PostgresMemoryStorage Stubs

- [x] 4.1 Import `MemoryObservationDetail`, `MemoryStats`, `ListObservationsOptions` in `apps/server/src/memory/postgres.ts`
- [x] 4.2 Add 5 stub methods to `PostgresMemoryStorage` in `apps/server/src/memory/postgres.ts`, each throwing `Error('Not implemented — use Dashboard for memory management')` (R5, S39–S43)
- [x] 4.3 Verify existing `PostgresMemoryStorage` methods compile and are unchanged (S44) — run `pnpm tsc --noEmit` in `apps/server`

## Phase 5: CLI — Shared Utilities and Command Group Barrel

- [x] 5.1 Create `apps/cli/src/commands/memory/utils.ts` with `openMemoryOrExit()` — checks `existsSync(dbPath)`, prints no-DB message, exits 0 if missing, otherwise returns `{ storage, dbPath }` (AD2, CC1, R13)
- [x] 5.2 Add `confirmOrExit(message, force)` to `apps/cli/src/commands/memory/utils.ts` — handles `--force` bypass, non-TTY detection (exit 1), readline/promises prompt, cancel exit 0 (AD7, CC2, R14)
- [x] 5.3 Add `formatTable()`, `formatSize()`, `formatId()`, `truncate()` helpers to `apps/cli/src/commands/memory/utils.ts` (AD5, AD6, AD8)
- [x] 5.4 Create `apps/cli/src/commands/memory/index.ts` barrel — instantiate `new Command('memory')` with description, import and call all 6 `register*Command(memoryCommand)` functions, export `memoryCommand` (AD1)

## Phase 6: CLI — Subcommand Implementations

- [x] 6.1 Create `apps/cli/src/commands/memory/list.ts` — `registerListCommand(parent)` with `--repo`, `--type`, `--limit` options. Handler: `openMemoryOrExit()` → `listObservations()` → `formatTable()` output or "No observations found." (R7, S1–S7)
- [x] 6.2 Create `apps/cli/src/commands/memory/search.ts` — `registerSearchCommand(parent)` with `<query>` argument, `--repo` (inferred from `resolveProjectId` if omitted), `--limit`. Handler: `openMemoryOrExit()` → `searchObservations()` → numbered results output or "No matching observations found." (R8, S8–S12)
- [x] 6.3 Create `apps/cli/src/commands/memory/show.ts` — `registerShowCommand(parent)` with `<id>` argument. Handler: parse int, validate, `openMemoryOrExit()` → `getObservation()` → key-value output or "Observation not found" (exit 1) or "Invalid observation ID" (exit 1) (R9, S13–S16)
- [x] 6.4 Create `apps/cli/src/commands/memory/delete.ts` — `registerDeleteCommand(parent)` with `<id>` argument, `--force`. Handler: parse int, validate, `openMemoryOrExit()` → `getObservation()` → `confirmOrExit()` → `deleteObservation()` → success message (R10, S17–S24)
- [x] 6.5 Create `apps/cli/src/commands/memory/stats.ts` — `registerStatsCommand(parent)`. Handler: `openMemoryOrExit()` → `getStats()` + `fs.statSync(dbPath).size` → formatted sections output (R11, S25–S27)
- [x] 6.6 Create `apps/cli/src/commands/memory/clear.ts` — `registerClearCommand(parent)` with `--repo`, `--force`. Handler: `openMemoryOrExit()` → count observations → `confirmOrExit()` → `clearObservations()` → success message (R12, S28–S35)
- [x] 6.7 Register `memoryCommand` in `apps/cli/src/index.ts` — import from `'./commands/memory/index.js'`, add `program.addCommand(memoryCommand)` after existing commands (S46)

## Phase 7: CLI — Unit Tests

- [x] 7.1 Create `apps/cli/src/commands/memory/utils.test.ts` — test `formatTable()` alignment, `formatSize()` thresholds (bytes/KB/MB), `formatId()` zero-padding, `truncate()` with short and long strings
- [x] 7.2 Create `apps/cli/src/commands/memory/list.test.ts` — mock `ghagga-core` and `node:fs`. Test: happy path table output, `--repo` filter, `--type` filter, `--limit`, empty results message, no DB file message (S1–S7)
- [x] 7.3 Create `apps/cli/src/commands/memory/search.test.ts` — mock `ghagga-core`, `node:fs`, `resolveProjectId`. Test: happy path numbered results, explicit `--repo`, inferred `--repo` from git, `--limit`, empty results, no DB file (S8–S12)
- [x] 7.4 Create `apps/cli/src/commands/memory/show.test.ts` — mock `ghagga-core`, `node:fs`. Test: happy path all fields displayed, not found (exit 1), invalid ID "abc" (exit 1), no DB file (exit 0) (S13–S16)
- [x] 7.5 Create `apps/cli/src/commands/memory/delete.test.ts` — mock `ghagga-core`, `node:fs`, `readline/promises`, `process.stdin.isTTY`. Test: happy path with "y", cancel with "n", `--force` skips prompt, not found (exit 1), non-TTY without force (exit 1), non-TTY with force, invalid ID, no DB file (S17–S24, S48)
- [x] 7.6 Create `apps/cli/src/commands/memory/stats.test.ts` — mock `ghagga-core`, `node:fs` (`statSync`). Test: happy path full output, empty DB with "(none)" sections, no DB file (S25–S27)
- [x] 7.7 Create `apps/cli/src/commands/memory/clear.test.ts` — mock `ghagga-core`, `node:fs`, `readline/promises`, `process.stdin.isTTY`. Test: happy path all, scoped `--repo`, cancel, `--force`, no observations (no prompt, exit 0), non-TTY without force (exit 1), non-TTY with force, no DB file (S28–S35, S49)

## Phase 8: Verification — Build, Test, Compile

- [x] 8.1 Run `pnpm tsc --noEmit` across the monorepo to verify all types compile (no TS errors in core, server, cli)
- [x] 8.2 Run `pnpm test` in `packages/core` — all existing + new SQLite tests pass
- [x] 8.3 Run `pnpm test` in `apps/cli` — all existing + new CLI tests pass
- [x] 8.4 Run `pnpm test` in `apps/server` — all existing tests pass (Postgres stubs compile)
- [x] 8.5 Manually verify `ghagga memory --help` shows all 6 subcommands with descriptions (S45)
- [x] 8.6 Manually verify `ghagga memory list --help`, `ghagga memory delete --help` show all options and arguments (S45)
- [x] 8.7 Run Stryker mutation testing on `packages/core/src/memory/sqlite.ts` covering the 5 new methods — target >80% mutation score
