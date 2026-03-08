# Runner/Orchestrator Specification

> **Origin**: Created by `extensible-static-analysis` change (2026-03-08)
> **Domain**: runner-orchestrator

## Purpose

The runner/orchestrator is responsible for executing registered static analysis tools sequentially, managing time budgets, handling installation, isolating failures, and aggregating results into a `StaticAnalysisResult`. It replaces the current hardcoded `runLocalAnalysis()` function that explicitly calls `executeSemgrep`, `executeTrivy`, `executeCpd`.

---

## Requirements

### Requirement: Registry-Driven Execution

The runner MUST iterate over tools from the registry instead of calling hardcoded tool functions.

#### Scenario: Runner executes all activated tools

- GIVEN 7 always-on tools are registered and none are disabled
- WHEN the runner executes
- THEN it MUST invoke the `install`, `run`, and `parse` functions for all 7 tools in sequence
- AND the result MUST contain entries for all 7 tools keyed by `ToolName`

#### Scenario: Runner includes auto-detect tools

- GIVEN a PR with `.py` and `Dockerfile` files
- WHEN the runner determines activated tools
- THEN it MUST include: all always-on tools + Ruff + Bandit + Hadolint
- AND it MUST NOT include: golangci-lint, Biome, PMD, Psalm, clippy

#### Scenario: Runner skips disabled tools

- GIVEN settings have `disabledTools: ['gitleaks', 'shellcheck']`
- WHEN the runner determines activated tools
- THEN Gitleaks and ShellCheck MUST NOT run
- AND their entries in `StaticAnalysisResult` MUST have `status: 'skipped'`

#### Scenario: Adding a new tool requires zero orchestrator changes

- GIVEN a developer creates a new tool plugin file and registers it
- WHEN the runner executes
- THEN the new tool MUST be automatically discovered and executed
- AND no changes to the runner/orchestrator code MUST be needed

### Requirement: Tool Activation Resolution

The runner MUST resolve which tools to activate based on: tier, auto-detect results, and user settings overrides.

The resolution order MUST be:
1. Start with all `always-on` tools
2. Run `detect(files)` for each `auto-detect` tool; add those that return `true`
3. Add any tools listed in `enabledTools` (force-enable override)
4. Remove any tools listed in `disabledTools` (force-disable override)
5. Remove any tools disabled by deprecated boolean flags (`enableSemgrep: false` → disable semgrep)

#### Scenario: Resolution with all defaults

- GIVEN `enabledTools: []`, `disabledTools: []`, and a PR with `.py` files
- WHEN activation is resolved
- THEN the result MUST include: all 7 always-on tools + Ruff + Bandit

#### Scenario: Resolution with force-enable

- GIVEN `enabledTools: ['clippy']` and no `.rs` files in the PR
- WHEN activation is resolved
- THEN clippy MUST be included (force-enabled despite no Rust files)

#### Scenario: Resolution with force-disable overriding always-on

- GIVEN `disabledTools: ['semgrep']`
- WHEN activation is resolved
- THEN Semgrep MUST NOT be included despite being `always-on`

#### Scenario: Deprecated boolean flag resolution

- GIVEN `enableSemgrep: false` (old flag) and `disabledTools` is undefined/empty
- WHEN activation is resolved
- THEN Semgrep MUST NOT be included
- AND this MUST produce identical behavior to `disabledTools: ['semgrep']`

#### Scenario: New field takes precedence over deprecated flag

- GIVEN `enableSemgrep: true` (old flag) AND `disabledTools: ['semgrep']`
- WHEN activation is resolved
- THEN Semgrep MUST NOT be included (new field wins)

### Requirement: Sequential Execution

The runner MUST execute tools sequentially (one at a time) to stay within memory constraints of the target runner environment (7GB RAM, 2 CPUs).

#### Scenario: Sequential execution order

- GIVEN 10 tools are activated
- WHEN the runner executes
- THEN each tool MUST complete (or timeout) before the next tool begins
- AND tools MUST NOT run concurrently

#### Scenario: Memory stays within bounds

- GIVEN Semgrep (Python, ~1GB) finishes before CPD (JVM, ~1.5GB) starts
- WHEN sequential execution occurs
- THEN peak memory usage MUST be approximately equal to the single heaviest tool
- AND MUST NOT exceed the combined memory of all tools

### Requirement: Time Budget Management

The runner MUST enforce a total time budget of 10 minutes (600,000 ms) distributed across all activated tools.

The budget allocation MUST work as follows:
- Total budget = 600,000 ms (configurable via environment variable)
- Per-tool share = total budget / number of activated tools
- Minimum per-tool share = 30,000 ms (30 seconds)
- Always-on tools MUST get priority if the budget is tight

#### Scenario: Equal budget distribution

- GIVEN 10 tools are activated and total budget is 600s
- WHEN the budget is allocated
- THEN each tool MUST receive 60s

#### Scenario: Minimum budget enforcement

- GIVEN 25 tools are activated and total budget is 600s
- WHEN the budget is allocated
- THEN each tool MUST receive at least 30s (minimum)
- AND if 25 * 30s = 750s > 600s, auto-detect tools MUST be deprioritized
- AND always-on tools MUST receive their full 30s minimum first

#### Scenario: Early finish gives remaining budget to next tool

- GIVEN Tool A was allocated 60s but finishes in 10s
- WHEN Tool B begins
- THEN Tool B's effective budget MUST be its allocated 60s + the 50s saved from Tool A

