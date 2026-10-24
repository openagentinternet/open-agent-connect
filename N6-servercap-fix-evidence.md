# N6 Fix Evidence — server_cap truncation-point placement + kept_chars unit

Follow-up on PR #64 (`feat-dsh-oac-batch-read` @ `90ff1a94`), fixing finding N6 from
Sunday's self-consistency review (2026-10-24). Executor: Thursday (worker bot 5).
State: uncommitted working-tree changes on top of `90ff1a94`; commit/push left to Monday.

## What changed (and nothing else)

`src/core/metaweb/pinBatchRead.ts` — two semantics edits, IDBots-aligned:

1. **Placement**: the `server_cap` truncation point moved from a standalone
   `if (pin.truncated === true)` *after* the whole/omit if-else into an
   `else if (pin.truncated === true)` chained after `if (!whole)` *inside* the
   non-omit branch — the exact IDBots placement (`metawebLearningAgentTools.ts`
   @ `d75bea8a`, readPinsBatch render loop). A host-trimmed or host-omitted body
   now records only its host cut; the upstream cap point fires only for a
   whole-in-budget capped body. No more double points for trimmed+capped /
   omitted+capped bodies → cross-host receipt invariance restored
   (`truncation_point_count` / `truncation_points` identical to IDBots for the
   same batch).
2. **Unit**: `kept_chars` for server_cap changed from `slot.body.length`
   (UTF-16 units mislabeled as runes) to `Array.from(slot.body).length` (true
   runes) — IDBots is `Array.from(pin.text).length`. Equal for BMP-only bodies;
   diverged for astral chars (emoji), where the old value overcounted 2×.

Plus two comment-only adjustments: the moved block's rationale comment and the
`kept_chars` type doc (now "counted in `unit`" instead of unconditionally
"UTF-16 chars").

Known pre-existing doc nit, deliberately NOT touched (outside N6 scope): the
`total_chars` type doc still says "UTF-16 chars", which is inaccurate for
server_cap points (upstream `totalLength` is runes) — same family as N6's unit
nit, but doc-only, pre-existing, and unflagged by the review.

`tests/metaweb/pinBatchRead.test.mjs` — three new tests covering the previously
untested branch paths (the N6 test gap):

- host-trimmed capped body → exactly one `trimmed` point, no server_cap;
- host-omitted capped body → exactly one `omitted` point (count exact, visible
  list capped at 12), no server_cap;
- whole-in-budget capped body with astral chars → `kept_chars` counts runes
  (4000 emoji = 4000 runes, not 8000 UTF-16 units).

## Verification — commands and exit codes

Red arm first (tests written before the fix, run against the pre-fix dist at
`90ff1a94`; dist placement and `kept_chars: slot.body.length` verified present
in the compiled output beforehand):

```
$ node --test tests/metaweb/pinBatchRead.test.mjs
exit 1
  10 pre-existing tests: all pass (incl. the whole-in-budget server_cap test)
  3 new tests: all fail —
    ✖ host-trimmed capped body … never server_cap too   (points 6 ≠ 3)
    ✖ host-omitted capped body … never server_cap too   (visible omitted 6 ≠ 24; count 48 ≠ 24)
    ✖ server_cap kept_chars counts runes, not UTF-16    (8000 ≠ 4000)
```

The three new tests bite on exactly the two N6 deviations and nothing else.

Rebuild:

```
$ node scripts/build-atomic.mjs
exit 0
[build-atomic] dist/ swapped in 2.8s
compiled output re-checked: `else if (pin.truncated === true)` present;
`Array.from(slot.body).length` present in the server_cap push.
```

Green arm (scoped batch-read suites, post-fix):

```
$ node --test tests/metaweb/pinBatchRead.test.mjs
exit 0    tests 13 / pass 13 / fail 0   (10 pre-existing + 3 new)

$ node --test tests/metaweb/batchReadCli.test.mjs
exit 0    tests 2 / pass 2 / fail 0

$ node --test dsh-plugin/tests/metaweb-batch-tools.test.mjs
exit 0    tests 4 / pass 4 / fail 0     (pins OAC_METABOT_CLI_PATH to repo dist itself)
```

Scoped total: 19/19 green. Prior review baseline for these suites was 16/16;
the +3 are the new N6 tests.

## Diff surface (git status at close)

```
 M src/core/metaweb/pinBatchRead.ts     (29 lines: branch move + unit + comments)
 M tests/metaweb/pinBatchRead.test.mjs  (+69 lines: 3 new tests)
?? N6-servercap-fix-evidence.md         (this file; optional for the commit)
```

`dist/` is untracked/gitignored; it was rebuilt locally so the tests exercise
the fixed code, but the rebuild is not part of the diff surface.

## IDBots reference

`/Users/wufeng/idbots/project/bots/2/2026-10-14/idbots-src` @ `d75bea8a`,
`src/main/libs/metawebLearningAgentTools.ts` (readPinsBatch render loop):
server_cap is `else if (pin.truncated === true)` after `if (!whole)` inside the
non-omit `else`, with `kept_chars: Array.from(pin.text).length`. The OAC fix
reproduces this structure exactly; OAC's `slot.body` is the established
null-checked equivalent of IDBots' `pin.text`.
