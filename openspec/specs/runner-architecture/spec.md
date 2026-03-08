# Actions Runner Architecture — Specification

> **Origin**: Archived from `actions-runner-architecture` change (2026-03-07)
> **Note**: Runner repo auto-creation/deletion/recovery requirements are covered in `openspec/specs/runner-creation/spec.md` (which supersedes those sections). Callback flow and HMAC authentication are covered in `openspec/specs/runner-callbacks/spec.md`. This spec covers the remaining architectural concerns: dispatch flow, Inngest coordination, token management, tool execution, security, result integration, fallback, concurrency, infrastructure, non-functional requirements, and large repo handling.

## Purpose

This spec defines the behavior of the GitHub Actions runner architecture for offloading static analysis execution from the GHAGGA server to per-user public GitHub Actions runners. It covers dispatch/callback flows, security hardening, fallback behavior, and integration with the existing review pipeline.

---

# Dispatch Flow

## Requirements

### Requirement: Repository Dispatch for Static Analysis

The system MUST trigger static analysis on the runner repo via GitHub's `repository_dispatch` API.

#### Scenario: Happy path dispatch

- GIVEN a review is triggered for PR #42 on `alice/my-project`
- WHEN the Inngest review function reaches the dispatch step
- THEN the system MUST generate a unique `callbackId` (UUID v4)
- AND the system MUST generate a fresh installation token for the target repository
- AND the system MUST set the installation token as a repository secret (`GHAGGA_TOKEN`) on `alice/ghagga-runner`
- AND the system MUST verify the workflow file hash on `alice/ghagga-runner` matches the canonical template
- AND the system MUST send a `repository_dispatch` event with type `ghagga-analysis` to `alice/ghagga-runner`
- AND the dispatch payload MUST include: `callbackId`, `repoFullName`, `prNumber`, `headSha`, `baseBranch`, `toolSettings`, `callbackUrl`, `callbackSignature`
- AND the system MUST NOT include any API keys, tokens, or secrets in the dispatch payload

#### Scenario: Workflow file tampered before dispatch

- GIVEN user "alice" modified the `.github/workflows/ghagga-analysis.yml` file in the runner repo
- WHEN the system verifies the workflow file hash before dispatch
- THEN the hash MUST NOT match the canonical template hash
- AND the system MUST refuse to dispatch to the tampered workflow
- AND the system MUST re-commit the canonical workflow file to the runner repo
- AND the system MUST re-verify the hash after re-committing
- AND if the re-commit succeeds, the dispatch MUST proceed
- AND if the re-commit fails, the review MUST fall back to LLM-only mode

#### Scenario: Installation token set as repo secret

- GIVEN the system needs to dispatch analysis for `alice/my-project`
- WHEN preparing the dispatch
- THEN the system MUST generate an installation token scoped to `alice/my-project`
- AND the system MUST encrypt and set this token as the `GHAGGA_TOKEN` secret on `alice/ghagga-runner` using the GitHub Secrets API
- AND the token MUST NOT appear in the dispatch event payload
- AND the token MUST NOT appear in any log output

### Requirement: Inngest Wait-for-Event Correlation

The system MUST use Inngest's `waitForEvent` to correlate the dispatch with the callback.

#### Scenario: Normal dispatch-and-wait

- GIVEN the system has dispatched analysis with `callbackId: "abc-123"`
- WHEN the dispatch step completes
- THEN the Inngest function MUST call `waitForEvent("ghagga/runner.completed")` matching on `data.callbackId === "abc-123"`
- AND the timeout MUST be 10 minutes
- AND the function MUST pause execution (not consume compute) while waiting

#### Scenario: Callback received within timeout

- GIVEN the Inngest function is waiting for event with `callbackId: "abc-123"`
- WHEN a `ghagga/runner.completed` event is emitted with matching `callbackId`
- THEN the Inngest function MUST resume execution
- AND the event data MUST contain the `StaticAnalysisResult` JSON
- AND the function MUST pass this result to the LLM review step

#### Scenario: Timeout waiting for callback

- GIVEN the Inngest function is waiting for event with `callbackId: "abc-123"`
- WHEN 10 minutes pass without a matching event
- THEN the Inngest function MUST resume with a null/empty result
- AND the function MUST proceed to LLM review with all tools marked as `status: "skipped"` and `error: "Runner timeout (10 min)"`
- AND the final review comment MUST indicate that static analysis was skipped due to timeout

---

# Token Management

## Requirements

