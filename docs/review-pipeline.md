# Review Pipeline

Every review follows the same pipeline regardless of distribution mode. Each step degrades gracefully — if static analysis fails, or memory is unavailable, the pipeline continues with what it has.

## Pipeline Steps

```mermaid
flowchart LR
  Input["Input<br/>diff + config"] --> S1["Validate"]
  S1 --> S2["Parse &<br/>Filter Diff"]
  S2 --> S3["Detect<br/>Stacks"]
  S3 --> S4["Token<br/>Budget"]
  S4 --> S5["Static Analysis<br/>+ Memory Search"]
  S5 --> S6["AI Agent<br/>Execution"]
  S6 --> S7["Merge<br/>Findings"]
  S7 --> S8["Persist<br/>Memory"]
  S8 --> Output["ReviewResult"]
```

## Step Details

### Step 1: Input Validation

The pipeline validates that all required fields are present:
- Non-empty diff
- Valid API key for the specified provider
- Known provider and model combination

If validation fails, the pipeline returns a `SKIPPED` status with the reason.

### Step 2: Diff Parsing & Filtering

The raw diff is parsed into per-file hunks. Files matching ignore patterns are removed:
- `*.lock` (lock files)
- `*.md` (documentation)
- `*.map` (source maps)
- Custom patterns from `.ghagga.json`

### Step 3: Tech Stack Detection

File extensions are mapped to tech stacks (e.g., `.ts` → TypeScript, `.py` → Python). Detected stacks are injected into agent prompts as hints so the LLM provides language-specific feedback.

### Step 4: Token Budget

The diff is truncated to fit the model's context window. The budget is split 70/30:
- **70%** for the diff content itself
- **30%** for system prompt, static analysis context, memory context, and stack hints

Files are prioritized by modification size — larger changes get reviewed first.

### Step 5: Parallel Analysis

Static analysis and memory search run **in parallel**:

```mermaid
graph TB
  subgraph Parallel["Parallel Execution"]
    direction TB
    subgraph Static["Static Tools"]
      Semgrep
      Trivy
      CPD
    end
    subgraph Mem["Memory Search"]
      FTS["tsvector<br/>full-text search"]
    end
  end
  Static --> Combined["Combined context for agents"]
  Mem --> Combined
```

### Step 6: Agent Execution

The combined context (diff + static findings + memory) is sent to the selected review mode:

- **Simple**: 1 LLM call — fast and cheap
- **Workflow**: 5 specialist agents in parallel + 1 synthesis — thorough
- **Consensus**: 3 stanced reviews + weighted vote — high confidence

See [Review Modes](review-modes.md) for details.

### Step 7: Finding Merge

Static analysis findings are merged into the agent's response. Deduplication ensures the same issue isn't reported twice (once by static analysis and once by the AI).

### Step 8: Memory Persistence

Observations are extracted from the review and stored to the memory database — PostgreSQL in Server mode, SQLite in CLI and Action modes (fire-and-forget). This step never blocks the response — if it fails, the review is still returned successfully.

## Trigger Modes

> **Static analysis in SaaS mode**: When a runner repo exists, static analysis runs on the delegated runner. Without a runner, the review proceeds with AI only. See [Runner Architecture](runner-architecture.md).

Reviews can be triggered in two ways in SaaS mode:

| Trigger | Event | When |
|---------|-------|------|
| **Automatic** | `pull_request` webhook | PR opened, updated (push), or reopened |
| **On-demand** | `issue_comment` webhook | Someone comments `ghagga review` on a PR |

The on-demand trigger uses the same pipeline and settings as automatic reviews. It adds reaction feedback: 👀 when the trigger is received, 🚀 when the review is posted.

**Who can trigger?** Anyone with a contribution relationship to the repository: owners, members, collaborators, contributors, and first-time contributors. Users with no association (`NONE`) or placeholder accounts (`MANNEQUIN`) are rejected.

## SaaS Mode (Inngest)

In server mode, the pipeline runs inside an Inngest durable function with step-based checkpointing:

```typescript
// Each step is checkpointed — retries resume from the last successful step
Step 1: Fetch PR diff from GitHub API
Step 2: Discover runner repo ({owner}/ghagga-runner)
Step 3: Dispatch to runner + wait for callback (or skip if no runner)
Step 4: Memory Search (Layer 1)
Step 5: AI Review (Layer 2)
Step 6: Save Memory (Layer 3)
Step 7: Post PR Comment + React to trigger
```

If an LLM call fails and retries, static analysis doesn't re-run. If memory search fails, the pipeline continues without it.

## Graceful Degradation

| Component | If Missing/Failed | Pipeline Behavior |
|-----------|-------------------|-------------------|
| Semgrep | Not installed | Skipped, review continues |
| Trivy | Not installed | Skipped, review continues |
| CPD | Not installed | Skipped, review continues |
| Memory (PostgreSQL or SQLite) | No database connection | Skipped, no memory context |
| LLM Provider | API error | Fallback chain attempts next provider |
| Runner repo | Not configured | LLM-only review (no static analysis) |
| Inngest | Not configured | Sync execution (no checkpointing) |
