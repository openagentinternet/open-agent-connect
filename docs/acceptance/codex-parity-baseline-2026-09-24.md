# Codex Skillpack Real-Install Baseline — 2026-09-24

Phase 0 scorecard for the Codex ↔ DSH parity plan
(`docs/superpowers/plans/2026-09-24-codex-dsh-parity-alignment.md`). First
runtime verification of an actual `skillpacks/codex/install.sh` install.

- Date: 2026-09-24
- Branch/worktree: `feat/codex-dsh-parity`
- metabot version under test: `0.8.0` (worktree `dist/cli/main.js`, via
  `METABOT_CLI_ENTRY` override; the skillpack also bundles its own
  `runtime/dist/cli/main.js`)
- Environment: fully scratch — `HOME`, `CODEX_HOME`, and `METABOT_*` all
  pointed into a temp dir; Node 22. The real `$HOME/.metabot`, `$HOME/.codex`,
  and the real daemon on `127.0.0.1:10001` (PID 22807) were never touched;
  port 10001 ownership was re-verified unchanged after every batch.
- Constraint: read-only smoke only. No identity create (chain write), no
  traffic grant/redeem, no media relay, no chain writes of any kind.

## 1. Install flow

`bash skillpacks/codex/install.sh` with the scratch env — **exit 0, OK**.

Observed sequence:

1. `runtime/shared-install.sh`:
   - Copies 26 shared skills from `runtime/shared-skills/` →
     `$HOME/.metabot/skills/` (full directory replace per skill).
   - Resolves the CLI entry: `METABOT_CLI_ENTRY` > `METABOT_SOURCE_ROOT` >
     bundled `runtime/dist/cli/main.js` (would build from source only as a
     last resort).
   - Writes the bash shim `$HOME/.metabot/bin/metabot` with the resolved
     `PREFERRED_CLI_ENTRY` baked in, plus its own node@22 resolution.
2. `install.sh` (codex host part):
   - Copies 26 host skills from `runtime/host-skills/` →
     `$HOME/.metabot/host-skills/codex/`.
   - Runs `metabot host bind-skills --host codex`, which creates
     `$CODEX_HOME/skills/` and symlinks all 26 skills as
     `metabot-* -> ../../.metabot/host-skills/codex/metabot-*`.
     Note: symlinks target the **host-skills copies**, not the shared
     `$HOME/.metabot/skills/` root.
   - Prints the full `bind-skills` JSON result on stdout (26 bound, 0
     replaced, 0 failed).

Post-install verification:

- `$HOME/.metabot/bin/metabot --version` → `metabot 0.8.0` (works).
- `$CODEX_HOME/skills`: **26/26 symlinks, 0 broken** (all resolve into
  `host-skills/codex`).
- `$HOME/.metabot/skills`: 26 dirs. `$HOME/.metabot/host-skills/codex`: 26 dirs.
- `metabot doctor` → `ok:false`, `code: cli_execution_failed`,
  `message: "No Twin Bot initialized."`, exit code 1. A fresh install has no
  identity, so doctor failing is the *expected* first-run state, not an
  install defect.
- `metabot --help` → exit 0, lists **33 top-level commands** (identity, user,
  bot, config, doctor, daemon, file, buzz, metaapp, metaid, chain, wallet,
  traffic, media, network, services, provider, chat, grouptask, memory,
  chainhistory, dream, knowledge-base, schedule, surf, twin, host, trace,
  browser, ui, skills, system, llm).
- Cosmetic: every CLI invocation prints a `[DEP0040] DeprecationWarning:
  punycode` line on **stderr** (stdout JSON stays clean). `bind-skills`
  output also emits it during install.

## 2. Daemon auto-start behavior

**Surprise: nothing auto-started a fixture daemon.** The task expectation
("most CLI verbs auto-start `metabot daemon serve` under the scratch HOME")
did not hold on a no-identity install:

- None of the 19 smoke verbs spawned a listener (verified by `lsof` listener
  diff before/after every batch).
- `metabot daemon start` itself fails with `No Twin Bot initialized.` — the
  daemon is twin-gated.
- The auto-start mechanism exists (`ensureDaemonBaseUrl` →
  `startDetachedDaemon` in `src/cli/runtime.ts:1494`), but home resolution
  (`resolveMetabotHomeSelection`, `src/core/state/homeSelection.ts:219`)
  throws `No Twin Bot initialized.` **before** any spawn, and the CLI wraps
  it as `cli_execution_failed`. So the fallback-port selection (next free
  port after 10001) was **not exercisable** under the read-only constraint
  (would require `identity create`, a chain write).
- Escape hatch check: `METABOT_HOME=<unindexed-dir> daemon start` is rejected
  with `METABOT_HOME must point to a manager-indexed profile` — you cannot
  bypass the twin gate with an arbitrary directory either.
- Port 10001 remained owned by the real daemon (PID 22807) for the entire
  run; zero risk observed, but also zero coverage of the fallback path.

Implication for later phases: verb-level parity testing beyond this baseline
needs a scratch identity fixture. That requires either relaxing the
no-chain-write rule in a disposable environment or a test-harness identity
mock; worth deciding before Phase 6.

## 3. Smoke results: read-only primary verb per skill area

