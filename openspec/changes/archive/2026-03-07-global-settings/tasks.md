# Tasks: Global Settings with Per-Repo Override

## Phase 1: Database Schema + Migration

- [x] 1.1 Add `installationSettings` table to `packages/db/src/schema.ts` with `installationId` (FK, unique), `providerChain` (JSONB), `aiReviewEnabled` (boolean), `reviewMode` (varchar), `settings` (JSONB).
- [x] 1.2 Add `useGlobalSettings` boolean (default `true`) to `repositories` table in schema.ts.
- [x] 1.3 Create migration `packages/db/drizzle/0003_add_global_settings.sql`: CREATE TABLE + ALTER TABLE repositories ADD COLUMN + UPDATE to set `use_global_settings = false` WHERE provider_chain length > 0.
- [x] 1.4 Add query functions to `packages/db/src/queries.ts`: `getInstallationSettings()`, `upsertInstallationSettings()`, `getInstallationById()`.
- [x] 1.5 Add `getEffectiveRepoSettings()` helper that resolves global vs per-repo.
- [x] 1.6 Export new types and functions from `packages/db/src/index.ts`.
- [x] 1.7 Run migration against Neon. Verify repos with existing chains got `use_global_settings = false`.

## Phase 2: Server API Routes

- [x] 2.1 Add `GET /api/installations` route: returns installations the user has access to (id, accountLogin, accountType). Needed for the installation selector dropdown.
- [x] 2.2 Add `GET /api/installation-settings?installation_id=X` route: returns installation settings (masked keys) or defaults if no row exists. Verify user access.
- [x] 2.3 Add `PUT /api/installation-settings` route: validate, merge API keys, upsert row. Same merge logic as per-repo (preserve encrypted keys when not re-provided).
- [x] 2.4 Extend `GET /api/settings` response: add `useGlobalSettings` field + `globalSettings` object with the installation-level settings.
- [x] 2.5 Extend `PUT /api/settings` to accept `useGlobalSettings` boolean.
- [x] 2.6 Update `webhook.ts`: resolve effective settings using `getEffectiveRepoSettings()` before dispatching to Inngest.

## Phase 3: Dashboard UI

- [x] 3.1 Add types to `apps/dashboard/src/lib/types.ts`: `InstallationSettings`, `Installation`, extended `RepositorySettings` with `useGlobalSettings` + `globalSettings`.
- [x] 3.2 Add API hooks to `apps/dashboard/src/lib/api.ts`: `useInstallations()`, `useInstallationSettings()`, `useUpdateInstallationSettings()`.
- [x] 3.3 Create `apps/dashboard/src/pages/GlobalSettings.tsx`: installation selector (if multiple), reuses ProviderChainEditor + settings form, saves to installation endpoint.
- [x] 3.4 Update `apps/dashboard/src/components/Layout.tsx`: add "Global Settings" nav item with globe icon, placed before repo-specific Settings.
- [x] 3.5 Update `apps/dashboard/src/App.tsx`: add route for `/global-settings`.
- [x] 3.6 Update `apps/dashboard/src/pages/Settings.tsx`: add "Use global settings" toggle at the top. When ON: show read-only inherited view + "Edit in Global Settings" link. When OFF: show editable form (current behavior).

## Phase 4: Integration Testing + Deploy

- [x] 4.1 Build all packages, run all tests.
- [x] 4.2 Commit and push. Verify Render deploy + GitHub Pages deploy.
- [x] 4.3 Update tasks.md to mark all complete.
