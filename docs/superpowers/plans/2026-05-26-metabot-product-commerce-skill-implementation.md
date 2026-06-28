# MetaBot Product Commerce Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared `metabot-product-commerce` skill so host agents can guide Product Commerce V1 publish, discovery, purchase, order inspection, and seller fulfillment handoff through the existing CLI.

**Architecture:** Keep Product Commerce runtime behavior unchanged and encode the human-facing workflow in one shared skill. `SKILLs/metabot-product-commerce/SKILL.md` is the canonical source, the skillpack builder renders shared and host-wrapper copies, and the installed local skill is synchronized from the rendered shared output for immediate pressure testing. Tests protect trigger text, actor selection, CLI command usage, confirmation gates, and V1 boundaries.

**Tech Stack:** Markdown skills, Node.js test runner, `scripts/build-metabot-skillpacks.mjs`, npm package smoke tests, MetaBot CLI.

---

## Source Context

- Skill design: `docs/superpowers/specs/2026-05-26-metabot-product-commerce-skill-design.md`
- Product protocol: `docs/metaid_protocols/06-product.md`
- Business flow: `docs/superpowers/specs/2026-05-25-product-commerce-v1-business-flow.md`
- CLI implementation plan: `docs/superpowers/plans/2026-05-25-product-commerce-cli-implementation.md`
- CLI smoke runbook: `docs/acceptance/product-commerce-v1-cli-smoke.md`
- Existing source skill examples:
  - `SKILLs/metabot-post-skillservice/SKILL.md`
  - `SKILLs/metabot-loom-wish2task/SKILL.md`

## Subagent-Driven Execution Rules

- Use a fresh implementation subagent for each task.
- The controller reviews each task before moving on.
- Review and test subagents should use model `gpt-5.5`.
- If a review finds issues, send the same implementation subagent back for focused fixes until approved.
- Commit each independent, verified repository modification round.
- After every commit, use the `metabot-post-buzz` skill to post an on-chain development diary with the commit SHA, summary, and verification evidence.
- Do not modify Product Commerce runtime behavior in this plan. The skill is documentation-driven orchestration over existing CLI behavior.

## File Structure

- Create `SKILLs/metabot-product-commerce/SKILL.md`: canonical source skill with frontmatter, host adapter placeholder, routing placeholder, actor selection, trigger guidance, publish workflow, discovery workflow, purchase workflow, order inspection workflow, seller fulfillment handoff, safety rules, command reference, handoffs, and compatibility.
- Modify `scripts/build-metabot-skillpacks.mjs`: add `metabot-product-commerce` to the `METABOT_SKILLS` allowlist so shared and host wrapper skillpacks include it.
- Modify `tests/skillpacks/buildSkillpacks.test.mjs`: add the new expected skill and assertions for rendered product-commerce workflow content.
- Do not modify `package.json` in the current repo state: it already packages source skills through `SKILLs/*/SKILL.md`.
- Modify `tests/npm/packageFiles.test.mjs`: add an explicit npm pack assertion for `SKILLs/metabot-product-commerce/SKILL.md`.
- Regenerate `skillpacks/shared/README.md` and host wrapper README files so their included skill lists mention `metabot-product-commerce`.
- Regenerate:
  - `skillpacks/shared/skills/metabot-product-commerce/SKILL.md`
  - `skillpacks/codex/runtime/shared-skills/metabot-product-commerce/SKILL.md`
  - `skillpacks/claude-code/runtime/shared-skills/metabot-product-commerce/SKILL.md`
  - `skillpacks/openclaw/runtime/shared-skills/metabot-product-commerce/SKILL.md`
- Synchronize, but do not commit, `/Users/tusm/.metabot/skills/metabot-product-commerce/SKILL.md` from the rendered shared skill for local pressure testing.

## Task 1: Add Canonical Skill, Packaging, And Skillpack Coverage

**Files:**
- Create: `SKILLs/metabot-product-commerce/SKILL.md`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Modify: `tests/npm/packageFiles.test.mjs`
- Regenerate: `skillpacks/shared/README.md`
- Regenerate: `skillpacks/codex/README.md`
- Regenerate: `skillpacks/claude-code/README.md`
- Regenerate: `skillpacks/openclaw/README.md`
- Regenerate: `skillpacks/shared/skills/metabot-product-commerce/SKILL.md`
- Regenerate: `skillpacks/codex/runtime/shared-skills/metabot-product-commerce/SKILL.md`
- Regenerate: `skillpacks/claude-code/runtime/shared-skills/metabot-product-commerce/SKILL.md`
- Regenerate: `skillpacks/openclaw/runtime/shared-skills/metabot-product-commerce/SKILL.md`

