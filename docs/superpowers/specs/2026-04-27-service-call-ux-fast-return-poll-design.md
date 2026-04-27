# Service Call UX: Fast Return + CLI Poll Design

**Date:** 2026-04-27
**Status:** Draft
**Scope:** `services.call` and `master.ask` caller-side UX

## Context

When a user calls a remote service via `metabot services call`, the current flow blocks for 15 seconds (`DEFAULT_CALLER_FOREGROUND_WAIT_MS`) waiting for the provider to reply. If the provider does not respond in time, the CLI returns a `waiting` state with no progress URL and no guidance on where to track the request. The user must manually construct a trace URL or run `metabot trace get`.

By contrast, `buzz post` and `chat private` both return a `localUiUrl` field that the host agent can present as a clickable link.

The same 15-second blocking pattern exists in `master.ask`.

**Problems:**
1. 15-second foreground wait is too short for most real provider interactions.
2. No `localUiUrl` in the response — unlike buzz and chat.
3. No progress feedback during the wait — the user sees nothing.
4. On timeout, no actionable guidance on how to track the request.

**Goal:** Make service calls and master asks feel responsive and trackable. The user should see immediate acknowledgment, real-time progress in the CLI session, and always have a trace URL to inspect the full interaction.

## Design

### Approach: Fast Return + CLI Poll

Instead of blocking the daemon HTTP response for N seconds, the daemon returns immediately after the order is written to chain. The CLI then polls the trace API for progress updates, showing status changes in real time.

### 1. `CommandWaiting` Type Extension

**File:** `src/core/contracts/commandResult.ts`

Add `localUiUrl` and `data` fields to `CommandWaiting`:

```typescript
type CommandWaiting<T = unknown> = CommandBase & {
  ok: false;
  state: 'waiting';
  pollAfterMs: number;
  localUiUrl?: string;
  data?: T;
};
```

Update `commandWaiting()` factory to accept optional `localUiUrl` and `data`.

This is backward-compatible: existing consumers that ignore these fields continue to work.

### 2. Daemon `services.call` Handler Refactor

**File:** `src/daemon/defaultHandlers.ts` (services.call handler, ~line 5768)

**Current flow:**
```
validate → discover → plan → confirm → pay → send order
→ awaitServiceReply(15s) → return success/waiting
```

**New flow:**
```
validate → discover → plan → confirm → pay → send order
→ scheduleCallerReplyContinuation(background, 30min)
→ return commandWaiting with traceId + localUiUrl + session
```

Changes:
- Remove the inline `callerReplyWaiter.awaitServiceReply()` call (the 15s foreground wait).
- Call `scheduleCallerReplyContinuation()` immediately after sending the order.
- Return `commandWaiting(...)` instead of `commandSuccess(...)`, containing:
  - `code: 'order_sent_awaiting_provider'`
  - `message: 'Order sent to provider. Waiting for response...'`
  - `pollAfterMs: 3000`
  - `localUiUrl`: trace page URL built via `buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId })`
  - `data`: `{ traceId, providerGlobalMetaId, serviceName, session, orderPinId, paymentTxid, traceJsonPath, traceMarkdownPath, transcriptMarkdownPath }`

The background continuation (`scheduleCallerReplyContinuation`) continues to run for up to 30 minutes, updating the session/trace when the provider replies. This is the existing mechanism — it just runs from the start now instead of only on foreground timeout.

**Delete constant:** `DEFAULT_CALLER_FOREGROUND_WAIT_MS` (no longer used).

### 3. Daemon `master.ask` Handler Refactor

**File:** `src/daemon/defaultHandlers.ts` (master.ask handler, ~line 4700)

Apply the same pattern: remove the 15s foreground wait, schedule background continuation immediately, return `commandWaiting` with trace URL.

### 4. CLI `services call` Poll Loop

**File:** `src/cli/commands/services.ts`

After receiving a `waiting` response from the daemon, the CLI enters a poll loop:

```
1. Print initial status:
   "Request sent to provider. Waiting for response..."
   "Track progress: {localUiUrl}"

2. Poll loop (up to CLI_POLL_TIMEOUT_MS = 300,000ms / 5 minutes):
   - GET /api/trace/{traceId}
   - Extract publicStatus from trace response
   - On status change: print update (e.g., "Provider accepted the request...")
   - If publicStatus === 'completed':
     - Print provider response text
     - Print trace URL
     - Return commandSuccess with full data
   - Sleep CLI_POLL_INTERVAL_MS (3,000ms) between polls

3. On timeout (5 minutes):
   - Print: "Provider has not responded yet."
   - Print: "Continue tracking: {localUiUrl}"
   - Return the waiting result as-is
```

**New constants (in CLI):**
- `CLI_POLL_TIMEOUT_MS = 300_000` (5 minutes)
- `CLI_POLL_INTERVAL_MS = 3_000` (3 seconds)

