# Configuration

## Environment Variables

### Server Mode

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `GITHUB_APP_ID` | Yes | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | Yes | Base64-encoded `.pem` file content |
| `GITHUB_WEBHOOK_SECRET` | Yes | Secret configured in GitHub App webhook settings |
| `GITHUB_CLIENT_ID` | Yes | For OAuth login (dashboard) |
| `GITHUB_CLIENT_SECRET` | Yes | For OAuth login (dashboard) |
| `INNGEST_EVENT_KEY` | Yes | Inngest event ingestion key |
| `INNGEST_SIGNING_KEY` | Yes | Inngest webhook signing key |
| `ENCRYPTION_KEY` | Yes | 64-character hex string for AES-256-GCM encryption |
| `PORT` | No | Server port (default: `3000`) |
| `NODE_ENV` | No | `development` or `production` |

### CLI Mode

| Variable | Required | Description |
|----------|----------|-------------|
| `GHAGGA_API_KEY` | Yes | LLM provider API key |
| `GHAGGA_PROVIDER` | No | Provider: `anthropic`, `openai`, `google` (default: `anthropic`) |
| `GHAGGA_MODEL` | No | Model identifier (auto-selects best per provider) |

### GitHub Action Mode

API key and provider are passed as action inputs, not environment variables. See [GitHub Action](github-action.md).

## Config File (`.ghagga.json`)

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

**Priority**: CLI flags > config file > defaults.

## Default Models

| Provider | Default Model |
|----------|--------------|
| Anthropic | `claude-sonnet-4-20250514` |
| OpenAI | `gpt-4o` |
| Google | `gemini-2.0-flash` |

## Token Budget

The diff is automatically truncated to fit each model's context window using a 70/30 split:

| Allocation | Percentage | Purpose |
|-----------|-----------|---------|
| Diff content | 70% | The actual code changes |
| Agent prompts + context | 30% | System prompt, static analysis, memory, stack hints |

## Ignore Patterns

Files matching ignore patterns are excluded from the diff before review. This saves tokens and avoids noisy findings on auto-generated files.

Default ignored patterns:
- `*.lock` — Lock files (package-lock.json, yarn.lock, pnpm-lock.yaml)
- `*.md` — Markdown documentation
- `*.map` — Source maps

Add custom patterns in `.ghagga.json`:

```json
{
  "ignorePatterns": [
    "*.test.ts",
    "*.spec.ts",
    "docs/**",
    "generated/**",
    "*.snap"
  ]
}
```

## Review Levels

| Level | Behavior |
|-------|----------|
| `soft` | Only flag critical and high severity issues. Lenient on style. |
| `normal` | Default. Flag all severities with balanced feedback. |
| `strict` | Zero tolerance. Flag everything including style and naming. |

Set via config file or CLI flag:

```bash
ghagga review --config '{"reviewLevel": "strict"}'
```
