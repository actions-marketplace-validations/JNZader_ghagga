# Core — Pipeline Provider Chain & Static-Only Mode

## Purpose

Define how the core review pipeline handles the provider chain for LLM fallback and the static-only mode when AI review is disabled.

## Requirements

### Requirement: Static-Only Review Mode

The `reviewPipeline` MUST support running without any LLM calls when AI review is disabled.

#### Scenario: Pipeline runs with AI disabled

- GIVEN a `ReviewInput` with `aiReviewEnabled: false`
- WHEN `reviewPipeline()` is called
- THEN the pipeline MUST run all enabled static analysis tools (Semgrep, Trivy, CPD)
- AND MUST NOT make any LLM API calls
- AND MUST return a `ReviewResult` with `status: 'PASSED'` if no critical/high findings, or `'FAILED'` if there are
- AND `metadata.provider` MUST be `'none'`
- AND `metadata.model` MUST be `'static-only'`
- AND `metadata.tokensUsed` MUST be `0`

#### Scenario: Pipeline skips memory search when AI disabled

- GIVEN a `ReviewInput` with `aiReviewEnabled: false` and `enableMemory: true`
- WHEN `reviewPipeline()` is called
- THEN memory search MUST be skipped (memory is only useful for LLM context)
- AND memory persistence MUST still run (to record static analysis observations)

### Requirement: Provider Chain Fallback in Pipeline

When AI review is enabled, the pipeline MUST use the provider chain via `generateWithFallback()` instead of direct single-provider calls.

#### Scenario: Primary provider succeeds

- GIVEN a provider chain of [GitHub Models (gpt-4o-mini), OpenAI (gpt-4o)]
- WHEN the pipeline runs and GitHub Models responds successfully
- THEN only the first provider MUST be called
- AND `metadata.provider` MUST be `'github'`
- AND `metadata.model` MUST be `'gpt-4o-mini'`

#### Scenario: Primary provider fails, fallback succeeds

- GIVEN a provider chain of [GitHub Models (gpt-4o-mini), OpenAI (gpt-4o)]
- WHEN the pipeline runs and GitHub Models returns a 429 (rate limit)
- THEN the pipeline MUST automatically try OpenAI
- AND if OpenAI succeeds, `metadata.provider` MUST be `'openai'`
- AND `metadata.model` MUST be `'gpt-4o'`

#### Scenario: All providers fail

- GIVEN a provider chain of [GitHub Models, OpenAI]
- WHEN both providers return 5xx errors
- THEN the pipeline MUST still return static analysis results
- AND `status` SHOULD be `'NEEDS_HUMAN_REVIEW'`
- AND the `summary` MUST indicate that AI review failed but static analysis completed
- AND `metadata.tokensUsed` MUST be `0`

### Requirement: ReviewInput Accepts Provider Chain

The `ReviewInput` type MUST accept either a single provider (backward compat for CLI/Action) or a provider chain.

#### Scenario: CLI passes single provider

- GIVEN a CLI invocation with `--provider openai --model gpt-4o --api-key sk-xxx`
- WHEN `ReviewInput` is constructed
- THEN it MUST work with the existing `provider`, `model`, `apiKey` fields
- AND the pipeline MUST treat it as a chain of 1

#### Scenario: Server passes provider chain

- GIVEN a webhook-triggered review with a provider chain from the database
- WHEN `ReviewInput` is constructed
- THEN it MUST use the `providerChain` field
- AND the pipeline MUST use `generateWithFallback()` with all entries

### Requirement: Consensus Mode with Provider Chain

In consensus mode, the pipeline currently uses the same provider 3 times with different stances. With a provider chain, it SHOULD still use the primary provider for all 3 stances (not spread across providers).

#### Scenario: Consensus uses primary provider

- GIVEN a provider chain of [OpenAI (gpt-4o), Anthropic (claude-sonnet)]
- WHEN consensus mode runs
- THEN all 3 stances (for, against, neutral) MUST use OpenAI gpt-4o
- AND the fallback chain is only used if the primary provider fails for ALL stances

### Requirement: Inngest Review Function Reads Provider Chain

The Inngest `ghagga-review` function MUST read the provider chain from the event data and build the appropriate `ReviewInput`.

#### Scenario: Inngest receives chain from webhook

- GIVEN a webhook dispatches a review event with `providerChain` and `aiReviewEnabled`
- WHEN the Inngest function's `run-review` step executes
- THEN it MUST decrypt API keys for each chain entry
- AND pass the full chain to `reviewPipeline()`

#### Scenario: Inngest handles AI disabled

- GIVEN a webhook dispatches a review event with `aiReviewEnabled: false`
- WHEN the Inngest function executes
- THEN it MUST skip the API key decryption step
- AND pass `aiReviewEnabled: false` to `reviewPipeline()`
