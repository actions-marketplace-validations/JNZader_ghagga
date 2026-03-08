# Changelog

## [2.5.0] - 2026-03-08

### Added
- **TUI polish** — Colored severity indicators (red/yellow/cyan), box-drawing summary at end of review, step progress `[n/m]` with spinners, section dividers between tool groups.
- **`--output json|sarif|markdown` flag** — Unified output format flag for the review command. SARIF v2.1.0 output integrates with GitHub Security tab and standard SAST tooling.
- **`--enhance` flag** — AI-powered post-analysis enhancement (opt-in). Groups related findings, assigns AI priorities, suggests fixes, and filters noise. Non-blocking — failures fall back to unenhanced results.
- **`ghagga health [path]` command** — Project health scoring (0-100) with letter grades (A-F), historical trend analysis, and actionable recommendations grouped by category. History stored locally per-project.
- **`--issue new|<number>` flag** — Create or update GitHub issues with review results. Creates issues with `ghagga-review` label, supports adding comments to existing issues. Non-blocking — errors don't prevent review output.
- **SARIF builder** — Pure `buildSarif()` function in `ghagga-core` for converting review findings to SARIF v2.1.0 format.
- **Health scoring modules** — `computeHealthScore()`, `computeTrend()`, `generateRecommendations()` in `ghagga-core` with severity-weighted scoring and template-based recommendations.
- **chalk adapter** — `ui/chalk.ts` wraps chalk v5 for styled terminal output. Commands access colors only through the TUI facade.

### Fixed
- **Dashboard ToolGrid invisible** — Server never called `initializeDefaultTools()`, so `toolRegistry.getAll()` returned `[]` and the dashboard fell back to the legacy 3-checkbox UI. Now initializes the 15-tool registry at server startup.
- **Webhook tool config dropped** — `enabledTools`/`disabledTools` were omitted when the webhook handler dispatched Inngest events, so dashboard tool configuration had no effect on actual PR reviews. Both fields are now forwarded.

### Deprecated
- **`--format` flag** — Replaced by `--output`. Still works as an alias but shows no warning (silent deprecation).

## [2.4.2] - 2026-03-08

### Fixed
- **API globalSettings response** — `GET /api/settings` now includes `enabledTools` and `disabledTools` in the `globalSettings` object. Previously the dashboard's inherited ToolGrid always showed all tools as enabled.
- **Installation settings API** — `GET /api/installation-settings` now returns `enabledTools`, `disabledTools`, and `registeredTools`. `PUT /api/installation-settings` now accepts `enabledTools`/`disabledTools`.
- **GlobalSettings dashboard page** — Replaced 4 legacy checkboxes (Semgrep/Trivy/CPD/Memory) with full ToolGrid component showing all 15 tools with category grouping and per-tool toggles.

### Removed
- **`GHAGGA_TOOL_REGISTRY` feature flag** — The registry-driven orchestrator is now the only path. The legacy 3-tool hardcoded path has been removed. `isToolRegistryEnabled()` kept as deprecated stub for existing imports.

## [2.4.1] - 2026-03-08

### Fixed
- **Runner template dynamic tool resolution** — The runner YAML template now dynamically resolves which of the 15 static analysis tools to run. Previously, `enabledTools`/`disabledTools` sent by the server were silently ignored by the runner, which only ran the 3 legacy tools (Semgrep, Trivy, CPD).
- **12 new tool blocks in runner** — Gitleaks, ShellCheck, markdownlint, Lizard, Ruff, Bandit, golangci-lint, Biome, PMD, Psalm, clippy, and Hadolint can now run on the user's GitHub Actions runner.
- **Auto-detection in runner** — The resolve step detects which auto-detect tools to activate based on file extensions in the target repository.
- **Dynamic callback payload** — The callback now includes results for all resolved tools (not just the 3 legacy keys).

## [2.4.0] - 2026-03-08