Legend: works / degraded (runs but partial or gated) / broken.
"No Twin Bot" = `ok:false, code: cli_execution_failed, message: "No Twin
Bot initialized."`, exit 1.

| Skill area | Smoke verb | Result | Note |
|---|---|---|---|
| identity-manage | `identity list` | works | `ok:true`, `profiles: []`, exit 0 |
| identity-manage | `identity who` | degraded | specific code `identity_profile_not_initialized`; no twin yet |
| twin | `twin current` | works | `ok:true`, `twinSlug: null` (graceful empty) |
| skills (metaweb packs) | `skills list` | works | `ok:true`, empty list + install guidance text |
| memory | `memory list` | degraded | No Twin Bot |
| dream | `dream status` | degraded | No Twin Bot |
| surf | `surf status` | degraded | No Twin Bot |
| knowledge-base | `knowledge-base list` | degraded | No Twin Bot |
| schedule | `schedule list` | degraded | No Twin Bot |
| chainhistory | `chainhistory recall` | degraded | No Twin Bot |
| network-manage | `network bots --online` | degraded | No Twin Bot — even a pure directory read is twin-gated |
| metaweb | `metaweb search --query "skill"` | works | live chain results returned (cross-protocol items) |
| qanda | `qanda latest` | works | live chain feed returned |
| protocol | `protocol list` | works | `ok:true` |
| wallet-manage | `wallet balance` | degraded | No Twin Bot |
| traffic | `traffic status` | degraded | No Twin Bot (owner-scoped, expected) |
| post-skillservice | `services owned list` | degraded | No Twin Bot (see surprise #4 for the verb shape) |
| grouptask | `grouptask list` | degraded | No Twin Bot |
| browser | `browser --help` / `browser link --uri metaid://sunnyfung.eth` | works | `ok:true`; **no `localUiUrl`** in data with the daemon down — documented behavior ("omitted when no daemon base URL is configured"), falls back to scheme URI |
| metaapp/ui | `ui open --page bot` | degraded | No Twin Bot; no daemon auto-start; does not print any URL |

Counts: 19 verb probes → **7 works, 12 degraded (all twin-gated), 0 broken**.
No verb crashed or hung; every failure was a clean JSON envelope with exit 1.

## 4. UI pages

`SUPPORTED_UI_PAGES` in `src/cli/commands/ui.ts:5` contains exactly the 13
documented pages. `metabot ui open --page <p>` was run for all 13:

| Page | Accepted | Result |
|---|---|---|
| hub, bot, conversations, services, my-services, publish, refund, apps, metaapps, settings, trace, buzz, chat | yes (13/13 in the supported set) | all 13: `ok:false`, No Twin Bot, **no `localUiUrl`** |

`ui open --page nope` correctly returns `code: unknown_ui_page` — page
validation runs before the twin gate. Because the twin gate fires before URL
build on a no-identity install, this baseline cannot distinguish
"page works" from "page broken" beyond name validation; the localUiUrl path
needs an identity fixture (same gap as §2).

## 5. JSON envelope conformity

Verified shapes (stdout, exit codes):

- Success: `{ "ok": true, "state": "success", "data": {...} }`, exit 0.
- Failure: `{ "ok": false, "state": "failed", "code": "<snake_case>", "message": "..." }`, exit 1.
- `--help` text on stdout, exit 0; `--json` help variant available per verb.
- **Inconsistency:** `metabot --version --json` returns a bare
  `{ "version": "0.8.0" }` — not wrapped in the ok/state envelope, despite
  the help advertising "machine-readable output". Text `-v`/`--version`
  prints `metabot 0.8.0`.

Envelope conformity is otherwise uniform across all 19 probes; every result,
success or failure, parsed as a single JSON document.

## 6. Surprises / regressions vs expectations

1. **No daemon auto-start at all on a fresh install.** The expected
   "most verbs auto-start the daemon on a fallback port" behavior is gated
   behind twin identity resolution, which throws first. Fallback-port
   selection and any daemon-dependent verb (`ui open` localUiUrl, browser
   link URL) are unverifiable without `identity create`. This is the single
   biggest baseline gap for Phase 1+ verification planning.
2. **`metabot surf --help` prints top-level help**, not surf help. Surf has
   subcommand specs (`surf status --help` works) but no aggregate `surf`
   entry in the help registry (`src/cli/commandHelp.ts`). Agents following
   the "check --help first" discipline get the wrong page for surf.
3. **`daemon status` does not exist** (only `start`/`stop`/`restart`), so
   daemon health must be inferred from `doctor` or `lsof`; minor but it
   complicates scripted baseline checks.
4. **`services owned` is a two-level group**: bare `metabot services owned`
   returns `unknown_command: services owned`; the real verb is
   `services owned list`. The one-level help table lists `owned` as a plain
   command, which is misleading for both agents and humans.
5. **`network bots --online` is twin-gated** even though it is a read of the
   public online directory — arguably it should degrade to an empty/public
   result without a local identity (decision for the parity plan, not this
   baseline).
6. Minor: `--version --json` skips the standard envelope; stderr carries a
   `punycode` deprecation warning on every invocation.

## 7. Raw evidence

- Install transcript: captured during the run (install exit 0; bind-skills
  JSON with 26 bound skills).
- All probe outputs were captured inline in the session transcript
  (listener diffs + per-verb envelopes).
- No repository files were modified except this scorecard; no commits made.
