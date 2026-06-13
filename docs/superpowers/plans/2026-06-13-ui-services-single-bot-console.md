# UI Services Single-Bot Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/ui/services` as a one-Bot-at-a-time provider console with a Conversations-style Bot selector, centered single-column service cards, and modal service details.

**Architecture:** Keep the existing `buildMyServicesPageDefinition()` static TypeScript page and daemon service APIs, but change the page state from global `all=true` listing to a selected local profile slug. Add an active profile marker to `/api/bot/profiles`, preserve the selected profile through `from=<slug>` links, and move order details from the permanent right panel into an accessible modal.

**Tech Stack:** TypeScript strict mode compiled to CommonJS in `dist/`, local HTML/CSS/inline browser scripts under `src/ui/pages`, daemon handlers under `src/daemon`, Node ESM tests under `tests/`, and optional Playwright or in-app browser smoke testing for final UI verification.

---

## Confirmed Product Decisions

- Work happens in `/Users/tusm/Documents/MetaID_Projects/open-agent-connect/.worktrees/codex/ui-services` on branch `codex/ui-services`.
- Source spec: `docs/superpowers/specs/2026-06-13-ui-services-single-bot-console-design.md`.
- `/ui/services` must show exactly one selected Bot's services.
- There is no "All Bots" option in the selector or service API flow.
- Default selected Bot is the daemon-reported active Bot.
- The Bot selector reuses the Conversations avatar/name dropdown pattern.
- Service details open in a centered modal; the permanent right-side detail column is removed.
- The service list is a centered single column of wider cards.
- Each independent, verifiable task gets one commit. After every commit, post a development diary with `metabot-post-buzz`.

## File Map

- Modify `src/daemon/defaultHandlers.ts`: add `isActive` to `handlers.bot.listProfiles()` results by comparing each profile `homeDir` to the daemon input `homeDir`.
- Modify `tests/daemon/defaultBotHandlers.test.mjs`: assert `/api/bot/profiles` handler output marks the active Bot.
- Modify `src/ui/pages/my-services/app.ts`: add Bot profile state, selector rendering, scoped service/order URLs, selected-Bot URL persistence, detail modal state, modal event handling, and selected-Bot Publish/Refunds links.
- Modify `src/ui/pages/my-services/index.html`: replace split workspace CSS with a centered one-column layout, add selector styles copied from Conversations with Services-scoped class names, add service card styling, and add detail modal styling.
- Modify `src/ui/pages/services/app.ts`: keep the wrapper behavior unchanged for this iteration.
- Modify `src/ui/pages/publish/app.ts`: read `from=<slug>` from the URL and preselect that MetaBot when present and valid.
- Modify `src/ui/pages/refund/app.ts`: read `from=<slug>` and scope refund list/sync calls to that Bot.
- Modify `tests/ui/providerViewModels.test.mjs`: add static page assertions for the Bot selector, modal, no right detail panel, no `all=true`, and selected-Bot links.
- Modify `tests/ui/refundPageApp.test.mjs`: assert refund URL `from` is used in sync/list calls.
- Create `tests/ui/myServicesPageScript.test.mjs`: browser-script-level tests for selected Bot defaulting, service URL scoping, selector switching, modal open/close, and Publish link context.

## Subagent Execution Protocol

Use `superpowers:subagent-driven-development` when executing this plan.

For each task:

1. Dispatch one fresh implementer subagent with the full task text, the source spec path, the worktree path, and the instruction to avoid reverting unrelated edits.
2. The implementer writes or updates tests first and runs the focused command to confirm the expected failure.
3. The implementer makes the smallest implementation that satisfies the task.
4. Dispatch a spec compliance reviewer subagent using model `gpt-5.5`.
5. Only after spec compliance passes, dispatch a code quality reviewer subagent using model `gpt-5.5`.
6. If either reviewer finds issues, send the same implementer subagent the exact findings and rerun the relevant focused tests.
7. Commit the task and post the development diary through `metabot-post-buzz`.

Implementation subagents must run sequentially for this plan because most tasks edit `src/ui/pages/my-services/app.ts` and `src/ui/pages/my-services/index.html`.

---

### Task 1: Active Bot Marker In Profile API

**Files:**
- Modify `src/daemon/defaultHandlers.ts`
- Modify `tests/daemon/defaultBotHandlers.test.mjs`

- [ ] **Step 1: Write the failing active-profile assertion**

In `tests/daemon/defaultBotHandlers.test.mjs`, update `default bot handlers create, list, and fetch MetaBot profiles` so the existing `listed` assertions include:

```js
assert.equal(listed.ok, true);
assert.deepEqual(listed.data.profiles.map((profile) => profile.slug), ['alice-bot']);
assert.equal(listed.data.profiles[0].isActive, true);
assert.equal(typeof listed.data.profiles[0].homeDir, 'string');
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs
```

Expected: FAIL because `listed.data.profiles[0].isActive` is `undefined`.

- [ ] **Step 3: Add `isActive` to Bot profile listing**

In `src/daemon/defaultHandlers.ts`, update `handlers.bot.listProfiles` near the `listMetabotProfiles(normalizedSystemHomeDir)` call so each returned profile includes an active marker:

```ts
listProfiles: async () => {
  const profiles = await listMetabotProfiles(normalizedSystemHomeDir);
  const activeHomeDir = path.resolve(input.homeDir);
  await Promise.all(profiles.map(async (profile) => {
    if (!profile.avatarDataUrl && profile.globalMetaId) {
      const chainAvatar = await resolveChainAvatarDataUrl(profile.globalMetaId);
      if (chainAvatar) {
        profile.avatarDataUrl = chainAvatar;
      }
    }
  }));
  return commandSuccess({
    profiles: profiles.map((profile) => ({
      ...profile,
      isActive: path.resolve(profile.homeDir) === activeHomeDir,
    })),
  });
},
```

