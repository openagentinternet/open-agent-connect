# Unified Platform Registry and 11 Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OAC's 11-platform support registry-driven so skill installation, runtime discovery, `/ui/bot` display, LLM binary execution, and future platform additions all use one platform configuration source.

**Architecture:** Add `platformRegistry.ts` as the authoritative source for platform IDs, display names, binary names, skill roots, logo paths, install binding rules, runtime discovery metadata, capabilities, and executor metadata. Refactor discovery, installation, UI rendering, skill injection, and executor registration to consume this registry, then port the missing provider executors from multica's Go reference implementation into OAC TypeScript while preserving the existing `LlmBackend` interface.

**Tech Stack:** Node.js 20+, TypeScript CommonJS, built-in `node:test`, OAC daemon HTTP routes, existing `LlmExecutor` abstractions, multica backend source as behavior reference.

---

## Implementation Rules For The New Session

- This plan is the single authoritative implementation handoff for this feature. A fresh session should be able to implement the work by reading this file and no prior chat history.
- Do not split this work into a second design/spec document. Older design notes may be treated only as historical background, not as implementation instructions.
- Keep all docs, code comments, and SKILL documents in English.
- Commit once after each independent, verified development round.
- Before every commit, run the relevant local tests listed in that round.
- After every development round and before committing, spawn a `gpt-5.5` subagent to review code and perform acceptance checks for that round. Use a fresh subagent with only the round goal, changed files, test commands, and acceptance criteria.
- If the reviewer finds issues, fix them, rerun the relevant tests, then re-run review for that round.
- After each successful commit, use the `metabot-post-buzz` skill to post a detailed development diary for that round on-chain.
- Do not use `gpt-5.1-codex-mini` for review or test subagents.
- Do not merge to `main` in this plan unless the user explicitly asks.

### Required Per-Round Review Prompt Template

Use this template after each round:

```text
You are a gpt-5.5 review and acceptance subagent for Open Agent Connect.

Review only the latest round of changes. Do not rewrite unrelated code. Check:
1. The implementation matches docs/superpowers/plans/2026-05-07-unified-platform-registry-11-platform-support.md for this round.
2. The changed files are cohesive and do not duplicate platform metadata outside platformRegistry.ts.
3. Relevant tests pass or the failure is clearly outside this round.
4. Edge cases and backward compatibility called out in the plan are covered.

Inputs:
- Round:
- Changed files:
- Commands run:
- Acceptance criteria:

Return findings first, ordered by severity, with exact file/line references where possible. Then state whether this round is accepted.
```

## Core Design Premise

The purpose of this iteration is to make multi-platform support in OAC explicit, maintainable, and registry-driven. Platform-specific configuration must not be scattered across install code, runtime discovery, `/ui/bot`, skill injection, and executor registration.

`platformRegistry.ts` owns platform configuration. Other modules consume normalized helpers from the registry:

- Install and uninstall code consume skill roots and auto-bind rules.
- Runtime discovery consumes binary names, version args, auth environment hints, capabilities, and display metadata.
- `/ui/bot` consumes runtime display metadata and logo paths delivered by the existing runtime API.
- Skill injection consumes project skill roots.
- Executor registration consumes executor kind metadata and maps it to checked TypeScript backend factories.

Adding or removing a supported platform after this work should primarily mean updating `platformRegistry.ts`, adding a logo asset, and adding tests. A new executor backend should only be required when the platform's runtime protocol is not already covered by an existing executor kind.

## Source Facts And References

Current OAC facts:

- `src/core/platform/platformRegistry.ts` does not exist.
- Provider metadata is hardcoded in `src/core/llm/llmTypes.ts`.
- Runtime discovery is hardcoded in `src/core/llm/llmRuntimeDiscovery.ts`.
- `src/core/llm/executor/` has real backends only for Claude Code and Codex.
- `src/core/llm/executor/backends/openclaw.ts` is an unsupported stub and must be replaced.
- `src/cli/runtime.ts` registers only `codex`, `claude-code`, and `openclaw` executor factories.
- `src/core/system/npmInstall.ts`, `src/core/host/hostSkillBinding.ts`, and `src/core/system/uninstall.ts` know only `codex`, `claude-code`, and `openclaw`.
- `/ui/bot` hardcodes provider logos in `src/ui/pages/bot/app.ts`.
- `/api/bot/runtimes` is handled by `src/daemon/routes/bot.ts`; the default
  runtime handlers in `src/daemon/defaultHandlers.ts` read from
  `createLlmRuntimeStore` / `discoverLlmRuntimes`. Once `LlmRuntime.logoPath`
  is normalized and persisted, `/ui/bot` receives it through this existing API
  path.