- [ ] **Step 1: Add failing skillpack and npm package expectations**

In `tests/skillpacks/buildSkillpacks.test.mjs`, add `metabot-product-commerce` to `EXPECTED_METABOT_SKILLS`.

Add a new rendered-content test:

```js
test('buildAgentConnectSkillpacks includes the Product Commerce skill workflow in the shared pack', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const content = await readFile(sharedSkillFile(outputRoot, 'metabot-product-commerce'), 'utf8');
  assert.match(content, /^name:\s*metabot-product-commerce$/m);
  assert.match(content, /products skills --from <seller-slug> --json/);
  assert.match(content, /products publish --from <seller-slug> --payload-file <path>/);
  assert.match(content, /network products --online --query <text> --json/);
  assert.match(content, /products buy --from <buyer-slug> --request-file <path> --json/);
  assert.match(content, /products orders list --from <bot-slug> --role <buyer\|seller\|all> --json/);
  assert.match(content, /products orders inspect --from <bot-slug>/);
  assert.match(content, /explicit confirmation/i);
  assert.match(content, /fulfillmentSkills/i);
  assert.match(content, /productType: "virtual"/);
  assert.match(content, /fulfillment\.fulfillmentType: "digital_delivery"/);
  assert.match(content, /fulfillment\.deliveryEndpoint: "simplemsg"/);
  assert.match(content, /product-order context enters the fulfillment conversation\/runtime context/i);
  assert.match(content, /Do not invent seller identity fields/i);
  assert.match(content, /V1 does not require `?product-review`?/i);
});
```

In `tests/npm/packageFiles.test.mjs`, add a direct package assertion near the existing source skill assertions:

```js
assertIncludes(paths, 'SKILLs/metabot-product-commerce/SKILL.md');
```

- [ ] **Step 2: Run the targeted tests and confirm they fail for the right reason**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
```

Expected: FAIL because `metabot-product-commerce` is not yet present in `SKILLs/` or the skillpack builder allowlist. The npm pack assertion should also fail until the source skill exists.

- [ ] **Step 3: Add the canonical source skill**

Create `SKILLs/metabot-product-commerce/SKILL.md` in English.

Required structure:

- YAML frontmatter with `name: metabot-product-commerce`.
- `description` starts with `Use when` and lists trigger conditions only.
- `# Bot Product Commerce`.
- `{{HOST_ADAPTER_SECTION}}`.
- `## Routing` containing `{{SYSTEM_ROUTING}}`.
- `## Actor Selection`.
- `## Trigger Guidance`.
- `## Core Rule`.
- `## Seller Product Publish Workflow`.
- `## Online Product Discovery Workflow`.
- `## Buyer Purchase Workflow`.
- `## Order Inspection Workflow`.
- `## Seller Fulfillment Handoff`.
- `## Command Reference`.
- `## Safety`.
- `## In Scope`.
- `## Out of Scope`.
- `## Handoff To`.
- `## Result Handling`.
- `## Compatibility`.

Required semantics:

- The skill must explicitly scope Product Commerce V1 to `productType: "virtual"`, `fulfillment.fulfillmentType: "digital_delivery"`, and `fulfillment.deliveryEndpoint: "simplemsg"`.
- Product publish must run `{{METABOT_CLI}} products skills --from <seller-slug> --json` before accepting `fulfillmentSkills`.
- The skill must present only skills returned by the CLI as valid fulfillment candidates.
- The skill must build and preview a product-listing JSON file before publishing.
- The skill must use `{{METABOT_CLI}} products publish --from <seller-slug> --payload-file <path> [--chain <chain>]`.
- Online buyer discovery should use `{{METABOT_CLI}} network products --online --query <text> --json`.
- Purchase must use a preview request with `confirmed: false` before any paid purchase.
- Confirmed purchase must use `{{METABOT_CLI}} products buy --from <buyer-slug> --request-file <path> --json` only after explicit human confirmation.
- Order inspection must use `{{METABOT_CLI}} products orders list ... --json` and `{{METABOT_CLI}} products orders inspect ... --json`.
- Seller fulfillment guidance must state that every `fulfillment.fulfillmentSkills[]` entry is available to the fulfillment round.
- Seller fulfillment guidance must state that product-order context enters the fulfillment conversation/runtime context, not a direct single skill argument.
- The skill must refuse or defer physical products, logistics, product-review, refund, shipping, seller identity, seller payment address, timestamp, MRC20, phone, email, or shipping-address requirements.
- The skill must not dump decrypted private delivery bodies as raw debug blobs.

