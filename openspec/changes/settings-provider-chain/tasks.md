# Tasks: Settings Redesign — Provider Chain & Static-Only Mode

## Phase 1: Foundation (Types + Schema + Migration)

- [ ] 1.1 Add `ProviderChainEntry` and `SaaSProvider` types to `packages/core/src/types.ts`. Add optional `providerChain`, `aiReviewEnabled` fields to `ReviewInput`. Keep existing `provider`/`model`/`apiKey` fields for backward compat.
- [ ] 1.2 Update `packages/db/src/schema.ts`: add `providerChain` (JSONB, default `[]`) and `aiReviewEnabled` (boolean, default `true`) columns to `repositories` table. Add `ProviderChainEntry` interface for the JSONB shape.
- [ ] 1.3 Create Drizzle migration `packages/db/drizzle/XXXX_add_provider_chain.sql`: ALTER TABLE to add new columns + UPDATE to copy existing `llm_provider`/`llm_model`/`encrypted_api_key` into `provider_chain`. Do NOT drop old columns.
- [ ] 1.4 Run migration against Neon DB. Verify data migrated correctly with a quick SQL query.
- [ ] 1.5 Update `packages/db/src/queries.ts`: modify `updateRepoSettings()` to accept `providerChain` and `aiReviewEnabled` in the updates parameter.

## Phase 2: Server API Routes

- [ ] 2.1 Create `apps/server/src/lib/provider-models.ts`: curated model lists for Anthropic/Google + dynamic model fetching function for OpenAI/GitHub Models. Export `CURATED_MODELS`, `fetchProviderModels()`, `validateProviderKey()`.
- [ ] 2.2 Add `GET /api/settings?repo={fullName}` route in `apps/server/src/routes/api.ts`: read repo + settings from DB, build `SettingsResponse` with `providerChain` mapped to `ProviderChainView[]` (mask keys, set `hasApiKey`). Never expose `encryptedApiKey`.
- [ ] 2.3 Add `PUT /api/settings` route: parse `UpdateSettingsRequest`, validate no `'ollama'` in chain, merge API keys (preserve existing encrypted keys when no new `apiKey` provided, encrypt new keys), save to DB.
- [ ] 2.4 Add `POST /api/providers/validate` route: accept `{ provider, apiKey? }`, reject `'ollama'`, for GitHub use session token from auth header, call `validateProviderKey()`, return `{ valid, models, error? }`.
- [ ] 2.5 Update `apps/server/src/routes/webhook.ts`: read `provider_chain` and `ai_review_enabled` from repo, send them in the Inngest event data instead of flat `llmProvider`/`llmModel`/`encryptedApiKey`.

## Phase 3: Core Pipeline Adaptation

- [ ] 3.1 Update `packages/core/src/pipeline.ts`: at the top of `reviewPipeline()`, normalize input — if `providerChain` is provided, use it; if not, build a single-entry chain from `provider`/`model`/`apiKey`. Check `aiReviewEnabled`.
- [ ] 3.2 Add static-only path in pipeline: when `aiReviewEnabled === false` (or chain is empty), skip agent execution, return result with only static analysis findings. Set `status` based on finding severity, `metadata.provider = 'none'`, `metadata.model = 'static-only'`.
- [ ] 3.3 Refactor agent calls in pipeline to use `generateWithFallback()`: replace direct `createModel()` calls in `simple.ts`, `workflow.ts`, `consensus.ts` with the fallback chain. Accept `FallbackProvider[]` instead of single `provider`/`model`/`apiKey`.
- [ ] 3.4 Add graceful degradation: if all providers in the chain fail, return static analysis results with `status: 'NEEDS_HUMAN_REVIEW'` and a summary explaining AI review failed.
- [ ] 3.5 Update `apps/server/src/inngest/review.ts`: read `providerChain` + `aiReviewEnabled` from event data, decrypt each entry's `encryptedApiKey`, build `FallbackProvider[]`, pass to `reviewPipeline()`.

## Phase 4: Dashboard UI Rewrite

- [ ] 4.1 Update `apps/dashboard/src/lib/types.ts`: add `ProviderChainEntry`, `ProviderChainView`, `SaaSProvider`, `ValidationResponse` types. Update `RepositorySettings` to match new `SettingsResponse` shape.
- [ ] 4.2 Update `apps/dashboard/src/lib/api.ts`: refactor `useSettings()` to call `GET /api/settings?repo=...` with `fetchData()` (envelope unwrap). Refactor `useUpdateSettings()` for new `PUT /api/settings` body shape. Add `useValidateProvider()` mutation hook.
- [ ] 4.3 Create `apps/dashboard/src/components/settings/ProviderEntry.tsx`: single provider row component with provider dropdown (GitHub/Anthropic/OpenAI/Google), API key input (hidden for GitHub), Validate button + status indicator, model dropdown (disabled until validated, populated from validation response), remove button.
- [ ] 4.4 Create `apps/dashboard/src/components/settings/ProviderChainEditor.tsx`: renders list of `ProviderEntry` components, up/down arrows for reordering, "Add Fallback Provider" button, handles chain state as `ProviderChainUpdate[]`.
- [ ] 4.5 Rewrite `apps/dashboard/src/pages/Settings.tsx`: Static Analysis section (Semgrep/Trivy/CPD toggles, always visible), AI Review toggle, ProviderChainEditor (visible when AI on), Review Mode radio (visible when AI on), Custom Rules + Ignore Patterns, unified Save button.
- [ ] 4.6 Handle loaded settings → form state mapping: when settings load, populate AI toggle, build local chain state with `hasApiKey`/`maskedApiKey` (show as validated if key exists), pre-select models.

## Phase 5: Integration & Testing

- [ ] 5.1 Commit the Settings.tsx default provider fix (`'anthropic'` → `'github'`) that's currently uncommitted, as part of the first commit.
- [ ] 5.2 Test end-to-end locally: start server, open dashboard, select repo, verify settings load with migrated data, add a provider, validate, select model, save.
- [ ] 5.3 Test static-only mode: disable AI review in settings, trigger a review (or mock), verify only static analysis runs.
- [ ] 5.4 Test provider fallback: configure 2 providers, simulate primary failure (e.g., invalid key for primary), verify fallback kicks in.
- [ ] 5.5 Push to main, verify Render deploy succeeds, verify GitHub Pages dashboard works with new Settings page.

## Phase 6: Cleanup

- [ ] 6.1 Remove old `useSaveApiKey()` and `useDeleteApiKey()` hooks from `apps/dashboard/src/lib/api.ts` — API keys now managed inline in the provider chain.
- [ ] 6.2 Remove old `POST /api/repositories/:id/api-key` and `DELETE /api/repositories/:id/api-key` routes from `apps/server/src/routes/api.ts`.
- [ ] 6.3 Remove old `PUT /api/repositories/:id/settings` route (replaced by `PUT /api/settings`).
- [ ] 6.4 Update any references to old API routes in dashboard or tests.
