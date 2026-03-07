# Tasks: Dashboard Memory Management — Full-Stack Delete/Clear/Purge

## Phase 1: Database Layer

- [x] 1.1 Add `deleteMemoryObservation(db, installationId, observationId)` to `packages/db/src/queries.ts` — uses Drizzle `inArray` subquery to scope by installation, returns `boolean` (Spec R1, Scenarios S1-S3)
- [x] 1.2 Add `clearMemoryObservationsByProject(db, installationId, project)` to `packages/db/src/queries.ts` — deletes all observations for a project scoped by installation, returns `number` count (Spec R2, Scenarios S4-S6)
- [x] 1.3 Add `clearAllMemoryObservations(db, installationId)` to `packages/db/src/queries.ts` — deletes all observations for all repos belonging to the installation, returns `number` count (Spec R3, Scenarios S7-S8)
- [x] 1.4 Add `getMemoryObservation(db, installationId, observationId)` to `packages/db/src/queries.ts` — returns `MemoryObservationDetail | null` scoped by installation (needed by adapter method `getObservation`)
- [x] 1.5 Add `listMemoryObservations(db, installationId, options?)` to `packages/db/src/queries.ts` — returns `MemoryObservationDetail[]` with optional project/type/limit/offset filtering, scoped by installation (Spec R7, Scenario S22)
- [x] 1.6 Add `getMemoryStats(db, installationId)` to `packages/db/src/queries.ts` — returns `MemoryStats` with totalObservations, byType, byProject, oldest/newest dates (Spec R7, Scenario S26)
- [x] 1.7 Export all 6 new functions from `packages/db/src/index.ts` barrel file
- [x] 1.8 Write tests for `deleteMemoryObservation` in `packages/db/src/queries.test.ts` — cover S1 (success), S2 (not found), S3 (IDOR prevention)
- [x] 1.9 Write tests for `clearMemoryObservationsByProject` in `packages/db/src/queries.test.ts` — cover S4 (success with count), S5 (empty no-op), S6 (different installation)
- [x] 1.10 Write tests for `clearAllMemoryObservations` in `packages/db/src/queries.test.ts` — cover S7 (multi-repo purge), S8 (empty no-op)
- [x] 1.11 Write tests for `getMemoryObservation`, `listMemoryObservations`, `getMemoryStats` in `packages/db/src/queries.test.ts` — cover filtering, scoping, null returns

## Phase 2: Server Layer — API Routes

- [x] 2.1 Add `DELETE /api/memory/observations` (purge-all) route to `apps/server/src/routes/api.ts` — iterates `user.installationIds`, calls `clearAllMemoryObservations` for each, sums results; register BEFORE the `:id` route (Design Decision 3, Spec R6, Scenarios S18-S21)
- [x] 2.2 Add `DELETE /api/memory/observations/:id` route to `apps/server/src/routes/api.ts` — parses `:id` as int, returns 400 for invalid, tries each `user.installationIds`, returns 200/404 (Spec R4, Scenarios S9-S12)
- [x] 2.3 Add `DELETE /api/memory/projects/:project/observations` route to `apps/server/src/routes/api.ts` — URL-decodes `:project`, looks up repo, verifies installation ownership (403), calls `clearMemoryObservationsByProject` (Spec R5, Scenarios S13-S17)
- [x] 2.4 Add import statements for new `ghagga-db` query functions in `apps/server/src/routes/api.ts`
- [x] 2.5 Write tests for `DELETE /api/memory/observations/:id` in `apps/server/src/routes/api.test.ts` — cover S9 (200 happy path), S10 (401 unauth), S11 (404 not found), S12 (400 invalid ID)
- [x] 2.6 Write tests for `DELETE /api/memory/projects/:project/observations` in `apps/server/src/routes/api.test.ts` — cover S13 (200 happy path), S14 (401), S15 (404 repo not found), S16 (403 forbidden), S17 (200 with 0 cleared)
- [x] 2.7 Write tests for `DELETE /api/memory/observations` (purge-all) in `apps/server/src/routes/api.test.ts` — cover S18 (200 happy path), S19 (401), S20 (200 with 0), S21 (multi-installation sum)