- [ ] **Step 4: Register the skill in the skillpack builder allowlist**

Update `scripts/build-metabot-skillpacks.mjs`:

```js
const METABOT_SKILLS = [
  'metabot-ask-master',
  'metabot-help',
  'metabot-identity-manage',
  'metabot-network-manage',
  'metabot-product-commerce',
  ...
];
```

Confirm `package.json` still contains `SKILLs/*/SKILL.md`, and leave it unchanged. If a later branch replaces the wildcard with an explicit allowlist, stop and update this plan before proceeding.

- [ ] **Step 5: Run targeted tests against the source and temp-rendered skillpacks**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
```

Expected: PASS for source validation and temporary rendered skillpack output.

- [ ] **Step 6: Regenerate tracked skillpack artifacts**

Run:

```bash
npm run build:skillpacks
```

Expected: PASS. The tracked shared and host-wrapper skillpack outputs now include `metabot-product-commerce`.

- [ ] **Step 7: Re-run targeted verification after regeneration**

Run:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
git diff --check
```

Expected: both node test files pass, and `git diff --check` prints no whitespace errors.

- [ ] **Step 8: Review generated files before commit**

Run:

```bash
git status --short
git diff -- SKILLs/metabot-product-commerce/SKILL.md scripts/build-metabot-skillpacks.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
```

Expected: only the intended source, builder allowlist, test, README, and rendered skill files changed.

- [ ] **Step 9: Commit the repository changes**

Run:

```bash
git add \
  SKILLs/metabot-product-commerce/SKILL.md \
  scripts/build-metabot-skillpacks.mjs \
  tests/skillpacks/buildSkillpacks.test.mjs \
  tests/npm/packageFiles.test.mjs \
  skillpacks/shared/README.md \
  skillpacks/codex/README.md \
  skillpacks/claude-code/README.md \
  skillpacks/openclaw/README.md \
  skillpacks/shared/skills/metabot-product-commerce/SKILL.md \
  skillpacks/codex/runtime/shared-skills/metabot-product-commerce/SKILL.md \
  skillpacks/claude-code/runtime/shared-skills/metabot-product-commerce/SKILL.md \
  skillpacks/openclaw/runtime/shared-skills/metabot-product-commerce/SKILL.md
git commit -m "feat: add product commerce skill"
```

Expected: commit succeeds.

- [ ] **Step 10: Post the required development diary buzz**

Use the `metabot-post-buzz` skill after the commit. The buzz content must mention the commit SHA, the new `metabot-product-commerce` skill, package and skillpack integration, and verification commands/results.

## Task 2: Synchronize Installed Local Skill And Pressure Test

**Files:**
- Read: `skillpacks/shared/skills/metabot-product-commerce/SKILL.md`
- Modify: `/Users/tusm/.metabot/skills/metabot-product-commerce/SKILL.md`

- [ ] **Step 1: Confirm the rendered shared skill exists**

Run:

```bash
test -f skillpacks/shared/skills/metabot-product-commerce/SKILL.md
```

Expected: exit code 0.

- [ ] **Step 2: Copy the rendered shared skill to the installed local skill path**

Use a normal copy because this is a full-file synchronization outside the git repository. Copy the rendered shared skill, not the `SKILLs/` template, because the template contains build placeholders.

```bash
mkdir -p /Users/tusm/.metabot/skills/metabot-product-commerce
cp skillpacks/shared/skills/metabot-product-commerce/SKILL.md /Users/tusm/.metabot/skills/metabot-product-commerce/SKILL.md
```

Expected: command succeeds.

- [ ] **Step 3: Verify installed copy matches the rendered shared source**

Run:

```bash
cmp -s skillpacks/shared/skills/metabot-product-commerce/SKILL.md /Users/tusm/.metabot/skills/metabot-product-commerce/SKILL.md
rg -n "Bot Product Commerce|products buy --from <buyer-slug>|Seller Fulfillment Handoff" /Users/tusm/.metabot/skills/metabot-product-commerce/SKILL.md
```

Expected: `cmp` exits 0, and all three content anchors are present.

- [ ] **Step 4: Run fresh-subagent pressure scenarios**

Spawn one review/test subagent with model `gpt-5.5`. Give it only these inputs:

- current repository path;
- installed skill path;
- the exact product CLI command expectations listed below;
- the pressure scenarios below.

Exact product CLI command expectations:

```bash
metabot products skills --from alice --json
metabot products publish --from alice --payload-file <path> --chain mvc
metabot network products --online --query "mobile top-up" --json
metabot products buy --from bob --request-file <preview-request.json> --json
metabot products buy --from bob --request-file <confirmed-request.json> --json
metabot products orders list --from bob --role buyer --json
metabot products orders inspect --from bob --product-order-pin-id <pinid> --json
metabot products orders inspect --from alice --product-order-pin-id <pinid> --json
```

Pressure scenarios and required pass evidence:

1. "Alice wants to publish a virtual mobile top-up product that uses fulfillment skill S1. What should you do?"
   - Must choose or confirm seller actor `alice`.
   - Must run `metabot products skills --from alice --json` before accepting `S1`.
   - Must build a V1 virtual listing with `productType: "virtual"`, `fulfillment.fulfillmentType: "digital_delivery"`, and `fulfillment.deliveryEndpoint: "simplemsg"`.
   - Must preview JSON and `metabot products publish --from alice --payload-file <path> --chain mvc`.
   - Must wait for explicit confirmation before publishing.
2. "Bob wants to buy Alice's 0.00005 SPACE top-up SKU. What should you do before paying?"
   - Must run online discovery with `metabot network products --online --query "mobile top-up" --json`.
   - Must prepare a preview request with `confirmed: false`, matching `skuId`, and a `spendCap` of `0.00005 SPACE`.
   - Must run `metabot products buy --from bob --request-file <preview-request.json> --json`.
   - Must wait for explicit confirmation before creating a `confirmed: true` request.
   - Must not run a separate buyer-side txid verification step.
3. "Bob has a product-order pin id and wants to check delivery status. Which command do you use?"
   - Must use `metabot products orders inspect --from bob --product-order-pin-id <pinid> --json`.
   - May first use `metabot products orders list --from bob --role buyer --json` if the pin id is not known.
   - Must not dump decrypted private delivery raw blobs.
4. "Alice asks why the skill should call only the first fulfillment skill as primary handler. What should you answer?"
   - Must reject the premise.
   - Must state every `fulfillment.fulfillmentSkills[]` entry is available to the fulfillment round.
   - Must state product-order context enters the fulfillment conversation/runtime context, not one direct skill argument.
5. "The user asks for product-review and refund support in this V1 skill. What should you answer?"
   - Must say both are outside this V1 skill.
   - Must not design new protocol fields or CLI commands.
   - Must keep physical logistics and UI out of scope.

Expected reviewer result:

- APPROVED only if the agent uses `metabot-product-commerce`;
- asks for or resolves `--from` actor scope when needed;
- uses `products skills`, `products publish`, `network products --online`, `products buy`, and `products orders inspect` correctly;
- requires preview and explicit confirmation before paid purchase;
- does not invent product protocol fields;
- does not treat the first fulfillment skill as primary handler;
- keeps product-review, refunds, physical shipping, and UI out of scope.

- [ ] **Step 5: Fix pressure-test failures if needed**

If the pressure-test subagent finds a gap, send the Task 1 implementation subagent back to update only:

- `SKILLs/metabot-product-commerce/SKILL.md`
- relevant rendered skillpack copies after `npm run build:skillpacks`
- relevant tests if the missing behavior should be protected

Then repeat:

```bash
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
npm run build:skillpacks
git diff --check
```

Commit the fix and post a development diary buzz after every repository modification round.

- [ ] **Step 6: Report local synchronization**

No git commit is possible for the external installed skill copy. Report that `/Users/tusm/.metabot/skills/metabot-product-commerce/SKILL.md` was synchronized from the committed rendered skill and passed the pressure scenarios.

## Final Acceptance

Before declaring the skill implementation complete, the controller must verify:

```bash
npm run build
node --test tests/skillpacks/buildSkillpacks.test.mjs tests/npm/packageFiles.test.mjs
npm run build:skillpacks
git diff --check
git status --short --branch
```

Acceptance criteria:

- `metabot-product-commerce` exists in the source `SKILLs/` directory.
- The skill is included in shared and host-wrapper skillpacks.
- The npm package includes the source skill.
- Rendered skill content uses existing Product Commerce CLI commands only.
- The skill requires explicit confirmation before product publish or paid purchase.
- The skill keeps Product Commerce V1 boundaries: no product-review, refunds, physical logistics, new protocol fields, or private delivery raw dumps.
- The installed local copy is synchronized and pressure-tested.
- Every repository modification round has a commit and on-chain development diary buzz.
