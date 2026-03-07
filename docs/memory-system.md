# Memory System

GHAGGA learns from past reviews using full-text search. The Server mode uses PostgreSQL with tsvector FTS; CLI and Action modes use a lightweight SQLite database with FTS5. Design patterns inspired by [Engram](https://github.com/Gentleman-Programming/engram) — implemented for multi-tenancy and scalability.

## How It Works

```mermaid
flowchart TB
  subgraph Write["After Review"]
    direction TB
    R["Review completes"] --> Extract["Extract observations"]
    Extract --> Dedup["Deduplicate<br/>content hash + 15-min window"]
    Dedup --> Upsert["Topic-key upsert<br/>evolve knowledge"]
    Upsert --> Strip["Privacy strip<br/>remove secrets"]
    Strip --> Store["Store in database"]
  end

  subgraph Read["Before Review"]
    direction TB
    Search["Search via tsvector FTS"] --> Inject["Inject context into prompts"]
    Inject --> AI["AI uses past knowledge"]
  end

  Store -.-> Search
```

1. **After each review**, observations are automatically extracted
2. **Deduplication** prevents storing the same observation twice (content hash + 15-minute rolling window)
3. **Topic-key upserts** evolve existing knowledge instead of creating duplicates
4. **Before each review**, relevant observations are retrieved via tsvector full-text search
5. **Privacy stripping** removes API keys, tokens, and secrets before anything is stored

## Observation Types

| Type | Description | Example |
|------|-------------|---------|
| `decision` | Architecture and design choices | "Team decided to use Zustand over Redux for state management" |
| `pattern` | Code patterns and conventions | "All API routes use zod validation middleware" |
| `bugfix` | Common errors and their fixes | "React useEffect cleanup missing causes memory leak in Dashboard" |
| `learning` | General project knowledge | "The billing module uses Stripe webhooks for payment confirmation" |
| `architecture` | System design decisions | "Microservices communicate via event bus, not direct HTTP" |
| `config` | Configuration patterns | "Environment-specific configs are in /config/{env}.ts" |
| `discovery` | Codebase discoveries | "Legacy auth module in /lib/auth is deprecated, use /modules/auth" |

## Session Model

Each review creates a **memory session** scoped to the repository. Observations within a session share context (PR number, timestamp, related files).

```mermaid
graph TB
  Project["owner/repo"] --> Session["Session: PR #42"]
  Session --> D["decision — Added retry logic to payment service"]
  Session --> P["pattern — Error boundaries wrap all route components"]
  Session --> B["bugfix — Race condition in concurrent cache writes"]
```

## Full-Text Search

Observations are indexed using PostgreSQL's `tsvector` for fast full-text search. When a new review starts, the pipeline searches for relevant past observations based on:

- File paths in the current diff
- Tech stacks detected
- Keywords from the diff content

Results are formatted as markdown and injected into agent prompts under a "Project Memory" section.

## Privacy Stripping

Before any observation is stored, sensitive data is stripped using 16 regex patterns:

| Pattern | Example | Redacted As |
|---------|---------|-------------|
| Anthropic API keys | `sk-ant-api03-...` | `[REDACTED_ANTHROPIC_KEY]` |
| OpenAI API keys | `sk-proj-...` | `[REDACTED_OPENAI_KEY]` |
| AWS Access Key IDs | `AKIA...` | `[REDACTED_AWS_KEY]` |
| GitHub tokens | `ghp_...`, `gho_...`, `ghs_...` | `[REDACTED_GITHUB_*]` |
| Google API keys | `AIza...` | `[REDACTED_GOOGLE_KEY]` |
| Slack tokens | `xoxb-...`, `xoxp-...` | `[REDACTED_SLACK_TOKEN]` |
| Bearer tokens | `Bearer eyJ...` | `Bearer [REDACTED_TOKEN]` |
| JWT tokens | `eyJ...eyJ...xxx` | `[REDACTED_JWT]` |
| PEM private keys | `-----BEGIN PRIVATE KEY-----` | `[REDACTED_PRIVATE_KEY]` |
| Password assignments | `password = "..."` | `[REDACTED]` |
| Base64 credentials | `SECRET=aGVsbG8...` | `[REDACTED_BASE64]` |

## Availability

Memory is available in **all 3 distribution modes**:

| Distribution | Memory Available | Storage Backend |
|-------------|-----------------|-----------------|
| Server (SaaS) | Yes | PostgreSQL + tsvector FTS |
| CLI | Yes (SQLite + FTS5) | `~/.config/ghagga/memory.db` |
| GitHub Action | Yes (SQLite + FTS5) | Persisted via `@actions/cache` |

The pipeline degrades gracefully — if the memory database is inaccessible for any reason, reviews still work using only the current diff and static analysis.

## SQLite Storage Backend

CLI and Action modes use a lightweight SQLite database powered by `sql.js` (a WASM build of SQLite). This provides the same memory capabilities as the Server mode without requiring a PostgreSQL installation.

### How It Works

- **CLI**: The database is stored at `~/.config/ghagga/memory.db` (following XDG conventions). It persists across reviews, so project memory grows over time.
- **Action**: The database is saved and restored between workflow runs using `@actions/cache`. Each repository gets its own cached database file.

### Search

Full-text search uses SQLite's **FTS5** extension, providing fast keyword matching against stored observations. Search queries are constructed from file paths, tech stacks, and diff keywords — the same strategy used by the PostgreSQL backend with tsvector.

### Significance Filter

Not all review findings are worth remembering. Before persisting, observations are filtered by significance — only findings with **critical**, **high**, or **medium** severity are saved to memory. Low and informational findings are discarded to keep the memory database focused and relevant.

### Observation Fields

Each observation stored in memory includes:

- `type` — observation type (decision, pattern, bugfix, etc.)
- `content` — the observation text
- `topic_key` — for upsert deduplication
- `severity` — the severity level of the finding (critical, high, medium)
- `tags` — contextual tags (file paths, tech stacks)
- `created_at` / `updated_at` — timestamps

## Dashboard Memory Management

The Dashboard's Memory page provides a full management UI for browsing, inspecting, and cleaning up stored observations and sessions.

### Available Actions

- **View observations** — list with severity badges, filterable by severity and sortable by date/type
- **View sessions** — session sidebar with observation counts
- **Observation detail** — ObservationDetailModal showing PR links, file paths, revision count, and relative timestamps
- **StatsBar** — aggregated counts by observation type and project

### 3-Tier Confirmation System

Destructive actions use a tiered `ConfirmDialog` component to prevent accidental data loss:

| Tier | Action | Confirmation |
|------|--------|-------------|
| **Tier 1** | Delete individual observation | Simple confirm modal |
| **Tier 2** | Clear all observations for a repo | Type the repo name to confirm |
| **Tier 3** | Purge ALL observations | Type "DELETE ALL" + 5-second countdown timer |

Session management includes deleting individual sessions and cleaning up empty sessions (sessions with no remaining observations).

All destructive actions show Toast notifications confirming success or reporting errors.