## Phase 3: Server Layer — PostgresMemoryStorage Adapter

- [x] 3.1 Extend `PostgresMemoryStorage` constructor in `apps/server/src/memory/postgres.ts` to accept `installationId: number` as second parameter, store as private field (Design Decision 1)
- [x] 3.2 Replace `listObservations` stub with delegation to `listMemoryObservations(this.db, this.installationId, options)` (Spec R7, Scenario S22)
- [x] 3.3 Replace `getObservation` stub with delegation to `getMemoryObservation(this.db, this.installationId, id)` (Scenarios S23-S24)
- [x] 3.4 Replace `deleteObservation` stub with delegation to `deleteMemoryObservation(this.db, this.installationId, id)` (Scenario S25)
- [x] 3.5 Replace `getStats` stub with delegation to `getMemoryStats(this.db, this.installationId)` (Scenario S26)
- [x] 3.6 Replace `clearObservations` stub — if `options?.project` set, delegate to `clearMemoryObservationsByProject`, otherwise delegate to `clearAllMemoryObservations` (Scenarios S27-S28)
- [x] 3.7 Add imports for all new `ghagga-db` query functions in `apps/server/src/memory/postgres.ts`
- [x] 3.8 Update `new PostgresMemoryStorage(db)` call in `apps/server/src/inngest/review.ts` (line 250) to pass `installationId` from the Inngest event context
- [x] 3.9 Replace stub-throws tests in `apps/server/src/memory/postgres.test.ts` with delegation tests — verify each method calls the correct `ghagga-db` function with correct args (Scenarios S22-S28)

## Phase 4: Dashboard — API Client Hooks

- [x] 4.1 Add `useDeleteObservation` mutation hook to `apps/dashboard/src/lib/api.ts` — `DELETE /api/memory/observations/:id`, invalidates `['memory', 'observations']` and `['memory', 'sessions']` query keys (Spec R11.1, Scenario S41)
- [x] 4.2 Add `useClearRepoMemory` mutation hook to `apps/dashboard/src/lib/api.ts` — `DELETE /api/memory/projects/${encodeURIComponent(project)}/observations`, invalidates same keys (Spec R11.2, Scenario S42)
- [x] 4.3 Add `usePurgeAllMemory` mutation hook to `apps/dashboard/src/lib/api.ts` — `DELETE /api/memory/observations`, invalidates all `['memory']` keys (Spec R11.3, Scenario S43)
- [x] 4.4 Write tests for all 3 mutation hooks in `apps/dashboard/src/lib/api.test.ts` — verify correct HTTP method, path, URL encoding, and cache invalidation keys

## Phase 5: Dashboard — Reusable Components

- [x] 5.1 Create `apps/dashboard/src/components/Toast.tsx` — implement `ToastProvider` (React Context), `useToast()` hook, and `ToastContainer` (portal to document.body, fixed bottom-right) with success/error/info variants, auto-dismiss via setTimeout, and vertical stacking (~80 lines, Design Decision 5)
- [x] 5.2 Write tests for Toast system in `apps/dashboard/src/components/Toast.test.tsx` — cover rendering, auto-dismiss timing (vi.useFakeTimers), stacking multiple toasts, type variants (Spec R14, Scenarios S48-S49)
- [x] 5.3 Create `apps/dashboard/src/components/ConfirmDialog.tsx` — single component handling all 3 tiers via props: `confirmText?` (Tier 2+), `countdownSeconds?` (Tier 3); portal rendering, backdrop click to close, Escape key handling, loading state, error display (Design Decision 4, ~120 lines)
- [x] 5.4 Write tests for ConfirmDialog Tier 1 in `apps/dashboard/src/components/ConfirmDialog.test.tsx` — open/close, confirm callback, cancel callback, Escape key, backdrop click (Scenarios S29-S31)
- [x] 5.5 Write tests for ConfirmDialog Tier 2 in `apps/dashboard/src/components/ConfirmDialog.test.tsx` — text input matching (case-sensitive), button enable/disable, partial match stays disabled (Scenarios S32-S34)
- [x] 5.6 Write tests for ConfirmDialog Tier 3 in `apps/dashboard/src/components/ConfirmDialog.test.tsx` — countdown timer display, dual conditions (text + countdown), reset on close/reopen, vi.useFakeTimers for countdown (Scenarios S35-S40)

