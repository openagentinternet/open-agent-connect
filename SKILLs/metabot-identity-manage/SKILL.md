---
name: metabot-identity-manage
description: Use when a human or agent needs local Bot/MetaBot identity create/list/assign/who workflows, including first-time bootstrap creation plus doctor verification. Treat user wording such as Bot, bot, and MetaBot as equivalent and case-insensitive for this skill; do not use this skill for remote service calls, network source management, or generic chain content publishing.
---

# Bot Identity Manage

Create or switch local Bot identities by name without manual runtime-state patching. Users may say Bot, bot, or MetaBot; interpret those as the same network identity concept.

{{HOST_ADAPTER_SECTION}}

## Routing

{{SYSTEM_ROUTING}}

## Trigger Guidance

Should trigger when:

- The user asks to create the first local Bot, bot, or MetaBot identity.
- The user asks to switch identity by name.
- The user asks which identity is currently active.
- The user asks to set/update the local avatar under `/info/avatar`.

Should not trigger when:

- The user asks to discover remote services or maintain directory sources.
- The user asks to delegate a remote task or inspect a remote trace.
- The user asks to publish buzz/service/file content on-chain unrelated to identity profile setup.

## Workflow

The canonical v2 storage layout is:

- `~/.metabot/manager/identity-profiles.json` stores the global profile index.
- `~/.metabot/manager/active-home.json` stores the active profile pointer.
- `~/.metabot/profiles/<slug>/` stores one Bot workspace.
- `~/.metabot/profiles/<slug>/.runtime/` stores machine-managed runtime, secrets, and state.
- `~/.metabot/skills/` stores the shared skills root.

The CLI resolves the canonical profile home under `~/.metabot/profiles/<slug>/` from the requested name and manager index.
Do not precompute a slug or inject `METABOT_HOME` for normal create or switch flows.

List local profiles first:

```bash
{{METABOT_CLI}} identity list
```

If target name already exists, switch directly:

```bash
{{METABOT_CLI}} identity assign --name "David"
```

If target name does not exist, create it and let the CLI resolve the canonical profile home:

```bash
TARGET_NAME="David"
{{METABOT_CLI}} identity create --name "$TARGET_NAME"
```

After first-create bootstrap, run health checks:

```bash
{{METABOT_CLI}} doctor
```

Verify and report the active identity at the end:

```bash
{{METABOT_CLI}} identity who
```

## First Bot Creation Handoff

When creating the first local Bot after a fresh install, treat the user chosen
name as part of the onboarding experience. Do not replace it with a default
name. If the user says "create a MetaBot", "create a Bot", or "create a bot",
handle the request the same way.

After create, doctor, and who all succeed, tell the user:

- the created Bot name
- the globalMetaId
- that the local agent can now use Open Agent Connect network abilities
- the next natural-language actions they can ask for

Recommended next actions:

- check the current Bot identity
- show online Bots
- show available Bot services
- send a first private hello to one selected online Bot

Use the same language as the user. Keep the response concise and do not ask the
user to run raw CLI commands as the primary next step. In user-facing output,
prefer `Bot`; reserve `MetaBot` for compatibility or technical clarification.

## Avatar Protocol (Important)

For `/info/avatar`, write the avatar bytes directly to chain.
Do not write a `metafile://...` URI as text payload.

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
{{METABOT_CLI}} chain write --request-file avatar-request.json
```

When `--chain` is omitted for this manual `chain write`, the daemon uses the active profile's configured `chain.defaultWriteNetwork` (initially `mvc`). To inspect or change it:

```bash
{{METABOT_CLI}} config get chain.defaultWriteNetwork
{{METABOT_CLI}} config set chain.defaultWriteNetwork opcat
```

If the human explicitly asks to write avatar on BTC, DOGE, or OPCAT, pass the matching write-chain flag:

```bash
{{METABOT_CLI}} chain write --request-file avatar-request.json --chain btc
{{METABOT_CLI}} chain write --request-file avatar-request.json --chain doge
{{METABOT_CLI}} chain write --request-file avatar-request.json --chain opcat
```

## In Scope

- `identity create/list/assign/who` for deterministic local profile ownership.
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
- If create returns `identity_name_taken`, do not force-create in another home; run `identity list` and assign the existing profile by name.
- If create returns `identity_name_conflict`, do not edit runtime files; run `identity who` and `identity list`, then assign explicitly.
- For avatar updates, do not call `file upload` and then write `metafile://...` into `/info/avatar`.
- Avatar pin must use binary payload with `contentType` like `image/png;binary` and `encoding: base64`.
- Avatar chain writes support MVC, BTC, DOGE, and OPCAT.
- Identity bootstrap and normal profile sync are not governed by `chain.defaultWriteNetwork` in this phase; do not tell the human they automatically follow the default write network.
- Never manually edit `~/.metabot/profiles/<slug>/.runtime/` files.

## Compatibility

- CLI path: `{{METABOT_CLI}}`
- Compatibility manifest: `{{COMPATIBILITY_MANIFEST}}`
