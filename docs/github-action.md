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
      - uses: JNZader/ghagga@v2
```

## Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `api-key` | No | — | LLM provider API key. Not required for GitHub Models (free default). |
| `provider` | No | `github` | LLM provider: `github`, `anthropic`, `openai`, `google`, `ollama`, `qwen` |
| `github-token` | No | `${{ github.token }}` | GitHub token for PR access. Automatic. |
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

Uses `node20` runtime. Tools (Semgrep, Trivy, CPD) are **auto-installed and cached** on the GitHub Actions runner. First run takes ~3-5 minutes for tool installation; subsequent runs use `@actions/cache` (~1-2 minutes).

```yaml
- uses: JNZader/ghagga@v2
```

### Docker

Uses the `apps/action/Dockerfile` which includes Semgrep, Trivy, and PMD/CPD pre-installed. Full static analysis support.

```yaml
- uses: docker://ghcr.io/jnzader/ghagga-action:latest
```

## Examples

### Workflow Mode with OpenAI

```yaml
- uses: JNZader/ghagga@v2
  with:
    api-key: ${{ secrets.OPENAI_API_KEY }}
    provider: openai
    mode: workflow
```

### Consensus Mode for Security-Sensitive Code

```yaml
- uses: JNZader/ghagga@v2
  with:
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    mode: consensus
```

### Use Review Status in Subsequent Steps

```yaml
- uses: JNZader/ghagga@v2
  id: review

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

### Qwen (Alibaba Cloud)

```yaml
- uses: JNZader/ghagga@v2
  with:
    provider: qwen
    api-key: ${{ secrets.DASHSCOPE_API_KEY }}
```

## Notes

- The action posts a comment on the PR with the review findings
- It uses `GITHUB_TOKEN` (automatically provided) to post comments
- Static analysis tools auto-install on the runner (node20 variant) or come pre-installed (Docker variant)
- Memory is not available in Action mode (no PostgreSQL connection)
