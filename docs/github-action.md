# GitHub Action

The fastest way to add GHAGGA to your project. No server needed — runs directly in GitHub's infrastructure.

## Basic Setup

```yaml
# .github/workflows/review.yml
name: Code Review
on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: JNZader/ghagga@main
        with:
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          provider: anthropic
          mode: simple
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | Yes | — | LLM provider API key |
| `provider` | No | `anthropic` | LLM provider: `anthropic`, `openai`, `google` |
| `model` | No | Auto | Model identifier (auto-selects best per provider) |
| `mode` | No | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `enable-semgrep` | No | `true` | Enable Semgrep security analysis |
| `enable-trivy` | No | `true` | Enable Trivy vulnerability scanning |
| `enable-cpd` | No | `true` | Enable CPD duplicate detection |

## Outputs

| Output | Description |
|--------|-------------|
| `status` | Review result: `PASSED`, `FAILED`, `NEEDS_HUMAN_REVIEW`, `SKIPPED` |
| `findings-count` | Number of findings detected |

## Variants

### Node.js (Default)

Uses `node20` runtime. Lightweight and fast to start. Static analysis tools are skipped unless installed in a prior step.

```yaml
- uses: JNZader/ghagga@main
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Docker

Uses the `apps/action/Dockerfile` which includes Semgrep, Trivy, and PMD/CPD pre-installed. Full static analysis support.

```yaml
- uses: docker://ghcr.io/jnzader/ghagga-action:latest
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Examples

### Workflow Mode with OpenAI

```yaml
- uses: JNZader/ghagga@main
  with:
    api-key: ${{ secrets.OPENAI_API_KEY }}
    provider: openai
    mode: workflow
```

### Consensus Mode for Security-Sensitive Code

```yaml
- uses: JNZader/ghagga@main
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    mode: consensus
```

### Use Review Status in Subsequent Steps

```yaml
- uses: JNZader/ghagga@main
  id: review
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Check review result
  if: steps.review.outputs.status == 'FAILED'
  run: echo "Review found issues! Findings: ${{ steps.review.outputs.findings-count }}"
```

### Only Review on Specific Paths

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - '!src/**/*.test.ts'
      - '!docs/**'
```

## Notes

- The action posts a comment on the PR with the review findings
- It uses `GITHUB_TOKEN` (automatically provided) to post comments
- Static analysis tools are only available in the Docker variant
- Memory is not available in Action mode (no PostgreSQL connection)
