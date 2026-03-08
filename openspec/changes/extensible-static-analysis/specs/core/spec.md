# Delta for Core Types

> **Change**: extensible-static-analysis
> **Existing spec**: `openspec/specs/static-analysis/spec.md`

## ADDED Requirements

### Requirement: ToolDefinition Interface

The system MUST define a `ToolDefinition` interface that fully describes a static analysis tool as a self-contained plugin.

A `ToolDefinition` MUST include:
- `name`: a unique `ToolName` string identifier (lowercase, kebab-case)
- `displayName`: a human-readable label for UI display
- `category`: a `ToolCategory` value
- `tier`: `'always-on' | 'auto-detect'`
- `detect`: a function `(files: string[]) => boolean` (REQUIRED for `auto-detect` tier, OPTIONAL for `always-on`)
- `install`: a function `(cacheDir: string) => Promise<void>` that installs the tool binary
- `run`: a function `(repoDir: string, files: string[], timeout: number) => Promise<RawToolOutput>` that executes the tool
- `parse`: a function `(raw: RawToolOutput) => ReviewFinding[]` that normalizes output into findings
- `version`: a pinned version string
- `outputFormat`: `'json' | 'sarif' | 'xml' | 'text'`

#### Scenario: ToolDefinition is self-contained

- GIVEN a tool plugin file implementing `ToolDefinition`
- WHEN the plugin is registered with the registry
- THEN no other file in the codebase needs modification to activate the tool
- AND the registry MUST be the single point of tool discovery

#### Scenario: Auto-detect tool requires detect function

- GIVEN a `ToolDefinition` with `tier: 'auto-detect'`
- WHEN the definition is validated at registration time
- THEN the `detect` field MUST be a function (not undefined)
- AND if `detect` is undefined, registration MUST throw a descriptive error

#### Scenario: Always-on tool detect is optional

- GIVEN a `ToolDefinition` with `tier: 'always-on'`
- WHEN the definition is validated at registration time
- THEN the `detect` field MAY be undefined
- AND the tool MUST be activated for every review regardless

### Requirement: ToolCategory Type

The system MUST define a `ToolCategory` union type categorizing tool purposes.

`ToolCategory` MUST include at minimum: `'security' | 'quality' | 'secrets' | 'complexity' | 'duplication' | 'sca' | 'docs' | 'linting'`.

#### Scenario: Each tool maps to exactly one category

- GIVEN a `ToolDefinition` for Semgrep
- WHEN inspecting its `category` field
- THEN it MUST be exactly one value from `ToolCategory` (e.g., `'security'`)

### Requirement: ToolName Type

The system MUST define a `ToolName` type as a string union derived from the registry's registered tool names.

`ToolName` MUST include at minimum: `'semgrep' | 'trivy' | 'cpd' | 'gitleaks' | 'shellcheck' | 'markdownlint' | 'lizard' | 'ruff' | 'bandit' | 'golangci-lint' | 'biome' | 'pmd' | 'psalm' | 'clippy' | 'hadolint'`.

#### Scenario: ToolName used as Record key

- GIVEN a `StaticAnalysisResult` object
- WHEN accessing a tool result by name
- THEN the key MUST be a valid `ToolName` value
- AND TypeScript MUST provide autocomplete for known tool names

### Requirement: RawToolOutput Type

The system MUST define a `RawToolOutput` type representing the raw output from a tool execution.

