# Tasks: Runner Dynamic Tool Resolution

## Phase 1: Foundation — Inputs & Resolve Step

- [ ] 1.1 Add `enabledTools` and `disabledTools` as workflow_dispatch inputs to `templates/ghagga-analysis.yml` (type: string, required: false, default: `'[]'`). Place them after the existing `enableCpd` input.

- [ ] 1.2 Add the "Resolve Tools" step to `templates/ghagga-analysis.yml` after the clone step and before any cache/install steps. Implement the bash algorithm:
  - Start with always-on set: `["semgrep","trivy","cpd","gitleaks","shellcheck","markdownlint","lizard"]`
  - Auto-detect via `find target-repo` for each auto-detect tool's file patterns:
    - ruff/bandit: `.py`, `.pyi`
    - golangci-lint: `go.mod`, `.go`
    - biome: `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`, `.cts`, `.cjs`
    - pmd: `.java`, `.kt`
    - psalm: `.php`, `composer.json`
    - clippy: `Cargo.toml`, `.rs`
    - hadolint: `Dockerfile*`
  - Apply `enabledTools` (force-add) and `disabledTools` (force-remove) via jq
  - Legacy boolean fallback when `disabledTools` is empty
  - Output deduplicated JSON array to `$GITHUB_OUTPUT` as `tools`
  - Gate on `steps.clone.outcome == 'success'`

- [ ] 1.3 Refactor the existing Semgrep cache/install/run steps to use the new `contains(steps.resolve.outputs.tools, '"semgrep"')` condition instead of `github.event.inputs.enableSemgrep == 'true'`. Keep all existing logic intact.

- [ ] 1.4 Refactor the existing Trivy cache/install/run steps to use `contains(steps.resolve.outputs.tools, '"trivy"')` condition.

- [ ] 1.5 Refactor the existing CPD (PMD) cache/install/run steps to use `contains(steps.resolve.outputs.tools, '"cpd"')` condition. Note: the PMD cache and install are shared with the PMD tool in Phase 2.

## Phase 2: Core — New Tool Blocks (Always-On)

- [ ] 2.1 Add gitleaks block to `templates/ghagga-analysis.yml`:
  - **Cache**: path `/usr/local/bin/gitleaks`, key `gitleaks-8.21.2-${{ runner.os }}`
  - **Install**: `curl -sL "https://github.com/gitleaks/gitleaks/releases/.../gitleaks_8.21.2_linux_x64.tar.gz" | tar xz -C /usr/local/bin gitleaks 2>/dev/null`
  - **Run**: `gitleaks detect --source target-repo --report-format json --report-path /tmp/gitleaks-raw.json --no-git --exit-code 0 2>/dev/null`
  - **Parse**: jq mapping: each finding → `severity: "critical"`, `category: "secrets"`, `source: "gitleaks"`, `file`, `line` (from StartLine), `message` (from Description + RuleID)
  - All steps gated on `contains(steps.resolve.outputs.tools, '"gitleaks"')`

- [ ] 2.2 Add shellcheck block:
  - **Install**: Verify with `shellcheck --version` (pre-installed on ubuntu-latest). Fallback: `curl tar.xz` from GitHub Releases v0.10.0
  - **Run**: `find target-repo -name '*.sh' -o -name '*.bash'` to collect files, then `shellcheck --format=json {files} > /tmp/shellcheck-raw.json 2>/dev/null`. If no shell files found, write empty success result directly.
  - **Parse**: jq: `.[]` → severity mapping (error→high, warning→medium, info→info, style→low), `source: "shellcheck"`, message includes `SC{code}` prefix

- [ ] 2.3 Add markdownlint block:
  - **Install**: `npm install -g markdownlint-cli2@0.17.1 2>/dev/null`
  - **Run**: `markdownlint-cli2 "target-repo/**/*.md" --config "{}" 2>/dev/null` — capture output. If no `.md` files exist, write empty success.
  - **Parse**: Parse markdownlint output format → `severity: "info"`, `category: "docs"`, `source: "markdownlint"`, message includes rule name