Keep the existing avatar resolution behavior intact.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post development diary**

Run:

```bash
git add src/daemon/defaultHandlers.ts tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: mark active bot profile"
```

Post a `metabot-post-buzz` development diary that mentions the active profile marker and the focused test command.

---

### Task 2: Services Page Static Contract

**Files:**
- Modify `tests/ui/providerViewModels.test.mjs`
- Modify `src/ui/pages/my-services/app.ts`

- [ ] **Step 1: Add static assertions for the new Services shell**

In `tests/ui/providerViewModels.test.mjs`, extend `publish and my-services pages expose skill-service v1.1 service controls` with these assertions after `const myServicesHtml` and `const myServicesScript`:

```js
assert.match(myServicesHtml, /data-services-bot-picker/);
assert.match(myServicesHtml, /data-services-bot-trigger/);
assert.match(myServicesHtml, /data-services-bot-current/);
assert.match(myServicesHtml, /data-services-bot-menu/);
assert.match(myServicesHtml, /data-my-service-detail-modal/);
assert.match(myServicesHtml, /data-my-service-detail-modal-body/);
assert.doesNotMatch(myServicesHtml, /my-services-detail-panel/);
assert.doesNotMatch(myServicesHtml, /data-my-service-detail aria-label="Selected service details"/);
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/providerViewModels.test.mjs
```

Expected: FAIL on missing selector hooks, missing detail modal hooks, and the existing permanent detail panel.

- [ ] **Step 3: Replace the permanent detail panel with selector and modal hooks**

In `src/ui/pages/my-services/app.ts`, change `contentHtml` so the toolbar actions use buttons/anchors with data hooks:

```ts
const publishAction = options.includePublishAction
  ? '<a class="btn btn-primary" href="/ui/publish" data-my-services-publish>Publish Service</a>'
  : '';
const refundsAction = options.includeRefundsAction
  ? '<a class="btn btn-primary" href="/ui/refund" data-my-services-refunds>Service Refunds</a>'
  : '';
```

Add this selector block between the notice and workspace:

```html
<div class="services-bot-filter">
  <label id="services-bot-picker-label">Local Bot</label>
  <div class="services-bot-picker" data-services-bot-picker>
    <button class="services-bot-trigger" type="button" data-services-bot-trigger aria-labelledby="services-bot-picker-label" aria-haspopup="listbox" aria-expanded="false">
      <span class="services-bot-current" data-services-bot-current></span>
      <span class="services-bot-chevron" aria-hidden="true">▾</span>
    </button>
    <div class="services-bot-menu" data-services-bot-menu role="listbox" hidden></div>
  </div>
</div>
```

Remove the `<section class="my-services-detail-panel" ...>` block from `my-services-workspace`.

Add this detail modal after the workspace and before the edit modal:

```html
<div class="my-services-modal" data-my-service-detail-modal hidden>
  <div class="my-services-modal-dialog my-service-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="my-service-detail-title">
    <div class="modal-heading">
      <div>
        <h2 id="my-service-detail-title">Service Detail</h2>
        <p data-my-service-order-page-label>0 orders</p>
      </div>
      <button class="modal-close" type="button" data-my-service-detail-close aria-label="Close service detail modal">x</button>
    </div>
    <div data-my-service-detail-modal-body></div>
  </div>
</div>
```

Update the `elements` map by adding:

```js
publish: document.querySelector('[data-my-services-publish]'),
refunds: document.querySelector('[data-my-services-refunds]'),
botPicker: document.querySelector('[data-services-bot-picker]'),
botTrigger: document.querySelector('[data-services-bot-trigger]'),
botCurrent: document.querySelector('[data-services-bot-current]'),
botMenu: document.querySelector('[data-services-bot-menu]'),
detailModal: document.querySelector('[data-my-service-detail-modal]'),
detailModalBody: document.querySelector('[data-my-service-detail-modal-body]'),
```

Keep `detailSummary` and `orders` references untouched in this task if the old `renderDetail()` still needs them temporarily. Task 5 removes the old detail renderer and finishes the modal body wiring.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npm run build && node --test tests/ui/providerViewModels.test.mjs
```

Expected: PASS for selector and modal shell assertions. Runtime selected-Bot behavior remains covered by later tasks.

- [ ] **Step 5: Commit and post development diary**

Run:

```bash
git add src/ui/pages/my-services/app.ts tests/ui/providerViewModels.test.mjs
git commit -m "feat: add services single-bot shell hooks"
```

Post a `metabot-post-buzz` development diary describing the selector and modal shell contract.

---

### Task 3: Selected Bot State And Scoped Service Reads

**Files:**
- Create `tests/ui/myServicesPageScript.test.mjs`
- Modify `src/ui/pages/my-services/app.ts`

- [ ] **Step 1: Add a browser-script harness**

Create `tests/ui/myServicesPageScript.test.mjs` with a minimal DOM harness that can run `buildMyServicesPageDefinition().script`:

```js
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildMyServicesPageDefinition } = require('../../dist/ui/pages/my-services/app.js');

