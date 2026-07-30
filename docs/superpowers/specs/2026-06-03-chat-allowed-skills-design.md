# Chat Allowed Skills Design

**Date:** 2026-06-03

## Goal

Allow a local MetaBot to use an explicit allow-list of local skills when replying to A2A private chat messages, and persist that allow-list to the MetaBot `/info/bio` payload as `allowChatSkills`.

The user-visible result is:

- `/ui/bot` lets the operator configure allowed private-chat skills after a Bot has been created.
- The skill picker uses the same executable skill catalog as the Skill Service publish UI.
- `/info/bio` contains `allowChatSkills` when the Bot profile is saved on chain.
- A2A private chat reply execution can use only the configured skills for that local Bot.
- Private chat replies return the final response text to the remote Bot or user.

## Non-Goals

- Do not add skill selection to the new Bot creation modal. New Bots are created first, then configured from the Bot detail page.
- Do not add a broad "all skills" private-chat mode.
- Do not allow private chat to use skills that are not currently resolvable through the selected Bot's primary runtime skill catalog.
- Do not introduce a new legacy storage layout or new dependencies on `.metabot/hot`.
- Do not require local skill documents themselves to change.

## IDBots Reference

IDBots implements the same product idea through three main pieces:

- The Bot form lets users pick chat skills and stores them locally as `allow_chat_skills`.
- The bio writer maps that local field into the chain payload as `allowChatSkills`.
- The private chat daemon reads the configured skills and builds skill-routing prompt context for private chat turns.

That implementation proves the user workflow, but OAC should enforce the boundary at the executor skill injection layer instead of relying only on prompt routing. Prompt guidance is still useful, but it must not be the only guard.

## Existing OAC Foundations

OAC already has most of the lower-level pieces needed for a stricter implementation:

- The Bot UI has an Info tab and `saveInfo()` flow for profile edits.
- The Skill Service UI already lists publishable skills through `/api/services/skills?from=<slug>`.
- `createPlatformSkillCatalog()` already resolves executable primary-runtime skills and their source paths.
- `validateServicePublishProviderSkills()` already validates requested skill names against the primary-runtime catalog.
- `LlmExecutor.execute()` already accepts `skills` and `skillSourcePaths`.
- The skill injector already copies explicitly requested skill directories into the provider-native runtime location.
- Provider skill-service execution already uses executor-level skill injection with explicit source paths.
- A2A private chat replies flow through `privateChatAutoReply` and `hostLlmChatReplyRunner`.

The design should reuse these pieces instead of creating a parallel skill discovery path.

## Data Model

### Canonical Field

Use `allowChatSkills` as the canonical field name everywhere in OAC profile APIs and chain bio payloads.

```ts
type AllowChatSkills = string[];
```

Rules:

- Values are skill names, not absolute paths.
- Values are normalized, trimmed, deduplicated, and sorted by user order preservation where practical.
- Empty array means private chat has no configured skill allow-list.
- Missing field means the same as empty array for runtime execution.
- Unsafe skill names are rejected before persistence.
- Unknown skill names are rejected when saving through the UI/API if the selected Bot has a resolvable primary runtime catalog.

### Bio Payload

`/info/bio` should include:

```json
{
  "role": "...",
  "soul": "...",
  "goal": "...",
  "primaryProvider": "...",
  "fallbackProvider": "...",
  "allowChatSkills": ["skill-one", "skill-two"]
}
```

When the list is empty, the writer may include `allowChatSkills: []` for explicitness. The runtime must treat missing, null, and empty values as no configured chat skills.

### Local Persistence

Persist the configured allow-list as profile-scoped runtime state, not as a new global file.

Recommended location:

```text
~/.metabot/profiles/<slug>/.runtime/state/chat-skill-policy.json
```

Recommended shape:

```json
{
  "allowChatSkills": ["skill-one", "skill-two"],
  "updatedAt": "2026-06-03T00:00:00.000Z"
}
```

Rationale:

