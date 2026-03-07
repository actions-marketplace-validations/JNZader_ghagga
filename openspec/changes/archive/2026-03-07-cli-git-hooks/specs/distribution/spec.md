# Delta for Distribution

> **Domain**: distribution
> **Change**: cli-git-hooks
> **Status**: draft

## MODIFIED Requirements

---

### Requirement: CLI Mode (modifies existing CLI Mode requirement)

The CLI distribution mode MUST support git hook integration in addition to the existing manual review workflow. The CLI MUST register a `hooks` command group alongside `review`, `login`, `logout`, `status`, and `memory`.

(Previously: CLI mode supported `review [path]` with provider/model/format options, `login`, `logout`, `status`, and `memory` commands.)

#### Scenario: CLI registers hooks command group

- GIVEN the GHAGGA CLI binary is executed
- WHEN the user runs `ghagga --help`
- THEN the help output MUST list `hooks` as an available command alongside `review`, `login`, `logout`, `status`, and `memory`

#### Scenario: CLI review with --staged flag

- GIVEN a user in a git repository with staged changes
- WHEN the user runs `ghagga review --staged`
- THEN the CLI MUST compute the diff using `git diff --cached` instead of the full working tree diff
- AND the review pipeline MUST run with the staged diff
- AND the output MUST indicate the review scope was limited to staged changes

#### Scenario: CLI review with --quick flag

- GIVEN a user in a git repository with changes
- WHEN the user runs `ghagga review --quick`
- THEN the CLI MUST run only static analysis (Semgrep, Trivy, CPD)
- AND no LLM API call MUST be made
- AND the output MUST complete significantly faster than a full review

#### Scenario: CLI review with --commit-msg flag

- GIVEN a user with a commit message file at `.git/COMMIT_EDITMSG`
- WHEN the user runs `ghagga review --commit-msg .git/COMMIT_EDITMSG`
- THEN the CLI MUST read the commit message from the specified file
- AND the CLI MUST validate the commit message quality
- AND the CLI MUST NOT compute or review any code diff

#### Scenario: CLI review with --exit-on-issues flag

- GIVEN a review completes with a critical-severity finding
- WHEN the `--exit-on-issues` flag is active
- THEN the CLI process MUST exit with code 1
- AND the finding details MUST be displayed before exit

#### Scenario: CLI review without new flags retains existing behavior

- GIVEN a user runs `ghagga review .` without any of the new flags
- WHEN the review pipeline executes
- THEN the behavior MUST be identical to the pre-change CLI
- AND exit codes, output format, and pipeline execution MUST be unchanged

#### Scenario: CLI authentication not required for --quick

- GIVEN a user has NOT run `ghagga login`
- AND no API key is configured
- WHEN the user runs `ghagga review --quick`
- THEN the review MUST succeed (static analysis does not need an API key)
- AND no authentication error MUST be displayed

## ADDED Requirements

---

### Requirement: Hook-Triggered Review Scope

When the CLI is invoked from a git hook context (identifiable by the combination of `--staged --exit-on-issues --plain` or `--commit-msg <file> --exit-on-issues --plain`), the review MUST be scoped and optimized for that context.

#### Scenario: Pre-commit hook invocation

- GIVEN the CLI is invoked as `ghagga review --staged --exit-on-issues --plain`
- WHEN the review pipeline executes
- THEN the diff MUST come from `git diff --cached`
- AND the output MUST be in plain mode (no ANSI, no spinners)
- AND the exit code MUST be 1 if critical/high issues are found, 0 otherwise

#### Scenario: Commit-msg hook invocation

- GIVEN the CLI is invoked as `ghagga review --commit-msg .git/COMMIT_EDITMSG --exit-on-issues --plain`
- WHEN the pipeline executes
- THEN only the commit message validation MUST run
- AND the output MUST be in plain mode
- AND the exit code MUST be 1 if the commit message has high/critical issues, 0 otherwise

#### Scenario: Hook invocation saves to memory

- GIVEN the CLI is invoked from a hook context
- AND memory is not disabled (`--no-memory` not passed)
- WHEN the review completes
- THEN observations MUST be saved to the SQLite memory store at `~/.config/ghagga/memory.db`

#### Scenario: Hook invocation with --no-memory via GHAGGA_HOOK_ARGS

- GIVEN the CLI is invoked from a hook
- AND `GHAGGA_HOOK_ARGS="--no-memory"` is set in the environment
- WHEN the review completes
- THEN no observations MUST be saved to memory

---

### Requirement: SaaS and Action Modes Unaffected

The hook management commands and new review flags MUST NOT affect the SaaS server mode or GitHub Action mode. These are CLI-only features.

#### Scenario: SaaS server does not expose hooks commands

- GIVEN the GHAGGA server is running in SaaS mode
- WHEN a webhook is received
- THEN the server MUST NOT invoke any hooks-related logic
- AND the review pipeline MUST behave identically to pre-change behavior

#### Scenario: GitHub Action does not use new flags

- GIVEN the GHAGGA GitHub Action is triggered
- WHEN the Action runs the review pipeline
- THEN the Action MUST NOT use `--staged`, `--commit-msg`, `--exit-on-issues`, or `--quick` flags
- AND the Action MUST continue to use the full diff from the PR