### Requirement: Installation Token Lifecycle

The system MUST manage installation tokens with minimal exposure window.

#### Scenario: Fresh token generated before each dispatch

- GIVEN a review is being dispatched to the runner
- WHEN the dispatch step begins
- THEN the system MUST generate a fresh installation token (not reuse one from earlier steps)
- AND the token MUST be scoped to the minimum required permissions for cloning the target repo
- AND the token MUST be set as the `GHAGGA_TOKEN` repository secret on the runner repo immediately before dispatch

#### Scenario: Token expires during runner execution

- GIVEN an installation token was set as a secret with a 1-hour lifetime
- WHEN the Actions runner starts executing after a 30-minute queue delay
- THEN the token MAY have expired
- AND the runner workflow MUST handle clone failures gracefully
- AND the runner MUST POST a callback with all tools having `status: "error"` and `error: "Clone failed (token may have expired)"`
- AND the server MUST handle this as a partial failure and proceed to LLM-only review

### Requirement: Repository Secret Management

The system MUST use GitHub's Repository Secrets API to pass tokens to the runner.

#### Scenario: Secret set before dispatch

- GIVEN the system needs to pass a token to the runner for cloning `alice/my-project`
- WHEN the secret is set
- THEN the system MUST use the `PUT /repos/{owner}/ghagga-runner/actions/secrets/GHAGGA_TOKEN` API
- AND the secret value MUST be encrypted using the runner repo's public key (libsodium sealed box)
- AND the secret MUST be immediately available to the dispatched workflow run

#### Scenario: Concurrent reviews share the same secret name

- GIVEN two reviews are dispatched simultaneously for different repos under user "alice"
- WHEN both dispatches set the `GHAGGA_TOKEN` secret
- THEN the second dispatch MUST overwrite the first secret
- AND this is acceptable because each workflow run captures the secret value at start time
- AND both runners MUST be able to clone their respective target repos

---

# Tool Execution in Runner

> **Updated**: Merged from `runner-tool-resolution` change (2026-03-08). Extended from 3 hardcoded tools to 15 dynamic tools with resolve step, per-tool caching, and conditional execution.

## Requirements

### Requirement: Workflow Dispatch Accepts Tool Resolution Inputs

The runner workflow MUST accept `enabledTools` and `disabledTools` as optional string-type `workflow_dispatch` inputs. Each input SHALL contain a JSON-encoded array of tool name strings (e.g., `'["ruff","bandit"]'`). If omitted, both MUST default to `'[]'` (empty JSON array).

#### Scenario: Server sends enabledTools and disabledTools

- GIVEN the server dispatches a workflow with `enabledTools: '["ruff","bandit"]'` and `disabledTools: '["cpd"]'`
- WHEN the runner workflow starts
- THEN `github.event.inputs.enabledTools` MUST equal `'["ruff","bandit"]'`
- AND `github.event.inputs.disabledTools` MUST equal `'["cpd"]'`

#### Scenario: Server sends empty arrays (default behavior)

- GIVEN the server dispatches without specifying enabledTools/disabledTools
- WHEN the runner workflow starts
- THEN `github.event.inputs.enabledTools` MUST equal `'[]'`
- AND `github.event.inputs.disabledTools` MUST equal `'[]'`

#### Scenario: Invalid JSON in enabledTools is treated as empty

- GIVEN the server dispatches with `enabledTools: 'not-json'`
- WHEN the resolve step parses the input
- THEN the resolve step MUST treat enabledTools as an empty array
- AND the workflow MUST NOT fail

### Requirement: Tool Resolution Step

The runner workflow MUST include a "Resolve Tools" step that determines which tools to execute. The resolution algorithm MUST mirror the logic in `packages/core/src/tools/resolve.ts`.

The resolution order MUST be:

1. Start with all always-on tools: `semgrep`, `trivy`, `cpd`, `gitleaks`, `shellcheck`, `markdownlint`, `lizard`
2. For each auto-detect tool, check if relevant files exist in `target-repo/`:
   - `ruff`: any `.py` or `.pyi` file exists
   - `bandit`: any `.py` file exists
   - `golangci-lint`: `go.mod` exists OR any `.go` file exists
   - `biome`: any `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.mjs`, `.cts`, `.cjs` file exists
   - `pmd`: any `.java` file exists
   - `psalm`: any `.php` file exists
   - `clippy`: `Cargo.toml` exists OR any `.rs` file exists
   - `hadolint`: any file matching `Dockerfile*` exists
