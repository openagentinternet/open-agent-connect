# App Session Runtime (browser.app.session.*)

Daemon-owned implementation of the `browser.app.session.*` host contract from
[llm-play-chinese-chess docs/09](https://github.com/openagentinternet/llm-play-chinese-chess/blob/main/docs/09-abc-app-session-requirements.md)
(Agent-Game-v2). The daemon is the sole owner of sessions, task-level grants
and leases; MetaApps only start/list/status/pause/resume/stop sessions.

## Module layout

- `types.ts` — shared data contracts and the stable bridge error codes.
- `groupChat.ts` — `group-chat-list-by-index` client, public AES group
  encryption/decryption, and `agent-game/1` envelope parsing.
- `gamePackage.ts` — resolves `metafile://` packages to
  `game-manifest.json` + `adapter.js` and verifies `adapterHash` on every load.
- `adapterSandbox.ts` — worker thread + restricted `node:vm` sandbox with
  memory/time/output limits and no network, file, wallet or host-bridge APIs.
- `store.ts` — atomic JSON persistence for sessions, grants and leases.
- `runtime.ts` — the action loop, catch-up, idempotent writes, leases/fencing,
  budget/expiry auto-pause and daemon-restart recovery.
- `groupChatListener.ts` — per-profile socket listener; socket is a realtime
  notification only, history is the source of truth.

## Runtime invariants

- Socket notifications are only a wake-up signal; every turn starts with a
  cursor-based catch-up through `group-chat-list-by-index` and deduplicates by
  message `index`.
- Writes record `(groupId, actionSeq, eventId)` before the pin write; retries
  first check history and never resend an event that is already on chain.
- Lease key is `(groupId, seat)` with heartbeat renewal; a second runner on
  the same seat is a safety error (`session_conflict`), never a race.
- Task grants bind
  `resourceUri + actorId + appId + groupId + gameId + rulesHash + adapterHash + seat`
  and only cover `create` on the granted `protocolPaths`.
- Expired/revoked grants and exhausted budgets auto-pause the session and
  record `lastError`; `finished`/`stopped` sessions never restart.

## Restore order (daemon restart)

1. Load all non-terminal sessions.
2. Re-validate each grant (revoked / expired / budget).
3. Reload the frozen package, verify `adapterHash`, smoke-load the ABI.
4. Catch up history from the persisted cursor.
5. Acquire the `(groupId, seat)` lease: running on success, `paused` +
   `session_conflict` on conflict.

## Security notes

- The vm sandbox blocks dynamic code generation (`eval`/`new Function`) and
  exposes no `require`/`process`/`fetch`; the worker adds memory limits and
  the host enforces timeouts and output sizes. Unreviewed adapters must not be
  granted write access (spectate only).
- `adapterHash` is verified when the package loads and is frozen for the whole
  session; a package whose hash changed after session start is rejected.
