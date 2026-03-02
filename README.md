# 🐦 GHAGGA — AI-Powered Code Review

**Multi-agent code reviewer** that posts intelligent comments on your Pull Requests. Combines LLM analysis with static analysis tools (Semgrep, Trivy, CPD) and project memory.

Built by the [Gentleman Programming](https://github.com/Gentleman-Programming) community.

## ✨ Features

- **3 Review Modes**: Simple (single LLM), Workflow (5 specialist agents), Consensus (multi-model voting)
- **Static Analysis Trident**: Semgrep (security), Trivy (vulnerabilities), CPD (code duplication)
- **Project Memory**: Learns patterns, decisions, and bug fixes across reviews (PostgreSQL + tsvector)
- **Multi-Provider**: Anthropic, OpenAI, Google — bring your own API key (BYOK)
- **4 Distribution Modes**: SaaS, GitHub Action, CLI, 1-click deploy

## 🚀 Quick Start

### Option 1: GitHub Action (Free for Public Repos)

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
          provider: anthropic
          mode: simple
```

### Option 2: CLI

```bash
# Install globally
npm install -g @ghagga/cli

# Review staged changes
export GHAGGA_API_KEY=sk-ant-...
ghagga review

# Review with options
ghagga review --mode workflow --provider openai --format json
```

### Option 3: Self-Hosted (Docker)

```bash
git clone https://github.com/JNZader/ghagga.git
cd ghagga
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

### Option 4: 1-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/ghagga)

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────┐
│                    Distribution Layer                 │
│  ┌──────────┐ ┌──────────┐ ┌─────┐ ┌──────────────┐ │
│  │  Server   │ │  Action  │ │ CLI │ │  1-Click     │ │
│  │  (Hono)   │ │ (GH Act) │ │     │ │  (Railway)   │ │
│  └─────┬─────┘ └─────┬────┘ └──┬──┘ └──────┬───────┘ │
│        └──────────────┴────────┴────────────┘         │
│                         │                             │
│                   @ghagga/core                        │
│        ┌────────────────┼────────────────┐            │
│        │                │                │            │
│   Static Analysis   AI Agents       Memory            │
│   ┌─────────────┐ ┌──────────┐ ┌──────────────┐      │
│   │ Semgrep     │ │ Simple   │ │ Search       │      │
│   │ Trivy       │ │ Workflow │ │ Persist      │      │
│   │ CPD         │ │ Consensus│ │ Privacy      │      │
│   └─────────────┘ └──────────┘ └──────────────┘      │
│                         │                             │
│                   @ghagga/db                          │
│        ┌────────────────┼────────────────┐            │
│        │                │                │            │
│   PostgreSQL     Drizzle ORM      AES-256-GCM        │
│   + tsvector     + Migrations     Encryption          │
└──────────────────────────────────────────────────────┘
```

## 📦 Monorepo Structure

```
ghagga/
├── packages/
│   ├── core/          # @ghagga/core — Review engine (providers, agents, memory, tools)
│   └── db/            # @ghagga/db — Database layer (Drizzle, crypto, queries)
├── apps/
│   ├── server/        # @ghagga/server — Hono API (webhooks, Inngest, REST API)
│   ├── dashboard/     # @ghagga/dashboard — React SPA (GitHub Pages)
│   ├── cli/           # @ghagga/cli — CLI tool (npx ghagga review)
│   └── action/        # @ghagga/action — GitHub Action
├── Dockerfile         # Multi-stage build with analysis tools
├── docker-compose.yml # Local dev stack (PostgreSQL + server)
└── .github/workflows/ # CI + Dashboard deploy
```

## 🔧 Development

### Prerequisites

- Node.js 22+
- pnpm 9+
- PostgreSQL 16+ (or use Docker)

### Setup

```bash
# Clone and install
git clone https://github.com/JNZader/ghagga.git
cd ghagga
pnpm install

# Start PostgreSQL
docker compose up postgres -d

# Configure environment
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
pnpm --filter @ghagga/db db:push

# Start development server
pnpm --filter @ghagga/server dev

# Start dashboard dev server
pnpm --filter @ghagga/dashboard dev
```

### Commands

```bash
pnpm exec turbo typecheck   # Typecheck all packages
pnpm exec turbo build        # Build all packages
pnpm exec turbo test         # Run all tests
```

## 🔒 Security

- **API keys are encrypted at rest** using AES-256-GCM
- **Webhook signatures are verified** with HMAC-SHA256 (constant-time comparison)
- **No secrets are ever logged** — privacy stripping removes API keys, tokens from memory
- **BYOK model** — we never see or store your LLM API keys in plaintext

## 📊 Review Modes

| Mode | Description | Best For |
|------|-------------|----------|
| **Simple** | Single LLM call with comprehensive prompt | Quick reviews, low token usage |
| **Workflow** | 5 specialist agents (scope, standards, errors, security, performance) + synthesis | Thorough reviews, large PRs |
| **Consensus** | Multiple models vote (for/against/neutral) with weighted recommendation | Critical code, high confidence |

## 🧠 Memory System

GHAGGA learns from past reviews using PostgreSQL full-text search:

- **Decisions**: Architecture and design choices
- **Patterns**: Code patterns and conventions
- **Bugfixes**: Common errors and their fixes
- **Learnings**: General project knowledge

Memory observations are automatically extracted from reviews, deduplicated (content hash + 15min window), and evolved via topic-key upserts.

## 🤝 Contributing

Contributions welcome! This is a [Gentleman Programming](https://github.com/Gentleman-Programming) community project.

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT — see [LICENSE](LICENSE) for details.