3. Add any tools listed in `enabledTools` (force-enable override)
4. Remove any tools listed in `disabledTools` (force-disable override, takes precedence over everything)
5. If `disabledTools` is empty AND legacy boolean flags are present, apply them as fallback:
   - `enableSemgrep == 'false'` → remove `semgrep`
   - `enableTrivy == 'false'` → remove `trivy`
   - `enableCpd == 'false'` → remove `cpd`

The step MUST output the resolved tool list as a JSON array string to `$GITHUB_OUTPUT` with key `tools`.

#### Scenario: Python repository with default settings

- GIVEN a target-repo containing `.py` files and no `go.mod`
- AND `enabledTools: '[]'` and `disabledTools: '[]'`
- WHEN the resolve step runs
- THEN the output MUST include all 7 always-on tools
- AND the output MUST include `ruff` and `bandit` (auto-detected via `.py`)
- AND the output MUST NOT include `golangci-lint`, `biome`, `pmd`, `psalm`, `clippy`, or `hadolint`

#### Scenario: Force-enable a tool that would not auto-detect

- GIVEN a target-repo containing only `.ts` files
- AND `enabledTools: '["ruff"]'`
- WHEN the resolve step runs
- THEN the output MUST include `ruff` (force-enabled despite no `.py` files)
- AND the output MUST include `biome` (auto-detected via `.ts`)

#### Scenario: Force-disable an always-on tool

- GIVEN `disabledTools: '["semgrep","gitleaks"]'`
- WHEN the resolve step runs
- THEN the output MUST NOT include `semgrep` or `gitleaks`
- AND the output MUST include the remaining 5 always-on tools

#### Scenario: disabledTools takes precedence over enabledTools

- GIVEN `enabledTools: '["ruff"]'` and `disabledTools: '["ruff"]'`
- WHEN the resolve step runs
- THEN the output MUST NOT include `ruff` (disabled takes precedence)

#### Scenario: Legacy boolean fallback when disabledTools is empty

- GIVEN `disabledTools: '[]'` and `enableSemgrep: 'false'`
- WHEN the resolve step runs
- THEN the output MUST NOT include `semgrep`

#### Scenario: Legacy booleans ignored when disabledTools is non-empty

- GIVEN `disabledTools: '["cpd"]'` and `enableSemgrep: 'false'`
- WHEN the resolve step runs
- THEN the output MUST NOT include `cpd` (from disabledTools)
- AND the output MUST include `semgrep` (legacy boolean ignored because disabledTools is non-empty)

#### Scenario: Clone failure skips resolution

- GIVEN the clone step failed (`steps.clone.outcome == 'failure'`)
- WHEN the resolve step evaluates its `if` condition
- THEN the resolve step MUST be skipped
- AND no tools MUST be installed or run

### Requirement: Conditional Tool Install/Run/Parse Steps

Each of the 15 tools MUST have three conditional steps: install, run, and parse. Each step MUST be gated on:
1. The tool being present in the resolved tools list: `contains(steps.resolve.outputs.tools, '"toolname"')`
2. The clone having succeeded: `steps.clone.outcome == 'success'`

Each install and run step MUST use `continue-on-error: true` so that a failure in one tool does not block subsequent tools.

#### Scenario: Tool is resolved and succeeds

- GIVEN `ruff` is in the resolved tools list
- WHEN the ruff-install, ruff-run, and ruff-parse steps execute
- THEN `/tmp/ruff-result.json` MUST contain `{"status":"success","findings":[...],"executionTimeMs":N}`

#### Scenario: Tool is not resolved

- GIVEN `ruff` is NOT in the resolved tools list
- WHEN the workflow evaluates the ruff-install step's `if` condition
- THEN the ruff-install, ruff-run, and ruff-parse steps MUST all be skipped

#### Scenario: Tool install fails

- GIVEN `gitleaks` is in the resolved tools list
- AND the gitleaks binary download fails (network error)
- WHEN the gitleaks-install step fails
- THEN the step MUST NOT fail the job (continue-on-error)
- AND the gitleaks-run step SHOULD detect the missing binary and produce an error result
- AND subsequent tool steps MUST still execute

#### Scenario: Tool run crashes

- GIVEN `bandit` is installed and running
- AND bandit crashes with a non-zero exit code and no JSON output
- WHEN the bandit-parse step runs
- THEN `/tmp/bandit-result.json` MUST contain `{"status":"error","findings":[],"error":"bandit: execution failed","executionTimeMs":N}`

