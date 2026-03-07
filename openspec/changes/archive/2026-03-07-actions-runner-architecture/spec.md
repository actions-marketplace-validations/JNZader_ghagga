# Actions Runner Architecture — Specification

## Purpose

This spec defines the behavior of the GitHub Actions runner architecture for offloading static analysis execution from the GHAGGA server to per-user public GitHub Actions runners. It covers runner repo lifecycle, dispatch/callback flows, security hardening, fallback behavior, and integration with the existing review pipeline.

---

# Runner Repo Lifecycle

## Requirements

### Requirement: Runner Repo Auto-Creation on Installation

The system MUST automatically create a public `{owner}/ghagga-runner` repository when the GHAGGA GitHub App is installed on a user account or organization.

#### Scenario: First-time user installation

- GIVEN a GitHub user "alice" installs the GHAGGA App on their account
- WHEN the `installation.created` webhook is received
- THEN the system MUST create a public repository `alice/ghagga-runner`
- AND the system MUST commit a workflow file at `.github/workflows/ghagga-analysis.yml` matching the canonical template
- AND the system MUST set the repository log retention to the minimum (1 day)
- AND the system MUST record the runner repo creation in the installation record
- AND the system MUST continue with normal installation processing (upsert installation, upsert repositories)

#### Scenario: Organization installation

- GIVEN an organization "acme-corp" installs the GHAGGA App
- WHEN the `installation.created` webhook is received
- THEN the system MUST create a public repository `acme-corp/ghagga-runner`
- AND the workflow file and retention settings MUST be configured identically to user accounts
- AND the system MUST use the organization's installation token (not a user token) for repository creation

#### Scenario: Runner repo already exists

- GIVEN user "alice" already has a repository `alice/ghagga-runner`
- WHEN the GHAGGA App is installed (or reinstalled)
- THEN the system MUST NOT attempt to create a duplicate repository
- AND the system MUST verify the workflow file exists and matches the canonical hash
- AND if the workflow file is missing or tampered, the system MUST re-commit the canonical version

#### Scenario: Runner repo creation fails

- GIVEN the GitHub API returns a 403 (insufficient permissions) when creating the runner repo
- WHEN the `installation.created` webhook is processed
- THEN the system MUST log the failure with the GitHub error response
- AND the system MUST NOT fail the entire installation process
- AND reviews MUST fall back to LLM-only mode until the runner repo is available
- AND the system SHOULD retry runner repo creation on the next review dispatch

### Requirement: Runner Repo Deletion on Uninstall

The system SHOULD delete the `{owner}/ghagga-runner` repository when the GHAGGA App is uninstalled.

#### Scenario: App uninstalled, runner repo cleaned up

- GIVEN user "alice" uninstalls the GHAGGA App
- WHEN the `installation.deleted` webhook is received
- THEN the system SHOULD attempt to delete the `alice/ghagga-runner` repository
- AND if deletion fails (e.g., permissions revoked), the system MUST log a warning but NOT fail
- AND the installation MUST still be deactivated in the database

#### Scenario: App uninstalled from organization

- GIVEN organization "acme-corp" uninstalls the GHAGGA App
- WHEN the `installation.deleted` webhook is received
- THEN the system SHOULD attempt to delete the `acme-corp/ghagga-runner` repository
- AND the same graceful failure rules apply as for user accounts

### Requirement: Runner Repo Recovery

The system MUST automatically recover when the runner repo is missing at dispatch time.

#### Scenario: Runner repo deleted by user

- GIVEN user "alice" manually deleted the `alice/ghagga-runner` repository
- WHEN a review is triggered for one of alice's repositories
- THEN the system MUST detect that the runner repo does not exist (404 from GitHub API)
- AND the system MUST re-create the runner repo with the canonical workflow file
- AND the system MUST proceed with the dispatch after successful re-creation
- AND the review MUST NOT fail due to the missing runner repo

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

# Callback Flow

## Requirements

### Requirement: Runner Callback Endpoint

The system MUST expose a `POST /api/runner-callback` endpoint that receives static analysis results from the Actions runner.

#### Scenario: Valid callback with HMAC signature

- GIVEN the runner workflow completes with results for `callbackId: "abc-123"`
- WHEN the runner POSTs to `/api/runner-callback` with a valid HMAC signature in the `X-Ghagga-Signature` header
- THEN the system MUST verify the HMAC-SHA256 signature using the per-dispatch signing secret
- AND the system MUST parse the request body as a `StaticAnalysisResult` JSON
- AND the system MUST emit an Inngest event `ghagga/runner.completed` with the `callbackId` and `StaticAnalysisResult`
- AND the system MUST respond with HTTP 200 `{ "status": "accepted" }`

