# Changelog

All notable changes to Open Agent Connect should be documented in this file.

This project follows the spirit of Keep a Changelog and uses semantic version
tags for releases.

## Unreleased

### Added

- Added on-chain skill publishing, completing the learn/publish loop: core
  `skillPublish` packages a local skill directory (SKILL.md frontmatter is the
  metadata source of truth; `normalizeSkillName` enforced, `version` required,
  4 MB cap), uploads it as a `/file` pin, and writes the
  `/protocols/metabot-skill` protocol pin — stricter than the IDBots
  `metabot-post-skill` reference wherever the install side depends on it.
  New `metabot skills publish --dir <skill-dir> [--name --skill-version
  --description --network] [--from <bot-slug>] [--confirm]` rides the new
  `POST /api/skills/publish` daemon route (wallet stays in the daemon); on DSH
  `skill_tool` gains an approval-gated `publish_skill` action and the
  learning-loop prompt closes the loop by offering to publish built or
  improved skills back. Skillpacks regenerated for all hosts.
- Added `metabot metaid search` and `metabot metaid detail` backed by the
  metaso-p2p MetaID aggregation API, with trimmed results, local `isOwn`
  marking, and clickable `localUiUrl`/`avatarLocalUiUrl` (plus
  `homepageLocalUiUrl` on detail) http links whenever a daemon base URL is
  configured or reachable. The `metabot-browser` skill now owns people
  discovery by name, personality, skill, chat capability, or time range —
  always opening the best match first — and hands private-message intents over
  to `metabot-chat-privatechat` with the chosen globalMetaId.
- Added `metabot metaapp search` and `metabot metaapp forks` backed by the
  metaso-p2p MetaApp aggregation API, with trimmed results and local `isOwn`
  marking. Result items now carry clickable per-item `localUiUrl` and
  `publisherLocalUiUrl` http links whenever a daemon base URL is configured or
  reachable, so hosts without a deep-link interceptor can open apps and
  publisher Bot pages in the local Browser.
- Added `metabot metaapp source` to materialize a MetaApp package from the
  shared artifact cache into a workspace directory with a `.metaapp-fork.json`
  provenance marker.
- Added fork-aware publishing: `metaapp publish` / `publish-project` default
  `forkedFrom` and `tags` from `.metaapp-fork.json`, report `hasAppDoc`, and
  ship a root `APP.md` while excluding the marker from the zip.
- Added `preview-metaapp://localhost/<path>` resolution in the Bot Browser for
  live workspace previews (kill switch:
  `METABOT_BROWSER_DISABLE_PREVIEW_METAAPP=1`).
- Added `metabot browser link --uri <uri>`, a pure resolver that normalizes any
  Browser deep-link URI (`metaid://`, `metaapp://`, `metafile://`, `pin://`,
  `map://`) into its clickable local Browser http URL without opening anything
  or starting a stopped daemon. The `metabot-browser` skill now always opens
  the best search match first and renders every mentioned Agent Internet URI
  or id as a clickable markdown link.
- `browser open --uri` and `browser tab open --uri` now probe `metaapp://`
  resolves and report the outcome in the envelope `resolve` field, so agents
  can skip broken app versions (for example pins missing a content reference)
  and open the next candidate instead of handing the human an error page.
- Publish and upload handoffs now lead with the local Bot Browser: after a
  MetaApp publish or a file upload, agents open the result in the local
  Browser first (`browser tab open`), present the local Browser http URL as
  the Open/View link, and reserve the MetaWeb (openagentinternet.org) URL for
  sharing to other people.
