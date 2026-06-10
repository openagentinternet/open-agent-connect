# OAC Bot Page Console Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish `/ui/bot` into a selected-Bot-centered Bot Page Console whose default state shows only the selected Bot hero and the Public Identity editor.

**Architecture:** Adapt the existing built-in `/ui/bot` page in place. Keep the existing REST routes, modals, mutation behavior, and Provider Console top chrome, but split the current mixed `info/history/settings` UI into `publicIdentity`, `behavior`, `chatSkills`, `services`, and `advanced` tab renderers. Preserve old query links by mapping old tab/focus values into the new tab model.

**Tech Stack:** TypeScript strict mode compiling CommonJS into `dist/`, local HTML/CSS templates under `src/ui/pages`, Node ESM tests under `tests/`, and Playwright for isolated browser smoke coverage.

---

## Confirmed Product Decisions

- Work happens in the isolated worktree `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/bot-page-console-polish` on branch `codex/bot-page-console-polish`.
- `Services` tab keeps entry buttons only. It does not fetch or render a service list in this PR.
- Old `tab=history&focus=messages` deep links map to the new `Advanced` tab and focus execution history.
- Homepage `Upload` is a placeholder modal with this meaning: the current Bot uses the default Bot Page renderer and homepage package upload will be available later.
- Every independent, verifiable unit gets one commit. After every commit, post a development diary with `metabot-post-buzz`.

## Source Inputs

- PRD: `/Users/tusm/Documents/MetaID_Projects/pitch_metaid/docs/product/2026-06-09-oac-bot-page-console-polish-prd.md`
- Prototype: `/Users/tusm/Documents/MetaID_Projects/pitch_metaid/docs/product/prototypes/2026-06-09-oac-bot-page-console-v4.html`
- Existing page: `src/ui/pages/bot/app.ts` and `src/ui/pages/bot/index.html`

## File Map

- Modify `src/ui/pages/bot/index.html`: static layout, CSS, tab shell, hero placeholders, modal root, responsive behavior.
- Modify `src/ui/pages/bot/app.ts`: state model, renderers, save handlers, tab switching, deep-link mapping, copy/open actions, lazy advanced loads.
- Modify `src/ui/i18n.ts`: OAC-owned English and Simplified Chinese copy keys.
- Modify `tests/ui/botPageScript.test.mjs`: script-level behavior, tab routing, save payloads, modals, copy/open actions.
- Modify `tests/ui/i18n.test.mjs`: dictionary and translation coverage for new labels.
- Modify `tests/daemon/httpServer.test.mjs`: `/ui/bot` static route acceptance and zh-CN chrome/content assertions.
- Create `tests/playwright/bot-page-console.spec.mjs`: isolated browser smoke with mocked bot APIs.

## Subagent Execution Protocol

For each implementation task:

1. Dispatch a fresh implementer subagent with the task text, exact file boundaries, and the instruction that other agents may be editing nearby code and it must not revert unrelated edits.
2. The implementer writes or updates tests first and runs the focused command to observe the expected failure.
3. The implementer makes the smallest implementation that passes that task's tests.
4. Dispatch a spec reviewer subagent using model `gpt-5.5` to check PRD compliance for that task.
5. Dispatch a code quality reviewer subagent using model `gpt-5.5` to check maintainability, scope, and regression risk.
6. Apply any required fixes, rerun the focused tests, commit the task, then post the development diary via `metabot-post-buzz`.

Because most tasks share `src/ui/pages/bot/app.ts` and `src/ui/pages/bot/index.html`, implementation subagents should run sequentially unless their write sets are explicitly disjoint.

---

### Task 1: Bot Page IA And Default Layout

