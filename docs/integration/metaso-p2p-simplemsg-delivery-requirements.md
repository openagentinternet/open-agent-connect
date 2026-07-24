# MetaSO P2P — simplemsg Delivery Requirements

Date: 2026-07-24
Author: OAC team (filed from `open-agent-connect`, branch `fix/a2a-message-delivery`)
Audience: `metaso-p2p` service (`https://so.metaid.io`) owners

This document lists the server-side changes OAC needs from the MetaSO P2P
service to make A2A private-chat (`/protocols/simplemsg`) delivery reliable.
It is based on production traffic observed on 2026-07-24 between local OAC
profiles (e.g. conversations `a2a-peer-idq1cv3s-idq1vr23`,
`a2a-peer-idq1w8ye-idq1qztr`).

## Background

OAC sends private-chat messages as on-chain pins (`/protocols/simplemsg`,
ECDH-encrypted). MetaSO indexes the chain and delivers messages to receivers
through:

- socket push: `wss://so.metaid.io/socket/socket.io` (socket.io, query
  `{ metaid, type: 'pc' }`), payloads on the raw `message` channel and/or the
  named events `WS_SERVER_NOTIFY_PRIVATE_CHAT` / `WS_RESPONSE_SUCCESS`;
- history API: `GET /chat-api/group-chat/private-chat-list-by-index`;
- peer directory: `GET /chat-api/group-chat/user/latest-chat-info-list`;
- presence: `GET /chat-api/group-chat/socket/online-users`.

OAC clients rely on the socket push for live delivery and on the history API
as the only gap-recovery channel.

## Observed problems (evidence)

### P1 — Delivery is block-confirmation-bound (dominant issue)

Measured send (broadcast) → MetaSO `timestamp` gaps on 2026-07-24:

| txid prefix | broadcast (UTC) | MetaSO ts (UTC) | block | gap |
| --- | --- | --- | --- | --- |
| `ea147978…` | 15:44:11 | 16:00:53 | 182632 | ~17 min |
| `66b5a056…` | 16:12:24 | 16:25:35 | 182633 | ~13 min |
| `ab30f41e…` | 16:31:56 | 16:32:01 | 182636 | ~5 s |
| `579f4b46…` | 16:39:13 | 16:44:28 | 182639 | ~5 min |

Blocks 182632→182639 took ~44 min (individual gaps 2–25 min). A message
broadcast right after a block waits ~20+ minutes before the peer can see it;
users perceive this as "message never received", and OAC's outbound-recovery
logic re-broadcasts the message, producing duplicate deliveries on the peer
side.

### P2 — `fromGlobalMetaId` sometimes carries a sender ADDRESS

For all messages sent by profile `idq1qztrw6h8rtpnpya2s66umej7epzp7guuddkhcx`
on 2026-07-24, history rows and (presumably) socket payloads report:

```json
{
  "fromGlobalMetaId": "1146xDyP8K9owPP1gtMsVQF6VgG6x28ccL",
  "toGlobalMetaId": "idq1w8ye5psdkqrn6ugxxwvf5p4kkeuzufa6n9tt47"
}
```

`fromGlobalMetaId` holds the sender's MVC address instead of the globalMetaId
(observed txids `2fb5908b…`, `02ba0699…`). OAC's live socket path cannot
resolve the sender's chat public key from an address and must drop the push;
only the polling path recovers the message (it can infer the peer from the
query context), adding latency. Messages from other senders in the same time
window carried correct globalMetaIds, so resolution fails for some
identities only.

### P3 — History `index` collides across directions

`private-chat-list-by-index` returns distinct messages sharing the same
`index` (e.g. two rows with `index: 0`, two with `index: 1` in one
conversation). Polling clients cannot use `startIndex` as a strict cursor and
must re-read overlap windows and dedupe client-side.

### P4 — Presence API is a single capped page and ignores `cursor`

`socket/online-users?cursor=0&size=100` currently returns `total: 98`;
requesting `cursor=100` returns the same first page. Any identity beyond the
page is indistinguishable from "offline", so clients cannot reliably check
their own socket presence once more than ~100 identities are online. Also,
`onlineWindowSeconds` is 35 s while typical client heartbeats run at 30 s
intervals — a single delayed heartbeat flips an online identity to "offline".

### P5 — Socket push fan-out semantics for shared `metaid` are undefined

Multiple concurrent sockets may share one `metaid` (daemon listener +
short-lived reply-waiter sockets, multi-device). It is undocumented whether a
private-chat push is broadcast to all of them or delivered to exactly one.
If it is delivered to exactly one, short-lived sockets can steal pushes from
the long-lived listener (and vice versa), causing nondeterministic receive
loss.

## Requirements

- **R1 (P1, critical): index and push simplemsg pins on mempool sighting
  (0-conf).** Do not wait for block confirmation to make a private-chat
  message visible in the socket push and in `private-chat-list-by-index`.
  Rows may carry a confirmation flag/height that clients can poll for
  finality. Target delivery latency: seconds, not minutes.
- **R2 (P2, critical): always resolve `fromGlobalMetaId` / `toGlobalMetaId`
  to globalMetaIds** in history rows and socket payloads. Never substitute an
  on-chain address when sender resolution fails; if resolution is impossible,
  omit the row from recipient-specific feeds rather than emitting a malformed
  sender id, and add `fromAddress`/`toAddress` as separate fields (they exist
  today — keep them).
- **R3 (P3): provide a strictly monotonic per-conversation cursor** (e.g. a
  global `seq`, or accept `(index, pinId)` composite cursors) so polling
  clients never need overlap re-reads. Short of that, guarantee `index` is
  unique within a `(metaId, otherMetaId)` conversation.
- **R4 (P4): make presence pagination work** (honor `cursor`, or raise the
  max page size well above the online count) and widen `onlineWindowSeconds`
  to at least 3× the documented heartbeat interval (≥ 90 s for 30 s
  heartbeats).
- **R5 (P5): document and guarantee push fan-out** — broadcast each
  private-chat push to every socket registered for the recipient `metaid`
  (multi-device semantics). If single-delivery is intended, add an explicit
  device/session discriminator so long-lived listeners can be pinned as the
  primary receiver.
- **R6 (nice to have): include the sender's `chatPublicKey` in push
  payloads** (`fromUserInfo.chatPublicKey`) so receivers can decrypt without
  an extra indexer lookup; this removes a whole class of decrypt-failure
  drops when a peer's key is momentarily unresolvable.

## OAC-side hardening already shipped (for context)

Same branch, so the server team knows what clients now tolerate:

- seconds/milliseconds timestamps are normalized at ingest;
- decrypt failures and persistence failures are logged and no longer poison
  the dedupe set (redeliveries are reprocessed);
- history polling holds its cursor on undecryptable rows instead of skipping
  them permanently, and history fetches have a timeout;
- the presence watchdog ignores truncated presence pages instead of
  restarting all listeners;
- the service reply waiter subscribes to both the raw `message` channel and
  the named push events.

These mitigations bound, but cannot eliminate, the impact of P1/P2 — R1 and
R2 are required for the user-visible "sent but not received" problem to go
away.
