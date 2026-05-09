# Default Write Network Design

Date: 2026-05-09
Status: Spec for implementation planning

## Context for the Implementer

This document is written for a new AI development session that does not have the conversation history that produced it. Treat this file as the source of truth for the feature boundary and acceptance gates.

Primary project:

- Open Agent Connect implementation workspace: `<repo-root>`
- `<repo-root>` means the root of the feature worktree used for implementation.
- Project instructions: `<repo-root>/AGENTS.md`
- All documentation, skill documents, and code comments must be written in English.
- Do not introduce code or documentation that depends on the legacy `.metabot/hot` layout.

Related previous work:

- Branch: `codex/opcat-transfer-help`
- Recent commits:
  - `2058071 docs: document opcat wallet transfers`
  - `97d1a9a feat: complete doge and opcat chain support`
- DOGE and OPCAT are now intended to be first-class chain choices for wallet balance, transfer, and most chain write surfaces. The exception remains file upload: DOGE is not supported for file upload.

## Goal

Add a profile-scoped default write network setting that controls which chain is used when a human or agent performs an on-chain write without passing an explicit chain override.

The setting must be visible and editable from the local UI, readable and writable from CLI config commands, and honored consistently by public write commands.

## Product Decisions

- The default write network is per local MetaBot profile, not global across all profiles.
- The default value is `mvc`, preserving current behavior for existing users.
- The valid default write networks are `mvc`, `btc`, `doge`, and `opcat`.
- Explicit command input always wins over the default:
  - CLI `--chain <network>` wins over config.
  - API/request JSON `network` wins over config.
- File upload remains unsupported on DOGE.
  - If `chain.defaultWriteNetwork` is `doge` and the user runs `file upload` without an explicit supported chain, fail with a clear error.
  - Do not silently fall back to MVC for file upload.
- `chat private` must be included in this feature:
  - add `metabot chat private --request-file <path> [--chain <mvc|btc|doge|opcat>]`;
  - when omitted, private chat uses `chain.defaultWriteNetwork`.
- Wallet balance and wallet transfer are not governed by the default write network:
  - `wallet balance` defaults to `all`;
  - `wallet transfer` selects the chain from the amount unit, such as `BTC`, `SPACE`, `DOGE`, or `OPCAT`.

## Non-Goals

- Do not change address derivation or chain adapter internals unless required to pass tests.
- Do not add DOGE file upload support.
- Do not make payment-chain semantics ambiguous for service calls.
- Do not migrate identity bootstrap/profile metadata writes to the default write network in the first implementation phase unless explicitly approved later.
- Do not change protocol payload schemas for `simplebuzz`, `simplemsg`, `skill-service`, `skill-service-rate`, or `/file`.

## Current-State Evidence

The current implementation defaults many chain writes to MVC when no network is supplied:

- `src/core/chain/writePin.ts` normalizes missing `network` to `mvc`.
- `src/core/buzz/postBuzz.ts` defaults buzz writes to `mvc`.
- `src/core/files/uploadFile.ts` defaults file upload writes to `mvc`.
- `src/core/services/servicePublishChain.ts` defaults service publish writes to `mvc`.
- `src/core/master/masterServicePublish.ts` defaults master publish writes to `mvc`.
- `src/daemon/defaultHandlers.ts` hardcodes `network: 'mvc'` for several protocol and private message writes.
- `src/cli/commands/chat.ts` does not parse `--chain`.
- `src/cli/commandHelp.ts` documents `--chain` for chain write, buzz post, file upload, services publish/rate, and master publish, but not chat private.

The project already has the right storage primitive:

- `src/core/config/configTypes.ts` defines profile-scoped runtime config.
- `src/core/config/configStore.ts` persists config under each profile's `.runtime/config.json`.
- `metabot config get/set` is implemented in `src/cli/commands/config.ts` and `src/cli/runtime.ts`.
- Existing config keys include `askMaster.*`, `a2a.simplemsgListenerEnabled`, and `evolution_network.*`.

The UI also has a suitable management surface:

- `/ui/bot` is the existing local human settings page for MetaBot profile and runtime management.
- It is implemented by `src/ui/pages/bot/app.ts` and `src/ui/pages/bot/index.html`.
- It already talks to daemon APIs under `/api/bot/*`.

## Public Write Surfaces Covered In This Feature

These surfaces must honor `chain.defaultWriteNetwork` when no explicit chain/network is provided:

| Surface | Current explicit chain support | Required behavior |
| --- | --- | --- |
| `metabot chain write` | `--chain mvc|btc|doge|opcat` | No `--chain` uses default write network. |
| `metabot buzz post` | `--chain mvc|btc|doge|opcat` | No `--chain` uses default write network. Attachments inherit the buzz network; DOGE therefore fails if attachments require file upload. |
| `metabot file upload` | `--chain mvc|btc|opcat` | No `--chain` uses default write network, except DOGE fails with a clear unsupported-file-upload message. |
| `metabot services publish` | `--chain mvc|btc|doge|opcat` | No `--chain` uses default write network. |
| `metabot services rate` | `--chain mvc|btc|doge|opcat` | No `--chain` uses default write network for the rating pin. |
| `metabot master publish` | `--chain mvc|btc|doge|opcat` | No `--chain` uses default write network. |
| `metabot chat private` | none today | Add `--chain mvc|btc|doge|opcat`; no `--chain` uses default write network. |

Daemon/API write calls that already include `network` in the JSON body should keep honoring the request body. Missing `network` should resolve to the stored default.

## Write Surfaces Not Covered In The First Phase

The following code paths write to chain but should remain MVC in the first phase unless a later spec expands them. They are protocol maintenance, identity bootstrap, background automation, or payment-flow paths where chain selection has implications beyond a simple user write command.

| Area | Evidence | Reason to defer |
| --- | --- | --- |
| Identity bootstrap | `src/core/bootstrap/localIdentityBootstrap.ts` writes `/info/name` and `/info/chatpubkey` with `network: 'mvc'`. | Identity discovery compatibility needs separate review. |
| Bot profile sync | `src/core/bot/metabotProfileManager.ts` writes `/info/name`, `/info/avatar`, and `/info/bio` with `network: 'mvc'`. | `/ui/bot` profile edits are identity metadata, not generic content publishing. |
| Provider heartbeat | `src/core/provider/providerHeartbeatLoop.ts` writes heartbeat pins with `network: 'mvc'`. | Directory/presence readers may assume MVC. |
| Service call/order protocol | `src/daemon/defaultHandlers.ts` writes order private messages and order protocol pins with `network: 'mvc'`. | Needs payment-chain and remote-listener design; `--chain` may be confused with payment chain. |
| Master ask/receive protocol messages | `src/daemon/defaultHandlers.ts` writes request/response private messages with `network: 'mvc'`. | Needs remote-listener design and protocol compatibility review. |
| Refund request/finalize | `src/daemon/defaultHandlers.ts` writes refund protocol pins with `network: 'mvc'`. | Must stay aligned with payment/order lookup semantics. |
| Auto-reply private chat | `src/core/chat/privateChatAutoReply.ts` writes simplemsg replies with `network: 'mvc'`. | Background behavior should be handled with a separate auto-reply/network policy. |
| Rating follow-up private message | `src/daemon/defaultHandlers.ts` writes the provider follow-up simplemsg with `network: 'mvc'`. | The rating pin itself is covered; follow-up delivery chain needs protocol compatibility review. |

The implementation should leave comments or tests that make this boundary explicit enough that future contributors do not assume these omissions are accidental.

## Configuration Model

Add a new config section:

```ts
export type DefaultWriteNetwork = 'mvc' | 'btc' | 'doge' | 'opcat';

export interface ChainConfig {
  defaultWriteNetwork: DefaultWriteNetwork;
}

export interface MetabotConfig {
  chain: ChainConfig;
  evolution_network: EvolutionNetworkConfig;
  askMaster: AskMasterConfig;
  a2a: A2AConfig;
}
```

Default:

```json
{
  "chain": {
    "defaultWriteNetwork": "mvc"
  }
}
```

Normalization requirements:

- Missing `chain` or missing `defaultWriteNetwork` normalizes to `mvc`.
- Invalid `defaultWriteNetwork` values normalize to `mvc` when reading config from disk.
- `config set chain.defaultWriteNetwork <value>` rejects unsupported values instead of normalizing silently.

## CLI Requirements

### Config Commands

Add public config key support:

```bash
metabot config get chain.defaultWriteNetwork
metabot config set chain.defaultWriteNetwork opcat
```

Expected JSON-style success data:

```json
{
  "key": "chain.defaultWriteNetwork",
  "value": "opcat"
}
```

Invalid values fail with stable machine-readable code:

- preferred code: `invalid_argument`
- message should include supported values: `mvc, btc, doge, opcat`

### Chat Private

Update CLI parsing:

```bash
metabot chat private --request-file request.json --chain doge
metabot chat private --request-file request.json --chain opcat
```

The request body sent to the daemon should include `network` only when `--chain` is explicitly supplied. Missing `--chain` should leave `network` absent so the daemon-side default resolution can apply.

Update help:

```text
Usage: metabot chat private --request-file <path> [--chain <mvc|btc|doge|opcat>]
```

Update request shape to mention optional `network` override.

