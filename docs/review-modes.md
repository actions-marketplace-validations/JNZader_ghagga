# Review Modes

GHAGGA supports three review modes, each with different tradeoffs between speed, cost, and thoroughness.

## Simple Mode

Single LLM call with a comprehensive system prompt. Best for small-to-medium PRs.

```mermaid
flowchart LR
  Input["Diff + Static Analysis<br/>+ Memory + Stack Hints"] --> LLM["1 LLM Call"]
  LLM --> Output["STATUS / SUMMARY / FINDINGS"]
```

**Token usage**: ~1x (one call)
**Best for**: Quick reviews, small PRs, low token budget

The simple agent receives all context in a single prompt and returns a structured review with status, summary, and findings.

## Workflow Mode

5 specialist agents run **in parallel**, then a synthesis step merges their findings.

```mermaid
flowchart LR
  Input["Diff + Context"] --> S1["Scope Analysis"]
  Input --> S2["Coding Standards"]
  Input --> S3["Error Handling"]
  Input --> S4["Security Audit"]
  Input --> S5["Performance"]
  S1 --> Synth["Synthesis<br/>merge + deduplicate"]
  S2 --> Synth
  S3 --> Synth
  S4 --> Synth
  S5 --> Synth
  Synth --> Output["Structured Response"]
```

**Token usage**: ~6x (5 specialists + 1 synthesis)
**Best for**: Thorough reviews, large PRs, when you want focused analysis per area

Each specialist has a focused system prompt that constrains its analysis to a specific domain. The synthesis agent merges all findings, removes duplicates, and produces the final structured review.

### Specialist Focus Areas

| Specialist | What It Looks For |
|------------|-------------------|
| **Scope Analysis** | Change blast radius, coupling between modified files, missing related changes |
| **Coding Standards** | Naming conventions, DRY violations, code organization, readability |
| **Error Handling** | Null/undefined safety, missing try-catch, error propagation, edge cases |
| **Security Audit** | Injection vectors, XSS, auth bypasses, data exposure, secrets |
| **Performance** | O(n²) loops, N+1 queries, memory leaks, unnecessary re-renders, resource exhaustion |

## Consensus Mode

Multiple models review with assigned stances (for/against/neutral), then a weighted vote determines the outcome.

```mermaid
flowchart LR
  Input["Diff + Context"] --> A["Advocate<br/>looks for good"]
  Input --> C["Critic<br/>looks for problems"]
  Input --> O["Observer<br/>balanced view"]
  A --> Vote["Weighted Vote"]
  C --> Vote
  O --> Vote
  Vote --> Status["Final STATUS"]
```

**Token usage**: ~3x (3 stances)
**Best for**: Critical code paths, high-confidence decisions, security-sensitive changes

### How Voting Works

Each reviewer assigns a status (`PASSED`, `FAILED`, or `NEEDS_HUMAN_REVIEW`) with a confidence score. The final status is determined by weighted majority:

- All agree → that status
- Critic says `FAILED` with high confidence → `NEEDS_HUMAN_REVIEW` at minimum
- Split vote → `NEEDS_HUMAN_REVIEW`

### When to Use Each Mode

| Scenario | Recommended Mode |
|----------|-----------------|
| Small PR (< 200 lines) | Simple |
| Large refactor | Workflow |
| New feature with tests | Simple or Workflow |
| Security-sensitive code | Consensus |
| CI budget is tight | Simple |
| Thorough team review replacement | Workflow |
| Final review before release | Consensus |
