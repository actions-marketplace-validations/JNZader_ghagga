# Tasks: GHAGGA v2 - Complete Rewrite

## Phase 1: Monorepo Foundation

- [x] 1.1 Create root `package.json` with pnpm workspaces config, project metadata, and scripts
- [x] 1.2 Create `pnpm-workspace.yaml` defining `packages/*` and `apps/*` workspaces
- [x] 1.3 Create `turbo.json` with build/dev/lint/test pipeline configuration
- [x] 1.4 Create `tsconfig.base.json` with strict TypeScript settings shared across all packages
- [x] 1.5 Create `.gitignore` for Node.js, build outputs, env files, and tool caches
- [x] 1.6 Create `.env.example` at root with all required environment variables documented
- [x] 1.7 Create `packages/core/package.json` with dependencies (ai, @ai-sdk/anthropic, @ai-sdk/openai, @ai-sdk/google)
- [x] 1.8 Create `packages/core/tsconfig.json` extending base config
- [x] 1.9 Create `packages/db/package.json` with dependencies (drizzle-orm, drizzle-kit, pg)
- [x] 1.10 Create `packages/db/tsconfig.json` extending base config
- [x] 1.11 Create `apps/server/package.json` with dependencies (hono, inngest, @octokit/rest)
- [x] 1.12 Create `apps/server/tsconfig.json` extending base config
- [x] 1.13 Run `pnpm install` and verify all workspaces resolve correctly
- [x] 1.14 Create `packages/core/src/types.ts` with ReviewInput, ReviewResult, ReviewFinding, StaticAnalysisResult, ToolResult interfaces

## Phase 2: Database Layer (`packages/db`)

