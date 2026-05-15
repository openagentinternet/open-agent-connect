# MetaBot Skill-Service Conversational Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `metabot-post-skillservice` from a payload-file reference into a conversational assistant that can help a user publish a paid MetaWeb skill service end to end.

**Architecture:** Keep CLI behavior unchanged and encode the workflow in the skill instructions. The `SKILLs/` template is the canonical source, `npm run build:skillpacks` regenerates the tracked shared and host-wrapper skillpack copies, and the installed local skill is synchronized from the rendered shared copy after review so the user can test immediately. Targeted tests protect the shared skillpack copy from regressing back to manual JSON-only instructions.

**Tech Stack:** Markdown skills, Node.js test runner, `scripts/build-metabot-skillpacks.mjs`, `metabot` CLI.

---

## File Structure

- Modify `SKILLs/metabot-post-skillservice/SKILL.md`: canonical source template. Add a guided publish workflow, preserve lifecycle command instructions, and document confirmation-before-chain-write behavior.
- Modify `tests/skillpacks/buildSkillpacks.test.mjs`: add assertions that the shared skillpack output contains the conversational publish workflow, actor discovery commands, primary-runtime skill discovery, icon handling, preview/confirmation gate, and lifecycle commands.
- Regenerate `skillpacks/shared/skills/metabot-post-skillservice/SKILL.md` and the host-wrapper copies under `skillpacks/*/runtime/shared-skills/metabot-post-skillservice/SKILL.md` with `npm run build:skillpacks`.
- Modify `/Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md`: installed local copy for immediate testing. This file is outside the repository and cannot be committed; synchronize it from the rendered shared skill after Task 1 passes.

## Task 1: Update Canonical Skill And Shared Skillpack Test

**Files:**
- Modify: `SKILLs/metabot-post-skillservice/SKILL.md`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Regenerate: `skillpacks/shared/skills/metabot-post-skillservice/SKILL.md`
- Regenerate: `skillpacks/codex/runtime/shared-skills/metabot-post-skillservice/SKILL.md`
- Regenerate: `skillpacks/claude-code/runtime/shared-skills/metabot-post-skillservice/SKILL.md`
- Regenerate: `skillpacks/openclaw/runtime/shared-skills/metabot-post-skillservice/SKILL.md`

- [ ] **Step 1: Add failing test assertions for the conversational workflow**

In `tests/skillpacks/buildSkillpacks.test.mjs`, extend the existing test named `buildAgentConnectSkillpacks publishes provider service lifecycle commands in the shared pack`.

Add assertions for these exact concepts:

```js
assert.match(content, /metabot identity who --json/);
assert.match(content, /metabot identity list --json/);
assert.match(content, /metabot services skills --from <bot-slug> --json/);
assert.match(content, /providerSkill.*primary runtime skills/s);
assert.match(content, /metafile:\/\/\.\.\./);
assert.match(content, /metabot-upload-file/);
assert.match(content, /explicit confirmation/i);
assert.match(content, /metabot services publish --from <bot-slug> --payload-file <path> \[--chain <chain>\]/);
assert.match(content, /Do not run the publish command until the human confirms/i);
```

Keep the existing lifecycle command assertions intact.

- [ ] **Step 2: Run the targeted test and confirm it fails**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: FAIL because the current canonical skill does not yet include the conversational workflow text.

- [ ] **Step 3: Rewrite the canonical source skill instructions**

Update `SKILLs/metabot-post-skillservice/SKILL.md` in English. This is a source template, so keep existing template placeholders such as `{{METABOT_CLI}}`, `{{SYSTEM_ROUTING}}`, `{{HOST_ADAPTER_SECTION}}`, and `{{COMPATIBILITY_MANIFEST}}` where they belong.

Required structure:

- Keep the same frontmatter `name`.
- Update `description` so it triggers for users who ask to publish/register a paid service, need help selecting a MetaBot/provider skill, or want the agent to gather service fields conversationally.
- Keep `# Bot Publish Service`.
- Add `## Conversational Publish Workflow` before the low-level command reference.
- Preserve `## Actor Selection`, `## Provider Service Lifecycle`, `## Required Semantics`, `## In Scope`, `## Out of Scope`, `## Handoff To`, `## Result Handling`, and `## Compatibility`.

The new workflow must instruct the agent to:

1. Run `metabot identity who --json` and `metabot identity list --json` to discover the default and available local MetaBots.
2. Ask the user to confirm the default MetaBot or choose another.
3. Run `metabot services skills --from <bot-slug> --json` for the selected MetaBot.
4. Present only returned primary runtime skills, and never manually scan skill roots or include fallback skills.
5. If `metabot services skills --from <bot-slug> --json` fails, explain the returned failure code/message directly and stop or ask the user to choose another MetaBot. Do not invent skills.
6. Ask short questions to collect `providerSkill`, `displayName`, `serviceName`, `description`, `price`, `currency`, and `outputType`.
   - `currency` must be one of `BTC`, `SPACE`, `DOGE`, or `BTC-OPCAT`.
   - `outputType` must be one of `text`, `image`, `video`, `audio`, or `other`.
   - `price` must be a non-negative decimal string.
7. Offer a `serviceName` default like `<providerSkill>-service`.
8. For icons, directly reuse an existing `metafile://...` URI, or hand off to `metabot-upload-file` when the user gives a local image path, then store the returned `metafile://<pinid>` in `serviceIconUri`. Preserve the DOGE caveat: service records can publish on DOGE, but dependent file upload does not support DOGE.
9. Omit `serviceIconUri` when the user does not want an icon.
10. Honor explicit MVC, BTC, DOGE, or OPCAT chain requests with `--chain`; otherwise omit `--chain`.
11. Write a payload JSON file.
12. Show the final JSON and exact command:

```bash
metabot services publish --from <bot-slug> --payload-file <path> [--chain <chain>]
```

13. Require explicit confirmation before publishing. Include the sentence: `Do not run the publish command until the human confirms the final payload and command.`
14. Treat unclear confirmation as a pause or request for edits, not permission to publish.
15. Run the publish command only after confirmation and report the success or failure envelope.
16. On success, report `servicePinId`, `sourceServicePinId`, `txids`, `network`, and `displayName` when present.
17. On `manual_action_required`, surface the local UI URL and wait instead of inventing a result.

Avoid adding CLI behavior that does not exist. Use `{{METABOT_CLI}}` in command examples inside the source template.

- [ ] **Step 4: Run the targeted test and confirm it passes against generated temp output**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Regenerate tracked skillpack artifacts**

Run:

```bash
npm run build:skillpacks
```

Expected: PASS. This updates the tracked rendered copies under `skillpacks/shared/...` and `skillpacks/<host>/runtime/shared-skills/...`.

- [ ] **Step 6: Run the targeted test again against the regenerated workspace**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Run lightweight static verification**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 8: Commit the repository changes**

Run:

```bash
git add SKILLs/metabot-post-skillservice/SKILL.md tests/skillpacks/buildSkillpacks.test.mjs skillpacks/shared/skills/metabot-post-skillservice/SKILL.md skillpacks/codex/runtime/shared-skills/metabot-post-skillservice/SKILL.md skillpacks/claude-code/runtime/shared-skills/metabot-post-skillservice/SKILL.md skillpacks/openclaw/runtime/shared-skills/metabot-post-skillservice/SKILL.md
git commit -m "docs: make skill service publish conversational"
```

Expected: commit succeeds. Do not modify `/Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md` in this task.

- [ ] **Step 9: Post the required development diary buzz**

Use the `metabot-post-buzz` skill after the commit. The buzz content must mention the commit SHA, the updated conversational publish workflow, regenerated skillpack artifacts, and verification commands/results.

## Task 2: Synchronize Installed Local Skill For Testing

**Files:**
- Read: `skillpacks/shared/skills/metabot-post-skillservice/SKILL.md`
- Modify: `/Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md`

- [ ] **Step 1: Confirm repository source exists**

Run:

```bash
test -f skillpacks/shared/skills/metabot-post-skillservice/SKILL.md
```

Expected: exit code 0.

- [ ] **Step 2: Copy the reviewed source skill to the installed skill path**

Use a normal file copy because this is a full-file synchronization outside the git repository. Copy from the rendered shared skillpack copy, not from the `SKILLs/` template, because the template contains build placeholders.

```bash
cp skillpacks/shared/skills/metabot-post-skillservice/SKILL.md /Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md
```

Expected: command succeeds.

- [ ] **Step 3: Verify installed copy matches source**

Run:

```bash
cmp -s skillpacks/shared/skills/metabot-post-skillservice/SKILL.md /Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md
```

Expected: exit code 0.

- [ ] **Step 4: Smoke-check installed skill content**

Run:

```bash
rg -n "Conversational Publish Workflow|metabot identity who --json|Do not run the publish command until the human confirms" /Users/tusm/.metabot/skills/metabot-post-skillservice/SKILL.md
```

Expected: all three strings are present.

- [ ] **Step 5: Report synchronization**

No git commit is possible for this external installed-skill file. Report that the installed copy was synchronized from the committed source and is ready for conversational testing.