Multica behavior reference:

```text
/Users/tusm/Documents/MetaID_Projects/multica/server/pkg/agent/
```

Port behavior from these files:

- `agent.go`: supported provider list and launch headers.
- `claude.go`: Claude stream-json behavior.
- `codex.go`: Codex app-server JSON-RPC behavior.
- `copilot.go`: Copilot JSONL behavior.
- `opencode.go`: OpenCode JSONL behavior.
- `openclaw.go`: OpenClaw JSON/NDJSON stderr behavior.
- `hermes.go`: reusable ACP client behavior.
- `gemini.go`: Gemini stream-json behavior.
- `pi.go`: Pi JSONL/session-file behavior.
- `cursor.go`: Cursor stream-json behavior.
- `kimi.go`: Kimi ACP behavior and tool-name normalization.
- `kiro.go`: Kiro ACP behavior and session/load resume behavior.

External docs to preserve in design references:

- GitHub Copilot CLI: `https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference`
- GitHub Copilot skills: `https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills`
- OpenCode skills: `https://opencode.ai/docs/skills`
- OpenClaw skills: `https://docs.openclaw.ai/tools/creating-skills`
- Pi skills: `https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/skills.md`
- Kimi skills: `https://moonshotai.github.io/kimi-cli/en/customization/skills.html`
- Kiro skills: `https://kiro.dev/docs/cli/skills/`

## Target Provider Matrix

Keep these OAC provider IDs stable:

| Provider ID | Display name | Binary | Skill roots | Executor kind | Launch skeleton |
| --- | --- | --- | --- | --- | --- |
| `claude-code` | Claude Code | `claude` | `${CLAUDE_HOME:-~/.claude}/skills`, `~/.agents/skills` | `claude-stream-json` | `claude -p --output-format stream-json` |
| `codex` | Codex (OpenAI) | `codex` | `${CODEX_HOME:-~/.codex}/skills`, `~/.agents/skills` | `codex-app-server` | `codex app-server --listen stdio://` |
| `copilot` | GitHub Copilot CLI | `copilot` | `${COPILOT_HOME:-~/.copilot}/skills`, `~/.agents/skills` | `copilot-json` | `copilot -p <prompt> --output-format json --allow-all --no-ask-user` |
| `opencode` | OpenCode | `opencode` | `~/.config/opencode/skills`, `~/.claude/skills`, `~/.agents/skills` | `opencode-json` | `opencode run --format json` |
| `openclaw` | OpenClaw | `openclaw` | `${OPENCLAW_HOME:-~/.openclaw}/skills`, `~/.agents/skills` | `openclaw-json` | `openclaw agent --local --json --session-id <id> --message <prompt>` |
| `hermes` | Hermes | `hermes` | `~/.hermes/skills` | `acp-hermes` | `hermes acp` |
| `gemini` | Gemini CLI | `gemini` | `~/.gemini/skills`, `~/.agents/skills` | `gemini-stream-json` | `gemini -p <prompt> --yolo -o stream-json` |
| `pi` | Pi | `pi` | `~/.pi/agent/skills`, `~/.agents/skills` | `pi-json` | `pi -p --mode json --session <path>` |
| `cursor` | Cursor Agent | `cursor-agent` | `~/.cursor/skills` | `cursor-stream-json` | `cursor-agent chat -p <prompt> --output-format stream-json --yolo` |
| `kimi` | Kimi | `kimi` | `~/.kimi/skills`, `~/.config/agents/skills`, `~/.agents/skills` | `acp-kimi` | `kimi acp` |
| `kiro` | Kiro CLI | `kiro-cli` | `~/.kiro/skills` | `acp-kiro` | `kiro-cli acp --trust-all-tools` |

Use `copilot` as the runtime binary for the new GitHub Copilot CLI. Do not use the legacy `gh` extension path for executor launch in this implementation.

## Task 1: Registry And Metadata Foundation

**Files:**

- Create: `src/core/platform/platformRegistry.ts`
- Modify: `src/core/llm/llmTypes.ts`
- Test: `tests/llm/llmProviderExpansion.test.mjs`

- [ ] Step 1: Add failing tests for registry metadata.

Test expectations:

- All 11 provider IDs appear in registry order.
- `claude-code` remains the OAC ID for Claude Code.
- Every managed runtime has `displayName`, `binaryNames`, `logoPath`, `executor`, and `capabilities`.
- Every provider with install support has at least one `skillRoots` entry.
- `SUPPORTED_LLM_PROVIDERS`, `HOST_SEARCH_ORDER`, `HOST_BINARY_MAP`, and `PROVIDER_DISPLAY_NAMES` are derived from the registry.
- `HOST_BINARY_MAP.copilot` changes from `gh` to `copilot`.

Run:

```bash
npm run build && node --test tests/llm/llmProviderExpansion.test.mjs
```

Expected before implementation: failing assertions or missing module.

- [ ] Step 2: Implement `platformRegistry.ts`.

Include these exported types and helpers:

```ts
export type PlatformId =
  | 'claude-code'
  | 'codex'
  | 'copilot'
  | 'opencode'
  | 'openclaw'
  | 'hermes'
  | 'gemini'
  | 'pi'
  | 'cursor'
  | 'kimi'
  | 'kiro';

export type PlatformExecutorKind =
  | 'claude-stream-json'
  | 'codex-app-server'
  | 'copilot-json'
  | 'opencode-json'
  | 'openclaw-json'
  | 'acp-hermes'
  | 'gemini-stream-json'
  | 'pi-json'
  | 'cursor-stream-json'
  | 'acp-kimi'
  | 'acp-kiro';

export interface PlatformDefinition {
  id: PlatformId;
  displayName: string;
  logoPath: string;
  runtime: {
    binaryNames: string[];
    versionArgs: string[];
    authEnv: string[];
    capabilities: string[];
  };
  skills: {
    roots: PlatformSkillRoot[];
  };
  executor: {
    kind: PlatformExecutorKind;
    backendFactoryExport: string;
    launchCommand: string;
    multicaReferencePath: string;
  };
}

export interface PlatformSkillRoot {
  id: string;
  kind: 'global' | 'project';
  homeEnv?: string;
  path: string;
  autoBind: 'always' | 'when-parent-exists' | 'manual';
  sharedStandard?: boolean;
}
```

Required helper exports:

- `PLATFORM_DEFINITIONS`
- `SUPPORTED_PLATFORM_IDS`
- `getPlatformDefinition(id)`
- `isPlatformId(value)`
- `getRuntimePlatforms()`
- `getPlatformDisplayNames()`
- `getPlatformBinaryMap()`
- `getPlatformSearchOrder()`
- `getPlatformSkillRoots(id)`
- `getProjectSkillRoot(id)`
- `getInstallSkillRoots()`

- [ ] Step 3: Refactor `llmTypes.ts` to import registry helpers.

Keep public exports stable:

- `LlmProvider`
- `SUPPORTED_LLM_PROVIDERS`
- `HOST_BINARY_MAP`
- `PROVIDER_DISPLAY_NAMES`
- `HOST_SEARCH_ORDER`
- `isLlmProvider`

Add `logoPath?: string` to `LlmRuntime` and normalize it.

- [ ] Step 4: Run the metadata test.

Run:

```bash
npm run build && node --test tests/llm/llmProviderExpansion.test.mjs
```

- [ ] Step 5: Review round with a `gpt-5.5` subagent using the required review prompt.
- [ ] Step 6: Commit this round.
- [ ] Step 7: Use `metabot-post-buzz` to post a detailed diary for this round.

## Task 2: Runtime Discovery And Logo Propagation

**Files:**

- Modify: `src/core/llm/llmRuntimeDiscovery.ts`
- Modify: `src/core/llm/llmTypes.ts` if Task 1 did not complete normalization
- Test: `tests/llm/llmProviderExpansion.test.mjs`

- [ ] Step 1: Add failing tests for discovery from registry.

Test expectations:

- Discovery iterates registry runtime platforms.
- Fake `copilot`, `cursor-agent`, and `kiro-cli` binaries are discovered through registry binary names.
- Discovered runtimes include `displayName`, `logoPath`, `capabilities`, `version`, and `authState`.
- Discovery supports multiple `binaryNames` per platform even if the initial registry only uses one primary binary for most providers.

- [ ] Step 2: Refactor discovery.

Implementation details:

- Replace imports from `SUPPORTED_LLM_PROVIDERS`, `HOST_BINARY_MAP`, and `PROVIDER_DISPLAY_NAMES` with registry helpers.
- For each platform, try `runtime.binaryNames` in order and use the first executable found on `PATH`.
- Run `versionArgs`, defaulting to `['--version']`.
- Derive auth state from `runtime.authEnv`.
- Include `logoPath` and `capabilities` on returned `LlmRuntime`.

- [ ] Step 3: Preserve custom runtime behavior.

`custom` remains allowed by `isLlmProvider`, but registry discovery must not attempt to discover `custom`.

- [ ] Step 4: Run tests.

```bash
npm run build && node --test tests/llm/llmProviderExpansion.test.mjs
```

- [ ] Step 5: Review round with a `gpt-5.5` subagent.
- [ ] Step 6: Commit this round.
- [ ] Step 7: Post the development diary with `metabot-post-buzz`.

## Task 3: UI Logo Assets And `/ui/bot` Rendering

**Files:**

- Create: `src/ui/assets/platforms/claude-code.svg`
- Create: `src/ui/assets/platforms/codex.svg`
- Create: `src/ui/assets/platforms/copilot.svg`
- Create: `src/ui/assets/platforms/opencode.svg`
- Create: `src/ui/assets/platforms/openclaw.svg`
- Create: `src/ui/assets/platforms/hermes.svg`
- Create: `src/ui/assets/platforms/gemini.svg`
- Create: `src/ui/assets/platforms/pi.svg`
- Create: `src/ui/assets/platforms/cursor.svg`
- Create: `src/ui/assets/platforms/kimi.svg`
- Create: `src/ui/assets/platforms/kiro.svg`
- Create: `src/ui/assets/platforms/generic.svg`
- Modify: `src/daemon/routes/ui.ts`
- Modify: `src/ui/pages/bot/app.ts`
- Test: `tests/ui/botPageScript.test.mjs`
- Test: `tests/daemon/httpServer.test.mjs`

- [ ] Step 1: Add failing UI tests.

Test expectations:

- Bot page script does not contain the old inline `var icons={...}` provider logo map.
- `providerIconMarkup` renders an `<img>` or equivalent markup using runtime `logoPath`.
- Fallback provider icon uses `/ui/assets/platforms/generic.svg`.
- HTTP server serves `/ui/assets/platforms/codex.svg` with SVG content type.

- [ ] Step 2: Add logo files.

Use lightweight SVG files. The exact artwork can be adapted from the existing inline SVGs in `src/ui/pages/bot/app.ts` and the multica `packages/views/runtimes/components/provider-logo.tsx` reference, but each logo must be a separate asset file.

Do not embed large base64 images in `platformRegistry.ts`.

- [ ] Step 3: Serve UI assets.

In `src/daemon/routes/ui.ts`, add a GET-only route for:

```text
/ui/assets/platforms/<filename>
```

Resolve candidates in this order:

```text
dist/ui/assets/platforms/<filename>
src/ui/assets/platforms/<filename>
```

Allow only plain filenames ending in `.svg`, `.png`, `.webp`, `.jpg`, or `.jpeg`. Reject path traversal.

- [ ] Step 4: Update bot page rendering.

Implementation details:

- Add a helper that finds runtime metadata by provider from `state.runtimes`.
- `providerIconMarkup(provider)` should use `runtime.logoPath` when available.
- Use generic logo fallback when no runtime exists.
- Keep provider-specific CSS classes only for styling hooks; do not use them as data source.

- [ ] Step 5: Run tests.

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
```

- [ ] Step 6: Review round with a `gpt-5.5` subagent.
- [ ] Step 7: Commit this round.
- [ ] Step 8: Post the development diary with `metabot-post-buzz`.

## Task 4: Platform Skill Binding And OAC Install

**Files:**

- Modify: `src/core/host/hostSkillBinding.ts`
- Modify: `src/core/system/npmInstall.ts`
- Modify: `src/core/system/uninstall.ts`
- Modify: `src/oac/main.ts`
- Modify: `src/cli/commands/host.ts`
- Modify: `src/cli/commands/skills.ts`
- Modify: `src/core/skills/skillContractTypes.ts`
- Test: `tests/oac/install.test.mjs`
- Test: `tests/skillpacks/hostBindSmoke.test.mjs`
- Test: `tests/cli/hostCommand.test.mjs`
- Test: `tests/cli/skills.test.mjs`

- [ ] Step 1: Add failing install/bind tests.

Test expectations:

- Bare `oac install` creates shared skills, shim, and `~/.agents/skills` symlinks.
- Bare `oac install` auto-binds platform-native roots only when the platform home parent exists.
- `oac install --host openclaw` force-creates/binds `~/.openclaw/skills`.
- `oac doctor` verifies auto-bound roots and reports skipped roots without failing.
- `oac doctor --host openclaw` fails if forced OpenClaw bindings are missing.
- `oac uninstall` removes guarded OAC symlinks from every registry root and does not remove non-OAC files.

- [ ] Step 2: Replace single-host binding with multi-root binding.

New shape:

```ts
export interface BindPlatformSkillsInput {
  systemHomeDir: string;
  env?: NodeJS.ProcessEnv;
  host?: PlatformId;
  mode: 'auto' | 'force-platform';
}

