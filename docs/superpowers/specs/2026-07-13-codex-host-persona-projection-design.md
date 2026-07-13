# Codex Host Persona Projection

## Decision

Open Agent Connect will add an additive host-persona projection for Codex. It compiles one local MetaBot profile into a Codex custom agent file without changing the MetaBot profile, A2A chat behavior, skill policy, or the host's installed capabilities.

The first host is Codex only. Other host adapters can be added after the Codex behavior is proven stable.

Persona projection is automatic when a profile create or update successfully
saves non-empty `role`, `soul`, or `goal` values through the shared daemon
profile workflow. This covers both `/ui/bot` and host Skills that use
`metabot bot update`. Clearing all three values removes the OAC-owned Codex
projection. Projection errors are reported separately and do not roll back a
profile or chain write that has already succeeded.

## Command Surface

```bash
metabot host persona bind --host codex [--from <bot-slug>]
metabot host persona status --host codex [--from <bot-slug>]
metabot host persona unbind --host codex [--from <bot-slug>]
```

When `--from` is omitted, the active local MetaBot identity is used.
These commands remain available for diagnostics and manual lifecycle control;
normal persona editing does not require the user to run them.

## Projection Contract

The Codex adapter writes one OAC-owned file:

```text
${CODEX_HOME:-$HOME/.codex}/agents/metabot-<profile-slug>.toml
```

The file contains only Codex custom-agent identity fields:

- `name`: the MetaBot display name.
- `description`: a concise routing description derived from `BIO.md`, with a deterministic fallback.
- `developer_instructions`: a generated persona overlay containing `ROLE.md`, `SOUL.md`, and `GOAL.md`, plus host-boundary instructions.

It deliberately does not set model, sandbox, approval, tools, MCP, skills, or workspace configuration. Codex therefore retains its normal local capabilities and project instructions.

## Capability Boundary

Host persona projection and A2A execution remain separate runtime paths:

- A2A chat continues to apply its existing skill resolution and strict isolation rules.
- Codex custom-agent execution continues to use the host's installed skills, tools, MCP servers, sandbox, approval policy, and project `AGENTS.md`.
- A persona does not grant wallet, signing, chain-write, or other authority.
- Identity-sensitive OAC commands should continue to identify the actor explicitly with `--from <profile-slug>`.

## Ownership And Safety

Generated TOML files contain an OAC ownership marker and profile slug. Binding may create, refresh, or leave an identical file unchanged. OAC refuses to overwrite or remove an unowned file at the generated path.

Writes use a temporary file followed by rename. Status reports `unbound`, `current`, `stale`, or `conflict` without modifying host state.

## Non-Goals

- Making the root Codex conversation permanently use a MetaBot identity.
- Changing the existing A2A prompt or `chatSkills` behavior.
- Installing, removing, or restricting Codex skills and tools.
- Projecting personas to hosts other than Codex in this phase.
