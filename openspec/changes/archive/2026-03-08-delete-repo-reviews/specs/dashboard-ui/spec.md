# Delta for Dashboard UI

> **Change**: `delete-repo-reviews`
> **Base spec**: `openspec/specs/dashboard-ui/spec.md`

## MODIFIED Requirements

### Requirement: Review History

The system MUST display a browsable, filterable list of past reviews, with the ability to delete all reviews for a selected repository.

(Previously: The system displayed review history as read-only — browsable and filterable, but with no delete capability.)

#### Scenario: Delete Reviews button visibility when a repo is selected

- GIVEN a logged-in user on the Reviews page
- AND a repository is selected in the repository filter dropdown
- WHEN the page renders
- THEN a "Delete Reviews" button MUST be visible in the filter/actions area

#### Scenario: Delete Reviews button hidden when no repo is selected

- GIVEN a logged-in user on the Reviews page
- AND the repository filter is set to "All repositories"
- WHEN the page renders
- THEN the "Delete Reviews" button MUST NOT be visible

#### Scenario: Tier 2 confirmation dialog opens on button click

- GIVEN a logged-in user on the Reviews page with repository "acme/widgets" selected
- WHEN the user clicks the "Delete Reviews" button
- THEN a `ConfirmDialog` MUST open with:
  - Title: "Delete all reviews for acme/widgets?"
  - Description explaining that all review history and stats for this repo will be permanently deleted
  - A text input requiring the user to type "acme/widgets" to confirm (Tier 2)
  - A checkbox labeled "Also clear memory observations for this repository" (default: unchecked)
  - Confirm button labeled "Delete Reviews" with `confirmVariant: "danger"`
  - Confirm button MUST be disabled until the user types the exact repo full name

#### Scenario: Confirm button disabled until repo name matches

- GIVEN the Tier 2 confirmation dialog is open for repository "acme/widgets"
- WHEN the user types "acme/widge" (incomplete)
- THEN the confirm button MUST remain disabled
- WHEN the user types "acme/widgets" (exact match)
- THEN the confirm button MUST become enabled

#### Scenario: Successful deletion without memory clear

- GIVEN the Tier 2 confirmation dialog is open for repository "acme/widgets"
- AND the "Also clear memory observations" checkbox is unchecked
- AND the user has typed "acme/widgets" in the confirmation input
- WHEN the user clicks the "Delete Reviews" button
- THEN the system MUST call the `useDeleteRepoReviews` mutation with `{ repoFullName: "acme/widgets", includeMemory: false }`
- AND on success, the `['reviews']` and `['stats', 'acme/widgets']` query keys MUST be invalidated
- AND the `['memory']` query keys MUST NOT be invalidated
- AND the confirmation dialog MUST close
- AND the reviews list MUST refresh to show the updated state (empty for that repo)

#### Scenario: Successful deletion with memory clear

- GIVEN the Tier 2 confirmation dialog is open for repository "acme/widgets"
- AND the "Also clear memory observations" checkbox is checked
- AND the user has typed "acme/widgets" in the confirmation input
- WHEN the user clicks the "Delete Reviews" button
- THEN the system MUST call the `useDeleteRepoReviews` mutation with `{ repoFullName: "acme/widgets", includeMemory: true }`
- AND on success, the `['reviews']`, `['stats', 'acme/widgets']`, AND `['memory']` query keys MUST be invalidated
- AND the confirmation dialog MUST close

#### Scenario: Deletion in progress shows loading state

- GIVEN the user has confirmed the deletion
- WHEN the API request is in flight
- THEN the confirm button MUST show a loading spinner
- AND the confirm button MUST be disabled
- AND the cancel button MUST be disabled
- AND the backdrop click and Escape key MUST NOT close the dialog

#### Scenario: Deletion fails and shows error

- GIVEN the user has confirmed the deletion
- AND the API returns an error
- WHEN the error is received
- THEN the confirmation dialog MUST display the error message
- AND the dialog MUST remain open so the user can retry or cancel

#### Scenario: Cancel closes dialog without side effects

- GIVEN the Tier 2 confirmation dialog is open
- WHEN the user clicks "Cancel" or presses Escape or clicks the backdrop
- THEN the dialog MUST close
- AND no API call MUST be made
- AND no query keys MUST be invalidated

## ADDED Requirements

### Requirement: Delete Repo Reviews API Hook

The system MUST provide a `useDeleteRepoReviews` mutation hook in `apps/dashboard/src/lib/api.ts` for deleting all reviews for a repository via the server API.

#### Scenario: Mutation calls correct API endpoint

- GIVEN the `useDeleteRepoReviews` hook is used
- WHEN `mutate({ repoFullName: "acme/widgets", includeMemory: false })` is called
- THEN the hook MUST send `DELETE /api/reviews/acme%2Fwidgets` (URL-encoded)
- AND the request MUST use the `fetchData` helper to unwrap the `{ data: ... }` envelope

#### Scenario: Mutation with includeMemory calls correct endpoint

- GIVEN the `useDeleteRepoReviews` hook is used
- WHEN `mutate({ repoFullName: "acme/widgets", includeMemory: true })` is called
- THEN the hook MUST send `DELETE /api/reviews/acme%2Fwidgets?includeMemory=true`

#### Scenario: Cache invalidation on success without memory

- GIVEN a successful deletion without `includeMemory`
- WHEN the mutation succeeds
- THEN the hook MUST invalidate `['reviews']` query key
- AND the hook MUST invalidate `['stats', 'acme/widgets']` query key
- AND the hook MUST NOT invalidate `['memory']` query keys

#### Scenario: Cache invalidation on success with memory

- GIVEN a successful deletion with `includeMemory: true`
- WHEN the mutation succeeds
- THEN the hook MUST invalidate `['reviews']` query key
- AND the hook MUST invalidate `['stats', 'acme/widgets']` query key
- AND the hook MUST invalidate `['memory']` query key
