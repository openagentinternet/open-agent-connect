# Local Session Adapters — Live Smoke Runbook

**Date:** 2026-11-12
**Branch:** `local-session-adapters` (P1–P5a landed; merge to `main` pending)
**Scope:** manual acceptance of the remote-bot → local-session chain on the
user's real hosts (ZCode, Cursor, Kimi Code). The automated suite covers the
unit/adapter behavior; this runbook verifies the last centimeter on live
CLIs.

## Preconditions

1. `main` carries the branch (merge done) and the daemon runs the new build:
   `pnpm run build && metabot daemon restart` (or start it manually — per
   house rule the agent does not restart the user's daemons).
2. A second Bot exists somewhere on the network (another client, or a
   remote host's metabot) that can send this machine's bot a private
   message — the same path as an ordinary A2A/private-chat message today.

## 0. Doctor baseline

```bash
metabot doctor
```

Expect a `local_sessions_layer` check: `registryReadable` false (or 0
sessions) with the setup note, and per-host wiring lines (`zcode`, `kimi`,
`cursor`, `gemini` — `wired` only after step 1).

## 1. Wire the hosts

```bash
metabot sessions wire --host zcode    # ~/.zcode/cli/config.json (MCP pull)
metabot sessions wire --host kimi     # ~/.kimi-code/mcp.json   (MCP pull)
metabot sessions wire --host cursor   # ~/.cursor/mcp.json + hooks.json (turn)
```

Each edited file gains a `.bak-sessions` backup. Verify the JSON still
loads: `python3 -m json.tool <file>`. ZCode/Kimi need their MCP server
list reloaded (restart that CLI or reload MCP); Cursor needs the hooks
file to be picked up (restart the CLI session).

## 2. ZCode (pull tier) — message lands in the inbox

1. Open a ZCode session in any repo.
2. After the MCP server is loaded, run:
   `metabot sessions list` — the ZCode session appears with
   `deliverable: true`, source `mcp`, tier `pull`.
3. Bind the conversation that should drive this session:
   `metabot sessions bind <conversationId> <sessionName>` (conversationId
   from the conversations page/API for the peer you'll message from).
4. From the other client's bot, send a message to this machine's bot.
5. The pull tier is now self-driving: the NEXT metabot tool result in the
   session carries `📬 N unread message(s) … call check_inbox now`, so
   the agent pulls the mail unprompted (you can also just ask it to
   check its inbox). The message arrives framed (`<oac-message from=…>`)
   in the session transcript, and `metabot sessions list` still shows the
   binding.
6. Reply from the session with the `send_message` tool — the remote side
   receives the reply as this machine's bot identity.

**Pass:** inbox message visible in-session, reply lands on the remote
client, conversation page shows the exchange.

## 3. Cursor (turn tier) — message appears at the next tool call

1. Start a Cursor session and give it a task that runs a few tool calls.
2. Repeat steps 2–4 from the ZCode flow (session registers via hooks;
   `metabot sessions list` shows tier `turn`).
3. While the turn is running (or at its end), send the message from the
   remote bot.
4. **Pass:** the `<oac-message>` block appears in the Cursor session as
   injected context at the next tool call or turn end — no user action.
   The session's reply (if it sends one) lands on the remote side as this
   machine's bot.
5. A stranger-tier sender (not trusted/contact/team) must NOT inject
   mid-turn — its mail waits in the inbox instead (`canWake=false`
   discipline).

## 4. Kimi Code (pull tier) — same flow as ZCode

`~/.kimi-code/mcp.json` carries the same MCP entry; the session pulls with
`check_inbox` after the MCP server is loaded. Bind, message, check, reply.

## 5. Push tier (Claude Code / Codex) — optional if installed

Claude Code with an active session exposes its inbox socket via
`~/.claude/sessions/<pid>.json` (visible in `metabot sessions list` as
`inboxSocketPath`). A trusted-tier message to a bound conversation appears
**mid-turn** in the CLI. Codex sessions receive wake mail through
`codex queue --thread <id>`.

## 6. Rollback

```bash
metabot sessions wire --host zcode --remove
metabot sessions wire --host kimi --remove
metabot sessions wire --host cursor --remove
metabot sessions unbind <conversationId>
```

Backups (`*.bak-sessions`) can restore any pre-wire file verbatim.

## 7. DSH (native push) — message drives a live DSH session

The dsh-plugin is the in-process delivery agent: every live DSH session
registers automatically (agent `dsh`, tier `push`), no wire step needed.

1. Restart the daemon AND DSH (the plugin mounts with the host) after the
   merge; hard-refresh the DSH web UI.
2. Open a DSH session and work in it briefly (so it is live).
3. `metabot sessions list` — the DSH session appears (`dsh:<hostId>`,
   tier `push`, deliverable).
4. Bind: `metabot sessions bind <conversationId> <sessionName>`.
5. Send a message from the remote bot (grok bot).
6. **Pass:** within ~a registration interval + poll cycle (≈1min worst
   case), the `<oac-message>` block appears INSIDE the DSH session's own
   conversation as a user turn, and the session starts working on it. The
   turn's final text flows back to the remote peer as the DSH bot's reply
   (`sessions send` anchored to the binding's peer).
7. Mid-work injection: DSH's own followup queuing applies — the mail lands
   as the next user turn when the host accepts it.

## Known deferrals (not in this smoke)

- Copilot CLI / Grok CLI hook wiring (schemas unverified).
- `sessions.wakePolicy` config knob (tier gate is live with conservative
  defaults).
- Conversations-page provenance line for routed mail; DSH native push.
- Kimi hooks: none exist in kimi-code 2.0.2 (config.toml has no hook
  surface) — Kimi stays pull-tier until upstream adds hooks.