- [ ] 2.4 Add lizard block:
  - **Cache**: pip cache (`~/.cache/pip`), key `lizard-1.17.13-${{ runner.os }}`
  - **Install**: `pip install --quiet lizard==1.17.13 2>/dev/null`
  - **Run**: `lizard --json target-repo > /tmp/lizard-raw.json 2>/dev/null`
  - **Parse**: python3 inline: iterate `function_list`, map `cyclomatic_complexity` to severity (>20→high, >15→medium, >10→low, ≤10→skip), `source: "lizard"`, `category: "complexity"`

## Phase 3: Core — New Tool Blocks (Auto-Detect)

- [ ] 3.1 Add ruff block:
  - **Cache**: pip cache, key `ruff-0.9.7-${{ runner.os }}`
  - **Install**: `pip install --quiet ruff==0.9.7 2>/dev/null`
  - **Run**: `ruff check --output-format json target-repo > /tmp/ruff-raw.json 2>/dev/null` (exit code 1 = findings found, not error)
  - **Parse**: jq: `.[]` → map code prefix (F→high, E→medium, W→low, default→low), `source: "ruff"`, `category: "quality"`

- [ ] 3.2 Add bandit block:
  - **Cache**: pip cache, key `bandit-1.8.3-${{ runner.os }}`
  - **Install**: `pip install --quiet bandit==1.8.3 2>/dev/null`
  - **Run**: `bandit -r target-repo -f json --quiet > /tmp/bandit-raw.json 2>/dev/null` (exit code 1 = findings)
  - **Parse**: jq: `.results[]` → severity mapping (HIGH→high, MEDIUM→medium, LOW→low), include `test_id` and `issue_confidence` in message, `source: "bandit"`, `category: "security"`

- [ ] 3.3 Add golangci-lint block:
  - **Cache**: path `/usr/local/bin/golangci-lint`, key `golangci-lint-1.63.4-${{ runner.os }}`
  - **Install**: `curl -sSfL https://raw.githubusercontent.com/golangci/golangci-lint/master/install.sh | sh -s -- -b /usr/local/bin v1.63.4 2>/dev/null`
  - **Run**: `cd target-repo && golangci-lint run --out-format json --timeout 300s > /tmp/golangci-lint-raw.json 2>/dev/null` (exit code 1 = findings)
  - **Parse**: jq: `.Issues[]` → map FromLinter ("gosec"→high/security, others→medium/quality), `source: "golangci-lint"`

- [ ] 3.4 Add biome block:
  - **Install**: `npm install -g @biomejs/biome@1.9.4 2>/dev/null`
  - **Run**: `biome lint --reporter json target-repo > /tmp/biome-raw.json 2>/dev/null` (exit code 1 = findings)
  - **Parse**: jq: `.diagnostics[]` → severity mapping (error→high, warning→medium, information→low, hint→info), `source: "biome"`, `category: "quality"`

- [ ] 3.5 Add pmd block (shares install with CPD):
  - **Install**: Check if `/opt/pmd/bin/pmd` exists (installed by CPD step). If not, run same install as CPD. No duplicate cache step needed.
  - **Run**: `/opt/pmd/bin/pmd check --format json --dir target-repo --rulesets rulesets/java/quickstart.xml > /tmp/pmd-raw.json 2>/dev/null` (exit code 4 = violations found)
  - **Parse**: jq: `.files[].violations[]` → priority mapping (1→critical, 2→high, 3→medium, 4→low, 5→info), `source: "pmd"`, `category: "quality"`

- [ ] 3.6 Add psalm block:
  - **Install**: Check for PHP with `php --version`. If available: `composer global require vimeo/psalm:6.5.1 2>/dev/null`. If PHP not available, write error result and skip.
  - **Run**: `cd target-repo && psalm --output-format=json --no-cache > /tmp/psalm-raw.json 2>/dev/null` (exit codes 1, 2 = findings)
  - **Parse**: jq: `.[]` → severity mapping (error→high, info→low, Tainted*→critical), `source: "psalm"`, `category: "quality"`

