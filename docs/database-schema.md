# Database Schema

GHAGGA uses PostgreSQL with Drizzle ORM. The schema is defined in `packages/db/src/schema.ts`.

## Tables

### installations

GitHub App installations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Internal ID |
| `github_installation_id` | integer UNIQUE | GitHub's installation ID |
| `account_login` | varchar(255) | GitHub username or org name |
| `account_type` | varchar(20) | `User` or `Organization` |
| `is_active` | boolean | Whether the installation is active |
| `created_at` | timestamp | When the app was installed |

### repositories

Repository configurations.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Internal ID |
| `github_repo_id` | integer UNIQUE | GitHub's repository ID |
| `installation_id` | integer FK | References `installations.id` |
| `full_name` | varchar(255) | `owner/repo` format |
| `is_active` | boolean | Whether reviews are enabled |
| `settings` | jsonb | Tool toggles, ignore patterns, review level |
| `encrypted_api_key` | text | AES-256-GCM encrypted LLM API key |
| `llm_provider` | varchar(50) | `anthropic`, `openai`, or `google` |
| `llm_model` | varchar(100) | Model identifier |
| `review_mode` | varchar(20) | `simple`, `workflow`, or `consensus` |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

### reviews

Review history.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Internal ID |
| `repository_id` | integer FK | References `repositories.id` |
| `pr_number` | integer | Pull request number |
| `status` | varchar(30) | `PASSED`, `FAILED`, `NEEDS_HUMAN_REVIEW`, `SKIPPED` |
| `mode` | varchar(20) | Review mode used |
| `summary` | text | Review summary |
| `findings` | jsonb | Array of `ReviewFinding` objects |
| `tokens_used` | integer | Total tokens consumed |
| `execution_time_ms` | integer | Pipeline execution time |
| `metadata` | jsonb | Additional metadata (provider, model, tools run) |
| `created_at` | timestamp | When the review was executed |

### memory_sessions

Memory sessions (one per review).

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Internal ID |
| `project` | varchar(255) | `owner/repo` format |
| `pr_number` | integer | Associated PR number |
| `summary` | text | Session summary |
| `started_at` | timestamp | Session start |
| `ended_at` | timestamp | Session end |

**Indexes**: `idx_memory_sessions_project` on `project`

### memory_observations

Individual observations extracted from reviews.

| Column | Type | Description |
|--------|------|-------------|
| `id` | serial PK | Internal ID |
| `session_id` | integer FK | References `memory_sessions.id` |
| `project` | varchar(255) | `owner/repo` format |
| `type` | varchar(30) | Observation type (see below) |
| `title` | varchar(500) | Short description |
| `content` | text | Full observation content |
| `topic_key` | varchar(255) | For upsert deduplication |
| `file_paths` | jsonb | Related file paths |
| `content_hash` | varchar(64) | SHA-256 for deduplication |
| `revision_count` | integer | How many times this topic was updated |
| `created_at` | timestamp | Creation timestamp |
| `updated_at` | timestamp | Last update timestamp |

**Indexes**:
- `idx_observations_project` on `project`
- `idx_observations_topic_key` on `topic_key`
- `idx_observations_type` on `type`

A `tsvector` column is added via raw SQL migration for full-text search.

## Observation Types

| Type | Description |
|------|-------------|
| `decision` | Architecture and design choices |
| `pattern` | Code patterns and conventions |
| `bugfix` | Common errors and their fixes |
| `learning` | General project knowledge |
| `architecture` | System design decisions |
| `config` | Configuration patterns |
| `discovery` | Codebase discoveries |

## Entity Relationships

```
installations (1) ──→ (N) repositories
repositories  (1) ──→ (N) reviews
memory_sessions (1) ──→ (N) memory_observations
```

Repositories are scoped by installation. Reviews and memory are scoped by repository. This provides natural multi-tenancy — each GitHub installation only sees its own data.