### Added
- **Extensible Static Analysis (3→15 tools)** — Replaced hardcoded Semgrep/Trivy/CPD integration with a plugin registry supporting 15 static analysis tools across 5 categories (security, SCA, duplication, lint, complexity). Enable via `GHAGGA_TOOL_REGISTRY=true` feature flag.
- **Tool Tier System** — Tools are classified as `always-on` (run on every review) or `auto-detect` (activate when matching files are detected in the diff). Resolution order: always-on → auto-detect(files) → +enabledTools → -disabledTools.
- **7 always-on tools** — Semgrep (security), Trivy (SCA + license scanning), CPD (duplication), Gitleaks (secret detection in git history), ShellCheck (Bash/Shell lint), markdownlint (Markdown lint), Lizard (cyclomatic complexity, 20+ languages).
- **8 auto-detect tools** — Ruff (Python lint), Bandit (Python security), golangci-lint (Go lint), Biome (JS/TS lint), PMD (Java lint), Psalm (PHP security), clippy (Rust lint), Hadolint (Dockerfile lint).
- **`--enable-tool <name>` CLI flag** — Force-enable a specific tool regardless of tier or file detection.
- **`--disable-tool <name>` CLI flag** — Force-disable a specific tool.
- **`--list-tools` CLI flag** — Show all 15 available tools with their status, category, tier, and supported languages.
- **`enabled-tools` Action input** — Comma-separated list of tools to force-enable in GitHub Action workflows.
- **`disabled-tools` Action input** — Comma-separated list of tools to force-disable in GitHub Action workflows.
- **`enabledTools`/`disabledTools` settings fields** — New settings in DB, API, dashboard, and `.ghagga.json` for per-repo tool control.
- **ToolGrid dashboard component** — Settings page now includes a ToolGrid with category grouping and per-tool toggle switches.
- **Delete reviews** — Users can now delete individual reviews from the dashboard and API.
- **Delete memory sessions** — Users can now delete memory sessions from the dashboard and API.

### Deprecated
- **`--no-semgrep`, `--no-trivy`, `--no-cpd` CLI flags** — Still work but show deprecation warnings. Use `--disable-tool semgrep`, `--disable-tool trivy`, `--disable-tool cpd` instead.
- **`enable-semgrep`, `enable-trivy`, `enable-cpd` Action inputs** — Still work but deprecated. Use `enabled-tools`/`disabled-tools` inputs instead.
- **`enableSemgrep`, `enableTrivy`, `enableCpd` config fields** — Still work in `.ghagga.json` but deprecated. Use `enabledTools`/`disabledTools` arrays instead.

## [2.3.0] - 2026-03-07

### Security
- **Stack trace leak removed** — Error handler no longer exposes `err.message` or `err.stack` in non-production environments. Only generic error returned to client; full error logged server-side.
- **Memory session auth** — `GET /api/memory/sessions/:id/observations` now verifies session ownership against the authenticated user's installations, preventing cross-team data access.
- **CORS, rate limiting, security headers** — Server hardened with strict CORS origins, per-IP rate limiting, and security headers (X-Content-Type-Options, X-Frame-Options, etc.).
- **Body size limits** — Request body limits enforced to prevent DoS via oversized payloads.
- **Token expiration fix** — Corrected edge case where expired tokens were not properly invalidated.
- **23 GitHub Actions pinned to SHAs** — All `uses:` entries in CI/CD workflows pinned to commit SHAs for supply chain hardening.
- **Docker FROM annotated** — Base images annotated with digest comments for reproducibility.

### Performance
- **N+1→Promise.all** — Sequential per-installation queries replaced with parallel `Promise.all()`, reducing API latency by ~90% for multi-installation users.
- **Auth token cache (5min TTL)** — GitHub API user validation cached in-memory with 5-minute TTL, eliminating redundant `GET /user` calls on every request.
- **Virtual scrolling** — Memory page uses `@tanstack/react-virtual` for observation/session lists, handling 1000+ items without DOM bloat.
- **createdAt index on memoryObservations** — Added database index for efficient time-range queries at scale.

