# Bot Browser Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Agent Internet Browser a peer OAC surface by shipping a dedicated `metabot-browser-open` skill, Browser-aware onboarding and handoff copy, and a clear MetaApps gallery Browser action without replacing Bot Hub or existing local `/ui` flows.

**Architecture:** Extend the existing `metabot browser open` capability instead of changing the Browser runtime. The work stays split into four independent slices: shared skill and resolver packaging, onboarding/install docs plus generated host README copy, shared skill handoff copy, and one `/ui/metaapps` Browser action with i18n coverage. Each slice has its own focused tests and commit boundary.

**Tech Stack:** TypeScript strict/CommonJS source, Markdown SKILL docs under `SKILLs/`, skillpack generation via `scripts/build-metabot-skillpacks.mjs`, Node ESM tests under `tests/`, and built-in local UI pages under `src/ui/pages`.

---

## Confirmed Product Decisions

- Work happens in the isolated worktree `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/bot-browser-guidance` on branch `codex/bot-browser-guidance`.
- Browser stays peer-level with Bot Hub and existing local `/ui/*` pages. It does not replace them.
- Install success copy keeps identity, online Bots, online Bot services, and Bot Hub prompts, then adds Browser prompts beside them.
- Public Bot pages, Bot homepages, MetaApps, and MetaFiles are Browser-first resources. Local management remains `/ui/*` first.
- `/ui/metaapps` gets one explicit Browser-facing action. No Browser runtime or page-chrome redesign is part of this plan.
- Verification stays focused: `npm run build`, `npm run build:skillpacks`, and targeted Node tests. Do not run the full `npm test` suite unless implementation expands beyond the scope above.

## Source Inputs

- Approved spec: `docs/superpowers/specs/2026-06-21-bot-browser-guidance-design.md`
- Existing Browser CLI entrypoint: `src/cli/commands/browser.ts`, `src/cli/commandHelp.ts`, `src/cli/runtime.ts`
- Existing Browser deep links from local UI: `src/ui/pages/bot/app.ts`, `src/ui/pages/settings/app.ts`
- Existing MetaApps gallery action rendering: `src/ui/pages/metaapps/app.ts`
- Existing shared skill packaging and resolver plumbing: `scripts/build-metabot-skillpacks.mjs`, `src/core/skills/baseSkillRegistry.ts`
- Existing install and host guidance: `docs/install/open-agent-connect.md`, `docs/hosts/codex-agent-install.md`, `docs/hosts/codex.md`, `docs/hosts/claude-code.md`, `docs/hosts/openclaw.md`

## File Map

- Create `SKILLs/metabot-browser-open/SKILL.md`: dedicated shared skill for Browser open intents and URI deep links.
- Modify `package.json`: include the new shared skill in the npm published file allowlist.
- Modify `scripts/build-metabot-skillpacks.mjs`: add the new skill to generated packs and update generated host first-action guidance.
- Modify `src/core/skills/baseSkillRegistry.ts`: add the minimal shared resolver contract for `metabot-browser-open`.
- Modify `SKILLs/metabot-help/SKILL.md`: add Browser capabilities and example prompts.
- Modify `SKILLs/metabot-identity-manage/SKILL.md`: add Browser follow-up after create/confirm flows.
- Modify `SKILLs/metabot-network-manage/SKILL.md`: add Browser follow-up after Bot list and service list results.
- Modify `SKILLs/metabot-call-remote-service/SKILL.md`: add Browser follow-up for provider Bot pages.
- Modify `SKILLs/metabot-metaapp-publish/SKILL.md`: add Browser follow-up for published MetaApps.
- Modify `SKILLs/metabot-homepage-guide/SKILL.md`: add Browser follow-up for homepage MetaApps.
- Modify `docs/install/open-agent-connect.md`: keep current next actions and add Browser as an additional peer prompt.
- Modify `docs/hosts/codex-agent-install.md`: keep the existing install handoff contract and add Browser prompt coverage.
- Modify `docs/hosts/codex.md`, `docs/hosts/claude-code.md`, `docs/hosts/openclaw.md`: add Browser to first actions without removing Bot Hub guidance.
- Modify `src/ui/pages/metaapps/app.ts`: add a selected-record Browser action that deep-links to `/browser/metaapp/<pinId>`.
- Modify `src/ui/i18n.ts`: add the Browser action copy key used by the MetaApps page.
- Modify `tests/npm/packageFiles.test.mjs`: assert npm packaging includes the new skill.
- Modify `tests/skillpacks/buildSkillpacks.test.mjs`: assert skillpack lists, generated README copy, and shared skill text include Browser guidance.
- Modify `tests/cli/skills.test.mjs`: assert `skills resolve` works for `metabot-browser-open`.
- Modify `tests/docs/codexInstallDocs.test.mjs`: assert install and host docs keep old prompts and add Browser prompts.
- Modify `tests/ui/i18n.test.mjs`: assert the new Browser action key exists in English and Simplified Chinese.
- Modify `tests/daemon/httpServer.test.mjs`: assert `/ui/metaapps` renders the Browser action only for valid MetaApp pin IDs.

