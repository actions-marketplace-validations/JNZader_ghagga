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
      - uses: JNZader/ghagga@main
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          provider: anthropic
          mode: simple
```

See [GitHub Action](github-action.md) for all inputs and outputs.

## CLI

Review local changes from your terminal. No server required.

```bash
# Install globally
npm install -g @ghagga/cli

# Set your API key
export GHAGGA_API_KEY=sk-ant-...

# Review staged changes
ghagga review

# Review with options
ghagga review --mode workflow --provider openai --format json
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

## BYOK — Bring Your Own Key

GHAGGA never sees or stores your keys in plaintext. They're encrypted with AES-256-GCM at rest. You bring your own API key from any supported provider:

| Provider | Default Model |
|----------|--------------|
| Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | `gpt-4o` |
| Google | `gemini-2.0-flash` |
