# GHAGGA — AI-Powered Code Review

> Inspired by [Gentleman Guardian Angel (GGA)](https://github.com/Gentleman-Programming/gentleman-guardian-angel) and [Engram](https://github.com/Gentleman-Programming/engram), two projects by [Gentleman Programming](https://youtube.com/@GentlemanProgramming).

**Multi-agent code reviewer** that posts intelligent comments on your Pull Requests. Combines LLM analysis with static analysis tools (Semgrep, Trivy, CPD) and project memory that learns across reviews.

**[Website](https://jnzader.github.io/ghagga/)** · **[Documentation](https://jnzader.github.io/ghagga/docs/)** · **[Dashboard](https://jnzader.github.io/ghagga/app/)**

## Table of Contents

- [What is this?](#what-is-this)
- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [Review Modes](#review-modes)
- [Static Analysis Trident](#static-analysis-trident)
- [Runner Architecture](#runner-architecture)
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
| **Multi-Provider** | 6 providers: GitHub Models (free), Anthropic, OpenAI, Google, Ollama (local), Qwen (Alibaba) — bring your own key |
| **3 Distribution Modes** | SaaS, GitHub Action, CLI |
| **Comment Trigger** | Type `ghagga review` on any PR to re-trigger a review on demand |
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
      - uses: JNZader/ghagga@v2
```

#### Action Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | No | — | LLM provider API key. Not required for GitHub Models (free default). |
| `provider` | No | `github` | LLM provider: `github`, `anthropic`, `openai`, `google`, `ollama`, `qwen` |
| `model` | No | Auto | Model identifier (auto-selects best per provider) |
| `mode` | No | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `github-token` | No | `${{ github.token }}` | GitHub token for PR access. Automatic. |
| `enable-semgrep` | No | `true` | Enable Semgrep security analysis |
| `enable-trivy` | No | `true` | Enable Trivy vulnerability scanning |
| `enable-cpd` | No | `true` | Enable CPD duplicate detection |

#### Action Outputs

| Output | Description |
|--------|-------------|
| `status` | Review result: `PASSED`, `FAILED`, `NEEDS_HUMAN_REVIEW`, `SKIPPED` |
| `findings-count` | Number of findings detected |

> Static analysis tools (Semgrep, Trivy, CPD) run **directly on the GitHub Actions runner** — no server or Docker image required. First run installs tools (~3-5 min), subsequent runs use `@actions/cache` (~1-2 min).

### Option 2: CLI

Review local changes from your terminal. No server required.

```bash
# Install
npm install -g ghagga

# Login with GitHub (free, no API key needed)
ghagga login

# Review staged changes
ghagga review

# Review with options
ghagga review --mode workflow --provider openai --api-key sk-xxx
ghagga review --provider qwen --api-key sk-xxx --format json
```

#### CLI Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--mode <mode>` | `-m` | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `--provider <provider>` | `-p` | `github` | LLM provider: `github`, `anthropic`, `openai`, `google`, `ollama`, `qwen` (or `GHAGGA_PROVIDER` env var) |
| `--model <model>` | — | Auto | Model identifier (or `GHAGGA_MODEL` env var) |
| `--api-key <key>` | — | — | API key (or `GHAGGA_API_KEY` env var) |
| `--format <format>` | `-f` | `markdown` | Output format: `markdown`, `json` |
| `--no-semgrep` | — | — | Disable Semgrep |
| `--no-trivy` | — | — | Disable Trivy |
| `--no-cpd` | — | — | Disable CPD |
| `--config <path>` | `-c` | `.ghagga.json` | Path to config file |
| `--verbose` | `-v` | — | Show real-time progress of each pipeline step |

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

---

## Architecture

```mermaid
graph TB
  subgraph Distribution["Distribution Layer"]
    Server["Server<br/>Hono"]
    Action["Action<br/>GitHub Action"]
    CLI["CLI"]
  end

  subgraph Runner["Delegated Runner"]
    RunnerRepo["ghagga-runner<br/>GitHub Actions"]
    RunnerTools["Semgrep · Trivy · CPD<br/>7GB RAM"]
  end

  subgraph Core["@ghagga/core"]
    SA["Static Analysis<br/>Semgrep · Trivy · CPD"]
    Agents["AI Agents<br/>Simple · Workflow · Consensus"]
    Memory["Memory<br/>Search · Persist · Privacy"]
  end

  subgraph DB["@ghagga/db"]
    PG["PostgreSQL<br/>+ tsvector"]
    Drizzle["Drizzle ORM<br/>+ Migrations"]
    Crypto["AES-256-GCM<br/>Encryption"]
  end

  Server -- "workflow_dispatch" --> RunnerRepo
  RunnerRepo --> RunnerTools
  RunnerTools -- "callback" --> Server

  Server --> Core
  Action --> Core
  CLI --> Core
  Core --> DB
```

### Core + Adapters Pattern

The review engine (`@ghagga/core`) knows **nothing** about HTTP, webhooks, or CLI. It receives a diff + config, runs analysis, orchestrates agents, and returns a structured result.

Each distribution mode (`apps/*`) is a thin adapter:

| Adapter | Input | Output | Memory | Static Analysis |
|---------|-------|--------|--------|----------------|
| **Server** | GitHub webhook | PR comment via GitHub API | Yes (PostgreSQL) | Delegated to runner |
| **Action** | PR event in GitHub Actions | PR comment via Octokit | No | Direct on runner |
| **CLI** | Local `git diff` | Terminal output (markdown/json) | No | If installed locally |

### Review Pipeline

Every review follows the same pipeline regardless of distribution mode:

```mermaid
flowchart LR
  Input["Input<br/>diff + config"] --> S1["Validate"]
  S1 --> S2["Parse &<br/>Filter Diff"]
  S2 --> S3["Detect<br/>Stacks"]
  S3 --> S4["Token<br/>Budget"]
  S4 --> S5["Static Analysis<br/>+ Memory Search"]
  S5 --> S6["AI Agent<br/>Execution"]
  S6 --> S7["Merge<br/>Findings"]
  S7 --> S8["Persist<br/>Memory"]
  S8 --> Output["ReviewResult"]
```

Each step degrades gracefully — if static analysis fails, or memory is unavailable, the pipeline continues with what it has.

---

## Review Modes

### Simple Mode

Single LLM call with a comprehensive system prompt. Best for small-to-medium PRs.

```mermaid
flowchart LR
  Input["Diff + Static Analysis<br/>+ Memory + Stack Hints"] --> LLM["1 LLM Call"]
  LLM --> Output["STATUS / SUMMARY / FINDINGS"]
```

**Token usage**: ~1x (one call)
**Best for**: Quick reviews, small PRs, low token budget

### Workflow Mode

5 specialist agents run **in parallel**, then a synthesis step merges their findings.

```mermaid
flowchart LR
  Input["Diff + Context"] --> S1["Scope Analysis"]
  Input --> S2["Coding Standards"]
  Input --> S3["Error Handling"]
  Input --> S4["Security Audit"]
  Input --> S5["Performance"]
  S1 --> Synth["Synthesis<br/>merge + deduplicate"]
  S2 --> Synth
  S3 --> Synth
  S4 --> Synth
  S5 --> Synth
  Synth --> Output["Structured Response"]
```

**Token usage**: ~6x (5 specialists + 1 synthesis)
**Best for**: Thorough reviews, large PRs, when you want focused analysis per area

### Consensus Mode

Multiple models review with assigned stances (for/against/neutral), then a weighted vote determines the outcome.

```mermaid
flowchart LR
  Input["Diff + Context"] --> A["Advocate<br/>looks for good"]
  Input --> C["Critic<br/>looks for problems"]
  Input --> O["Observer<br/>balanced view"]
  A --> Vote["Weighted Vote"]
  C --> Vote
  O --> Vote
  Vote --> Status["Final STATUS"]
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
| GitHub Action (node20) | Auto-installed + cached | Auto-installed + cached | Auto-installed + cached |
| CLI | If installed locally | If installed locally | If installed locally |

> The GitHub Action installs tools directly on the `ubuntu-latest` runner and caches binaries with `@actions/cache`. First run takes ~3-5 minutes (installation); subsequent runs use cache (~1-2 minutes). Tool failures degrade gracefully — the review continues with whatever tools succeed.

### Custom Semgrep Rules

GHAGGA ships with 20 security rules in `packages/core/src/tools/semgrep-rules.yml`. You can add custom rules via the `customRules` config option:

```json
{
  "customRules": [".semgrep/my-rules.yml"]
}
```

---

## Runner Architecture

> SaaS mode only. GitHub Action and CLI run tools directly.

The Render free tier (512MB RAM) can't run Semgrep (Python ~400MB) + PMD/CPD (JVM ~300MB) simultaneously. GHAGGA solves this by delegating static analysis to **user-owned GitHub Actions runners** on public repos (unlimited free minutes, 7GB RAM).

### How It Works

1. **Setup**: User creates a public repo from the [`ghagga-runner-template`](https://github.com/JNZader/ghagga-runner-template)
2. **Discovery**: Server checks if `{owner}/ghagga-runner` exists (convention-based, GET → 200/404)
3. **Secret**: Server sets a per-dispatch HMAC secret on the runner repo via GitHub API
4. **Dispatch**: Server triggers `workflow_dispatch` with 10 inputs (repo, PR, SHA, callback URL, tools config)
5. **Execution**: Runner installs/caches Semgrep, Trivy, CPD and runs analysis (~18 seconds)
6. **Callback**: Runner POSTs results to `POST /runner/callback` with HMAC-SHA256 signature
7. **Merge**: Server merges static findings with AI review and posts the combined comment

### Security Model

Private repo code analyzed via public runner is protected by **4 security layers**:

| Layer | Protection |
|-------|-----------|
| **Output suppression** | All tool output redirected to `/dev/null` — nothing in workflow logs |
| **Log masking** | `::add-mask::` applied to all sensitive values |
| **Log deletion** | Workflow run logs deleted via GitHub API after completion |
| **Retention policy** | Runner repo configured with 1-day log retention |

Each dispatch generates a unique `callbackSecret` stored in an in-memory Map with 11-minute TTL. HMAC-SHA256 verification ensures only the legitimate runner can deliver results.

### Graceful Fallback

If no runner repo is discovered, the server falls back to **LLM-only review** (no static analysis). The review still works — it just skips Layer 0.

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

> Memory is only available in Server (SaaS) mode (requires PostgreSQL). CLI and Action modes run without memory — the pipeline gracefully degrades.

---

## Dashboard

React SPA deployed on GitHub Pages. Dark theme with GitHub-dark palette and purple accent.

**Live**: [https://jnzader.github.io/ghagga/app/](https://jnzader.github.io/ghagga/app/)

### Pages

| Page | Description |
|------|-------------|
| **Login** | GitHub OAuth Device Flow login |
| **Dashboard** | 4 stat cards (total reviews, pass rate, avg findings, avg time) + Recharts area chart with review trends |
| **Reviews** | Filterable table with status badges, severity indicators, detail expansion, and pagination |
| **Settings** | Per-repo or global settings — provider chain, review mode, tools, ignore patterns |
| **Global Settings** | Installation-wide provider chain and defaults that apply to all repos |
| **Memory** | Session sidebar + observation cards with debounced search across all stored knowledge |

### Tech Details

- React 19 + TypeScript + Vite
- TanStack Query 5 for data fetching and caching
- Recharts for data visualization
- Tailwind CSS 3 with dark theme
- HashRouter for GitHub Pages compatibility (no server-side routing needed)
- Code-split: lazy-loaded page components with vendor chunk splitting
- Base path: `/ghagga/app/` for GitHub Pages deployment

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
│           ├── schema.ts          # Drizzle table definitions (7 tables)
│           ├── client.ts          # Database connection factory
│           ├── crypto.ts          # AES-256-GCM encrypt/decrypt
│           ├── queries.ts         # All typed query functions
│           └── index.ts           # Re-exports
│
├── apps/
│   ├── server/                # @ghagga/server — Hono API
│   │   └── src/
│   │       ├── index.ts           # Hono app (CORS, health, webhook, Inngest, API)
│   │       ├── middleware/auth.ts  # GitHub PAT authentication middleware
│   │       ├── inngest/           # Durable review function (7 steps + runner dispatch)
│   │       ├── github/
│   │       │   ├── client.ts      # GitHub API client (diff, comment, verify, JWT)
│   │       │   └── runner.ts      # Runner discovery, secret setup, dispatch
│   │       ├── routes/
│   │       │   ├── runner-callback.ts # POST /runner/callback (HMAC verification)
│   │       │   └── ...               # Webhook + 8 REST API endpoints
│   │
│   ├── dashboard/             # @ghagga/dashboard — React SPA
│   │   └── src/
│   │       ├── App.tsx            # HashRouter with lazy-loaded routes
│   │       ├── lib/               # API hooks, auth context, utilities
│   │       ├── components/        # Layout, Card, StatusBadge, SeverityBadge
│   │       └── pages/             # Login, Dashboard, Reviews, Settings, Memory
│   │
│   ├── cli/                   # ghagga — CLI tool
│   │   └── src/
│   │       ├── index.ts           # Commander entry point
│   │       └── commands/review.ts # Git diff → pipeline → output
│   │
│   └── action/                # @ghagga/action — GitHub Action
│       ├── action.yml             # Action definition (node20 runtime)
│       ├── Dockerfile             # Docker variant with static analysis tools
│       └── src/index.ts           # Fetch diff → pipeline → comment
│
├── templates/                 # Runner dispatch templates
│   ├── ghagga-analysis.yml       # GitHub Actions workflow for static analysis
│   └── ghagga-runner-README.md   # Template repo README
│
├── landing/                   # Marketing landing page
│   └── index.html                # Static HTML (GitHub Pages)
│
├── docs/                      # Documentation site (Docsify)
│   ├── index.html                # Docsify configuration
│   ├── _sidebar.md               # Navigation structure
│   └── *.md                      # Documentation pages
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
├── render.yaml                # Render Blueprint for SaaS deployment
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
| `INNGEST_EVENT_KEY` | Server only | Inngest event ingestion key |
| `INNGEST_SIGNING_KEY` | Server only | Inngest webhook signing key |
| `ENCRYPTION_KEY` | Server only | 64-character hex string for AES-256-GCM encryption |
| `PORT` | No | Server port (default: `3000`) |
| `NODE_ENV` | No | `development` or `production` |

### Default Models

| Provider | Default Model |
|----------|--------------|
| GitHub Models | `gpt-4o-mini` |
| Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | `gpt-4o` |
| Google | `gemini-2.5-flash` |
| Ollama | `qwen2.5-coder:7b` |
| Qwen | `qwen-coder-plus` |

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
pnpm exec turbo test          # Run all 1021 tests
```

### Test Suite

1021 tests across 7 packages. All passing.

| Package | Tests | What's Covered |
|---------|------:|----------------|
| `ghagga-core` | 451 | Pipeline, diff parsing, stack detection, token budget, prompts, agents (simple, workflow, consensus), fallback provider, privacy, memory (search, persist, context), static analysis tools (semgrep, trivy, cpd), parsers, security audit, review calibration |
| `ghagga-db` | 64 | Queries (CRUD, effective settings, provider chain), AES-256-GCM crypto (roundtrip, tamper, edge cases) |
| `@ghagga/server` | 266 | API routes, webhook handlers, auth middleware, provider validation, Inngest review function, GitHub client, runner dispatch, callback verification |
| `ghagga` (CLI) | 53 | Config resolution, review command — input validation, output formatting, exit codes |
| `@ghagga/action` | 185 | Input parsing, output setting, comment formatting, error handling, tool installation, cache management |
| `@ghagga/dashboard` | 2 | Component rendering |

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Monorepo** | pnpm workspaces + Turborepo | Fast installs, parallel builds, caching |
| **Language** | TypeScript 5.7 (strict mode) | Type safety across all packages |
| **Backend** | Hono 4 | Fastest TS framework, 14KB, runs anywhere |
| **Database** | PostgreSQL 16 + Drizzle ORM | Zero-overhead SQL, tsvector FTS, plain TS migrations |
| **AI** | Vercel AI SDK 4 | Multi-provider (6 providers), streaming, structured output, fallback chains |
| **Async** | Inngest 3 | Zero-infra durable functions, step checkpointing, automatic retries |
| **Frontend** | React 19 + Vite + Tailwind 3 | Lazy-loaded routes, vendor splitting, dark theme |
| **Data Fetching** | TanStack Query 5 | Caching, background refetching, optimistic updates |
| **Charts** | Recharts 2 | Composable React chart components |
| **CLI** | Commander 13 | Standard CLI framework for Node.js |
| **Testing** | Vitest 3 | Fast, ESM-native, compatible with Jest API |
| **Static Analysis** | Semgrep + Trivy + PMD/CPD | Security, vulnerabilities, duplication — zero tokens |
| **Encryption** | Node.js `crypto` (AES-256-GCM) | No external dependencies for cryptographic operations |

### Why These Choices

- **Vercel AI SDK over LangGraph/agentlib**: GHAGGA's review flow is predictable (not a dynamic graph). AI SDK gives multi-provider support with less overhead. [agentlib](https://github.com/sammwy) was evaluated but is OpenAI only and has zero multi-agent support.
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
| Test suite | 0 tests | 1021 tests |
| Distribution modes | 1 (webhook only) | 3 (SaaS, Action, CLI) |
| Static analysis | Semgrep only (via microservice) | Semgrep + Trivy + CPD (direct binary execution) |
| Memory | Partial (stored but never consumed) | Full pipeline (search → inject → review → extract → persist) |
| Dead code | ~40% of codebase | 0% |

---

## License

MIT — see [LICENSE](LICENSE) for details.
