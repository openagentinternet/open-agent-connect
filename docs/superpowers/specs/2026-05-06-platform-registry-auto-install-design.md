# Platform Registry and Host-Agnostic Install Design

## Goal

Make end-user installation platform-agnostic:

```bash
npm i -g open-agent-connect && oac install
```

The user should not need to know whether the current agent host is Codex,
Claude Code, OpenClaw, Gemini CLI, Copilot CLI, or another supported host.
`oac install` should install the shared Open Agent Connect runtime once and
project the shared `metabot-*` skills into all detected, supported agent skill
roots.

## Current State

Open Agent Connect already has two related but separate concepts:

- LLM runtime providers: CLI executors that MetaBot can discover and call.
- Skill hosts: local agent products that read `SKILL.md` style skill
  directories.

The runtime provider list already includes:

- Claude Code
- Codex
- GitHub Copilot CLI
- OpenCode
- OpenClaw
- Hermes
- Gemini CLI
- Pi
- Cursor Agent
- Kimi
- Kiro CLI

The installer and host binder currently know only:

- `codex` -> `${CODEX_HOME:-$HOME/.codex}/skills`
- `claude-code` -> `${CLAUDE_HOME:-$HOME/.claude}/skills`
- `openclaw` -> `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`

This split makes new platform support harder because provider display names,
binary names, skill roots, install docs, and tests can drift.

## Design

Create one platform registry as the source of truth:

```text
src/core/platform/platformRegistry.ts
```

Each platform definition describes runtime metadata, skill-root metadata, or
both:

```ts
export interface PlatformDefinition {
  id: PlatformId;
  displayName: string;
  runtime?: {
    binaryNames: string[];
    versionArgs?: string[];
    authEnv?: string[];
  };
  skills?: {
    roots: PlatformSkillRoot[];
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

Runtime discovery should derive provider display names, supported provider IDs,
and binary names from this registry. Install and bind flows should derive
skill-root targets from the same registry.

## Skill Roots

The registry should include the documented global skill roots for the target
platforms.

Initial entries:

| Platform | Runtime binary | Skill roots |
| --- | --- | --- |
| Claude Code | `claude` | `${CLAUDE_HOME:-$HOME/.claude}/skills`, `$HOME/.agents/skills` |
| Codex | `codex` | `${CODEX_HOME:-$HOME/.codex}/skills`, `$HOME/.agents/skills` |
| GitHub Copilot CLI | `gh` | `$HOME/.copilot/skills`, `$HOME/.agents/skills` |
| OpenCode | `opencode` | `$HOME/.config/opencode/skills`, `$HOME/.claude/skills`, `$HOME/.agents/skills` |
| OpenClaw | `openclaw` | `${OPENCLAW_HOME:-$HOME/.openclaw}/skills`, `$HOME/.agents/skills` |
| Hermes | `hermes` | `$HOME/.hermes/skills` |
| Gemini CLI | `gemini` | `$HOME/.gemini/skills`, `$HOME/.agents/skills` |
| Pi | `pi` | `$HOME/.pi/agent/skills`, `$HOME/.agents/skills` |
| Cursor Agent | `cursor-agent` | `$HOME/.cursor/skills` |
| Kimi | `kimi` | `$HOME/.kimi/skills`, `$HOME/.config/agents/skills`, `$HOME/.agents/skills` |
| Kiro CLI | `kiro-cli` | `$HOME/.kiro/skills` |

`$HOME/.agents/skills` should be treated as the shared cross-agent standard
root. It should be created by default because multiple supported platforms use
it as a global skill root.

Platform-native roots should be auto-bound when their parent host home already
exists. For example:

- If `$HOME/.openclaw` exists, bind `$HOME/.openclaw/skills`.
- If `$HOME/.gemini` exists, bind `$HOME/.gemini/skills`.
- If `$HOME/.kiro` exists, bind `$HOME/.kiro/skills`.

This avoids creating product-specific homes for tools the user has not
installed.

## Install Behavior

`oac install` with no `--host` should:

1. Copy rendered shared skills into `$HOME/.metabot/skills/metabot-*`.
2. Write the primary CLI shim at `$HOME/.metabot/bin/metabot`.
3. Bind all `metabot-*` skills into `$HOME/.agents/skills`.
4. Scan registry skill roots and bind every root whose auto-bind condition is
   satisfied.
5. Return a JSON result with:
   - shared skill root
   - metabot shim path
   - installed skill names
   - bound roots
   - skipped roots and reasons
   - version

`oac install --host <platform>` should remain supported as a force-bind escape
hatch. It should bind every skill root associated with that platform, even if
the platform home directory does not yet exist.

This keeps compatibility with existing documented commands such as:

```bash
oac install --host openclaw
oac doctor --host openclaw
```

The recommended user-facing path becomes:

```bash
npm i -g open-agent-connect && oac install
```

## Doctor Behavior

`oac doctor` with no `--host` should verify:

- shared skills exist under `$HOME/.metabot/skills`
- `$HOME/.metabot/bin/metabot` exists and is executable
- `$HOME/.agents/skills` contains valid symlinks to every shared `metabot-*`
  skill
- every detected auto-bound platform root contains valid symlinks

It should report skipped roots without failing when the corresponding platform
home does not exist.

`oac doctor --host <platform>` should verify the shared install plus all skill
roots for that platform. If a forced host root is missing, it should fail with a
clear fix command.

## Binding Semantics

The canonical source remains:

```text
$HOME/.metabot/skills/metabot-*
```

Host roots contain directory symlinks:

```text
<host-skill-root>/metabot-* -> $HOME/.metabot/skills/metabot-*
```

Binding should stay idempotent:

- correct symlink: leave unchanged
- stale symlink: replace
- copied directory: replace with symlink
- regular file or unknown object: fail for that root and report the reason

The binder should support binding multiple roots in one command and should not
let one failed optional root prevent successful bindings for other roots unless
the user requested a specific `--host`.

## CLI Surface

Recommended:

```bash
oac install
oac doctor
```

Advanced:

```bash
oac install --host openclaw
oac doctor --host openclaw
metabot host bind-skills --host openclaw
```

New diagnostic command, optional but useful:

```bash
oac platforms
```

It should list supported platforms, runtime binary names, skill roots, and
whether each root is detected on the current machine.

## Non-Goals

- Do not use npm `postinstall` to mutate `$HOME`. Global npm install should
  install package files and binaries only.
- Do not copy independent skill content into each host root.
- Do not remove `--host`; keep it for forced binding, CI, and support.
- Do not hardcode absolute binary paths like `/usr/local/bin/gemini`. Runtime
  discovery should keep using `PATH` plus fixed binary names from the registry.
- Do not create every product-specific home directory during automatic install.

## Migration Plan

1. Add `platformRegistry.ts`.
2. Update `llmTypes.ts` and `llmRuntimeDiscovery.ts` to derive provider
   metadata from the registry.
3. Replace `ConcreteSkillHost`-centric host binding with platform skill root
   binding.
4. Update `oac install` and `oac doctor` to default to auto-bind mode.
5. Keep explicit `--host` support as force-bind mode.
6. Update uninstall to remove OAC symlinks from registry roots, including
   `$HOME/.agents/skills`.
7. Update install and uninstall docs to make
   `npm i -g open-agent-connect && oac install` the primary path.
8. Add tests for registry metadata, auto-bind detection, forced host binding,
   doctor output, and uninstall cleanup.

## Acceptance Criteria

- `npm i -g open-agent-connect && oac install` is the primary documented
  install path.
- Bare `oac install` installs shared skills, writes the metabot shim, and binds
  `$HOME/.agents/skills`.
- Bare `oac install` also binds detected platform-native roots without requiring
  the user to pass `--host`.
- `oac install --host openclaw` still force-binds OpenClaw.
- Runtime discovery still finds all 11 managed providers through registry binary
  names.
- `oac doctor` passes after a fresh bare install in a clean home.
- Tests prove that adding a platform only requires changing the registry and
  expected assertions.
