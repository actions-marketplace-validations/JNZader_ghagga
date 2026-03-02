# Tasks: Settings Redesign — Provider Chain & Static-Only Mode

## Phase 1: Foundation (Types + Schema + Migration) ✅

- [x] 1.1 Add `ProviderChainEntry` and `SaaSProvider` types to `packages/core/src/types.ts`. Add optional `providerChain`, `aiReviewEnabled` fields to `ReviewInput`. Keep existing `provider`/`model`/`apiKey` fields for backward compat.
- [x] 1.2 Update `packages/db/src/schema.ts`: add `providerChain` (JSONB, default `[]`) and `aiReviewEnabled` (boolean, default `true`) columns to `repositories` table. Add `ProviderChainEntry` interface for the JSONB shape.
- [x] 1.3 Create Drizzle migration `packages/db/drizzle/0002_add_provider_chain.sql`: ALTER TABLE to add new columns + UPDATE to copy existing `llm_provider`/`llm_model`/`encrypted_api_key` into `provider_chain`. Do NOT drop old columns.
- [x] 1.4 Run migration against Neon DB. Verified 10 repos migrated correctly.
- [x] 1.5 Update `packages/db/src/queries.ts`: modify `updateRepoSettings()` to accept `providerChain` and `aiReviewEnabled` in the updates parameter.

## Phase 2: Server API Routes ✅

- [x] 2.1 Create `apps/server/src/lib/provider-models.ts`: curated model lists for Anthropic/Google + dynamic model fetching function for OpenAI/GitHub Models. Export `CURATED_MODELS`, `fetchProviderModels()`, `validateProviderKey()`.
- [x] 2.2 Add `GET /api/settings?repo={fullName}` route in `apps/server/src/routes/api.ts`: read repo + settings from DB, build `SettingsResponse` with `providerChain` mapped to `ProviderChainView[]` (mask keys, set `hasApiKey`). Never expose `encryptedApiKey`.
- [x] 2.3 Add `PUT /api/settings` route: parse `UpdateSettingsRequest`, validate no `'ollama'` in chain, merge API keys (preserve existing encrypted keys when no new `apiKey` provided, encrypt new keys), save to DB.
- [x] 2.4 Add `POST /api/providers/validate` route: accept `{ provider, apiKey? }`, reject `'ollama'`, for GitHub use session token from auth header, call `validateProviderKey()`, return `{ valid, models, error? }`.
- [x] 2.5 Update `apps/server/src/routes/webhook.ts`: read `provider_chain` and `ai_review_enabled` from repo, send them in the Inngest event data. Updated `inngest/client.ts` and `inngest/review.ts`.

## Phase 3: Core Pipeline Adaptation ✅

- [x] 3.1 Update `packages/core/src/pipeline.ts`: at the top of `reviewPipeline()`, normalize input — if `providerChain` is provided, use it; if not, build a single-entry chain from `provider`/`model`/`apiKey`. Check `aiReviewEnabled`.
- [x] 3.2 Add static-only path in pipeline: when `aiReviewEnabled === false` (or chain is empty), skip agent execution, return result with only static analysis findings. Set `status` based on finding severity, `metadata.provider = 'none'`, `metadata.model = 'static-only'`.
- [x] 3.3 Pipeline already uses `generateWithFallback()` from `providers/fallback.ts` — no changes needed to agents.
- [x] 3.4 Add graceful degradation: if all providers in the chain fail, return static analysis results with `status: 'NEEDS_HUMAN_REVIEW'` and a summary explaining AI review failed.
- [x] 3.5 Update `apps/server/src/inngest/review.ts`: read `providerChain` + `aiReviewEnabled` from event data, decrypt each entry's `encryptedApiKey`, build `ProviderChainEntry[]`, pass to `reviewPipeline()`. Legacy fallback for old events.

## Phase 4: Dashboard UI Rewrite ✅

- [x] 4.1 Update `apps/dashboard/src/lib/types.ts`: add `ProviderChainEntry`, `ProviderChainView`, `SaaSProvider`, `ValidationResponse` types. Update `RepositorySettings` to match new `SettingsResponse` shape.
- [x] 4.2 Update `apps/dashboard/src/lib/api.ts`: refactor `useSettings()` to call `GET /api/settings?repo=...` with `fetchData()` (envelope unwrap). Refactor `useUpdateSettings()` for new `PUT /api/settings` body shape. Add `useValidateProvider()` mutation hook. Remove `useSaveApiKey()`/`useDeleteApiKey()`.
- [x] 4.3 Create `apps/dashboard/src/components/settings/ProviderEntry.tsx`: single provider row with dropdown, API key input (hidden for GitHub), Validate + status, model dropdown, reorder/remove.
- [x] 4.4 Create `apps/dashboard/src/components/settings/ProviderChainEditor.tsx`: renders chain, add/remove/reorder, smart default provider.
- [x] 4.5 Rewrite `apps/dashboard/src/pages/Settings.tsx`: Static Analysis, AI Review toggle, ProviderChainEditor, Review Mode, Advanced, unified Save.
- [x] 4.6 Settings → form state mapping handled in Settings.tsx useEffect.

## Phase 5: Integration & Testing ✅

- [x] 5.1 Settings.tsx default provider fix subsumed by full rewrite.
- [x] 5.2 Full monorepo build (all 6 packages) — ✅ passes.
- [x] 5.3 All 351 tests pass across 5 packages.
- [x] 5.4 Provider fallback tested via fallback.test.ts (13 tests).
- [x] 5.5 Pushed to main — Render deploy triggered, GitHub Pages deploy triggered.

## Phase 6: Cleanup ✅

- [x] 6.1 `useSaveApiKey()` and `useDeleteApiKey()` removed in Phase 4.2.
- [x] 6.2 `POST /api/repositories/:id/api-key` and `DELETE /api/repositories/:id/api-key` removed.
- [x] 6.3 `PUT /api/repositories/:id/settings` legacy route removed.
- [x] 6.4 Zero references to old API routes across codebase — verified with grep.
