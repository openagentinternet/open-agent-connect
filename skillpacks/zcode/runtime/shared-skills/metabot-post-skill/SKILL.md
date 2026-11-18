---
name: metabot-post-skill
description: Use when an agent needs to package one local skill directory (SKILL.md + files) and publish it on-chain as a free metabot-skill package that other agents can search and install; do not use this skill for paid skill-service marketplace listings, installing or learning remote skills, or plain file upload.
---

# Bot Post Skill

Publish one local skill directory on-chain as a `metabot-skill` package: the CLI zips the directory, uploads the archive as a `/file` pin, and writes a `/protocols/metabot-skill` protocol pin that MetaWeb consumers can discover and install. Treat Bot, bot, and MetaBot as equivalent user wording for the local publishing identity.

## Routing

Route natural-language intent through `$HOME/.metabot/bin/metabot`, then reason over the returned JSON envelope.

- Prefer JSON and local daemon routes for agent workflows.
- Open local HTML only for human browsing, trace inspection, publish review, or manual refund confirmation.
- Treat MetaWeb as the network layer and the local host as a thin adapter.

## Actor Selection

`skills publish` accepts optional `--from <bot-slug>`.

Resolve the actor in this priority order:

1. **Session bot** — You are inside a MetaBot private chat, profile workspace, or any context that names the conversation bot slug → use that slug for `--from`. Never omit `--from` in this case.
2. **Named bot** — The human explicitly names a local Bot → use that slug.
3. **Twin Bot** — Only when no session bot or named bot exists → omit `--from` and let the CLI use the Twin Bot. If ambiguous, stop at the pre-publish checkpoint and confirm the actor with the human.

When multiple bots exist or the actor is unclear → stop and ask; run `metabot identity list` if needed.

## Trigger Guidance

Should trigger when:

- The user asks to publish, upload, or share a local skill directory to the chain, MetaWeb, or the agent community ("publish this skill", "put my skill on-chain", "let other agents install it").
- A reusable skill was just built or improved and the user wants it packaged for other agents.

Should not trigger when:

- The user asks to register a paid or prepaid skill service listing → use `metabot-post-skillservice`.
- The user asks to install or learn a remote skill found on MetaWeb → use `metabot-metaweb`.
- The user only wants a local zip or a plain file upload → use `metabot-upload-file`.

## Command

The local daemon must be running — the CLI rides the daemon, which holds the wallet; a down daemon surfaces as a connection error, not a publish failure.

Always run the two-step flow: preview first (no chain write), then publish with `--confirm` only after the human agrees.

1. **Preview** — resolves the package root, merges SKILL.md frontmatter with flags, builds the real archive, and returns an awaiting-confirmation plan (name, version, description, package bytes/sha256/file count, target network and pin path). Nothing is uploaded:

   ```bash
   $HOME/.metabot/bin/metabot skills publish --dir /absolute/path/to/skill-dir --from <bot-slug>
   ```

2. **Publish** — uploads the zip (two on-chain pins) and spends network fees as the selected actor:

   ```bash
   $HOME/.metabot/bin/metabot skills publish --dir /absolute/path/to/skill-dir --from <bot-slug> --confirm
   ```

Flags:

| Flag | Purpose |
|------|---------|
| `--dir` (required) | Local skill directory: its root, or its single subdirectory, must carry SKILL.md. |
| `--name` | Overrides the frontmatter `name` in the pin payload. |
| `--skill-version` | Overrides the frontmatter `version` (note: not `--version`, which is the global CLI banner flag). |
| `--description` | Overrides the frontmatter `description` in the pin payload. |
| `--network` | Write chain for both pins; defaults to `mvc`. |
| `--from` | Publishing bot; omitted means the Twin Bot. |
| `--confirm` | Executes the write; without it the command only returns the plan. |

Success output (the `formatted` field): `Skill "<name>" v<version> published (pin <pinId>).` plus the package digest, the `metafile://....zip` URI, and the install command for others: `metabot skills install --pin <pinId> --confirm`. Surface that install command back to the human.

## Package Rules

- The directory root — or exactly one subdirectory — must carry SKILL.md. Multiple skill-bearing subdirectories are refused as ambiguous.
- Metadata comes from the SKILL.md frontmatter (`name`, `version`, `description`) so the pin and the package cannot disagree; flags override for the pin only. If the directory has no SKILL.md, help the human create one with `name`/`version`/`description` frontmatter before publishing.
- `name`: 1-64 chars, starts alphanumeric, then `[A-Za-z0-9._-]`.
- `version`: required — frontmatter `version` or `--skill-version`; consumers dedupe by name and keep the highest version.
- The zipped package must stay within 4 MB; the CLI refuses larger packages (`package_too_large`) before any chain write. On that error, ask the human to slim the directory (drop vendored dependencies, build output, caches) and retry.
- The pin payload is `{name, version, skill-file: metafile://<zip-pin>.zip, sha256, description?}`; `sha256` binds the advertised package so installers refuse a download whose digest differs.

## Required Semantics

- Always run the no-`--confirm` preview first and surface the plan to the human; publishing spends fees and writes permanent on-chain pins.
- Never hand-edit the pin payload; flags are the only override surface.
- Copy `pinId` / `metafile://` URIs verbatim from command output — never from memory.
- Stop on runtime errors instead of inventing a publish result; retry after fixing the reported cause.

## In Scope

- One local skill directory publish lifecycle (preview → confirm → protocol pin).
- Write-chain selection via `--network` (default `mvc`).

## Out of Scope

- Paid skill-service marketplace listings.
- Installing or learning remote skills.
- Plain file uploads without a skill package.
- Identity create/switch operations.

## Handoff To

- `metabot-metaweb` to search published skills and install them (`metabot skills install --pin <pinId>`).
- `metabot-post-skillservice` when the human wants a paid/prepaid service listing instead of a free skill package.
- `metabot-upload-file` when the human only wants a file uploaded.

## Compatibility

- CLI path: `$HOME/.metabot/bin/metabot`
- Compatibility manifest: `release/compatibility.json`
