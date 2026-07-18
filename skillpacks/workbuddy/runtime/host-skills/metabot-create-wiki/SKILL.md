---
name: metabot-create-wiki
description: Create a dedicated local Wiki skill from one raw document directory, install it into the shared ~/.metabot/skills skill root, and host bind it so the current platform can use absorb, index, query, wiki_build, and publish workflows.
---

# metabot-create-wiki

Use this skill when a user wants to turn a specific document folder into a dedicated local Wiki skill that can be used by the current Open Agent Connect host.

## Host Adapter

Generated for WorkBuddy.

- Default skill root: `$HOME/.workbuddy/skills`
- Host pack id: `workbuddy`
- Primary CLI path: `$HOME/.metabot/bin/metabot`

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.


## Actor Selection

- Use the current local MetaBot identity for commands that need the OAC CLI.
- If the user names a specific local identity, pass that value through as the actor/from field for publishing actions.
- Do not ask for an identity when the user only wants to scaffold a local Wiki skill.

## Required Inputs

Collect these fields before scaffolding:

1. `skillName`: short lowercase skill id, for example `metaid-wiki`.
2. `rawSourceDir`: absolute path to the source document directory.
3. `title`: user-facing Wiki title.
4. `description`: one sentence describing the generated Wiki skill.

Optional fields:

- `aliases`: alternate names for the Wiki skill.
- `workspaceRoot`: custom internal workspace directory. The default is inside the generated skill.
- `registryHome`: custom private registry directory. The default is inside the generated skill.
- `siteTitle`: static site title. The default is `title`.
- `targetRoot`: install root. The default is `~/.metabot/skills`.
- `host` or `bindHosts`: host ids to bind after creation. Supported values are `codex`, `claude-code`, and `openclaw`.
- `overwrite`: replace an existing generated skill with the same name.
- `overwriteHostBinding`: replace an existing host symlink for the generated skill.

## Scaffold Command

Use the shared installed skill path when available:

```bash
node "$HOME/.metabot/skills/metabot-create-wiki/scripts/scaffold-wiki-skill.js" --payload '<JSON>'
```

If this repository checkout is being used directly, use the repository path to the same script.

Minimum payload:

```json
{
  "skillName": "metaid-wiki",
  "title": "MetaID Wiki",
  "description": "Dedicated local Wiki skill for MetaID documents.",
  "rawSourceDir": "/absolute/path/to/raw"
}
```

Recommended payload when the current host is known:

```json
{
  "skillName": "metaid-wiki",
  "title": "MetaID Wiki",
  "description": "Dedicated local Wiki skill for MetaID documents.",
  "rawSourceDir": "/absolute/path/to/raw",
  "targetRoot": "/Users/example/.metabot/skills",
  "host": "codex"
}
```

## Generated Skill

The scaffold creates a new directory under the shared skill root:

- `SKILL.md`
- `wiki.config.json`
- `scripts/index.js`
- `references/payload-schema-v1.json`
- `runtime/metabot-llm-wiki/`

The generated skill embeds its own wiki runtime. Users do not need to install a separate `metabot-llm-wiki` skill.

## Host Bind

The scaffold host bind step creates a host-native skill entry that points back to the shared skill directory. This keeps the generated Wiki skill in `~/.metabot/skills` while making it visible to the current platform.

If automatic host detection is not enough, rerun the scaffold with `host` or `bindHosts`.

## Generated Actions

The generated Wiki skill supports:

- `init`
- `ingest`
- `index`
- `absorb`
- `query`
- `wiki_build`
- `bundle_zip`
- `publish_zip`
- `publish_snapshot`
- `publish_all`

## Operating Rules

- The generated skill is one-to-one: one skill name, one description, one raw document source.
- `absorb`, `ingest`, `index`, `wiki_build`, and publishing actions mirror `rawSourceDir` into the generated skill workspace.
- Normal `query` reads the existing local index and does not mirror raw files or rebuild indexes.
- After source documents change, run `absorb`, then run `query`.
- If the user explicitly needs update-and-query behavior, pass `autoAbsorb:true` or `refresh:true` to `query`.
- `wiki_build` and `publish_*` actions should use the latest mirrored/indexed data.
- ZIP upload uses the OAC `metabot file upload-large` command.
- On-chain snapshot publishing uses the OAC `metabot chain write` command.

## Completion

Report the generated skill path, raw source path, host binding status, and the available actions. Mention any scaffold warnings exactly enough for the user to act on them.
