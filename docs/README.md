# GHAGGA

> **AI-Powered Multi-Agent Code Review**

GHAGGA is a code review tool that posts intelligent comments on your Pull Requests. It combines LLM analysis with static analysis tools (Semgrep, Trivy, CPD) and a project memory system that learns across reviews.

## How It Works

1. **Receives** a PR diff (via webhook, CLI, or GitHub Action)
2. **Scans** it with static analysis tools — zero LLM tokens for known issues
3. **Searches** project memory for past decisions, patterns, and bug fixes
4. **Sends** the diff + static findings + memory to AI agents
5. **Posts** a structured review comment with findings, severity, and suggestions
6. **Learns** by extracting observations and storing them for next time

## Key Features

| Feature | Description |
|---------|-------------|
| **3 Review Modes** | Simple (single LLM), Workflow (5 specialist agents), Consensus (multi-model voting) |
| **Static Analysis Trident** | Semgrep (security), Trivy (vulnerabilities), CPD (code duplication) — zero tokens |
| **Project Memory** | Learns patterns, decisions, and bug fixes across reviews (PostgreSQL + tsvector FTS) |
| **Multi-Provider** | Anthropic (Claude), OpenAI (GPT-4), Google (Gemini) — bring your own key |
| **3 Distribution Modes** | SaaS, GitHub Action, CLI |
| **Dashboard** | React SPA on GitHub Pages — review history, stats, settings, memory browser |
| **BYOK Security** | AES-256-GCM encryption, HMAC-SHA256 webhook verification, privacy stripping |

## Architecture at a Glance

```mermaid
graph TB
  subgraph Distribution["Distribution Layer"]
    Server["Server<br/><small>Hono</small>"]
    Action["Action<br/><small>GitHub Action</small>"]
    CLI["CLI"]
  end

  subgraph Core["@ghagga/core"]
    SA["Static Analysis<br/><small>Semgrep · Trivy · CPD</small>"]
    Agents["AI Agents<br/><small>Simple · Workflow · Consensus</small>"]
    Memory["Memory<br/><small>Search · Persist · Privacy</small>"]
  end

  Server --> Core
  Action --> Core
  CLI --> Core
```

The review engine (`@ghagga/core`) is distribution-agnostic. Each app is a thin adapter that feeds diffs into the core and handles I/O.

## Quick Links

- **[Quick Start](quick-start.md)** — Get running in 5 minutes
- **[Architecture](architecture.md)** — Core + Adapters pattern explained
- **[Review Modes](review-modes.md)** — Simple, Workflow, and Consensus
- **[Static Analysis](static-analysis.md)** — Semgrep, Trivy, CPD
- **[Memory System](memory-system.md)** — How GHAGGA learns across reviews
- **[Configuration](configuration.md)** — Environment variables and config files
- **[GitHub Action](github-action.md)** — The fastest way to get started
- **[CLI](cli.md)** — Review local changes from your terminal
- **[Self-Hosted](self-hosted.md)** — Full deployment with Docker

## Origins

GHAGGA is a complete rewrite of [Gentleman Guardian Angel (GGA)](https://github.com/Gentleman-Programming/gentleman-guardian-angel) by [Gentleman Programming](https://youtube.com/@GentlemanProgramming). Memory system design patterns inspired by [Engram](https://github.com/Gentleman-Programming/engram).