### Requirement: Static Analysis Tool Execution

The runner workflow MUST execute all resolved tools (up to 15) according to the tool resolution output. Tools run sequentially in a single workflow file using `if:` conditions.

#### Scenario: All resolved tools enabled and succeed

- GIVEN 10 tools were resolved (7 always-on + ruff, bandit, biome)
- WHEN the runner workflow executes
- THEN the workflow MUST run all 10 tools in sequence
- AND each tool MUST produce structured JSON findings to `/tmp/{tool}-result.json`
- AND all tool output (stdout/stderr) MUST be redirected to files or `/dev/null`, NEVER printed to workflow logs
- AND the combined results MUST be POSTed to the callback URL

#### Scenario: Individual tool disabled via disabledTools

- GIVEN `disabledTools: '["trivy"]'`
- WHEN the runner workflow executes
- THEN the workflow MUST skip Trivy install/run/parse steps
- AND the callback `staticAnalysis.trivy` MUST have `status: "skipped"`, empty `findings`, and `executionTimeMs: 0`

#### Scenario: Tool crashes during execution

- GIVEN Semgrep crashes with exit code 1 during execution
- WHEN the runner workflow handles the error
- THEN the workflow MUST catch the error (continue-on-error)
- AND the workflow MUST set `staticAnalysis.semgrep` to `status: "error"` with a generic error message
- AND the error message MUST NOT contain source code, file paths, or any content from the target repo
- AND the workflow MUST continue executing the remaining tools
- AND the callback MUST still be sent with partial results

### Requirement: Per-Tool Caching

Each tool that benefits from caching MUST have a cache step gated on the tool being resolved. Cache keys MUST include the tool version and runner OS.

The following tools MUST have dedicated cache steps:
- `semgrep`: pip cache (`~/.cache/pip`), key `semgrep-{version}-{os}`
- `trivy`: DB cache (`~/.cache/trivy`), key with dependency file hash
- `cpd`/`pmd`: shared PMD binary (`/opt/pmd`), key `pmd-{version}-{os}`
- `gitleaks`: binary (`/usr/local/bin/gitleaks`), key `gitleaks-{version}-{os}`
- `golangci-lint`: binary, key `golangci-lint-{version}-{os}`
- `lizard`: pip cache, key `lizard-{version}-{os}`
- `ruff`: pip cache, key `ruff-{version}-{os}`
- `bandit`: pip cache, key `bandit-{version}-{os}`
- `biome`: binary, key `biome-{version}-{os}`
- `hadolint`: binary, key `hadolint-{version}-{os}`