#### Scenario: Tool exceeds its budget

- GIVEN a tool is allocated 60s
- WHEN the tool has been running for 60s and has not completed
- THEN the tool's process MUST be terminated (SIGTERM, then SIGKILL after 5s grace period)
- AND the result for that tool MUST be `{ status: 'error', error: 'timeout', findings: [], executionTimeMs: ~60000 }`
- AND the runner MUST continue with the next tool

#### Scenario: Total budget exhausted

- GIVEN the total elapsed time reaches 600s
- WHEN there are still tools remaining
- THEN all remaining tools MUST be marked as `{ status: 'skipped', error: 'total-budget-exhausted' }`
- AND the runner MUST return immediately with results for completed tools

### Requirement: On-Demand Installation

Each tool MUST be installed on-demand only when it is activated for a review. Tools MUST NOT be pre-baked into the Docker image.

#### Scenario: Tool install on first activation

- GIVEN Gitleaks has never been installed on this runner
- WHEN Gitleaks is activated for a review
- THEN the install function MUST download and install the binary
- AND the install time MUST count against the tool's time budget

#### Scenario: Tool install from cache

- GIVEN Gitleaks was installed on a previous run and cached
- WHEN Gitleaks is activated
- THEN the install function MUST restore from cache
- AND MUST verify the cached binary works
- AND the cache restore MUST be significantly faster than a fresh install

#### Scenario: Tool install fails

- GIVEN the network is unavailable or the download URL returns 404
- WHEN a tool's install function fails
- THEN the tool MUST be marked as `{ status: 'error', error: 'installation failed: {details}' }`
- AND the runner MUST continue with the next tool
- AND the failure MUST NOT affect other tools

### Requirement: Failure Isolation

A single tool failure (crash, timeout, or error) MUST NOT prevent other tools from running. This is the existing pattern and MUST be preserved.

#### Scenario: One tool crashes

- GIVEN Tool C throws an unhandled exception during `run`
- WHEN the runner catches the error
- THEN Tool C's result MUST be `{ status: 'error', error: '{exception message}' }`
- AND Tools D, E, F MUST still execute normally
- AND the overall `StaticAnalysisResult` MUST include results for all tools

#### Scenario: One tool produces invalid output

- GIVEN Tool B produces stdout that is not valid JSON
- WHEN the `parse` function throws a parse error
- THEN Tool B's result MUST be `{ status: 'error', error: 'parse error: {details}' }`
- AND other tools MUST be unaffected

#### Scenario: Install failure does not block other installs

- GIVEN Tool A's install fails with a network error
- WHEN the runner moves to Tool B
- THEN Tool B's install MUST proceed independently
- AND Tool B's network requests MUST NOT be affected by Tool A's failure

### Requirement: Result Aggregation

The runner MUST aggregate individual tool results into a single `StaticAnalysisResult`.

#### Scenario: All tools succeed

- GIVEN 10 tools run and all succeed
- WHEN the runner aggregates results
- THEN `StaticAnalysisResult` MUST contain 10 entries
- AND each entry MUST have `status: 'success'`
- AND `ReviewMetadata.toolsRun` MUST list all 10 tool names

#### Scenario: Mixed success and failure

- GIVEN 10 tools are activated, 8 succeed, 1 errors, 1 is skipped
- WHEN the runner aggregates results
- THEN `StaticAnalysisResult` MUST contain 10 entries
- AND `ReviewMetadata.toolsRun` MUST list the 8 successful tool names
- AND `ReviewMetadata.toolsSkipped` MUST list the 2 non-successful tool names

#### Scenario: Skipped tools have standard result shape

- GIVEN a tool is disabled by user settings
- WHEN the runner creates the skipped result
- THEN it MUST be `{ status: 'skipped', findings: [], executionTimeMs: 0 }`

#### Scenario: Legacy semgrep/trivy/cpd keys always present

- GIVEN only 4 tools are activated (not including cpd)
- WHEN the runner aggregates results
- THEN `result.cpd` MUST still exist with `status: 'skipped'`
- AND `result.semgrep` and `result.trivy` MUST exist (even if skipped)
- AND this ensures backward compatibility with existing consumers

### Requirement: Logging and Observability

The runner MUST log tool execution progress for debugging and monitoring.

#### Scenario: Tool execution logged

- GIVEN a tool runs
- WHEN it completes (success, error, or timeout)
- THEN the runner MUST log: tool name, status, finding count, execution time in ms
- AND the log format MUST match the existing pattern: `"{ToolName}: {status} ({findingCount} findings, {timeMs}ms)"`

#### Scenario: Total execution summary

- GIVEN all tools have completed
- WHEN the runner logs the summary
- THEN it MUST include: total tool count, total finding count, total execution time
- AND it MUST list tools that were skipped or errored

### Requirement: Feature Flag Rollout

The runner MUST support a `GHAGGA_TOOL_REGISTRY` environment variable to control rollout.

#### Scenario: Feature flag disabled (false/unset)

- GIVEN `GHAGGA_TOOL_REGISTRY` is not set or is `false`
- WHEN the runner is invoked
- THEN it MUST fall back to the existing hardcoded 3-tool execution path
- AND behavior MUST be identical to the current codebase

#### Scenario: Feature flag enabled (true)

- GIVEN `GHAGGA_TOOL_REGISTRY=true`
- WHEN the runner is invoked
- THEN it MUST use the registry-driven execution path
- AND all registered tools MUST be considered for activation