- [ ] 3.7 Add clippy block:
  - **Install**: Check for cargo with `cargo --version`. If not available, write error result and skip.
  - **Run**: `cd target-repo && cargo clippy --message-format=json -- -W clippy::all > /tmp/clippy-raw.json 2>/dev/null` (exit codes 1, 101 = findings/errors)
  - **Parse**: python3 inline (line-delimited JSON, not array): filter for `reason == "compiler-message"`, map `message.level` (error→high, warning→medium, note→low), `source: "clippy"`, `category: "quality"`

- [ ] 3.8 Add hadolint block:
  - **Cache**: path `/usr/local/bin/hadolint`, key `hadolint-2.12.0-${{ runner.os }}`
  - **Install**: `curl -sL "https://github.com/hadolint/hadolint/releases/download/v2.12.0/hadolint-Linux-x86_64" -o /usr/local/bin/hadolint && chmod +x /usr/local/bin/hadolint 2>/dev/null`
  - **Run**: `find target-repo -name 'Dockerfile*'` to collect files, then `hadolint --format json {files} > /tmp/hadolint-raw.json 2>/dev/null`. If no Dockerfiles, write empty success.
  - **Parse**: jq: `.[]` → level mapping (error→high, warning→medium, info→info, style→low), `source: "hadolint"`, message includes `{code}: {message}`

## Phase 4: Integration — Assemble & Callback

- [ ] 4.1 Rewrite the "Post results to callback" step in `templates/ghagga-analysis.yml` to dynamically assemble results from ALL resolved tools:
  - Read `steps.resolve.outputs.tools` to know which tools ran
  - Always include `semgrep`, `trivy`, `cpd` keys (read from `/tmp/{tool}-result.json` or use skipped template)
  - For each additional resolved tool, read `/tmp/{tool}-result.json` or use skipped template
  - Use jq to build the `staticAnalysis` object dynamically
  - Compute HMAC-SHA256 signature and POST to callbackUrl (same as current)

- [ ] 4.2 Update the "Report clone failure" step to include all 7 always-on tool keys (not just semgrep/trivy/cpd) in the error payload. For auto-detect tools, since we can't detect without a clone, only include legacy keys.

- [ ] 4.3 Verify cleanup step still removes all new tmp files: add `/tmp/*-raw.*` and `/tmp/*-result.*` patterns to the cleanup step (already uses wildcard, but verify).

## Phase 5: Verification & Polish

- [ ] 5.1 Validate YAML syntax: run `python3 -c "import yaml; yaml.safe_load(open('templates/ghagga-analysis.yml'))"` to check the file is valid YAML. Check file size is under 256KB.

- [ ] 5.2 Manual test: dispatch workflow to a test runner repo with a Python+TypeScript target repo. Verify:
  - Resolve step outputs include semgrep, trivy, cpd, gitleaks, shellcheck, markdownlint, lizard, ruff, bandit, biome
  - All resolved tools have install/run/parse steps execute
  - Callback payload includes results for all 10 tools
  - No target-repo content visible in workflow logs

- [ ] 5.3 Manual test: dispatch with `disabledTools: '["semgrep","gitleaks"]'`. Verify semgrep and gitleaks steps are skipped, callback has `semgrep: {status:"skipped"}`, gitleaks is absent from payload.

- [ ] 5.4 Manual test: dispatch with legacy-only inputs (no enabledTools/disabledTools, `enableSemgrep: 'false'`). Verify semgrep is skipped, trivy and cpd run, only 3 legacy keys in payload.

- [ ] 5.5 Review all `2>/dev/null` redirections and `continue-on-error: true` annotations. Ensure no step can leak target-repo content or fail the job.
