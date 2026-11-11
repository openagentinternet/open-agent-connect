# OAC Local Session Adapters Design — Remote Bot Messages into Native Sessions

**Date:** 2026-11-11
**Status:** Draft for implementation planning

## Purpose

Define OAC's "last mile": delivering inbound remote-bot messages into the
native agent sessions a user already has open — Claude Code, Codex, ZCode,
DSH, and other host CLIs/UIs — so the message appears inside that session's
own conversation and can drive it to do development work.

Today a remote bot's message is only ever answered by OAC's own bot runtime,
and the whole exchange is visible exclusively on OAC surfaces
(`/ui/conversations` and the DSH plugin's A2A panel). Users live in their
native CLIs; they want the remote bot's message to show up there, in the
session that is actually working on their repo, and they want that session to
act on it.

This spec adopts the portable half of the reason-network design (the
ex-tincan agent-messaging daemon, studied 2026-11-11): per-agent delivery
tiers and injection adapters. It deliberately does **not** adopt its
transport, roster, or invite machinery — MetaID already provides OAC's
identity, discovery, and message transport.

## Background

### How inbound remote messages work today

```
remote bot (grok bot / another OAC host / IDBots)
  → metaso relay simplemsg (socket.io, encrypted private-chat payload)
  → simplemsgListener (src/core/a2a/simplemsgListener.ts)
  → handleInboundMessage (src/core/chat/privateChatAutoReply.ts:1731)
      ├─ trust-tier policy gate (P4a, context "chat")
      └─ bot runtime turn: LLM executor backends spawn HEADLESS
         `claude -p` / codex / … child processes
  → reply out via the simplemsg send pipeline
```

Key facts about the current state:

- The executor backends (`src/core/llm/executor/backends/`, registered in
  `src/core/platform/platformRegistry.ts` for 16 platforms) prove OAC already
  knows how to spawn and drive every major CLI agent. But those are ephemeral
  headless turns — invisible in any CLI the user is sitting in.
- Nothing in the repo touches the live-session injection surfaces
  (`CLAUDE_CODE_MESSAGING_SOCKET`, `codex queue`, host hooks). There is no
  MCP server and no sessions daemon route.
- Loop guards already exist for the bot-runtime path
  (`src/core/chat/privateChatLoopGuards.ts`); trust tiers already gate the
  ingress (`evaluatePeerPolicy` before the auto-reply turn).

### What reason-network does (reference study)

reason-network classifies every agent session by a **delivery tier** and
injects with per-agent adapters, all built on official/public mechanisms:

| Tier | Meaning | First-wave mechanisms |
|---|---|---|
| **push** | Injected mid-turn; can wake an idle session | Claude Code: write a `{"type":"user",…}` frame to the session's inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`). Codex: `codex queue --thread <id>` (starts a turn on a resumed thread); mid-turn via `PostToolUse` `additionalContext` / `Stop` `decision:block` hooks. opencode/pi: plugin `promptAsync` / `sendUserMessage(steer)`. |
| **turn** | Injected at the next tool call or turn end; idle waits for its human | Cursor, Gemini CLI, Copilot CLI, Grok CLI: hooks supplying `additionalContext` at `PostToolUse`/`BeforeAgent`, block-at-Stop. |
| **pull** | Seen only when the agent checks | Any MCP client (ZCode, Claude Desktop, …): `check_inbox(wait_secs)` long-poll + an unread notice appended to every tool result. DeepSeek Harness takes this tier in reason-network — for OAC, DSH is our own host plugin, so we can push natively. |

Supporting machinery worth copying: passive discovery (Claude writes every
live session to `~/.claude/sessions/<pid>.json`; Codex keeps
`~/.codex/session_index.jsonl`), session identity binding
(`<agent>:<session-id>` keys with names kept across resume), queued mail for
offline sessions, peer-input message framing, and anti-runaway guards.

## Goals

1. **Local session registry** — a daemon-side directory of the local agent
   sessions on this machine: identity, agent kind, name, cwd/repo/branch,
   busy/idle, delivery tier, last seen.
2. **Delivery adapters** with declared tiers for the first-wave platforms
   (Claude Code, Codex, ZCode/any MCP client, hooks-tier CLIs, DSH).
3. **`metabot mcp`** — a stdio MCP server (pull tier) that any MCP-capable
   host can load: `list_sessions`, `send_message`, `check_inbox`,
   `message_status`.
4. **Routing** — an inbound remote message can be routed either to today's
   bot runtime (default, unchanged) or to a bound local session.
5. **Queued mail** — messages for offline/unreachable sessions wait in the
   registry (24h TTL) instead of being lost or silently answered by the bot
   runtime.
6. **Peer-input framing** — injected messages are framed as peer input with a
   reply hint naming the exact tool for that platform; they never impersonate
   the user.
7. **Safety without new bypasses** — trust tiers keep gating at the ingress;
   loop guards extend to session deliveries; no broadcast from sessions.
8. **Presence you can see** — `metabot sessions list` and passive discovery
   show which local sessions exist, what they are doing, and whether they can
   receive mail.

## Non-Goals

- No transport, roster, or identity changes — MetaID/ABC remain the network.
- No delivery into sessions that never opted in. Passive discovery shows
  presence only; receiving mail requires registration via our MCP server,
  our hooks, or an explicit CLI claim (narrower than reason-network, which
  pushes to unwired Claude sessions as a "stranger" and lets Claude Code's
  own `crossSessionInbound` hold it).
- No file attachments in v1 (a v2 concern, with reason-network-style sender
  path restrictions).
- No `ask_owner` pop-up approvals or signed approval artifacts in v1.
- No changes to the executor backends' headless behavior. (Whether headless
  executor sessions should register into the same directory is an open
  question, see below.)