**Files:**
- Modify `src/ui/pages/bot/index.html`
- Modify `src/ui/pages/bot/app.ts`
- Modify `tests/daemon/httpServer.test.mjs`
- Modify `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Update static route tests for the new IA**

In `tests/daemon/httpServer.test.mjs`, update `GET /ui/bot renders the MetaBot-centered management workspace` so it asserts:

```js
assert.match(html, /Local Bots/);
assert.match(html, /data-bot-hero/);
assert.match(html, /data-live-indicator/);
assert.match(html, /data-copy-global-meta-id/);
assert.match(html, /data-copy-bot-uri/);
assert.match(html, /data-tab="publicIdentity"/);
assert.match(html, /data-tab="behavior"/);
assert.match(html, /data-tab="chatSkills"/);
assert.match(html, /data-tab="services"/);
assert.match(html, /data-tab="advanced"/);
assert.doesNotMatch(html, /data-stat-bots/);
assert.doesNotMatch(html, /data-stat-runtimes/);
assert.doesNotMatch(html, /data-tab="info"/);
assert.doesNotMatch(html, /data-tab="history"/);
assert.doesNotMatch(html, /data-tab="settings"/);
assert.doesNotMatch(html, /Collapsed Areas/);
```

Keep the existing Provider Console nav assertions:

```js
assert.match(nav, /href="\/ui\/bot"[^>]*>Bot Page(?: \*)?<\/a>/);
assert.match(nav, /href="\/ui\/conversations"[^>]*>Conversations(?: \*)?<\/a>/);
assert.match(nav, /href="\/ui\/services"[^>]*>Services(?: \*)?<\/a>/);
assert.match(nav, /href="\/ui\/settings"[^>]*>Settings(?: \*)?<\/a>/);
assert.match(html, /href="\/browser"[^>]*>Open Browser<\/a>/);
assert.doesNotMatch(nav, /href="\/ui\/browser"/);
```

- [ ] **Step 2: Add script tests for default tab and old deep-link mapping**

In `tests/ui/botPageScript.test.mjs`, replace old `info/history/settings` tab expectations with:

```js
const publicIdentityTab = tabElement('publicIdentity');
const behaviorTab = tabElement('behavior');
const chatSkillsTab = tabElement('chatSkills');
const servicesTab = tabElement('services');
const advancedTab = tabElement('advanced');
```

Add assertions:

```js
assert.equal(context.state.selectedTab, 'publicIdentity');
assert.equal(publicIdentityTab.active, true);
assert.equal(behaviorTab.active, false);
assert.equal(advancedTab.active, false);
```

For old compatibility links:

```js
// ?profile=alice&tab=info&focus=profile
assert.equal(context.state.selectedTab, 'publicIdentity');

// ?profile=alice&tab=info&focus=chat
assert.equal(context.state.selectedTab, 'chatSkills');

// ?profile=alice&tab=history&focus=messages
assert.equal(context.state.selectedTab, 'advanced');
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
```

Expected: fail on missing new tab names, hero hooks, and removed stat-card expectations.

- [ ] **Step 4: Update the static shell**

In `src/ui/pages/bot/index.html`:

- Remove the `bot-stats` section from the default shell.
- Keep `.bot-shell` but allow normal vertical scroll on narrow/mobile layouts.
- Change the side panel title from `Bots` to `Local Bots`.
- Add a main hero section with `data-bot-hero`, `data-live-indicator`, `data-hero-avatar`, `data-hero-name`, `data-hero-summary`, `data-hero-global-meta-id`, `data-hero-bot-uri`, `data-copy-global-meta-id`, and `data-copy-bot-uri`.
- Keep only `Open Public Bot Page` and `View Conversations` in the hero action row.
- Replace old tabs with:

```html
<button class="tab-btn active" data-tab="publicIdentity">Public Identity</button>
<button class="tab-btn" data-tab="behavior">Behavior</button>
<button class="tab-btn" data-tab="chatSkills">Chat Skills</button>
<button class="tab-btn" data-tab="services">Services</button>
<button class="tab-btn" data-tab="advanced">Advanced</button>
```

Use matching panels with `data-tab-panel`.

- [ ] **Step 5: Update the tab state and hero renderer**

In `src/ui/pages/bot/app.ts`:

- Set initial state to `selectedTab:'publicIdentity'`.
- Replace `renderDetailHeader(profile)` with selected Bot hero population.
- Remove default `loadStats()` from `loadAll()`.
- Keep `/api/bot/stats` route untouched, but do not call it for the first screen.
- Update `applyBotManagementRouteRequest()` so old links map:

```js
info + profile -> publicIdentity
info + chat -> chatSkills
history or messages -> advanced
```

- Keep `viewSelectedBotPage()` routing to `/browser/metaid/<globalMetaId>`.
- Keep `viewSelectedConversations()` routing to `/ui/conversations?from=<botSlug>`.
- Disable Bot URI copy and Open Public Bot Page when `globalMetaId` is missing.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
```

Commit:

```bash
git add src/ui/pages/bot/index.html src/ui/pages/bot/app.ts tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: reshape bot page console layout"
```

Post a buzz development diary for this commit.

---

### Task 2: Public Identity Default Tab

