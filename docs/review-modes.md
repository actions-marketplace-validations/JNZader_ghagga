# Review Modes

GHAGGA supports three review modes, each with different tradeoffs between speed, cost, and thoroughness.

## Simple Mode

Single LLM call with a comprehensive system prompt. Best for small-to-medium PRs.

```
Diff + Static Analysis Context + Memory Context + Stack Hints
  → 1 LLM call
  → Structured response (STATUS / SUMMARY / FINDINGS)
```

**Token usage**: ~1x (one call)
**Best for**: Quick reviews, small PRs, low token budget

The simple agent receives all context in a single prompt and returns a structured review with status, summary, and findings.

## Workflow Mode

5 specialist agents run **in parallel**, then a synthesis step merges their findings.

```
Diff + Context
  → 5 specialists (parallel):
      1. Scope Analysis    — what changed, blast radius
      2. Coding Standards  — naming, formatting, DRY
      3. Error Handling    — null safety, edge cases, exceptions
      4. Security Audit    — injection, XSS, auth, data exposure
      5. Performance       — complexity, N+1, memory, resources
  → 1 synthesis call (merges + deduplicates)
  → Structured response
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

```
Diff + Context
  → 3 reviews with stances (parallel):
      1. Advocate (for)     — looks for what's good
      2. Critic (against)   — looks for problems
      3. Observer (neutral) — balanced assessment
  → Weighted vote → final STATUS
  → Structured response
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