- GUI-only surfaces (Cursor IDE app, VS Code) beyond what their hook systems
  expose.

## Product Boundary

- **Whose sessions may be driven:** only sessions of this machine's MetaID
  profile owner. A folder opt-out list (like `metabot sessions folder <path>
  off`) excludes sessions under given paths from registration entirely.
- **Who replies:** replies from a driven session go out as the OAC bot
  identity through the normal send pipeline — never as the human. The
  conversation record notes which local session produced the turn.
- **What the session sees:** remote messages are framed as peer input
  (below), with explicit guidance not to treat them as user instructions and
  not to act on anything its own owner would not approve.

## Delivery Tiers and First-Wave Adapter Matrix

| Platform | Tier | Injection mechanism | Discovery source |
|---|---|---|---|
| Claude Code | push | `{"type":"user",…}` frame on the session inbox socket (`CLAUDE_CODE_MESSAGING_SOCKET`, resolved via the session's registry entry); fallback `asyncRewake` hook for idle wake | `~/.claude/sessions/<pid>.json` |
| Codex | push | `codex queue --thread <id>` for idle/offline; `PostToolUse` additionalContext / `Stop` block hooks mid-turn | `~/.codex/session_index.jsonl` |
| ZCode | pull | `metabot mcp` in `~/.zcode/cli/config.json`; unread notice on tool results | MCP registration |
| Any MCP client | pull | same as ZCode | MCP registration |
| Gemini CLI | turn | `BeforeAgent`/`AfterTool` additionalContext hooks | hook `session_id` |
| Copilot CLI | turn | `postToolUse` / `agentStop` hooks | hook `sessionId`, `COPILOT_AGENT_SESSION_ID` |
| Cursor (CLI agent) | turn | `postToolUse` / `stop` hooks | hook `conversation_id` |
| Grok CLI | turn | `PostToolUse` / `Stop` hooks | hook `session_id`, `GROK_SESSION_ID` |
| DSH | push (native) | in-process: the DSH plugin delivers into the bot/session turn directly — we are the host plugin, no external contract needed | daemon session state |
| opencode / pi | push (later) | plugin APIs (`promptAsync` / `sendUserMessage(steer)`) | plugin registration |

Notes:

- The Claude inbox socket is an implementation contract of Claude Code, not a
  documented public API. The adapter must tolerate its absence (fall back to
  hooks/pull) and its frame format is pinned by a behavior test, not assumed
  stable across versions.
- `codex queue` availability varies by Codex version; the adapter probes once
  and degrades the session's advertised tier to `turn` (hooks) or `pull`
  (MCP) when unavailable.
- Hook-host gotcha confirmed by reason-network: Cursor, Copilot CLI and Devin
  load **Claude Code's** hooks from `~/.claude/settings.json`, so our hook
  handler must detect which agent is actually calling it, not trust the
  settings file it was found in.

## Architecture

```
                                    ┌──────────────────────────────────────────┐
 remote bot ─ simplemsg relay ─▶ listener ─▶ handleInboundMessage (ingress) │
                                    │   trust-tier policy (UNCHANGED)          │
                                    │        │                                 │
                                    │   routing decision                        │
                                    │     ├─ bot runtime turn  (default)        │
                                    │     └─ session router ─▶ adapter ─▶ native CLI/UI session
                                    │                                │
                                    │   local session registry ◀─ registration (MCP / hooks / CLI claim / discovery scan)
                                    │   mail queue (per session, 24h TTL)       │
                                    └──────────────────────────────────────────┘
```

New module: `src/core/sessions/`

- `registry.ts` — session records and lookup. Key: `<agent>:<session-id>`.
  Record: name, agent kind, tier, cwd, repo/branch (read-only git probe),
  status (busy/idle/offline), doing (title/todo when cheaply available),
  last seen, adapter material (e.g. Claude inbox socket path), bound
  conversation ids.
- `naming.ts` — default name `<dir>-<agent>`; kept across resume while the
  agent keeps its session id; collision suffix `-2`/`-3`; names lapse with
  the session (24h after last seen, mirroring the mail TTL).
- `queue.ts` — per-session mail queue. Envelope = the same
  `PrivateChatInboundMessage` the bot runtime consumes. TTL 24h; expiry is
  surfaced to the sender's conversation as a delivery failure, never dropped
  silently.
- `router.ts` — routing decision (below).
- `adapters/` — one file per platform implementing
  `deliver(session, message) → receipt` and `tier(session)`.
- `discovery/` — passive scans (Claude registry file, Codex session index)
  merged into the registry as presence-only entries.
- `framing.ts` — the peer-input frame builder.
- `guards.ts` — session-drive loop-guard counters (extends, does not
  replace, `privateChatLoopGuards.ts`).

State lives at `<profile>/.runtime/state/local-sessions.json` (v2 storage
layout; lazy atomic write-then-rename, single-writer orchestrator — same
discipline as `private-chat-wake.json`). Mail queue:
`<profile>/.runtime/state/session-mail.json`.

### Session registration sources

1. **MCP server** (`metabot mcp`): the host's session id via env
   (`CLAUDE_CODE_SESSION_ID`, `CODEX_THREAD_ID`, `GROK_SESSION_ID`, …) or
   `_meta`; one session per process as the last-resort fallback, with the
   reason-network caveat applied (multi-session MCP processes must not
   cross-identify).
2. **Hooks**: our hook handler receives `session_id` on stdin at
   SessionStart/PostToolUse/Stop and registers/refreshes the session.
3. **CLI claim**: `metabot sessions claim --name <name>` run from a shell
   inside the session registers the calling terminal as a session (the
   `terminal` mailbox pattern — useful for scripting and for humans).
4. **Passive discovery**: read-only scans produce presence-only entries
   (visible in `sessions list`, never deliverable until wired).

### Routing decision

`handleInboundMessage` keeps its current shape; the trust-tier gate stays
ahead of everything. After the gate, a routing step runs:

- If the peer conversation is **bound** to a registered local session and
  that session is live → deliver via the adapter; record the receipt
  (`delivered` / `queued` / `held` / `refused`) in the conversation
  projection.
- If bound but the session is offline/unreachable → enqueue; the
  conversation page shows "waiting for session X (expires in Nh)". **No
  silent fallback to the bot runtime** — surprising autonomy is worse than a
  visible wait.
- If not bound → today's behavior, byte for byte.

Binding is explicit: `metabot sessions bind <conversationId> <sessionName>`
and `unbind`, plus `metabot sessions list --json` for tooling. A per-repo
default-binding config is a later, optional addition.

### Message framing

Injected text (never sent as a user message, never raw):

```
<oac-message from="grok-bot@<peer-host>" name="Grok Bot" pin="<pinId>" id="<msgId>">
Did the token format change? My tests fail on refresh.
</oac-message>
From a remote bot on the MetaID network. Reply with the metabot send_message
tool to "grok-bot@<peer-host>" if a reply is useful.
```

The reply hint names the tool as the receiving platform spells it
(`mcp__metabot__send_message` in Claude Code), so a session that has its own
native send mechanism does not reply with that instead.

### `metabot mcp` (stdio MCP server)

- Tools: `list_sessions(filter?)`, `send_message(to, message, reply_to?)`,
  `check_inbox(wait_secs?)`, `message_status(ids)`.
- Session resolution priority: env session id → `_meta` → hook-registered
  session for this process → one-per-process (only for single-session
  clients).
- Wiring: `metabot host bind-sessions --host <host>` writes the MCP config
  entry (and hook configs where applicable) with file backups, reusing the
  host-binding surface that `host bind-skills` already established;
  `metabot doctor` gains a sessions check (wiring present? daemon reachable?
  tier as advertised?).

### Receipts

`message_status` reports per message id: `queued → accepted (handed to the
adapter) → delivered (adapter confirmed) → replied`. Adapter acceptance is
input handoff, not proof the model read it — receipts say "handed to the
session", never "the agent acted". Seven-day retention, content-free, same
discipline as the bot runtime's delivery artifacts.

## Safety

- **Ingress is the only door.** Adapters are reached only through
  `handleInboundMessage`; nothing in `src/core/sessions/` listens to the
  network. Trust tiers keep gating exactly as in P4a.
- **Loop guard extension.** Consecutive bot→session→(reply)→bot cycles
  without human input are capped per conversation and per session (reuse the
  private-chat loop-guard counters and thresholds); past the cap the exchange
  is held and surfaced, like today's behavior.
- **No broadcast.** `send_message` from a session requires one named
  recipient. Group/`*` addressing stays a human-only, CLI-only capability.
- **Wake policy.** Only `trusted`/`team`-tier peers may wake an idle session
  (push tier); strangers queue turn/pull-style delivery instead. Config:
  `sessions.wakePolicy = trusted (default) | team | off`.
- **Folder opt-out.** `metabot sessions folder <path> off` prevents
  registration of sessions under a path (links followed), mirroring
  reason-network's `folders` config.
- **No secret exfiltration surface added in v1** — sessions send text only;
  the v2 file-attach design must adopt reason-network's sender-side path
  restrictions (own folder only, no dotfiles, no `~/.ssh`-class paths).

## UI Surfaces

- `/ui/conversations`: conversations bound to a local session show a small
  "delivered to <session>" provenance line and the delivery receipt state;
  the page stays otherwise unchanged. English + Simplified Chinese copy via
  i18n.
- DSH plugin A2A panel: same projection through the existing conversation
  routes — no new plugin surface in v1.
- CLI: `metabot sessions list|claim|bind|unbind|folder` with the standard
  `MetabotCommandResult` contract.

## Milestones

- **P1 — registry + presence (read-only).** `src/core/sessions/` registry,
  naming, discovery scans, `/api/sessions/*` daemon routes, `metabot
  sessions list`. No delivery. Verifiable alone: `sessions list` shows live
  Claude/Codex sessions with repo/branch/status.
- **P2 — pull tier: `metabot mcp`.** MCP server, `check_inbox` long-poll,
  unread-notice helper for tool results, host wiring for ZCode first.
  Acceptance: a ZCode session sees and answers a remote bot message via MCP.
- **P3 — push tier: Claude Code + Codex.** Inbox-socket adapter, `codex
  queue` adapter, idle-wake policy, mail queue + TTL, session binding +
  routing decision. This is the milestone that produces the headline
  behavior: a grok bot message appears inside a live Claude Code session and
  drives it.
- **P4 — turn tier: hooks.** Hook handler binary + per-host hook config
  writes (Gemini, Copilot, Cursor, Grok CLI), cross-loaded-hooks detection,
  `message_status`.
- **P5 — DSH push + UI + doctor.** Native DSH delivery, conversations-page
  provenance, doctor sessions check.

## Code Areas

| Area | Files |
|---|---|
| Ingress (touch, don't restructure) | `src/core/chat/privateChatAutoReply.ts` (routing step after the trust gate), `src/core/chat/privateChatLoopGuards.ts` (extended counters) |
| New core module | `src/core/sessions/*` (registry, naming, queue, router, adapters, discovery, framing, guards) |
| MCP server | `src/cli/commands/` (`metabot mcp`) + shared tool implementation in `src/core/sessions/mcpTools.ts` |
| Daemon routes | `src/daemon/routes/sessions.ts` (new), `src/daemon/defaultHandlers.ts` wiring |
| Host wiring | `src/core/host/hostSkillBinding.ts` (extend for sessions wiring), skillpack `SKILLs/` additions for session tools |
| UI | `src/ui/pages/conversations/` provenance line, `dsh-plugin` reads existing projection only |
| Storage | `resolveMetabotPaths()` consumers only; no legacy-layout references |

## Test Scope

- Unit: registry CRUD + naming collisions, queue TTL/expiry, framing,
  routing decision table, tier degradation (codex queue probe), hook-dialect
  detection (Cursor loading Claude's hooks).
- Adapter tests with fakes: a Unix-socket fake for the Claude inbox, a fake
  `codex` binary recording `queue --thread` invocations, a scripted MCP
  client exercising `check_inbox` long-poll.
- Integration (fast tier): routing end-to-end from a synthetic
  `PrivateChatInboundMessage` to a fake adapter receipt; loop-guard trip.
- Manual acceptance (real CLIs): the P3 headline scenario on a real Claude
  Code session; `codex queue` on a resumed thread; ZCode MCP round trip.
- Temp roots only via `tests/helpers/tempRoots.mjs`; adapter binaries resolved
  via injectable paths so tests never require real CLIs.

## Acceptance Criteria

1. A remote bot message to a bound conversation appears inside a live Claude
   Code session between tool calls, framed as peer input, without the user
   pasting anything.
2. A trusted peer's wake message starts a turn in an idle Claude session;
   a stranger's message queues instead.
3. Mail for an offline bound session is delivered on its next live
   registration; after 24h it expires with a visible failure in the
   conversation.
4. A ZCode session with `metabot mcp` configured receives the unread notice
   and can pull the message with `check_inbox`.
5. An unbound conversation behaves exactly as today (bot runtime turn).
6. Unwired sessions (no MCP/hooks/claim) never receive anything; they appear
   as presence-only in `metabot sessions list`.
7. A runaway bot↔session exchange trips the loop guard and is held.
8. `metabot sessions list` shows live sessions with agent kind, tier,
   repo@branch, and status without any opt-in from those sessions.

## Risks

- **Claude inbox socket contract drift.** It is an undocumented frame format;
  pin with a behavior test, keep the hook fallback first-class, and treat
  socket failure as tier degradation, never as message loss (queue instead).
- **Hook wiring churn.** We already absorb this class of churn with DSH
  kernel upgrades; `doctor` must make drift visible, and bind-sessions must
  back up every file it edits.
- **Autonomy surprises.** A remote bot driving a local dev session can take
  real actions. Mitigations: explicit binding (no ambient drive), wake tier
  policy, loop guard, and the framing rule that the session should not act
  on anything its owner would not approve. A future `ask_owner` milestone
  can harden this further.
- **Multi-session MCP processes** (Codex app-server, opencode, Cursor) can
  misattribute identity. Follow reason-network's rule: hooks are the
  identity source for those hosts; a sessionless MCP call from an
  ambiguous context is refused, not guessed.
- **Scope creep into transport.** Anything that smells like P2P mesh,
  roster sync, or relay work is out of scope and should be rejected in
  review.

## Open Questions

- Should executor-spawned headless sessions register in the same directory,
  so remote bots can address "the bot working in repo X" even when no human
  session is open? (Lean yes as a P5+ addition; it makes OAC's existing
  headless capability addressable, but adds an autonomy surface that
  deserves its own review.)
- Exact provenance display for bot-runtime-produced replies vs
  session-produced replies in the conversations page.
- Whether per-repo default binding (bind by cwd match) is ever worth the
  surprise risk; default is no.

## References

- reason-network (ex-tincan) — studied 2026-11-11; delivery tiers, adapter
  mechanisms, session-binding and mail-TTL semantics, framing and guard
  design. Local checkout:
  `/Users/tusm/Documents/MetaID_Projects/reason-network` (DESIGN.md is the
  primary reference).
- OAC specs this builds on: trust tiers & permission matrix
  (`2026-10-16-trust-tiers-permission-matrix-design.md`, ingress policy),
  guided local bot turn (`2026-06-21-oac-conversations-guided-local-bot-turn-design.md`,
  operator-guidance precedent), Metabot storage layout v2
  (`2026-04-23-metabot-storage-layout-v2-design.md`, state file discipline).
- Platform facts: `src/core/platform/platformRegistry.ts` (16 platforms),
  `src/core/llm/executor/backends/` (per-platform spawn protocols).