## Subagent Execution Protocol

For each implementation task:

1. Dispatch one implementer subagent with the exact task text and file boundaries. Remind it not to revert unrelated edits in the worktree.
2. Have the implementer write or update focused tests first and run the smallest command that proves the tests fail for the intended reason.
3. Have the implementer make the smallest implementation that passes that task’s tests.
4. Dispatch a spec-compliance reviewer subagent using model `gpt-5.5`.
5. Dispatch a code-quality reviewer subagent using model `gpt-5.5`.
6. Apply any required fixes, rerun the focused verification for that task, commit the task, then post the development diary with `metabot-post-buzz` using the `eric` Bot slug.

Because `scripts/build-metabot-skillpacks.mjs` and `tests/skillpacks/buildSkillpacks.test.mjs` are shared across multiple tasks, execute the tasks sequentially.

---

### Task 1: Add The Shared Browser Skill And Resolver Contract

**Files:**
- Create: `SKILLs/metabot-browser-open/SKILL.md`
- Modify: `package.json`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Modify: `src/core/skills/baseSkillRegistry.ts`
- Test: `tests/npm/packageFiles.test.mjs`
- Test: `tests/skillpacks/buildSkillpacks.test.mjs`
- Test: `tests/cli/skills.test.mjs`

- [ ] **Step 1: Add failing packaging and resolver tests**

In `tests/npm/packageFiles.test.mjs`, add the new skill to the expected npm package list:

```js
const EXPECTED_NPM_SKILLS = [
  'metabot-browser-open',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-help',
  'metabot-identity-manage',
  'metabot-loom-wish2task',
  'metabot-network-manage',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-create-wiki',
  'metabot-metaapp-publish',
  'metabot-homepage-guide',
  'metabot-upload-file',
  'metabot-upload-largefile',
  'metabot-wallet-manage',
];
```

In `tests/skillpacks/buildSkillpacks.test.mjs`, update the shared skill expectations and allow raw `metabot browser` command references:

```js
const EXPECTED_METABOT_SKILLS = [
  'metabot-help',
  'metabot-identity-manage',
  'metabot-network-manage',
  'metabot-browser-open',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-create-wiki',
  'metabot-loom-wish2task',
  'metabot-metaapp-publish',
  'metabot-homepage-guide',
  'metabot-upload-file',
  'metabot-upload-largefile',
  'metabot-wallet-manage',
];

const BARE_METABOT_COMMAND_PATTERN =
  /(?<![\w.$/~-])metabot\s+(?:services|trace|network|identity|doctor|wallet|chat|ui|buzz|file|master|skills|config|chain|llm|evolution|browser|metaapp)\b/;
```

Add a new shared-skill content assertion:

```js
test('buildAgentConnectSkillpacks includes the Browser open workflow skill', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  const content = await readFile(sharedSkillFile(outputRoot, 'metabot-browser-open'), 'utf8');
  assert.match(content, /^name:\s*metabot-browser-open$/m);
  assert.match(content, /Open Agent Internet Browser/i);
  assert.match(content, /metabot browser open/);
  assert.match(content, /metaid:\/\//);
  assert.match(content, /metaapp:\/\//);
  assert.match(content, /metafile:\/\//);
});
```

