# API Reference

The GHAGGA server exposes a REST API for the dashboard and external integrations.

## Authentication

All API endpoints (except health and webhook) require a GitHub Personal Access Token in the `Authorization` header:

```
Authorization: Bearer ghp_xxxxxxxxxxxx
```

The token is validated against the GitHub API to verify the user's identity and installation access.

## Endpoints

### Health Check

```
GET /health
```

Returns server status. No authentication required.

**Response**: `200 OK`
```json
{ "status": "ok" }
```

### GitHub Webhook

```
POST /webhook/github
```

Receives GitHub webhook events. Validated via HMAC-SHA256 signature.

**Headers**:
- `X-Hub-Signature-256`: HMAC signature
- `X-GitHub-Event`: Event type (e.g., `pull_request`)

**Response**: `200 OK` (event queued for processing)

### List Repositories

```
GET /api/repos
```

Returns repositories accessible to the authenticated user's GitHub installation.

**Response**: `200 OK`
```json
[
  {
    "id": 1,
    "githubRepoId": 12345,
    "fullName": "owner/repo",
    "isActive": true,
    "reviewMode": "simple",
    "llmProvider": "anthropic"
  }
]
```

### Get Repository Settings

```
GET /api/repos/:repoId/settings
```

Returns configuration for a specific repository.

### Update Repository Settings

```
PUT /api/repos/:repoId/settings
```

Updates repository configuration (provider, model, mode, tools, ignore patterns).

**Body**:
```json
{
  "reviewMode": "workflow",
  "llmProvider": "openai",
  "llmModel": "gpt-4o",
  "settings": {
    "enableSemgrep": true,
    "enableTrivy": true,
    "enableCpd": false,
    "ignorePatterns": ["*.test.ts"]
  }
}
```

### Save Encrypted API Key

```
PUT /api/repos/:repoId/api-key
```

Encrypts and stores the user's LLM API key with AES-256-GCM.

**Body**:
```json
{
  "apiKey": "sk-ant-api03-..."
}
```

### List Reviews

```
GET /api/repos/:repoId/reviews
```

Returns review history for a repository with pagination.

**Query Parameters**:
- `page` (default: 1)
- `limit` (default: 20)
- `status` (filter by: `PASSED`, `FAILED`, `NEEDS_HUMAN_REVIEW`, `SKIPPED`)

### Get Review Detail

```
GET /api/repos/:repoId/reviews/:reviewId
```

Returns full review details including all findings.

### Memory Search

```
GET /api/repos/:repoId/memory
```

Searches project memory using full-text search.

**Query Parameters**:
- `q` — Search query (full-text search)
- `type` — Filter by observation type

### Memory Sessions

```
GET /api/repos/:repoId/memory/sessions
```

Returns memory sessions (one per review) for the repository.

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

| Status | Code | Description |
|--------|------|-------------|
| 401 | `UNAUTHORIZED` | Missing or invalid authentication token |
| 403 | `FORBIDDEN` | User doesn't have access to this resource |
| 404 | `NOT_FOUND` | Resource not found |
| 422 | `VALIDATION_ERROR` | Invalid request body |
| 500 | `INTERNAL_ERROR` | Server error |

## Inngest Integration

The server exposes an Inngest endpoint at `/api/inngest` for durable function execution. This is an internal endpoint used by the Inngest platform — not for direct client access.
