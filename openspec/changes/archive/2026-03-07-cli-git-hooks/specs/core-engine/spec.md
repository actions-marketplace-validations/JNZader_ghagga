# Delta for Core Engine

> **Domain**: core-engine
> **Change**: cli-git-hooks
> **Status**: draft

## ADDED Requirements

---

### Requirement: Staged Diff Mode

The review pipeline MUST support receiving a diff scoped to staged files only, instead of the full working tree diff. The staged diff MUST be obtained via `git diff --cached` and passed through the same pipeline as a regular diff.

#### Scenario: Staged diff with changes

- GIVEN a repository with staged changes (files added to the git index)
- WHEN the review pipeline receives a staged diff
- THEN the pipeline MUST process the diff through all enabled layers (static analysis, memory, AI agents, memory persistence)
- AND the findings MUST reference only files present in the staged diff

#### Scenario: No staged changes

- GIVEN a repository with no staged changes (`git diff --cached` produces empty output)
- WHEN the review pipeline is invoked with staged mode
- THEN the pipeline MUST return a ReviewResult with status `SKIPPED`
- AND no static analysis tools MUST be invoked
- AND no AI tokens MUST be consumed

#### Scenario: Partially staged file

- GIVEN a file has some hunks staged and others unstaged
- WHEN the review pipeline receives the staged diff
- THEN the diff MUST contain only the staged hunks
- AND the review MUST evaluate only the staged content, not the unstaged portions

---

### Requirement: Quick Mode (Static Analysis Only)

The review pipeline MUST support a `quick` mode that runs only static analysis tools (Semgrep, Trivy, CPD) and skips the AI/LLM review step entirely. This mode is designed for speed-sensitive contexts like pre-commit hooks.

#### Scenario: Quick mode skips AI review

- GIVEN a valid diff and configuration with `quick` mode enabled
- WHEN the review pipeline is executed
- THEN Layer 0 (static analysis) MUST run normally
- AND Layer 2 (AI agents) MUST be skipped entirely
- AND no LLM API calls MUST be made
- AND no AI tokens MUST be consumed

#### Scenario: Quick mode preserves static analysis findings

- GIVEN a diff containing code with known Semgrep rule violations
- AND `quick` mode is enabled
- WHEN the review pipeline completes
- THEN the ReviewResult MUST contain the Semgrep findings
- AND the metadata MUST indicate the provider as `none` and model as `static-only`

#### Scenario: Quick mode with memory

- GIVEN `quick` mode is enabled
- AND memory is enabled
- WHEN the review pipeline is executed
- THEN Layer 1 (memory retrieval) MAY be skipped (no AI agents to inject context into)
- AND Layer 3 (memory persistence) MUST still save static analysis observations

#### Scenario: Quick mode execution time

- GIVEN a typical diff (< 500 lines)
- AND `quick` mode is enabled
- WHEN the review pipeline is executed
- THEN the total execution time SHOULD be under 10 seconds

---

### Requirement: Commit Message Validation Mode

The review pipeline MUST support a commit message validation mode that reads a commit message from a file path and evaluates its quality using a lightweight LLM prompt. This mode does NOT analyze code diffs.

#### Scenario: Valid commit message

- GIVEN a commit message file containing `feat(auth): add OAuth2 device flow for GitHub login`
- WHEN the commit message validation is executed
- THEN the result MUST have status `PASSED`
- AND the summary MUST indicate the commit message is acceptable

#### Scenario: Low-quality commit message

- GIVEN a commit message file containing `fix`
- WHEN the commit message validation is executed
- THEN the result MUST have status `FAILED`
- AND at least one finding with severity `high` or `critical` MUST be present
- AND the finding MUST explain why the message is inadequate

#### Scenario: Empty commit message file

- GIVEN a commit message file that is empty or contains only whitespace
- WHEN the commit message validation is executed
- THEN the result MUST have status `FAILED`
- AND a finding MUST indicate the commit message is empty

#### Scenario: Commit message file not found

- GIVEN a commit message file path that does not exist
- WHEN the commit message validation is attempted
- THEN the system MUST return an error indicating the file was not found
- AND the exit code MUST be non-zero

#### Scenario: Commit message validation does not run static analysis

- GIVEN commit message validation mode is active
- WHEN the pipeline is executed
- THEN static analysis tools (Semgrep, Trivy, CPD) MUST NOT be invoked
- AND only the commit message LLM prompt MUST be sent

