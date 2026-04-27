# Service Call UX: Fast Return + CLI Poll — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `services.call` and `master.ask` return immediately with a trace URL, then let the CLI poll for completion — so users see progress and always have a link to track their request.

**Architecture:** Daemon sends order then immediately returns `commandWaiting` with `traceId` + `localUiUrl`. CLI detects `waiting` state, prints progress, and polls `GET /api/trace/{traceId}` for up to 5 minutes. Background continuation handles late provider replies (unchanged).

**Tech Stack:** TypeScript, Node.js native test runner, existing daemon HTTP server + CLI runtime.

**Spec:** `docs/superpowers/specs/2026-04-27-service-call-ux-fast-return-poll-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/contracts/commandResult.ts` | Add `localUiUrl` + `data` to `CommandWaiting` type and factory |
| `src/cli/commands/pollTraceHelper.ts` | **NEW** — shared poll loop used by `services call` and `master ask` |
| `src/cli/commands/services.ts` | Wire poll loop into `call` subcommand |
| `src/cli/commands/master.ts` | Wire poll loop into `ask` subcommand |
| `src/daemon/defaultHandlers.ts` | Remove 3 foreground wait sites, return `commandWaiting` with URL |
| `src/cli/runtime.ts` | Already has `trace.get` wired — no changes needed |
| `tests/contracts/commandResult.test.mjs` | Update existing test + add new test for extended `commandWaiting` |
| `tests/cli/pollTraceHelper.test.mjs` | **NEW** — unit tests for poll loop |

---

### Task 1: Extend `CommandWaiting` type and factory

**Files:**
- Modify: `src/core/contracts/commandResult.ts`
- Modify: `tests/contracts/commandResult.test.mjs`

- [ ] **Step 1: Write failing test for extended `commandWaiting`**

In `tests/contracts/commandResult.test.mjs`, add a new test after the existing `commandWaiting` test:

```javascript
test('waiting can carry localUiUrl and data', () => {
  const result = commandWaiting('ORDER_SENT', 'waiting for provider', 3000, {
    localUiUrl: 'http://127.0.0.1:5555/ui/trace?traceId=t1',
    data: { traceId: 't1', serviceName: 'test-service' },
  });
  assert.equal(result.ok, false);
  assert.equal(result.state, 'waiting');
  assert.equal(result.pollAfterMs, 3000);
  assert.equal(result.localUiUrl, 'http://127.0.0.1:5555/ui/trace?traceId=t1');
  assert.deepEqual(result.data, { traceId: 't1', serviceName: 'test-service' });
});

test('waiting without options omits localUiUrl and data', () => {
  const result = commandWaiting('SOME_CODE', 'msg', 1000);
  assert.equal(result.localUiUrl, undefined);
  assert.equal(result.data, undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/contracts/commandResult.test.mjs`
Expected: FAIL — `commandWaiting` does not accept 4th argument, `result.localUiUrl` is undefined.

- [ ] **Step 3: Update `CommandWaiting` type and factory**

In `src/core/contracts/commandResult.ts`, change the `CommandWaiting` type (line 21-25):

```typescript
type CommandWaiting = CommandBase & {
  ok: false;
  state: 'waiting';
  pollAfterMs: number;
  localUiUrl?: string;
  data?: Record<string, unknown>;
};
```

Update the `commandWaiting` factory (line 57-63):

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/contracts/commandResult.test.mjs`
Expected: ALL PASS (including existing 3-arg test at line 20-27, which still works because 4th arg is optional).

- [ ] **Step 5: Commit**

```bash
git add src/core/contracts/commandResult.ts tests/contracts/commandResult.test.mjs
git commit -m "feat: extend CommandWaiting with localUiUrl and data fields"
```

---

### Task 2: Create shared poll trace helper

**Files:**
- Create: `src/cli/commands/pollTraceHelper.ts`
- Create: `tests/cli/pollTraceHelper.test.mjs`

- [ ] **Step 1: Write failing tests for poll helper**

Create `tests/cli/pollTraceHelper.test.mjs`:

```javascript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pollTraceUntilComplete } = require('../../dist/cli/commands/pollTraceHelper.js');

function createMockStderr() {
  const lines = [];
  return {
    write(text) { lines.push(text); return true; },
    lines,
  };
}

