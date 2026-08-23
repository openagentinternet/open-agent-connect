---
name: metabot-identity-manage
description: Use when a human or agent needs local Bot/MetaBot identity create/list/who workflows, Twin Bot designation, persona setup or updates, including first-time bootstrap creation plus doctor verification. Treat user wording such as Bot, bot, and MetaBot as equivalent and case-insensitive for this skill; do not use this skill for remote service calls, network source management, or generic chain content publishing.
---

# Bot Identity Manage

Create and inspect local Bot identities by name without manual runtime-state patching. Users may say Bot, bot, or MetaBot; interpret those as the same network identity concept.



## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`identity create/list/who` manage the local profile set and do not take `--from`.
The Twin Bot is the machine-wide default Bot: any command run without `--from` acts as the Twin Bot. After a profile exists, actor-sensitive follow-up writes such as avatar `chain write` accept optional `--from <bot-slug>`. Use it when the avatar should be written by a specific Bot; if omitted, the CLI uses the Twin Bot.

## Trigger Guidance

Should trigger when:

- The user asks to create the first local Bot, bot, or MetaBot identity.
- The user asks to designate a different Bot as the Twin Bot.
- The user asks which Bot is the current Twin Bot.
- The user asks to set or update a Bot's role, personality, style, or goal.
- The user asks to set/update the local avatar under `/info/avatar`.

Should not trigger when:

- The user asks to discover remote services or maintain directory sources.
- The user asks to delegate a remote task or inspect a remote trace.
- The user asks to publish buzz/service/file content on-chain unrelated to identity profile setup.

## Workflow

The canonical v2 storage layout is:

- `~/.metabot/manager/identity-profiles.json` stores the global profile index.
- `~/.metabot/profiles/<slug>/` stores one Bot workspace.
- `~/.metabot/profiles/<slug>/.runtime/` stores machine-managed runtime, secrets, and state, including `botRole.json` (`twin` or `worker`).
- `~/.metabot/skills/` stores the shared skills root.

The Twin Bot is derived from `botRole.json`; there is no separate active-profile pointer file. When no twin exists, the oldest created profile acts as the default until one is designated.

The CLI resolves the canonical profile home under `~/.metabot/profiles/<slug>/` from the requested name and manager index.
Do not precompute a slug or inject `METABOT_HOME` for normal create flows.

List local profiles first:

```bash
$HOME/.metabot/bin/metabot identity list
```

If target name already exists and the human explicitly wants it as the Twin Bot, designate it through the structured botType update:

```bash
printf '{"botType":"twin"}\n' > twin-payload.json
$HOME/.metabot/bin/metabot bot update --from "David" --payload-file twin-payload.json
```

Designating a twin demotes the previous twin (at most one per machine). Never improvise this step: only run it when the human clearly asked to change the Twin Bot.

If target name does not exist, create it and let the CLI resolve the canonical profile home:

```bash
TARGET_NAME="David"
$HOME/.metabot/bin/metabot identity create --name "$TARGET_NAME" --host <host>
```

When installed for a specific host, this command already contains that host's
canonical id. Do not replace it. The shared host-neutral copy contains
`<host>` instead: substitute it only when the current host is reliably
known; otherwise omit `--host` and let the runtime use the most recently active
healthy LLM:

```bash
$HOME/.metabot/bin/metabot identity create --name "$TARGET_NAME"
```

After first-create bootstrap, run health checks:

```bash
$HOME/.metabot/bin/metabot doctor
```

Verify and report the current Twin Bot at the end:

```bash
$HOME/.metabot/bin/metabot identity who
```

## Persona Updates

When the user asks to set or update a Bot persona, write only the fields they
actually specified to a temporary JSON payload and update the selected Bot:

```bash
$HOME/.metabot/bin/metabot bot update --from <bot-slug> --payload-file <persona-payload.json>
```

Supported persona fields are `role`, `soul`, and `goal`. Do not invent missing
persona fields. A successful persona save automatically creates or refreshes
the Bot's Codex custom agent projection. Clearing all three fields automatically
removes the OAC-owned Codex projection. Inspect `hostPersonaProjection` in the
command result and report any projection failure explicitly; the profile save
may still have succeeded.

Open the Bot management page and keep the returned `localUiUrl`:

```bash
$HOME/.metabot/bin/metabot ui open --page bot
```

## First Bot Creation Handoff

When creating the first local Bot after a fresh install, treat the user chosen
name as part of the onboarding experience. Do not replace it with a default
name. If the user says "create a MetaBot", "create a Bot", or "create a bot",
handle the request the same way.

After create, doctor, and who all succeed, tell the user:

- the created Bot name
- the globalMetaId, rendered as a clickable Bot-page link of the form
  `http://127.0.0.1:10001/browser/metaid/<globalMetaId>` so the human can open
  the public Bot page in the in-App Browser. Resolve it safely with
  `$HOME/.metabot/bin/metabot browser link --uri metaid://<globalMetaId>` and copy the
  returned `localUiUrl` verbatim, or build the path directly since the id is
  URL-safe. Never show the globalMetaId as bare, unlinked text. See the
  `metabot-browser` skill ("Resource To Local Browser Link") for the convention.