export interface BoundPlatformSkillRootResult {
  platformId: PlatformId | 'shared-agents';
  rootId: string;
  hostSkillRoot: string;
  status: 'bound' | 'skipped' | 'failed';
  reason?: string;
  boundSkills: string[];
  replacedEntries: string[];
  unchangedEntries: string[];
}
```

Behavior:

- Shared root `~/.agents/skills` is always bound in bare install.
- `autoBind: 'when-parent-exists'` roots are bound only if the parent platform home exists.
- `--host <platform>` force-binds all registry roots for that platform.
- One optional root failure should not fail the entire bare install if other roots succeeded.
- A forced `--host` root failure must fail the command.

- [ ] Step 3: Update OAC command output.

`runNpmInstall` result should include:

- `sharedSkillRoot`
- `metabotShimPath`
- `installedSkills`
- `boundRoots`
- `skippedRoots`
- `failedRoots`
- `version`
- `host` only when `--host` was explicitly used, for backward compatibility.

- [ ] Step 4: Update `oac --help`.

Help should make the primary path clear:

```text
oac install
oac doctor
oac install --host <platform>
```

The host list must be registry-derived.

- [ ] Step 5: Update host and skills commands.

Existing commands that accept `--host` should accept all registry `PlatformId` values that have skill roots.

- [ ] Step 6: Run tests.

```bash
npm run build && node --test tests/oac/install.test.mjs tests/skillpacks/hostBindSmoke.test.mjs tests/cli/hostCommand.test.mjs tests/cli/skills.test.mjs
```

- [ ] Step 7: Review round with a `gpt-5.5` subagent.
- [ ] Step 8: Commit this round.
- [ ] Step 9: Post the development diary with `metabot-post-buzz`.

## Task 5: Verify Existing Claude And Codex Backends Against Registry

**Files:**

- Test: `tests/llm/llmExecutorCore.test.mjs`

- [ ] Step 1: Add tests that explicitly preserve Claude and Codex backend coverage as part of the 11-platform acceptance matrix.

Test expectations:

- Claude Code keeps using the existing stream-json backend behavior and remains mapped to OAC provider ID `claude-code`.
- Codex keeps using the existing `app-server --listen stdio://` backend behavior.
- The registry executor metadata for `claude-code` points to `claude.go`.
- The registry executor metadata for `codex` points to `codex.go`.
- Existing fake CLI tests for Claude and Codex still assert argv skeleton, stream parsing, tool events, session IDs, usage, and timeout/error behavior.

- [ ] Step 2: Add or strengthen assertions in existing Claude and Codex fake CLI tests.

Do not rewrite the existing Claude and Codex backends unless the tests reveal a mismatch with the registry contract.

- [ ] Step 3: Run tests.

```bash
npm run build && node --test tests/llm/llmExecutorCore.test.mjs tests/llm/llmProviderExpansion.test.mjs
```

- [ ] Step 4: Review round with a `gpt-5.5` subagent.
- [ ] Step 5: Commit this round.
- [ ] Step 6: Post the development diary with `metabot-post-buzz`.

## Task 6: Port JSON And Stream-JSON Backends

**Files:**

- Modify: `src/core/llm/executor/backends/openclaw.ts`
- Create: `src/core/llm/executor/backends/copilot.ts`
- Create: `src/core/llm/executor/backends/opencode.ts`
- Create: `src/core/llm/executor/backends/gemini.ts`
- Create: `src/core/llm/executor/backends/pi.ts`
- Create: `src/core/llm/executor/backends/cursor.ts`
- Modify: `src/core/llm/executor/index.ts`
- Test: `tests/llm/llmExecutorCore.test.mjs`