In `tests/cli/skills.test.mjs`, add a new resolver contract test:

```js
test('runCli supports `metabot skills resolve --skill metabot-browser-open --format json`', async () => {
  const homeDir = createProfileHome('metabot-cli-skills-browser-json-');
  const result = await runSkillsCli(homeDir, [
    'skills',
    'resolve',
    '--skill',
    'metabot-browser-open',
    '--format',
    'json',
  ]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.payload.ok, true);
  assert.equal(result.payload.data.host, 'shared');
  assert.equal(result.payload.data.contract.skillName, 'metabot-browser-open');
  assert.equal(result.payload.data.contract.commandTemplate, 'metabot browser open');
  assert.equal(result.payload.data.contract.scope.localUiOpen, true);
  assert.equal(result.payload.data.contract.scope.chainWrite, false);
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs
```

Expected: fail on missing `metabot-browser-open` packaging entries, missing skillpack artifact, or unknown base skill contract.

- [ ] **Step 3: Add the new skill, package it, and expose the shared resolver contract**

Create `SKILLs/metabot-browser-open/SKILL.md` with a dedicated contract:

```md
---
name: metabot-browser-open
description: Use when a human asks to open Agent Internet Browser, Bot Browser, a Bot page, a Bot homepage, a MetaApp, or a MetaFile through the existing local Browser entrypoint.
---

# Browser Open

## Trigger Guidance

Use this skill when the request is to open Browser itself or to open a public Bot page, Bot homepage, MetaApp, or MetaFile in Browser.

## In Scope

- `metabot browser open`
- `metabot browser open --uri metaid://<globalMetaId>`
- `metabot browser open --uri metaapp://<pinId>`
- `metabot browser open --uri metafile://<pinId>`

## Out of Scope

- Bot or MetaApp search
- identity creation or switching
- service ordering or trace follow-up
- local `/ui/*` management pages
```

In `package.json`, add:

```json
"SKILLs/metabot-browser-open/SKILL.md"
```

In `scripts/build-metabot-skillpacks.mjs`, add the new skill name to `METABOT_SKILLS` immediately after `'metabot-network-manage'`:

```js
const METABOT_SKILLS = [
  'metabot-help',
  'metabot-identity-manage',
  'metabot-network-manage',
  'metabot-browser-open',
  'metabot-call-remote-service',
  'metabot-chat-privatechat',
  'metabot-omni-reader',
  'metabot-post-buzz',
  'metabot-post-skillservice',
  'metabot-create-wiki',
  'metabot-loom-wish2task',
  'metabot-metaapp-publish',
  'metabot-homepage-guide',
  'metabot-upload-file',
  'metabot-upload-largefile',
  'metabot-wallet-manage',
];
```

In `src/core/skills/baseSkillRegistry.ts`, add the minimal shared contract:

```ts
'metabot-browser-open': {
  skillName: 'metabot-browser-open',
  title: 'MetaBot Browser Open',
  summary: 'Open Agent Internet Browser for public Bot pages, MetaApps, and MetaFiles through the local Browser entrypoint.',
  instructions: 'Use the Browser CLI directly. Open Browser with no URI when the human asks for the Browser itself. When a Bot page, MetaApp, or MetaFile target is already known, pass the corresponding metaid://, metaapp://, or metafile:// URI. Do not search, create identities, or open Bot Hub from this skill.',
  commandTemplate: 'metabot browser open',
  outputExpectation: 'Return the Browser localUiUrl plus the opened URI when one was requested.',
  fallbackPolicy: 'If the target resource is unknown, ask for the Bot globalMetaId, MetaApp pinId, or MetaFile pinId instead of guessing.',
  scope: {
    allowedCommands: [
      'metabot browser open',
      'metabot browser open --uri metaid://idq1example',
      'metabot browser open --uri metaapp://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
      'metabot browser open --uri metafile://0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdefi0',
    ],
    chainRead: false,
    chainWrite: false,
    localUiOpen: true,
    remoteDelegation: false,
  },
},
```

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run:

```bash
npm run build && node --test tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the shared Browser skill slice**

