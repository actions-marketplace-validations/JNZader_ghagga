# Architecture

## Core + Adapters Pattern

GHAGGA uses a **Core + Adapters** architecture. The review engine (`@ghagga/core`) is pure logic with zero I/O dependencies — it knows nothing about HTTP, webhooks, or CLI. Each distribution mode is a thin adapter.

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
    direction TB
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

## Adapter Responsibilities

Each adapter does the minimum work necessary to bridge between its I/O world and the core engine:

| Adapter | Input | Output | Memory | Static Analysis |
|---------|-------|--------|--------|----------------|
| **Server** | GitHub webhook | PR comment via GitHub API | Yes (PostgreSQL) | Delegated to runner |
| **Action** | PR event in GitHub Actions | PR comment via Octokit | No | Direct on runner |
| **CLI** | Local `git diff` | Terminal output (markdown/json) | No | If installed locally |

## Monorepo Structure

```
ghagga/
├── packages/
│   ├── core/           # @ghagga/core — Review engine (zero I/O)
│   │   └── src/
│   │       ├── pipeline.ts     # Main orchestrator
│   │       ├── types.ts        # All TypeScript interfaces
│   │       ├── agents/         # Simple, Workflow, Consensus
│   │       ├── tools/          # Semgrep, Trivy, CPD runners
│   │       ├── memory/         # Search, persist, privacy
│   │       ├── providers/      # Vercel AI SDK multi-provider
│   │       └── utils/          # Diff parsing, stack detect, tokens
│   └── db/             # @ghagga/db — Database layer
│       └── src/
│           ├── schema.ts       # Drizzle table definitions
│           ├── crypto.ts       # AES-256-GCM encrypt/decrypt
│           └── queries.ts      # Typed database queries
├── apps/
│   ├── server/         # Hono API (webhook + REST + Inngest + runner)
│   ├── dashboard/      # React SPA (GitHub Pages)
│   ├── cli/            # CLI tool (Commander.js)
│   └── action/         # GitHub Action (node20 + Docker)
│
├── templates/                 # Runner dispatch templates
│   ├── ghagga-analysis.yml       # GitHub Actions workflow for analysis
│   └── ghagga-runner-README.md   # Template repo README
├── Dockerfile          # Multi-stage with Semgrep, Trivy, CPD
└── docker-compose.yml  # PostgreSQL + server for local dev
```

## Runner Architecture (SaaS Mode)

In SaaS mode, static analysis is delegated to a user-owned GitHub Actions runner. The Render free tier (512MB RAM) can't run Semgrep + PMD/CPD simultaneously, so tools run on the user's public `ghagga-runner` repo (7GB RAM, unlimited free minutes).

```mermaid
sequenceDiagram
    participant S as GHAGGA Server
    participant R as ghagga-runner
    participant GH as GitHub API

    S->>GH: Check {owner}/ghagga-runner exists
    S->>GH: Set GHAGGA_TOKEN secret
    S->>GH: workflow_dispatch (10 inputs)
    R->>R: Install + run Semgrep, Trivy, CPD
    R->>S: POST /runner/callback (HMAC-signed)
    S->>S: Verify HMAC, merge findings
```

If no runner repo is discovered, the server falls back to LLM-only review (no static analysis). See [Runner Architecture](runner-architecture.md) for full details.

## Design Decisions

### Vercel AI SDK over LangChain/LangGraph

GHAGGA's review flow is **predictable** (Layer 0 → 1 → 2 → 3), not a dynamic graph. Vercel AI SDK gives multi-provider support (6 providers: GitHub Models, Anthropic, OpenAI, Google, Ollama, Qwen) with streaming, structured output, and tool calling — without the overhead of graph management.

### Hono over Express/Fastify

Hono is the fastest TypeScript framework at ~14KB. It runs on Node.js, Bun, Deno, and Cloudflare Workers. Express is legacy, Fastify is heavier than needed for this use case.

### Drizzle ORM over Prisma

Zero-overhead SQL with excellent TypeScript inference. No binary dependencies (unlike Prisma). Supports raw tsvector operations for the memory system's full-text search.

### PostgreSQL Memory over Engram

[Engram](https://github.com/Gentleman-Programming/engram) has great design patterns (session model, topic-key upserts, deduplication, privacy stripping) but no multi-tenancy, no auth, and is SQLite single-writer. We adopted its patterns directly in PostgreSQL.

### Inngest over BullMQ

Zero infrastructure — no Redis server, no worker processes. 50k events/month free. Step-based checkpointing means LLM retries don't re-run static analysis. Fallback to sync execution if unavailable.

### Binary Execution for Static Analysis

Semgrep, Trivy, and CPD are called as child processes — no separate microservices, no network latency, no SSRF concerns. All three tools output JSON/XML that's parsed locally.