class FakeElement {
  constructor(attrs = {}) {
    this.attrs = { ...attrs };
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.listeners = new Map();
    this.children = [];
    this.textContent = '';
    this.value = '';
  }
  set innerHTML(value) { this._innerHTML = String(value || ''); }
  get innerHTML() { return this._innerHTML || ''; }
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  getAttribute(name) { return this.attrs[name] || ''; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  matches(selector) {
    if (selector === '[data-services-bot-trigger]') return this.attrs['data-services-bot-trigger'] != null;
    if (selector === '[data-my-services-refresh]') return this.attrs['data-my-services-refresh'] != null;
    return false;
  }
  closest() { return this; }
  querySelectorAll() { return []; }
}

function createElements() {
  return {
    '[data-my-services-page-label]': new FakeElement(),
    '[data-my-services-refresh]': new FakeElement({ 'data-my-services-refresh': '' }),
    '[data-my-services-notice]': new FakeElement(),
    '[data-my-services-list]': new FakeElement(),
    '[data-my-services-list-count]': new FakeElement(),
    '[data-services-page-prev]': new FakeElement(),
    '[data-services-page-next]': new FakeElement(),
    '[data-my-services-publish]': new FakeElement(),
    '[data-my-services-refunds]': new FakeElement(),
    '[data-services-bot-picker]': new FakeElement(),
    '[data-services-bot-trigger]': new FakeElement({ 'data-services-bot-trigger': '' }),
    '[data-services-bot-current]': new FakeElement(),
    '[data-services-bot-menu]': new FakeElement(),
    '[data-my-service-detail-modal]': new FakeElement(),
    '[data-my-service-detail-modal-body]': new FakeElement(),
    '[data-my-service-order-page-label]': new FakeElement(),
    '[data-orders-page-prev]': new FakeElement(),
    '[data-orders-page-next]': new FakeElement(),
    '[data-my-service-edit-modal]': new FakeElement(),
    '[data-my-service-edit-form]': new FakeElement(),
    '[data-edit-provider-skill-select]': new FakeElement(),
    '[data-edit-provider-skill-add]': new FakeElement(),
    '[data-edit-provider-skill-chips]': new FakeElement(),
    '[data-edit-output-type]': new FakeElement(),
    '[data-edit-currency]': new FakeElement(),
    '[data-edit-price]': new FakeElement(),
    '[data-edit-cover-input]': new FakeElement(),
    '[data-edit-cover-preview]': new FakeElement(),
    '[data-edit-cover-remove]': new FakeElement(),
    '[data-edit-cover-note]': new FakeElement(),
    '[data-my-service-revoke-modal]': new FakeElement(),
    '[data-my-service-revoke-copy]': new FakeElement(),
    '[data-my-service-revoke-confirm]': new FakeElement(),
  };
}

function createFetch() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (url === '/api/bot/profiles') {
      return { json: async () => ({ ok: true, data: { profiles: [
        { slug: 'alice-bot', name: 'Alice Bot', globalMetaId: 'idq1alice', isActive: false },
        { slug: 'bob-bot', name: 'Bob Bot', globalMetaId: 'idq1bob', isActive: true },
      ] } }) };
    }
    if (String(url).startsWith('/api/services/owned?')) {
      return { json: async () => ({ ok: true, data: { page: 1, pageSize: 20, total: 0, totalPages: 0, items: [] } }) };
    }
    if (String(url).startsWith('/api/services/owned/orders?')) {
      return { json: async () => ({ ok: true, data: { page: 1, pageSize: 10, total: 0, totalPages: 0, items: [] } }) };
    }
    return { json: async () => ({ ok: false, message: `Unexpected URL: ${url}` }) };
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

function runPage(search = '') {
  const elements = createElements();
  const listeners = new Map();
  const fetchImpl = createFetch();
  const location = { pathname: '/ui/services', search };
  const context = {
    document: {
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: () => [],
      addEventListener: (name, handler) => listeners.set(name, handler),
    },
    window: {
      location,
      history: {
        replaceState: (unused, title, nextUrl) => { location.search = nextUrl.includes('?') ? nextUrl.slice(nextUrl.indexOf('?')) : ''; },
      },
    },
    fetch: fetchImpl,
    navigator: { clipboard: { writeText: async () => {} } },
    URLSearchParams,
    encodeURIComponent,
    setTimeout,
    clearTimeout,
    Promise,
    String,
    Number,
    Array,
    Date,
    Error,
    console,
  };
  vm.runInNewContext(buildMyServicesPageDefinition({ includePublishAction: true, includeRefundsAction: true }).script, context);
  return { elements, fetchImpl, location, listeners };
}
```

- [ ] **Step 2: Add RED tests for active default and scoped reads**

In the same file, add:

```js
function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      if (condition()) return resolve();
      if (Date.now() - startedAt > 1000) return reject(new Error(`Timed out waiting for ${label}`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

test('services page defaults to active Bot and scopes service reads', async () => {
  const { fetchImpl, location, elements } = runPage('');
  await waitFor(() => fetchImpl.calls.some((url) => url.startsWith('/api/services/owned?')), 'services load');
  assert.equal(fetchImpl.calls[0], '/api/bot/profiles');
  assert.match(fetchImpl.calls.find((url) => url.startsWith('/api/services/owned?')), /from=bob-bot/);
  assert.doesNotMatch(fetchImpl.calls.find((url) => url.startsWith('/api/services/owned?')), /all=true/);
  assert.equal(location.search, '?from=bob-bot');
  assert.equal(elements['[data-my-services-publish]'].attrs.href, '/ui/publish?from=bob-bot');
  assert.equal(elements['[data-my-services-refunds]'].attrs.href, '/ui/refund?from=bob-bot');
});

test('services page honors valid from query before active Bot', async () => {
  const { fetchImpl, location } = runPage('?from=alice-bot');
  await waitFor(() => fetchImpl.calls.some((url) => url.startsWith('/api/services/owned?')), 'services load');
  assert.match(fetchImpl.calls.find((url) => url.startsWith('/api/services/owned?')), /from=alice-bot/);
  assert.equal(location.search, '?from=alice-bot');
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/myServicesPageScript.test.mjs
```

Expected: FAIL because the script does not load profiles, does not set `selectedBotSlug`, and still uses `all=true`.

- [ ] **Step 4: Implement selected Bot state**

In `src/ui/pages/my-services/app.ts`, add URL and Bot state near the existing `state` object:

```js
const query = new URLSearchParams(window.location.search);

const state = {
  profiles: [],
  selectedBotSlug: normalizeTextClient(query.get('from')),
  botPickerOpen: false,
  servicesPage: null,
  ordersPage: null,
  selectedServiceId: '',
  detailModalOpen: false,
  lastDetailTrigger: null,
  mutationResult: null,
  error: null,
  busy: false,
  servicesPageNumber: 1,
  servicesPageSize: 20,
  ordersPageNumber: 1,
  ordersPageSize: 10,
  editServiceId: '',
  revokeServiceId: '',
  editCoverDataUrl: '',
  editCoverUri: '',
  editCoverPreviewUri: '',
  editCoverRemoved: false,
  editSkillOptions: [],
  editSelectedProviderSkillValues: [],
  editCandidateProviderSkillValue: '',
};
```

Add helper functions:

```js
const selectedProfile = () => state.profiles.find((profile) => normalizeTextClient(profile && profile.slug) === state.selectedBotSlug) || null;
const activeProfile = () => state.profiles.find((profile) => profile && profile.isActive === true) || null;
const firstProfile = () => state.profiles[0] || null;
const selectedBotQuery = () => state.selectedBotSlug ? 'from=' + encodeURIComponent(state.selectedBotSlug) : '';
const setUrlState = () => {
  const next = new URLSearchParams(window.location.search);
  if (state.selectedBotSlug) next.set('from', state.selectedBotSlug); else next.delete('from');
  const suffix = next.toString();
  window.history.replaceState(null, '', window.location.pathname + (suffix ? '?' + suffix : ''));
};
const scopedHref = (baseHref) => state.selectedBotSlug ? baseHref + '?from=' + encodeURIComponent(state.selectedBotSlug) : baseHref;
const updateActionLinks = () => {
  if (elements.publish) elements.publish.setAttribute('href', scopedHref('/ui/publish'));
  if (elements.refunds) elements.refunds.setAttribute('href', scopedHref('/ui/refund'));
};
```

Add profile loading:

```js
const loadProfiles = async () => {
  const data = await fetchJson('/api/bot/profiles');
  state.profiles = Array.isArray(data.profiles) ? data.profiles.filter((profile) => profile && normalizeTextClient(profile.slug)) : [];
  const requested = state.selectedBotSlug;
  if (!requested || !state.profiles.some((profile) => normalizeTextClient(profile.slug) === requested)) {
    const fallback = activeProfile() || firstProfile();
    state.selectedBotSlug = fallback ? normalizeTextClient(fallback.slug) : '';
  }
  setUrlState();
  updateActionLinks();
};
```

Change `loadServices()` to fetch a selected Bot scope:

```js
const fetchServicesPage = () => fetchJson('/api/services/owned?from=' + encodeURIComponent(state.selectedBotSlug)
  + '&page=' + encodeURIComponent(String(state.servicesPageNumber))
  + '&pageSize=' + encodeURIComponent(String(state.servicesPageSize))
  + '&refresh=' + (refresh ? 'true' : 'false'));
```

Change `loadOrders()` to include `from`:

```js
const fetchOrdersPage = () => fetchJson('/api/services/owned/orders?serviceId=' + encodeURIComponent(serviceId)
  + '&from=' + encodeURIComponent(state.selectedBotSlug)
  + '&page=' + encodeURIComponent(String(state.ordersPageNumber))
  + '&pageSize=' + encodeURIComponent(String(state.ordersPageSize))
  + '&refresh=' + (refresh ? 'true' : 'false'));
```

Replace the final startup call with:

```js
loadProfiles()
  .then(() => loadServices(false))
  .catch(setError);
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```bash
npm run build && node --test tests/ui/myServicesPageScript.test.mjs tests/ui/providerViewModels.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit and post development diary**

Run:

```bash
git add src/ui/pages/my-services/app.ts tests/ui/myServicesPageScript.test.mjs tests/ui/providerViewModels.test.mjs
git commit -m "feat: scope services to selected bot"
```

Post a `metabot-post-buzz` development diary describing the selected Bot state, URL persistence, and scoped service reads.

---

### Task 4: Bot Selector Interaction

**Files:**
- Modify `tests/ui/myServicesPageScript.test.mjs`
- Modify `src/ui/pages/my-services/app.ts`

- [ ] **Step 1: Add selector interaction test**

In `tests/ui/myServicesPageScript.test.mjs`, extend `FakeElement` with parsed buttons for `data-services-bot-option`:

```js
set innerHTML(value) {
  this._innerHTML = String(value || '');
  this.children = [];
  for (const match of this._innerHTML.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gu)) {
    const button = new FakeElement();
    for (const attrMatch of (match[1] || '').matchAll(/\s([a-zA-Z0-9_-]+)="([^"]*)"/gu)) {
      button.attrs[attrMatch[1]] = attrMatch[2];
    }
    this.children.push(button);
  }
}
querySelectorAll(selector) {
  if (selector === '[data-services-bot-option]') return this.children.filter((child) => child.attrs['data-services-bot-option'] != null);
  return [];
}
```

Add:

```js
test('services Bot selector has no All Bots option and switching reloads selected Bot', async () => {
  const { fetchImpl, elements, location } = runPage('');
  await waitFor(() => elements['[data-services-bot-menu]'].children.length === 2, 'bot options');
  assert.doesNotMatch(elements['[data-services-bot-menu]'].innerHTML, /All Bots/);
  const aliceOption = elements['[data-services-bot-menu]'].children.find((button) => button.attrs['data-services-bot-option'] === 'alice-bot');
  assert.ok(aliceOption);
  await aliceOption.listeners.get('click')();
  await waitFor(() => fetchImpl.calls.filter((url) => url.startsWith('/api/services/owned?')).some((url) => /from=alice-bot/.test(url)), 'alice reload');
  assert.equal(location.search, '?from=alice-bot');
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/myServicesPageScript.test.mjs
```

Expected: FAIL because the selector does not render options or handle selection yet.

- [ ] **Step 3: Implement selector rendering and switching**

In `src/ui/pages/my-services/app.ts`, add avatar helpers by adapting the Conversations page implementation with Services-scoped names:

```js
const normalizeAvatarUrl = (rawAvatar) => {
  const raw = normalizeTextClient(rawAvatar);
  if (!raw) return '';
  if (/^(data:|blob:)/iu.test(raw)) return raw;
  if (/^https?:\/\//iu.test(raw) || raw.indexOf('/') === 0) return raw;
  if (/^[0-9a-f]{64}(?:i[0-9]+)?$/iu.test(raw) || raw.toLowerCase().indexOf('metafile://') === 0) {
    return '/api/file/avatar?ref=' + encodeURIComponent(raw);
  }
  return '';
};
const getInitialsAvatar = (name, seed) => {
  const text = normalizeTextClient(name) || normalizeTextClient(seed) || '?';
  const chars = Array.from(text).filter((char) => char.trim()).slice(0, 2);
  const label = (chars.join('') || '?').toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><circle cx="20" cy="20" r="20" fill="#2f6f7e"/><text x="20" y="25" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="14" font-weight="600" fill="#fff">' + escapeHtml(label) + '</text></svg>');
};
const botAvatarImg = (profile, cls) => {
  const label = normalizeTextClient(profile && (profile.name || profile.slug));
  const rawAvatar = normalizeTextClient(profile && (profile.avatarDataUrl || profile.avatar || profile.avatarUrl));
  const fallback = getInitialsAvatar(label, profile && profile.slug);
  const resolved = normalizeAvatarUrl(rawAvatar) || fallback;
  return '<img class="' + escapeHtml(cls) + '" src="' + escapeHtml(resolved) + '" alt="" loading="lazy" data-avatar-fallback="' + escapeHtml(fallback) + '" />';
};
```

Add selector functions:

```js
const setBotPickerOpen = (open) => {
  state.botPickerOpen = Boolean(open);
  if (elements.botTrigger) elements.botTrigger.setAttribute('aria-expanded', state.botPickerOpen ? 'true' : 'false');
  if (elements.botMenu) elements.botMenu.hidden = !state.botPickerOpen;
};
const renderBotSelector = () => {
  if (!elements.botCurrent || !elements.botMenu || !elements.botTrigger) return;
  const selected = selectedProfile();
  elements.botCurrent.innerHTML = selected
    ? botAvatarImg(selected, 'avatar') + '<span>' + escapeHtml(selected.name || selected.slug) + '</span>'
    : '<span>No local Bot</span>';
  elements.botTrigger.disabled = state.profiles.length === 0;
  elements.botMenu.innerHTML = state.profiles.map((profile) => {
    const slug = normalizeTextClient(profile.slug);
    const isSelected = slug === state.selectedBotSlug;
    return '<button type="button" class="services-bot-option" role="option" data-services-bot-option="' + escapeHtml(slug) + '" data-selected="' + (isSelected ? 'true' : 'false') + '" aria-selected="' + (isSelected ? 'true' : 'false') + '">'
      + '<span class="services-bot-option-main">' + botAvatarImg(profile, 'avatar') + '<span>' + escapeHtml(profile.name || slug) + '</span></span>'
      + '<small>' + escapeHtml(slug) + '</small>'
      + '</button>';
  }).join('');
  elements.botMenu.hidden = !state.botPickerOpen;
  elements.botMenu.querySelectorAll('[data-services-bot-option]').forEach((button) => {
    button.addEventListener('click', () => {
      void setSelectedBotSlug(button.getAttribute('data-services-bot-option') || '');
    });
  });
};
const setSelectedBotSlug = async (slug) => {
  const normalized = normalizeTextClient(slug);
  if (!state.profiles.some((profile) => normalizeTextClient(profile.slug) === normalized)) return;
  state.selectedBotSlug = normalized;
  state.servicesPageNumber = 1;
  state.ordersPageNumber = 1;
  state.selectedServiceId = '';
  state.ordersPage = null;
  state.mutationResult = null;
  setBotPickerOpen(false);
  setUrlState();
  updateActionLinks();
  render();
  await loadServices(false);
};
```

Call `renderBotSelector()` inside `render()`, and add click handling:

```js
if (target.matches('[data-services-bot-trigger]')) {
  setBotPickerOpen(!state.botPickerOpen);
  return;
}
```

Include `[data-services-bot-trigger]` in the document click target selector.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run build && node --test tests/ui/myServicesPageScript.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post development diary**

Run:

```bash
git add src/ui/pages/my-services/app.ts tests/ui/myServicesPageScript.test.mjs
git commit -m "feat: add services bot selector"
```

Post a `metabot-post-buzz` development diary describing the selector behavior and no-All-Bots guarantee.

---

### Task 5: Detail Modal Behavior

**Files:**
- Modify `tests/ui/myServicesPageScript.test.mjs`
- Modify `src/ui/pages/my-services/app.ts`

- [ ] **Step 1: Add modal behavior test**

In `tests/ui/myServicesPageScript.test.mjs`, adjust `createFetch()` so `/api/services/owned?` returns one service:

```js
items: [{
  id: 'service-current-pin-1',
  currentPinId: 'service-current-pin-1',
  sourceServicePinId: 'service-source-pin-1',
  serviceName: 'weather-oracle',
  displayName: 'Weather Oracle',
  description: 'Returns a forecast.',
  price: '0.00001',
  currency: 'SPACE',
  providerSkills: ['metabot-weather-oracle'],
  outputType: 'text',
  creatorMetabotName: 'Bob Bot',
  creatorMetabotSlug: 'bob-bot',
  updatedAt: 1_775_000_000_000,
  successCount: 1,
  refundCount: 0,
  grossRevenue: '0.00001',
  netIncome: '0.00001',
  ratingAvg: 5,
  ratingCount: 1,
  canModify: true,
  canRevoke: true,
}]
```

Add:

```js
test('service details open in modal and load scoped orders', async () => {
  const { elements, fetchImpl } = runPage('');
  await waitFor(() => /data-service-action="details"/.test(elements['[data-my-services-list]'].innerHTML), 'service row render');
  const detailButton = new FakeElement({ 'data-service-action': 'details', 'data-service-id': 'service-current-pin-1' });
  detailButton.matches = (selector) => selector === '[data-service-action]' || selector === '[data-service-action="details"]';
  detailButton.getAttribute = (name) => detailButton.attrs[name] || '';
  await elements.__documentClick({ target: detailButton });
  await waitFor(() => fetchImpl.calls.some((url) => url.startsWith('/api/services/owned/orders?serviceId=service-current-pin-1')), 'orders load');
  assert.equal(elements['[data-my-service-detail-modal]'].hidden, false);
  assert.match(elements['[data-my-service-detail-modal-body]'].innerHTML, /Weather Oracle/);
  assert.match(fetchImpl.calls.find((url) => url.startsWith('/api/services/owned/orders?serviceId=service-current-pin-1')), /from=bob-bot/);
});
```

Store the document click handler in the harness:

```js
document: {
  querySelector: (selector) => elements[selector] || null,
  querySelectorAll: () => [],
  addEventListener: (name, handler) => {
    listeners.set(name, handler);
    if (name === 'click') elements.__documentClick = handler;
  },
},
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/myServicesPageScript.test.mjs
```

Expected: FAIL because Details still only selects a row and does not open the modal body.

- [ ] **Step 3: Render service details inside the modal**

In `src/ui/pages/my-services/app.ts`, replace `renderDetail(model)` with `renderDetailModal(model)`:

```js
const renderDetailModal = (model) => {
  if (elements.orderPageLabel) elements.orderPageLabel.textContent = model.orderPageLabel;
  if (elements.ordersPagePrev) elements.ordersPagePrev.disabled = !model.orderPagination.canPrevious || !model.selectedService;
  if (elements.ordersPageNext) elements.ordersPageNext.disabled = !model.orderPagination.canNext || !model.selectedService;
  if (!elements.detailModal || !elements.detailModalBody) return;
  elements.detailModal.hidden = !state.detailModalOpen;
  const selected = model.selectedService;
  if (!selected) {
    elements.detailModalBody.innerHTML = '<div class="ledger-empty"><strong>No service selected</strong><p>Select a service to inspect orders and lifecycle actions.</p></div>';
    return;
  }
  const metrics = selected.metrics.map((metric) => '<div class="service-metric"><span>' + escapeHtml(metric.label) + '</span><strong>' + escapeHtml(metric.value) + '</strong></div>').join('');
  const orders = model.orders.length
    ? model.orders.map((order) => '<article class="order-row">'
      + '<div><strong>' + escapeHtml(order.statusLabel) + '</strong><p>' + escapeHtml(order.buyerLabel) + '</p><p class="mono-text">' + escapeHtml(order.timeLabel) + '</p></div>'
      + '<div><span>Payment</span><p class="mono-text">' + escapeHtml(order.paymentLabel) + '</p><p class="mono-text">' + escapeHtml(order.orderTxid) + '</p></div>'
      + '<div><span>Rating</span><p>' + escapeHtml(order.ratingLabel) + '</p>' + (order.ratingComment ? '<p>' + escapeHtml(order.ratingComment) + '</p>' : '') + '</div>'
      + '<div><span>Runtime</span><p class="mono-text">' + escapeHtml(order.runtimeLabel) + '</p><p class="mono-text">' + escapeHtml(order.sessionLabel) + '</p></div>'
      + '<div class="order-actions"><a class="btn btn-sm" href="' + escapeHtml(order.traceHref) + '">' + escapeHtml(ORDER_TRACE_ACTION_LABEL) + '</a>' + (order.sessionHref ? '<a class="btn btn-sm" href="' + escapeHtml(order.sessionHref) + '">' + escapeHtml(ORDER_SESSION_ACTION_LABEL) + '</a>' : '') + '</div>'
      + '</article>').join('')
    : '<div class="ledger-empty"><strong>' + escapeHtml(model.orderEmptyState.title) + '</strong><p>' + escapeHtml(model.orderEmptyState.message) + '</p></div>';
  elements.detailModalBody.innerHTML = '<div class="my-service-detail-summary">'
    + '<div class="detail-heading"><div><h3>' + escapeHtml(selected.title) + '</h3><p>' + escapeHtml(selected.description || selected.serviceName) + '</p></div>'
    + '<div class="detail-actions"><button class="btn btn-sm" type="button" data-service-action="edit" data-service-id="' + escapeHtml(selected.currentPinId) + '"' + (selected.canModify ? '' : ' disabled') + '>Edit</button><button class="btn btn-sm btn-danger" type="button" data-service-action="revoke" data-service-id="' + escapeHtml(selected.currentPinId) + '"' + (selected.canRevoke ? '' : ' disabled') + '>Revoke</button></div></div>'
    + '<div class="service-metrics detail-metrics">' + metrics + '</div>'
    + '<dl class="detail-fields"><div><dt>Current Pin</dt><dd>' + escapeHtml(selected.currentPinId) + '</dd></div><div><dt>Source Pin</dt><dd>' + escapeHtml(selected.sourceServicePinId) + '</dd></div><div><dt>Skill</dt><dd>' + escapeHtml(selected.skillLabel) + '</dd></div><div><dt>Price</dt><dd>' + escapeHtml(selected.priceLabel) + '</dd></div></dl>'
    + '</div><div class="my-service-orders">' + orders + '</div>';
};
```

Call `renderDetailModal(model)` from `render()`.

Add modal controls:

```js
const openDetail = async (serviceId, trigger) => {
  state.selectedServiceId = serviceId;
  state.detailModalOpen = true;
  state.lastDetailTrigger = trigger || null;
  state.ordersPageNumber = 1;
  state.mutationResult = null;
  render();
  await loadOrders(serviceId, false);
};
const closeDetail = () => {
  state.detailModalOpen = false;
  render();
  if (state.lastDetailTrigger && typeof state.lastDetailTrigger.focus === 'function') state.lastDetailTrigger.focus();
  state.lastDetailTrigger = null;
};
```

Change the Details action branch:

```js
if (action === 'details') {
  await openDetail(serviceId, target);
}
```

Add `[data-my-service-detail-close]` to the document click selector and handle:

```js
if (target.matches('[data-my-service-detail-close]')) {
  closeDetail();
  return;
}
```

Add Escape handling:

```js
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.detailModalOpen) closeDetail();
});
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run build && node --test tests/ui/myServicesPageScript.test.mjs tests/ui/providerViewModels.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post development diary**

Run:

```bash
git add src/ui/pages/my-services/app.ts tests/ui/myServicesPageScript.test.mjs
git commit -m "feat: show service details in modal"
```

Post a `metabot-post-buzz` development diary describing the modal detail flow and scoped order reads.

---

### Task 6: Single-Column Services Layout

**Files:**
- Modify `src/ui/pages/my-services/index.html`
- Modify `tests/ui/providerViewModels.test.mjs`

- [ ] **Step 1: Add style contract assertions**

In `tests/ui/providerViewModels.test.mjs`, add a new test:

```js
test('my-services page uses single-column services layout styles', () => {
  const { contentHtml } = buildMyServicesPageDefinition({ includePublishAction: true, includeRefundsAction: true });
  assert.match(contentHtml, /data-services-bot-picker/);
  const template = require('node:fs').readFileSync('src/ui/pages/my-services/index.html', 'utf8');
  assert.match(template, /\\.my-services-workspace\\s*{[\\s\\S]*max-width:\\s*960px/);
  assert.match(template, /grid-template-columns:\\s*minmax\\(0, 1fr\\)/);
  assert.match(template, /\\.service-row\\s*{[\\s\\S]*grid-template-columns:\\s*72px minmax\\(0, 1fr\\) auto/);
  assert.match(template, /\\.services-bot-picker/);
  assert.match(template, /\\.my-service-detail-dialog/);
  assert.doesNotMatch(template, /grid-template-columns:\\s*minmax\\(360px, 1\\.05fr\\) minmax\\(360px, \\.95fr\\)/);
});
```

- [ ] **Step 2: Run focused test and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/providerViewModels.test.mjs
```

Expected: FAIL because the template still has the split-pane grid and lacks selector/detail dialog styles.

- [ ] **Step 3: Update Services CSS**

In `src/ui/pages/my-services/index.html`, change `.my-services-workspace` to:

```css
.my-services-workspace {
  width: min(960px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  align-items: start;
}
.my-services-list-panel {
  min-width: 0;
}
```

Remove `.my-services-detail-panel` from selectors.

Add selector styles adapted from Conversations:

```css
.services-bot-filter {
  width: min(960px, 100%);
  margin: 0 auto;
}
.services-bot-filter label {
  display: block;
  margin-bottom: 6px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
  text-transform: uppercase;
}
.services-bot-picker {
  position: relative;
  max-width: 360px;
}
.services-bot-trigger {
  width: 100%;
  min-height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--border2);
  border-radius: 6px;
  background: var(--surface2);
  color: var(--text);
  font: 13px var(--sans);
  padding: 4px 8px 4px 6px;
  cursor: pointer;
}
.services-bot-current,
.services-bot-option-main {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}
.services-bot-current span,
.services-bot-option-main span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.services-bot-menu {
  position: absolute;
  left: 0;
  right: 0;
  top: calc(100% + 6px);
  z-index: 20;
  max-height: min(360px, 52vh);
  overflow-y: auto;
  border: 1px solid var(--border2);
  border-radius: 8px;
  background: var(--surface);
  box-shadow: 0 16px 36px rgba(0,0,0,.3);
}
.services-bot-option {
  width: 100%;
  min-height: 44px;
  border: 0;
  border-bottom: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 6px 8px;
  text-align: left;
  cursor: pointer;
}
.services-bot-option small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 10px;
}
.services-bot-option:hover,
.services-bot-option[data-selected="true"] {
  background: var(--surface2);
}
```

Change service cards to the wider single-column shape:

```css
.service-row {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr) auto;
  gap: 14px;
  padding: 16px;
}
.service-cover {
  width: 72px;
  height: 72px;
}
```

Add:

```css
.my-service-detail-dialog {
  width: min(920px, 100%);
}
.detail-metrics {
  margin-top: 4px;
}
```

Keep the existing mobile fallback, but ensure at `max-width: 720px` the card becomes:

```css
.service-row {
  grid-template-columns: 56px minmax(0, 1fr);
}
.service-cover {
  width: 56px;
  height: 56px;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run build && node --test tests/ui/providerViewModels.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit and post development diary**

Run:

```bash
git add src/ui/pages/my-services/index.html tests/ui/providerViewModels.test.mjs
git commit -m "style: center services single-column layout"
```

Post a `metabot-post-buzz` development diary describing the layout and responsive CSS change.

---

### Task 7: Publish And Refund Context Propagation

**Files:**
- Modify `src/ui/pages/publish/app.ts`
- Modify `src/ui/pages/refund/app.ts`
- Modify `tests/ui/providerViewModels.test.mjs`
- Modify `tests/ui/refundPageApp.test.mjs`

- [ ] **Step 1: Add publish preselection assertion**

In `tests/ui/providerViewModels.test.mjs`, add:

```js
test('publish page script reads from query for MetaBot preselection', () => {
  const script = buildPublishPageDefinition().script;
  assert.match(script, /new URLSearchParams\\(window\\.location\\.search\\)/);
  assert.match(script, /query\\.get\\('from'\\)/);
  assert.match(script, /selectedMetaBotSlug:\\s*normalizeText\\(query\\.get\\('from'\\)\\)/);
});
```

- [ ] **Step 2: Add refund from-scope assertions**

In `tests/ui/refundPageApp.test.mjs`, add:

```js
test('refund page scopes sync and list calls with from query', async () => {
  const fetchImpl = createFetch();
  const elements = createElements();
  vm.runInNewContext(buildRefundPageDefinition().script, {
    document: {
      querySelector: (selector) => elements[selector] || null,
      querySelectorAll: (selector) => elements.__querySelectorAll?.[selector] || [],
    },
    window: { location: { search: '?from=bob-bot' } },
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    String,
    Number,
    Map,
    Promise,
    encodeURIComponent,
    Error,
    Array,
  });
  await waitFor(() => fetchImpl.calls.some((entry) => entry.url.startsWith('/api/services/refunds?')), 'refund list call');
  assert.equal(JSON.parse(fetchImpl.calls[0].options.body).from, 'bob-bot');
  assert.equal(fetchImpl.calls[1].url, '/api/services/refunds?from=bob-bot');
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm run build && node --test tests/ui/providerViewModels.test.mjs tests/ui/refundPageApp.test.mjs
```

Expected: FAIL because Publish does not initialize from the query and Refund still uses `all=true`.

- [ ] **Step 4: Implement Publish query preselection**

In `src/ui/pages/publish/app.ts`, add a query object before `state`:

```js
const query = new URLSearchParams(window.location.search);
```

Change the state field:

```js
selectedMetaBotSlug: normalizeText(query.get('from')),
```

Keep `renderMetaBots()` fallback behavior so a valid query slug is preserved and an invalid query falls back to the first publishable MetaBot.

- [ ] **Step 5: Implement Refund query scoping**

In `src/ui/pages/refund/app.ts`, add:

```js
const selectedFrom = () => String(new URLSearchParams(window.location.search).get('from') || '').trim();
const refundListUrl = () => {
  const from = selectedFrom();
  return from ? '/api/services/refunds?from=' + encodeURIComponent(from) : '/api/services/refunds?all=true';
};
const refundSyncBody = () => {
  const from = selectedFrom();
  return from ? { from } : { all: true };
};
```

Use `refundListUrl()` wherever the script fetches `'/api/services/refunds?all=true'`.

Use `JSON.stringify(refundSyncBody())` wherever the script posts to `'/api/services/refunds/sync'`.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```bash
npm run build && node --test tests/ui/providerViewModels.test.mjs tests/ui/refundPageApp.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit and post development diary**

Run:

```bash
git add src/ui/pages/publish/app.ts src/ui/pages/refund/app.ts tests/ui/providerViewModels.test.mjs tests/ui/refundPageApp.test.mjs
git commit -m "feat: preserve services bot context"
```

Post a `metabot-post-buzz` development diary describing Publish and Refund `from` propagation.

---

### Task 8: Final Verification And Browser Smoke

**Files:**
- Modify only files needed for fixes found by this verification task.

- [ ] **Step 1: Run targeted automated verification**

Run:

```bash
npm run build && node --test tests/daemon/defaultBotHandlers.test.mjs tests/ui/providerViewModels.test.mjs tests/ui/myServicesPageScript.test.mjs tests/ui/refundPageApp.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Start a local daemon or existing UI server**

If a local OAC daemon is already running, use its printed UI port. Otherwise start the project-standard local UI command for this checkout. If no daemon command is appropriate in the current environment, record that browser smoke could not be performed and keep the automated verification as authority.

- [ ] **Step 3: Browser smoke `/ui/services`**

Open `/ui/services` in Browser or Playwright and verify:

```text
The top selector shows one selected local Bot.
The selector menu contains local Bot rows with avatar/name.
The selector menu does not contain "All Bots".
The service list is one centered column.
No right-side Service Detail panel is present.
Clicking Details opens a centered modal.
Publish link includes ?from=<selectedSlug>.
Refunds link includes ?from=<selectedSlug>.
```

- [ ] **Step 4: Fix verification-only issues**

If automated tests or smoke reveal issues, fix only the relevant files and rerun the failed verification command. Do not add unrelated visual refactors in this task.

- [ ] **Step 5: Commit and post final development diary if fixes were needed**

If Step 4 changed files, run:

```bash
git add <changed-files>
git commit -m "fix: verify services single-bot console"
```

Post a `metabot-post-buzz` development diary describing the verification fixes.

If no files changed in this task, do not create an empty commit.

---

## Final Acceptance Criteria

- `/api/bot/profiles` exposes `isActive` for the active local Bot.
- `/ui/services` defaults to the active Bot.
- `/ui/services?from=<slug>` honors a valid slug.
- The Services selector has no "All Bots" option.
- Services and orders load through `from=<slug>`, not `all=true`.
- The right-side detail panel is removed.
- Details open in a centered modal.
- Publish and Refunds preserve selected Bot context.
- `npm run build` passes.
- Focused tests listed in Task 8 pass.