Run:

```bash
git add SKILLs/metabot-browser-open/SKILL.md package.json scripts/build-metabot-skillpacks.mjs src/core/skills/baseSkillRegistry.ts tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs
git commit -m "feat: add browser open skill contract"
```

Post a buzz development diary for this commit.

---

### Task 2: Add Browser To Install Handoff And Generated Host First Actions

**Files:**
- Modify: `docs/install/open-agent-connect.md`
- Modify: `docs/hosts/codex-agent-install.md`
- Modify: `docs/hosts/codex.md`
- Modify: `docs/hosts/claude-code.md`
- Modify: `docs/hosts/openclaw.md`
- Modify: `scripts/build-metabot-skillpacks.mjs`
- Test: `tests/docs/codexInstallDocs.test.mjs`
- Test: `tests/skillpacks/buildSkillpacks.test.mjs`

- [ ] **Step 1: Add failing doc and generated-README assertions**

In `tests/docs/codexInstallDocs.test.mjs`, extend the unified install guide and host-doc assertions:

```js
assert.match(runbook, /open Agent Internet Browser/i);
assert.match(runbook, /open my Bot page in Browser/i);
assert.match(runbook, /one clear next action to open Agent Internet Browser/i);

for (const content of [codex, claude, openclaw]) {
  assert.match(content, /check my Bot identity/i);
  assert.match(content, /show me online Bots/i);
  assert.match(content, /open the Bot Hub/i);
  assert.match(content, /open Agent Internet Browser/i);
}
```

In `tests/skillpacks/buildSkillpacks.test.mjs`, add a generated host README assertion:

```js
test('generated host packs keep Bot Hub guidance and add Browser first actions', async () => {
  const { outputRoot } = await getBuiltSkillpacks();

  for (const host of HOSTS) {
    const readme = await readFile(path.join(outputRoot, host, 'README.md'), 'utf8');
    assert.match(readme, /check my Bot identity/i);
    assert.match(readme, /show me online Bots/i);
    assert.match(readme, /open the Bot Hub and show available Bot services/i);
    assert.match(readme, /open Agent Internet Browser/i);
  }
});
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: fail because Browser prompts are still missing from the install guide, host wrappers, and generated host README copy.

- [ ] **Step 3: Update install docs and generated host guidance without removing the old prompts**

In `docs/install/open-agent-connect.md`, expand the intent examples so Browser is additive:

```md
- check current Bot identity
- list currently online Bots
- create the first Bot with a user-chosen name
- discover available Bot services
- open Bot Hub and show online Bot services
- open Agent Internet Browser
- open my Bot page in Browser
- send the first private hello to one online Bot
- ask what OAC can do or what capabilities MetaBot provides
```

Also add one Browser requirement to the handoff contract:

```md
- one clear next action to open Agent Internet Browser or open the current Bot page in Browser as a natural-language prompt
```

In `docs/hosts/codex-agent-install.md`, mirror the same additive Browser prompts in the `Intent examples` section and the `Agent Response Contract`.

In `docs/hosts/codex.md`, `docs/hosts/claude-code.md`, and `docs/hosts/openclaw.md`, expand `## First Actions` to:

```md
- check my Bot identity
- show me online Bots
- open the Bot Hub and show available Bot services
- open Agent Internet Browser
```

In `scripts/build-metabot-skillpacks.mjs`, update the generated `## First Commands` block to keep the existing bullets and add:

```md
- open Agent Internet Browser
```

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run:

```bash
npm run build && node --test tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the onboarding and host-guidance slice**

Run:

```bash
git add docs/install/open-agent-connect.md docs/hosts/codex-agent-install.md docs/hosts/codex.md docs/hosts/claude-code.md docs/hosts/openclaw.md scripts/build-metabot-skillpacks.mjs tests/docs/codexInstallDocs.test.mjs tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "docs: add browser onboarding prompts"
```

Post a buzz development diary for this commit.

---

### Task 3: Add Browser-Aware Handoff Copy To Shared Skills

**Files:**
- Modify: `SKILLs/metabot-help/SKILL.md`
- Modify: `SKILLs/metabot-identity-manage/SKILL.md`
- Modify: `SKILLs/metabot-network-manage/SKILL.md`
- Modify: `SKILLs/metabot-call-remote-service/SKILL.md`
- Modify: `SKILLs/metabot-metaapp-publish/SKILL.md`
- Modify: `SKILLs/metabot-homepage-guide/SKILL.md`
- Test: `tests/skillpacks/buildSkillpacks.test.mjs`

- [ ] **Step 1: Add failing shared-skill content assertions**

In `tests/skillpacks/buildSkillpacks.test.mjs`, extend the existing skill-content tests with explicit Browser follow-up assertions:

```js
const helpContent = await readFile(sharedSkillFile(outputRoot, 'metabot-help'), 'utf8');
const identityContent = await readFile(sharedSkillFile(outputRoot, 'metabot-identity-manage'), 'utf8');
const networkContent = await readFile(sharedSkillFile(outputRoot, 'metabot-network-manage'), 'utf8');
const remoteCallContent = await readFile(sharedSkillFile(outputRoot, 'metabot-call-remote-service'), 'utf8');
const metaappPublishContent = await readFile(sharedSkillFile(outputRoot, 'metabot-metaapp-publish'), 'utf8');
const homepageGuideContent = await readFile(sharedSkillFile(outputRoot, 'metabot-homepage-guide'), 'utf8');

assert.match(helpContent, /Open Agent Internet Browser\./);
assert.match(helpContent, /Open my Bot page\./);
assert.match(helpContent, /Open a published MetaApp in Browser\./);

assert.match(identityContent, /open my Bot page in Browser/i);

assert.match(networkContent, /open the first Bot page in Browser/i);
assert.match(networkContent, /open the provider Bot page in Browser/i);

assert.match(remoteCallContent, /open the provider Bot page in Browser/i);

assert.match(metaappPublishContent, /open the published MetaApp in Browser/i);

assert.match(homepageGuideContent, /open that homepage MetaApp in Browser/i);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: fail because the current shared skills do not mention the Browser follow-ups yet.

- [ ] **Step 3: Update each shared skill with exact Browser follow-ups**

In `SKILLs/metabot-help/SKILL.md`, add Browser examples to the fallback example bank:

```md
- Open Agent Internet Browser.
- Open my Bot page.
- Open a published MetaApp in Browser.
```

In `SKILLs/metabot-identity-manage/SKILL.md`, keep the existing handoff items and insert:

```md
- open my Bot page in Browser
```

In `SKILLs/metabot-network-manage/SKILL.md`, keep Bot Hub guidance and add explicit Browser follow-ups for Bot and provider results:

```md
- open the first Bot page in Browser
- open the selected Bot homepage in Browser
- open the provider Bot page in Browser
```

In `SKILLs/metabot-call-remote-service/SKILL.md`, add the provider-page follow-up:

```md
- open the provider Bot page in Browser
```

In `SKILLs/metabot-metaapp-publish/SKILL.md`, add the post-publish follow-up:

```md
- open the published MetaApp in Browser
```

In `SKILLs/metabot-homepage-guide/SKILL.md`, add the homepage-resource follow-up:

```md
- open that homepage MetaApp in Browser
```

Keep all of the existing Bot Hub, local gallery, trace, and identity guidance. This task adds Browser prompts; it does not replace the current ones.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run:

```bash
npm run build && node --test tests/skillpacks/buildSkillpacks.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the shared skill handoff slice**

Run:

```bash
git add SKILLs/metabot-help/SKILL.md SKILLs/metabot-identity-manage/SKILL.md SKILLs/metabot-network-manage/SKILL.md SKILLs/metabot-call-remote-service/SKILL.md SKILLs/metabot-metaapp-publish/SKILL.md SKILLs/metabot-homepage-guide/SKILL.md tests/skillpacks/buildSkillpacks.test.mjs
git commit -m "docs: add browser handoff guidance to shared skills"
```

Post a buzz development diary for this commit.

---

### Task 4: Add An Explicit Browser Action To The MetaApps Gallery

**Files:**
- Modify: `src/ui/pages/metaapps/app.ts`
- Modify: `src/ui/i18n.ts`
- Test: `tests/ui/i18n.test.mjs`
- Test: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Add failing UI and i18n assertions**

In `tests/ui/i18n.test.mjs`, add the new action key:

```js
assert.equal(translate('en', 'action.openInBrowser'), 'Open in Browser');
assert.equal(translate('zh-CN', 'action.openInBrowser'), '在浏览器中打开');
```

In `tests/daemon/httpServer.test.mjs`, extend the MetaApps gallery tests so valid MetaApps expose the Browser action and invalid pin IDs do not:

```js
const browserAction = extractActionLinks(validRender.detailHtml)
  .find(({ label }) => label === 'Open in Browser');

assert.equal(browserAction?.href, `/browser/metaapp/${validPinId}`);
assert.equal(browserAction?.label, 'Open in Browser');
assert.doesNotMatch(invalidRender.detailHtml, /Open in Browser/);
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: fail because the new i18n key and Browser action link do not exist yet.

- [ ] **Step 3: Add the Browser deep link and translated label**

In `src/ui/i18n.ts`, add:

```ts
'action.openInBrowser': 'Open in Browser',
```

and:

```ts
'action.openInBrowser': '在浏览器中打开',
```

In `src/ui/pages/metaapps/app.ts`, inject the translated label into the script and add a Browser URL helper:

```ts
import { i18n } from '../../i18n';

function buildMetaAppsPageScript(): string {
  return `(() => {
  const OPEN_IN_BROWSER_TEXT = ${JSON.stringify(i18n.t('action.openInBrowser'))};
  function browserUrl(record) {
    const pinId = isMetaAppPinId(record?.pinId) ? String(record.pinId).trim() : '';
    return pinId ? '/browser/metaapp/' + encodeURIComponent(pinId) : '';
  }
  function renderDetail() {
    if (!elements.detail) return;
    const record = records.find((item) => item.pinId === selectedPinId) || records[0];
    if (!record) {
      elements.detail.innerHTML = '<div class="metaapps-empty">No MetaApp selected.</div>';
      return;
    }
    selectedPinId = record.pinId;
    const run = primaryRunUrl(record);
    const open = openUrl(record);
    const browser = browserUrl(record);
    const localDetail = nonGalleryUrl(record.localUiUrl);
    const download = downloadUrl(record);
    const safeShareTarget = safeUrl(record.metawebUrl) || localDetail;
    const validPinId = isMetaAppPinId(record.pinId) ? String(record.pinId).trim() : '';
    const commentCommand = validPinId ? 'metabot metaapp comment --pin-id ' + validPinId + ' --comment ""' : '';
    const status = statusLabel(record);
    const latest = latestLabel(record);
    const badges = [record.operation || 'metaapp', status, latest].filter(Boolean);
    const fields = [
      ['Pin', record.pinId],
      ['First pin', record.firstPinId],
      ['Version', record.version],
      ['Status', status],
      ['Latest', latest],
      ['Latest version', record.latestVersion || record.latest_version],
      ['Runtime', record.runtime],
      ['Owner', record.ownerGlobalMetaId],
      ['Updated', formatDate(record.updatedAt)],
      ['Source', record.source],
    ];
    elements.detail.innerHTML = '<header class="metaapps-detail-head">'
      + '<div><span class="metaapps-kicker">Selected</span><h2>' + escapeHtml(label(record)) + '</h2></div>'
      + '<div class="metaapps-badges">' + badges.map((badge) => '<span class="metaapps-version">' + escapeHtml(badge) + '</span>').join('') + '</div>'
      + '</header>'
      + (record.intro || record.prompt ? '<p class="metaapps-summary">' + escapeHtml(record.intro || record.prompt) + '</p>' : '')
      + '<div class="metaapps-actions">'
      + actionLink(open, 'Open')
      + actionLink(run, 'Run')
      + actionLink(browser, OPEN_IN_BROWSER_TEXT)
      + (localDetail && localDetail !== open && localDetail !== run && localDetail !== browser ? actionLink(localDetail, 'Local detail') : '')
      + actionLink(download, 'Download')
      + (record.pinId ? '<button type="button" class="metaapps-action" data-metaapps-copy="' + escapeHtml(record.pinId) + '">Copy pin</button>' : '')
      + (safeShareTarget ? '<button type="button" class="metaapps-action" data-metaapps-share="' + escapeHtml(safeShareTarget) + '">Share</button>' : '')
      + (commentCommand ? '<button type="button" class="metaapps-action" data-metaapps-copy="' + escapeHtml(commentCommand) + '">Copy comment command</button>' : '')
      + '</div>'
      + '<dl class="metaapps-fields">' + fields.map(([name, value]) => '<div><dt>' + escapeHtml(name) + '</dt><dd>' + escapeHtml(value || 'Unknown') + '</dd></div>').join('') + '</dl>'
      + renderVersionHistory(record);
  }
})();`;
}
```

