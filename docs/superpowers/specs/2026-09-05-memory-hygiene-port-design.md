# Memory Hygiene / Deep Consolidation — Port Design

Date: 2026-09-05
Status: proposed
Source: IDBots `main` (`src/main/services/memoryHygieneService.ts`,
`src/main/libs/memoryHygienePolicy.ts`, `src/main/libs/deepConsolidationPrompt.ts`)

## Goal

Port IDBots' nightly memory-hygiene pass onto OAC file storage: deterministic
compression of the memory layer (soft-archive, supersede, prune) plus a
bounded, guard-railed LLM "deep consolidation" of the belief layer. CLI-first
(`metabot memory hygiene *`), driven nightly by the DSH plugin right after the
dream tick, runnable standalone everywhere else.

IDBots keeps this in SQLite; OAC ports it onto the `.runtime/memory/*.json`
stores. OAC has **no team-culture store**, so the IDBots `culture` step is
dropped (noted for the future culture port).

## CLI surface (new verbs in the `memory` group)

| Verb | Purpose |
|---|---|
| `memory hygiene status [--from]` | last run stats + effective config + due state |
| `memory hygiene due [--from]` | `{due: boolean, reason}` — eligible ≥04:00 local, once per date, all-day catch-up |
| `memory hygiene run [--from] [--no-deep]` | full pass in-process: deterministic steps always; deep consolidation when an LLM runtime binding exists (skipped, not failed, when absent) |
| `memory hygiene config get [--from]` / `config set [--from] --payload-file` | per-bot thresholds |

Manual `run` bypasses the 04:00 gate and the once-per-date dedupe, like IDBots.

## Config & ledger (per profile, storage layout v2)

- Thresholds live in the existing `policy.json` memory-policy store under a new
  `hygiene` object (per-bot, matching the per-bot opt-out model; there is no
  global config row in OAC's layout for this). `hygieneEnabled` joins
  `dreamEnabled` as a policy flag and is settable via
  `memory policy set --payload-file`.
- Run ledger: `.runtime/memory/hygiene.json`
  `{version: 1, lastRun: HygieneRunStats | null, deepConsolidationLastRunAt: string | null}`
  (single latest run, not per-date history — same as IDBots).

```ts
type MemoryHygieneConfig = {
  enabled: boolean;                      // default true
  observationRetentionDays: number;      // 90,  clamp 14–3650
  observationAnchorsPerPair: number;     // 8,   clamp 0–50
  episodeArchiveDays: number;            // 180, clamp 14–3650
  memoryDecayDays: number;               // 180, clamp 14–3650
  tombstonePurgeDays: number;            // 365, clamp 30–3650
  knowledgeRevisionKeep: number;         // 5,   clamp 1–50
  dreamRunRetentionDays: number;         // 90,  clamp 30–3650
  deepConsolidationEnabled: boolean;     // true
  deepConsolidationIntervalDays: number; // 7,   clamp 7–365
};

type HygieneRunStats = {
  dateKey: string;                       // local YYYY-MM-DD
  ranAt: string;
  trigger: 'scheduled' | 'manual';
  counts: Record<string, number>;
  errors: string[];                      // "<step>: <message>"
};
```

## Deterministic steps (sequential, error-isolated — one throwing step never
blocks the rest; it lands in `errors` and retries next night)

1. **impression-observations** — per (observer × subject) pair: always keep the
   newest `anchorsPerPair` active observations; among the rest, supersede those
   older than `observationRetentionDays` (status flip `active → superseded`,
   reversible); rebuild the pair's snapshot from remaining actives, delete the
   snapshot when none remain.
2. **episodes** — (a) reconcile `open` episodes whose source already reached a
   terminal state (orders completed/refunded/failed, group tasks
   done/cancelled, direct interactions dormant past the archive cutoff) and
   (b) soft-archive terminal episodes older than `episodeArchiveDays`
   (`archivedAt` mark; recurring activity on the same source key revives).