- This is operator-managed Bot configuration, but it is not persona prose.
- It belongs to one profile.
- It is machine-read by runtime code.
- `.runtime/state` is the established location for profile-scoped machine-managed state.
- It avoids introducing a new root-level profile file without a broader storage decision.

The profile manager should expose the field through `MetabotProfileFull.allowChatSkills` so callers do not need to know the storage file.

## UI Design

### Location

Add a "Chat Allowed Skills" section to the existing `/ui/bot` Info tab, near the provider controls.

Do not add this section to the new Bot creation modal.

### Controls

The section should provide:

- A select control populated from `/api/services/skills?from=<selectedSlug>`.
- An Add button.
- One removable chip per selected skill.
- Empty state copy when no chat skills are selected.
- Loading and error states for the skill catalog request.

The dropdown must use the same available executable skills as Skill Service publishing. It should not scan skill folders in the browser.

### Save Behavior

`saveInfo()` should include `allowChatSkills` only as a normalized array.

Saving should fail visibly if:

- The selected skill name is unsafe.
- The selected skill is no longer available in the selected Bot's primary runtime catalog.
- The Bot has no healthy primary runtime and the server cannot validate the requested list.

If a user edits unrelated profile fields, existing `allowChatSkills` must be preserved unless the UI sends an explicit empty array.

## API and Validation

### Reuse Skill Service Catalog Logic

The Bot profile update path should reuse the same catalog and validation semantics as Skill Service publishing:

- Resolve the selected profile.
- Resolve the selected profile's enabled primary runtime.
- Build the platform skill catalog.
- List primary runtime skills.
- Validate requested skill names against that list.
- Persist only validated names.

The validation function can be generalized from `validateServicePublishProviderSkills()` if that avoids duplicating behavior.

### Normalization Utility

Add a small shared normalization utility for chat skill lists:

```ts
function normalizeAllowChatSkills(input: unknown): string[]
```

Expected behavior:

- Accept arrays of strings.
- Trim whitespace.
- Drop empty strings.
- Deduplicate while preserving first occurrence order.
- Reject non-string entries.
- Reject unsafe names using the same provider skill name safety rules.

The utility should not silently coerce objects, booleans, or numbers into skill names.

## A2A Private Chat Runtime

### Runtime Policy

For each local Bot handling a private chat message:

1. Load `allowChatSkills` from that Bot profile.
2. If the list is empty, execute private chat with no injected skills.
3. If the list is non-empty, resolve the current primary runtime skill catalog.
4. Intersect the configured list with currently available catalog entries.
5. If no configured skill can be resolved at runtime, fail closed by executing without skill injection and record a warning in logs or trace metadata.
6. If one or more skills resolve, pass exactly those names and source paths to `LlmExecutor.execute()`.

This keeps runtime behavior safe when skills are uninstalled, renamed, or when the primary runtime changes after the profile was saved.

### Executor-Level Enforcement

> **Superseded 2026-07-30** (branch `fix-a2a-skill-execution`, plan:
> `docs/a2a-chat-skill-order-maturity-plan-v1.md`): chat turns no longer run
> under `skillIsolation: 'strict'`. To match the IDBots reference behavior,
> allowed chat skills execute with the host's normal environment so they can
> perform their documented actions (including on-chain writes, uploads, and
> messaging). The allow-list is now scoped **at prompt level**: the routing
> block lists only the allowed skills (name, description, SKILL.md location)
> and instructs the model to use only those. Chat turns run in a per-profile
> workspace (`<profile>/.runtime/private-chat-work/`). The executor's
> strict-isolation machinery remains available for other callers.

Private chat skill enablement must be enforced through:

```ts
llmExecutor.execute({
  ...request,
  skills: resolvedAllowedSkillNames,
  skillSourcePaths: resolvedAllowedSkillSourcePaths
});
```

The prompt may also list the available skills to improve model behavior, but prompt text is not the security boundary.

### Prompt Guidance

When resolved skills are present, add concise prompt context:

- These are the only skills available for this private chat turn.
- Use them only when they help answer or complete the sender's request.
- Return the final reply text to the sender.

When no skills are resolved, do not mention unavailable skills.

### Multi-Profile Dispatch