**Files:**
- Modify `src/ui/pages/bot/app.ts`
- Modify `src/ui/pages/bot/index.html`
- Modify `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Add failing tests for Public Identity rendering**

Add a test that calls `renderPublicIdentityTab()` with a profile:

```js
context.state.selectedSlug = 'alice';
context.state.profiles = [{
  slug: 'alice',
  name: 'Alice Bot',
  globalMetaId: 'gm-alice',
  bio: 'Writes code with the user.',
  avatarDataUrl: 'data:image/png;base64,avatar',
}];
context.renderPublicIdentityTab();

assert.match(root.innerHTML, /Bot Name/);
assert.match(root.innerHTML, /Public Bio/);
assert.match(root.innerHTML, /Homepage/);
assert.match(root.innerHTML, /Default Bot Page renderer/);
assert.match(root.innerHTML, /data-act="upload-homepage"/);
assert.match(root.innerHTML, /Save Public Identity/);
assert.match(root.innerHTML, /Reset/);
assert.doesNotMatch(root.innerHTML, /MetaApp/i);
assert.doesNotMatch(root.innerHTML, /PINID/i);
```

- [ ] **Step 2: Add failing tests for Public Identity save payload**

Add tests that `savePublicIdentity()` sends only changed public identity fields:

```js
assert.deepEqual(requestBody, {
  name: 'Alice Updated',
  bio: 'Updated public bio.',
  avatarDataUrl: '',
});
```

Also assert role, soul, goal, providers, and allowChatSkills are omitted.

- [ ] **Step 3: Add failing test for Homepage Upload placeholder**

Call `openHomepageUploadPlaceholder()` and assert modal content:

```js
assert.match(modal.innerHTML, /Default Bot Page renderer/);
assert.match(modal.innerHTML, /homepage package upload will be available later/i);
assert.doesNotMatch(modal.innerHTML, /MetaApp/i);
assert.doesNotMatch(modal.innerHTML, /PINID/i);
```

- [ ] **Step 4: Run tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Expected: fail because `renderPublicIdentityTab`, `savePublicIdentity`, and homepage placeholder do not exist yet.

- [ ] **Step 5: Implement Public Identity renderer and save handler**

In `src/ui/pages/bot/app.ts`:

- Add `renderPublicIdentityTab(options)`.
- Add `currentPublicIdentityDraft(profile)`.
- Add `savePublicIdentity()`.
- Add `resetPublicIdentity()`.
- Add `openHomepageUploadPlaceholder()`.
- Reuse existing avatar upload helpers.
- Keep chain-write success modal behavior by calling `showChainSuccessModal()` with title `Profile Updated On-Chain`.
- On successful save, update `state.profiles`, `state.originalProfile`, the side list, the hero, and the Public Identity tab.

Do not include role, soul, goal, provider, or chat skill fields in this tab.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Commit:

```bash
git add src/ui/pages/bot/app.ts src/ui/pages/bot/index.html tests/ui/botPageScript.test.mjs
git commit -m "feat: add public identity bot tab"
```

Post a buzz development diary for this commit.

---

### Task 3: Behavior Tab

**Files:**
- Modify `src/ui/pages/bot/app.ts`
- Modify `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Add failing tests for Behavior rendering**

Add a test that switches to `behavior` and asserts:

```js
assert.match(root.innerHTML, /Role/);
assert.match(root.innerHTML, /Soul/);
assert.match(root.innerHTML, /Goal/);
assert.match(root.innerHTML, /Primary LLM Provider/);
assert.match(root.innerHTML, /Fallback LLM Provider/);
assert.doesNotMatch(root.innerHTML, /Wallet/);
assert.doesNotMatch(root.innerHTML, /Execution History/);
assert.doesNotMatch(root.innerHTML, /Chat Allowed Skills/);
```

- [ ] **Step 2: Add failing tests for Behavior save semantics**

Update existing provider preservation tests to call `saveBehavior()` and assert:

```js
assert.deepEqual(requestBody, { role: 'New role' });
```

For touched provider controls:

```js
assert.deepEqual(requestBody, {
  primaryProvider: 'codex',
  fallbackProvider: null,
});
```

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Expected: fail because behavior-specific renderer/save functions are missing.

- [ ] **Step 4: Implement Behavior tab**

In `src/ui/pages/bot/app.ts`:

- Add `renderBehaviorTab(options)`.
- Add `currentBehaviorDraft(profile)`.
- Add `saveBehavior()`.
- Reuse `providerPickerMarkup()` and `wireProviderPickers()`.
- Preserve provider change semantics: only send provider fields when their picker has `data-provider-touched="1"`.
- Preserve unavailable provider bindings when unrelated fields are saved.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Commit:

```bash
git add src/ui/pages/bot/app.ts tests/ui/botPageScript.test.mjs
git commit -m "feat: move bot behavior controls into tab"
```

Post a buzz development diary for this commit.

---

### Task 4: Chat Skills Tab

**Files:**
- Modify `src/ui/pages/bot/app.ts`
- Modify `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Add failing tests for Chat Skills tab**

Add or update tests so `renderChatSkillsTab()` asserts:

```js
assert.match(root.innerHTML, /Chat Skills/);
assert.match(root.innerHTML, /private conversation replies/i);
assert.match(root.innerHTML, /data-field="chatSkillSelect"/);
assert.match(root.innerHTML, /data-act="add-chat-skill"/);
assert.match(root.innerHTML, /data-chat-skill-chip="weather\.lookup"/);
assert.doesNotMatch(root.innerHTML, /Publish Service/);
assert.doesNotMatch(root.innerHTML, /marketplace/i);
```

- [ ] **Step 2: Update add/remove tests to rerender Chat Skills**

Update the existing add/remove test so `wireChatSkillControls()` calls `renderChatSkillsTab()` after changes.

- [ ] **Step 3: Add failing save test**

Add a `saveChatSkills()` test:

```js
assert.deepEqual(requestBody, {
  allowChatSkills: ['orders.create', 'weather.lookup'],
});
```

- [ ] **Step 4: Run tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

- [ ] **Step 5: Implement Chat Skills tab**

In `src/ui/pages/bot/app.ts`:

- Change `loadChatSkillOptions()` rerender checks from `selectedTab==='info'` to `selectedTab==='chatSkills'`.
- Add `renderChatSkillsTab()`.
- Add `saveChatSkills()`.
- Keep `allowChatSkills` normalization and existing `/api/services/skills?from=<slug>` behavior.
- Do not mix service publishing or marketplace language into this tab.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Commit:

```bash
git add src/ui/pages/bot/app.ts tests/ui/botPageScript.test.mjs
git commit -m "feat: separate bot chat skills tab"
```

Post a buzz development diary for this commit.

---

### Task 5: Services Entry Tab

**Files:**
- Modify `src/ui/pages/bot/app.ts`
- Modify `tests/ui/botPageScript.test.mjs`

- [ ] **Step 1: Add failing tests for Services tab**

Add a test that calls `renderServicesTab()` and asserts:

```js
assert.match(root.innerHTML, /Publish Service/);
assert.match(root.innerHTML, /Manage Services/);
assert.match(root.innerHTML, /href="\/ui\/publish\?from=alice"/);
assert.match(root.innerHTML, /href="\/ui\/services\?from=alice"/);
assert.doesNotMatch(root.innerHTML, /marketplace/i);
assert.doesNotMatch(root.innerHTML, /data-service-list/);
```

Add a fetch guard:

```js
fetch: () => {
  throw new Error('Services tab should not fetch service lists in this PR');
}
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

- [ ] **Step 3: Implement entry-only Services tab**

In `src/ui/pages/bot/app.ts`:

- Add `renderServicesTab()`.
- Use selected profile slug to build `/ui/publish?from=<slug>` and `/ui/services?from=<slug>`.
- If no slug is selected, render disabled buttons or non-clickable explanatory text.
- Do not call `/api/services/owned`.
- Do not render consumer marketplace discovery.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs
```

Commit:

```bash
git add src/ui/pages/bot/app.ts tests/ui/botPageScript.test.mjs
git commit -m "feat: add bot services entry tab"
```

Post a buzz development diary for this commit.

---

### Task 6: Advanced Tab

**Files:**
- Modify `src/ui/pages/bot/app.ts`
- Modify `src/ui/pages/bot/index.html`
- Modify `tests/ui/botPageScript.test.mjs`
- Modify `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Add failing tests for Advanced rendering**

Add script tests asserting `renderAdvancedTab()` includes:

```js
assert.match(root.innerHTML, /Wallet/);
assert.match(root.innerHTML, /Backup/);
assert.match(root.innerHTML, /Refresh Runtimes/);
assert.match(root.innerHTML, /LLM Providers/);
assert.match(root.innerHTML, /Execution History/);
assert.match(root.innerHTML, /Delete Bot/);
assert.match(root.innerHTML, /Default Write Network/);
assert.match(root.innerHTML, /data-execution-history-list/);
```

And default Public Identity output does not include those strings.

