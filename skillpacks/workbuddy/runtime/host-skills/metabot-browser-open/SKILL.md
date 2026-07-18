---
name: metabot-browser-open
description: Use when a human asks to open Agent Internet Browser, Bot Browser, a Bot page, a Bot homepage, a domain alias, a chain pin, a MetaApp, or a MetaFile through the existing local Browser entrypoint.
---

# Bot Browser Open

Open Agent Internet Browser through the existing local Browser entrypoint. Use this skill only when the target is already known or when the human explicitly wants Browser itself.

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

- The human asks to open Agent Internet Browser or Bot Browser itself.
- The human asks to open a known Bot page or Bot homepage in Browser.
- The human asks to open a known domain alias such as `sunnyfung.eth` in Browser.
- The human asks to open a known chain pin id in Browser.
- The human asks to open a known MetaApp or MetaFile in Browser.

Should not trigger when:

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

## Expectations

- Use Browser CLI directly. Open Browser with no URI when the human asks for the Browser itself.
- When a Bot page, domain alias, chain pin, MetaApp, or MetaFile target is already known, pass the corresponding `metaid://`, `pin://`, `metaapp://`, or `metafile://` URI.
- Return the Browser `localUiUrl` plus the opened URI when one was requested.
- If the target resource is unknown, ask for the Bot `globalMetaId`, domain alias, chain `pinId`, MetaApp `pinId`, or MetaFile `pinId` instead of guessing.
- Keep Browser positioned as a peer surface beside Bot Hub and existing local `/ui/*` pages. Do not treat Browser as a replacement for those pages.
- Use the same language the human is currently using.

## In Scope

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
- `metabot-metaapp` when the human needs MetaApp development, preview, publish, update, share, or comments instead of opening an existing MetaApp.
- `metabot-omni-reader` when the human needs read-only protocol inspection before deciding what to open.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