### Architecture
- **api.ts split into 6 domain modules** — Monolithic 912-line route file refactored into `reviews.ts`, `repositories.ts`, `installations.ts`, `memory.ts`, `runner.ts`, and `settings.ts`.
- **@ghagga/types shared types package** — 24 API types extracted into `packages/types`, replacing duplicated type definitions between dashboard and server.
- **Provider chain DRY** — Extracted `buildProviderChainView()` helper, eliminating 3× duplicated `maskApiKey()` + mapping logic.
- **Zod settings validation** — Replaced 20+ manual `typeof` ternaries with Zod schema for repo and global settings endpoints.
- **SimpleCircuitBreaker** — Lightweight circuit breaker for GitHub API calls with configurable error threshold and reset timeout. Fast-fail when GitHub is degraded.
- **Graceful shutdown** — Server handles SIGTERM with connection draining (30s timeout), preventing data loss during redeploys.
- **Dynamic callback TTL** — Runner callback secret TTL configurable via `CALLBACK_TTL_MINUTES` env var (default: 11 min), supporting slow LLM providers.

### Added
- **Biome linting** — Replaced ESLint + Prettier with Biome. Fixed 450 linting errors across the monorepo.
- **Reviews-by-day stub** — `GET /api/stats/reviews-by-day` query endpoint for daily review statistics.
- **Provider chain documentation** — Added inline docs and README section explaining provider chain configuration and fallback behavior.
- **Dependabot config** — `.github/dependabot.yml` for automated dependency updates across npm and GitHub Actions.
- **`/health/detailed` endpoint** — Reports database and GitHub API connectivity status with per-dependency health checks.
- **Dashboard ErrorBoundary** — React class component wraps all routes; renders recovery UI on render crashes instead of blank screen.
- **QueryCache/MutationCache error handling** — Global error handlers on TanStack Query client surface network errors via toast notifications.
- **Dashboard typecheck fixes** — Added `jest-dom` types, resolved implicit `any` errors, and corrected `@ghagga/types` exports for clean CI builds.

### Accessibility
- **useFocusTrap hook** — Custom hook traps keyboard focus inside modals (ObservationDetailModal, ConfirmDialog) per WCAG 2.4.3.
- **7 axe a11y tests** — Automated accessibility tests with `jest-axe` across dashboard pages and modal components.

### Testing
- **~2,778 total tests** — Up from 1,940 in v2.2.0 (+838 tests). Per-package: db:118, core:1328, cli:272, server:523, action:195, dashboard:342, types:24, e2e:14, security:14+.
- **E2E integration tests** — 3 suites, 14 tests covering webhook→pipeline→comment, CLI review flow, and Action review flow.
- **CI hardening** — Security scanning (CodeQL), coverage reporting, and mutation testing integrated into CI pipeline.
- **Stryker expanded 17→23 files** — Mutation testing coverage extended to include `workflow.ts`, `consensus-review.ts`, `format.ts`, `search.ts`, `sqlite.ts`, and `providers/index.ts`.
- **Dedup window fix** — Corrected deduplication window boundary condition that could miss duplicate observations at exact 15-minute marks.
- **Search query improvements** — Better file name extraction and configurable ignore list in memory search query builder.
- **Zod negative tests** — Added tests verifying Zod `.strict()` rejects invalid enum values, wrong types, and unknown fields in settings schema.
- **Circuit breaker assertion** — Added missing `expect(breaker.getState()).toBe('open')` assertion after half-open→re-open transition.

### Audit R4 — Production Readiness (16 improvements)

#### Critical
- **HTTP timeouts on all fetch() calls** — Added `AbortSignal.timeout()` to all GitHub API calls (10s for API calls, 15s for diff fetching, 5s for keepalive). Prevents resource exhaustion when GitHub is slow.
- **Environment validation at startup (fail-fast)** — Server validates `DATABASE_URL`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, and `ENCRYPTION_KEY` at startup via `validate-env.ts`. Missing vars cause immediate exit with clear error message.
- **FK cascade delete on all remaining FKs** — Migration `0008` adds `ON DELETE CASCADE` to `repositories.installation_id`, `reviews.repository_id`, and `github_user_mappings.installation_id`. Prevents orphaned data on GitHub App uninstall.

