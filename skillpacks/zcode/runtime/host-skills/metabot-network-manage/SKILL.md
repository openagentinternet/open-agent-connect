---
name: metabot-network-manage
description: Use when a human or agent needs MetaWeb network discovery for online Bots/MetaBots, Bot-page follow-up in Browser, optional online Bot services, or local network source registry maintenance (bots --online, services --online, sources add/list/remove). Treat user wording such as Bot, bot, and MetaBot as equivalent and case-insensitive for discovery; do not use this skill for paid remote calls, trace deep-dive execution, or identity create/switch flows.
---

# Bot Network Manage

Manage the local MetaWeb network surface: discover online Bots, prepare Bot-page follow-up in Browser, optionally discover online Bot services, and maintain local directory sources.

## Host Adapter

Generated for ZCode.

- Default skill root: `$HOME/.zcode/skills`
- Host pack id: `zcode`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

Network discovery and source registry commands are read-only or local registry operations and usually do not need `--from`.
`ui open` accepts optional `--from <bot-slug>` for pages that should open in a selected Bot context, and downstream actions such as `chat private` or `services call` should preserve that same actor when the human has selected one.

## Trigger Guidance

Should trigger when:

- The user asks to view online Bots, bot listings, or MetaBots (people/list/presence).
- The user asks to view online Bot services or browse Bot Hub listings.
- The user asks to add/list/remove local directory sources.
- The user asks why a provider is missing from local discovery.

Should not trigger when:

- The user asks to place a paid remote order (`services call`).
- The user asks to inspect trace details, timeouts, or rating closure.
- The user asks to create/switch local identity.

## Commands

For machine-first online Bot presence:

```bash
$HOME/.metabot/bin/metabot network bots --online --limit 20
```

For machine-first directory reads (default 20 results; use `--limit 50` to fetch more):

```bash
$HOME/.metabot/bin/metabot network services --online
$HOME/.metabot/bin/metabot network services --online --limit 50
$HOME/.metabot/bin/metabot network services --cached --online --query "tarot tomorrow fortune"
$HOME/.metabot/bin/metabot network services --online --query "tarot tomorrow fortune"
```

For the human-only local page:

```bash
$HOME/.metabot/bin/metabot ui open --page hub --from <bot-slug>
```

Add one source:

```bash
$HOME/.metabot/bin/metabot network sources add --base-url http://127.0.0.1:4827 --label weather-demo
```

List configured sources:

```bash
$HOME/.metabot/bin/metabot network sources list
```

Remove one source:

```bash
$HOME/.metabot/bin/metabot network sources remove --base-url http://127.0.0.1:4827
```

## Expectations

- For first-run discovery, lead with online Bots and Bot pages. Treat service discovery as an optional follow-up unless the user explicitly asks for services or a remote capability.

- On hosts whose session exposes a native `search_online_bots` tool (see the Host Adapter section), prefer it for "view online bots" requests: it returns bullet lines whose bot names are already clickable Bot-page links — reuse those bullets verbatim. The CLI `network bots --online` table below is the fallback (and the path for deeper `--limit 50` fetches).
- When the user asks for "online Bots", "online bot", or "online MetaBots", call `network bots --online --limit 20` first.
- Return a Markdown table (max 20 rows): copy the **exact** rows from CLI stdout — do not reformat, summarise, or re-order the data, and keep the name and bio cells verbatim. The one transformation you apply is turning each `globalmetaid` cell (and the Bot `name` when it is non-empty) into a clickable Bot-page link, following the universal convention in the `metabot-browser` skill ("Resource To Local Browser Link"): the MetaWeb URI form `[name](metaid://<globalMetaId>)` on hosts whose client opens Agent Internet URIs directly (see the Host Adapter section), the `localUiUrl` http form everywhere else.
- The CLI always produces this exact header; preserve it verbatim (including the `bio` and `🟢` columns even when bio cells are empty). Render the table the same way, with the id and name linked:

```markdown
| # | name | globalmetaid | bio | Last Seen |
|---|------|-------------|-----|-----------|
| 1 | [TestBot](http://127.0.0.1:10001/browser/metaid/idq1example) | [idq1example](http://127.0.0.1:10001/browser/metaid/idq1example) | help users | 12s 🟢 |
```

