# ============================================
# GHAGGA v2 — Multi-stage Docker build
# ============================================
# Includes Node.js runtime + Semgrep, Trivy, and PMD/CPD
# for full static analysis capabilities.

# ── Stage 1: Build ──────────────────────────────────────────
FROM node:22-slim AS builder

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

# Copy workspace config first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/tsconfig.json ./packages/core/
COPY packages/db/package.json packages/db/tsconfig.json ./packages/db/
COPY apps/server/package.json apps/server/tsconfig.json ./apps/server/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ ./packages/
COPY apps/server/ ./apps/server/

# Build all packages
RUN pnpm --filter @ghagga/db build && \
    pnpm --filter @ghagga/core build && \
    pnpm --filter @ghagga/server build

# Prune dev dependencies
RUN pnpm prune --prod

# ── Stage 2: Runtime ────────────────────────────────────────
FROM node:22-slim AS runtime

# Install system dependencies for static analysis tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    default-jre-headless \
    curl \
    unzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install Semgrep via venv to avoid externally-managed-environment issues
RUN python3 -m venv /opt/semgrep-venv && \
    /opt/semgrep-venv/bin/pip install --no-cache-dir semgrep && \
    ln -s /opt/semgrep-venv/bin/semgrep /usr/local/bin/semgrep

# Install Trivy
RUN curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b /usr/local/bin

# Install PMD (for CPD)
ENV PMD_VERSION=7.8.0
RUN curl -sL "https://github.com/pmd/pmd/releases/download/pmd_releases%2F${PMD_VERSION}/pmd-dist-${PMD_VERSION}-bin.zip" \
    -o /tmp/pmd.zip && \
    unzip -q /tmp/pmd.zip -d /opt && \
    mv /opt/pmd-bin-${PMD_VERSION} /opt/pmd && \
    ln -s /opt/pmd/bin/pmd /usr/local/bin/pmd && \
    rm /tmp/pmd.zip

# Create non-root user
RUN groupadd -r ghagga && useradd -r -g ghagga -m ghagga

WORKDIR /app

# Copy built application from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/core/node_modules ./packages/core/node_modules
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/db/node_modules ./packages/db/node_modules
COPY --from=builder /app/packages/db/drizzle ./packages/db/drizzle
COPY --from=builder /app/apps/server/dist ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/
COPY --from=builder /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=builder /app/package.json ./

# Copy Semgrep rules
COPY packages/core/src/tools/semgrep-rules.yml ./packages/core/src/tools/

USER ghagga

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000

CMD ["node", "apps/server/dist/index.js"]
