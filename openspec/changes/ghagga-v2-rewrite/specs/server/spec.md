# Server Specification

## Purpose

The server is the Hono-based API backend that handles GitHub webhooks, serves the dashboard API, and orchestrates reviews via Inngest. It is one of four distribution adapters (server, CLI, Action, 1-click) that wrap the core review engine.

## Requirements

### Requirement: GitHub Webhook Reception

The system MUST receive and validate GitHub App webhook events.

#### Scenario: Valid pull_request.opened event

- GIVEN a properly signed webhook payload for event "pull_request" with action "opened"
- WHEN the webhook endpoint receives the request
- THEN the system MUST verify the HMAC-SHA256 signature using constant-time comparison
- AND the system MUST respond with HTTP 200 within 5 seconds
- AND the system MUST dispatch the review to Inngest for async processing

#### Scenario: Invalid webhook signature

- GIVEN a webhook payload with an incorrect or missing X-Hub-Signature-256 header
- WHEN the webhook endpoint receives the request
- THEN the system MUST respond with HTTP 401 Unauthorized
- AND the system MUST NOT process the event
- AND the system MUST log the rejected attempt

#### Scenario: Unsupported event type

- GIVEN a valid webhook for event "issues" (not pull_request)
- WHEN the webhook endpoint receives the request
- THEN the system MUST respond with HTTP 200 (acknowledge receipt)
- AND the system MUST NOT dispatch any review task

#### Scenario: PR only modifies ignored files

- GIVEN a PR that only changes files matching ignore patterns (e.g., `*.md`, `.gitignore`)
- WHEN the webhook is processed
- THEN the system MUST skip the review
- AND the system MUST respond with HTTP 200
- AND no Inngest event MUST be emitted

### Requirement: Installation Management

The system MUST handle GitHub App installation and uninstallation events.

#### Scenario: New installation

- GIVEN a webhook event "installation" with action "created"
- WHEN the event is processed
- THEN the system MUST save the installation record (installation_id, account_login, account_type)
- AND the system MUST create default repository configurations for all included repositories

#### Scenario: Installation deleted

- GIVEN a webhook event "installation" with action "deleted"
- WHEN the event is processed
- THEN the system MUST mark the installation as inactive
- AND the system MUST NOT delete existing review data (audit trail)

### Requirement: Async Review Processing via Inngest

The system MUST use Inngest for durable, async execution of the review pipeline.

#### Scenario: Review dispatched to Inngest

- GIVEN a valid PR webhook event
- WHEN the webhook handler dispatches the review
- THEN the system MUST emit an Inngest event with the PR data (owner, repo, PR number, diff URL, installation_id)
- AND the Inngest function MUST execute the core review pipeline
- AND each pipeline layer (static analysis, memory, agents, persistence) MUST be a separate Inngest step for checkpointing

#### Scenario: Inngest quota exceeded

- GIVEN the Inngest free tier limit (50k events) has been reached
- WHEN a new PR webhook arrives
- THEN the system MUST detect the quota error
- AND the system MUST fall back to a synchronous static-analysis-only review
- AND the PR comment MUST note "AI review unavailable (quota exceeded), showing static analysis results only"

#### Scenario: Inngest step retry on LLM failure

- GIVEN the agent LLM call fails with a 5xx error
- WHEN Inngest processes the retry
- THEN only the failed step MUST be retried (not the entire pipeline)
- AND the retry MUST use exponential backoff (max 3 retries)

### Requirement: Dashboard REST API

The system MUST expose REST endpoints for the dashboard frontend.

#### Scenario: List reviews for a repository

- GIVEN an authenticated user with access to installation "org-123"
- WHEN GET /api/reviews?repo=owner/repo is called
- THEN the response MUST return paginated reviews for that repository
- AND results MUST be scoped to the user's installations only

#### Scenario: Update repository settings

- GIVEN an authenticated user who owns installation "org-123"
- WHEN PUT /api/repositories/:id/settings is called with valid settings
- THEN the repository settings MUST be updated in the database
- AND the response MUST return the updated settings

#### Scenario: Manage API keys

- GIVEN an authenticated user
- WHEN POST /api/repositories/:id/api-key is called with a provider and key
- THEN the key MUST be encrypted with AES-256-GCM before storage
- AND the original plaintext key MUST NOT be stored or logged
- AND subsequent GET requests MUST NOT return the decrypted key (only a masked indicator like "sk-...xxxx")

### Requirement: Authentication

The system MUST authenticate dashboard API requests using GitHub OAuth tokens.

#### Scenario: Valid GitHub token

- GIVEN a request with a valid Bearer token in the Authorization header
- WHEN the auth middleware processes the request
- THEN the system MUST verify the token against GitHub's API
- AND extract the user's GitHub ID and installation access
- AND attach the user context to the request

#### Scenario: Missing or invalid token

- GIVEN a request without a Bearer token or with an expired token
- WHEN the auth middleware processes the request
- THEN the system MUST respond with HTTP 401 Unauthorized

### Requirement: GitHub PR Comment Posting

The system MUST post review results as comments on the GitHub Pull Request.

#### Scenario: Successful review comment

- GIVEN a completed review with status "FAILED" and 5 findings
- WHEN the comment is posted to GitHub
- THEN the comment MUST include: status badge, summary, findings table with severity/file/line/message
- AND static analysis findings MUST be in a separate section from AI findings
- AND the comment MUST be formatted as GitHub-flavored markdown

#### Scenario: Review passed with no findings

- GIVEN a completed review with status "PASSED" and 0 findings
- WHEN the comment is posted to GitHub
- THEN the comment MUST include a positive summary
- AND the comment SHOULD be concise (no empty findings table)

### Requirement: Health Check

The system MUST expose a health check endpoint.

#### Scenario: Health check

- GIVEN the server is running
- WHEN GET /health is called
- THEN the response MUST return HTTP 200 with { "status": "ok" }
- AND the response SHOULD include database connectivity status
