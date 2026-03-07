# Tasks: Integration Test Suites

**Change ID:** e2e-integration-tests
**Created:** 2026-03-07

## Phase 1: Server Integration Tests

- [x] **T1**: Create `apps/server/src/__integration__/webhook-dispatch.integration.test.ts`
  - Implement S1.1-S1.5 from spec
  - Use `createWebhookRouter()` + `router.fetch()` for HTTP testing
  - Mock ghagga-db, inngest, github client
  - ~5 test cases

- [x] **T2**: Create `apps/server/src/__integration__/api-auth.integration.test.ts`
  - Implement S2.1-S2.5 from spec
  - Build a Hono app with auth middleware + API router
  - Mock `fetch` for GitHub /user endpoint
  - Mock ghagga-db for all query functions
  - ~5 test cases

## Phase 2: Core Pipeline Integration Test

- [x] **T3**: Create `packages/core/src/__integration__/pipeline.integration.test.ts`
  - Implement S3.1-S3.4 from spec
  - Mock agents, tools, memory modules
  - Verify full pipeline output shape and data flow
  - ~4 test cases

## Phase 3: Verification

- [x] **T4**: Run `pnpm exec turbo typecheck` — verify no type errors
- [x] **T5**: Run `pnpm exec turbo test` — verify all tests pass (new + existing)
- [x] **T6**: Report total test count and results
