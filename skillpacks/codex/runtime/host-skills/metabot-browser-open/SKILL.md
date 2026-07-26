---
name: metabot-browser-open
description: Deprecated alias of metabot-browser, kept for one release for backward compatibility. Use when a human asks to connect to or enter Agent Internet, open Agent Internet Browser or Bot Browser, a Bot page, a domain alias, a chain pin, a MetaApp, or a MetaFile — then route the whole request to the metabot-browser skill, which now owns all Browser open, MetaApp discovery, and remix workflows.
---

# Bot Browser Open (Deprecated)

This skill is deprecated and kept for one release for backward compatibility. The `metabot-browser` skill replaces it and covers everything this skill did: connecting to Agent Internet and opening Agent Internet Browser through `$HOME/.metabot/bin/metabot browser open`, plus opening Bot pages (`metaid://<globalMetaId>`), domain aliases such as `sunnyfung.eth`, chain pins (`pin://<pinId>`, 64 hex characters followed by `i0`), MetaApps (`metaapp://<pinId>`), and MetaFiles (`metafile://<pinId>`) in Browser tabs. `metabot-browser` also adds MetaApp search, remix lineage, source reading, and live preview.

## Actor Selection

No actor selection happens here: this deprecated stub performs no CLI calls and only routes intent to `metabot-browser`, which owns actor guidance.

## Routing

Route every request that reached this skill to the `metabot-browser` skill and follow its rules end to end, including its Connect Ritual and In-App Browser Rule. Do not run `$HOME/.metabot/bin/metabot browser open` or `$HOME/.metabot/bin/metabot browser tab open` directly from this stub.