The implementation must cover both private chat execution paths:

- The active profile orchestrator created by CLI runtime startup.
- The per-profile dispatcher used when messages arrive for other local profiles.

Backfill should inherit the same behavior because it reuses the same orchestrator path.

## CLI and Skill Documents

No first-class CLI command is required for the first implementation.

The minimum CLI compatibility requirement is:

- Bot profile show/update paths should preserve and expose `allowChatSkills`.
- JSON payload update should accept `allowChatSkills` after server validation.

Optional follow-up:

- Add explicit CLI conveniences such as `bot chat-skills list`, `bot chat-skills set`, `bot chat-skills add`, and `bot chat-skills remove`.
- Update host skill documentation only if those commands become part of the supported operator workflow.

Existing local skill documents do not need changes for the core feature.

## Security and Failure Semantics

- Saving unsafe skill names must fail.
- Saving unavailable skill names must fail when validation can be performed.
- Runtime must never fall back from a non-empty `allowChatSkills` list to all installed skills.
- Runtime must not execute skills outside the configured allow-list.
- Runtime should tolerate stale allow-list entries by excluding unresolved skills for that turn.
- Logs should identify skipped configured skills without exposing secrets or full private message contents.

## Implementation Units

### Unit 1: Profile Model and Bio Persistence

- Extend profile types with `allowChatSkills`.
- Add local policy read/write helpers under profile runtime state.
- Include `allowChatSkills` in profile create/update inputs.
- Include `allowChatSkills` in changed-field detection.
- Include `allowChatSkills` in `/info/bio` chain payload.
- Preserve existing values on unrelated updates.

### Unit 2: Bot API Validation

- Add shared `normalizeAllowChatSkills()`.
- Reuse or generalize Skill Service provider skill validation.
- Validate `allowChatSkills` in Bot create/update handler input.
- Return actionable UI-safe error messages.

### Unit 3: Bot UI

- Load skill options from `/api/services/skills?from=<selectedSlug>`.
- Render the select, Add button, chips, and empty state in the Info tab.
- Include normalized `allowChatSkills` in save payload.
- Do not add skill selection to the new Bot modal.

### Unit 4: Private Chat Runtime

- Resolve allowed chat skills per profile before LLM execution.
- Pass `skills` and `skillSourcePaths` into `LlmExecutor.execute()`.
- Add prompt guidance only when skills are resolved.
- Wire both active-profile and multi-profile private chat paths.
- Add logs or trace metadata for unresolved configured skills.

### Unit 5: Tests and Verification

- Unit tests for normalization.
- Profile manager tests for local persistence and `/info/bio` payload.
- Daemon handler tests for validation and changed-field behavior.
- UI tests for select/add/remove/save payload behavior.
- Chat runner tests proving exact executor `skills` and `skillSourcePaths`.
- Dispatcher tests or focused runtime tests proving per-profile allow-list use.

## Verification Plan

Use targeted verification before each implementation commit.

Recommended focused commands:

```bash
npm run build
node --test tests/bot/metabotProfileManager.test.mjs
node --test tests/daemon/defaultBotHandlers.test.mjs
node --test tests/services/servicePublishValidation.test.mjs
node --test tests/chat/hostLlmChatReplyRunner.test.mjs
```

Add or adjust exact test file names during implementation based on the existing suite.

Do not run the full `npm test` by default for the design-only commit or for narrow UI/profile updates unless implementation touches broad runtime behavior, persistence formats, release artifacts, or package/build plumbing.

## Rollout

1. Land the design spec.
2. Write a task-by-task implementation plan.
3. Implement profile and validation first.
4. Implement UI second.
5. Implement private chat runtime enforcement third.
6. Add tests with each implementation unit.
7. Run targeted verification.
8. Commit each independent, verified unit.
9. Post a detailed development diary after each commit.

## Open Decisions

- Whether to add first-class CLI commands after the UI and JSON payload path are working.
- Whether imported chain bio values should accept IDBots-style `allow_chat_skills` as a compatibility alias. The OAC canonical field should remain `allowChatSkills` either way.
