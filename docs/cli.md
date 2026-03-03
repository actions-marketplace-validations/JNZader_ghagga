# CLI

Review local changes from your terminal. No server or database required.

## Installation

```bash
npm install -g ghagga
```

## Usage

```bash
# Login with GitHub (free — uses GitHub Models, no API key needed)
ghagga login

# Review staged changes (default: simple mode, GitHub Models)
ghagga review

# Review with options
ghagga review --mode workflow --provider openai --api-key sk-xxx
ghagga review --provider qwen --api-key sk-xxx --format json

# Review with local Ollama
ghagga review --provider ollama --model qwen2.5-coder:7b
```

## Options

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--mode <mode>` | `-m` | `simple` | Review mode: `simple`, `workflow`, `consensus` |
| `--provider <provider>` | `-p` | `github` | LLM provider: `github`, `anthropic`, `openai`, `google`, `ollama`, `qwen` (or `GHAGGA_PROVIDER` env var) |
| `--model <model>` | — | Auto | Model identifier (or `GHAGGA_MODEL` env var) |
| `--api-key <key>` | — | — | API key (or `GHAGGA_API_KEY` env var) |
| `--format <format>` | `-f` | `markdown` | Output format: `markdown`, `json` |
| `--no-semgrep` | — | — | Disable Semgrep |
| `--no-trivy` | — | — | Disable Trivy |
| `--no-cpd` | — | — | Disable CPD |
| `--verbose` | `-v` | — | Show real-time progress of each pipeline step |
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
  "provider": "github",
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

1. Authenticates via stored GitHub token (from `ghagga login`)
2. Computes `git diff` for staged/unstaged changes
3. Passes the diff to `@ghagga/core` pipeline
4. Runs static analysis if tools are installed locally
5. Outputs the review to stdout (markdown or JSON)

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
ghagga review
```
