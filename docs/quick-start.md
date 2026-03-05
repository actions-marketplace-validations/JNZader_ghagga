# Quick Start

Choose your preferred distribution mode. All modes use the same review engine under the hood.

## GitHub Action (Recommended)

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
      - uses: JNZader/ghagga@v2
```

See [GitHub Action](github-action.md) for all inputs and outputs.

## CLI

Review local changes from your terminal. No server required.

```bash
# Install globally
npm install -g ghagga

# Login with GitHub (free — uses GitHub Models, no API key needed)
ghagga login

# Review staged changes (default: simple mode, GitHub Models (free))
ghagga review

# Review with options
ghagga review --mode workflow --format json
```

See [CLI](cli.md) for all options and config file support.

## Self-Hosted (Docker)

Full deployment with PostgreSQL, memory, and dashboard support.

```bash
git clone https://github.com/JNZader/ghagga.git
cd ghagga
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

This starts PostgreSQL 16 on port 5432 and the GHAGGA Server (Hono) on port 3000 with Semgrep, Trivy, and CPD pre-installed.

See [Self-Hosted](self-hosted.md) for full deployment details.

## SaaS Mode — Runner Setup

If you're using the hosted GHAGGA SaaS (Render deployment), static analysis runs on a delegated runner. To enable it:

1. **Create a runner repo** from the template: [`JNZader/ghagga-runner-template`](https://github.com/JNZader/ghagga-runner-template)
2. **Name it `ghagga-runner`** — the server discovers it by convention
3. **Keep it public** — required for free GitHub Actions minutes

That's it. The server will auto-discover your runner and dispatch static analysis to it. If you skip this step, reviews still work — they just skip static analysis.

See [Runner Architecture](runner-architecture.md) for details.

## BYOK — Bring Your Own Key

GHAGGA never sees or stores your keys in plaintext. They're encrypted with AES-256-GCM at rest. You bring your own API key from any supported provider:

| Provider | Default Model |
|----------|--------------|
| GitHub Models | `gpt-4o-mini` |
| Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | `gpt-4o` |
| Google | `gemini-2.5-flash` |
| Ollama | `qwen2.5-coder:7b` |
| Qwen | `qwen-coder-plus` |
