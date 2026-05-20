# MetaBot Loom Wish-To-Task Skill Design

Date: 2026-05-20
Status: Approved for implementation

## Context

Loom already has a working protocol, CLI, workflow layer, and local dashboard:

- Protocol source: `docs/metaid_protocols/05-loom.md`
- Draft helper: `metabot loom draft-task --wish <text>`
- Publish workflow: `metabot loom post-task --payload-file <path>`
- Local dashboard: `/ui/loom`

The existing `draft-task` command is intentionally thin. It asks the selected MetaBot LLM runtime to produce one `/protocols/loom-task` JSON payload, parses the JSON, and validates it. It does not run a conversational clarification loop, does not enforce a high-quality task-writing standard, and does not collect every publish field before confirmation.

## Goal

Add a built-in shared skill named `metabot-loom-wish2task` that helps a host agent turn a rough human wish into a publishable Loom task.

The skill should trigger when the human wants to publish, draft, or prepare a new Loom development, modification, or iteration task. It should:

- identify the Loom task intent from natural language;
- extract the initial wish from the conversation;
- clarify ambiguous scope, boundaries, repository context, deliverables, verification, price, and chain fields;
- generate self-contained `requirement` and `criteria` markdown suitable for remote developer Bots;
- collect the remaining `/protocols/loom-task` fields;
- show the final JSON body and publish command;
- wait for explicit human confirmation;
- publish the task through `metabot loom post-task`;
- return the `/ui/loom` local dashboard URL and concise handoff guidance.

## Non-Goals

This change should not:

- change the six Loom protocol schemas;
- replace `metabot loom draft-task`;
- add new daemon APIs;
- change `/ui/loom`;
- automatically publish without explicit confirmation;
- claim, implement, deliver, review, or pay an existing Loom task.

## Design

Implement this as a shared built-in skill under `SKILLs/metabot-loom-wish2task/SKILL.md`.

The skill is a workflow guide for the host agent, not a new runtime command. It uses the existing CLI surface:

- `metabot identity who` and `metabot identity list` when actor selection is unclear;
- `metabot loom validate --protocol task --payload-file <path>` for payload validation;
- `metabot loom post-task --from <bot-slug> --payload-file <path> [--chain <chain>] --dry-run` for preview;
- `metabot loom post-task --from <bot-slug> --payload-file <path> [--chain <chain>]` for confirmed publish;
- `metabot ui open --page loom [--from <bot-slug>]` after publish.

The skill should make GitHub repository context mandatory for this guided workflow, even though the lower-level protocol validator still supports `projectBase: "chain"`. This keeps the first remote developer handoff practical.

The skill should treat `requirement` as a self-contained implementation brief and `criteria` as observable acceptance tests. It should not let a vague wish directly become final JSON when project identity, scope, boundaries, or acceptance proof are missing.

## Skillpack Integration

The existing skillpack builder uses an explicit `METABOT_SKILLS` allowlist. Add `metabot-loom-wish2task` to:

- `scripts/build-metabot-skillpacks.mjs`
- `tests/skillpacks/buildSkillpacks.test.mjs`

Then rebuild generated skillpacks so shared and host-wrapper packs include the new skill.

## Verification

Use focused checks:

1. Add a failing skillpack test before adding the skill source.
2. Run the targeted test and confirm it fails because the new skill is missing.
3. Add the skill and builder integration.
4. Run `npm run build`.
5. Run `npm run build:skillpacks`.
6. Run `node --test tests/skillpacks/buildSkillpacks.test.mjs`.
7. Run `git diff --check`.
