# GHAGGA CLI

AI-powered code review from the command line. **Free** with GitHub Models.

```bash
npx @ghagga/cli login
npx @ghagga/cli review
```

That's it. Zero config, zero cost.

## What is GHAGGA?

GHAGGA is a multi-agent AI code reviewer that analyzes your code changes using LLMs. It supports three review modes with increasing depth:

| Mode | Speed | Depth | LLM Calls |
|------|-------|-------|-----------|
| **simple** | ~2s | Single-pass review | 1 |
| **workflow** | ~15s | 5 specialist agents + synthesis | 6 |
| **consensus** | ~7s | For/against/neutral voting | 3 |

## Quick Start

### 1. Login (one time)

```bash
npx @ghagga/cli login
```

This authenticates with GitHub using Device Flow. Your GitHub token gives you **free access** to AI models via [GitHub Models](https://github.com/marketplace/models).

### 2. Review your code

```bash
# Review staged/uncommitted changes (simple mode)
npx @ghagga/cli review

# Thorough review with 5 specialist agents
npx @ghagga/cli review --mode workflow

# Balanced review with for/against/neutral voting
npx @ghagga/cli review --mode consensus

# See detailed progress of each step
npx @ghagga/cli review --mode workflow --verbose
```

### 3. Check your status

```bash
npx @ghagga/cli status    # Show auth & config
npx @ghagga/cli logout    # Clear credentials
```

## Global Installation

If you use it frequently:

```bash
npm install -g @ghagga/cli

ghagga login
ghagga review
ghagga review -m workflow -v
```

## Options

```
Usage: ghagga review [options] [path]

Options:
  -m, --mode <mode>          Review mode: simple, workflow, consensus (default: "simple")
  -p, --provider <provider>  LLM provider: github, openai, anthropic, google
  --model <model>            LLM model identifier
  --api-key <key>            LLM provider API key
  -f, --format <format>      Output format: markdown, json (default: "markdown")
  -v, --verbose              Show detailed progress during review
  --no-semgrep               Disable Semgrep static analysis
  --no-trivy                 Disable Trivy vulnerability scanning
  --no-cpd                   Disable CPD duplicate detection
  -c, --config <path>        Path to .ghagga.json config file
```

## BYOK (Bring Your Own Key)

Use any supported LLM provider:

```bash
# GitHub Models (default, free)
ghagga review --provider github

# Ollama (local, free, 100% offline)
ghagga review --provider ollama
ghagga review --provider ollama --model codellama:13b

# OpenAI
ghagga review --provider openai --api-key sk-...

# Anthropic
ghagga review --provider anthropic --api-key sk-ant-...

# Google
ghagga review --provider google --api-key AIza...
```

## Local Models with Ollama

Run reviews 100% offline with [Ollama](https://ollama.com):

```bash
# 1. Install Ollama and pull a model
ollama pull qwen2.5-coder:7b

# 2. Review with local AI (no API key, no internet needed)
ghagga review --provider ollama

# Recommended models for code review:
#   qwen2.5-coder:7b    (~5 GB RAM, great for code)
#   codellama:13b        (~8 GB RAM, solid analysis)
#   deepseek-coder-v2:16b (~10 GB RAM, excellent quality)
#   llama3.1:8b          (~5 GB RAM, general purpose)
```

## Environment Variables

```bash
GHAGGA_API_KEY=<key>       # API key for the LLM provider
GHAGGA_PROVIDER=<provider> # LLM provider override
GHAGGA_MODEL=<model>       # Model identifier override
GITHUB_TOKEN=<token>       # GitHub token (fallback for github provider)
```

## Config File

Create a `.ghagga.json` in your project root:

```json
{
  "mode": "workflow",
  "enableSemgrep": true,
  "enableTrivy": true,
  "enableCpd": true,
  "ignorePatterns": ["*.test.ts", "*.spec.ts"],
  "reviewLevel": "strict"
}
```

## How It Works

1. Gets your `git diff` (staged or uncommitted changes)
2. Parses the diff and detects tech stacks
3. Runs static analysis (Semgrep, Trivy, CPD) if available
4. Sends the diff + context to the AI review agent
5. Returns findings with severity, file, line, and suggestions

## Requirements

- Node.js >= 20
- Git (for diff detection)
- A GitHub account (for free AI models)

## License

MIT

## Links

- [GitHub Repository](https://github.com/JNZader/ghagga)
- [Documentation](https://jnzader.github.io/ghagga/docs/)
- [Landing Page](https://jnzader.github.io/ghagga/)
