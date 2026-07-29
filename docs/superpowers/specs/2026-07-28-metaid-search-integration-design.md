# MetaID Search Integration — Design Spec

Status: implemented 2026-07-28
Upstream API contract: metaso-p2p `docs/specs/2026-07-28-metaid-search-api.md` (`GET /api/metaid/list`, `GET /api/metaid/detail/:identity`, production `https://so.metaid.io`)

## 1. Background

The metaso-p2p userinfo aggregator exposes a MetaID counterpart of the MetaApp
aggregation query API integrated on 2026-07-26 (see
`2026-07-26-bot-browser-metaapp-integration-design.md`). Where the MetaApp API
answers "find apps by intent", this API answers "find people/Bots by intent".
Typical downstream LLM intents:

- "View <someone>'s bot page" → keyword search, open the best match's Bot page.
- "View <someone>'s details" → return the identity's full profile.
- "Find cheerful users/bots to chat with" → search persona/bio corpora, filter
  by chat capability, hand the picked `globalMetaId` to the private-chat flow.
- "Send a greeting to a music-loving Bot" → search with chat capability, pick
  one candidate, draft the message, hand off to `metabot-chat-privatechat`.

The API mirrors the MetaApp conventions exactly: `{code, data, message}`
envelope, `code=0` on success, business errors limited to `40000/40400/50000`,
HTTP always 200, opaque `nextCursor` pagination. Ranking is relevance over
name/skills/profile text with an exact-name boost; "which person best matches"
is the host LLM's decision, not the aggregator's.

## 2. Non-goals

- Vector/semantic search, synonym or pinyin matching (upstream v1 explicitly
  excludes these; insufficient recall is compensated by host-side near-synonym
  retries, the same degradation strategy as MetaApp search).
- Online-presence semantics: `network bots --online` stays the yellow-pages
  presence list owned by `metabot-network-manage`.
- Sending private messages: this feature only finds and reads identities; the
  send flow stays in `metabot-chat-privatechat`.
- Any chain write, and any local Bot identity action (no `--from` anywhere).

## 3. Design principles

- **CLI first.** The agent-facing surface is `metabot metaid search|detail`;
  skills only orchestrate CLI calls.
- **Mirror the MetaApp integration.** Same client shape, same flag
  conventions, same candidate-rendering and open-best-match-first skill
  behavior, so downstream LLMs learn one convention for both directories.
- **Read-only and daemon-optional.** Search/detail talk directly to the
  aggregation API; a reachable daemon only adds clickable `localUiUrl`
  decorations. `isOwn` reuses the local Bot registry.
- **No fabrication.** Candidates come from the API or not at all; the skill
  mandates honest empty-result reporting after the retry ladder.

## 4. CLI surface

New top-level command group `metabot metaid` (mirrors the API path naming and
the `metaapp` command-group precedent; distinct from `identity`, which manages
the local MetaBot identity):

```bash
metabot metaid search [--query <text>] [--skill <name>] [--chain <chain>]
                      [--chat-pubkey] [--homepage]
                      [--since-days <n>] [--until-days <n>]
                      [--limit <1-20, default 8>] [--cursor <cursor>]
metabot metaid detail --identity <globalMetaId|metaId|address>
```

Flag → API parameter mapping: `--query`→`keyword`, `--skill`→`skill`,
`--chain`→`chainName` (lowercased), `--chat-pubkey`→`hasChatPubkey=1`,
`--homepage`→`hasHomepage=1`, day flags → unix-second `since`/`until`
(converted in the CLI, same as MetaApp), `--limit`→`size` (capped at 20),
`--cursor`→`cursor`.

Envelope `data`:

- search: `{ items[], hasMore, nextCursor }`; each item is the trimmed
  projection `{ globalMetaId, metaId, address, chainName, name, avatarId, bio,
  chatSkills, hasChatPubkey, hasHomepage, updatedAt, isOwn }` plus, when a
  daemon is reachable, `localUiUrl` (Bot page) and `avatarLocalUiUrl` (avatar
  metafile) Browser links.
- detail: all list-item fields plus `role, soul, goal, persona, llm, homepage,
  background, chatPubkey, avatarContentType, fieldPins`, plus `localUiUrl`,
  `avatarLocalUiUrl`, and `homepageLocalUiUrl` when the declared homepage URI
  resolves to a Browser surface. `persona`/`homepage` are raw on-chain JSON,
  passed through untouched.

Error mapping: API `40400` → `metaid_not_found`, API `40000` →
`invalid_argument`, anything else → `metaid_search_failed`; CLI-side flag
problems stay `missing_flag`/`invalid_flag`.

## 5. Implementation map

- `src/core/metaid/metaIdSearchApi.ts` — thin client (`searchMetaIds`,
  `getMetaIdDetail`, `trimMetaIdSearchItems`, typed errors). Same
  `METASO_P2P_BASE_URL` env override and default `https://so.metaid.io` base
  as the MetaApp client; injectable `fetchFn` for tests.
- `src/cli/commands/metaid.ts` + `src/cli/main.ts` — subcommand parsing and
  dispatch.
- `src/cli/runtime.ts` — default handlers (`runMetaIdSearch`,
  `runMetaIdDetail`), `withMetaIdCandidateLinks`/`withMetaIdDetailLinks`
  decorations, `dependencies.metaid` registration and merge.
- `src/cli/commandHelp.ts` — top-level entry plus group/leaf help.
- Tests: `tests/metaIdSearchApi.test.mjs` (client), `tests/cli/metaidSearch.test.mjs`
  (dispatch + default handlers against a local stub server),
  `tests/cli/help.test.mjs` (help assertions).

## 6. Skill routing (`metabot-browser`)

People search joins MetaApp search in the Browser skill because every people
flow ends in a Browser surface (Bot page, homepage MetaApp, avatar metafile):

- New "Find And Discover People" section mirroring the MetaApp one:
  intent→flag mapping table, mandatory markdown-bullet rendering with
  `localUiUrl`/`metaid://` links (full ids, never truncated), open-best-match-first
  via `browser tab open --uri metaid://<globalMetaId>`, and the empty-result
  retry ladder (drop weakest token → near-synonym → honest report).
- New "View Identity Details" section: `metaid detail` for full profiles, and
  the private-chat handoff rule — search with `--chat-pubkey`, pick one
  candidate, draft the greeting, then hand the `globalMetaId` plus the drafted
  message to `metabot-chat-privatechat`. The Browser skill never sends.
- For subjective intents ("cheerful"), the skill instructs the agent to read
  the top candidate's full profile (`metaid detail`) before deciding, since
  the list projection alone cannot back a subjective judgment.
- Boundary updates: `metabot-network-manage` keeps online-presence listings
  and gains an explicit out-of-scope line for intent-based people search;
  `metabot-help` gains one people-search example prompt.

## 7. Acceptance checklist

- `metabot metaid search --query music --chat-pubkey` returns trimmed,
  link-decorated candidates; `--limit 21` and non-numeric day flags fail with
  `invalid_flag` before any handler runs.
- `metabot metaid detail --identity <gmid>` returns the full profile with
  `localUiUrl`/`homepageLocalUiUrl`; an unknown identity fails with
  `metaid_not_found`.
- `metabot metaid --help` and both leaf helps render in text and `--json`.
- The `metabot-browser` skill triggers on "view Alice's bot page", "find
  cheerful users to chat with", and "find a bot that can translate", and never
  sends private messages itself.
- Scoped tests pass: `tests/metaIdSearchApi.test.mjs`,
  `tests/cli/metaidSearch.test.mjs`, `tests/cli/help.test.mjs`.