- [ ] 2.1 Create `packages/db/src/schema.ts` with Drizzle table definitions: installations, repositories, reviews, memorySessions, memoryObservations
- [ ] 2.2 Create `packages/db/src/client.ts` with database connection factory using `DATABASE_URL` env var
- [ ] 2.3 Create `packages/db/src/crypto.ts` with AES-256-GCM encrypt/decrypt functions for API keys (rescue logic from v1 `_shared/crypto/encryption.ts`)
- [ ] 2.4 Create `packages/db/drizzle.config.ts` for migration generation
- [ ] 2.5 Generate initial migration with `drizzle-kit generate` and verify SQL output
- [ ] 2.6 Create raw SQL migration for tsvector column + GIN index + trigger on memoryObservations (Drizzle doesn't natively support tsvector)
- [ ] 2.7 Create `packages/db/src/queries.ts` with typed query functions: findRepoByGithubId, upsertInstallation, getRepoSettings, saveReview, searchObservations (using tsvector), upsertObservation (topic_key logic)
- [ ] 2.8 Create `packages/db/src/index.ts` re-exporting schema, client, queries, crypto
- [ ] 2.9 Write unit tests for crypto.ts (encrypt → decrypt roundtrip, different keys, tampered data)
- [ ] 2.10 Write unit tests for queries.ts using a test PostgreSQL database (observation deduplication, topic_key upserts, project isolation)

## Phase 3: Static Analysis Tools (`packages/core/src/tools/`)

- [ ] 3.1 Create `packages/core/src/tools/semgrep.ts` — Executes `semgrep --json --config auto` as child process, parses JSON output into ReviewFinding[], handles binary-not-found gracefully
- [ ] 3.2 Create `packages/core/src/tools/semgrep-rules.yml` — Rescue the 20 security rules from v1 `semgrep-service/rules.yml`
- [ ] 3.3 Create `packages/core/src/tools/trivy.ts` — Executes `trivy fs --format json --scanners vuln` as child process, parses JSON output into ReviewFinding[], handles binary-not-found gracefully
- [ ] 3.4 Create `packages/core/src/tools/cpd.ts` — Executes `cpd --format xml --minimum-tokens 100` as child process, parses XML output into ReviewFinding[], handles binary-not-found gracefully
- [ ] 3.5 Create `packages/core/src/tools/runner.ts` — Runs Semgrep, Trivy, and CPD in parallel via Promise.allSettled, merges results into StaticAnalysisResult, logs warnings for failed/skipped tools
- [ ] 3.6 Write unit tests for each tool parser using fixture files (real JSON/XML outputs captured from actual tool runs)
- [ ] 3.7 Write integration test for runner.ts verifying parallel execution and graceful degradation when tools are missing

## Phase 4: Core Review Engine (`packages/core/src/`)

- [ ] 4.1 Create `packages/core/src/agents/prompts.ts` — Rescue all prompts from v1: simple review prompt, 5 workflow specialist prompts (scope, standards, errors, security, performance), workflow synthesis prompt, consensus stance prompts (for, against, neutral), static analysis context injection template, memory context injection template, stack-specific hints
- [ ] 4.2 Create `packages/core/src/utils/stack-detect.ts` — Rescue stack detection logic from v1 `_shared/static-analysis/stack-detection.ts`, map file extensions to stack names and review hints
- [ ] 4.3 Create `packages/core/src/utils/diff.ts` — Diff parsing (extract file paths, line numbers), diff truncation by token budget, file filtering by ignore patterns (glob matching)
- [ ] 4.4 Create `packages/core/src/utils/token-budget.ts` — Rescue token budget logic from v1, model-aware allocation based on context window sizes
- [ ] 4.5 Create `packages/core/src/providers/index.ts` — Vercel AI SDK provider factory: createProvider(provider, apiKey) returning the correct SDK instance for anthropic/openai/google
- [ ] 4.6 Create `packages/core/src/providers/fallback.ts` — Fallback chain: try primary provider, catch 5xx, retry with next provider in chain, log which provider was used
- [ ] 4.7 Create `packages/core/src/agents/simple.ts` — Simple review: construct prompt with diff + static findings + memory context + stack hints, call LLM, parse structured response (STATUS, SUMMARY, FINDINGS)
- [ ] 4.8 Create `packages/core/src/agents/workflow.ts` — Workflow review: run 5 specialists in parallel via Promise.allSettled, collect results, run synthesis agent to deduplicate and prioritize, return merged ReviewResult
- [ ] 4.9 Create `packages/core/src/agents/consensus.ts` — Consensus review: assign stances to models, run in parallel, parse each vote (decision, confidence, reasoning), calculate weighted recommendation, optional synthesis for final summary
- [ ] 4.10 Create `packages/core/src/memory/search.ts` — Query memoryObservations via tsvector full-text search, scoped by project, limited results, formatted as context string
- [ ] 4.11 Create `packages/core/src/memory/persist.ts` — Extract observations from ReviewResult, apply deduplication (content hash + 15min window), apply topic_key upsert logic, save to database
- [ ] 4.12 Create `packages/core/src/memory/context.ts` — Format retrieved observations into markdown block for prompt injection: "Past Review Memory" section with type, title, learnings
- [ ] 4.13 Create `packages/core/src/memory/privacy.ts` — Rescue privacy stripping from v1: detect API key patterns, secrets, tokens → replace with [REDACTED]
- [ ] 4.14 Create `packages/core/src/pipeline.ts` — Main pipeline orchestrator: validate input → run static analysis (Layer 0) → search memory (Layer 1) → execute agent mode (Layer 2) → persist observations (Layer 3) → return ReviewResult
- [ ] 4.15 Create `packages/core/src/index.ts` — Public API: export `reviewPipeline()` function and all types
- [ ] 4.16 Write unit tests for prompts.ts (verify prompt construction with all optional sections)
- [ ] 4.17 Write unit tests for simple.ts, workflow.ts, consensus.ts using mocked AI SDK responses
- [ ] 4.18 Write unit tests for pipeline.ts end-to-end with mocked tools and providers
- [ ] 4.19 Write unit tests for memory search, persist, context, privacy modules

## Phase 5: Server Application (`apps/server/`)

- [ ] 5.1 Create `apps/server/src/github/client.ts` — GitHub API client: fetchPRDiff (paginated), postComment (formatted markdown), verifyWebhookSignature (HMAC-SHA256 constant-time), getInstallationToken
- [ ] 5.2 Create `apps/server/src/middleware/auth.ts` — Hono middleware: extract Bearer token, verify against GitHub API, attach user context (GitHub ID, installation IDs) to request
- [ ] 5.3 Create `apps/server/src/inngest/client.ts` — Inngest client setup with event schemas
- [ ] 5.4 Create `apps/server/src/inngest/review.ts` — Inngest durable function with 6 steps: fetch-context, static-analysis, memory-search, ai-review, save-memory, post-comment. Include fallback to sync static-only mode on quota exceeded.
- [ ] 5.5 Create `apps/server/src/routes/webhook.ts` — Hono route: POST /webhook — verify signature, parse event type, filter ignored files, dispatch to Inngest or return 200 for unsupported events
- [ ] 5.6 Create `apps/server/src/routes/api.ts` — Hono routes: GET /api/reviews (paginated, scoped), PUT /api/repositories/:id/settings, POST /api/repositories/:id/api-key, DELETE /api/repositories/:id/api-key, GET /api/stats
- [ ] 5.7 Create `apps/server/src/index.ts` — Hono app entry point: mount routes, middleware, Inngest serve endpoint, health check, CORS config, start server
- [ ] 5.8 Write integration tests for webhook route (valid/invalid signature, supported/unsupported events, ignored files)
- [ ] 5.9 Write integration tests for API routes (auth required, scoped results, settings update, encrypted key management)

## Phase 6: Dashboard (`apps/dashboard/`)

- [ ] 6.1 Create `apps/dashboard/package.json` with dependencies (react, react-dom, react-router-dom, @tanstack/react-query, tailwindcss, shadcn/ui setup)
- [ ] 6.2 Initialize Vite + React + TypeScript + Tailwind CSS + shadcn/ui
- [ ] 6.3 Create `apps/dashboard/src/lib/api.ts` — API client using TanStack Query: useReviews, useStats, useRepoSettings, useMutateSettings, useApiKeyMutation
- [ ] 6.4 Create `apps/dashboard/src/lib/auth.ts` — AuthContext with GitHub OAuth flow, session persistence, protected route wrapper
- [ ] 6.5 Create `apps/dashboard/src/App.tsx` — HashRouter with routes: /login, /dashboard, /reviews, /settings, /memory
- [ ] 6.6 Create `apps/dashboard/src/components/Layout.tsx` — Sidebar navigation + main content area
- [ ] 6.7 Create `apps/dashboard/src/pages/Login.tsx` — GitHub OAuth sign-in button
- [ ] 6.8 Create `apps/dashboard/src/pages/Dashboard.tsx` — Stats cards (total, passed, failed), area chart (reviews over time), pass rate ring
- [ ] 6.9 Create `apps/dashboard/src/pages/Reviews.tsx` — Filterable, searchable review table with detail modal
- [ ] 6.10 Create `apps/dashboard/src/pages/Settings.tsx` — Per-repo config: mode, provider, model, tool toggles, custom rules, API key management
- [ ] 6.11 Create `apps/dashboard/src/pages/Memory.tsx` — Session sidebar + observation cards with search
- [ ] 6.12 Configure `vite.config.ts` for GitHub Pages deployment (base path, env vars)
- [ ] 6.13 Create `.github/workflows/deploy-pages.yml` — Build and deploy dashboard to GitHub Pages on push to main

## Phase 7: CLI Distribution (`apps/cli/`)

- [ ] 7.1 Create `apps/cli/package.json` with bin entry and dependencies (commander)
- [ ] 7.2 Create `apps/cli/src/index.ts` — CLI entry point with commander: `ghagga review` command
- [ ] 7.3 Create `apps/cli/src/commands/review.ts` — Compute diff from git (staged or HEAD), read config from CLI args / env vars / .ghagga.json, call core pipeline in sync mode (no Inngest, no memory), output result in markdown/json/sarif format
- [ ] 7.4 Write tests for CLI argument parsing and config resolution

## Phase 8: GitHub Action Distribution (`apps/action/`)

- [ ] 8.1 Create `apps/action/action.yml` — Action definition with inputs (provider, model, mode, api-key, enable-semgrep, enable-trivy, enable-cpd)
- [ ] 8.2 Create `apps/action/src/index.ts` — Read event payload, compute diff from PR, call core pipeline in sync mode, post PR comment using GITHUB_TOKEN
- [ ] 8.3 Create `Dockerfile` in apps/action with Semgrep, Trivy, and PMD/CPD pre-installed
- [ ] 8.4 Write test for action entry point with mocked GitHub context

## Phase 9: Docker & Deployment

- [ ] 9.1 Create root `Dockerfile` — Multi-stage build: install Node.js + Semgrep + Trivy + PMD/CPD, copy built server, expose port
- [ ] 9.2 Create `docker-compose.yml` — Server + PostgreSQL services for local development
- [ ] 9.3 Create `railway.json` or deploy button config for 1-click Railway deployment
- [ ] 9.4 Create `.github/workflows/ci.yml` — CI pipeline: lint, typecheck, test all packages, build all apps
- [ ] 9.5 Update `README.md` with Quick Start, architecture overview, 4 deployment modes, and deploy buttons

## Phase 10: Integration Testing & Polish

- [ ] 10.1 E2E test: webhook → Inngest → review → PR comment flow using a test GitHub App and test repository
- [ ] 10.2 E2E test: CLI mode against a real git repository with staged changes
- [ ] 10.3 E2E test: Dashboard login → browse reviews → update settings flow with Playwright
- [ ] 10.4 Verify graceful degradation: test with missing Semgrep, Trivy, CPD binaries
- [ ] 10.5 Verify Inngest quota fallback: simulate quota exceeded → confirm static-only review
- [ ] 10.6 Performance test: review a large diff (>1000 lines) and verify token budget truncation
- [ ] 10.7 Security review: verify API keys are encrypted at rest, never logged, webhook signatures validated