test('returns completed when trace shows completed on first poll', async () => {
  const stderr = createMockStderr();
  const result = await pollTraceUntilComplete({
    traceId: 'trace-1',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-1',
    requestFn: async (_method, _path) => ({
      ok: true,
      state: 'success',
      data: {
        traceId: 'trace-1',
        sessions: [{ publicStatus: 'completed', responseText: 'done' }],
      },
    }),
    stderr,
    timeoutMs: 5000,
    intervalMs: 100,
  });
  assert.equal(result.completed, true);
  assert.ok(result.trace);
});

test('returns not completed after timeout', async () => {
  const stderr = createMockStderr();
  const result = await pollTraceUntilComplete({
    traceId: 'trace-2',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-2',
    requestFn: async (_method, _path) => ({
      ok: true,
      state: 'success',
      data: {
        traceId: 'trace-2',
        sessions: [{ publicStatus: 'requesting_remote' }],
      },
    }),
    stderr,
    timeoutMs: 300,
    intervalMs: 100,
  });
  assert.equal(result.completed, false);
});

test('prints initial status and trace URL to stderr', async () => {
  const stderr = createMockStderr();
  await pollTraceUntilComplete({
    traceId: 'trace-3',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-3',
    requestFn: async () => ({
      ok: true,
      state: 'success',
      data: { traceId: 'trace-3', sessions: [{ publicStatus: 'completed' }] },
    }),
    stderr,
    timeoutMs: 5000,
    intervalMs: 100,
  });
  const output = stderr.lines.join('');
  assert.ok(output.includes('Waiting for response'), 'should print waiting message');
  assert.ok(output.includes('http://localhost:5555/ui/trace'), 'should print trace URL');
});