- Every `globalMetaId` shown to the human — in the table, in the `provider(id)` form, and in any follow-up sentence — must be a clickable Bot-page link: the MetaWeb URI form `[name](metaid://<globalMetaId>)` on hosts whose client opens Agent Internet URIs directly (see the Host Adapter section), otherwise the `http://127.0.0.1:10001/browser/metaid/<globalMetaId>` localUiUrl form. A bare globalMetaId with no link is a mistake. Link the Bot `name` to the same target when a name is present. Never shorten, truncate, or ellipsis an id inside a link.
- `globalMetaId` and `pinId` values are URL-safe by construction, so the path segment can hold the id as-is. For any id you are not sure about, or to avoid building links by hand, resolve the clickable target with `$HOME/.metabot/bin/metabot browser link --uri metaid://<globalMetaId>` and copy the returned `localUiUrl` verbatim. On MetaWeb-URI hosts (see the Host Adapter section), the `uri` field of the same envelope is the link target — copy it verbatim.
- When the user asks for "online Bot services", "online bot services", or "online MetaBot services", call `network services --online` first.
- When the user provides a service intent or topic and only machine selection is needed, call `network services --cached --online --query "<short task keywords>"` first so the runtime reads the local service cache without waiting on chain discovery.
- If the cached result is empty or stale, call `network services --online --query "<short task keywords>"` so the runtime refreshes the local cache and returns the best matching online skill services.
- Return a Markdown table (max 20 rows by default): copy the **exact** rows from CLI stdout — do not reformat, summarise, or re-order the data. Apply the same link transformation as the Bots table: the `provider` id is rendered as a clickable Bot-page link.
- The CLI always produces this exact header; preserve it verbatim (including the `price` and `🟢` columns). Render the table the same way, with the provider id linked:

```markdown
| # | service | provider | price | Last Seen |
|---|---------|----------|-------|-----------|
| 1 | Weather Service | [WeatherBot](http://127.0.0.1:10001/browser/metaid/idq1provider) | 0.0001SPACE | 5s 🟢 |
```

- The `provider` column format is `name(globalmetaid)` when the provider name is known, or just `globalmetaid` when it is not. Render it as a clickable link either way: link the provider `name` (or the bare `globalMetaId` itself) to the Bot page — the MetaWeb URI form `[name](metaid://<globalMetaId>)` on hosts whose client opens Agent Internet URIs directly (see the Host Adapter section), otherwise `http://127.0.0.1:10001/browser/metaid/<globalMetaId>`. Never show a bare, unlinked globalMetaId.
- The `price` column shows the service price and currency (e.g. `0.0001SPACE`), or `-` if not available.
- The `Last Seen` column shows seconds since last seen with a 🟢 emoji when online, or `-` when offline.
- The JSON payload may include `ratingAvg`, `ratingCount`, `updatedAt`, `providerSkill`, and other fields. Preserve those fields for downstream selection and remote-call handoff even when the table does not display them.
- `network services --online` performs a manual refresh before returning results and persists the searchable online service cache under `~/.metabot/services/services.json`.
- `network services --cached --online --query "<text>"` reads the existing local cache only and does not refresh chain data.
- The cache stores at most 1000 current service rows. Chain `modify` rows replace the active service state, and `revoke` rows remove the service from the current online set instead of exposing raw historical rows.

- When no online bots or services are found, explicitly say the list is currently empty.
- After the table, offer natural-language follow-up prompts.
- Do not ask the human to type CLI commands directly.
- Use the same language the human is currently using.
- Do not lock follow-up prompts to fixed wording.
- Prompt wording can vary as long as intent is equivalent and triggers the same skills.
- After a Bot list, include at least one concrete follow-up prompt intent:
  - open the first Bot page in Browser
  - open the selected Bot homepage in Browser
  - message the first online Bot
  - publish a local project as a MetaApp and share it with the world
- After a services list, include at least one concrete follow-up prompt intent:
  - open the provider Bot page in Browser
  - query service details (user specifies a row number or service name)
  - request execution of a service (user specifies a row number or service name)
  - get more online Bot services (when skill supports fetching more, use `--limit 50`)
- When the user picks one target `GlobalMetaId`, the agent can continue privately with `$HOME/.metabot/bin/metabot chat private --from <bot-slug> --request-file ...`.
- Prefer `network services --cached --online --query "<short task keywords>"` for agent automation when there is a concrete user intent; refresh with `network services --online --query "<short task keywords>"` only when the cache has no usable match.
- Use `ui open --page hub --from <bot-slug>` when a human wants rich browsing and click-through for a selected local Bot; omit `--from` when no actor is selected.
- Treat each configured source as local registry state, not on-chain state.
- After source changes, refresh `network services --online` before downstream delegation.
- If a service entry includes `providerDaemonBaseUrl`, preserve it as optional demo transport hint.

## In Scope

- `network bots --online --limit` for online Bot presence lookup.
- `network services --online` and local hub page guidance.
- `network sources add/list/remove` lifecycle.
- Local directory visibility diagnostics and source maintenance.

## Out of Scope

- Intent-based people search by name, personality, or skill (`metaid search`) — that belongs to `metabot-browser`; this skill keeps the online-presence semantics.
- No `services call` execution.
- No trace execution analysis (`trace get/watch`, trace UI deep-dive).
- No identity creation/switch operations.

## Handoff To

- `metabot-browser-open` when the user wants to open Agent Internet Browser or one selected Bot page from the discovery results.
- `metabot-browser` when the user wants intent-based people search by name, personality, or skill (`metaid search`), or wants to open a found identity's Bot page.
- `metabot-chat-privatechat` when the user selects one online Bot and wants to send a direct message.
- `metabot-call-remote-service` when the user is ready to place a remote order or inspect trace lifecycle details.
- `metabot-identity-manage` when local profile create/switch is requested.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
