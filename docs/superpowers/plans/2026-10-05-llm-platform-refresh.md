# LLM Platform Refresh — Pre-Release Verification & Alignment

Date: 2026-10-05
Branch: `llm-platform-adapt` (worktree `.worktrees/llm-platform-adapt`)
Goal: every platform OAC claims to support (14 runtimes) actually discovers, probes, and runs against the current CLIs at release time.

Reference oracle: multica (`/Users/tusm/Documents/MetaID_Projects/multica`, HEAD `b4ca5b4a2`, 2026-10-04) — 295 adapter commits since May 2026; its per-platform invocation contracts are actively maintained against real CLIs. OAC's multi-platform connection model was originally derived from multica.

## Findings

### What OAC has today

- Registry: `src/core/platform/platformRegistry.ts` — 14 runtime platforms + `dsh` (skills-bind only).
- Discovery: `src/core/llm/llmRuntimeDiscovery.ts` — env override → PATH → login shell → default app-bundle paths; `--version` probe → `detected`; one-shot readiness probe → `healthy`.
- Execution: `src/core/llm/executor/backends/*` — one backend per platform, spawns the local CLI (stream-json / JSON-RPC app-server / ACP families).
- Model handling: **none**. Model comes from `OAC_<ALIAS>_MODEL` env or per-request `request.model`; there is no model catalog, no validation, no discovery.
- Version handling: only Node minimums (`openclaw >= 22.14.0`, `zcode >= 22.5.0`). No CLI minimum versions.

### Per-platform contract comparison (OAC vs multica HEAD, verified 2026-10-05)

