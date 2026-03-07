# Tasks: Memory Detail View — Severity Expansion + Dashboard UI Enhancements

## Phase 1: Backend — Database Schema & Migration

- [ ] 1.1 Add `severity: varchar('severity', { length: 10 })` to `memoryObservations` table in `packages/db/src/schema.ts` — nullable, no default, positioned after `content` column (Spec R2, Scenario S4-S5)
- [ ] 1.2 Create migration file `packages/db/drizzle/0006_add_severity_column.sql` with `ALTER TABLE "memory_observations" ADD COLUMN "severity" varchar(10);` — update `drizzle/meta/_journal.json` entry (Spec R2)
- [ ] 1.3 Add `severity TEXT` to SQLite `CREATE TABLE IF NOT EXISTS memory_observations` in `packages/core/src/memory/sqlite.ts` (Spec R3, Scenario S6)
- [ ] 1.4 Add `ALTER TABLE memory_observations ADD COLUMN severity TEXT` migration in SQLite initialization (try/catch for idempotency) in `packages/core/src/memory/sqlite.ts` (Spec R3, Scenarios S7-S8, Design Decision 7)
- [ ] 1.5 Write tests for SQLite migration idempotency — create DB, init twice, verify no error; verify column exists after migration (Scenarios S6-S8)

## Phase 2: Backend — Type Definitions

- [ ] 2.1 Add `severity: string | null` to `MemoryObservationRow` interface in `packages/core/src/types.ts` (Spec R5)
- [ ] 2.2 Add `severity: string | null` to `MemoryObservationDetail` interface in `packages/core/src/types.ts` (Spec R5)
- [ ] 2.3 Add `severity?: string` to `saveObservation` data parameter in `MemoryStorage` interface in `packages/core/src/types.ts` (Spec R4)

## Phase 3: Backend — Persistence Pipeline

- [ ] 3.1 Update `isSignificantFinding()` in `packages/core/src/memory/persist.ts` to include `finding.severity === 'medium'` (Spec R1, Scenarios S1-S3)
- [ ] 3.2 Update `persistReviewObservations()` in `packages/core/src/memory/persist.ts` to pass `severity: finding.severity` in `saveObservation()` calls for finding observations (Spec R4, Scenarios S9-S10)
- [ ] 3.3 Update `saveObservation()` in `packages/db/src/queries.ts` to include `severity` in INSERT and topic-key upsert SET clause (Spec R4, Scenarios S4, S9, S11)
- [ ] 3.4 Update `saveObservation()` in `packages/core/src/memory/sqlite.ts` to include `severity` in INSERT statement (Spec R4)
- [ ] 3.5 Update existing tests in `packages/core/src/memory/persist.test.ts` — verify medium severity findings are now persisted; verify `saveObservation` receives `severity` field; add test for low/info exclusion (Scenarios S1-S3, S9-S10)
- [ ] 3.6 Update tests in `packages/db/src/queries.test.ts` for `saveObservation` — verify severity is included in INSERT, verify topic-key upsert updates severity (Scenarios S4, S11)

## Phase 4: Backend — Query Updates

- [ ] 4.1 Verify `getObservationsBySession()` in `packages/db/src/queries.ts` returns severity — it uses `db.select()` which returns all columns, so the new column should be included automatically. If it uses specific column selection, add `severity` (Spec R6, Scenario S13)
- [ ] 4.2 Enhance `getSessionsByProject()` in `packages/db/src/queries.ts` to include severity distribution — add conditional count columns: `criticalCount`, `highCount`, `mediumCount` using `count(case when severity = X then 1 end)` (Spec R6, Scenario S14, Design Decision 6)
- [ ] 4.3 Update `mapToDetail()` in `packages/core/src/memory/sqlite.ts` to include `severity: (row['severity'] as string) ?? null` (Spec R6, Scenarios S15-S16)
- [ ] 4.4 Update `searchObservations()` in `packages/core/src/memory/sqlite.ts` to include `severity` in the SELECT query and return it in `MemoryObservationRow` results
- [ ] 4.5 Update `searchObservations()` in `packages/db/src/queries.ts` to include `severity` in returned results if using specific column selection
- [ ] 4.6 Write/update tests for `getObservationsBySession` — verify severity is present in results (Scenario S13)
- [ ] 4.7 Write/update tests for `getSessionsByProject` — verify severity count columns are present and correct (Scenario S14)
- [ ] 4.8 Write/update tests for `mapToDetail` — verify severity mapping for non-null and null values (Scenarios S15-S16)

## Phase 5: Dashboard — Type Updates & Utilities

- [ ] 5.1 Extend `Observation` interface in `apps/dashboard/src/lib/types.ts` with `severity: string | null`, `topicKey: string | null`, `revisionCount: number`, `updatedAt: string` (Spec R5, Scenario S12)
- [ ] 5.2 Extend `MemorySession` interface in `apps/dashboard/src/lib/types.ts` with `criticalCount: number`, `highCount: number`, `mediumCount: number` (Spec R5)
- [ ] 5.3 Create `formatRelativeTime(dateStr: string): string` utility function using `Intl.RelativeTimeFormat` — place in `apps/dashboard/src/lib/utils.ts` or similar (Spec R15, Design Decision 4)
- [ ] 5.4 Write tests for `formatRelativeTime` — cover recent (minutes ago), hours ago, days ago, months ago, edge cases (Scenarios S40-S41)
- [ ] 5.5 Create severity type guard utility: `isValidSeverity(s: string | null): s is Finding['severity']` for safe `SeverityBadge` usage (CC2)

## Phase 6: Dashboard — ObservationCard Enhancements

