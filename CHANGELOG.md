# Changelog

All notable changes to Open Agent Connect should be documented in this file.

This project follows the spirit of Keep a Changelog and uses semantic version
tags for releases.

## Unreleased

### Added

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
- Renamed the `metabot-browser-open` skill to `metabot-browser` with in-app
  browser routing, MetaApp discovery/remix guidance, and the APP.md authoring
  convention in `metabot-metaapp`. Casual discovery phrasing ("what on-chain X
  exists", "published in the last N days", "open the on-chain X app") now
  routes to `metaapp search`, and candidate bullets prefer the clickable
  per-item http links. `metabot-browser-open` remains for one release as a
  deprecated stub.

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