- [ ] Step 1: Add fake-binary tests for each backend.

For every backend, test:

- argv skeleton and blocked-arg filtering
- cwd propagation
- env propagation
- text event streaming
- thinking event streaming when protocol supports it
- tool use and tool result event normalization
- final result status
- provider session ID
- token usage where protocol emits usage
- timeout/cancel behavior for at least one representative process backend

- [ ] Step 2: Replace OpenClaw stub.

Port behavior from multica `openclaw.go`:

- launch `openclaw agent --local --json --session-id <id>`
- generate a session ID if `request.resumeSessionId` is absent
- append `--agent <request.model>` when model is set and custom args do not already set `--agent`
- prepend system prompt into message text because OpenClaw does not accept `--system-prompt`
- pass prompt through `--message`
- read JSON/NDJSON from stderr
- log stdout as diagnostic output only
- parse text, tool use, tool result, errors, status, final result, model, and usage

- [ ] Step 3: Add Copilot backend.

Port behavior from multica `copilot.go`:

- launch `copilot -p <prompt> --output-format json --allow-all --no-ask-user`
- support `--model <model>`
- support `--resume <session-id>`
- parse JSONL events:
  - `session.start`
  - `assistant.message_delta`
  - `assistant.message`
  - `assistant.reasoning`
  - `assistant.reasoning_delta`
  - `tool.execution_complete`
  - `assistant.turn_start`
  - `session.error`
  - `session.warning`
  - `result`

- [ ] Step 4: Add OpenCode backend.

Port behavior from multica `opencode.go`:

- launch `opencode run --format json`
- support `--model`, `--prompt <systemPrompt>`, and `--session`
- append prompt as final positional argument
- set `OPENCODE_PERMISSION={"*":"allow"}`
- parse text, tool use, tool result, step start, step finish usage, and error events

- [ ] Step 5: Add Gemini backend.

Port behavior from multica `gemini.go`:

- launch `gemini -p <prompt> --yolo -o stream-json`
- support `-m <model>` and `-r <resumeSessionId>`
- parse init, assistant messages, tool use, tool result, errors, result status, and stats usage

- [ ] Step 6: Add Pi backend.

Port behavior from multica `pi.go`, but store session files under OAC:

```text
~/.metabot/runtime/pi-sessions/
```

Behavior:

- launch `pi -p --mode json --session <path> <prompt>`
- create the session JSONL file before launch
- treat session path as provider session ID
- split `request.model` in `provider/model` form into `--provider` and `--model`
- pass tool allowlist `read,bash,edit,write,grep,find,ls`
- pass `--append-system-prompt` when system prompt exists
- parse message deltas, thinking deltas, tool start/end, turn usage, errors, and retry failures

- [ ] Step 7: Add Cursor backend.

Port behavior from multica `cursor.go`:

- launch `cursor-agent chat -p <prompt> --output-format stream-json --yolo`
- pass `--workspace <cwd>` when cwd exists
- support `--model` and `--resume`
- normalize `stdout:` or `stderr:` stream prefixes
- parse system init/error, assistant blocks, tool use, tool result, text, step finish usage, and result usage

- [ ] Step 8: Run tests.

```bash
npm run build && node --test tests/llm/llmExecutorCore.test.mjs
```

- [ ] Step 9: Review round with a `gpt-5.5` subagent.
- [ ] Step 10: Commit this round.
- [ ] Step 11: Post the development diary with `metabot-post-buzz`.

## Task 7: Port Shared ACP Backends

**Files:**

- Create: `src/core/llm/executor/backends/acp.ts`
- Create: `src/core/llm/executor/backends/hermes.ts`
- Create: `src/core/llm/executor/backends/kimi.ts`
- Create: `src/core/llm/executor/backends/kiro.ts`
- Modify: `src/core/llm/executor/index.ts`
- Test: `tests/llm/llmExecutorCore.test.mjs`

- [ ] Step 1: Add fake ACP-server tests.

Test each provider:

- Hermes launches `hermes acp`.
- Kimi launches `kimi acp`.
- Kiro launches `kiro-cli acp --trust-all-tools`.
- Initialize request shape is correct.
- New session request returns provider session ID.
- Resume uses provider-specific method:
  - Hermes: `session/resume`
  - Kimi: `session/resume`
  - Kiro: `session/load`
- `session/set_model` is called and failures fail the task.
- `session/prompt` streams text, thinking, tool use, tool result, and usage.
- Permission requests are auto-approved.
- Provider stderr errors are surfaced when output is empty.

