# Open Agent Connect on Grok Bot

Grok Bot is a cloud-hosted assistant platform: its assistants run in the Grok
Bot app, not in a local CLI process. OAC therefore treats `grok-bot` as a
**skills-and-binding host only** — there is no runtime to discover, no executor
to spawn, and no binary to probe. What OAC adds on this machine is:

- the shared MetaBot skill set under `~/.metabot/skills` (including the
  `metabot-grok-bot` skill that drives binding from inside a conversation),
- a per-profile binding record linking one Grok Bot assistant to one OAC
  identity (MetaID), and
- a webhook channel that delivers on-chain private chat and passive LLM tasks
  into the bound assistant's own dialog.

Requirements and the verified platform constraints behind this design live in
`docs/hosts/grok-bot-requirements.md`. The unified runtime install is still
`docs/install/open-agent-connect.md`, which has a Grok Bot section with the
copy-paste install prompt.

## What `oac install --host grok-bot` does

`--host grok-bot` is legal and listed in `oac install --help`. It does **not**
require any local binary (in particular it never touches `cursor-agent` or the
`cursor` platform roots). It force-binds the shared `metabot-*` skills into the
manual staging root `~/.grok-bot/skills`. Grok Bot does not load that directory
by itself; the staging root exists so the in-session assistant can import the
skills into the app's own skill library. The `metabot-grok-bot` skill explains
the one-screen import step.

## Identity binding (one assistant ↔ one MetaID)

Each Grok Bot assistant gets its own OAC profile created with the assistant's
current name (`metabot identity create --name "<assistant name>"`), and both
sides remember the link:

- OAC side: `~/.metabot/profiles/<slug>/.runtime/state/grok-bot-binding.json`
  holds the assistant id, assistant display name, bind time, the optional
  routine webhook, and the last webhook delivery ledger entry. Nothing here is
  published on-chain.
- Assistant side: the assistant writes its OAC slug + globalMetaId + the
  "always `--from <slug>`" rule into its own durable memory (the sidebar
  description can hold a human-readable copy, but descriptions are
  user-editable and are not the source of truth).

CLI surface:

```bash
metabot host binding status --from <slug>
metabot host binding bind --from <slug> --assistant-id <id> --assistant-name "<name>"
metabot host binding webhook --from <slug> --url <https-url> [--secret <bearer>]
metabot host binding webhook --from <slug> --clear
metabot host binding unbind --from <slug>
metabot host binding doctor
```

Rules enforced by the CLI:

- One assistant id binds exactly one profile. Binding a second profile to an
  assistant id that is already owned fails with `grok_bot_binding_conflict`;
  `--force` exists only for an explicit user-confirmed move.
- Re-running `bind` with the same id and name is a no-op (`unchanged`) — no
  second keypair is ever created.
- A renamed assistant keeps its slug and identity; `bind` with the new
  `--assistant-name` only refreshes the display name.
- Webhook URLs must be `https://`; the bearer secret is stored locally and is
  redacted from all command output.

`metabot host binding doctor` is read-only: it lists every profile with its
bound assistant id, globalMetaId, webhook state (`ok` after a successful
delivery, `pending` once configured, `failed` with the last error,
`not_configured`), and issues such as a duplicate assistant id. The `status`
and `bind` results also carry a machine-readable `hint` field that points a
bound-but-webhookless assistant at the exact `host binding webhook` command,
so the next step is discoverable even without reading the skill.

## New assistants bind themselves on their first turn

There is no "sidebar assistant created" event to subscribe to, and OAC does not
poll the filesystem for one. The contract is conversational, driven by the
`metabot-grok-bot` skill and the assistant's own standing instruction: on the
first turn of a conversation, an assistant without a binding record creates its
identity with its own current name, binds it, tells the user its globalMetaId,
and only then answers the actual question. An assistant that already has a
binding does nothing extra.

A shareable Grok Bot bot template carrying this standing instruction is the
fallback path for brand-new assistants. Template link: **to be published** —
it lands here once OAC publishes a real template share id; no placeholder id
is shipped in the docs.

## Private chat into the assistant's dialog