Tools that MAY skip dedicated caching (minimal install overhead):
- `shellcheck` (pre-installed on ubuntu-latest)
- `markdownlint` (npm global, fast install)
- `psalm` (PHAR download, small)
- `clippy` (uses project's Rust toolchain)

#### Scenario: Cache hit skips installation

- GIVEN the `semgrep` cache key matches a previous run
- WHEN the semgrep-install step runs
- THEN it MUST detect the existing binary and skip re-downloading
- AND installation time MUST be under 10 seconds

#### Scenario: Cache miss triggers fresh install

- GIVEN no cache entry exists for `gitleaks-8.21.2`
- WHEN the gitleaks-install step runs
- THEN it MUST download the binary from GitHub Releases
- AND save it to the cache path for future runs

### Requirement: Security — Silent Tool Execution

All 15 tools MUST follow the same security contract:

1. All tool stdout and stderr MUST be redirected to files (e.g., `/tmp/{tool}-raw.json`), NEVER printed to workflow logs
2. All `echo` or `jq` processing MUST redirect stderr to `/dev/null`
3. Tool error messages in result JSON MUST be generic (e.g., `"{tool}: execution failed"`), MUST NOT contain file paths or code content from the target repository

#### Scenario: Tool output not visible in logs

- GIVEN a tool runs on a private repository
- WHEN the workflow logs are inspected (before deletion)
- THEN the logs MUST NOT contain any file paths, code snippets, or finding messages from the target repository
- AND the logs MUST only show step names, timing, and generic status messages

#### Scenario: Parse failure produces safe error

- GIVEN semgrep produces malformed JSON output
- WHEN the parse step attempts to process it
- THEN the result file MUST contain `"error":"semgrep: parse failed"`
- AND the error MUST NOT include any content from the malformed output

### Requirement: Callback Payload Schema

The callback payload MUST include results for ALL resolved tools, not just `semgrep`/`trivy`/`cpd`.

The `staticAnalysis` object MUST:
1. ALWAYS include `semgrep`, `trivy`, and `cpd` keys (backward compatibility)
2. Include a key for each additional tool that was resolved, regardless of whether it succeeded or failed
3. Tools that were not resolved MUST NOT appear in the payload (they are simply absent)
4. Non-resolved legacy tools (semgrep/trivy/cpd) MUST have `status: "skipped"` with empty findings

#### Scenario: Full payload with 10 tools resolved

- GIVEN 10 tools were resolved (7 always-on + ruff, bandit, biome)
- WHEN the assemble step builds the payload
- THEN the `staticAnalysis` object MUST have exactly 10 keys
- AND each key MUST map to a valid `ToolResult` with `status`, `findings`, and `executionTimeMs`

#### Scenario: Backward compatible payload with only 3 tools

- GIVEN only semgrep, trivy, and cpd were resolved (all auto-detect tools disabled)
- WHEN the assemble step builds the payload
- THEN the `staticAnalysis` object MUST have exactly 3 keys: `semgrep`, `trivy`, `cpd`
- AND the payload MUST be structurally identical to the previous format

#### Scenario: Legacy tool disabled but key still present

- GIVEN `disabledTools: '["semgrep"]'`
- WHEN the assemble step builds the payload
- THEN `staticAnalysis.semgrep` MUST be `{"status":"skipped","findings":[],"executionTimeMs":0}`
- AND `staticAnalysis.trivy` and `staticAnalysis.cpd` MUST have their actual results

#### Scenario: Clone failure callback includes all legacy keys

- GIVEN the clone step failed
- WHEN the clone failure handler sends the callback
- THEN the payload MUST include `semgrep`, `trivy`, and `cpd` keys all with `status: "error"`
- AND the payload SHOULD also include error results for any other tools that would have been resolved

### Requirement: Tool Result Format

The runner MUST produce results in the `StaticAnalysisResult` format defined in `packages/core/src/types.ts`. The `staticAnalysis` object uses `Record<string, ToolResult>` to support dynamic tool keys.

#### Scenario: Results match the StaticAnalysisResult interface

- GIVEN the runner completes all tool executions
- WHEN the results are assembled
- THEN the JSON MUST conform to the `StaticAnalysisResult` type with dynamic tool keys
- AND each `ToolResult` MUST include `status`, `findings`, `executionTimeMs`, and optionally `error`
- AND each finding MUST include `severity`, `category`, `file`, `message`, and `source`

### Requirement: Tool Execution Timing

Each tool's execution time MUST be measured independently and reported in `executionTimeMs`.

#### Scenario: All tools report execution time

- GIVEN 10 tools are resolved and run
- WHEN the callback payload is assembled
- THEN each of the 10 tool results MUST have an `executionTimeMs` value > 0

#### Scenario: Skipped tools report zero time

- GIVEN a tool was not resolved (skipped)
- WHEN its result is included in the payload
- THEN `executionTimeMs` MUST be 0

---

# Security

## Requirements

### Requirement: Silent Execution (Log Suppression)

The runner workflow MUST suppress all tool output to prevent private code from appearing in public workflow logs.

#### Scenario: Tool stdout/stderr redirected to /dev/null

- GIVEN the runner workflow executes Semgrep on a private repository's code
- WHEN Semgrep produces stdout output containing file paths and code snippets
- THEN all stdout and stderr MUST be redirected to `/dev/null`
- AND only the structured JSON result (extracted via a separate mechanism) MUST be captured
- AND the public workflow log MUST NOT contain any file paths, code snippets, or findings text from the target repo

#### Scenario: Error wrapper prevents leak on crash

- GIVEN Semgrep crashes with a stack trace that includes file paths from the target repo
- WHEN the error wrapper catches the crash
- THEN only a generic message (e.g., "semgrep: execution failed") MUST be logged
- AND the stack trace MUST NOT appear in the workflow log

### Requirement: Log Deletion After Run

The system MUST delete workflow run logs after the callback is sent.

#### Scenario: Logs deleted after successful callback

- GIVEN the runner workflow has completed and POSTed results to the callback URL
- WHEN the log deletion step executes
- THEN the workflow MUST call the GitHub API to delete its own workflow run logs
- AND if the deletion API call fails, the workflow MUST log a warning but NOT fail the overall run

#### Scenario: Log retention as safety net

- GIVEN the runner repo was created with log retention set to 1 day
- WHEN log deletion fails
- THEN GitHub MUST automatically purge the logs within 24 hours
- AND this provides a safety net for any logs that were not explicitly deleted

### Requirement: Repository Name Masking

The runner workflow MUST mask sensitive values using GitHub's `::add-mask::` command.

#### Scenario: Repo names and paths masked

- GIVEN the runner workflow clones `alice/my-private-project`
- WHEN the workflow starts
- THEN the workflow MUST emit `::add-mask::alice/my-private-project`
- AND the workflow MUST emit `::add-mask::` for the clone directory path
- AND any subsequent log output containing these strings MUST be replaced with `***` by GitHub Actions

### Requirement: Workflow Integrity Verification

The system MUST verify the runner workflow file has not been tampered with before each dispatch.

#### Scenario: Workflow hash matches canonical template

- GIVEN the workflow file on `alice/ghagga-runner` matches the canonical template exactly
- WHEN the system verifies the hash before dispatch
- THEN the verification MUST pass
- AND the dispatch MUST proceed normally

#### Scenario: Workflow hash does not match (tampered)

- GIVEN user "alice" edited the workflow file to add `echo $GHAGGA_TOKEN` (attempting to leak the secret)
- WHEN the system verifies the hash before dispatch
- THEN the verification MUST fail
- AND the system MUST refuse the dispatch
- AND the system MUST re-commit the canonical workflow file
- AND the system MUST log a security warning: "Workflow tampered on {owner}/ghagga-runner, re-committing canonical version"

---

# Result Integration

## Requirements

### Requirement: Pre-computed Static Analysis in Pipeline

The core review pipeline MUST accept pre-computed `StaticAnalysisResult` and skip local tool execution when provided.

#### Scenario: Pipeline receives pre-computed results from runner

- GIVEN the Inngest function received a `StaticAnalysisResult` from the runner callback
- WHEN the LLM review step executes
- THEN the pipeline MUST use the pre-computed results directly
- AND the pipeline MUST NOT attempt to run Semgrep, Trivy, or CPD locally
- AND the findings from static analysis MUST be injected into the LLM agent prompts as usual

#### Scenario: Pipeline receives empty results (runner timeout)

- GIVEN the runner timed out and the Inngest function resumed with no results
- WHEN the LLM review step executes
- THEN the pipeline MUST construct a `StaticAnalysisResult` with all tools having `status: "skipped"` and `error: "Runner timeout (10 min)"`
- AND the pipeline MUST proceed with LLM-only review
- AND `metadata.toolsSkipped` MUST include all three tools
- AND `metadata.toolsRun` MUST be empty

#### Scenario: CLI and Action modes unaffected

- GIVEN a review is triggered via CLI or the self-hosted Action
- WHEN the pipeline executes
- THEN the pipeline MUST run static analysis tools locally as before
- AND the `precomputedStaticAnalysis` field MUST be undefined
- AND there MUST be no behavioral change for these distribution modes

### Requirement: ReviewInput Type Extension

The `ReviewInput` type MUST be extended with an optional `precomputedStaticAnalysis` field.

#### Scenario: Server passes pre-computed results

- GIVEN the server received static analysis results from the runner callback
- WHEN constructing the `ReviewInput` for the pipeline
- THEN the server MUST set `precomputedStaticAnalysis` to the `StaticAnalysisResult` received from the runner
- AND the pipeline MUST detect this field and skip local tool execution

#### Scenario: CLI does not set pre-computed results

- GIVEN a CLI invocation
- WHEN constructing the `ReviewInput`
- THEN `precomputedStaticAnalysis` MUST be `undefined`
- AND the pipeline MUST run tools locally

---

# Fallback Behavior

## Requirements

### Requirement: Graceful Degradation to LLM-Only Review

The system MUST deliver an LLM-only review when the runner fails, times out, or is unavailable.

#### Scenario: Runner times out after 10 minutes

- GIVEN the Inngest `waitForEvent` timeout is 10 minutes
- WHEN no callback is received within 10 minutes
- THEN the review MUST proceed with LLM-only analysis
- AND the review comment MUST include a note: "Static analysis was skipped (runner timeout)"
- AND the review MUST still contain AI findings
- AND `metadata.toolsSkipped` MUST list all three tools

#### Scenario: Runner repo does not exist and cannot be created

- GIVEN the runner repo `alice/ghagga-runner` does not exist
- AND the system's attempt to re-create it fails (API error)
- WHEN a review is triggered
- THEN the system MUST skip the dispatch step entirely
- AND the review MUST proceed with LLM-only analysis
- AND the system MUST log the failure for debugging

#### Scenario: Callback reports all tools failed

- GIVEN the runner sends a callback where all three tools have `status: "error"`
- WHEN the Inngest function receives the results
- THEN the system MUST still proceed with LLM review
- AND the review comment MUST indicate "Static analysis tools failed in runner"
- AND `metadata.toolsSkipped` MUST list all three tools
- AND `metadata.toolsRun` MUST be empty

#### Scenario: Callback reports partial tool failure

- GIVEN the runner sends a callback where Semgrep succeeded but Trivy and CPD failed
- WHEN the Inngest function receives the results
- THEN the system MUST use Semgrep findings in the LLM review
- AND the review MUST proceed with partial static analysis data
- AND `metadata.toolsRun` MUST include "semgrep"
- AND `metadata.toolsSkipped` MUST include "trivy" and "cpd"

#### Scenario: Dispatch fails (GitHub API error)

- GIVEN the `repository_dispatch` API call returns a 5xx error
- WHEN the dispatch step fails
- THEN the Inngest function MUST catch the error
- AND the function MUST skip the `waitForEvent` step
- AND the review MUST proceed with LLM-only analysis

---

# Inngest Function Refactoring

## Requirements

### Requirement: Review Function Split into Dispatch-Wait-Resume

The Inngest `ghagga-review` function MUST be refactored from a single `run-review` step into a multi-step flow that supports the dispatch-wait-resume pattern.

#### Scenario: Full flow with runner (happy path)

- GIVEN a review is triggered for `alice/my-project#42`
- WHEN the Inngest function executes
- THEN the steps MUST be:
  1. `fetch-context`: Fetch PR diff, commit messages, file list
  2. `dispatch-runner`: Verify runner repo, set token secret, verify workflow, send `repository_dispatch`
  3. `wait-for-runner`: `waitForEvent("ghagga/runner.completed", { timeout: "10m", match: "data.callbackId" })`
  4. `run-review`: Execute LLM pipeline with pre-computed `StaticAnalysisResult` (or empty if timeout)
  5. `save-review`: Persist to database
  6. `post-comment`: Post review comment to GitHub PR
  7. `react-to-trigger`: (conditional) Add reaction to trigger comment

#### Scenario: Runner not available, skip dispatch

- GIVEN the runner repo does not exist and cannot be created
- WHEN the Inngest function reaches the `dispatch-runner` step
- THEN the step MUST return a sentinel value (e.g., `{ dispatched: false }`)
- AND the `wait-for-runner` step MUST be skipped
- AND the `run-review` step MUST proceed with empty static analysis results

### Requirement: Inngest Event Schema for Runner Callback

The Inngest client MUST define the `ghagga/runner.completed` event schema.

#### Scenario: Event emitted from callback endpoint

- GIVEN the callback endpoint receives valid results for `callbackId: "abc-123"`
- WHEN the Inngest event is emitted
- THEN the event MUST have name `ghagga/runner.completed`
- AND `data.callbackId` MUST match the dispatch's `callbackId`
- AND `data.staticAnalysis` MUST contain the `StaticAnalysisResult` JSON
- AND the Inngest function waiting on this event MUST resume

---

# Concurrent Reviews

## Requirements

### Requirement: Independent Review Processing

The system MUST handle multiple concurrent reviews independently.

#### Scenario: Multiple PRs dispatched simultaneously

- GIVEN PRs are opened on `alice/repo-a#1` and `alice/repo-b#2` within seconds of each other
- WHEN both trigger review dispatches
- THEN each dispatch MUST generate a unique `callbackId`
- AND each dispatch MUST set the `GHAGGA_TOKEN` secret (second overwrites first, but each run captures at start)
- AND each `waitForEvent` MUST match only its own `callbackId`
- AND both reviews MUST complete independently
- AND there MUST be no cross-contamination of results

#### Scenario: Callbacks arrive out of order

- GIVEN dispatch A was sent before dispatch B
- WHEN callback B arrives before callback A
- THEN the Inngest function for review B MUST resume with B's results
- AND the Inngest function for review A MUST continue waiting for A's callback
- AND both reviews MUST produce correct results

---

# Dockerfile and Infrastructure Cleanup

## Requirements

### Requirement: Server Dockerfile Slimming

The server Dockerfile MUST be modified to remove all static analysis tool installations.

#### Scenario: Dockerfile no longer installs tools

- GIVEN the current `apps/server/Dockerfile` installs Python, JVM, Semgrep (~400MB), Trivy (~100MB), and PMD/CPD (~300MB)
- WHEN the Dockerfile is updated
- THEN Python, JVM, Semgrep, Trivy, and PMD installations MUST be removed
- AND the resulting Docker image MUST be less than 300MB
- AND the server MUST run comfortably within Render's 512MB free tier

### Requirement: Cloud Run Infrastructure Removal

The system MUST remove all Google Cloud Run infrastructure files.

#### Scenario: Cloud Run files deleted

- GIVEN the repository contains `cloudbuild.yaml`, `scripts/deploy-cloudrun.sh`, `CLOUD-RUN-MIGRATION.md`, and a root `Dockerfile` for Cloud Run
- WHEN the cleanup is applied
- THEN all four files MUST be removed from the repository
- AND no references to Cloud Run MUST remain in the codebase

---

# Non-Functional Requirements

## Requirements

### Requirement: End-to-End Latency

The total review time including Actions overhead SHOULD remain acceptable for async code review.

#### Scenario: Warm cache review time

- GIVEN the runner has tool caches available from a previous run
- WHEN a review is triggered
- THEN the total time from PR webhook to comment posted SHOULD be under 5 minutes
- AND the Actions overhead (queue + startup + tool execution) SHOULD be under 3 minutes

#### Scenario: Cold cache review time

- GIVEN the runner has no cached tools
- WHEN a review is triggered for the first time
- THEN the total time SHOULD be under 8 minutes
- AND this is acceptable because subsequent runs SHOULD use cached tools

### Requirement: Zero Cost for Public Runners

The runner architecture MUST NOT incur GitHub Actions costs.

#### Scenario: Public runner repo uses free minutes

- GIVEN the runner repo `{owner}/ghagga-runner` is public
- WHEN Actions workflows execute
- THEN GitHub MUST NOT charge for Actions minutes (unlimited free minutes for public repos)
- AND this MUST hold for both user accounts and organization accounts

### Requirement: Retry Strategy

The system MUST have a clear retry strategy for transient failures.

#### Scenario: Inngest retries on transient error

- GIVEN the `dispatch-runner` step fails with a network error
- WHEN Inngest retries the step
- THEN the retry MUST generate a fresh installation token
- AND the retry MUST re-verify the workflow hash
- AND the maximum retry count MUST be 3 (matching existing Inngest config)

#### Scenario: GitHub API rate limiting

- GIVEN the installation token has a 5000 requests/hour rate limit
- WHEN the system makes API calls for dispatch (create secret, verify workflow, dispatch event)
- THEN the total API calls per dispatch MUST be fewer than 10
- AND typical usage MUST remain well under the rate limit

### Requirement: Compatibility with User and Organization Accounts

The runner architecture MUST work with both individual GitHub user accounts and GitHub organization accounts.

#### Scenario: User account runner repo

- GIVEN a GitHub user "alice" has installed the GHAGGA App
- WHEN the runner repo is created
- THEN it MUST be created as `alice/ghagga-runner`
- AND `alice` MUST be the owner of the repository

#### Scenario: Organization account runner repo

- GIVEN a GitHub organization "acme-corp" has installed the GHAGGA App
- WHEN the runner repo is created
- THEN it MUST be created as `acme-corp/ghagga-runner`
- AND the organization MUST be the owner of the repository
- AND the GHAGGA App's installation token MUST have sufficient permissions to create repos in the organization

---

# Large Repository Handling

## Requirements

### Requirement: Graceful Handling of Large Repositories

The runner MUST handle large repositories without hanging or crashing.

#### Scenario: Repository with 1000+ files in diff

- GIVEN a PR touches 1000+ files
- WHEN the runner executes static analysis
- THEN each tool MUST have an individual execution timeout (e.g., 5 minutes per tool)
- AND if a tool times out, it MUST be marked as `status: "error"` with `error: "Tool timeout"`
- AND the remaining tools MUST still execute

#### Scenario: Repository clone is very large

- GIVEN the target repository is several GB in size
- WHEN the runner clones the repository
- THEN the workflow SHOULD use shallow clone (`--depth 1`) to minimize transfer
- AND if the clone exceeds 5 minutes, the workflow MUST abort the clone
- AND the callback MUST report all tools as `status: "error"` with `error: "Clone timeout"`
