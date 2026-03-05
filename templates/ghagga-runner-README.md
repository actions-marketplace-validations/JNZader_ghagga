# GHAGGA Static Analysis Runner

This repository runs static analysis tools (Semgrep, Trivy, PMD/CPD) on behalf of the [GHAGGA](https://ghagga.dev) AI Code Review service. It is automatically managed by the GHAGGA GitHub App.

> **You should not need to modify this repository.** GHAGGA manages the workflow file automatically and will restore it if changes are detected.

## Setup

1. **Create this repo from the template** — it must be **public** (GitHub Actions is free for public repos)
2. **Install the [GHAGGA GitHub App](https://github.com/apps/ghagga-review)** on this repository
3. **That's it** — GHAGGA will automatically dispatch analysis when you open PRs on your connected repos

## How It Works

```
┌─────────────┐    webhook    ┌──────────────┐   dispatch   ┌──────────────────┐
│   GitHub     │ ───────────► │ GHAGGA Server│ ──────────►  │ This Runner Repo │
│ (PR opened)  │              │  (Render)    │              │ (GitHub Actions) │
└─────────────┘              └──────────────┘              └──────────────────┘
                                    ▲                              │
                                    │         callback (results)   │
                                    └──────────────────────────────┘
```

1. You open a Pull Request on one of your repositories
2. GHAGGA receives the webhook and dispatches a `workflow_dispatch` event to this runner repo
3. The runner workflow clones your repo, runs Semgrep + Trivy + CPD, and sends structured JSON results back
4. GHAGGA combines the static analysis findings with AI-powered code review and posts a comment on your PR

The heavy static analysis tools (~800MB combined) run here on GitHub Actions (7GB RAM, free for public repos), while the lightweight GHAGGA server handles webhooks, LLM orchestration, and comment posting.

## Security

Your source code is handled with multiple layers of protection:

1. **Silent execution** — All tool stdout/stderr is redirected to `/dev/null`. No file paths, code snippets, or findings text appear in workflow logs.

2. **Log masking** — Repository names, tokens, and clone paths are masked using GitHub's `::add-mask::` so any accidental output is replaced with `***`.

3. **Log deletion** — Workflow logs are automatically deleted via the GitHub API after each run. As a safety net, log retention is set to the minimum (1 day).

4. **Token isolation** — The clone token is stored as an encrypted GitHub repository secret and is never included in the dispatch payload. GitHub automatically masks `${{ secrets.* }}` values in logs.

5. **Workflow integrity** — Before each dispatch, GHAGGA verifies the workflow file hasn't been tampered with by comparing its SHA-256 hash against the canonical version. If tampered, it's automatically restored.

**What this means**: Even though this repository is public, your private source code cannot be seen in the Actions logs. The only data that leaves the runner is a structured JSON payload of findings (severity, file name, line number, message) sent to the GHAGGA server via an HMAC-authenticated callback.

## Troubleshooting

### Workflow runs aren't triggering

- **Is the GHAGGA App installed?** Check your GitHub App installations at `Settings → Applications → Installed GitHub Apps`.
- **Is this repo public?** The repo must be public for free GitHub Actions minutes. Private repos will consume your Actions minutes quota.
- **Is the `GHAGGA_TOKEN` secret set?** GHAGGA automatically sets this secret before each dispatch. If it's missing, the App may need to be reinstalled.

### Clone failures

- The installation token may have expired (1-hour lifetime). GHAGGA generates a fresh token before each dispatch, but long queue times can cause expiration.
- Check that the GHAGGA App has read access to the target repository.

### Tools are failing

- Tool failures don't block the review — GHAGGA falls back to LLM-only analysis for any tools that fail.
- Individual tool results show `status: "error"` in the callback, but other tools continue.

## Tool Versions

| Tool | Version | Purpose |
|------|---------|---------|
| [Semgrep](https://semgrep.dev) | 1.90.0 | Static analysis (security, bugs, style) |
| [Trivy](https://trivy.dev) | 0.58.1 | Dependency vulnerability scanning |
| [PMD/CPD](https://pmd.github.io) | 7.8.0 | Copy-paste detection |

## Links

- [GHAGGA Website](https://ghagga.dev)
- [GHAGGA GitHub App](https://github.com/apps/ghagga-review)
- [Documentation](https://github.com/JNZader/ghagga)