3. **dream-memories** — (a) soft-archive dream-origin memories unused since
   `memoryDecayDays` (`archivedAt`; `self_identity` and conversation-origin
   rows — which may carry the user's explicit "remember this" — are never
   auto-archived); (b) hard-delete `status='deleted'` tombstones older than
   `tombstonePurgeDays` (the one physical delete; grace keeps recent deletions
   undoable).
4. **knowledge-revisions** — per entry keep the newest `knowledgeRevisionKeep`
   revisions, physically drop the rest (live entry and recent undo trail stay).
5. **dream-runs** — hard-delete completed/failed dream runs and all fragments
   older than `dreamRunRetentionDays` (the dreamer only looks back 7 days).

### Store changes required

- `memoryStore` (`memories.json`): add `archivedAt: string | null` to
  `MemoryEntry`; default listings and injection blocks exclude archived rows;
  `includeArchived` opt-in; `archive`/`unarchive` helpers; decay stroke keyed
  on `COALESCE(lastUsedAt, updatedAt)`. Add a `lastUsedAt` touch on injection
  if not already tracked.
- `impressionStore`, `experienceStore`, `knowledgeStore`, `dreamStore`: add the
  compact/archive/prune/purge operations above where missing, following each
  store's existing enqueue + atomic-write conventions.

## Deep consolidation (LLM, advisory)

Ported with IDBots' guardrails intact:

- **Eligibility**: config on, bot policy `hygieneEnabled`, cadence
  `now − deepConsolidationLastRunAt ≥ intervalDays`, inventory ≥ 8 items.
- **Inventory**: `value_boundary` + `work_review` memories (status `created`,
  not archived, 50 each) + active knowledge entries (60).
- **Prompt**: `deepConsolidationPrompt` port — merge/rewrite preferred over
  deletion, never retire load-bearing boundaries, conservative by default,
  notes < 80 words, JSON-only output
  (`{retire_memory_ids, retire_knowledge_ids, rewrite_knowledge[], notes}`),
  tolerant brace-slice parsing.
- **Guardrails**: retire/rewrite ids intersected with the inventory snapshot;
  memory retire restricted to **dream-origin** rows; total actions capped at
  `ceil(inventory × 0.25)` — over-cap refuses the whole proposal unstamped;
  rewrites are in-place by id with the prior text kept as a revision.
- **Commit**: memory archive marks with a `notUsedSince` guard (rows touched
  after the snapshot survive); knowledge `archive`/`update`.
- **Cadence stamped only on a clean apply** — a bot with errors retries next
  pass.
- LLM call: 180 s attempt timeout, max 12 288 output tokens, thinking disabled,
  no web search. CLI `run` resolves the bot's runtime bindings via
  `runLlmPromptWithRuntimeFallback`. **No available runtime = skip, not fail**
  (`deepConsolidationSkipped` counter; cadence stamping unaffected).

## Scheduling

- Eligibility: local time ≥ 04:00 (late in the dream window so dreams finish
  first); once per local date; all-day catch-up when the host was off at night
  (no multi-day lookback — age-based steps self-heal).
- DSH plugin: the dream scheduler tick (`dsh-plugin/src/dream-scheduler.ts`)
  gains a hygiene tail: after dream work, `memory hygiene due --from <slug>` →
  `memory hygiene run --from <slug>`. Plugin config `hygiene.enabled`
  (default true).
- Other hosts / headless: cron or the agent runs `metabot memory hygiene run`;
  `due` lets any loop decide cheaply.

## Tests

- `tests/memory/hygiene.test.mjs` — step rules against seeded stores
  (anchors kept, supersede cutoff, episode reconcile/archive, memory decay
  exclusions, tombstone purge, revision keep-N, dream-run purge), once-per-date
  dedupe, manual-run bypass, error isolation, disabled config.
- `tests/memory/deepConsolidation.test.mjs` — prompt build, parser tolerance,
  guardrail refusal (over-cap / non-inventory ids / non-dream-origin),
  in-place rewrite, cadence stamping rules, fake-completion run end-to-end.
- Extend `tests/cli/memory.test.mjs` for the new verbs (dispatcher contract).
- Fast tier; temp dirs via `tests/helpers/tempRoots.mjs`.