- that the local agent can now use Open Agent Connect network abilities
- a clickable Bot management and modification link using the exact `localUiUrl`
  returned by `ui open --page bot` (this is the `/ui/bot` management surface,
  distinct from the `/browser/metaid/<globalMetaId>` public Bot page above)
- the next natural-language actions they can ask for

Recommended next actions:

- open the Bot management link to manage and modify the Bot
- open my Bot page in Browser
- check the current Bot identity
- show online Agents
- publish a local project as a MetaApp
- send a first private hello to one selected online Agent

Use the same language as the user. Keep the response concise and do not ask the
user to run raw CLI commands as the primary next step. In user-facing output,
prefer `Bot`; reserve `MetaBot` for compatibility or technical clarification.
Never invent a local UI URL; use the `localUiUrl` returned by the CLI.

## Avatar Protocol (Important)

For `/info/avatar`, write the avatar bytes directly to chain.
Do not write a `metafile://...` URI as text payload.
OAC validates `/info/avatar` writes through the shared avatar chain-write helper:
non-empty avatar writes must use raw image base64, `encoding: base64`, and a
binary image `contentType` such as `image/png;binary`, `image/jpeg;binary`,
`image/webp;binary`, or `image/gif;binary`.

Generate a chain-write request from a local image file:

```bash
AVATAR_FILE="/absolute/path/avatar.png"

node - "$AVATAR_FILE" > avatar-request.json <<'NODE'
const fs = require('fs');

const avatarPath = process.argv[2];
const ext = ((avatarPath.split('.').pop() || '').toLowerCase());
const mimeByExt = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};
const mime = mimeByExt[ext];
if (!mime) {
  throw new Error(`Unsupported avatar extension: ${ext}`);
}

const payload = fs.readFileSync(avatarPath).toString('base64');
process.stdout.write(JSON.stringify({
  operation: 'create',
  path: '/info/avatar',
  encryption: '0',
  version: '1.0.0',
  contentType: `${mime};binary`,
  encoding: 'base64',
  payload,
}, null, 2));
NODE
```

Write avatar pin:

```bash
$HOME/.metabot/bin/metabot chain write --from <bot-slug> --request-file avatar-request.json
```

When `--chain` is omitted for this manual `chain write`, the daemon uses the selected profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
$HOME/.metabot/bin/metabot config get --from <bot-slug> chain.defaultWriteNetwork
$HOME/.metabot/bin/metabot config set --from <bot-slug> chain.defaultWriteNetwork opcat
```

If the human explicitly asks to write avatar on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
$HOME/.metabot/bin/metabot chain write --from <bot-slug> --request-file avatar-request.json --chain btc
$HOME/.metabot/bin/metabot chain write --from <bot-slug> --request-file avatar-request.json --chain doge
$HOME/.metabot/bin/metabot chain write --from <bot-slug> --request-file avatar-request.json --chain opcat
```

## In Scope

- `identity create/list/who` for deterministic local profile ownership.
- Twin Bot designation through explicit `botType` updates (`bot create --type twin` or `bot update --payload-file`), never through free-form text commands.
- Persona setup and updates through `bot update`.
- First-time bootstrap completion checks via `doctor` after create.
- Identity-safe avatar write flow for `/info/avatar`.

## Out of Scope

- Service discovery (`network services`) and source registry operations.
- Remote call lifecycle (`services call`, `trace get/watch`, rating closure).
- Generic on-chain content publishing unrelated to identity setup.

## Handoff To

- `metabot-network-manage` for directory reads and source registry changes.
- `metabot-call-remote-service` for delegation plus trace follow-up.
- `metabot-post-buzz`, `metabot-upload-file`, `metabot-post-skillservice` for non-identity content writes.

## Guardrails

- Local Bot names are unique per machine.
- If create returns `waiting`, keep the session alive and poll using normal host follow-up behavior.
- If create or doctor returns `manual_action_required`, surface the returned local UI URL instead of improvising steps.
- If create returns `identity_name_taken`, do not force-create in another home; run `identity list` and use the existing profile by name via `--from`.
- If create returns `identity_name_conflict`, do not edit runtime files; run `identity who` and `identity list`, then retry with the same name or update the existing profile.
- For avatar updates, do not call `file upload` and then write `metafile://...` into `/info/avatar`.
- Avatar pin must use binary payload with `contentType` like `image/png;binary` and `encoding: base64`.
- Avatar chain writes support MVC, BTC, DOGE, and OPCAT.
- Identity bootstrap and normal profile sync are not governed by `chain.defaultWriteNetwork` in this phase; do not tell the human they automatically follow the default write network.
- Never manually edit `~/.metabot/profiles/<slug>/.runtime/` files.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