#### High
- **Correlation IDs (reviewId)** — Each review generates a `reviewId` (8-char UUID) propagated from webhook → Inngest event → pipeline logs → PR comment. Enables end-to-end tracing for debugging.
- **Token cache periodic cleanup** — Added `setInterval` (every 5 minutes) to clean expired tokens from the auth cache, preventing slow memory leaks in low-traffic deployments.
- **GitHub API pagination for >100 files/commits** — `getPRFileList()` and `getPRCommitMessages()` now paginate through all pages instead of truncating at 100 items.
- **Keepalive fetch with timeout** — Render keepalive ping now uses `AbortSignal.timeout(5000)`.

#### Medium
- **CONTRIBUTING.md** — New contributor guide covering prerequisites, setup, testing, commit conventions, PR process, code style, and local PostgreSQL setup.
- **`.env.example` improved** — All variables labeled `[REQUIRED]` or `[OPTIONAL]` with format descriptions and generation commands.
- **Migrations made idempotent** — All custom SQL migrations now use `IF NOT EXISTS` / `DROP ... IF EXISTS` guards for safe re-execution.
- **Dockerfile HEALTHCHECK** — Added `HEALTHCHECK` instruction for container orchestration health monitoring.

#### Low
- **Structured review metrics in logs** — Review completion logs now include structured `metrics` object with `durationMs`, `provider`, `status`, and `findingsCount`.
- **API response envelope standardized** — All mutation endpoints (`PUT /api/settings`, `PUT /api/installation-settings`) now use `{ data: { message: ... } }` envelope consistent with GET endpoints.
- **Error IDs in 500 responses** — All internal server errors include an `errorId` (8-char UUID) in both the response body and server logs, enabling support ticket correlation.
- **Missing router imports fix** — Fixed missing route module imports that caused 404s on some API endpoints.

### Upgrades
- **Vercel AI SDK v4 → v5** — Migrated to AI SDK 5 with updated provider APIs and streaming patterns.
- **Zod v3 → v4** — Migrated to Zod 4 with updated schema APIs.
- **Docker digest pinning** — All base images annotated with digest comments for supply-chain reproducibility.

## [2.2.0] - 2026-03-07

### Added
- **Git Hooks Support** — `ghagga hooks install/uninstall/status` command group for automated pre-commit and commit-msg review. Hooks auto-detect `ghagga` in PATH with graceful fallback.
- **`--staged` Flag** — Review only staged files via `git diff --cached` (for pre-commit hook).
- **`--quick` Flag** — Static analysis only, skip AI review (~5-10s vs ~30-60s).
- **`--commit-msg` Flag** — Validate commit message from file (subject length, format, body separation).
- **`--exit-on-issues` Flag** — Exit with code 1 when critical/high issues found (blocks commit).
- **Engram Memory Adapter** — `EngramMemoryStorage` connects GHAGGA to the Engram ecosystem via HTTP API. Review insights shared with Claude Code, OpenCode, Gemini CLI, GGA, and any MCP-compatible tool.
- **`--memory-backend` Flag** — Select memory backend: `sqlite` (default) or `engram`.
- **3 New Environment Variables** — `GHAGGA_MEMORY_BACKEND`, `GHAGGA_ENGRAM_HOST`, `GHAGGA_ENGRAM_TIMEOUT`.

### Testing
- **1,940 Total Tests** — Added 63 hooks tests + 149 Engram adapter tests. Per-package: db:118, core:675, cli:272, server:413, action:195, dashboard:267.
- **91.61% Mutation Score** — Stryker mutation testing on EngramMemoryStorage (client: 87.96%, mapping: 91.40%, adapter: 95.41%).

## [2.1.0] - 2026-03-07