- [ ] Step 2: Implement shared ACP transport.

Port the reusable parts from multica `hermes.go`:

- JSON-RPC request/response tracking
- line scanner
- notification handling
- `session/update` and `session/notification` normalization
- `agent_message_chunk`
- `agent_thought_chunk`
- `tool_call`
- `tool_call_update`
- `usage_update`
- `turn_end`
- `session/request_permission` auto-approval
- provider error sniffer for stderr

- [ ] Step 3: Implement provider wrappers.

Provider differences:

- Hermes:
  - env adds `HERMES_YOLO_MODE=1`
  - session new params include `cwd`, optional model, and empty MCP servers
  - drop history replay before current prompt starts
- Kimi:
  - no yolo env
  - auto-approval is handled through ACP permission responses
  - tool-name normalization handles Kimi title casing
- Kiro:
  - launch includes `--trust-all-tools`
  - resume method is `session/load`
  - prompt payload sends both `content` and `prompt` arrays for compatibility
  - tool-name normalization handles Kiro titles

- [ ] Step 4: Run tests.

```bash
npm run build && node --test tests/llm/llmExecutorCore.test.mjs
```

- [ ] Step 5: Review round with a `gpt-5.5` subagent.
- [ ] Step 6: Commit this round.
- [ ] Step 7: Post the development diary with `metabot-post-buzz`.

## Task 8: Registry-Driven Executor Factory Registration

**Files:**

- Create: `src/core/llm/executor/backends/registry.ts`
- Modify: `src/core/llm/executor/index.ts`
- Modify: `src/cli/runtime.ts`
- Test: `tests/llm/llmExecutorCore.test.mjs`

- [ ] Step 1: Add failing tests for backend registration.

Test expectations:

- A helper returns backend factories for every managed provider ID.
- `claude-code` resolves to the existing Claude backend factory.
- `codex` resolves to the existing Codex backend factory.
- `openclaw` resolves to the new real OpenClaw factory, not an unsupported stub.
- `LlmExecutor` can be constructed from the registry-derived factories.
- No provider factory map is manually hardcoded in `src/cli/runtime.ts`.

- [ ] Step 2: Add backend factory registry helper.

Create:

```ts
export function createRegistryBackendFactories(): Record<string, LlmBackendFactory>
```

This helper maps `PlatformExecutorKind` to factory exports.

Do not instantiate backends by string-eval or dynamic import. Use explicit imports in one file so TypeScript can check them.

- [ ] Step 3: Update `src/cli/runtime.ts`.

Replace:

```ts
{
  codex: codexBackendFactory,
  'claude-code': claudeBackendFactory,
  openclaw: openClawBackendFactory,
}
```

with:

```ts
createRegistryBackendFactories()
```

- [ ] Step 4: Run tests.

```bash
npm run build && node --test tests/llm/llmExecutorCore.test.mjs
```

- [ ] Step 5: Review round with a `gpt-5.5` subagent.
- [ ] Step 6: Commit this round.
- [ ] Step 7: Post the development diary with `metabot-post-buzz`.

## Task 9: Skill Injection Uses Registry Roots

**Files:**

- Modify: `src/core/llm/executor/skill-injector.ts`
- Test: `tests/llm/llmExecutorCore.test.mjs`

- [ ] Step 1: Add failing tests.

Test expectations:

- Provider skill injection root is registry-derived.
- `claude-code` injects into project `.claude/skills`.
- `codex` injects into project `.codex/skills`.
- `openclaw` injects into project `.openclaw/skills`.
- `gemini` injects into project `.gemini/skills`.
- Providers without a project skill root fall back to `.agent_context/skills`.

- [ ] Step 2: Add project-skill-root metadata to registry if missing.

Keep install roots and executor injection roots distinct:

- Install roots are user-level/global roots.
- Executor injection roots are cwd/project roots.

- [ ] Step 3: Refactor `resolveProviderSkillRoot`.

Use registry project roots first. Keep fallback:

```text
<cwd>/.agent_context/skills
```

- [ ] Step 4: Run tests.

```bash
npm run build && node --test tests/llm/llmExecutorCore.test.mjs
```

- [ ] Step 5: Review round with a `gpt-5.5` subagent.
- [ ] Step 6: Commit this round.
- [ ] Step 7: Post the development diary with `metabot-post-buzz`.

