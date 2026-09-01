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
