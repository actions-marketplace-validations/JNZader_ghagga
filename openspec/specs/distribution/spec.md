# Distribution Specification

> **Origin**: Archived from `ghagga-v2-rewrite` change, domain `distribution` (2026-03-07)

## Purpose

GHAGGA supports 4 distribution modes to maximize flexibility and minimize cost. Each mode is a thin adapter that wraps the core review engine with different input/output mechanisms.

## Requirements

### Requirement: SaaS Mode (Server + Webhook)

The system MUST support deployment as a centralized server receiving GitHub webhooks. This is the primary mode for private repositories.

#### Scenario: End-to-end SaaS review

- GIVEN a deployed Hono server with Inngest configured
- WHEN a PR is opened on a repository with the GHAGGA GitHub App installed
- THEN the server MUST receive the webhook, dispatch to Inngest, execute the review pipeline, and post a comment on the PR
- AND the entire flow MUST work without user intervention after initial setup

#### Scenario: 1-Click Deploy for community self-hosting

- GIVEN a community member wants their own GHAGGA instance
- WHEN they click the "Deploy to Railway" or "Deploy to Koyeb" button in the README
- THEN the deployment MUST prompt for required env vars (DATABASE_URL, GITHUB_APP_ID, GITHUB_PRIVATE_KEY, INNGEST_EVENT_KEY)
- AND the deployment MUST complete without manual file editing
- AND the resulting instance MUST be fully functional

### Requirement: GitHub Action Mode

The system MUST support execution as a GitHub Action for public repositories (free unlimited minutes).

#### Scenario: Action triggered on PR

- GIVEN a repository with `.github/workflows/ghagga.yml` configured
- WHEN a pull_request event occurs
- THEN the Action MUST:
  1. Check out the repository
  2. Install Semgrep, Trivy, and CPD (from container or setup steps)
  3. Compute the diff from the PR
  4. Run the core review pipeline
  5. Post the review as a PR comment using the GitHub token

#### Scenario: Action configuration

- GIVEN a user setting up the GHAGGA Action
- WHEN they configure the workflow YAML
- THEN the Action MUST accept inputs:
  - `provider`: LLM provider (default: "anthropic")
  - `model`: LLM model (default: provider's default)
  - `mode`: review mode (default: "simple")
  - `api-key`: LLM API key (from GitHub Secrets)
  - `enable-semgrep`: boolean (default: true)
  - `enable-trivy`: boolean (default: true)
  - `enable-cpd`: boolean (default: true)

#### Scenario: Action without database

- GIVEN the Action mode running in GitHub's ephemeral environment
- WHEN the review pipeline needs memory
- THEN memory MUST gracefully degrade (no past context available)
- AND the review MUST complete successfully without a database connection

### Requirement: CLI Mode

The system MUST support local execution via command-line interface.

#### Scenario: Review staged changes

- GIVEN a user in a git repository with staged changes
- WHEN the user runs `npx ghagga review`
- THEN the CLI MUST:
  1. Compute the diff from staged changes (or HEAD if no staged changes)
  2. Run static analysis tools (if available locally)
  3. Execute the review pipeline using the configured LLM provider
  4. Output the review result to stdout in formatted markdown

#### Scenario: CLI configuration

- GIVEN a user running the CLI for the first time
- WHEN the user runs `npx ghagga review`
- THEN the CLI MUST check for an API key in:
  1. `--api-key` flag
  2. Environment variable `GHAGGA_API_KEY`
  3. `.ghagga.json` file in the repository root
- AND if no key is found, the CLI MUST display a helpful error message

#### Scenario: CLI with optional tools

- GIVEN a user without Semgrep installed locally
- WHEN the user runs `npx ghagga review`
- THEN the CLI MUST skip Semgrep with a warning "Semgrep not found, skipping security scan. Install with: pip install semgrep"
- AND the review MUST continue with available tools

#### Scenario: CLI output formats

- GIVEN a completed review
- WHEN the CLI outputs results
- THEN the CLI MUST support output formats:
  - `--format markdown` (default): human-readable markdown
  - `--format json`: machine-readable JSON
  - `--format sarif`: SARIF format for IDE integration

### Requirement: Docker Support

The system MUST provide a Docker image for self-hosting on any infrastructure.

#### Scenario: Docker Compose deployment

- GIVEN a user with Docker and Docker Compose installed
- WHEN the user runs `docker compose up` with the provided `docker-compose.yml`
- THEN the system MUST start the Hono server with all static analysis tools pre-installed
- AND a PostgreSQL database MUST be started as a service
- AND the server MUST be accessible on the configured port

#### Scenario: Pre-built container with tools

- GIVEN the GHAGGA Docker image
- WHEN the container starts
- THEN Semgrep, Trivy, and PMD/CPD MUST be pre-installed and available on PATH
- AND Node.js runtime MUST be available
