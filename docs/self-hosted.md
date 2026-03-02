# Self-Hosted (Docker)

Full deployment with PostgreSQL, memory, dashboard, and all static analysis tools.

## Quick Start

```bash
git clone https://github.com/JNZader/ghagga.git
cd ghagga
cp .env.example .env
# Edit .env with your credentials
docker compose up -d
```

This starts:
- **PostgreSQL 16** on port 5432 with health checks
- **GHAGGA Server** (Hono) on port 3000 with Semgrep, Trivy, and CPD pre-installed

## Docker Compose

The `docker-compose.yml` defines two services:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ghagga
      POSTGRES_USER: ghagga
      POSTGRES_PASSWORD: ghagga
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ghagga"]
      interval: 5s
      timeout: 5s
      retries: 5

  server:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://ghagga:ghagga@postgres:5432/ghagga
      # Add your GitHub App and Inngest credentials
    depends_on:
      postgres:
        condition: service_healthy
```

## Dockerfile

Multi-stage build that includes all static analysis tools:

1. **Stage 1** — Install pnpm and dependencies
2. **Stage 2** — Build TypeScript packages
3. **Stage 3** — Production image with:
   - Semgrep (via pip)
   - Trivy (via official install script)
   - PMD/CPD (via direct download)
   - Node.js runtime with built packages

## Required Environment Variables

See [Configuration](configuration.md) for the full list. At minimum you need:

| Variable | Where to Get It |
|----------|----------------|
| `DATABASE_URL` | Provided by Docker Compose |
| `GITHUB_APP_ID` | [Create a GitHub App](https://github.com/settings/apps/new) |
| `GITHUB_PRIVATE_KEY` | Download from GitHub App settings, base64-encode it |
| `GITHUB_WEBHOOK_SECRET` | Generate with `openssl rand -hex 20` |
| `GITHUB_CLIENT_ID` | From GitHub App settings |
| `GITHUB_CLIENT_SECRET` | From GitHub App settings |
| `INNGEST_EVENT_KEY` | [Sign up at Inngest](https://www.inngest.com/) (free tier: 50k events/month) |
| `INNGEST_SIGNING_KEY` | From Inngest dashboard |
| `ENCRYPTION_KEY` | Generate with `openssl rand -hex 32` |

## 1-Click Deploy (Railway)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/ghagga)

Railway auto-provisions PostgreSQL and sets up the environment. You just need to add:
1. GitHub App credentials
2. Inngest keys
3. Encryption key

## GitHub App Setup

To use GHAGGA as a SaaS webhook receiver:

1. Create a GitHub App at `https://github.com/settings/apps/new`
2. Set permissions:
   - **Pull requests**: Read & write
   - **Contents**: Read-only
3. Subscribe to events:
   - **Pull request**
4. Set webhook URL to `https://your-domain.com/webhook/github`
5. Generate and download the private key
6. Install the app on your repositories

## Development Setup

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
docker compose up postgres -d

# Configure environment
cp .env.example .env

# Run migrations
pnpm --filter @ghagga/db db:push

# Start server
pnpm --filter @ghagga/server dev

# Start dashboard (separate terminal)
pnpm --filter @ghagga/dashboard dev
```
