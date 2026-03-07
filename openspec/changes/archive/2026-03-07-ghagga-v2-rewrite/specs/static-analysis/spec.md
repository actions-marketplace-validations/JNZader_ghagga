# Static Analysis Specification

## Purpose

Static analysis (Layer 0) runs deterministic security and quality checks BEFORE the LLM agents, consuming zero AI tokens. Findings are injected into agent prompts as pre-confirmed issues, preventing the AI from wasting tokens rediscovering known problems.

## Requirements

### Requirement: Semgrep Security Scanning

The system MUST run Semgrep to detect security vulnerabilities and dangerous code patterns across 15+ programming languages.

#### Scenario: Semgrep finds SQL injection pattern

- GIVEN a diff containing a Python file with string concatenation in a SQL query
- WHEN Semgrep analysis runs
- THEN the result MUST include a finding with category "security", rule "sql-injection", file path, and line number
- AND the finding severity MUST match the Semgrep rule severity

#### Scenario: Semgrep with custom rules

- GIVEN a repository configured with custom Semgrep rules in the settings
- WHEN Semgrep analysis runs
- THEN the system MUST apply both the default GHAGGA rules AND the custom rules
- AND custom rule findings MUST be clearly labeled as "custom"

#### Scenario: Semgrep binary not available

- GIVEN the Semgrep binary is not installed in the environment
- WHEN static analysis runs
- THEN the system MUST log a warning "Semgrep not available, skipping security scan"
- AND the analysis MUST continue with remaining tools
- AND the result MUST indicate Semgrep was skipped

### Requirement: Trivy Dependency Scanning

The system MUST run Trivy to detect known CVEs (Common Vulnerabilities and Exposures) in project dependencies.

#### Scenario: Trivy detects critical CVE

- GIVEN a diff that modifies `package.json` adding a dependency with a known critical CVE
- WHEN Trivy analysis runs
- THEN the result MUST include the CVE ID, affected package, installed version, fixed version (if available), and severity
- AND critical CVEs MUST be flagged as severity "critical"

#### Scenario: Trivy scans lock files

- GIVEN a diff containing changes to `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `go.sum`, `Cargo.lock`, `requirements.txt`, or `Pipfile.lock`
- WHEN Trivy analysis runs
- THEN Trivy MUST scan the appropriate lock file for the ecosystem

#### Scenario: No dependency files in diff

- GIVEN a diff that contains only `.ts` source files with no dependency manifests
- WHEN Trivy analysis runs
- THEN Trivy SHOULD still run against the repository root if available
- AND if no dependency files are found, Trivy MUST return an empty result (not an error)

#### Scenario: Trivy binary not available

- GIVEN the Trivy binary is not installed in the environment
- WHEN static analysis runs
- THEN the system MUST log a warning "Trivy not available, skipping dependency scan"
- AND the analysis MUST continue with remaining tools

### Requirement: PMD/CPD Duplicate Code Detection

The system MUST run PMD's CPD (Copy-Paste Detector) to find duplicated code blocks across files in the diff.

#### Scenario: CPD detects duplicated block

- GIVEN a diff where the same 15-line function appears in two different files
- WHEN CPD analysis runs
- THEN the result MUST include both file paths, line ranges, and the number of duplicated tokens
- AND the minimum token threshold MUST be configurable (default: 100 tokens)

#### Scenario: CPD across multiple languages

- GIVEN a diff containing both Java and TypeScript files with duplicated logic
- WHEN CPD analysis runs
- THEN CPD MUST analyze each supported language independently
- AND duplicates MUST only be reported within the same language

#### Scenario: CPD binary not available

- GIVEN the CPD/PMD binary is not installed in the environment
- WHEN static analysis runs
- THEN the system MUST log a warning "CPD not available, skipping duplicate detection"
- AND the analysis MUST continue with remaining tools

### Requirement: Parallel Execution

The system MUST run all three static analysis tools in parallel.

#### Scenario: All tools complete successfully

- GIVEN Semgrep, Trivy, and CPD are all available
- WHEN static analysis runs
- THEN all three tools MUST be invoked concurrently (Promise.allSettled)
- AND the combined result MUST merge findings from all tools
- AND the total execution time SHOULD be approximately equal to the slowest tool (not the sum)

#### Scenario: Partial tool failure

- GIVEN Semgrep succeeds, Trivy times out, and CPD crashes
- WHEN static analysis completes
- THEN the result MUST include Semgrep findings
- AND the result MUST include warnings for Trivy (timeout) and CPD (crash)
- AND the pipeline MUST NOT fail entirely

### Requirement: Output Format for LLM Injection

The system MUST format static analysis findings into a structured context block suitable for LLM prompt injection.

#### Scenario: Findings formatted for agent prompt

- GIVEN Semgrep found 2 issues and Trivy found 1 CVE
- WHEN the findings are formatted for prompt injection
- THEN the output MUST be a markdown block titled "Pre-Review Static Analysis (confirmed issues)"
- AND each finding MUST include tool name, severity, file, line (if applicable), and description
- AND the block MUST end with the instruction "Do NOT repeat these findings in your review"

### Requirement: AI-Generated Code Attribution

The system MUST detect common patterns indicating AI-generated code in the diff.

#### Scenario: AI attribution markers detected

- GIVEN a diff containing comments like "Generated by GitHub Copilot" or "// AI-generated"
- WHEN AI attribution analysis runs
- THEN the result MUST flag the file as potentially AI-generated
- AND this information MUST be included in the agent prompt context

### Requirement: Commit Message Validation

The system SHOULD validate commit messages against conventional commit format.

#### Scenario: Non-conventional commit message

- GIVEN a PR with commits that don't follow conventional commits (feat:, fix:, chore:, etc.)
- WHEN commit validation runs
- THEN the result SHOULD include a suggestion to use conventional commits
- AND this SHOULD be a "low" severity finding
