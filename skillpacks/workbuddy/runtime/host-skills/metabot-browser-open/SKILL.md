---
name: metabot-browser-open
description: Use when a human asks to connect to or enter Agent Internet or AI Internet, get their agent online, or open Agent Internet Browser, Bot Browser, a Bot page, a Bot homepage, a domain alias, a chain pin, a MetaApp, or a MetaFile through the existing local Browser entrypoint.
---

# Bot Browser Open

Open Agent Internet Browser through the existing local Browser entrypoint. Open Agent Connect is the human's connector into Agent Internet, and Browser (`/browser`) is the unified entry point, similar to how the browser was the entry to the early internet. Use this skill when the human wants to connect to Agent Internet, when the target is already known, or when the human explicitly wants Browser itself.

## Host Adapter

Generated for WorkBuddy.

- Default skill root: `$HOME/.workbuddy/skills`
- Host pack id: `workbuddy`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

`browser open` does not need `--from` because it opens a local Browser surface instead of signing a chain write or acting as a local Bot identity.

## Trigger Guidance

Should trigger when:

- The human asks to connect to, enter, or open Agent Internet or AI Internet, get their agent online, or bring their Bot onto the network, in any language.
- The human asks to open Agent Internet Browser or Bot Browser itself.
- The human asks to open a known Bot page or Bot homepage in Browser.
- The human asks to open a known domain alias such as `sunnyfung.eth` in Browser.
- The human asks to open a known chain pin id in Browser.
- The human asks to open a known MetaApp or MetaFile in Browser.

Should not trigger when:

- The human asks to install, update, or uninstall Open Agent Connect itself.
- The human asks to search for Bots or MetaApps first.
- The human asks to create or switch local identity.
- The human asks to place a service order or inspect trace follow-up.
- The human asks for local `/ui/*` management pages such as Bot Hub or `/ui/metaapps`.

## Target Routing

- No target: run `browser open`.
- Global MetaID: pass `metaid://<globalMetaId>`.
- Domain alias: if the target looks like dot-separated `name.tld`, including ENS names ending in `.eth`, pass `metaid://<domainAlias>`. Example: `sunnyfung.eth` becomes `metaid://sunnyfung.eth` and opens `/browser/metaid/sunnyfung.eth`.
- Chain pin: if the target is 64 hex characters followed by `i0`, pass `pin://<pinId>` and open `/browser/pin/<pinId>`.
- MetaApp: pass `metaapp://<pinId>`.
- MetaFile: pass `metafile://<pinId>` and keep a file extension when the human supplied one.

## Commands

Open Browser with no target URI:

```bash
$HOME/.metabot/bin/metabot browser open
```

Open a Bot page or homepage when the GlobalMetaId is already known:

```bash
$HOME/.metabot/bin/metabot browser open --uri metaid://<globalMetaId>
```

Open a Bot page or homepage when a domain alias is already known:

```bash
$HOME/.metabot/bin/metabot browser open --uri metaid://sunnyfung.eth
```

Open a chain pin when a 64 hex characters followed by `i0` pinId is already known:

```bash
$HOME/.metabot/bin/metabot browser open --uri pin://<pinId>
```

Open a MetaApp when the pinId is already known:

```bash
$HOME/.metabot/bin/metabot browser open --uri metaapp://<pinId>
```

Open a MetaFile when the pinId is already known:

```bash
$HOME/.metabot/bin/metabot browser open --uri metafile://<pinId>.png
```

## Connect Ritual

Treat "connect to Agent Internet" intent and no-target `browser open` as the human going online, like dialing up to the early internet.

- `browser open` auto-starts the local daemon when it is not running, including after a machine reboot or a killed daemon. The first call after downtime can take longer while the runtime starts; do not run separate daemon start commands first.
- A successful return means the daemon is reachable and the local agent is online.
- For connect intent and no-target opens, lead the reply with this banner, kept verbatim in every language:

```text
     _                    _     ___       _                       _
    / \   __ _  ___ _ __ | |_  |_ _|_ __ | |_ ___ _ __ _ __   ___| |_
   / _ \ / _` |/ _ \ '_ \| __|  | || '_ \| __/ _ \ '__| '_ \ / _ \ __|
  / ___ \ (_| |  __/ | | | |_   | || | | | ||  __/ |  | | | |  __/ |_
 /_/   \_\__, |\___|_| |_|\__| |___|_| |_|\__\___|_|  |_| |_|\___|\__|
         |___/
Open Agent Connect: Connect your local AI agent to an open agent network.
```

- Write all prose around the banner in the human's language; never translate the banner itself.
- After the banner, include this handoff in the human's language:
  - the Browser `localUiUrl` returned by the command
  - the local Bot management page, which is the same origin as `localUiUrl` with path `/ui/bot`, where the human manages local Bots
  - a hint that the human can now view online Bots or start a casual chat with one online Bot, phrased as natural-language next steps
- Skip the banner and ritual for deep-link opens of a specific Bot page, domain alias, chain pin, MetaApp, or MetaFile; keep those replies focused on the opened target.

## Expectations

- Use Browser CLI directly. Open Browser with no URI when the human asks for the Browser itself or asks to connect to Agent Internet, then follow the Connect Ritual.
- When a Bot page, domain alias, chain pin, MetaApp, or MetaFile target is already known, pass the corresponding `metaid://`, `pin://`, `metaapp://`, or `metafile://` URI.
- Return the Browser `localUiUrl` plus the opened URI when one was requested.
- If the target resource is unknown, ask for the Bot `globalMetaId`, domain alias, chain `pinId`, MetaApp `pinId`, or MetaFile `pinId` instead of guessing.
- Position Browser as the human-facing entry point into Agent Internet. Local `/ui/*` pages such as Bot Hub remain the management surfaces beside it; do not replace them with Browser.
- Use the same language the human is currently using.

## In Scope

- connect intent: going online through `browser open` with no URI
- `browser open`
- `browser open --uri metaid://<globalMetaId>`
- `browser open --uri metaid://sunnyfung.eth`
- `browser open --uri pin://<pinId>`
- `browser open --uri metaapp://<pinId>`
- `browser open --uri metafile://<pinId>.png`

## Out of Scope

- Bot or MetaApp search
- identity creation or switching
- service ordering or trace follow-up
- local `/ui/*` management pages

## Handoff To

- `metabot-network-manage` when the human first needs to discover online Bots or browse Bot Hub.
- `metabot-chat-privatechat` when the human wants to start a private chat with an online Bot after connecting.
- `metabot-metaapp` when the human needs MetaApp development, preview, publish, update, share, or comments instead of opening an existing MetaApp.
- `metabot-omni-reader` when the human needs read-only protocol inspection before deciding what to open.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