test('handles request errors gracefully', async () => {
  const stderr = createMockStderr();
  let callCount = 0;
  const result = await pollTraceUntilComplete({
    traceId: 'trace-err',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-err',
    requestFn: async () => {
      callCount++;
      if (callCount <= 2) throw new Error('connection refused');
      return {
        ok: true,
        state: 'success',
        data: { traceId: 'trace-err', sessions: [{ publicStatus: 'completed' }] },
      };
    },
    stderr,
    timeoutMs: 5000,
    intervalMs: 100,
  });
  assert.equal(result.completed, true);
  assert.ok(callCount >= 3, 'should retry after errors');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/cli/pollTraceHelper.test.mjs`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `pollTraceHelper.ts`**

Create `src/cli/commands/pollTraceHelper.ts`:

```typescript
import type { MetabotCommandResult } from '../../core/contracts/commandResult';

const CLI_POLL_TIMEOUT_MS = 300_000;
const CLI_POLL_INTERVAL_MS = 3_000;

export interface PollTraceInput {
  traceId: string;
  localUiUrl: string;
  requestFn: (method: 'GET' | 'POST' | 'DELETE', path: string) => Promise<MetabotCommandResult<unknown>>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
  timeoutMs?: number;
  intervalMs?: number;
}

export interface PollTraceResult {
  completed: boolean;
  trace?: Record<string, unknown>;
}

function extractPublicStatus(result: unknown): string | null {
  if (
    typeof result === 'object' && result !== null &&
    'ok' in result && (result as { ok: boolean }).ok === true &&
    'data' in result
  ) {
    const data = (result as { data: unknown }).data;
    if (typeof data === 'object' && data !== null && 'sessions' in data) {
      const sessions = (data as { sessions: unknown }).sessions;
      if (Array.isArray(sessions) && sessions.length > 0) {
        const first = sessions[0];
        if (typeof first === 'object' && first !== null && 'publicStatus' in first) {
          return String(first.publicStatus);
        }
      }
    }
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollTraceUntilComplete(input: PollTraceInput): Promise<PollTraceResult> {
  const timeoutMs = input.timeoutMs ?? CLI_POLL_TIMEOUT_MS;
  const intervalMs = input.intervalMs ?? CLI_POLL_INTERVAL_MS;
  const tracePath = `/api/trace/${encodeURIComponent(input.traceId)}`;

  input.stderr.write(`Waiting for response...\n`);
  input.stderr.write(`Track progress: ${input.localUiUrl}\n`);

  const deadline = Date.now() + timeoutMs;
  let lastStatus: string | null = null;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    try {
      const result = await input.requestFn('GET', tracePath);
      consecutiveErrors = 0;

      const status = extractPublicStatus(result);
      if (status && status !== lastStatus) {
        lastStatus = status;
        if (status !== 'requesting_remote') {
          input.stderr.write(`Status: ${status}\n`);
        }
      }

      if (status === 'completed') {
        const data = (result as { data: unknown }).data as Record<string, unknown>;
        input.stderr.write(`Response received. View full trace: ${input.localUiUrl}\n`);
        return { completed: true, trace: data };
      }
    } catch {
      consecutiveErrors++;
      if (consecutiveErrors > 10) {
        input.stderr.write(`Unable to reach daemon. View trace in browser: ${input.localUiUrl}\n`);
        return { completed: false };
      }
    }

    await sleep(intervalMs);
  }

  input.stderr.write(`Provider has not responded yet. Continue tracking: ${input.localUiUrl}\n`);
  return { completed: false };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build && node --test tests/cli/pollTraceHelper.test.mjs`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/pollTraceHelper.ts tests/cli/pollTraceHelper.test.mjs
git commit -m "feat: add shared poll trace helper for CLI progress tracking"
```

---

### Task 3: Wire poll loop into `services call` CLI command

**Files:**
- Modify: `src/cli/commands/services.ts`

**Note:** `trace.get` already exists in `CliDependencies` (`src/cli/types.ts:65-68`) and is wired in `runtime.ts` (~line 1548-1551). No changes needed to types or runtime.

- [ ] **Step 1: Update `services.ts` to use poll loop**

Replace the `call` subcommand handling in `src/cli/commands/services.ts` (lines 28-41):

```typescript
if (subcommand === 'call') {
  const requestFile = readFlagValue(args, '--request-file');
  if (!requestFile) {
    return commandMissingFlag('--request-file');
  }

  const handler = context.dependencies.services?.call;
  if (!handler) {
    return commandFailed('not_implemented', 'Services call handler is not configured.');
  }

  const request = await readJsonFile(context, requestFile);
  const result = await handler(request);

  if (
    result.state === 'waiting' &&
    'data' in result &&
    result.data &&
    typeof result.data === 'object' &&
    'traceId' in result.data &&
    result.localUiUrl &&
    process.stdout.isTTY
  ) {
    const { pollTraceUntilComplete } = await import('./pollTraceHelper');
    const traceGet = context.dependencies.trace?.get;
    if (traceGet) {
      const poll = await pollTraceUntilComplete({
        traceId: String(result.data.traceId),
        localUiUrl: result.localUiUrl,
        requestFn: async (method, path) => {
          const traceId = path.split('/').pop() || '';
          return traceGet({ traceId: decodeURIComponent(traceId) });
        },
        stderr: context.stderr,
      });
      if (poll.completed && poll.trace) {
        const { commandSuccess } = await import('../../core/contracts/commandResult');
        const sessions = Array.isArray(poll.trace.sessions) ? poll.trace.sessions : [];
        const firstSession = sessions[0] as Record<string, unknown> | undefined;
        return commandSuccess({
          ...result.data,
          ...(firstSession?.responseText ? { responseText: firstSession.responseText } : {}),
          localUiUrl: result.localUiUrl,
        });
      }
    }
  }

  return result;
}
```

- [ ] **Step 4: Build and run full test suite**

Run: `npm run build && npm run test`
Expected: ALL PASS. The CLI services command tests should still work because the `waiting` poll path only activates with TTY + specific data shape.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/services.ts
git commit -m "feat: wire poll loop into services call CLI command"
```

---

### Task 4: Wire poll loop into `master ask` CLI command

**Files:**
- Modify: `src/cli/commands/master.ts`

- [ ] **Step 1: Update `master.ts` to use poll loop**

In `src/cli/commands/master.ts`, update the `ask` subcommand (lines 50-81). After `return handler(...)` calls, capture the result and apply the same poll logic. The `ask` subcommand has two return paths (with `--trace-id` at line 59, and with `--request-file` at line 77). Both need wrapping.

Replace the `ask` block:

```typescript
if (subcommand === 'ask') {
  const handler = context.dependencies.master?.ask;
  if (!handler) {
    return commandFailed('not_implemented', 'Master ask handler is not configured.');
  }

  const confirm = hasFlag(args, '--confirm');
  const traceId = readFlagValue(args, '--trace-id');

  let result: MetabotCommandResult<unknown>;
  if (traceId) {
    result = await handler({ traceId, confirm });
  } else {
    const requestFile = readFlagValue(args, '--request-file');
    if (!requestFile) {
      return commandMissingFlag('--request-file');
    }
    if (confirm) {
      return commandFailed(
        'invalid_argument',
        '`metabot master ask --confirm` requires `--trace-id <trace-id>` and cannot be combined with `--request-file`.',
      );
    }
    const payload = await readJsonFile(context, requestFile);
    result = await handler({ ...payload, confirm });
  }

  if (
    result.state === 'waiting' &&
    'data' in result &&
    result.data &&
    typeof result.data === 'object' &&
    'traceId' in result.data &&
    result.localUiUrl &&
    process.stdout.isTTY
  ) {
    const { pollTraceUntilComplete } = await import('./pollTraceHelper');
    const traceGet = context.dependencies.trace?.get;
    if (traceGet) {
      const poll = await pollTraceUntilComplete({
        traceId: String((result.data as Record<string, unknown>).traceId),
        localUiUrl: result.localUiUrl,
        requestFn: async (_method, path) => {
          const id = path.split('/').pop() || '';
          return traceGet({ traceId: decodeURIComponent(id) });
        },
        stderr: context.stderr,
      });
      if (poll.completed && poll.trace) {
        const { commandSuccess } = await import('../../core/contracts/commandResult');
        return commandSuccess({
          ...(result.data as Record<string, unknown>),
          ...(poll.trace.sessions?.[0]?.responseText
            ? { responseText: poll.trace.sessions[0].responseText }
            : {}),
          localUiUrl: result.localUiUrl,
        });
      }
    }
  }

  return result;
}
```

Add the import at the top of the file:

```typescript
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
```

(The existing import already has `type MetabotCommandResult` — verify and add if missing.)

- [ ] **Step 2: Build and run test suite**

Run: `npm run build && npm run test`
Expected: ALL PASS.

- [ ] **Step 3: Commit**

```bash
git add src/cli/commands/master.ts
git commit -m "feat: wire poll loop into master ask CLI command"
```

---

### Task 5: Refactor daemon `services.call` — fast return

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`

- [ ] **Step 1: Add `commandWaiting` to imports**

In `src/daemon/defaultHandlers.ts` line 4-10, add `commandWaiting` to the import:

```typescript
import {
  commandAwaitingConfirmation,
  commandFailed,
  commandManualActionRequired,
  commandSuccess,
  commandWaiting,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
```

- [ ] **Step 2: Refactor the `services.call` foreground wait (lines 6054-6114)**

Replace the block starting at `if (!request.providerDaemonBaseUrl)` (line 6054) through the end of the foreground wait logic (line 6114):

```typescript
        if (!request.providerDaemonBaseUrl) {
          const privateChatIdentity = await signer.getPrivateChatIdentity();
          const peerChatPublicKey = plan.service.providerGlobalMetaId === state.identity.globalMetaId
            ? state.identity.chatPublicKey
            : await resolvePeerChatPublicKey(plan.service.providerGlobalMetaId) ?? '';

          // Schedule background continuation immediately (was previously only on timeout)
          scheduleCallerReplyContinuation({
            trace,
            sessionId: started.session.sessionId,
            waiterInput: {
              callerGlobalMetaId: privateChatIdentity.globalMetaId,
              callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
              providerGlobalMetaId: plan.service.providerGlobalMetaId,
              providerChatPublicKey: peerChatPublicKey,
              servicePinId: plan.service.servicePinId,
              paymentTxid,
              timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
            },
          });

          // Return immediately — CLI will poll trace API for completion
          const daemon = input.getDaemonRecord();
          return commandWaiting(
            'order_sent_awaiting_provider',
            'Order sent to provider. Waiting for response...',
            3000,
            {
              localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId: trace.traceId }),
              data: {
                traceId: trace.traceId,
                providerGlobalMetaId: plan.service.providerGlobalMetaId,
                serviceName: serviceDisplayName,
                service: plan.service,
                payment: plan.payment,
                confirmation: plan.confirmation,
                paymentTxid,
                orderPinId,
                session: {
                  sessionId: started.session.sessionId,
                  taskRunId: started.taskRun.runId,
                  role: started.session.role,
                  state: started.session.state,
                  publicStatus: publicStatus.status,
                  event: started.event,
                  coworkSessionId: started.linkage.coworkSessionId,
                  externalConversationId: started.linkage.externalConversationId,
                },
                traceJsonPath: artifacts.traceJsonPath,
                traceMarkdownPath: artifacts.traceMarkdownPath,
                transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
              },
            },
          );
        }
```

This removes:
- The `callerReplyWaiter.awaitServiceReply()` call (line 6059-6067)
- The `if (reply.state === 'completed')` block (lines 6068-6085)
- The `else if (reply.state === 'timeout')` block (lines 6086-6114)
- The response variable mutations (`responseTrace`, `responseArtifacts`, etc.)

The `commandSuccess` return at line 6117 remains — it now only applies to the local provider path (`request.providerDaemonBaseUrl` is set).

- [ ] **Step 3: Add `localUiUrl` to the local-provider success return**

At line 6117, the existing `commandSuccess` return now only runs for local providers. Add `localUiUrl`:

```typescript
        const daemon = input.getDaemonRecord();
        return commandSuccess({
          traceId: responseTrace.traceId,
          // ... existing fields unchanged ...
          localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId: responseTrace.traceId }),
        });
```

Add `localUiUrl` after `transcriptMarkdownPath` in the existing return object.

- [ ] **Step 4: Clean up unused response variables**

After the refactor, `responseTrace`, `responseArtifacts`, `responseSession`, `responseTaskRun`, `responseEvent`, `responsePublicStatus`, `providerReplyText`, `deliveryPinId` are only used in the local-provider path. If the local-provider path (`request.providerDaemonBaseUrl` is set) doesn't use the foreground wait, these variables can be simplified. Keep them as-is for now — they're still valid for the local-provider return.

- [ ] **Step 5: Build to verify no type errors**

Run: `npm run build`
Expected: PASS with no errors.

- [ ] **Step 6: Run full test suite**

Run: `npm run test`
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add src/daemon/defaultHandlers.ts
git commit -m "feat: services.call returns immediately with trace URL instead of blocking"
```

---

### Task 6: Refactor daemon `master.ask` — fast return (both wait sites)

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`

There are **two** foreground wait sites to refactor.

**Note on `putMasterAutoFeedback`:** The foreground wait blocks contain `putMasterAutoFeedback` calls for `isAutoAsk`/`isAutoPreview` tracking (completed/timed_out status). These are being removed. The background continuation (`scheduleMasterReplyContinuation`) handles the completion case. The `timed_out` feedback is intentionally dropped — the request is no longer considered "timed out" from the daemon's perspective since the background continuation handles it.

- [ ] **Step 1: Refactor master.ask main flow (~line 4693-4771)**

Replace the `if (masterReplyWaiter)` block at line 4693:

```typescript
          if (masterReplyWaiter) {
            const masterWaiterInput = {
              callerGlobalMetaId: privateChatIdentity.globalMetaId,
              callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
              providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
              providerChatPublicKey: peerChatPublicKey,
              masterServicePinId: selectedTarget.masterPinId,
              requestId: pendingAsk.requestId,
              traceId,
              timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
            };

            scheduleMasterReplyContinuation({
              trace: updatedTrace,
              pendingAsk: {
                ...pendingAsk,
                confirmationState: 'sent',
                updatedAt: Date.now(),
                sentAt: Number.isFinite(pendingAsk.sentAt) ? pendingAsk.sentAt : Date.now(),
                messagePinId: messagePinId || null,
              },
              requestPath: outboundRequest.path,
              messagePinId: messagePinId || null,
              waiterInput: masterWaiterInput,
            });

            const daemon = input.getDaemonRecord();
            return commandWaiting(
              'ask_sent_awaiting_master',
              'Request sent to master. Waiting for response...',
              3000,
              {
                localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId }),
                data: {
                  traceId,
                  requestId: pendingAsk.requestId,
                  messagePinId: messagePinId || null,
                  session: {
                    state: 'requesting_remote',
                    publicStatus: 'requesting_remote',
                    event: 'request_sent',
                  },
                  traceJsonPath: artifacts.traceJsonPath,
                  traceMarkdownPath: artifacts.traceMarkdownPath,
                  transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
                },
              },
            );
          }
```

This removes:
- The `masterReplyWaiter.awaitMasterReply()` call (line 4694-4703)
- The completed/timeout branches (lines 4705-4771)

The `commandSuccess` return at line 4774 now only runs when `masterReplyWaiter` is null (no waiter configured). Add `localUiUrl` to it.

- [ ] **Step 2: Refactor master.ask confirm flow (~line 3556-3628)**

Apply the same pattern to the `--confirm` path. Replace the `if (masterReplyWaiter)` block at line 3556:

```typescript
    if (masterReplyWaiter) {
      scheduleMasterReplyContinuation({
        trace: updatedTrace,
        pendingAsk: sentPendingAsk,
        requestPath: outboundRequest.path,
        messagePinId: messagePinId || null,
        waiterInput: {
          callerGlobalMetaId: privateChatIdentity.globalMetaId,
          callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
          providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
          providerChatPublicKey: peerChatPublicKey,
          masterServicePinId: input.resolvedTarget.masterPinId,
          requestId: input.pendingAsk.requestId,
          traceId: input.traceId,
          timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
        },
      });

      const daemon = input.getDaemonRecord();
      return commandWaiting(
        'ask_sent_awaiting_master',
        'Request sent to master. Waiting for response...',
        3000,
        {
          localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId: input.traceId }),
          data: {
            traceId: input.traceId,
            requestId: input.pendingAsk.requestId,
            messagePinId: messagePinId || null,
            session: {
              state: 'requesting_remote',
              publicStatus: 'requesting_remote',
              event: 'request_sent',
            },
            traceJsonPath: artifacts.traceJsonPath,
            traceMarkdownPath: artifacts.traceMarkdownPath,
            transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
          },
        },
      );
    }
```

Add `localUiUrl` to the `commandSuccess` at line 3631.

- [ ] **Step 3: Delete `DEFAULT_CALLER_FOREGROUND_WAIT_MS`**

Remove line 128:
```typescript
const DEFAULT_CALLER_FOREGROUND_WAIT_MS = 15_000;
```

- [ ] **Step 4: Build to verify no type errors**

Run: `npm run build`
Expected: PASS. No remaining references to `DEFAULT_CALLER_FOREGROUND_WAIT_MS`.

- [ ] **Step 5: Run full test suite**

Run: `npm run test`
Expected: ALL PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/defaultHandlers.ts
git commit -m "feat: master.ask returns immediately with trace URL instead of blocking"
```

---

### Task 7: Clean up dead code and final verification

**Files:**
- Modify: `src/daemon/defaultHandlers.ts`

- [ ] **Step 1: Remove dead foreground timeout helpers**

After the refactor, these functions have no remaining call sites:
- `applyCallerForegroundTimeout` (~line 2864) — was only called at line 6087 (removed in Task 5)
- `applyMasterCallerForegroundTimeout` (~line 2576) — was only called at lines 3593 and 4730 (removed in Task 6)

Search for their usage to confirm they're dead:
```bash
grep -n 'applyCallerForegroundTimeout\|applyMasterCallerForegroundTimeout' src/daemon/defaultHandlers.ts
```

If no call sites remain, delete both functions.

- [ ] **Step 2: Full build + test**

Run: `npm run verify`
Expected: Build succeeds, skillpacks regenerate, all tests pass.

- [ ] **Step 3: Verify no remaining references to deleted constant**

Run: `grep -r 'DEFAULT_CALLER_FOREGROUND_WAIT_MS' src/ tests/`
Expected: No matches.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/defaultHandlers.ts
git commit -m "refactor: remove dead foreground timeout helpers"
```

- [ ] **Step 5: Commit any test fixups if needed**

If any tests needed adjustment during this process, commit them:

```bash
git add -A
git commit -m "test: update tests for fast-return service call UX"
```
