# Tasks: Delete Repo Reviews

## Phase 1: Database Layer

- [x] 1.1 Add `deleteReviewsByRepoId` function to `packages/db/src/queries.ts`
  - Add under the `// ─── Reviews` section, after `getReviewsByDay`
  - Signature: `deleteReviewsByRepoId(db: Database, repositoryId: number): Promise<number>`
  - Use `db.delete(reviews).where(eq(reviews.repositoryId, repositoryId)).returning({ id: reviews.id })` and return `result.length`
  - Follow the same pattern as `clearMemoryObservationsByProject` (delete + returning + count)

- [x] 1.2 Add tests for `deleteReviewsByRepoId` in `packages/db/src/queries.test.ts`
  - Import `deleteReviewsByRepoId` in the test imports
  - Add `describe('deleteReviewsByRepoId', ...)` block with tests:
    - Returns count of deleted rows when reviews exist (mock returning `[{ id: 1 }, { id: 2 }]` → returns `2`)
    - Returns `0` when no reviews exist (mock returning `[]` → returns `0`)
    - Calls `db.delete` with reviews table and correct `where` clause
  - Follow the existing `deleteMemoryObservation` test pattern using `createMockDb`

- [x] 1.3 Export `deleteReviewsByRepoId` from the `ghagga-db` package entry point
  - Check `packages/db/src/index.ts` (or wherever the barrel export is) and add the export

## Phase 2: Server API Endpoint

- [x] 2.1 Add `DELETE /api/reviews/:repoFullName` route to `apps/server/src/routes/api/reviews.ts`
  - Import `deleteReviewsByRepoId` and `clearMemoryObservationsByProject` from `ghagga-db`
  - Add route after the existing `GET /api/stats` route, before `return router`
  - Authorization: look up repo by `decodeURIComponent(c.req.param('repoFullName'))`, check 404/403 (same pattern as GET routes)
  - Parse `includeMemory` from `c.req.query('includeMemory') === 'true'`
  - Call `deleteReviewsByRepoId(db, repo.id)` → get `deletedReviews` count
  - If `includeMemory`, call `clearMemoryObservationsByProject(db, repo.installationId, repoFullName)` → get `clearedMemory` count
  - Return `{ data: { deletedReviews, clearedMemory: includeMemory ? clearedMemory : null } }`
  - Wrap in try/catch: on error return `500` with `{ error: 'DELETE_FAILED', message: 'Failed to delete reviews', errorId }` (use `generateErrorId()`)
  - Log error with `logger.error` including `errorId` for correlation

- [x] 2.2 Create tests for the DELETE endpoint in `apps/server/src/routes/api.test.ts`
  - Test scenarios from server spec:
    - Happy path: returns 200 with `{ data: { deletedReviews: N, clearedMemory: null } }`
    - With `includeMemory=true`: returns 200 with both counts
    - Without `includeMemory` (default): `clearedMemory` is `null`, memory untouched
    - Zero reviews: returns 200 with `{ data: { deletedReviews: 0, clearedMemory: null } }`
    - Repo not found: returns 404
    - User lacks access (installationId mismatch): returns 403, no reviews deleted
    - Unauthenticated: returns 401
    - DB error: returns 500 with `errorId`
    - Memory clear fails but reviews deleted: returns 500 with `errorId`
  - Follow existing test patterns in the project (check `apps/server/src/routes/api/` for any test files to match style)

## Phase 3: Dashboard API Hook

- [ ] 3.1 Add `useDeleteRepoReviews` mutation hook to `apps/dashboard/src/lib/api.ts`
  - Add in the `// ─── Reviews` section, after `useReviews`
  - Use `useMutation` with:
    - `mutationFn`: accepts `{ repoFullName: string; includeMemory?: boolean }`, calls `fetchData<{ deletedReviews: number; clearedMemory: number | null }>` with `DELETE /api/reviews/${encodeURIComponent(repoFullName)}` and optional `?includeMemory=true` query param
    - `onSuccess`: invalidate `['reviews']` and `['stats', variables.repoFullName]` always; invalidate `['memory']` only when `variables.includeMemory` is true
  - Follow the exact pattern from the proposal (already validated in spec)