- Renamed the `metabot-browser-open` skill to `metabot-browser` with in-app
  browser routing, MetaApp discovery/remix guidance, and the APP.md authoring
  convention in `metabot-metaapp`. Casual discovery phrasing ("what on-chain X
  exists", "published in the last N days", "open the on-chain X app") now
  routes to `metaapp search`, candidate bullets prefer the clickable per-item
  http links, and understanding an app is explicitly source-first through the
  local artifact cache (never screenshots or page snapshots).
  `metabot-browser-open` remains for one release as a deprecated stub.
- Completed the DSH dream/memory IDBots parity: `gatherActivity` now feeds
  group tasks (acceptance ratings + still-active work), on-chain group-chat
  transcripts (chair- and guest-side), and seller orders into every nightly
  dream; a new dream-time experience harvest
  (`src/core/memory/experienceHarvest.ts`) folds group-task/order activity
  into the experience ledger so contact impressions form for those
  counterparties; dream-written work reviews are injected per turn again. In
  the DSH plugin the dream scheduler logs per-bot skips/errors/successes,
  retries a failed dream once on the Bot's fallback DSH LLM pair, and the
  Settings → Memory → Dream tab lists all recent runs (completed/failed/
  running, quiet days labeled) plus a diary/self-identity status line and a
  hint when the Bot has no DSH LLM configured.
- DSH plugin UI polish: the Twin Bot pins first in Settings → Bots and is the
  default A2A panel identity, workers sort oldest-first, the A2A peer list
  shows daemon-enriched names/avatars with live updates and wider selects,
  relative timestamps and status badges match IDBots, clicking an avatar opens
  the Bot page, and select dropdown text no longer clips.
- Completed DSH group-task chat parity phases 1-3: serve-the-dish deliverable
  bar and owner-only group-task composer with IME-safe send, owner supervision
  with source-session relay and a chair-send gate, roster-settle gate, join
  wake, and protocol-position status tags, and worker turns that run as real
  DSH sub-sessions (with a TTL fallback). A2A unread badges now cover DSH, and
  DSH gains a twin-only `group_task` chat tool plus the `oac:group-task` SOP.
- Completed the IDBots knowledge-base surface: incremental learn with format
  converters and study tools, a bot-editor Knowledge tab in the IDBots
  KnowledgeBasePanel card layout (source directory, open dir, learn summary,
  verbatim copy), `kb` host routes with browse-dir/open-dir, and
  `metabot knowledge-base create --raw-dir` for ingesting a source directory;
  the default knowledge base is ensured like IDBots (prompt block + KB list
  route).
- Ported IDBots scheduled tasks and memory hygiene to the OAC CLI/daemon with
  DSH host claiming, and the IDBots account-quota gas credit (traffic) to OAC
  core and the DSH plugin.
- Added per-bot chain content history (rounds 1-6): chain writes and reads are
  recorded with KB cross-marking, an async chain-content summary service feeds
  chain history into dream input, and `metabot chain_history_recall` exposes
  recall as a tool and CLI verb.
- DSH skills now render MetaWeb `metaid://` targets as clickable links, the
  Bot Browser follows the DSH theme, and a `search_online_bots` native tool
  keeps online-bot names clickable via the publish catalog.
- Added `metabot daemon restart` as a single subcommand.
- Integrated Agent Browser Core 0.5.5 across OAC and all skillpack runtimes
  (upstream: MetaApp identity grants are remembered to skip repeated consent
  prompts, and external requests reuse an open tab for their uri).

### Fixed

- Group tasks: owner identity resolution + group-task panel default tab
  parity with IDBots.
- Group-task pollers probe daemon liveness before CLI calls, so a DSH web
  restart window no longer triggers daemon auto-start storms that hang every
  panel call.
- ORCH-NOTIFY no longer leaks into unrelated sessions, and local-read actor
  resolution checks the right match status.
- DSH plugin: dream LLM idle timeout, dream crash recovery + transcript
  mirror for DSH 0.1.2-alpha.4, contact names in the Contacts tab, avatar
  upload/replace/remove in the Bot editor Basic tab, and the `unrun`
  devDependency required by the tsdown config.

### Security

- Hardened order protocol parsing for protocol-path pin ids.
- Added local daemon request-boundary checks for host and mutating API origins.
- Added dependency overrides that remove currently fixable production critical,
  high, and moderate advisories.
- Removed the standard BIP39 test mnemonic from production source and added a
  tracked-source guard test.

### Project Governance

- Added security policy, contribution guide, code of conduct, pull request
  template, issue templates, CI, CodeQL, dependency review, and Dependabot
  configuration.
