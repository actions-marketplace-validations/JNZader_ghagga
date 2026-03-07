# Spec: reviews-by-day

**Change**: Implement `reviewsByDay` daily aggregation in `/api/stats`
**Date**: 2026-03-07

## Requirements

### R1: reviewsByDay Query

The system MUST provide a `getReviewsByDay` query function that:
- Queries the `reviews` table grouped by `DATE(created_at)`
- Returns entries for the last 30 days only
- Filters by `repository_id`
- Returns shape: `{ date: string (YYYY-MM-DD), total: number, passed: number, failed: number }`
- Results MUST be sorted by date ascending (oldest first)
- Days with zero reviews SHOULD be omitted (sparse array)

### R2: API Response Integration

The `GET /api/stats` endpoint MUST:
- Call `getReviewsByDay` with the resolved `repo.id`
- Return the result as `reviewsByDay` in the response data
- NOT modify any other fields in the stats response
- Match the dashboard's `DayStats` type exactly

### R3: Tests

Tests MUST cover:
- Returns correct `reviewsByDay` data when reviews exist
- Returns empty array when no reviews exist for the repo
- Multiple reviews on the same day produce `count > 1`
- Results are sorted ascending by date
- Status breakdown (passed/failed) is correct

## Scenarios

### S1: Repository with reviews in last 30 days

**Given** a repository with reviews on 2026-02-10 (2 PASSED, 1 FAILED) and 2026-02-12 (1 PASSED)
**When** `GET /api/stats?repo=owner/repo` is called
**Then** `reviewsByDay` contains:
```json
[
  { "date": "2026-02-10", "total": 3, "passed": 2, "failed": 1 },
  { "date": "2026-02-12", "total": 1, "passed": 1, "failed": 0 }
]
```

### S2: Repository with no reviews

**Given** a repository with zero reviews
**When** `GET /api/stats?repo=owner/repo` is called
**Then** `reviewsByDay` is `[]`

### S3: Reviews older than 30 days excluded

**Given** a repository with reviews only from 60 days ago
**When** `GET /api/stats?repo=owner/repo` is called
**Then** `reviewsByDay` is `[]`

### S4: Multiple reviews same day

**Given** 5 reviews on the same day (3 PASSED, 1 FAILED, 1 SKIPPED)
**When** `GET /api/stats?repo=owner/repo` is called
**Then** the day entry shows `total: 5, passed: 3, failed: 1`

### S5: Ordering

**Given** reviews on dates 2026-03-05, 2026-03-01, 2026-03-03
**When** `GET /api/stats?repo=owner/repo` is called
**Then** `reviewsByDay` is ordered: 2026-03-01, 2026-03-03, 2026-03-05
