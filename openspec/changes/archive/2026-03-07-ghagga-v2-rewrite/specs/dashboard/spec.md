# Dashboard Specification

## Purpose

The dashboard is a React SPA deployed on GitHub Pages that provides a visual interface for configuring repositories, browsing review history, managing API keys, and viewing memory observations. It communicates with the server API and authenticates via GitHub OAuth.

## Requirements

### Requirement: GitHub OAuth Authentication

The system MUST authenticate users via GitHub OAuth flow.

#### Scenario: Successful login

- GIVEN an unauthenticated user visits the dashboard
- WHEN the user clicks "Sign in with GitHub"
- THEN the system MUST redirect to GitHub's OAuth authorization page
- AND upon successful authorization, the user MUST be redirected back to the dashboard
- AND the dashboard MUST store the session token securely

#### Scenario: Unauthorized access

- GIVEN an unauthenticated user navigates directly to /dashboard
- WHEN the page loads
- THEN the system MUST redirect the user to the login page

### Requirement: Review History

The system MUST display a browsable, filterable list of past reviews.

#### Scenario: View review list

- GIVEN a logged-in user with 2 repositories that have reviews
- WHEN the user navigates to the Reviews page
- THEN the system MUST display a table with columns: status, repository, PR number, date, mode
- AND the table MUST support filtering by repository and status
- AND the table MUST support text search
- AND results MUST be paginated

#### Scenario: View review detail

- GIVEN a review list with entries
- WHEN the user clicks on a review row
- THEN a detail view MUST show: full summary, all findings with severity/file/line, static analysis results, and the review mode used

### Requirement: Dashboard Statistics

The system MUST display aggregate review statistics.

#### Scenario: Stats overview

- GIVEN a user with 50 reviews across 3 repositories
- WHEN the user navigates to the Dashboard page
- THEN the system MUST display:
  - Total reviews count
  - Pass/fail counts and ratio
  - Reviews over time chart (area chart, last 30 days)
  - Pass rate ring/progress indicator

### Requirement: Repository Settings

The system MUST allow per-repository configuration.

#### Scenario: Configure review mode

- GIVEN a logged-in user with repository "owner/repo" installed
- WHEN the user navigates to Settings and selects the repository
- THEN the user MUST be able to configure:
  - Review mode (simple, workflow, consensus)
  - LLM provider (anthropic, openai, google)
  - LLM model (list filtered by provider)
  - Enable/disable static analysis tools (Semgrep, Trivy, CPD)
  - Enable/disable memory
  - Custom review rules (free text)
  - File ignore patterns (glob patterns)
- AND changes MUST be saved immediately (optimistic update)

#### Scenario: Manage API key

- GIVEN a logged-in user on the Settings page for a repository
- WHEN the user enters an API key and clicks Save
- THEN the key MUST be sent to the server for encrypted storage
- AND the UI MUST show a masked indicator (e.g., "sk-...xxxx") confirming the key is saved
- AND the UI MUST provide a "Remove key" action

### Requirement: Memory Browser

The system MUST provide a visual browser for memory sessions and observations.

#### Scenario: Browse sessions

- GIVEN a repository with 10 past review sessions
- WHEN the user navigates to the Memory page
- THEN the system MUST display a sidebar with session entries (date, PR number, summary preview)
- AND clicking a session MUST show its observations in the main area

#### Scenario: Search observations

- GIVEN a repository with 100 observations
- WHEN the user types a search query in the memory search box
- THEN the system MUST filter observations by the search text
- AND results MUST update with debounced input (300ms delay)

### Requirement: Responsive Layout

The system MUST provide a usable layout on desktop screens.

#### Scenario: Desktop layout

- GIVEN a user on a screen wider than 1024px
- WHEN any page loads
- THEN the layout MUST show a sidebar navigation with page links
- AND the main content area MUST use the remaining width

### Requirement: Deployment on GitHub Pages

The system MUST be deployable as a static site on GitHub Pages.

#### Scenario: SPA routing on GitHub Pages

- GIVEN the dashboard is deployed to GitHub Pages
- WHEN a user refreshes the browser on route /dashboard/reviews
- THEN the system MUST NOT return a 404 error
- AND the system MUST handle client-side routing correctly (via HashRouter or 404.html redirect)

#### Scenario: API URL configuration

- GIVEN the dashboard is built for deployment
- WHEN the build process runs
- THEN the API base URL MUST be configurable via environment variable (VITE_API_URL)
- AND the built assets MUST be served from the correct base path
