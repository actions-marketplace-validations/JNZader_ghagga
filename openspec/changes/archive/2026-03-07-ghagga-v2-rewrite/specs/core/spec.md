# Core Review Engine Specification

## Purpose

The core review engine is the heart of GHAGGA. It receives a code diff and configuration, orchestrates static analysis tools and AI agents, and returns a structured review result. It is distribution-agnostic — it knows nothing about HTTP, CLI, or GitHub Actions.

## Requirements

### Requirement: Review Pipeline Execution

The system MUST execute reviews through a layered pipeline: Layer 0 (static analysis), Layer 1 (memory retrieval), Layer 2 (AI agents), Layer 3 (memory persistence).

#### Scenario: Successful full pipeline review

- GIVEN a valid diff string and a repository configuration with mode "workflow"
- WHEN the review pipeline is executed
- THEN Layer 0 MUST run Semgrep, Trivy, and CPD in parallel
- AND Layer 1 MUST search memory for past observations related to the changed files
- AND Layer 2 MUST run the workflow agents with static analysis findings and memory context injected
- AND Layer 3 MUST save new observations from the review to memory
- AND the pipeline MUST return a structured ReviewResult

#### Scenario: Static analysis failure does not block review

- GIVEN a valid diff and configuration
- WHEN one or more static analysis tools fail (binary not found, timeout, crash)
- THEN the pipeline MUST continue with the remaining tools
- AND the pipeline MUST log a warning for each failed tool
- AND the AI agents MUST still receive whatever findings were collected

#### Scenario: Empty diff

- GIVEN an empty diff string
- WHEN the review pipeline is invoked
- THEN the system MUST return a ReviewResult with status "SKIPPED" and reason "empty diff"
- AND no AI tokens MUST be consumed

### Requirement: Simple Review Mode

The system MUST support a "simple" review mode that uses a single LLM call with a comprehensive system prompt.

#### Scenario: Simple review produces structured output

- GIVEN a diff and configuration with mode "simple"
- WHEN the simple review agent is executed
- THEN the agent MUST return a status (PASSED or FAILED)
- AND a summary (2-3 sentences)
- AND zero or more findings, each with: severity (critical/high/medium/low/info), category, file, line, message, and suggestion

#### Scenario: Simple review receives static analysis context

- GIVEN static analysis found 3 issues
- WHEN the simple review agent prompt is constructed
- THEN the prompt MUST include the static analysis findings formatted as pre-confirmed issues
- AND the prompt MUST instruct the agent NOT to repeat those findings

### Requirement: Workflow Review Mode

The system MUST support a "workflow" review mode with 5 specialist agents running in parallel, followed by a synthesis step.

#### Scenario: Five specialists run in parallel

- GIVEN a diff and configuration with mode "workflow"
- WHEN the workflow review is executed
- THEN 5 specialist agents MUST be invoked: scope-analysis, coding-standards, error-handling, security-audit, performance-review
- AND all 5 SHOULD run in parallel (using Promise.allSettled)
- AND if any specialist fails, the remaining results MUST still be synthesized

#### Scenario: Synthesis deduplicates findings

- GIVEN 5 specialist reports where 2 agents flagged the same issue
- WHEN the synthesis step runs
- THEN the final report MUST contain the finding only once
- AND the finding MUST reference the highest severity among duplicates

#### Scenario: Workflow with memory context

- GIVEN memory contains 2 past observations about the changed files
- WHEN the specialist agents receive their prompts
- THEN each specialist MUST receive the past observations as additional context

### Requirement: Consensus Review Mode

The system MUST support a "consensus" review mode where multiple LLM models review the same diff with different stances and vote on the outcome.

#### Scenario: Multi-model voting

- GIVEN a diff and configuration with mode "consensus" and 3 configured models
- WHEN the consensus review is executed
- THEN each model MUST review the diff with an assigned stance: one FOR approval, one AGAINST, one NEUTRAL
- AND each model MUST return: decision (approve/reject/abstain), confidence (0-1), and reasoning
- AND the final recommendation MUST be calculated using weighted voting

#### Scenario: Consensus threshold

- GIVEN 3 model votes: approve (confidence 0.9), reject (confidence 0.6), approve (confidence 0.8)
- WHEN the consensus is calculated
- THEN the recommendation MUST be "approve"
- AND the confidence gap between approve and reject MUST exceed 0.3 (30%)

#### Scenario: No clear consensus

- GIVEN 3 model votes with no decision reaching 60% weighted support
- WHEN the consensus is calculated
- THEN the recommendation MUST be "needs-human-review"
- AND the report MUST include all individual model reasoning

### Requirement: Multi-Provider AI Support

The system MUST support multiple LLM providers through the Vercel AI SDK.

#### Scenario: Provider fallback chain

- GIVEN a repository configured with provider "anthropic" and a valid API key
- WHEN the Anthropic API returns a 5xx error
- THEN the system SHOULD fall back to the next provider in the chain (OpenAI, then Google)
- AND the system MUST log which provider was used

#### Scenario: BYOK (Bring Your Own Key)

- GIVEN a repository with an encrypted API key stored in the database
- WHEN a review is triggered for that repository
- THEN the system MUST decrypt the key at runtime
- AND the key MUST never be logged or included in error messages
- AND the key MUST be used for all LLM calls for that review

### Requirement: Token Budget Management

The system MUST manage token consumption to avoid exceeding model context limits.

#### Scenario: Diff exceeds model context

- GIVEN a diff that exceeds the configured model's context window
- WHEN the review pipeline prepares the prompt
- THEN the diff MUST be truncated to fit within the token budget
- AND the truncation MUST prioritize files with the most changes
- AND the review result MUST note that the diff was truncated

### Requirement: Stack Detection

The system MUST auto-detect the tech stack from the files in the diff.

#### Scenario: TypeScript project detected

- GIVEN a diff containing `.ts` and `.tsx` files
- WHEN stack detection runs
- THEN the detected stack MUST include "typescript" and "react" (if JSX present)
- AND the agent prompts MUST receive stack-specific review hints

#### Scenario: Multi-language diff

- GIVEN a diff containing `.py`, `.go`, and `.sql` files
- WHEN stack detection runs
- THEN the detected stacks MUST include "python", "go", and "sql"
- AND each language-specific hint MUST be included in the prompt