**Implementation notes:**
- The poll loop needs access to the daemon HTTP client. The `services.call` handler in `runtime.ts` already has `requestJson`. Add a `requestJsonGet` or reuse `requestJson` with GET for `/api/trace/{traceId}`.
- CLI output during polling should go to `context.stderr` (or a dedicated progress stream) so that the final JSON result on `context.stdout` remains machine-parseable.
- If `--json` flag is passed (or when called by a host agent), skip the human-friendly progress messages and only output the final JSON result. The host agent sees the `waiting` state, reads `localUiUrl`, and can present it to the user.

### 5. CLI `master ask` Poll Loop

**File:** `src/cli/commands/master.ts`

Same pattern as services call. Extract the poll loop into a shared helper to avoid duplication.

### 6. Shared Poll Helper

**File:** `src/cli/commands/pollTraceHelper.ts` (new)

```typescript
export async function pollTraceUntilComplete(input: {
  traceId: string;
  localUiUrl: string;
  requestFn: (method: string, path: string) => Promise<unknown>;
  stderr: NodeJS.WritableStream;
  timeoutMs?: number;   // default 300_000
  intervalMs?: number;  // default 3_000
}): Promise<{ completed: boolean; trace?: unknown }>
```

Used by both `services call` and `master ask`.

### 7. Return Value Enhancement for Success

When the poll detects completion, the CLI makes one final `GET /api/trace/{traceId}` to get the full trace data and returns a `commandSuccess` with:
- All existing fields (traceId, session, payment, etc.)
- `localUiUrl` — trace page URL
- `responseText` — provider's reply (extracted from trace)

When the daemon's `services.call` returns `commandSuccess` directly (e.g., for local provider calls where `request.providerDaemonBaseUrl` is set), the response should also include `localUiUrl`. Add `buildDaemonLocalUiUrl(...)` to the existing `commandSuccess` return at ~line 6117.

## Files Changed

| File | Change |
|---|---|
| `src/core/contracts/commandResult.ts` | Add `localUiUrl` and `data` to `CommandWaiting` |
| `src/daemon/defaultHandlers.ts` | Refactor `services.call` and `master.ask`: remove foreground wait, return `commandWaiting` with URL |
| `src/cli/commands/services.ts` | Add poll loop after `waiting` response |
| `src/cli/commands/master.ts` | Add poll loop after `waiting` response |
| `src/cli/commands/pollTraceHelper.ts` | New: shared poll-until-complete helper |
| `src/cli/runtime.ts` | Expose GET request capability for trace polling |

## Constants

| Constant | Location | Value | Purpose |
|---|---|---|---|
| `DEFAULT_CALLER_FOREGROUND_WAIT_MS` | defaultHandlers.ts | **DELETED** | No longer needed |
| `DEFAULT_CALLER_BACKGROUND_WAIT_MS` | defaultHandlers.ts | 1,800,000 (unchanged) | Background continuation timeout |
| `CLI_POLL_TIMEOUT_MS` | pollTraceHelper.ts | 300,000 (5 min) | CLI-side poll timeout |
| `CLI_POLL_INTERVAL_MS` | pollTraceHelper.ts | 3,000 (3 sec) | CLI-side poll interval |

## Backward Compatibility

- **Host agents reading JSON output:** The `waiting` state now includes `localUiUrl` and `data` — both are additive. Agents that only check `state === 'waiting'` continue to work. Agents that understand `localUiUrl` can present it.
- **Daemon API:** The `/api/trace/{traceId}` endpoint is unchanged.
- **MetabotCommandResult generic:** `CommandWaiting` gains a type parameter `T` for `data`, defaulting to `unknown`. Existing code that uses `MetabotCommandResult<X>` is unaffected because `CommandWaiting` was already part of the union with `ok: false`.

## Verification

1. **Build:** `npm run build` — must pass with no type errors.
2. **Unit tests:** `npm run test` — all existing tests must pass.
3. **Manual test — services call:**
   - Run `metabot services call --request-file <file>` against a known online provider.
   - Verify: immediate response with trace URL, poll progress in terminal, final result with `responseText` and `localUiUrl`.
4. **Manual test — master ask:**
   - Run `metabot master ask --request-file <file>`.
   - Verify: same fast-return + poll behavior.
5. **Manual test — timeout:**
   - Call an offline or slow provider.
   - Verify: after 5 minutes, CLI prints timeout message with trace URL.
6. **Machine-readable output:**
   - Verify that the final JSON on stdout is valid and includes `localUiUrl`.
   - Verify that progress messages go to stderr, not stdout.
7. **Trace page:**
   - Open the returned `localUiUrl` in a browser.
   - Verify the trace inspector shows session events.