## Phase 4: Dashboard UI

- [ ] 4.1 Add "Delete Reviews" button and confirmation dialog to `apps/dashboard/src/pages/Reviews.tsx`
  - Import `ConfirmDialog` from `@/components/ConfirmDialog`
  - Import `useDeleteRepoReviews` from `@/lib/api`
  - Add state: `const [showDeleteDialog, setShowDeleteDialog] = useState(false)` and `const [includeMemory, setIncludeMemory] = useState(false)`
  - Initialize mutation: `const deleteReviews = useDeleteRepoReviews()`
  - Add "Delete Reviews" button in the filters bar, visible only when `selectedRepo` is truthy (not "All repositories")
  - Style as danger/destructive: `btn-danger` or red-themed button
  - On click: `setShowDeleteDialog(true)`
  - Add `ConfirmDialog` at the bottom of the component with:
    - `open={showDeleteDialog}`
    - `title={`Delete all reviews for ${selectedRepo}?`}`
    - `description`: explain permanent deletion of review history and stats
    - `confirmText={selectedRepo}` (Tier 2 — user types exact repo name)
    - `confirmLabel="Delete Reviews"`
    - `confirmVariant="danger"`
    - `isLoading={deleteReviews.isPending}`
    - `error={deleteReviews.error?.message ?? null}`
    - `onConfirm`: call `deleteReviews.mutate({ repoFullName: selectedRepo, includeMemory }, { onSuccess: () => setShowDeleteDialog(false) })`
    - `onCancel`: `setShowDeleteDialog(false)` and `deleteReviews.reset()`
  - Add "Also clear memory observations" checkbox inside the dialog description area
    - The `ConfirmDialog` component doesn't natively support children/extra content, so add the checkbox to the `description` prop as a React node, or add the checkbox outside/below the dialog description — check if `description` accepts `ReactNode` or only `string`
    - If `description` is string-only: render the checkbox separately below the `ConfirmDialog` by adding it as a sibling element inside the dialog portal, OR extend the dialog with a `children` prop
    - Simplest approach: pass the checkbox state via a separate piece of state and render it in the description text, then add the checkbox as a custom element. Since the `ConfirmDialog` doesn't support `children`, the cleanest approach is to add an optional `children?: ReactNode` prop to `ConfirmDialog` to render between description and the confirm input

- [ ] 4.2 Add optional `children` prop to `ConfirmDialog` in `apps/dashboard/src/components/ConfirmDialog.tsx`
  - Add `children?: React.ReactNode` to `ConfirmDialogProps`
  - Render `{children}` between the description `<p>` and the error message / confirm input section
  - This allows the Reviews page to pass the "Also clear memory" checkbox as children

- [ ] 4.3 Add tests for the delete button and confirmation flow in `apps/dashboard/src/pages/Reviews.test.tsx`
  - Test scenarios from dashboard-ui spec:
    - "Delete Reviews" button visible when a repo is selected
    - "Delete Reviews" button hidden when "All repositories" is selected
    - Clicking button opens Tier 2 `ConfirmDialog` with correct title and confirmText
    - Confirm button disabled until user types exact repo name
    - Successful deletion without memory clear: calls mutation with `includeMemory: false`, dialog closes
    - Successful deletion with memory clear: calls mutation with `includeMemory: true`
    - Loading state: confirm button shows spinner, buttons disabled
    - Error state: dialog stays open, error message displayed
    - Cancel closes dialog without API call
  - If no test file exists yet, create it following patterns from `ConfirmDialog.test.tsx`

## Verification

- [ ] 5.1 Run full test suite and verify all existing + new tests pass
  - `pnpm test` from project root (or equivalent test command)
  - Verify no regressions in existing tests
  - Verify new tests cover all spec scenarios
