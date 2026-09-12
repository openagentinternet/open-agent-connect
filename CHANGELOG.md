# Changelog

All notable changes to Open Agent Connect should be documented in this file.

This project follows the spirit of Keep a Changelog and uses semantic version
tags for releases.

## 0.8.0 - 2026-09-13

### Fixed

- Group-task live-run round 1: roster race, review flap, truncation recovery,
  log spam, and seat roles.
- Group-task live-run round 2: F8 mentions, F9 delivered-member watch, F10 DSML
  guard, F11 unreachable/undrivable notes, F12 turn timeouts.
- Settled member statuses in review/done grouptasks (delivered pill, work badge
  suppressed).
- Unavailable Bots stay out of group-task seating end to end.

### Changed

- A2A Chat is a center-column overlay: the right Sidebar is kept and the
  in-panel dock is dropped.
- The hero Bot identity anchor survives the DSH 0.1.5-rc hero commits.
- Regenerated all host skillpack dists (84 files).

## 0.7.0 - 2026-09-11

### Added

- Native DSH panels: the Bot Browser is available as a right-Sidebar tab kind
  and A2A Chat is a global main panel, so A2A-originated browser opens stay in
  the A2A panel via an in-panel dock.
- Guide-first new group task modal in the A2A panel.
- A2A conversation row menu: copy session id, rename, pin, archive (IDBots
  parity).
- Memory panel parity: hygiene card, dream retry rows, facts archive/restore.

### Changed

- DSH 0.1.5 compatibility: persona prefix/suffix split and 0.1.5 peer/dev
  ranges; preset chips order the Twin first, hide unavailable Bots, and the
  legacy shared preset is removed; the Twin Bot always knows it is the twin
  (host-owned bot_type in the preset persona).
- Smoke-test R2/R3 fixes: publish-ledger ownership, slug-keyed previews,
  navigation commit wait, cost echo, acronym-safe transcription, per-agent
  tool install on preset select, spelled-letter audio stabilization, browser
  tab timing, study retry, external-file guidance; qa-surf/study turns gained
  tool-step caps.
- Skill install errors now guide the agent to install from the on-chain
  package (pin id or metafile URI) instead of reporting a bare missing
  SKILL.md.
- Security: adm-zip bumped to 0.6.1 (GHSA-vwc7-r8mq-g2x9, moderate —
  extraction follows destination symlinks).
- Regenerated all host skillpack dists (60 files).

## 0.6.0 - 2026-09-09

### Added

- Added built-in media description tools backed by the free MetaID LLM relay
  (`metabot media` — describe one local image/video/audio file through vision +
  ASR), with a guarded media service lookup and regression coverage.
- Added MetaApp publishing progress stages with `--op-id` stage events streamed
  on `GET /api/metaapp/events?op=<id>`, chain-fallback update inheritance, and
  UI fork buttons.
- Added IDBots-parity cross-session memory read tools.
- Strengthened the on-chain Q&A ask posture: publishing a question is the
  default when on-chain searches come up empty (cheap, non-blocking, seeds the
  Q&A commons), applied across the QA behavior rule, tool descriptions, and the
  skill learning-loop SOP.
- Unified passive-LLM priority (round A): engine sites resolve host-first and
  DSH skills gained explicit scope handling.

### Changed

- DSH plugin ships in lockstep with the core from this release on: both
  packages are versioned 0.6.0 (plugin was 0.5.0 while core was 0.5.1).
- DSH: the Bot availability switch is clickable, unavailable Bots are filtered
  from staffing, KB tool profile home resolves from the Bot slug with string
  error contracts (DSH-DEFECT-KB-001), the working session id renders next to
  the preset name, and streaming messages are no longer linkified mid-stream.
- Regenerated all host skillpack dists to match main (48 new bundled modules).

## 0.5.1 - 2026-09-08

### Changed

- Follow-up release: ships the DSH plugin `open-agent-connect-dsh` 0.5.0, which
  was not published with 0.5.0 (plugin version was left unchanged there and the
  workflow's duplicate-version guard skipped it). The core package content is
  identical to 0.5.0; only the version is bumped to drive the tag-based release
  pipeline. DSH plugin 0.5.0 carries everything merged since the 0.4.2 release:
  the IDBots-style create-bot flow with setup recovery and the 100-bot cap,
  the group-task detail drawer (IDBots right-rail port), the host LLM executor
  bridge, the Bot editor Advanced tab, native on-chain Q&A tools plus qa-surf
  recurring jobs, the cordis session-cwd fix, and group-task hardening.

## 0.5.0 - 2026-09-08

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
- DSH plugin 0.4.1 adapts the dependency contract to DSH kernel
  0.1.3-alpha.1 while keeping 0.1.2-alpha.2 clients working (dual peer ranges
  on all `@deepseek-ai/dsh-*` packages; zero code changes).
- Agent Browser packages bumped to 0.5.6 (host-contract, core,
  name-resolvers, ui, test-harness) across the root package and all skillpack
  runtimes.
- DSH plugin 0.4.2: the preset chip in the DSH panel now shows the Bot's
  persona role and lists the Twin Bot first.
- Added MetaID protocol specs under `docs/metaid_protocols`: the SimpleQuestion/
  SimpleAnswer Q&A protocol and the `/info/owner` owner-binding protocol,
  both synced from the IDBots metaweb-qa worktree.

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
- DSH panel performance program: A2A payloads slimmed (no more multi-MB JSON
  through the panel), per-view projection caching, and daemon-direct reads
  replace per-call CLI spawns.
- DSH pollers now pin daemon CLI runs to the live daemon, so a DSH web
  restart window no longer auto-starts storm daemons that hang every panel
  call.
- Memoized wallet derivations in the daemon, fixing the constant ~183% CPU
  burn from repeated derivation on every request.
- Private-chat backfill loops idle backoff, TTL-cached peer chat public-key
  resolution, and a per-pass peer sweep cap with rotation, ending the chain
  polling storm during backfill.
- The A2A unread badge poller is disabled (browser connection-pool
  starvation); a full SSE-based badge rewrite is planned as the follow-up.
- Codex readiness probe history is isolated so probes no longer pollute
  shared session history.

### Security

- Hardened order protocol parsing for protocol-path pin ids.
- Added local daemon request-boundary checks for host and mutating API origins.
- Added dependency overrides that remove currently fixable production critical,
  high, and moderate advisories.
- Removed the standard BIP39 test mnemonic from production source and added a
  tracked-source guard test.
- Switched `xlsx` to 0.20.3 via the SheetJS CDN tarball (root and skillpack
  runtimes) so production installs no longer pull the npm-registry `xlsx`
  version carrying the outstanding ReDoS advisory; this unblocked the release
  pipeline's production audit gate.

### Project Governance

- Added security policy, contribution guide, code of conduct, pull request
  template, issue templates, CI, CodeQL, dependency review, and Dependabot
  configuration.