- [ ] 6.1 Add `SeverityBadge` to `ObservationCard` in `apps/dashboard/src/pages/Memory.tsx` — render conditionally when `observation.severity` is a valid severity string; position in card header next to type badge (Spec R7, Scenarios S17-S18)
- [ ] 6.2 Add revision count badge to `ObservationCard` — show "N revisions" chip when `revisionCount > 1`; use muted styling (Spec R9, Scenarios S21-S22)
- [ ] 6.3 Update file paths display in `ObservationCard` — render as styled chips with `font-mono`; truncate to first 3-5 paths with "+N more" indicator for large sets (Spec R9, Scenarios S24, S43)
- [ ] 6.4 Update content display in `ObservationCard` — add `font-mono whitespace-pre-wrap` styling for code-like formatting (Spec R9)
- [ ] 6.5 Add relative timestamps to `ObservationCard` — replace or supplement absolute date with `formatRelativeTime()`; add full date as `title` attribute tooltip (Spec R9, Scenario S23)
- [ ] 6.6 Make `ObservationCard` clickable — add `onClick` handler to open the detail modal; add `cursor-pointer` and hover state (Spec R10, Scenario S25)
- [ ] 6.7 Write tests for enhanced `ObservationCard` — verify severity badge, revision badge, file chips, relative time, click handler (Scenarios S17-S18, S21-S24)

## Phase 7: Dashboard — SessionItem Enhancements

- [ ] 7.1 Add PR link to `SessionItem` in `apps/dashboard/src/pages/Memory.tsx` — render "PR #N" as clickable link to `https://github.com/{project}/pull/{prNumber}`; open in new tab; hide when `prNumber` is 0 or absent (Spec R8, Scenarios S19-S20)
- [ ] 7.2 Add severity summary to `SessionItem` — display colored count indicators for critical/high/medium using the session's severity count fields; hide when all counts are 0 (Spec R14, Scenarios S38-S39)
- [ ] 7.3 Write tests for enhanced `SessionItem` — verify PR link rendering and href, severity summary display (Scenarios S19-S20, S38-S39)

## Phase 8: Dashboard — Observation Detail Modal

- [ ] 8.1 Create `apps/dashboard/src/components/ObservationDetailModal.tsx` — portal-based modal following `ConfirmDialog` pattern: backdrop, centered, Escape/backdrop-click to close (Spec R10, Design Decision 5)
- [ ] 8.2 Implement modal content layout — title heading, severity badge (conditional), type badge, full content with `font-mono whitespace-pre-wrap`, file paths list, topic key (conditional), revision info (conditional), created/updated timestamps (Spec R10, Scenarios S26-S27)
- [ ] 8.3 Handle scrollable content — add `max-h-[80vh] overflow-y-auto` to modal body for long content (Edge case E1, Scenario S42)
- [ ] 8.4 Wire modal state in `Memory.tsx` — add `selectedObservation: Observation | null` state; pass to `ObservationDetailModal`; trigger from ObservationCard click (Spec R10)
- [ ] 8.5 Write tests for `ObservationDetailModal` — open/close (S25, S28-S29), all fields displayed (S26), NULL fields handled (S27), scroll for long content (S42)

## Phase 9: Dashboard — Stats Bar

- [ ] 9.1 Implement stats bar section in `apps/dashboard/src/pages/Memory.tsx` — horizontal bar above observations list; display total count, severity breakdown chips, type breakdown chips (Spec R11, Scenario S30)
- [ ] 9.2 Compute stats from filtered observations — derive counts from the current filtered observation list (after applying severity + type filters); update dynamically (Spec R11, Scenario S31)
- [ ] 9.3 Style severity chips using SeverityBadge colors — critical=red, high=orange, medium=yellow; type chips use neutral styling (CC4)
- [ ] 9.4 Write tests for stats bar — verify total count, severity chip counts, type chip counts, updates with filter changes (Scenarios S30-S31, S44)

## Phase 10: Dashboard — Severity Filter & Sort Options

- [ ] 10.1 Add severity filter dropdown to Memory page — position alongside existing type filter; options: "All severities", "Critical", "High", "Medium", "Low", "Info"; default "All severities" (Spec R12, Scenarios S32-S34)
- [ ] 10.2 Implement client-side severity filtering — filter observation list by `observation.severity === selectedSeverity`; "All" shows everything including NULL severity (Spec R12, CC1)
- [ ] 10.3 Add sort options to Memory page — dropdown or buttons: "Newest first" (default), "Oldest first", "Severity", "Most revised" (Spec R13, Scenarios S35-S37)
- [ ] 10.4 Implement sort comparators — date sort by `createdAt`; severity sort order: critical=5 > high=4 > medium=3 > low=2 > info=1 > null=0; revision sort by `revisionCount` desc (Spec R13)
- [ ] 10.5 Wire filter + sort together — apply filter first, then sort; both operate on the observation list for the current session (Design Decision 3)
- [ ] 10.6 Write tests for severity filter — single filter (S32), NULL severity with "All" (S33), combined filter (S34), empty results (S45)
- [ ] 10.7 Write tests for sort options — severity sort (S35), revision sort (S36), default sort (S37)

## Phase 11: Verification

- [ ] 11.1 Run full test suite (`pnpm test`) — verify all new tests pass and all existing tests still pass
- [ ] 11.2 Run TypeScript type checking (`pnpm typecheck` or `tsc --noEmit`) — verify no type errors across the monorepo
- [ ] 11.3 Run linter (`pnpm lint`) — verify no lint violations in new/modified files
- [ ] 11.4 Verify all 45 scenarios (S1-S45) are covered by tests or verifiable through code inspection
- [ ] 11.5 Verify no new npm dependencies were added (check all `package.json` files)
