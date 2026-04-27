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

Add `localUiUrl` and `data` fields to `CommandWaiting`. Keep it non-generic — use `Record<string, unknown>` for `data` to avoid confusing it with the `T` in `CommandSuccess<T>`:

```typescript
type CommandWaiting = CommandBase & {
  ok: false;
  state: 'waiting';
  pollAfterMs: number;
  localUiUrl?: string;
  data?: Record<string, unknown>;
};
```

Update `commandWaiting()` factory signature:

```typescript
export const commandWaiting = (
  code: string,
  message: string,
  pollAfterMs: number,
  options?: { localUiUrl?: string; data?: Record<string, unknown> },
): MetabotCommandResult<never> => ({
  ok: false,
  state: 'waiting',
  code,
  message,
  pollAfterMs,
  ...(options?.localUiUrl ? { localUiUrl: options.localUiUrl } : {}),
  ...(options?.data ? { data: options.data } : {}),
});
```

This is backward-compatible: existing callers pass only 3 args and existing consumers that ignore these fields continue to work.

### 2. Daemon `services.call` Handler Refactor

**File:** `src/daemon/defaultHandlers.ts` (services.call handler starts ~line 5768, foreground wait at ~line 6059, return at ~line 6117)

**Current flow:**
```
validate → discover → plan → confirm → pay → send order
→ awaitServiceReply(15s) [line 6059] → return success/waiting
```

**New flow:**
```
validate → discover → plan → confirm → pay → send order
→ scheduleCallerReplyContinuation(background, 30min) [line 6101]
→ return commandWaiting with traceId + localUiUrl + session
```

Changes:
- Remove the inline `callerReplyWaiter.awaitServiceReply()` call at line 6059 (the 15s foreground wait) and the entire `if (reply.state === 'completed')` / `else if (reply.state === 'timeout')` block (lines 6059–6114).
- Call `scheduleCallerReplyContinuation()` immediately after sending the order (move it out of the timeout branch).
- Return `commandWaiting(...)` instead of `commandSuccess(...)`, containing:
  - `code: 'order_sent_awaiting_provider'`
  - `message: 'Order sent to provider. Waiting for response...'`
  - `pollAfterMs: 3000`
  - `localUiUrl`: trace page URL built via `buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId })`
  - `data`: `{ traceId, providerGlobalMetaId, serviceName, session, orderPinId, paymentTxid, traceJsonPath, traceMarkdownPath, transcriptMarkdownPath }`

**Exception:** When `request.providerDaemonBaseUrl` is set (local provider call, line 6054), the handler bypasses the foreground wait already. This path should continue to return `commandSuccess` synchronously, but add `localUiUrl` to its return data.

The background continuation (`scheduleCallerReplyContinuation`) continues to run for up to 30 minutes, updating the session/trace when the provider replies. This is the existing mechanism — it just runs from the start now instead of only on foreground timeout.

**Delete constant:** `DEFAULT_CALLER_FOREGROUND_WAIT_MS` (no longer used by any call site — see Section 3 for the other sites).

### 3. Daemon `master.ask` Handler Refactor

**File:** `src/daemon/defaultHandlers.ts`

There are **two** foreground wait sites in master flows that both use `DEFAULT_CALLER_FOREGROUND_WAIT_MS`:

1. **`master.ask` main flow** (~line 4702): The primary ask path where the user sends a new master request.
2. **`master.ask --confirm` flow** (~line 3565): The confirmation/re-ask path where a pending ask is sent after user confirmation.

Both must be refactored to:
- Remove the foreground `awaitMasterReply()` call.
- Call `scheduleMasterReplyContinuation()` immediately.
- Return `commandWaiting` with trace URL and request data.

The `master.ask --confirm` flow only reaches the foreground wait after the user has already confirmed. The fast-return pattern applies to this confirmation step — the initial suggestion step (which returns `awaiting_confirmation`) is unaffected.

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
- The poll loop needs access to the daemon HTTP client. `requestJson` in `runtime.ts` (line 773) already supports `'GET'` as a method parameter — no new function needed.
- CLI progress output goes to `context.stderr.write(...)` so the final JSON on `context.stdout` stays machine-parseable. The CLI `stderr` field (`Pick<NodeJS.WriteStream, 'write'>`) is sufficient for `.write()` calls.
- **Host agent detection:** When called by a host agent (Codex, Claude Code, etc.), the CLI should skip the poll loop and return the `commandWaiting` result immediately. The host agent sees `localUiUrl` in the JSON and can present it. Detection: check if `context.stdout` is a TTY via `process.stdout.isTTY`. If not a TTY (piped output), skip polling and return the waiting result directly.

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
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  timeoutMs?: number;   // default 300_000
  intervalMs?: number;  // default 3_000
}): Promise<{ completed: boolean; trace?: unknown }>
```

Used by both `services call` and `master ask`.

**Trace response shape:** The `GET /api/trace/{traceId}` endpoint returns `commandSuccess(buildTraceInspectorPayload(...))`. The poll helper extracts `publicStatus` from `result.data.sessions` (array of session objects, each with a `publicStatus` field). The trace is considered complete when the first session's `publicStatus === 'completed'`. The `responseText` is extracted from `result.data.sessions[0].transcript` or the trace's structured response fields.

**Error handling:** On HTTP error (4xx/5xx) or network failure from the trace endpoint:
- 404 (trace not found): Retry up to 3 times (trace may not be persisted yet), then abort with error message.
- Network/connection error: Retry silently (daemon may be temporarily busy).
- Other errors: Log to stderr and continue polling.

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
| `src/cli/runtime.ts` | Expose trace poll dependency (reuse existing `requestJson` with GET) |

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
- **MetabotCommandResult union:** `CommandWaiting` remains non-generic (uses `Record<string, unknown>` for `data`). The union type `MetabotCommandResult<T>` is unchanged structurally.

## Verification

1. **Build:** `npm run build` — must pass with no type errors.
2. **Unit tests:** `npm run test` — all existing tests must pass. Tests that reference `DEFAULT_CALLER_FOREGROUND_WAIT_MS` or mock the foreground wait behavior will need updating.
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