Keep the existing `Open`, `Run`, `Local detail`, `Download`, `Copy pin`, `Share`, and `Copy comment command` behavior. Only add the explicit Browser action for valid MetaApp pin IDs.

- [ ] **Step 4: Run the focused tests and confirm GREEN**

Run:

```bash
npm run build && node --test tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit the MetaApps Browser-action slice**

Run:

```bash
git add src/ui/pages/metaapps/app.ts src/ui/i18n.ts tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: add metaapps browser action"
```

Post a buzz development diary for this commit.

---

### Task 5: Final Focused Verification And Readiness Check

**Files:**
- No file edits planned. This task is verification-only.
- Verify: `package.json`
- Verify: `scripts/build-metabot-skillpacks.mjs`
- Verify: `src/core/skills/baseSkillRegistry.ts`
- Verify: `SKILLs/metabot-browser-open/SKILL.md`
- Verify: `SKILLs/metabot-help/SKILL.md`
- Verify: `SKILLs/metabot-identity-manage/SKILL.md`
- Verify: `SKILLs/metabot-network-manage/SKILL.md`
- Verify: `SKILLs/metabot-call-remote-service/SKILL.md`
- Verify: `SKILLs/metabot-metaapp-publish/SKILL.md`
- Verify: `SKILLs/metabot-homepage-guide/SKILL.md`
- Verify: `docs/install/open-agent-connect.md`
- Verify: `docs/hosts/codex-agent-install.md`
- Verify: `docs/hosts/codex.md`
- Verify: `docs/hosts/claude-code.md`
- Verify: `docs/hosts/openclaw.md`
- Verify: `src/ui/pages/metaapps/app.ts`
- Verify: `src/ui/i18n.ts`
- Verify: `tests/npm/packageFiles.test.mjs`
- Verify: `tests/skillpacks/buildSkillpacks.test.mjs`
- Verify: `tests/cli/skills.test.mjs`
- Verify: `tests/docs/codexInstallDocs.test.mjs`
- Verify: `tests/ui/i18n.test.mjs`
- Verify: `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Run the full focused verification set**

Run:

```bash
npm run build
npm run build:skillpacks
node --test tests/npm/packageFiles.test.mjs tests/skillpacks/buildSkillpacks.test.mjs tests/cli/skills.test.mjs tests/docs/codexInstallDocs.test.mjs tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: all commands PASS. Do not expand to `npm test` unless these changes unexpectedly touch shared runtime behavior beyond docs, resolver metadata, or the MetaApps UI shell.

- [ ] **Step 2: Run a diff sanity check**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the intended Browser-guidance files are modified or committed.

- [ ] **Step 3: Dispatch final reviewers**

Run two review passes with model `gpt-5.5`:

```text
Review pass A: spec compliance against docs/superpowers/specs/2026-06-21-bot-browser-guidance-design.md
Review pass B: code quality, scope control, and regression risk
```

Expected: no finding that Browser was elevated above Bot Hub or that local management flows were redirected away from `/ui/*`.