#### Scenario: Commit message validation with quick mode

- GIVEN `--commit-msg` and `--quick` are both specified
- WHEN the pipeline is executed
- THEN the commit message MUST be validated using basic heuristics (length, non-empty)
- AND no LLM call MUST be made
- AND egregiously short or empty messages MUST be flagged

---

### Requirement: Exit on Issues Mode

The review pipeline MUST support an `exit-on-issues` mode where the process exits with code 1 when any finding has severity `critical` or `high`. This enables hooks to block commits on serious issues.

#### Scenario: Critical issue found with exit-on-issues

- GIVEN a review result containing at least one finding with severity `critical`
- AND `exit-on-issues` mode is active
- WHEN the exit code is determined
- THEN the exit code MUST be 1

#### Scenario: High issue found with exit-on-issues

- GIVEN a review result containing findings with severity `high` but none with `critical`
- AND `exit-on-issues` mode is active
- WHEN the exit code is determined
- THEN the exit code MUST be 1

#### Scenario: Only medium/low/info issues with exit-on-issues

- GIVEN a review result containing findings with severity `medium`, `low`, and `info` only
- AND `exit-on-issues` mode is active
- WHEN the exit code is determined
- THEN the exit code MUST be 0

#### Scenario: No findings with exit-on-issues

- GIVEN a review result with zero findings
- AND `exit-on-issues` mode is active
- WHEN the exit code is determined
- THEN the exit code MUST be 0

#### Scenario: Exit-on-issues not active (default behavior)

- GIVEN a review result containing findings with severity `critical`
- AND `exit-on-issues` mode is NOT active
- WHEN the exit code is determined
- THEN the exit code MUST follow the existing behavior (based on ReviewStatus, not finding severity)

---

### Requirement: Mutually Exclusive Flags

The flags `--staged` and `--commit-msg` MUST be treated as mutually exclusive. They represent different review modes and MUST NOT be combined.

#### Scenario: --staged and --commit-msg together

- GIVEN the user runs `ghagga review --staged --commit-msg .git/COMMIT_EDITMSG`
- WHEN the command parses the options
- THEN the system MUST display an error message indicating `--staged` and `--commit-msg` are mutually exclusive
- AND the exit code MUST be non-zero
- AND no review MUST be executed

#### Scenario: --staged alone is valid

- GIVEN the user runs `ghagga review --staged`
- WHEN the command parses the options
- THEN no validation error MUST occur
- AND the staged diff review MUST proceed

#### Scenario: --commit-msg alone is valid

- GIVEN the user runs `ghagga review --commit-msg .git/COMMIT_EDITMSG`
- WHEN the command parses the options
- THEN no validation error MUST occur
- AND the commit message validation MUST proceed

#### Scenario: --quick with --commit-msg is valid

- GIVEN the user runs `ghagga review --commit-msg .git/COMMIT_EDITMSG --quick`
- WHEN the command parses the options
- THEN no validation error MUST occur
- AND the commit message MUST be validated using heuristics only (no LLM)

## MODIFIED Requirements

---

### Requirement: ReviewInput Type Extension (modifies Review Pipeline Execution)

The `ReviewInput` type MUST be extended with new optional fields to support the staged, quick, commit-msg, and exit-on-issues modes.

(Previously: `ReviewInput` contained `diff`, `mode`, `provider`, `model`, `apiKey`, `providerChain`, `aiReviewEnabled`, `settings`, `context`, `memoryStorage`, `onProgress`, `precomputedStaticAnalysis`.)

#### Scenario: ReviewInput with staged mode fields

- GIVEN a CLI invocation with `--staged`
- WHEN the ReviewInput is constructed
- THEN the `diff` field MUST contain the output of `git diff --cached`
- AND existing pipeline behavior MUST apply to this diff identically

#### Scenario: ReviewInput with quick mode

- GIVEN a CLI invocation with `--quick`
- WHEN the ReviewInput is constructed
- THEN `aiReviewEnabled` MUST be set to `false`
- AND the pipeline MUST skip AI agents per existing behavior for `aiReviewEnabled: false`

#### Scenario: Default behavior unchanged

- GIVEN a CLI invocation without any of the new flags
- WHEN the ReviewInput is constructed
- THEN none of the new fields MUST affect the pipeline
- AND existing behavior MUST be preserved exactly
