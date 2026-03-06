# Tasks: Stateless Callback Secret Verification

## Phase 1: Core HMAC Functions

- [x] 1.1 Add `deriveCallbackSecret(callbackId: string): string` to `apps/server/src/github/runner.ts`. The function reads `process.env.STATE_SECRET`, throws if undefined (CC1), and returns `createHmac('sha256', STATE_SECRET).update(callbackId).digest('hex')`. Place it immediately after the `CALLBACK_SECRET_TTL_MS` constant (line 108), which is retained. **(R1, CC1)**

- [x] 1.2 Add `verifyCallbackSignature(callbackId: string, payload: string, signatureHeader: string): boolean` to `apps/server/src/github/runner.ts`. Implements the 6-step verification sequence from spec R4: extract timestamp from last `.` in callbackId, check TTL, derive secret via `deriveCallbackSecret`, validate `sha256=` prefix, compute expected HMAC, compare with `timingSafeEqual`. Wraps Buffer operations in try/catch to handle invalid hex without throwing (R4.7). Logs warnings on expiry and verification failure. **(R3, R4)**

## Phase 2: Refactor `dispatchWorkflow`

- [x] 2.1 Modify `callbackId` generation in `dispatchWorkflow()` (`apps/server/src/github/runner.ts`, line 321). Change from `randomUUID()` to `` `${randomUUID()}.${Date.now().toString(36)}` `` to embed the creation timestamp. **(R2)**

- [x] 2.2 Replace secret generation in `dispatchWorkflow()` (`apps/server/src/github/runner.ts`, lines 322-325). Change `const callbackSecret = randomBytes(32).toString('hex')` to `const callbackSecret = deriveCallbackSecret(callbackId)`. Remove the `storeCallbackSecret(callbackId, callbackSecret)` call. Remove the `secretStore.delete(callbackId)` in the error path (line 364) — no cleanup needed since there is no in-memory state. **(R5, R8)**

## Phase 3: Refactor `runner-callback.ts`

- [x] 3.1 Update import in `apps/server/src/routes/runner-callback.ts` (line 22): change `verifyAndConsumeSecret` to `verifyCallbackSignature`. Update the call site (line 67) from `verifyAndConsumeSecret(callbackId, rawBody, signature)` to `verifyCallbackSignature(callbackId, rawBody, signature)`. The function signature and argument semantics are identical — no other route logic changes needed. **(CC2)**

## Phase 4: Tests

- [x] 4.1 Rewrite `apps/server/src/github/runner.test.ts` Group 1 ("storeCallbackSecret / verifyAndConsumeSecret" block, lines 63-325). Replace with a new test group for `deriveCallbackSecret` and `verifyCallbackSignature`. Set `process.env.STATE_SECRET` in `beforeEach`, clean up in `afterEach`. Cover spec scenarios: deterministic output (S-R1.1), different IDs produce different secrets (S-R1.2), different STATE_SECRETs produce different secrets (S-R1.3), 64-char hex output format. **(R1)**

- [x] 4.2 Add TTL enforcement tests to `apps/server/src/github/runner.test.ts`. Use `vi.useFakeTimers()` to control `Date.now()`. Cover: callback within TTL accepted (S-R3.1), callback at exactly 11 minutes rejected (S-R3.2), callback at 11 min minus 1ms accepted (S-R3.3), callback older than 11 min rejected (S-R3.4). **(R3)**

- [x] 4.3 Add HMAC verification tests to `apps/server/src/github/runner.test.ts`. Cover: valid callbackId + valid signature returns true (S-R4.1), tampered callbackId rejected (S-R4.2), tampered signature rejected (S-R4.3), missing `sha256=` prefix rejected (S-R4.4), callbackId without dot rejected (S-R4.5), wrong-length hex rejected (S-R4.6), invalid hex does not throw (S-R4.7). **(R4, R7)**

- [x] 4.4 Add STATE_SECRET-undefined tests to `apps/server/src/github/runner.test.ts`. Cover: `deriveCallbackSecret` throws when `STATE_SECRET` is undefined (S-CC1.1), `verifyCallbackSignature` throws or returns false when undefined (S-CC1.2). **(CC1)**

- [x] 4.5 Update `apps/server/src/github/runner.test.ts` Group 4 ("dispatchWorkflow" tests). Change the `callbackId` format assertion (line 640-642) from UUID-only regex to the `{uuid}.{timestamp_base36}` pattern. Update `callbackSecret` assertions to verify it equals `HMAC-SHA256(STATE_SECRET, callbackId)`. Remove assertions about `secretStore.delete` cleanup on failure — verify instead that no in-memory state is involved. Set `process.env.STATE_SECRET` in `beforeEach`. **(R2, R5, R8)**

- [x] 4.6 Update `apps/server/src/routes/runner-callback.test.ts`. Rename the mock from `mockVerifyAndConsumeSecret` to `mockVerifyCallbackSignature` (lines 13, 17, and all references throughout). Update the `vi.mock('../github/runner.js')` factory to export `verifyCallbackSignature` instead of `verifyAndConsumeSecret`. All test behavior is otherwise identical — the mock returns the same boolean. **(CC2)**

## Phase 5: Cleanup

- [x] 5.1 Remove all in-memory store code from `apps/server/src/github/runner.ts`: delete `StoredSecret` interface (lines 110-113), `secretStore` Map (line 115), `cleanupInterval` setInterval (lines 118-125), `cleanupInterval.unref()` (line 128), `storeCallbackSecret()` function (lines 130-138), `verifyAndConsumeSecret()` function (lines 140-197). Remove these from the module's `export` surface. **(R8, CC2)**

- [x] 5.2 Update imports in `apps/server/src/github/runner.ts` (lines 13-14): remove `randomBytes` from the `node:crypto` import (no longer needed — `randomUUID` is retained for callbackId UUID portion). Verify `createHmac` and `timingSafeEqual` remain imported. **(CC2)**
