# Memory System Specification

## Purpose

The memory system gives GHAGGA the ability to learn from past reviews. It stores structured observations (decisions, patterns, bugs found) in PostgreSQL with full-text search, enabling agents to receive context from previous reviews of the same repository. Inspired by Engram's design patterns but built for multi-tenancy.

## Requirements

### Requirement: Observation Persistence

The system MUST save structured observations after each review, capturing what was learned.

#### Scenario: Save observation after review

- GIVEN a completed review that found a security issue in `auth/login.ts`
- WHEN the memory persistence step runs
- THEN the system MUST save an observation with:
  - `type`: one of (decision, pattern, bugfix, learning, architecture, config, discovery)
  - `title`: concise description of the finding
  - `content`: structured details (what_happened, why_it_matters, what_was_learned)
  - `project`: repository full name (e.g., "owner/repo")
  - `session_id`: link to the review session
  - `file_paths`: array of affected files
- AND the observation MUST be indexed for full-text search via tsvector

#### Scenario: Deduplication within rolling window

- GIVEN an observation with the same content hash, project, and type was saved 5 minutes ago
- WHEN the system attempts to save a duplicate observation
- THEN the system MUST skip the save and return the existing observation ID
- AND the deduplication window MUST be 15 minutes

### Requirement: Topic-Key Upserts

The system MUST support a `topic_key` field for evolving knowledge that updates rather than duplicates.

#### Scenario: Update existing knowledge

- GIVEN an observation with topic_key "auth/jwt-strategy" exists for project "owner/repo"
- WHEN a new observation with the same topic_key is saved
- THEN the system MUST update the existing observation's content
- AND increment the `revision_count`
- AND update the `updated_at` timestamp

#### Scenario: Different projects same topic_key

- GIVEN project "owner/repo-a" has an observation with topic_key "database/migration-pattern"
- WHEN project "owner/repo-b" saves an observation with the same topic_key
- THEN the system MUST create a NEW observation (not update repo-a's)
- AND both observations MUST coexist independently

### Requirement: Memory Search

The system MUST support full-text search across observations scoped to a specific project.

#### Scenario: Search by keywords

- GIVEN a project "owner/repo" has 50 observations
- WHEN a search is performed with query "authentication middleware"
- THEN the results MUST be ranked by relevance (tsvector ranking)
- AND results MUST be scoped to the specified project only
- AND results MUST be limited to a configurable maximum (default: 10)

#### Scenario: Search by file path

- GIVEN observations exist that reference file "src/api/auth.ts"
- WHEN a search is performed filtering by file path "src/api/auth.ts"
- THEN the results MUST include only observations that reference that file

#### Scenario: No results found

- GIVEN a search query that matches no observations
- WHEN the search completes
- THEN the system MUST return an empty array (not an error)

### Requirement: Session Management

The system MUST track review sessions to group observations.

#### Scenario: Session lifecycle

- GIVEN a new PR review is triggered for "owner/repo" PR #42
- WHEN the review pipeline starts
- THEN the system MUST create a new memory session with:
  - `project`: "owner/repo"
  - `pr_number`: 42
  - `started_at`: current timestamp
- AND when the review completes, the session MUST be updated with:
  - `ended_at`: current timestamp
  - `summary`: text summary of what was reviewed and found

### Requirement: Context Retrieval for Agent Prompts

The system MUST format retrieved memories into a context block for agent prompts.

#### Scenario: Memory context injection

- GIVEN 3 past observations are found relevant to the current diff
- WHEN the memory context is prepared for agent prompts
- THEN the output MUST be a markdown block titled "Past Review Memory"
- AND each observation MUST include its type, title, and key learnings
- AND the block MUST end with "Use these past observations to give more informed, context-aware reviews"

#### Scenario: No past memories

- GIVEN a project with no past observations (first review)
- WHEN the memory context is prepared
- THEN the context block MUST be omitted from the prompt entirely
- AND no error MUST occur

### Requirement: Privacy Stripping

The system MUST strip sensitive data from observations before persistence.

#### Scenario: API keys in code diff

- GIVEN a review observation that contains text matching API key patterns (e.g., "sk-..." or "AKIA...")
- WHEN the observation is being saved
- THEN the system MUST replace detected secrets with "[REDACTED]"
- AND the original values MUST never be persisted

### Requirement: Multi-Tenant Isolation

The system MUST ensure complete data isolation between projects/repositories.

#### Scenario: Cross-project isolation

- GIVEN user A queries memories for project "org/repo-a"
- WHEN the query executes
- THEN results MUST NOT include observations from "org/repo-b"
- AND the database query MUST include a project filter (not rely on application-level filtering)