- [ ] **Step 2: Add failing tests for lazy advanced loads**

Update tests so:

```js
await context.loadProfiles();
assert.equal(calls.includes('/api/bot/sessions?slug=alice&limit=50'), false);

context.switchTab('advanced');
await waitFor(() => calls.includes('/api/bot/sessions?slug=alice&limit=50'), 'advanced session load');
```

For old history deep link:

```js
assert.equal(context.state.selectedTab, 'advanced');
assert.deepEqual(context.state.sessions.map((session) => session.sessionId), ['session-alice']);
```

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
```

- [ ] **Step 4: Implement Advanced tab**

In `src/ui/pages/bot/app.ts`:

- Add `renderAdvancedTab()`.
- Move the wallet, backup, delete, runtime, history, and default write network controls into Advanced.
- Keep existing modal functions and delete countdown unchanged.
- Render execution history inside Advanced and call `loadSessions()` only when Advanced is active.
- Render default write network settings in Advanced and call `loadSelectedProfileConfig()` only when Advanced is active.
- Update `confirmDeleteMetabot()` to refresh profiles and Advanced content without calling removed default stats rendering.
- Update interval refresh so it only refreshes sessions/config while Advanced is active.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
```

Commit:

```bash
git add src/ui/pages/bot/app.ts src/ui/pages/bot/index.html tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: move local bot controls into advanced tab"
```

Post a buzz development diary for this commit.

---

### Task 7: i18n And Copy Updates

**Files:**
- Modify `src/ui/i18n.ts`
- Modify `src/ui/pages/bot/app.ts`
- Modify `src/ui/pages/bot/index.html`
- Modify `tests/ui/i18n.test.mjs`
- Modify `tests/daemon/httpServer.test.mjs`

- [ ] **Step 1: Add failing dictionary tests**

In `tests/ui/i18n.test.mjs`, import `DICTIONARIES` and `translate`, then assert representative new labels:

```js
assert.equal(translate('en', 'bot.localBots'), 'Local Bots');
assert.equal(translate('zh-CN', 'bot.localBots'), '本地 Bots');
assert.equal(translate('en', 'bot.liveByDefault'), 'Live by default');
assert.equal(translate('zh-CN', 'bot.liveByDefault'), '默认在线');
assert.equal(translate('en', 'bot.defaultRenderer'), 'Default Bot Page renderer');
assert.equal(translate('zh-CN', 'bot.defaultRenderer'), '默认 Bot Page 渲染器');
```

- [ ] **Step 2: Add zh-CN page assertions**

Update `GET /ui/bot supports zh-CN local UI chrome without changing routes`:

```js
assert.match(html, /本地 Bots/);
assert.match(html, /默认在线/);
assert.match(html, /公开身份/);
assert.match(html, /行为/);
assert.match(html, /聊天技能/);
assert.match(html, /高级/);
assert.match(html, /打开公开 Bot Page/);
assert.match(html, /查看对话/);
```

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs
```

- [ ] **Step 4: Add i18n keys and dynamic copy usage**

In `src/ui/i18n.ts`, add English and Simplified Chinese keys for all OAC-owned labels from the PRD, including:

```ts
'bot.localBots'
'bot.createBot'
'bot.liveByDefault'
'bot.globalMetaId'
'bot.botUri'
'bot.openPublicBotPage'
'bot.viewConversations'
'bot.publicIdentity'
'bot.behavior'
'bot.chatSkills'
'bot.services'
'bot.advanced'
'bot.botName'
'bot.avatar'
'bot.publicBio'
'bot.homepage'
'bot.defaultRenderer'
'bot.upload'
'bot.savePublicIdentity'
'bot.reset'
'bot.role'
'bot.soul'
'bot.goal'
'bot.primaryLlmProvider'
'bot.fallbackLlmProvider'
'bot.publishService'
'bot.manageServices'
'bot.wallet'
'bot.backup'
'bot.executionHistory'
'bot.deleteBot'
```

In `src/ui/pages/bot/index.html`, use `data-i18n-key` for static labels. In `src/ui/pages/bot/app.ts`, route all generated OAC-owned strings through `uiText(key, fallback)`. Do not pass Bot names, bios, service descriptions, chain data, GlobalMetaID, Bot URI, or messages through translation.

- [ ] **Step 5: Rerender dynamic UI after language changes**

Listen for the existing `oac:i18n-changed` event in the bot script and rerender:

```js
window.addEventListener('oac:i18n-changed', function(){
  renderMetabotList();
  renderSelectedBotHero(selectedProfile());
  renderCurrentTab({ preserveDraft: true });
});
```

Keep user-entered draft values where practical.

- [ ] **Step 6: Run focused tests and commit**

Run:

```bash
npm run build && node --test tests/ui/i18n.test.mjs tests/ui/botPageScript.test.mjs tests/daemon/httpServer.test.mjs
```

Commit:

```bash
git add src/ui/i18n.ts src/ui/pages/bot/app.ts src/ui/pages/bot/index.html tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs
git commit -m "feat: localize bot page console copy"
```

Post a buzz development diary for this commit.

---

### Task 8: Browser Smoke

**Files:**
- Create `tests/playwright/bot-page-console.spec.mjs`
- Modify `tests/ui/botPageScript.test.mjs` only if browser smoke reveals a narrow behavior gap

- [ ] **Step 1: Add isolated Playwright test**

Create `tests/playwright/bot-page-console.spec.mjs` following the local mock-server pattern in `tests/playwright/loom-product-ui.spec.mjs`.

The mock server must serve:

```js
GET /ui/bot -> rendered bot page HTML
GET /ui/shared.css -> shared CSS
GET /api/bot/profiles -> two mocked profiles
GET /api/bot/runtimes -> healthy mocked runtime list
GET /api/services/skills?from=alice -> mocked skills
GET /api/bot/sessions?slug=alice&limit=50 -> mocked session history
PUT /api/bot/profiles/alice -> echo updated profile with chainWrites
PUT /api/bot/profiles/alice/config -> echo config
```

The smoke assertions:

```js
await expect(page.locator('[data-bot-hero]')).toBeVisible();
await expect(page.getByRole('button', { name: 'Public Identity' })).toHaveClass(/active/);
await expect(page.getByText('Default Bot Page renderer')).toBeVisible();
await expect(page.getByText('Execution History')).not.toBeVisible();
await expect(page.getByText(/MetaApp|PINID/i)).toHaveCount(0);
```

Click `Upload` and assert the placeholder modal appears. Click each tab and assert expected content appears. Set viewport to mobile width and assert the hero, tabs, and address rows are still visible without horizontal body overflow.

- [ ] **Step 2: Run browser smoke and confirm RED if needed**

Run:

```bash
npm run build && node --test tests/playwright/bot-page-console.spec.mjs
```

If Playwright browser binaries are missing, record the exact failure and continue with unit/static verification, but do not claim browser smoke passed.

- [ ] **Step 3: Fix browser-only issues**

Apply only fixes that directly support the PRD acceptance criteria:

- text overflow;
- default tab visibility;
- modal affordance;
- disabled no-GlobalMetaID actions;
- tab switching and lazy Advanced rendering.

- [ ] **Step 4: Run targeted suite and commit**

Run:

```bash
npm run build && node --test tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs tests/playwright/bot-page-console.spec.mjs
```

Commit:

```bash
git add tests/playwright/bot-page-console.spec.mjs src/ui/pages/bot/app.ts src/ui/pages/bot/index.html tests/ui/botPageScript.test.mjs
git commit -m "test: add bot page console browser smoke"
```

Post a buzz development diary for this commit.

---

### Task 9: Final Verification And Branch Review

**Files:**
- No planned source edits unless verification exposes a task-scoped defect.

- [ ] **Step 1: Run final targeted verification**

Run:

```bash
npm run build
npm run build && node --test tests/ui/botPageScript.test.mjs tests/ui/i18n.test.mjs tests/daemon/httpServer.test.mjs tests/playwright/bot-page-console.spec.mjs
```

Do not run full `npm test` unless the implementation changed shared runtime behavior, persistence formats, release artifacts, package/build plumbing, or the targeted suite exposes broader risk.

- [ ] **Step 2: Run final code review subagent**

Dispatch a final reviewer with model `gpt-5.5` and ask it to inspect:

- PRD acceptance criteria;
- no `/browser` redesign;
- no old route/API deletion;
- no default stats/dashboard clutter;
- no MetaApp/PINID user-facing copy in Homepage UI;
- i18n applied only to OAC-owned copy;
- tests cover default state, tab routing, save payloads, and smoke.

- [ ] **Step 3: Fix only confirmed defects**

If review or tests find defects, make the smallest fix, rerun the relevant test command, commit, and post a buzz diary.

- [ ] **Step 4: Summarize**

Report:

- worktree path;
- branch name;
- commits created;
- verification commands and outcomes;
- any tests not run and exact reason;
- residual risks.