## Task 10: Docs And User-Facing Install Guidance

**Files:**

- Modify: `docs/install/open-agent-connect.md`
- Modify: `README.md`
- Test: `tests/docs/codexInstallDocs.test.mjs`
- Test: `tests/docs/askMasterReleaseDocs.test.mjs`

- [ ] Step 1: Add failing docs tests for install command.

Test expectations:

- Primary install command is:

```bash
npm i -g open-agent-connect && oac install
```

- `oac install --host openclaw` is documented as advanced/force-bind, not primary.
- Docs mention supported platforms and shared `~/.metabot/skills` source with host symlinks.

- [ ] Step 2: Update docs.

Docs must explain:

- Skills are installed once under `~/.metabot/skills`.
- Host roots contain symlinks pointing to `~/.metabot/skills/metabot-*`.
- Bare `oac install` binds `~/.agents/skills` and detected platform roots.
- `--host` is only needed when forcing a platform root before the platform home exists.
- Runtime discovery and `/ui/bot` logos come from `platformRegistry.ts`.
- Do not update `README.zh-CN.md` in this round unless the user explicitly asks
  for localized release docs. The repo rule for this work is that new or
  modified documentation is English.

- [ ] Step 3: Run docs tests.

```bash
npm run build && node --test tests/docs/codexInstallDocs.test.mjs tests/docs/askMasterReleaseDocs.test.mjs
```

- [ ] Step 4: Review round with a `gpt-5.5` subagent.
- [ ] Step 5: Commit this round.
- [ ] Step 6: Post the development diary with `metabot-post-buzz`.

## Task 11: Final Integration Verification

**Files:**

- No planned source changes unless verification finds issues.

- [ ] Step 1: Run full verification.

```bash
npm run build
npm test
```

- [ ] Step 2: Manually smoke-check key flows in a temporary HOME.

```bash
TMP_HOME="$(mktemp -d)"
HOME="$TMP_HOME" node dist/oac/main.js install
HOME="$TMP_HOME" node dist/oac/main.js doctor
find "$TMP_HOME/.metabot/skills" -maxdepth 2 -name SKILL.md -print
find "$TMP_HOME/.agents/skills" -maxdepth 1 -type l -print
```

Expected:

- Install succeeds.
- Doctor succeeds.
- Shared skills exist.
- `~/.agents/skills/metabot-*` entries are symlinks to `~/.metabot/skills/metabot-*`.

- [ ] Step 3: Verify all registry providers have backend factories.

Use a small Node script or test assertion against built `dist`:

```js
const { SUPPORTED_LLM_PROVIDERS } = require('./dist/core/llm/llmTypes.js');
const { createRegistryBackendFactories } = require('./dist/core/llm/executor/backends/registry.js');
const factories = createRegistryBackendFactories();
for (const provider of SUPPORTED_LLM_PROVIDERS) {
  if (!factories[provider]) throw new Error(`missing factory: ${provider}`);
}
```

- [ ] Step 4: Final review with a `gpt-5.5` subagent.

The final reviewer must inspect:

- `git diff main...HEAD` or current working tree diff if not on a branch.
- Registry as the only source of platform metadata.
- All tests and smoke commands.
- Backward compatibility for `--host`.
- Absence of unsupported OpenClaw stub behavior.

- [ ] Step 5: Commit final verification/docs fixes if any.
- [ ] Step 6: Post final development diary with `metabot-post-buzz`.

## Acceptance Criteria

- `platformRegistry.ts` exists and is the source for supported platforms, display names, binaries, skill roots, logos, and executor metadata.
- Runtime discovery finds all 11 managed providers through registry metadata and returns `logoPath`.
- `/ui/bot` renders runtime logos from API/runtime metadata, not a hardcoded frontend icon map.
- Bare `oac install` installs shared skills and binds `~/.agents/skills` plus detected platform roots.
- `oac install --host <platform>` still force-binds that platform.
- `oac doctor` verifies the new multi-root install state.
- `oac uninstall` removes guarded OAC symlinks from all registry roots.
- `LlmExecutor` registers all 11 managed provider backends through registry-derived factories.
- OpenClaw has a real backend and no longer returns an unsupported stub error.
- Claude Code, Codex, Copilot, OpenCode, OpenClaw, Gemini, Pi, Cursor, Hermes,
  Kimi, and Kiro backend behavior is covered by fake CLI tests or preserved
  existing fake CLI tests.
- `npm test` passes.