### Added
- **SQLite Memory for CLI & Action** — Local review memory using sql.js (WASM) with FTS5 full-text search. CLI stores at `~/.config/ghagga/memory.db`, Action persists via `@actions/cache`. (#10)
- **Memory Management Commands** — 6 new CLI subcommands: `ghagga memory list|search|show|delete|stats|clear`. (#11)
- **CLI TUI** — Styled terminal output using `@clack/prompts` with automatic plain fallback in CI/non-TTY environments. Global `--plain` flag. (#12)
- **Dashboard Memory Management** — Delete/clear/purge observations and sessions with 3-tier confirmation system (simple confirm → type repo name → type "DELETE ALL" + 5s countdown). (#14)
- **Memory Detail View** — Enhanced dashboard with severity badges, PR links, revision counts, file path chips, relative timestamps, StatsBar, severity/sort filters, and ObservationDetailModal. (#15)
- **Severity Field** — Added `severity` column to both PostgreSQL and SQLite schemas. Significance filter now includes medium severity findings alongside critical and high. (#15)
- **`enable-memory` Action Input** — New input to enable/disable SQLite review memory in GitHub Action (default: true).
- **5 DELETE API Endpoints** — Memory management via REST API: delete observation, clear project, purge all, delete session, clean empty sessions.

### Changed
- **Expanded Significance Filter** — Now saves critical + high + medium findings to memory (was critical + high only).
- **Documentation Overhaul** — Updated 15 documentation files to reflect all v2.1 features: memory availability, CLI commands, permissions, test counts, API reference, schema, architecture.

### Fixed
- **Empty Memory Sessions** — Sessions are now created only after confirming significant findings exist, preventing orphaned empty sessions.
- **Dedup Session Reassignment** — When re-reviewing a PR within 15 minutes, deduplication now correctly reassigns observations to the new session.
- **CASCADE Delete** — Fixed missing `ON DELETE CASCADE` on `memory_observations.session_id` foreign key.
- **Orphaned Session Deletion** — Sessions without matching repositories can now be deleted via two-step scoped + orphan cleanup.
- **TypeScript Build Error** — Fixed `noImplicitAny` error in `PostgresMemoryStorage` row mapping.
- **Dashboard Observation Types** — Aligned `observationTypeConfig` with core `ObservationType` enum (was using non-existent types).
- **Dashboard Session Fields** — Fixed `startedAt`→`createdAt` mapping and added `observationCount` via LEFT JOIN.

### Security
- **GitHub App Permissions Reduced** — Removed Administration R&W and Contents R&W. Now requires only: Pull requests R&W, Actions Write, Secrets R&W, Metadata Read.

### Testing
- **1,728 Total Tests** — Added 211 tests in coverage audit plus 65 tests for memory detail view. Per-package: db:118, core:526, cli:209, server:413, action:195, dashboard:267.
- **91% Mutation Score** — Stryker mutation testing on SqliteMemoryStorage exceeds 80% target.

## [2.0.1] - 2026-03-05

### Fixed
- Duplicate review bug (workflow running alongside GitHub App)
- False positives (memory bias, dead reviewLevel config, phantom coding standards)
- Docsify sidebar links (absolute URLs for internal navigation)
- Format review comment deduplication (extracted to `packages/core/src/format.ts`)

### Added
- Delegated runner architecture (static analysis via GitHub Actions `workflow_dispatch`)
- Auto-runner creation (dashboard OAuth creates runner repo from template)
- Dashboard OAuth authentication (composite UNIQUE, stale cleanup, OAuth Web Flow)
- Stateless callback secrets (HMAC-SHA256 derivation)
- User onboarding documentation and landing page overhaul
- SVG logo ("Gentleman Reviewer")

## [2.0.0] - 2026-03-04

### Added
- Complete v2 rewrite from Deno/Supabase to TypeScript monorepo
- 3 distribution modes: SaaS (GitHub App), GitHub Action, CLI
- Semgrep + Trivy + CPD static analysis integration
- Multi-provider AI support (GitHub Models, Gemini, OpenAI, Anthropic)
- PostgreSQL with Drizzle ORM
- Inngest background job processing
- React dashboard with Vite
