# Integration Tests Specification

> **Origin**: Archived from `e2e-integration-tests` change (2026-03-07)

## Purpose

Integration test suites that validate the wiring between GHAGGA components. Unlike unit tests (which mock all dependencies and verify modules in isolation), these tests exercise multi-component flows with mocked external services (GitHub API, AI providers) to catch boundary bugs.

## Requirements

### Requirement: Webhook -> Review Dispatch Integration

Test the full HTTP flow from webhook receipt through Inngest event dispatch.

#### Scenario: Valid PR webhook dispatches to Inngest

- GIVEN a valid `pull_request.opened` webhook payload with correct HMAC signature
- WHEN the webhook endpoint processes the request
- THEN `inngest.send()` MUST be called with correct event name and data shape (installationId, repoFullName, prNumber, headSha, settings)

#### Scenario: Invalid signature rejects request

- GIVEN a webhook payload with an incorrect X-Hub-Signature-256 header
- WHEN the webhook endpoint processes the request
- THEN the response MUST be HTTP 401
- AND Inngest MUST NOT be called

#### Scenario: Non-PR event acknowledged but not dispatched

- GIVEN a valid webhook for a non-PR event type (e.g., `star`, `push`)
- WHEN the webhook endpoint processes the request
- THEN the response MUST be HTTP 200
- AND Inngest MUST NOT be called

#### Scenario: Comment trigger dispatches review

- GIVEN an `issue_comment` webhook with "ghagga review" keyword from an authorized user on a PR
- WHEN the webhook endpoint processes the request
- THEN a review MUST be dispatched with `triggerCommentId` set

#### Scenario: Comment trigger from unauthorized user rejected

- GIVEN an `issue_comment` webhook from a user with association `NONE`
- WHEN the webhook endpoint processes the request
- THEN no review MUST be dispatched

**Mocked dependencies:**
- `ghagga-db`: `getRepoByGithubId`, `getEffectiveRepoSettings`
- `../inngest/client.js`: `inngest.send()`
- `../github/client.js`: `verifyWebhookSignature` (use real implementation with test secret), `getInstallationToken`, `fetchPRDetails`, `addCommentReaction`

---

### Requirement: API Endpoints with Auth Integration

Test API routes are properly gated by auth middleware and return correct data.

#### Scenario: Authenticated request returns repo list

- GIVEN an authenticated request with a valid GitHub OAuth token
- WHEN `GET /api/repositories` is called
- THEN the response MUST return the repo list from the user's installations

#### Scenario: Authenticated request returns stats

- GIVEN an authenticated request with a valid GitHub OAuth token
- WHEN `GET /api/stats?repo=owner/repo` is called
- THEN the response MUST return mapped stats data

#### Scenario: Missing auth header returns 401

- GIVEN a request without an Authorization header
- WHEN any `/api/*` endpoint is called
- THEN the response MUST be HTTP 401

#### Scenario: Invalid token returns 401

- GIVEN a request with an invalid or expired Bearer token
- WHEN any `/api/*` endpoint is called
- THEN the response MUST be HTTP 401

#### Scenario: Cross-installation access returns 403

- GIVEN an authenticated user accessing a repo from a different installation
- WHEN the API endpoint is called
- THEN the response MUST be HTTP 403

**Mocked dependencies:**
- `ghagga-db`: all DB query functions
- Global `fetch`: to mock `https://api.github.com/user` call in auth middleware

---

### Requirement: Core Review Pipeline Integration

Test the pipeline orchestrator produces correct output with mocked providers.

#### Scenario: Simple mode produces structured ReviewResult

- GIVEN a valid diff and configuration with mode `simple`
- AND a mocked AI provider
- WHEN the pipeline is executed
- THEN the result MUST be a `ReviewResult` with status, summary, findings, and metadata

#### Scenario: Pipeline with memory enabled uses memory

- GIVEN memory is enabled in the configuration
- WHEN the pipeline is executed
- THEN memory search MUST be called before the AI agent
- AND memory persist MUST be called after the review completes

#### Scenario: Static analysis failure degrades gracefully

- GIVEN a static analysis tool throws an error
- WHEN the pipeline is executed
- THEN the result MUST still contain AI findings
- AND the failed tool MUST be in an error state in the result

#### Scenario: All files filtered returns SKIPPED

- GIVEN all files in the diff match ignore patterns
- WHEN the pipeline is executed
- THEN the result MUST have status `SKIPPED`

**Mocked dependencies:**
- `./agents/simple.js`: `runSimpleReview`
- `./tools/runner.js`: `runStaticAnalysis`, `formatStaticAnalysisContext`
- `./memory/search.js`: `searchMemoryForContext`
- `./memory/persist.js`: `persistReviewObservations`

---

## Non-functional Requirements

- **NF1**: All integration tests MUST complete in < 5 seconds total.
- **NF2**: No real network calls — all external HTTP MUST be mocked.
- **NF3**: Tests MUST be filterable via `describe('integration:')` naming convention.
- **NF4**: Zero impact on existing test suite — no modified production code.