## Phase 6: Dashboard — Memory Page Integration

- [x] 6.1 Add `ToastProvider` to the app root (determine correct location: `App.tsx` or `main.tsx`) — wrap existing component tree
- [x] 6.2 Add trash icon button to each `ObservationCard` in `apps/dashboard/src/pages/Memory.tsx` — top-right corner, uses existing icon pattern (Spec R8)
- [x] 6.3 Wire Tier 1 confirmation: clicking trash icon opens ConfirmDialog with title "Delete observation", observation title in description, "Delete" confirm label with danger variant — on confirm calls `useDeleteObservation`, on success shows toast "Observation deleted" (Scenarios S29-S31)
- [x] 6.4 Add "Clear Memory" button in session header area (visible when a repo is selected) in `apps/dashboard/src/pages/Memory.tsx` — wire Tier 2 confirmation: modal with repo name text input, count in description, "Clear Memory" confirm label (Spec R9, Scenarios S32-S34)
- [x] 6.5 Add "Purge All Memory" button in page header / danger zone area in `apps/dashboard/src/pages/Memory.tsx` — wire Tier 3 confirmation: "DELETE ALL" text input + 5-second countdown, "Purge All" confirm label (Spec R10, Scenarios S35-S40)
- [x] 6.6 Implement loading states: spinner/disabled button during mutations, error display in modal on failure, re-enable on error (Spec R12, Scenarios S44-S46)
- [x] 6.7 Implement empty states: after clearing a repo show "No memory sessions for this repository", after purging all show "No memory yet" message (CC3)
- [x] 6.8 Write integration tests in `apps/dashboard/src/pages/Memory.test.tsx` — test delete button rendering, modal triggers for all 3 tiers, success flow with mocked hooks, error handling, empty states (Scenarios S29, S32, S35, S44-S46, S47)

## Phase 7: Verification

- [x] 7.1 Run full test suite (`pnpm test`) — verify all new tests pass and all existing 1,532+ tests still pass
- [x] 7.2 Run TypeScript type checking (`pnpm typecheck` or `tsc --noEmit`) — verify no type errors across the monorepo
- [x] 7.3 Run linter (`pnpm lint`) — verify no lint violations in new/modified files
- [x] 7.4 Manual scenario walkthrough: verify all 56 scenarios (S1-S56) are covered by tests or verifiable through code inspection

## Phase 8: Bug Fixes & Session Deletion (Full-Stack)

- [x] 8.1 Fix `createSession` timing in `packages/core/src/memory/persist.ts` — move call to AFTER filtering significant findings, early return if none; update 5 tests in `persist.test.ts`
- [x] 8.2 Fix dedup sessionId reassignment in `packages/db/src/queries.ts` and `packages/core/src/memory/sqlite.ts` — when dedup finds existing with different sessionId, update to new sessionId
- [x] 8.3 Add `ON DELETE CASCADE` to `memoryObservations.sessionId` FK in `packages/db/src/schema.ts` and `packages/core/src/memory/sqlite.ts`
- [x] 8.4 Add `deleteMemorySession(db, installationId, sessionId)` and `clearEmptyMemorySessions(db, installationId, project?)` to `packages/db/src/queries.ts` with tests
- [x] 8.5 Add `DELETE /api/memory/sessions/empty` and `DELETE /api/memory/sessions/:id` routes to `apps/server/src/routes/api.ts` with tests
- [x] 8.6 Confirm no changes needed to `apps/server/src/memory/postgres.ts` — DELETE routes call DB queries directly
- [x] 8.7 Add `useDeleteSession()` and `useCleanupEmptySessions()` hooks to `apps/dashboard/src/lib/api.ts` with tests
- [x] 8.8 Wire session deletion into `apps/dashboard/src/pages/Memory.tsx` — delete button on SessionItem, "Clean up empty sessions" button, ConfirmDialogs with Tier 1/2 based on observation count
