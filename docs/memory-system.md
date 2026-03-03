# Memory System

GHAGGA learns from past reviews using PostgreSQL full-text search. Design patterns inspired by [Engram](https://github.com/Gentleman-Programming/engram) — implemented directly in PostgreSQL for multi-tenancy and scalability.

## How It Works

```mermaid
flowchart TB
  subgraph Write["After Review"]
    direction TB
    R["Review completes"] --> Extract["Extract observations"]
    Extract --> Dedup["Deduplicate<br/><small>content hash + 15-min window</small>"]
    Dedup --> Upsert["Topic-key upsert<br/><small>evolve knowledge</small>"]
    Upsert --> Strip["Privacy strip<br/><small>remove secrets</small>"]
    Strip --> Store["Store in PostgreSQL"]
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

Memory requires PostgreSQL. It's only available in the Server (SaaS) mode.

| Distribution | Memory Available |
|-------------|-----------------|
| Server (SaaS) | Yes |
| CLI | No (no database) |
| GitHub Action | No (no database) |

The pipeline degrades gracefully — without memory, reviews still work using only the current diff and static analysis.
