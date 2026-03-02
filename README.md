# GHAGGA — AI-Powered Code Review

> **Complete rewrite** of [Gentleman Guardian Angel (GGA)](https://github.com/Gentleman-Programming/gentleman-guardian-angel) by [Gentleman Programming](https://youtube.com/@GentlemanProgramming). Memory system design patterns inspired by [Engram](https://github.com/Gentleman-Programming/engram).

**Multi-agent code reviewer** that posts intelligent comments on your Pull Requests. Combines LLM analysis with static analysis tools (Semgrep, Trivy, CPD) and project memory that learns across reviews.

**[Website](https://jnzader.github.io/ghagga/)** · **[Documentation](https://jnzader.github.io/ghagga/docs/)** · **[Dashboard](https://jnzader.github.io/ghagga/app/)**

## Table of Contents

- [What is this?](#what-is-this)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Review Modes](#review-modes)
- [Static Analysis Trident](#static-analysis-trident)
- [Memory System](#memory-system)
- [Dashboard](#dashboard)
- [Security](#security)
- [Monorepo Structure](#monorepo-structure)
- [Configuration](#configuration)
- [Development](#development)
- [Tech Stack](#tech-stack)
- [What changed from v1](#what-changed-from-v1)
- [License](#license)

---

## What is this?

GHAGGA is an AI code review tool that:

1. **Receives** a PR diff (via webhook, CLI, or GitHub Action)
2. **Scans** it with static analysis tools — zero LLM tokens for known issues
3. **Searches** project memory for past decisions, patterns, and bug fixes
4. **Sends** the diff + static analysis context + memory to AI agents
5. **Posts** a structured review comment on the PR with findings, severity, and suggestions
6. **Learns** by extracting observations from the review and storing them for next time

You bring your own API key (BYOK). GHAGGA never sees or stores your keys in plaintext — they're encrypted with AES-256-GCM at rest.

### Key Features

| Feature | Description |
|---------|-------------|
| **3 Review Modes** | Simple (single LLM), Workflow (5 specialist agents), Consensus (multi-model voting) |
| **Static Analysis Trident** | Semgrep (security), Trivy (vulnerabilities), CPD (code duplication) — zero tokens |
| **Project Memory** | Learns patterns, decisions, and bug fixes across reviews (PostgreSQL + tsvector FTS) |
| **Multi-Provider** | Anthropic (Claude), OpenAI (GPT-4), Google (Gemini) — bring your own key |
| **4 Distribution Modes** | SaaS, GitHub Action, CLI, 1-click deploy |
| **Dashboard** | React SPA on GitHub Pages — review history, stats, settings, memory browser |
| **BYOK Security** | AES-256-GCM encryption, HMAC-SHA256 webhook verification, privacy stripping |

---

## Quick Start

### Option 1: GitHub Action (Free for Public Repos)

The fastest way to get started. No server needed — runs directly in GitHub's infrastructure.

```yaml
# .github/workflows/review.yml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: JNZader/ghagga@main
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          provider: anthropic       # or: openai, google
          mode: simple              # or: workflow, consensus
```

#### Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | — | LLM provider API key |
| `provider` | No | `anthropic` | LLM provider: `anthropic`, `openai`, `google` |
| `model` | No | Auto | Model identifier (auto-selects best per provider) |
| `mode` | No | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `enable-semgrep` | No | `true` | Enable Semgrep security analysis |
| `enable-trivy` | No | `true` | Enable Trivy vulnerability scanning |
| `enable-cpd` | No | `true` | Enable CPD duplicate detection |

#### Action Outputs

| Output | Description |
|--------|-------------|
| `status` | Review result: `PASSED`, `FAILED`, `NEEDS_HUMAN_REVIEW`, `SKIPPED` |
| `findings-count` | Number of findings detected |

> The Docker variant (`apps/action/Dockerfile`) includes Semgrep, Trivy, and PMD/CPD pre-installed. The default `node20` variant skips static analysis tools if they're not available.

### Option 2: CLI

Review local changes from your terminal. No server required.

```bash
# Install globally
npm install -g @ghagga/cli

# Set your API key
export GHAGGA_API_KEY=sk-ant-...

# Review staged changes (default: simple mode, anthropic provider)
ghagga review

# Review with options
ghagga review --mode workflow --provider openai --format json

# Review a specific directory
ghagga review /path/to/repo --mode consensus
```

#### CLI Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--mode <mode>` | `-m` | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `--provider <provider>` | `-p` | `anthropic` | LLM provider (or `GHAGGA_PROVIDER` env var) |
| `--model <model>` | — | Auto | Model identifier (or `GHAGGA_MODEL` env var) |
| `--api-key <key>` | — | — | API key (or `GHAGGA_API_KEY` env var) |
| `--format <format>` | `-f` | `markdown` | Output format: `markdown`, `json` |
| `--no-semgrep` | — | — | Disable Semgrep |
| `--no-trivy` | — | — | Disable Trivy |
| `--no-cpd` | — | — | Disable CPD |
| `--config <path>` | `-c` | `.ghagga.json` | Path to config file |

#### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Review passed or was skipped |
| `1` | Review failed or needs human review |

#### Config File (`.ghagga.json`)

Place a `.ghagga.json` in your repo root for project-level defaults:

```json
{
  "mode": "workflow",
  "provider": "anthropic",
  "model": "claude-sonnet-4-20250514",
  "enableSemgrep": true,
  "enableTrivy": true,
  "enableCpd": false,
  "customRules": [".semgrep/custom-rules.yml"],
  "ignorePatterns": ["*.test.ts", "*.spec.ts", "docs/**"],
  "reviewLevel": "strict"
}
```

Priority: CLI flags > config file > defaults.

### Option 3: Self-Hosted (Docker)

Full deployment with PostgreSQL, memory, and dashboard support.

```bash
# Clone
git clone https://github.com/JNZader/ghagga.git
cd ghagga

# Configure
cp .env.example .env
# Edit .env with your credentials (see Configuration section below)

# Start
docker compose up -d
```

This starts:
- **PostgreSQL 16** on port 5432 with health checks
- **GHAGGA Server** (Hono) on port 3000 with Semgrep, Trivy, and CPD pre-installed

### Option 4: 1-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/ghagga)

Railway auto-provisions PostgreSQL and sets up the environment. You just need to add your GitHub App credentials and Inngest keys.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Distribution Layer                    │
│  ┌──────────┐  ┌──────────┐  ┌─────┐  ┌──────────────┐  │
│  │  Server   │  │  Action  │  │ CLI │  │  1-Click     │  │
│  │  (Hono)   │  │ (GH Act) │  │     │  │  (Railway)   │  │
│  └─────┬─────┘  └─────┬────┘  └──┬──┘  └──────┬───────┘  │
│        └──────────────┴─────────┴─────────────┘           │
│                          │                                │
│                    @ghagga/core                            │
│        ┌─────────────────┼─────────────────┐              │
│        │                 │                 │              │
│   Static Analysis    AI Agents         Memory             │
│   ┌─────────────┐  ┌──────────┐  ┌──────────────┐        │
│   │ Semgrep     │  │ Simple   │  │ Search       │        │
│   │ Trivy       │  │ Workflow │  │ Persist      │        │
│   │ CPD         │  │ Consensus│  │ Privacy      │        │
│   └─────────────┘  └──────────┘  └──────────────┘        │
│                          │                                │
│                    @ghagga/db                              │
│        ┌─────────────────┼─────────────────┐              │
│        │                 │                 │              │
│   PostgreSQL       Drizzle ORM       AES-256-GCM          │
│   + tsvector       + Migrations      Encryption           │
└──────────────────────────────────────────────────────────┘
```

### Core + Adapters Pattern

The review engine (`@ghagga/core`) knows **nothing** about HTTP, webhooks, or CLI. It receives a diff + config, runs analysis, orchestrates agents, and returns a structured result.

Each distribution mode (`apps/*`) is a thin adapter:

| Adapter | Input | Output | Memory |
|---------|-------|--------|--------|
| **Server** | GitHub webhook | PR comment via GitHub API | Yes (PostgreSQL) |
| **Action** | PR event in GitHub Actions | PR comment via Octokit | No |
| **CLI** | Local `git diff` | Terminal output (markdown/json) | No |
| **1-Click** | Same as Server | Same as Server | Yes |

### Review Pipeline

Every review follows the same pipeline regardless of distribution mode:

```
Input (diff + config)
  → Step 1: Validate input (diff, API key, provider, model)
  → Step 2: Parse and filter diff (ignore patterns like *.md, *.lock)
  → Step 3: Detect tech stacks (TypeScript, Python, Go, etc.)
  → Step 4: Truncate diff to fit model's token budget (70/30 split)
  → Step 5: Run static analysis + memory search (in parallel)
  → Step 6: Execute agent mode (simple | workflow | consensus)
  → Step 7: Merge static analysis findings into result
  → Step 8: Persist observations to memory (fire-and-forget)
  → Output (structured ReviewResult)
```

Each step degrades gracefully — if static analysis fails, or memory is unavailable, the pipeline continues with what it has.

---

## Review Modes

### Simple Mode

Single LLM call with a comprehensive system prompt. Best for small-to-medium PRs.

```
Diff + Static Analysis Context + Memory Context + Stack Hints
  → 1 LLM call
  → Structured response (STATUS / SUMMARY / FINDINGS)
```

**Token usage**: ~1x (one call)
**Best for**: Quick reviews, small PRs, low token budget

### Workflow Mode

5 specialist agents run **in parallel**, then a synthesis step merges their findings.

```
Diff + Context
  → 5 specialists (parallel):
      1. Scope Analysis    — what changed, blast radius
      2. Coding Standards  — naming, formatting, DRY
      3. Error Handling    — null safety, edge cases, exceptions
      4. Security Audit    — injection, XSS, auth, data exposure
      5. Performance       — complexity, N+1, memory, resources
  → 1 synthesis call (merges + deduplicates)
  → Structured response
```

**Token usage**: ~6x (5 specialists + 1 synthesis)
**Best for**: Thorough reviews, large PRs, when you want focused analysis per area

### Consensus Mode

Multiple models review with assigned stances (for/against/neutral), then a weighted vote determines the outcome.

```
Diff + Context
  → 3 reviews with stances (parallel):
      1. Advocate (for)     — looks for what's good
      2. Critic (against)   — looks for problems
      3. Observer (neutral) — balanced assessment
  → Weighted vote → final STATUS
  → Structured response
```

**Token usage**: ~3x (3 stances)
**Best for**: Critical code paths, high-confidence decisions, security-sensitive changes

---

## Static Analysis Trident

Layer 0 analysis runs **before** any LLM call. Zero tokens consumed. Known issues are injected into agent prompts so the AI focuses on logic, architecture, and things static analysis can't detect.

| Tool | What It Finds | Languages |
|------|--------------|-----------|
| **Semgrep** | Security vulnerabilities, dangerous patterns (eval, SQL injection, XSS, hardcoded secrets) | 20 custom rules across JavaScript, TypeScript, Python, Java, Go, Ruby, PHP, C# |
| **Trivy** | Known CVEs in dependencies (npm, pip, Maven, Go modules, Cargo, etc.) | All ecosystems with lockfiles |
| **CPD** | Duplicated code blocks (copy-paste detection) | 15+ languages via PMD |

### Graceful Degradation

Tools are optional. If Semgrep, Trivy, or CPD aren't installed, they're silently skipped. The review continues with whatever tools are available.

| Distribution | Semgrep | Trivy | CPD |
|-------------|---------|-------|-----|
| Docker (server) | Pre-installed | Pre-installed | Pre-installed |
| Docker (action) | Pre-installed | Pre-installed | Pre-installed |
| GitHub Action (node20) | Skipped* | Skipped* | Skipped* |
| CLI | If installed locally | If installed locally | If installed locally |

> \* The node20 action variant doesn't include static analysis tools by default. Use the Docker action variant for full static analysis, or install tools in a prior step.

### Custom Semgrep Rules

GHAGGA ships with 20 security rules in `packages/core/src/tools/semgrep-rules.yml`. You can add custom rules via the `customRules` config option:

```json
{
  "customRules": [".semgrep/my-rules.yml"]
}
```

---

## Memory System

GHAGGA learns from past reviews using PostgreSQL full-text search. Design patterns inspired by [Engram](https://github.com/Gentleman-Programming/engram) (session model, topic-key upserts, deduplication, privacy stripping) — implemented directly in PostgreSQL for multi-tenancy and scalability.

### How It Works

1. **After each review**, observations are automatically extracted (decisions, patterns, bugs, learnings)
2. **Deduplication** prevents storing the same observation twice (content hash + 15-minute rolling window)
3. **Topic-key upserts** evolve existing knowledge instead of creating duplicates
4. **Before each review**, relevant observations are retrieved via tsvector full-text search and injected into agent prompts
5. **Privacy stripping** removes API keys, tokens, and secrets before anything is stored

### Observation Types

| Type | Description | Example |
|------|-------------|---------|
| `decision` | Architecture and design choices | "Team decided to use Zustand over Redux for state management" |
| `pattern` | Code patterns and conventions | "All API routes use zod validation middleware" |
| `bugfix` | Common errors and their fixes | "React useEffect cleanup missing causes memory leak in Dashboard" |
| `learning` | General project knowledge | "The billing module uses Stripe webhooks for payment confirmation" |
| `architecture` | System design decisions | "Microservices communicate via event bus, not direct HTTP" |
| `config` | Configuration patterns | "Environment-specific configs are in /config/{env}.ts" |
| `discovery` | Codebase discoveries | "Legacy auth module in /lib/auth is deprecated, use /modules/auth" |

### Privacy Stripping

Before any observation is stored in memory, GHAGGA strips sensitive data using 16 regex patterns:

| Pattern | Example | Redacted As |
|---------|---------|-------------|
| Anthropic API keys | `sk-ant-api03-...` | `[REDACTED_ANTHROPIC_KEY]` |
| OpenAI API keys | `sk-proj-...` | `[REDACTED_OPENAI_KEY]` |
| AWS Access Key IDs | `AKIA...` | `[REDACTED_AWS_KEY]` |
| GitHub tokens | `ghp_...`, `gho_...`, `ghs_...`, `github_pat_...` | `[REDACTED_GITHUB_*]` |
| Google API keys | `AIza...` | `[REDACTED_GOOGLE_KEY]` |
| Slack tokens | `xoxb-...`, `xoxp-...` | `[REDACTED_SLACK_TOKEN]` |
| Bearer tokens | `Bearer eyJ...` | `Bearer [REDACTED_TOKEN]` |
| JWT tokens | `eyJ...eyJ...xxx` | `[REDACTED_JWT]` |
| PEM private keys | `-----BEGIN PRIVATE KEY-----` | `[REDACTED_PRIVATE_KEY]` |
| Password/secret assignments | `password = "..."` | `[REDACTED]` |
| Base64 credentials | `SECRET=aGVsbG8...` | `[REDACTED_BASE64]` |

> Memory is only available in Server and 1-Click deploy modes (requires PostgreSQL). CLI and Action modes run without memory — the pipeline gracefully degrades.

---

## Dashboard

React SPA deployed on GitHub Pages. Dark theme with GitHub-dark palette and purple accent.

**Live**: [https://jnzader.github.io/ghagga/app/](https://jnzader.github.io/ghagga/app/)

### Pages

| Page | Description |
|------|-------------|
| **Login** | GitHub PAT authentication |
| **Dashboard** | 4 stat cards (total reviews, pass rate, avg findings, avg time) + Recharts area chart with review trends |
| **Reviews** | Filterable table with status badges, severity indicators, detail expansion, and pagination |
| **Settings** | Per-repo configuration (provider, model, mode, tools, ignore patterns) + encrypted API key management |
| **Memory** | Session sidebar + observation cards with debounced search across all stored knowledge |

### Tech Details

- React 19 + TypeScript + Vite
- TanStack Query 5 for data fetching and caching
- Recharts for data visualization
- Tailwind CSS 3 with dark theme
- HashRouter for GitHub Pages compatibility (no server-side routing needed)
- Code-split: lazy-loaded page components with vendor chunk splitting
- Base path: `/ghagga/` for GitHub Pages deployment

---

## Security

| Measure | Implementation |
|---------|---------------|
| **API key encryption** | AES-256-GCM with per-installation encryption keys. Keys are never stored in plaintext. |
| **Webhook verification** | HMAC-SHA256 signature verification with `crypto.timingSafeEqual` (constant-time comparison to prevent timing attacks) |
| **JWT generation** | RS256 manual JWT construction for GitHub App installation tokens (no external JWT library needed) |
| **Privacy stripping** | 16 regex patterns remove API keys, tokens, passwords, and secrets before storing to memory |
| **No secret logging** | Console outputs and error messages never contain sensitive data (verified by automated security tests) |
| **BYOK model** | Users provide their own LLM API keys. GHAGGA never pays for or sees your LLM usage in plaintext. |
| **Installation scoping** | API routes are scoped by GitHub installation ID — users can only access their own repos |

### Automated Security Tests

The test suite includes 14 dedicated security audit tests that verify:

- No `console.log` calls with sensitive variable names across the entire codebase
- No hardcoded API keys, tokens, or passwords in source files
- No use of `eval()` or `Function()` constructors
- AES-256-GCM encryption roundtrip correctness
- Tampered ciphertext detection
- `timingSafeEqual` usage for webhook signature comparison
- Privacy stripping covers all 16 secret patterns

---

## Monorepo Structure

```
ghagga/
├── packages/
│   ├── core/                  # @ghagga/core — Review engine
│   │   └── src/
│   │       ├── pipeline.ts        # Main orchestrator (validate → analyze → agent → persist)
│   │       ├── types.ts           # All TypeScript interfaces and types
│   │       ├── index.ts           # Public API exports
│   │       ├── agents/
│   │       │   ├── prompts.ts     # All agent prompts (rescued from v1)
│   │       │   ├── simple.ts      # Simple single-pass review
│   │       │   ├── workflow.ts    # 5-specialist parallel workflow
│   │       │   └── consensus.ts   # Multi-model voting
│   │       ├── tools/
│   │       │   ├── semgrep.ts     # Semgrep runner + JSON parser
│   │       │   ├── trivy.ts       # Trivy runner + JSON parser
│   │       │   ├── cpd.ts         # PMD/CPD runner + XML parser
│   │       │   ├── runner.ts      # Parallel orchestrator
│   │       │   └── semgrep-rules.yml  # 20 custom security rules
│   │       ├── memory/
│   │       │   ├── search.ts      # tsvector full-text search
│   │       │   ├── persist.ts     # Observation extraction + dedup
│   │       │   ├── context.ts     # Format observations as markdown
│   │       │   └── privacy.ts     # Privacy stripping (16 patterns)
│   │       ├── providers/
│   │       │   ├── index.ts       # Vercel AI SDK provider factory
│   │       │   └── fallback.ts    # Fallback chain with retry logic
│   │       └── utils/
│   │           ├── diff.ts        # Diff parsing, filtering, truncation
│   │           ├── stack-detect.ts # File extension → tech stack
│   │           └── token-budget.ts # Model-aware token allocation
│   │
│   └── db/                    # @ghagga/db — Database layer
│       └── src/
│           ├── schema.ts          # Drizzle table definitions (6 tables)
│           ├── client.ts          # Database connection factory
│           ├── crypto.ts          # AES-256-GCM encrypt/decrypt
│           ├── queries.ts         # All typed query functions
│           └── index.ts           # Re-exports
│
├── apps/
│   ├── server/                # @ghagga/server — Hono API
│   │   └── src/
│   │       ├── index.ts           # Hono app (CORS, health, webhook, Inngest, API)
│   │       ├── github/client.ts   # GitHub API client (diff, comment, verify, JWT)
│   │       ├── middleware/auth.ts  # GitHub PAT authentication middleware
│   │       ├── inngest/           # Durable review function (4 steps)
│   │       └── routes/            # Webhook handlers + 8 REST API endpoints
│   │
│   ├── dashboard/             # @ghagga/dashboard — React SPA
│   │   └── src/
│   │       ├── App.tsx            # HashRouter with lazy-loaded routes
│   │       ├── lib/               # API hooks, auth context, utilities
│   │       ├── components/        # Layout, Card, StatusBadge, SeverityBadge
│   │       └── pages/             # Login, Dashboard, Reviews, Settings, Memory
│   │
│   ├── cli/                   # @ghagga/cli — CLI tool
│   │   └── src/
│   │       ├── index.ts           # Commander entry point
│   │       └── commands/review.ts # Git diff → pipeline → output
│   │
│   └── action/                # @ghagga/action — GitHub Action
│       ├── action.yml             # Action definition (node20 runtime)
│       ├── Dockerfile             # Docker variant with static analysis tools
│       └── src/index.ts           # Fetch diff → pipeline → comment
│
├── openspec/                  # Spec-Driven Development artifacts
│   └── changes/ghagga-v2-rewrite/
│       ├── proposal.md            # Full rewrite proposal
│       ├── design.md              # Architecture decisions
│       ├── tasks.md               # 10 phases, tracked tasks
│       └── specs/                 # Detailed specs per module
│
├── Dockerfile                 # Multi-stage build (Semgrep + Trivy + CPD)
├── docker-compose.yml         # PostgreSQL + server for local dev
├── railway.toml               # 1-click Railway deploy config
├── .github/workflows/
│   ├── ci.yml                 # Typecheck + build + test pipeline
│   └── deploy-pages.yml       # Auto-deploy dashboard to GitHub Pages
└── README.md
```

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Server only | PostgreSQL connection string |
| `GITHUB_APP_ID` | Server only | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | Server only | Base64-encoded `.pem` file content |
| `GITHUB_WEBHOOK_SECRET` | Server only | Secret configured in GitHub App webhook settings |
| `GITHUB_CLIENT_ID` | Dashboard | For OAuth login |
| `GITHUB_CLIENT_SECRET` | Dashboard | For OAuth login |
| `INNGEST_EVENT_KEY` | Server only | Inngest event ingestion key |
| `INNGEST_SIGNING_KEY` | Server only | Inngest webhook signing key |
| `ENCRYPTION_KEY` | Server only | 64-character hex string for AES-256-GCM encryption |
| `PORT` | No | Server port (default: `3000`) |
| `NODE_ENV` | No | `development` or `production` |

### Default Models

| Provider | Default Model |
|----------|--------------|
| Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | `gpt-4o` |
| Google | `gemini-2.0-flash` |

### Token Budget

The diff is automatically truncated to fit each model's context window using a 70/30 split:

| Allocation | Percentage | Purpose |
|-----------|-----------|---------|
| Diff content | 70% | The actual code changes |
| Agent prompts + context | 30% | System prompt, static analysis, memory, stack hints |

---

## Development

### Prerequisites

- **Node.js** 22+
- **pnpm** 9+ (exact version managed via `packageManager` in package.json)
- **PostgreSQL** 16+ (or use Docker)

### Setup

```bash
# Clone and install
git clone https://github.com/JNZader/ghagga.git
cd ghagga
pnpm install

# Start PostgreSQL (via Docker)
docker compose up postgres -d

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
pnpm --filter @ghagga/db db:push

# Start development server
pnpm --filter @ghagga/server dev

# Start dashboard dev server (in another terminal)
pnpm --filter @ghagga/dashboard dev
```

### Commands

```bash
pnpm exec turbo typecheck    # Typecheck all packages
pnpm exec turbo build         # Build all packages
pnpm exec turbo test          # Run all 225 tests
```

### Test Suite

225 tests across 18 test files in 5 packages. All passing in ~3.7 seconds.

| Package | Tests | What's Covered |
|---------|------:|----------------|
| `@ghagga/core` | 171 | Pipeline (21), diff parsing (17), stack detection (8), token budget (8), prompts (20), simple agent parser (17), fallback provider (13), privacy stripping (15), memory context (6), static analysis formatters (5), tool parsers (27), security audit (14) |
| `@ghagga/action` | 18 | Input parsing, output setting, comment formatting, error handling, diff handling |
| `@ghagga/cli` | 13 | Module exports, config resolution, output formatting, exit codes, input validation |
| `@ghagga/server` | 12 | Webhook signature verification (9), Inngest function export (2), router export (1) |
| `@ghagga/db` | 11 | AES-256-GCM encrypt/decrypt roundtrip, tampered data, empty strings, unicode, key validation |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Monorepo** | pnpm workspaces + Turborepo | Fast installs, parallel builds, caching |
| **Language** | TypeScript 5.7 (strict mode) | Type safety across all packages |
| **Backend** | Hono 4 | Fastest TS framework, 14KB, runs anywhere |
| **Database** | PostgreSQL 16 + Drizzle ORM | Zero-overhead SQL, tsvector FTS, plain TS migrations |
| **AI** | Vercel AI SDK 4 | Multi-provider (Anthropic, OpenAI, Google), streaming, structured output |
| **Async** | Inngest 3 | Zero-infra durable functions, step checkpointing, automatic retries |
| **Frontend** | React 19 + Vite + Tailwind 3 | Lazy-loaded routes, vendor splitting, dark theme |
| **Data Fetching** | TanStack Query 5 | Caching, background refetching, optimistic updates |
| **Charts** | Recharts 2 | Composable React chart components |
| **CLI** | Commander 13 | Standard CLI framework for Node.js |
| **Testing** | Vitest 3 | Fast, ESM-native, compatible with Jest API |
| **Static Analysis** | Semgrep + Trivy + PMD/CPD | Security, vulnerabilities, duplication — zero tokens |
| **Encryption** | Node.js `crypto` (AES-256-GCM) | No external dependencies for cryptographic operations |

### Why These Choices

- **Vercel AI SDK over LangGraph/agentlib**: GHAGGA's review flow is predictable (not a dynamic graph). AI SDK gives multi-provider support with less overhead. [agentlib](https://github.com/sammwy) was evaluated but is 1 week old, OpenAI only, and has zero multi-agent support.
- **Hono over Express/Fastify**: 14KB, fastest benchmarks, runs on Node/Bun/Deno/Workers. Express is legacy, Fastify is heavier than needed.
- **Drizzle over Prisma**: Zero-overhead SQL, no binary dependencies, supports raw tsvector operations.
- **PostgreSQL memory over Engram**: Engram has great design patterns but no multi-tenancy, no auth, and is SQLite single-writer. We adopted its patterns (sessions, topic_key upserts, deduplication, privacy stripping) in PostgreSQL.
- **Inngest over BullMQ**: Zero infrastructure (no Redis). 50k events/month free. Step-based checkpointing means LLM retries don't re-run static analysis.

---

## What Changed from v1

GHAGGA v2 is a **complete rewrite** from scratch. The v1 codebase (~11,000 lines) is preserved on the `main-bkp` branch.

### What Was Wrong with v1

| Problem | Details |
|---------|---------|
| **Duplicate implementations** | TWO review flows: webhook inline handler AND a ReviewService class that was never called |
| **Dead code** | Hebbian Learning stored data but never consumed it. Threads, chunking, and embedding cache modules existed but were orphaned |
| **Heavy dependencies** | Required Supabase CLI, Docker, Deno runtime, and a separate Python microservice for Semgrep |
| **Hybrid search fallback** | Fell back to client-side filtering instead of using the SQL RPC function |
| **Complex deployment** | Multiple manual steps, multiple runtimes, multiple services |

### What Was Rescued from v1

| Component | Details |
|-----------|---------|
| **Agent prompts** | All system prompts (simple, 5 workflow specialists, synthesis, consensus stances) — battle-tested and well-designed |
| **Multi-provider abstraction** | Concept of supporting multiple LLM providers with fallback |
| **Crypto module** | AES-256-GCM encryption pattern for API keys |
| **Semgrep rules** | 20 custom security rules across 7+ languages |
| **Stack detection** | File extension → tech stack mapping for review hints |
| **Privacy stripping** | Pattern-based secret redaction before memory persistence |

### v1 vs v2 Comparison

| Aspect | v1 | v2 |
|--------|----|----|
| Lines of code | ~11,000 | ~6,000 (implementation) + ~3,000 (tests) |
| Runtime | Deno + Node.js + Python | Node.js only |
| Database | Supabase (hosted PostgreSQL) | Any PostgreSQL (self-hosted or cloud) |
| Deploy steps | 10+ manual steps | 3 env vars + `docker compose up` |
| Test suite | 0 tests | 225 tests |
| Distribution modes | 1 (webhook only) | 4 (SaaS, Action, CLI, 1-Click) |
| Static analysis | Semgrep only (via microservice) | Semgrep + Trivy + CPD (direct binary execution) |
| Memory | Partial (stored but never consumed) | Full pipeline (search → inject → review → extract → persist) |
| Dead code | ~40% of codebase | 0% |

---

## License

MIT — see [LICENSE](LICENSE) for details.
