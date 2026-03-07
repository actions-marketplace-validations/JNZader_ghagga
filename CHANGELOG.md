# Changelog

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
- **~2,640 total tests** — Up from 1,940 in v2.2.0 (+700 tests). Per-package: db:136, core:782, cli:310, server:524, action:228, dashboard:374, types:24, e2e:14, security:14+.
- **E2E integration tests** — 3 suites, 14 tests covering webhook→pipeline→comment, CLI review flow, and Action review flow.
- **CI hardening** — Security scanning (CodeQL), coverage reporting, and mutation testing integrated into CI pipeline.
- **Stryker expanded 17→23 files** — Mutation testing coverage extended to include `workflow.ts`, `consensus-review.ts`, `format.ts`, `search.ts`, `sqlite.ts`, and `providers/index.ts`.
- **Dedup window fix** — Corrected deduplication window boundary condition that could miss duplicate observations at exact 15-minute marks.
- **Search query improvements** — Better file name extraction and configurable ignore list in memory search query builder.

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