### Existing Write Commands

Update help text for existing write commands so users and agents understand that the default is configurable:

- Do not say "Defaults to mvc" for write commands anymore.
- Say "Defaults to the configured `chain.defaultWriteNetwork`, initially mvc."
- Keep file upload help explicit that DOGE is unsupported.

## Daemon/API Requirements

Add a small default-network resolver near daemon handler creation:

```ts
async function resolveDefaultWriteNetwork(): Promise<'mvc' | 'btc' | 'doge' | 'opcat'> {
  const config = await configStore.read();
  return config.chain.defaultWriteNetwork;
}
```

Use a helper for public write inputs:

```ts
async function resolveWriteNetwork(rawNetwork: unknown): Promise<'mvc' | 'btc' | 'doge' | 'opcat'> {
  const explicit = normalizeText(rawNetwork).toLowerCase();
  if (isSupportedWriteNetwork(explicit)) return explicit;
  return resolveDefaultWriteNetwork();
}
```

For file upload:

```ts
async function resolveFileUploadNetwork(rawNetwork: unknown): Promise<'mvc' | 'btc' | 'opcat'> {
  const network = await resolveWriteNetwork(rawNetwork);
  if (network === 'doge') {
    throw new Error('DOGE is not supported for file upload. Use mvc, btc, or opcat.');
  }
  return network;
}
```

Apply the resolver to covered handlers:

- `chain.write`
- `buzz.post`
- `file.upload`
- `services.publish`
- `services.rate`
- `master.publish`
- `chat.private`

Do not rely only on CLI parsing. Local UI and external daemon clients may call the API directly.

## UI Requirements

Add a visible default write network control in `/ui/bot`.

Recommended placement:

- Add a third tab next to `Basic Info` and `Execution History`.
- Tab label: `Settings`.
- This keeps local runtime config separate from chain-synced profile fields.

Control behavior:

- Show current value of `chain.defaultWriteNetwork`.
- Options: `MVC`, `BTC`, `DOGE`, `OPCAT`.
- Use a compact segmented control or select. Follow existing `/ui/bot` visual style.
- Include concise helper text that this affects write commands when no explicit chain is supplied.
- Save button persists the config through a daemon API.
- After save, show a success state without reloading the whole page.
- If save fails, show a visible error state.

API design:

- Add a config route rather than overloading profile update:
  - `GET /api/config`
  - `PUT /api/config`
- The response should include at least:

```json
{
  "chain": {
    "defaultWriteNetwork": "mvc"
  }
}
```

The route may expose the whole normalized config if that is simpler and consistent with the existing config store, but the UI should only edit the default write network in this feature.

## Skill And Documentation Requirements

Update SKILL documents so agents do not assume MVC when chain is omitted:

- `SKILLs/metabot-wallet-manage/SKILL.md`
  - Mention `config get/set chain.defaultWriteNetwork` for default write-network management.
  - Keep wallet transfer governed by amount unit.
- `SKILLs/metabot-post-buzz/SKILL.md`
  - Mention default write network for omitted `--chain`.
- `SKILLs/metabot-post-skillservice/SKILL.md`
  - Mention default write network for omitted `--chain`.
- `SKILLs/metabot-call-remote-service/SKILL.md`
  - Mention service rating pins use default write network when rating `--chain` is omitted.
  - Do not imply service payment chain is controlled by default write network.
- `SKILLs/metabot-upload-file/SKILL.md`
  - Mention default write network and DOGE failure.
- `SKILLs/metabot-chat-privatechat/SKILL.md`
  - Add `--chain` examples for DOGE and OPCAT.
  - State omitted `--chain` uses `chain.defaultWriteNetwork`.
- `SKILLs/metabot-identity-manage/SKILL.md`
  - For manual avatar chain writes using `chain write`, mention default write network.
  - Do not say profile bootstrap/sync automatically follows the default network unless implemented in a later phase.

Regenerate all skillpacks after source SKILL changes:

- `skillpacks/shared`
- `skillpacks/codex`
- `skillpacks/claude-code`
- `skillpacks/openclaw`

## Error Semantics

Use stable errors for agent workflows:

- Unsupported default write network in `config set`:
  - `code: "invalid_argument"`
  - message includes supported values.
- Unsupported `--chain` for `chat private`:
  - existing `invalid_flag` pattern from write command helpers.
- File upload with default DOGE:
  - preferred code at CLI/API result boundary: `file_upload_failed` or `invalid_flag`, depending on where the check happens.
  - message must include `DOGE is not supported for file upload`.

## Testing Requirements

Add focused tests before implementation where practical.

### Config Tests

Extend `tests/config/configStore.test.mjs`:

- default config includes `chain.defaultWriteNetwork === "mvc"`;
- missing `chain` backfills to MVC;
- invalid on-disk chain value normalizes to MVC;
- valid values `mvc`, `btc`, `doge`, `opcat` survive read/write.

Extend CLI config tests:

- `metabot config get chain.defaultWriteNetwork` returns `mvc` by default;
- `metabot config set chain.defaultWriteNetwork opcat` persists and returns `opcat`;
- invalid value fails.

### Command Parser Tests

Add/extend tests:

- `tests/cli/chat.test.mjs`
  - `chat private --chain doge` passes `network: "doge"`;
  - `chat private --chain opcat` passes `network: "opcat"`;
  - unsupported/missing `--chain` fails.
- Existing write command parser tests should continue proving explicit `--chain` overrides request JSON.

### Runtime/Daemon Tests

Add tests where daemon handlers can be exercised with a fake signer:

- with config default `opcat`, `buzz.post` without `network` writes to OPCAT;
- explicit `network: "btc"` overrides default `opcat`;
- with config default `doge`, `file.upload` without `network` fails with the DOGE unsupported message;
- with config default `doge`, `chat.private` without explicit network writes the simplemsg pin on DOGE;
- `services.rate` uses default network when omitted.

### UI Tests

Extend daemon HTTP/UI tests:

- `GET /ui/bot` renders a Settings tab or default network control;
- `GET /api/config` returns normalized config;
- `PUT /api/config` persists `chain.defaultWriteNetwork`;
- invalid config update returns a 400-style failed command result.

### Help Tests

Extend `tests/cli/help.test.mjs`:

- write-command help mentions configurable default network;
- `chat private --help` shows `--chain <mvc|btc|doge|opcat>`;
- file upload help mentions default network and DOGE exclusion.

### Verification Commands

Minimum local verification before committing implementation:

```bash
npm run build
node --test --test-concurrency=1 tests/config/configStore.test.mjs
node --test --test-concurrency=1 tests/cli/chat.test.mjs tests/cli/help.test.mjs
node --test --test-concurrency=1 tests/cli/runtime.test.mjs
```

If the implementation touches shared daemon routing or UI rendering, also run:

```bash
node --test --test-concurrency=1 tests/daemon/httpServer.test.mjs
```

Before final integration, run:

```bash
npm test
```

## Acceptance Criteria

- `metabot config get chain.defaultWriteNetwork` returns `mvc` for an existing profile with no explicit setting.
- `metabot config set chain.defaultWriteNetwork opcat` persists the setting.
- `/ui/bot` lets a human change the default write network.
- After setting default to `opcat`, `metabot buzz post --request-file request.json` writes on OPCAT when no `--chain` is present.
- After setting default to `doge`, `metabot chat private --request-file request.json` writes the simplemsg pin on DOGE when no `--chain` is present.
- Explicit `--chain btc` still writes on BTC even if the default is `opcat`.
- `metabot file upload --request-file request.json` fails clearly when default is DOGE.
- `metabot file upload --request-file request.json --chain opcat` succeeds even when default is DOGE.
- Skills and `--help` docs no longer teach agents that omitted chain always means MVC.

## Suggested Implementation Phases

### Phase 1: Config Model And CLI Config

- Add `chain.defaultWriteNetwork` to config types, defaults, normalization, and config key allowlist.
- Update config help.
- Add config tests.

### Phase 2: Default Resolver In Daemon Handlers

- Add shared resolver helpers in `src/daemon/defaultHandlers.ts`.
- Apply to public covered write handlers.
- Keep explicit `network` override precedence.
- Add runtime tests for default and explicit override behavior.

### Phase 3: Chat Private Chain Flag

- Extend `src/cli/commands/chat.ts` to parse `--chain`.
- Update CLI help and tests.
- Update daemon `chat.private` handler to use default resolver.

### Phase 4: UI Config

- Add config handlers and routes.
- Add `/ui/bot` Settings tab.
- Add HTTP/UI tests.

### Phase 5: Skills And Generated Artifacts

- Update source SKILL documents.
- Run `npm run build:skillpacks`.
- Verify generated skillpacks and installed dev-mode skill references when needed.

## Open Follow-Up Questions For Later Specs

- Should `services call` expose a separate write-chain flag for order protocol messages, or should it intentionally stay on MVC because payment-chain semantics are distinct?
- Should `master ask`, `master receive`, and automatic master protocol messages follow the default write network?
- Should profile metadata sync and identity bootstrap remain MVC forever for discovery compatibility, or become configurable after readers are proven multi-chain-safe?
- Should provider heartbeat and refund protocol pins remain MVC, or should provider presence/order directories become multi-chain-aware first?