| Platform | OAC today | multica today | Verdict | Local CLI |
|---|---|---|---|---|
| claude-code | `-p <prompt argv> --output-format stream-json --verbose --permission-mode bypassPermissions --strict-mcp-config` | same + `--input-format stream-json` (prompt via stdin), `--disallowedTools AskUserQuestion`, min 2.0.0 | Diverges (robustness): argv works but breaks on long prompts; stdin is required for live `list_models` | 2.1.286 ✅ |
| codex | `codex app-server --listen stdio://` JSON-RPC; handles new + legacy events | same protocol; min 0.100.0; `debug models` discovery (≥0.122.0) | Matches; add min gate + model discovery | 0.159.3 ✅ |
| copilot | `copilot -p <p> --output-format json --allow-all --no-ask-user [--model]` | **byte-identical** (verified in `copilot.go buildCopilotArgs`) | Matches — low risk despite no local install | ❌ |
| opencode | `opencode run --format json --dangerously-skip-permissions --dir` | same core shape; min 1.1.54 (older builds fill host disk, #8392); 2.x support | Matches; add min gate | 1.16.0 ✅ |
| openclaw | `openclaw agent --local --json --session-id` | same; min 2026.5.5 | Matches; add min gate | 2026.5.5 ✅ (exactly at min) |
| hermes | ACP `hermes acp` | ACP `hermes acp` | Matches (ACP stable across both) | ❌ |
| gemini | `-p <msg argv> --yolo -o stream-json [-m] [-r]` | multica **removed** Gemini CLI runtime 2026-06-24 (product decision: Google models via cursor/antigravity — not a breakage signal) | Flags verified current against local 0.46.0 `--help` (also has newer `--approval-mode yolo`); keep, live-test | 0.46.0 ✅ |
| pi | `pi -p --mode json --session <path>` | same + `--thinking` effort | Matches | ❌ |
| cursor | `cursor-agent agent --print --output-format json --force --trust` + prompt as argv | `cursor-agent -p --output-format stream-json --yolo [--workspace]` + prompt via **stdin** (Windows argv re-tokenization, #5649); dynamic `--list-models` | **Diverges** — must settle by live test on local 2026.07.23 | 2026.07.23 ✅ |
| kimi | ACP `kimi acp` + tool-name normalization | ACP `kimi acp` | Matches | 2.0.2 ✅ |
| kiro | ACP `kiro-cli acp --trust-all-tools` | ACP `kiro-cli acp` | Matches | ❌ |
| codebuddy / workbuddy | `codebuddy -p <p> --output-format stream-json --dangerously-skip-permissions` | claude-family skeleton (stdin prompt) + per-tool `--disallowedTools AskUserQuestion EnterPlanMode ExitPlanMode` | Diverges — port multica's exact shape; test via WorkBuddy.app bundle CLI | bundle ✅ |
| zcode | `zcode --prompt --json --cwd --mode yolo --no-browser` + app-server v2 fallback | (no multica counterpart — OAC-owned) | Verify locally only | bundle ✅ |
| dsh | skills-bind only, never spawned | (multica runs `dsh --stdio`; not comparable) | Out of scope | n/a |

Local installability: 9 of 14 platforms testable on this machine (claude, codex, opencode, openclaw, gemini, cursor, kimi, workbuddy bundle, zcode bundle). Untestable locally: copilot, hermes, pi, kiro, standalone CodeBuddy — for these, multica HEAD is the contract oracle.

### Structural gaps (the real "platforms upgraded" exposure)

1. **No model catalogs.** Users must hand-set model ids via env. When platforms ship new model generations, OAC cannot discover, validate, or offer them. multica has live discovery (claude `list_models` control request; codex `debug models`; cursor `--list-models`; ACP `session/new` catalog; `agy models`) plus static fallback catalogs that are never persisted.
2. **No CLI minimum-version gates.** multica marks below-minimum runtimes unavailable with an upgrade hint and fails open when the version is unparsable; OAC has nothing, so an old CLI produces cryptic protocol errors.
3. **Prompt-as-argv** on claude/cursor/copilot/gemini/codebuddy: long prompts can exceed ARG_MAX, and argv leaks prompts into the process list. multica routes prompts via stdin where the CLI supports it.

## Workstreams

### P0 — Contract alignment + version gates (pre-release, must)

1. `claude.ts`: add `--input-format stream-json`, deliver prompt as a stdin stream-json user message (reuse the existing `writeJsonLine` control channel infra), add `--disallowedTools AskUserQuestion`.
2. Port multica's exact current `codebuddy` arg shape (verify `codebuddy.go` at implementation time); workbuddy inherits.
3. Cursor: live-test OAC's current `agent --print --output-format json` shape against local 2026.07.23; keep it if it works, otherwise adopt multica's `-p --output-format stream-json --yolo` + stdin-prompt shape.
4. Add `minimumCliVersion` to `PLATFORM_DEFINITIONS` (claude 2.0.0, codex 0.100.0, copilot 1.0.0, opencode 1.1.54, openclaw 2026.5.5): parsed-below-min → `unavailable` with upgrade hint in `healthReason`; unparsable/missing version → fail open (stays detected). Semantics ported from multica `version.go`.
5. Update golden launch-command assertions in `tests/llm/llmExecutorCore.test.mjs` + registry assertions in `tests/llm/llmProviderExpansion.test.mjs`.

### P1 — Live verification matrix (pre-release, must)

Run a real one-shot "Reply exactly OK" turn through OAC's executor for every locally installed platform: claude 2.1.286, codex 0.159.3, opencode 1.16.0, openclaw 2026.5.5, gemini 0.46.0, cursor 2026.07.23, kimi 2.0.2, workbuddy (bundle CLI), zcode (bundle CLI). Fix whatever fails; record versions + results in `docs/hosts/` updates or a verification note.

### P2 — Model catalogs (pre-release for flagship pair, rest can follow)

Port multica's model-discovery layer in priority order:

1. claude `list_models` control request over the existing stream-json channel (already half-built once P0 lands).
2. codex `codex debug models` (JSON, gate at 0.122.0, live → fallback).
3. cursor `cursor-agent --list-models` (dynamic; ids shift).
4. ACP family (copilot, hermes, kimi, kiro): throwaway ACP process, catalog from `session/new`.
5. Static fallback tables ported from multica `models.go`, flagged non-authoritative and never persisted or validated against.

Surface via daemon API + `oac` CLI; use to warn on unknown configured models (never hard-fail on fallback data).

### P3 — Safety net for locally untestable platforms (copilot, hermes, pi, kiro, standalone CodeBuddy)

- Their invocation shapes are confirmed current against multica HEAD (copilot verified byte-identical today; ACP family identical in both projects).
- Fixture tests: drive OAC's backend parsers with recorded/transcript event streams shaped like current CLI output to lock parsing behavior.
- Optional drift detector: `scripts/check-cli-flags.mjs` — install CLIs (no auth needed for `--help`), assert expected flags exist; run manually before releases.

### P4 — Post-release follow-ups (explicitly out of scope this round)

- New platforms from multica: qwen, grok, antigravity, qoder/qoderclicn, traecli, codearts, deveco, mcode, dim, zeroclaw, reasonix, omp. Each is a small round on the existing registry+backend pattern.
- Feature parity: codex `turn/steer` + service tiers, effort/thinking levels, continuous re-detection cadence (multica: 2-min availability / 10-min version sweeps) if OAC's recovery loop proves insufficient.

## Decisions needed

1. P2 scope at release: (a) full catalog layer, (b) claude + codex + cursor only (recommended), or (c) defer all of P2.
2. Gemini: keep as supported (flags verified current) — confirm.
3. New platforms (P4 list): confirm deferral to post-release.
