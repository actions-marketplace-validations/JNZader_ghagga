# CLI

Review local changes from your terminal. No server or database required.

## Installation

```bash
npm install -g @ghagga/cli
```

## Usage

```bash
# Set your API key
export GHAGGA_API_KEY=sk-ant-...

# Review staged changes (default: simple mode, anthropic provider)
ghagga review

# Review with options
ghagga review --mode workflow --provider openai --format json

# Review a specific directory
ghagga review /path/to/repo --mode consensus
```

## Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--mode <mode>` | `-m` | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `--provider <provider>` | `-p` | `anthropic` | LLM provider (or `GHAGGA_PROVIDER` env var) |
| `--model <model>` | — | Auto | Model identifier (or `GHAGGA_MODEL` env var) |
| `--api-key <key>` | — | — | API key (or `GHAGGA_API_KEY` env var) |
| `--format <format>` | `-f` | `markdown` | Output format: `markdown`, `json` |
| `--no-semgrep` | — | — | Disable Semgrep |
| `--no-trivy` | — | — | Disable Trivy |
| `--no-cpd` | — | — | Disable CPD |
| `--config <path>` | `-c` | `.ghagga.json` | Path to config file |

## Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Review passed or was skipped |
| `1` | Review failed or needs human review |

Use exit codes in CI/CD to fail pipelines on review failures.

## Config File

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

**Priority**: CLI flags > config file > environment variables > defaults.

## How It Works

1. Computes `git diff` for staged/unstaged changes
2. Passes the diff to `@ghagga/core` pipeline
3. Runs static analysis if tools are installed locally
4. Outputs the review to stdout (markdown or JSON)

## Static Analysis

Static analysis tools are used if installed locally:

```bash
# Install tools (optional)
brew install semgrep
brew install trivy
brew install pmd
```

If any tool isn't found, it's silently skipped.

## Examples

### JSON Output for CI Integration

```bash
ghagga review --format json | jq '.status'
```

### Strict Review with All Tools

```bash
ghagga review --mode workflow --config '{"reviewLevel": "strict"}'
```

### Quick Simple Review

```bash
GHAGGA_API_KEY=sk-... ghagga review
```
