# Tech Stack

## Overview

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

## Why These Choices

### Vercel AI SDK over LangChain/LangGraph

GHAGGA's review flow is **predictable** (Layer 0 → 1 → 2 → 3), not a dynamic graph. AI SDK gives multi-provider support with less overhead. agentlib was evaluated but is too immature (1 week old, OpenAI only, no multi-agent).

### Hono over Express/Fastify

14KB, fastest benchmarks, runs on Node/Bun/Deno/Workers. Express is legacy, Fastify is heavier than needed.

### Drizzle over Prisma

Zero-overhead SQL, no binary dependencies, supports raw tsvector operations for full-text search.

### PostgreSQL Memory over Engram

Engram has great design patterns but no multi-tenancy, no auth, and is SQLite single-writer. We adopted its patterns (sessions, topic_key upserts, deduplication, privacy stripping) in PostgreSQL.

### Inngest over BullMQ

Zero infrastructure — no Redis. 50k events/month free. Step-based checkpointing means LLM retries don't re-run static analysis.

## Test Suite

225 tests across 18 test files in 5 packages. All passing in ~3.7 seconds.

| Package | Tests | What's Covered |
|---------|------:|----------------|
| `@ghagga/core` | 171 | Pipeline, diff parsing, stack detection, token budget, prompts, agent parsers, fallback provider, privacy, memory, formatters, tool parsers, security audit |
| `@ghagga/action` | 18 | Input parsing, output setting, comment formatting, error handling |
| `@ghagga/cli` | 13 | Module exports, config resolution, output formatting, exit codes |
| `@ghagga/server` | 12 | Webhook signature verification, Inngest function, router |
| `@ghagga/db` | 11 | AES-256-GCM encrypt/decrypt roundtrip, tamper detection, edge cases |