`RawToolOutput` MUST contain:
- `stdout`: string (the tool's standard output)
- `stderr`: string (the tool's standard error)
- `exitCode`: number
- `timedOut`: boolean (true if the tool was killed due to timeout)

#### Scenario: Tool produces valid raw output

- GIVEN Semgrep executes successfully
- WHEN the `run` function returns
- THEN `RawToolOutput.stdout` MUST contain the JSON output
- AND `RawToolOutput.exitCode` MUST be 0
- AND `RawToolOutput.timedOut` MUST be false

#### Scenario: Tool times out

- GIVEN a tool exceeds its allocated time budget
- WHEN the tool process is killed
- THEN `RawToolOutput.timedOut` MUST be true
- AND `RawToolOutput.exitCode` SHOULD be non-zero
- AND `RawToolOutput.stdout` MAY contain partial output

### Requirement: FindingSource Extension

The existing `FindingSource` type MUST be extended from the hardcoded `'ai' | 'semgrep' | 'trivy' | 'cpd'` to include all registered tool names.

`FindingSource` MUST become: `'ai' | ToolName`.

#### Scenario: New tool findings have correct source

- GIVEN Gitleaks produces a finding for a leaked API key
- WHEN the finding is created as a `ReviewFinding`
- THEN `finding.source` MUST be `'gitleaks'`
- AND TypeScript MUST accept `'gitleaks'` as a valid `FindingSource`

#### Scenario: Existing AI findings unchanged

- GIVEN the AI agent produces a code quality finding
- WHEN the finding is created
- THEN `finding.source` MUST remain `'ai'`

## MODIFIED Requirements

### Requirement: StaticAnalysisResult Becomes Extensible

`StaticAnalysisResult` MUST change from a closed interface with fixed keys to `Record<ToolName, ToolResult>`.

(Previously: `StaticAnalysisResult` was `{ semgrep: ToolResult; trivy: ToolResult; cpd: ToolResult }`)

The type MUST guarantee that `semgrep`, `trivy`, and `cpd` keys are always present (backward compatibility) while allowing additional dynamic keys.

#### Scenario: Backward-compatible access to semgrep

- GIVEN a `StaticAnalysisResult` produced by the new registry-driven runner
- WHEN existing code accesses `result.semgrep`
- THEN the access MUST succeed without type errors
- AND the value MUST be a valid `ToolResult`
- AND if Semgrep was disabled, the value MUST be `{ status: 'skipped', findings: [], executionTimeMs: 0 }`

#### Scenario: Backward-compatible access to trivy

- GIVEN a `StaticAnalysisResult` produced by the new runner
- WHEN existing code accesses `result.trivy`
- THEN the access MUST succeed without type errors

#### Scenario: Backward-compatible access to cpd

- GIVEN a `StaticAnalysisResult` produced by the new runner
- WHEN existing code accesses `result.cpd`
- THEN the access MUST succeed without type errors

#### Scenario: Dynamic access to new tools

- GIVEN a `StaticAnalysisResult` with Gitleaks results
- WHEN code accesses `result.gitleaks`
- THEN the access MUST return a `ToolResult | undefined`
- AND TypeScript MUST NOT require a type assertion

#### Scenario: Iterating over all tool results

- GIVEN a `StaticAnalysisResult` with 7 tools
- WHEN code iterates via `Object.entries(result)`
- THEN all 7 tool results MUST be yielded
- AND each value MUST be typed as `ToolResult`

### Requirement: ReviewSettings Tool Configuration

`ReviewSettings` MUST change from per-tool boolean flags to a list-based approach.

(Previously: `ReviewSettings` had `enableSemgrep: boolean`, `enableTrivy: boolean`, `enableCpd: boolean`)

`ReviewSettings` MUST add:
- `enabledTools?: string[]` — tools to force-enable (overrides auto-detect)
- `disabledTools?: string[]` — tools to force-disable (overrides auto-detect and always-on)

The old `enableSemgrep`, `enableTrivy`, `enableCpd` fields MUST remain as deprecated aliases during the migration window.

#### Scenario: Old boolean flags still work

- GIVEN a `ReviewSettings` with `enableSemgrep: false` and no `disabledTools`
- WHEN the runner resolves which tools to activate
- THEN Semgrep MUST be disabled
- AND this MUST produce the same behavior as `disabledTools: ['semgrep']`

#### Scenario: New disabledTools takes precedence over old flags

- GIVEN a `ReviewSettings` with `enableSemgrep: true` AND `disabledTools: ['semgrep']`
- WHEN the runner resolves which tools to activate
- THEN Semgrep MUST be disabled (new field takes precedence)

#### Scenario: enabledTools forces auto-detect tools on

- GIVEN a `ReviewSettings` with `enabledTools: ['ruff']` and no Python files in the diff
- WHEN the runner resolves which tools to activate
- THEN Ruff MUST be activated despite auto-detect not triggering

#### Scenario: disabledTools overrides always-on

- GIVEN a `ReviewSettings` with `disabledTools: ['gitleaks']`
- WHEN the runner resolves which tools to activate
- THEN Gitleaks MUST NOT run, even though it is tier `always-on`

### Requirement: DEFAULT_SETTINGS Update

`DEFAULT_SETTINGS` MUST be updated to reflect the new tool configuration fields.

(Previously: `DEFAULT_SETTINGS` had `enableSemgrep: true, enableTrivy: true, enableCpd: true`)

`DEFAULT_SETTINGS` MUST include:
- `enabledTools: []` (empty — rely on tier defaults)
- `disabledTools: []` (empty — all tier-appropriate tools run)
- Deprecated: `enableSemgrep: true`, `enableTrivy: true`, `enableCpd: true` (kept for backward compat)

#### Scenario: Fresh installation uses all defaults

- GIVEN a new repository with no custom settings
- WHEN `DEFAULT_SETTINGS` is applied
- THEN all `always-on` tools MUST be activated
- AND `auto-detect` tools MUST be activated based on file detection
- AND no tools MUST be force-disabled

### Requirement: Finding Count Cap

The system MUST cap the total number of static analysis findings injected into LLM agent context.

#### Scenario: Findings exceed cap

- GIVEN 15 tools produce a combined 350 findings
- WHEN findings are formatted for LLM prompt injection
- THEN only the top 200 findings MUST be included
- AND findings MUST be sorted by severity (critical > high > medium > low > info)
- AND a summary line MUST indicate "Showing 200 of 350 findings"

#### Scenario: Findings below cap

- GIVEN 15 tools produce a combined 50 findings
- WHEN findings are formatted for LLM prompt injection
- THEN all 50 findings MUST be included
- AND no truncation message MUST appear

## REMOVED Requirements

(None — all existing requirements are preserved or extended)