#### Scenario: Callback forgery — invalid HMAC

- GIVEN an attacker sends a POST to `/api/runner-callback` with an incorrect or missing `X-Ghagga-Signature`
- WHEN the endpoint processes the request
- THEN the system MUST reject the request with HTTP 401
- AND the system MUST NOT emit any Inngest event
- AND the system MUST log the rejected attempt with the source IP

#### Scenario: Callback with malformed body

- GIVEN the runner POSTs to `/api/runner-callback` with a valid HMAC but the body is not valid JSON
- WHEN the endpoint processes the request
- THEN the system MUST reject the request with HTTP 400
- AND the system MUST NOT emit any Inngest event

#### Scenario: Callback replay attack

- GIVEN a valid callback was already accepted for `callbackId: "abc-123"`
- WHEN the same (or replayed) callback is received again
- THEN the system SHOULD accept the request (idempotent) but the Inngest function will have already resumed
- AND no duplicate review MUST be produced

### Requirement: Callback Authentication via HMAC

The system MUST authenticate callback requests using HMAC-SHA256 signatures.

#### Scenario: HMAC generation at dispatch time

- GIVEN the system is preparing a dispatch with `callbackId: "abc-123"`
- WHEN the signing secret is generated
- THEN the system MUST generate a cryptographically random signing secret (at least 32 bytes)
- AND the system MUST compute `HMAC-SHA256(secret, callbackId)` to produce the `callbackSignature`
- AND the signing secret MUST be stored temporarily (e.g., in the Inngest step context or a TTL cache) for verification
- AND the `callbackSignature` MUST be included in the dispatch payload for the runner to send back

#### Scenario: HMAC verification at callback time

- GIVEN the runner POSTs with header `X-Ghagga-Signature: sha256=<hex>`
- WHEN the callback endpoint receives the request
- THEN the system MUST retrieve the stored signing secret for the `callbackId`
- AND the system MUST recompute the HMAC and compare using constant-time comparison
- AND if the comparison fails, the request MUST be rejected with HTTP 401

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

## Requirements

### Requirement: Static Analysis Tool Execution

The runner workflow MUST execute Semgrep, Trivy, and PMD/CPD according to the repository's tool settings.

#### Scenario: All three tools enabled and succeed

- GIVEN the dispatch payload has `toolSettings: { enableSemgrep: true, enableTrivy: true, enableCpd: true }`
- WHEN the runner workflow executes
- THEN the workflow MUST run Semgrep, Trivy, and CPD in sequence (or parallel where safe)
- AND each tool MUST produce structured JSON findings
- AND all tool output (stdout/stderr) MUST be redirected to `/dev/null` except for the structured result extraction
- AND the combined `StaticAnalysisResult` MUST be POSTed to the callback URL

#### Scenario: Individual tool disabled in settings

- GIVEN the dispatch payload has `toolSettings: { enableSemgrep: true, enableTrivy: false, enableCpd: true }`
- WHEN the runner workflow executes
- THEN the workflow MUST skip Trivy
- AND the callback `StaticAnalysisResult.trivy` MUST have `status: "skipped"`, empty `findings`, and `executionTimeMs: 0`

#### Scenario: Tool crashes during execution

- GIVEN Semgrep crashes with exit code 1 during execution
- WHEN the runner workflow handles the error
- THEN the workflow MUST catch the error
- AND the workflow MUST set `StaticAnalysisResult.semgrep` to `status: "error"` with a generic error message
- AND the error message MUST NOT contain source code, file paths, or any content from the target repo
- AND the workflow MUST continue executing the remaining tools (Trivy, CPD)
- AND the callback MUST still be sent with partial results

#### Scenario: Tool caching for performance

- GIVEN the runner workflow has executed before on `alice/ghagga-runner`
- WHEN a new dispatch triggers tool execution
- THEN the workflow SHOULD use GitHub Actions cache for Semgrep (~400MB), Trivy DB (~100MB), and PMD (~300MB)
- AND cached tool binaries MUST reduce cold-start time from ~3 minutes to ~30 seconds
- AND cache misses MUST NOT cause the workflow to fail

### Requirement: Tool Result Format

The runner MUST produce results in the exact `StaticAnalysisResult` format defined in `packages/core/src/types.ts`.

#### Scenario: Results match the StaticAnalysisResult interface

- GIVEN the runner completes all tool executions
- WHEN the results are assembled
- THEN the JSON MUST conform to the `StaticAnalysisResult` type with `semgrep: ToolResult`, `trivy: ToolResult`, `cpd: ToolResult`
- AND each `ToolResult` MUST include `status`, `findings`, `executionTimeMs`, and optionally `error`
- AND each finding MUST include `severity`, `category`, `file`, `message`, and `source`

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