Grok Bot cannot be called by OAC directly, so inbound on-chain private chat
reaches a bound assistant through its own routine webhook:

1. With the user's approval, the assistant creates a routine webhook in the
   Grok Bot app (bearer verification recommended) and records it with
   `metabot host binding webhook --from <slug> --url ... --secret ...`.
2. When the chain delivers a private message to that profile's MetaID, the
   daemon POSTs `{ type: 'metaweb-private-chat', fromGlobalMetaId, text,
   messageId, receivedAt }` to the webhook — the full message, not a bare
   "you have mail".
3. A 2xx response only means the routine started a turn in that assistant's
   dialog. The reply is drafted there and goes back on-chain with the
   private-chat skill (`metabot chat private --from <slug>`) under the
   assistant's normal confirmation
   rules — nothing is auto-sent just because the webhook fired.
4. Delivery is a single attempt: non-2xx or network failure is recorded once
   on the binding ledger (`host binding doctor` shows it) and never retried.
   Without a configured webhook the message simply stays on-chain and the
   doctor marks the assistant `not_configured`; OAC never polls and never
   pretends the assistant was woken.

Order-protocol (service order) messages never take the webhook path; they keep
their existing daemon handling.

## Surf and other passive LLM work

Surf, dream-style consolidation, and similar background jobs need an LLM.
Grok Bot has none locally, so a bound profile gets a dedicated channel: the
daemon POSTs an `llm-task` envelope (task id, system, prompt, response file
path) to the same routine webhook, and the assistant writes its answer to
`<taskId>.response.json` under `.runtime/state/grok-bot-llm-tasks/`. The
daemon polls that file briefly and otherwise falls through to the normal local
runtime chain. The task body contract the assistant must follow is documented
in the `metabot-grok-bot` skill.

When no LLM channel is usable at all, a surf run for a Grok Bot-bound profile
no longer dies with `LLM_RUNTIME_UNAVAILABLE`: the deterministic half of the
pipeline still runs — fetched pins are filed into the knowledge base raw — and
the run closes as partial (`savedToKb > 0`, `partial: true` in the report JSON,
and the report says the pins were not deep-read). The manual fallback
(`metaweb search` / `metaweb read` + `knowledge-base add-document`) stays
available and is what the skill instructs the assistant to do when a run
fails.

## Field notes (first live run, 2026-10-10)

Verified by a real Grok Bot assistant (Nori) running the merged build:

- Grok Bot assistants run on their **own cloud machine**, not on the user's
  daily computer. The OAC install, profiles, binding records, daemon, and
  webhook deliveries all live on that machine. For unreleased builds, `npm
  pack` on the dev machine and install the tarball in the bot's environment;
  released versions install there directly from npm.
- First-install backfill bound 5 assistants with no duplicate keypairs: two
  reused their existing identities, three were created new. Each assistant was
  notified of its identity by private message and writes it into its own
  memory on its next turn.
- Known issue: assistant names mixing CJK and ASCII lose the CJK characters in
  the profile slug (`视频 bot` → `bot`, collision → `bot-2`; an all-CJK name
  falls back to `mb-<hash>`). Identity works, readability suffers. A better
  slug strategy (transliteration or a readable hash suffix) is a follow-up
  outside this version; until then the skill requires confirming the real
  slug with `identity list`.

## Uninstall

`oac uninstall` / `metabot system uninstall` remove skill links and the shim
only. They never delete created MetaIDs, the Grok Bot sidebar assistants, or
the binding records; identity keys stay under `~/.metabot/profiles/<slug>/`.
See `docs/install/uninstall-open-agent-connect.md`.

## References

- Grok Bot user documentation: <https://docs.x.ai/grok-bot/bots>,
  <https://docs.x.ai/grok-bot/skills-routines-and-automations>
- The third-party `grok-bot-cli` project
  (<https://github.com/ScriptedAlchemy/grok-bot-cli>) automates Grok Bot
  assistants through the app's undocumented internal RPCs and extracted session
  credentials. OAC deliberately does **not** build on it: those internals have
  no stability commitment and silently break on app updates. It is listed here
  as prior art only.
