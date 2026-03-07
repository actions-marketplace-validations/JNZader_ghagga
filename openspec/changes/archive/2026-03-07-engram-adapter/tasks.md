# Tasks: Engram Memory Adapter

## Phase 1: Foundation — HTTP Client & Types

- [ ] 1.1 Create `packages/core/src/memory/engram.ts` with internal Engram API response types (`EngramObservation`, `EngramStats`, `EngramSession`) and the `EngramOptions` interface as defined in the design
- [ ] 1.2 Implement the `EngramClient` private class in the same file: `get<T>()`, `post<T>()`, `delete()`, `isHealthy()` methods wrapping native `fetch()` with configurable timeout (`AbortController`), base URL prefixing, JSON parsing, and error-to-null handling
- [ ] 1.3 Implement schema mapping functions in the same file: `toEngramPayload()` (GHAGGA → Engram, JSON-structured content with `source: "ghagga"`) and `fromEngramObservation()` / `fromEngramObservationDetail()` (Engram → GHAGGA, with JSON parse fallback for non-GHAGGA content)

## Phase 2: Core — EngramMemoryStorage Class

- [ ] 2.1 Implement `EngramMemoryStorage` class skeleton: constructor (private, takes `baseUrl`, `EngramClient`, session ID map, observation ID map), and `static async create(options: EngramOptions): Promise<MemoryStorage>` with health check → fallback logic (R26 scenarios)
- [ ] 2.2 Implement `searchObservations(project, query, options?)`: call `GET /api/search`, client-side filter by `project` and optional `type`, map results via `fromEngramObservation()`, populate observation ID map. Return `[]` on error (R27.1)
- [ ] 2.3 Implement `saveObservation(data)`: call `POST /api/save` with `toEngramPayload()`, map response to `MemoryObservationRow`. Return synthetic row with `id: -1` on error (R27.2)
- [ ] 2.4 Implement `createSession(data)` and `endSession(sessionId, summary)`: POST to `/api/sessions` and `/api/sessions/:id/summary`. Bridge Engram UUID ↔ synthetic integer via internal `Map<number, string>`. No-op for `sessionId === -1` (R27.3, R27.4)
- [ ] 2.5 Implement remaining methods: `getObservation(id)` → `GET /api/observations/:id` (lookup UUID from map); `deleteObservation(id)` → `DELETE /api/observations/:id`; `listObservations(options?)` → `GET /api/search` with client-side project/type/pagination filter; `getStats()` → `GET /api/stats` mapped to `MemoryStats`; `clearObservations()` → throw descriptive error; `close()` → no-op (R27.5–R27.10)

## Phase 3: CLI Integration

- [ ] 3.1 Add `memoryBackend?: string` to `ReviewCommandOptions` in `apps/cli/src/index.ts`. Add `.option('--memory-backend <type>', 'Memory backend: sqlite (default) or engram')` to the review command definition
- [ ] 3.2 Modify `apps/cli/src/commands/review.ts`: import `EngramMemoryStorage` from `ghagga-core`. Replace the hardcoded `SqliteMemoryStorage.create()` block (lines 155-164) with backend selection logic reading `opts.memoryBackend || process.env.GHAGGA_MEMORY_BACKEND || 'sqlite'`. Validate backend value, error on invalid. Read `GHAGGA_ENGRAM_HOST` and `GHAGGA_ENGRAM_TIMEOUT` env vars (R6.6, R6.7, R6.8)
- [ ] 3.3 Add `export { EngramMemoryStorage } from './memory/engram.js';` to the Memory section of `packages/core/src/index.ts` (after line 78)

## Phase 4: Testing

- [ ] 4.1 Create `packages/core/src/memory/engram.test.ts`: unit tests for `EngramClient` — mock `global.fetch` via `vi.stubGlobal`. Test URL construction, timeout via `AbortController`, JSON parsing, error-to-null paths, `isHealthy()` true/false
- [ ] 4.2 Add tests for schema mapping: `toEngramPayload()` with all fields, with optional fields omitted; `fromEngramObservation()` with GHAGGA-structured JSON content, plain text content (non-GHAGGA), and malformed JSON content. Verify round-trip fidelity (R28 scenarios)
- [ ] 4.3 Add tests for `EngramMemoryStorage.create()`: healthy Engram returns adapter instance; unreachable Engram + `fallbackToSqlite: true` returns `SqliteMemoryStorage`; unreachable + `fallbackToSqlite: false` returns `undefined`; non-200 health check triggers fallback (R26 scenarios)
- [ ] 4.4 Add tests for all `MemoryStorage` interface methods on `EngramMemoryStorage`: mock `EngramClient`, verify each method calls the correct endpoint, maps responses correctly, and returns safe defaults on HTTP errors (R27, R29 scenarios). Include session ID bridging and observation ID map tests
- [ ] 4.5 Add test for `clearObservations()` throwing the expected error message. Add test for `close()` being a no-op

## Phase 5: Verification

- [ ] 5.1 Run full test suite (`pnpm test`) — confirm zero regressions in existing tests and all new Engram tests pass
- [ ] 5.2 Run `pnpm build` — confirm `EngramMemoryStorage` export compiles and the CLI builds cleanly with no type errors
