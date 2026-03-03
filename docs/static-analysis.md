# Static Analysis Trident

Layer 0 analysis runs **before** any LLM call. Zero tokens consumed. Known issues are injected into agent prompts so the AI focuses on logic, architecture, and things static analysis can't detect.

## Tools

| Tool | What It Finds | Languages |
|------|--------------|-----------|
| **Semgrep** | Security vulnerabilities, dangerous patterns (eval, SQL injection, XSS, hardcoded secrets) | 20 custom rules across JavaScript, TypeScript, Python, Java, Go, Ruby, PHP, C# |
| **Trivy** | Known CVEs in dependencies (npm, pip, Maven, Go modules, Cargo, etc.) | All ecosystems with lockfiles |
| **CPD** | Duplicated code blocks (copy-paste detection) | 15+ languages via PMD |

## How It Works

All three tools execute as child processes in parallel:

```mermaid
flowchart TB
  Semgrep["Semgrep<br/>security"] --> Merge["Merged findings<br/>normalized"]
  Trivy["Trivy<br/>CVEs"] --> Merge
  CPD["CPD<br/>duplicates"] --> Merge
```

Each tool's output (JSON for Semgrep/Trivy, XML for CPD) is parsed into a common `ReviewFinding` format with severity, file, line, and message.

## Graceful Degradation

Tools are optional. If a binary isn't installed or fails to run, it's silently skipped. The review continues with whatever tools are available. Check your deployment's tool status at `/health/tools`.

| Distribution | Semgrep | Trivy | CPD |
|-------------|---------|-------|-----|
| Docker (server, 1GB+ RAM) | Pre-installed | Pre-installed | Pre-installed |
| Docker (server, 512MB RAM) | Skipped** | Pre-installed | Skipped** |
| Docker (action) | Pre-installed | Pre-installed | Pre-installed |
| GitHub Action (node20) | Skipped* | Skipped* | Skipped* |
| CLI | If installed locally | If installed locally | If installed locally |

> \* The node20 action variant doesn't include static analysis tools by default. Use the Docker action variant for full static analysis, or install tools in a prior step.

> \*\* Semgrep (Python) and PMD/CPD (Java) require more than 512MB RAM. On hosting plans with limited memory (e.g., Render free tier), these tools are installed but fail at runtime due to OOM. Trivy (Go binary) works fine on 512MB. Upgrade to a plan with 1GB+ RAM for all three tools.

## Semgrep

### Built-in Rules

GHAGGA ships with 20 custom security rules in `packages/core/src/tools/semgrep-rules.yml` covering:

- **Injection**: SQL injection, command injection, SSRF
- **XSS**: Unescaped output, dangerous innerHTML
- **Secrets**: Hardcoded API keys, passwords, tokens
- **Dangerous APIs**: `eval()`, `Function()`, `child_process.exec()`
- **Auth**: Missing authentication checks, broken access control

### Custom Rules

Add your own Semgrep rules:

```json
{
  "customRules": [".semgrep/my-rules.yml"]
}
```

Rules are loaded relative to the repository root.

## Trivy

Scans lockfiles for known CVEs:
- `package-lock.json` / `yarn.lock` / `pnpm-lock.yaml` (Node.js)
- `requirements.txt` / `Pipfile.lock` / `poetry.lock` (Python)
- `go.sum` (Go)
- `Cargo.lock` (Rust)
- `pom.xml` / `build.gradle` (Java)
- `Gemfile.lock` (Ruby)

Findings include CVE ID, severity, affected package, and fixed version.

## CPD (Copy-Paste Detector)

PMD's CPD detects duplicated code blocks. Findings include:
- File paths of both copies
- Line numbers
- Number of duplicated tokens
- The duplicated code snippet

Useful for catching copy-pasted logic that should be extracted into a shared function.
