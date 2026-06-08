# Bot Activation Loop v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a first-time OAC user create a Bot with only public identity fields, automatically use the current platform defaults for LLM/private-chat behavior, land on that Bot's `metaid://<globalMetaId>` Bot Page, and see a Browser-chrome Owner Mode toolbar when viewing any local Bot Page.

**Architecture:** Keep Bot Browser host-neutral. OAC supplies local Bot actors through the existing Browser host adapter; Browser derives ownership by matching the current Bot Page `owner.globalMetaId` against `runtime.actors[*].globalMetaId`; host-specific owner actions are delegated through trusted Browser actions. Bot profile data is split into public profile paths and behavior/config paths before onboarding relies on it.

**Tech Stack:** TypeScript, OAC daemon handlers, embedded Browser/UI scripts, Browser host adapter API, Node `node:test`, `npm run build`, `npm test`.

---

## Source Documents

- PRD: `docs/superpowers/specs/2026-06-08-bot-activation-loop-v1-design.md`
- Browser module boundary reference: `docs/superpowers/specs/2026-06-08-agent-internet-browser-independent-module-design.md`
- Browser design reference: `docs/superpowers/specs/2026-06-07-agent-internet-browser-design.md`

## Product Invariants

- First-run Bot creation asks only for public identity fields: `name`, `avatar`, `bio`.
- First-run Bot creation does not ask users to choose an LLM provider.
- First-run Bot creation does not ask users to enable private chat or auto-reply. OAC keeps these enabled by default.
- UI creation must still choose the current host/platform default LLM provider when detectable, such as Codex in a Codex-hosted OAC session.
- `/info/bio` is public introduction text only for new writes.
- Role, soul, goal, chat skills, and LLM settings write to separate `/info/*` paths.
- Owner Mode is Browser chrome, not Bot Page content.
- Owner Mode applies to any local Bot Page, even when the current `Using` actor is a different local Bot.
- Owner Mode v1 has no `Switch to <Bot>` button.
- Browser left drawer, inspector, and tab-like surfaces remain hidden by default.

## Worktree Preflight

- [ ] Run:

```bash
git status --short
git log --oneline -5
```

- [ ] Confirm unrelated untracked generated/browser output is not added to commits.
- [ ] Keep commits small and checkpointed after each completed task group.

## Task 1: Split Bot Profile Public Bio From Behavior Config

### Files

- `src/core/state/paths.ts`
- `src/core/bot/metabotProfileManager.ts`
- `src/daemon/defaultHandlers.ts`
- `tests/bot/metabotProfileManager.test.mjs`
- `tests/daemon/defaultBotHandlers.test.mjs`

### Tests First

- [ ] Add `tests/bot/metabotProfileManager.test.mjs` coverage for local profile persistence:

```js
await createMetabotProfileFromIdentity(systemHomeDir, {
  name: 'Alice',
  bio: 'Builds small tools on the Agent Internet.',
  homeDir,
  globalMetaId: 'idq1alice',
  mvcAddress: 'mvc-address',
});

const profile = await getMetabotProfile(systemHomeDir, 'alice');
assert.equal(profile.bio, 'Builds small tools on the Agent Internet.');

await updateMetabotProfile(systemHomeDir, 'alice', { bio: 'Now writes Bot Pages.' });
const updated = await getMetabotProfile(systemHomeDir, 'alice');
assert.equal(updated.bio, 'Now writes Bot Pages.');
```

- [ ] Add `syncMetabotInfoToChain` coverage proving new writes use separate paths. The expected write paths for changed fields `['bio', 'role', 'soul', 'goal', 'allowChatSkills', 'primaryProvider', 'fallbackProvider']` are:

```js
[
  '/info/bio',
  '/info/role',
  '/info/soul',
  '/info/goal',
  '/info/chatSkills',
  '/info/LLM',
]
```

- [ ] Add `tests/daemon/defaultBotHandlers.test.mjs` coverage that create/update request bodies accept `bio` and pass it into profile creation/update.
- [ ] Run the new tests and confirm they fail before implementation:

```bash
node --test --test-concurrency=1 \
  tests/bot/metabotProfileManager.test.mjs \
  tests/daemon/defaultBotHandlers.test.mjs
```

### Implementation

- [ ] Add `bioMdPath` to `MetabotPaths`, `buildMetabotPaths()`, and `resolveMetabotPaths()`:

```ts
bioMdPath: path.join(profileRoot, 'BIO.md'),
```

- [ ] Extend Bot profile types:

```ts
export interface MetabotProfileFull extends IdentityProfileRecord {
  bio: string;
  role: string;
  soul: string;
  goal: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills: string[];
}

export interface CreateMetabotInput {
  name: string;
  bio?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
}

export interface UpdateMetabotInfoInput {
  name?: string;
  bio?: string;
  role?: string;
  soul?: string;
  goal?: string;
  avatarDataUrl?: string;
  primaryProvider?: LlmProvider | null;
  fallbackProvider?: LlmProvider | null;
  allowChatSkills?: string[];
}
```

- [ ] Read/write `BIO.md` beside `ROLE.md`, `SOUL.md`, and `GOAL.md`.
- [ ] Keep a missing `BIO.md` as an empty string.
- [ ] Change chain sync semantics:

```ts
const PROFILE_INFO_FIELDS = new Set(['bio', 'role', 'soul', 'goal', 'allowChatSkills', 'primaryProvider', 'fallbackProvider']);

if (changedFields.includes('bio')) {
  await writeInfoText('/info/bio', profile.bio);
}
if (changedFields.includes('role')) {
  await writeInfoText('/info/role', profile.role);
}
if (changedFields.includes('soul')) {
  await writeInfoText('/info/soul', profile.soul);
}
if (changedFields.includes('goal')) {
  await writeInfoText('/info/goal', profile.goal);
}
if (changedFields.includes('allowChatSkills')) {
  await writeInfoJson('/info/chatSkills', { allowChatSkills: profile.allowChatSkills });
}
if (changedFields.includes('primaryProvider') || changedFields.includes('fallbackProvider')) {
  await writeInfoJson('/info/LLM', {
    primaryProvider: profile.primaryProvider ?? null,
    fallbackProvider: profile.fallbackProvider ?? null,
  });
}
```

- [ ] Preserve `/info/name` and `/info/avatar` behavior.
- [ ] Do not delete legacy `/info/bio` JSON already on chain.
- [ ] Update `buildMetabotUpdateInput()`, `buildMetabotCreateInput()`, `calculateMetabotChangedFields()`, `buildMetabotChainProfile()`, and `calculateMetabotCreateChainFields()` for `bio`.
- [ ] Ensure `calculateMetabotCreateChainFields()` includes `bio` when the create input has non-empty bio, and includes `/info/LLM` when default provider selection supplies provider fields.

### Verification

- [ ] Run:

```bash
npm run build
node --test --test-concurrency=1 \
  tests/bot/metabotProfileManager.test.mjs \
  tests/daemon/defaultBotHandlers.test.mjs
```

- [ ] Commit:

```bash
git add src/core/state/paths.ts src/core/bot/metabotProfileManager.ts src/daemon/defaultHandlers.ts \
  tests/bot/metabotProfileManager.test.mjs tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: split bot profile info paths"
```

## Task 2: Simplify First-Run Bot Creation And Apply Host LLM Defaults

### Files

- `src/ui/pages/bot/app.ts`
- `src/daemon/defaultHandlers.ts`
- `tests/ui/botPageScript.test.mjs`
- `tests/daemon/defaultBotHandlers.test.mjs`

### Tests First

- [ ] Add UI script coverage for the create modal request body. With `name`, `bio`, and `avatarDataUrl` set, the POST body must be:

```js
{
  name: 'Alice',
  bio: 'Builds with Codex.',
  avatarDataUrl: 'data:image/png;base64,...',
  creationSource: 'ui',
}
```

- [ ] Assert the body does not contain `primaryProvider`, `fallbackProvider`, `privateChat`, `autoReply`, `role`, `soul`, `goal`, or `allowChatSkills`.
- [ ] Add UI script coverage that `/ui/bot?mode=create` opens the creation modal after initial data load.
- [ ] Add UI script coverage that successful creation with `profile.globalMetaId` navigates to:

```text
/browser/metaid/<globalMetaId>
```

- [ ] Add daemon coverage proving `creationSource: 'ui'` still applies host/default LLM provider selection. Set test runtime state with a healthy Codex runtime and `env.METABOT_HOST = 'codex'`, then assert created profile has `primaryProvider === 'codex'`.
- [ ] Run the targeted tests and confirm they fail before implementation:

```bash
node --test --test-concurrency=1 \
  tests/ui/botPageScript.test.mjs \
  tests/daemon/defaultBotHandlers.test.mjs
```

### Implementation

- [ ] In `src/daemon/defaultHandlers.ts`, remove the current UI short-circuit in `resolveMetabotCreatePreferredProvider()`. UI creation must prefer explicit `host`, then `METABOT_HOST`, then `OAC_HOST`, then the existing runtime recency fallback:

```ts
function resolveMetabotCreatePreferredProvider(input: Record<string, unknown>): LlmProvider | null {
  return normalizePreferredCreateProvider(input.host)
    ?? normalizePreferredCreateProvider(process.env.METABOT_HOST)
    ?? normalizePreferredCreateProvider(process.env.OAC_HOST);
}
```

- [ ] In `src/ui/pages/bot/app.ts`, change the add-Bot modal into the v1 activation form:

```html
<input data-field="new-name" />
<input type="file" data-field="new-avatar-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
<textarea data-field="new-bio"></textarea>
```

- [ ] Reuse the existing 200 KB avatar validation behavior from profile editing for create-time avatar upload.
- [ ] Keep role, soul, goal, provider, chat skills, private chat, and auto-reply out of the creation modal.
- [ ] Update `createMetabot()` to send only public identity fields:

```js
var body = {
  name: name,
  creationSource: 'ui'
};
if (bio) body.bio = bio;
if (state._pendingCreateAvatar) body.avatarDataUrl = state._pendingCreateAvatar;
```

- [ ] Add a helper:

```js
function botBrowserPath(globalMetaId) {
  return '/browser/metaid/' + encodeURIComponent(String(globalMetaId || '').trim());
}
```

- [ ] After successful creation and `loadProfiles()`, navigate to the Bot Page when `profile.globalMetaId` exists:

```js
if (profile.globalMetaId) {
  window.location.href = botBrowserPath(profile.globalMetaId);
  return;
}
```

- [ ] If `profile.globalMetaId` is missing, keep the existing chain success modal so the user still sees the creation result.
- [ ] Support `/ui/bot?mode=create` by opening the add modal after `loadAll()` completes and only when there is no currently open modal.

### Verification

- [ ] Run:

```bash
npm run build
node --test --test-concurrency=1 \
  tests/ui/botPageScript.test.mjs \
  tests/daemon/defaultBotHandlers.test.mjs
```

- [ ] Commit:

```bash
git add src/ui/pages/bot/app.ts src/daemon/defaultHandlers.ts \
  tests/ui/botPageScript.test.mjs tests/daemon/defaultBotHandlers.test.mjs
git commit -m "feat: streamline bot activation creation"
```

## Task 3: Make Browser No-Bot State An Activation Entry

### Files

- `src/daemon/browser/oacBrowserHostAdapter.ts`
- `src/browser/app.ts`
- `tests/daemon/oacBrowserHostAdapter.test.mjs`
- `tests/ui/browserPageState.test.mjs`

### Tests First

- [ ] Add adapter coverage for zero local profiles:

```js
assert.equal(runtime.labels.noActorTitle, 'Create your first Bot');
assert.equal(runtime.labels.noActorBody, 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.');
assert.deepEqual(runtime.labels.noActorAction, {
  label: 'Create Bot',
  href: '/ui/bot?mode=create',
});
assert.equal(runtime.defaultUri, null);
```

- [ ] Add Browser page state coverage that `renderNoLocalBot()` renders the activation copy and link.
- [ ] Add Browser page state coverage that `renderNoLocalBot()` hides the Owner Mode toolbar once Task 4 adds it.
- [ ] Run targeted tests and confirm the new assertions fail before implementation:

```bash
node --test --test-concurrency=1 \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/ui/browserPageState.test.mjs
```

### Implementation

- [ ] Change OAC Browser runtime labels:

```ts
labels: {
  actorChip: 'Using',
  noActorTitle: 'Create your first Bot',
  noActorBody: 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.',
  noActorAction: {
    label: 'Create Bot',
    href: '/ui/bot?mode=create',
  },
},
```

- [ ] Keep `defaultUri` as `metaid://<globalMetaId>` when a default actor exists.
- [ ] Keep `/browser` navigation behavior unchanged for existing Bot users: load runtime, navigate to `runtime.defaultUri`, then render the Bot Page.

### Verification

- [ ] Run:

```bash
npm run build
node --test --test-concurrency=1 \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/ui/browserPageState.test.mjs
```

- [ ] Commit:

```bash
git add src/daemon/browser/oacBrowserHostAdapter.ts src/browser/app.ts \
  tests/daemon/oacBrowserHostAdapter.test.mjs tests/ui/browserPageState.test.mjs
git commit -m "feat: make browser empty state activate bot creation"
```

## Task 4: Add Browser Owner Mode Toolbar

### Files

- `src/browser/app.ts`
- `src/browser/index.html`
- `src/ui/pages/browser/app.ts`
- `tests/ui/browserPageState.test.mjs`
- `tests/ui/browserPageLayout.test.mjs`

### Tests First

- [ ] Add Browser state coverage for a local Bot Page:

```js
state.runtime = {
  actors: [
    { id: 'alice', label: 'Alice', kind: 'oac-bot', globalMetaId: 'idq1alice', isDefault: true, capabilities: [] },
  ],
  labels: { actorChip: 'Using' },
};
state.current = {
  resourceType: 'bot',
  normalizedUri: 'metaid://idq1alice',
  title: 'Alice',
  owner: { globalMetaId: 'idq1alice', name: 'Alice' },
  renderer: { type: 'bot-page' },
  status: { verificationState: 'verified' },
};
renderCurrent();
```

Expected assertions:

```js
assert.match(ownerToolbar.textContent, /Local Bot: Alice/);
assert.match(ownerToolbar.textContent, /Edit Profile/);
assert.match(ownerToolbar.textContent, /Configure Chat/);
assert.match(ownerToolbar.textContent, /View Messages/);
assert.match(ownerToolbar.textContent, /Share Bot Page/);
```

- [ ] Add coverage that a remote Bot Page hides Owner Mode.
- [ ] Add coverage that a local Bot Page still shows Owner Mode when `state.actorId` points to a different local actor.
- [ ] Add coverage that Owner Mode does not render a `Switch to` button or copy.
- [ ] Add coverage that MetaApp resources hide Owner Mode even if their owner matches a local actor.
- [ ] Add layout coverage that the Owner Mode node is outside `data-browser-viewport`.

### Implementation

- [ ] Add a Browser-chrome toolbar between topbar and viewport in `src/browser/app.ts`:

```html
<div class="browser-owner-toolbar" data-browser-owner-toolbar hidden></div>
```

- [ ] Add `ownerToolbar` in `bindElements()`:

```js
ownerToolbar: document.querySelector('[data-browser-owner-toolbar]'),
```

- [ ] Add exact-match ownership helpers. Do not lowercase GlobalMetaId values:

```js
function currentOwnerGlobalMetaId() {
  if (!state.current || state.current.resourceType !== 'bot') return '';
  return textValue(state.current.owner && state.current.owner.globalMetaId);
}

function findLocalOwnerActor() {
  var globalMetaId = currentOwnerGlobalMetaId();
  if (!globalMetaId) return null;
  return runtimeActors().find(function(actor) {
    return textValue(actor && actor.globalMetaId) === globalMetaId;
  }) || null;
}
```

- [ ] Render Owner Mode only when `findLocalOwnerActor()` returns an actor:

```js
function renderOwnerToolbar() {
  var owner = findLocalOwnerActor();
  if (!elements.ownerToolbar) return;
  if (!owner) {
    elements.ownerToolbar.hidden = true;
    elements.ownerToolbar.innerHTML = '';
    return;
  }
  elements.ownerToolbar.hidden = false;
  elements.ownerToolbar.innerHTML =
    '<span class="browser-owner-label">Local Bot: ' + escapeHtml(owner.label || 'Bot') + '</span>' +
    '<button type="button" data-browser-owner-action="edit-profile">Edit Profile</button>' +
    '<button type="button" data-browser-owner-action="configure-chat">Configure Chat</button>' +
    '<button type="button" data-browser-owner-action="view-messages">View Messages</button>' +
    '<button type="button" data-browser-owner-action="share">Share Bot Page</button>';
}
```

- [ ] Call `renderOwnerToolbar()` from `renderCurrent()`.
- [ ] Hide the toolbar in `renderNoLocalBot()` and resolve-error states.
- [ ] Style the toolbar as compact Browser chrome. It should be similar in height to the address bar, visually separate from Bot Page content, and not scroll with the rendered page content.
- [ ] Keep `src/ui/pages/browser/app.ts` as a delegating wrapper. Do not duplicate Browser Owner Mode logic there.

### Verification

- [ ] Run:

```bash
npm run build
node --test --test-concurrency=1 \
  tests/ui/browserPageState.test.mjs \
  tests/ui/browserPageLayout.test.mjs
```

- [ ] Commit:

```bash
git add src/browser/app.ts src/browser/index.html src/ui/pages/browser/app.ts \
  tests/ui/browserPageState.test.mjs tests/ui/browserPageLayout.test.mjs
git commit -m "feat: add browser owner mode toolbar"
```

## Task 5: Wire Owner Mode Actions Through Browser And OAC Adapter

### Files

- `src/core/browser/hostTypes.ts`
- `src/daemon/browser/oacBrowserHostAdapter.ts`
- `src/browser/app.ts`
- `tests/daemon/oacBrowserHostAdapter.test.mjs`
- `tests/daemon/browserRoutes.test.mjs`
- `tests/ui/browserPageActions.test.mjs`
- `tests/ui/browserPageState.test.mjs`

### Tests First

- [ ] Add host type/API coverage for three OAC owner actions:

```ts
'edit-profile'
'configure-chat'
'view-messages'
```

- [ ] Add adapter coverage that each action validates `payload.ownerActorId` and returns an OAC route:

```js
assert.deepEqual(result.data, {
  kind: 'edit-profile',
  handled: true,
  data: { href: '/ui/bot?profile=alice&tab=info&focus=profile' },
});
```

Expected hrefs:

```text
edit-profile   -> /ui/bot?profile=<slug>&tab=info&focus=profile
configure-chat -> /ui/bot?profile=<slug>&tab=info&focus=chat
view-messages  -> /ui/bot?profile=<slug>&tab=history&focus=messages
```

- [ ] Add adapter coverage that an unknown `ownerActorId` fails with `profile_not_found` or `invalid_browser_action`.
- [ ] Add Browser action coverage that clicking `Edit Profile`, `Configure Chat`, and `View Messages` sends:

```js
{
  resourceUri: 'metaid://idq1alice',
  kind: 'edit-profile',
  payload: {
    ownerActorId: 'alice',
    ownerGlobalMetaId: 'idq1alice',
    currentUri: 'metaid://idq1alice',
  },
}
```

- [ ] Add Browser action coverage that a returned `{ href }` changes `window.location.href`.
- [ ] Add Browser action coverage that Share Bot Page opens a local share modal without calling `/api/browser/actions`.
- [ ] Add share modal assertions for:

```text
metaid://<globalMetaId>
/browser/metaid/<globalMetaId>
```

### Implementation

- [ ] Extend `BrowserTrustedActionKind`:

```ts
export type BrowserTrustedActionKind =
  | 'private-chat'
  | 'service-call'
  | 'copy-uri'
  | 'open-settings'
  | 'login'
  | 'edit-profile'
  | 'configure-chat'
  | 'view-messages';
```

- [ ] Add Browser helper to build owner action payload:

```js
function ownerActionPayload(owner) {
  var uri = currentResourceUri();
  return {
    ownerActorId: owner.id,
    ownerGlobalMetaId: owner.globalMetaId,
    currentUri: uri,
  };
}
```

- [ ] Add Browser helper for owner action result routing:

```js
function openTrustedActionHref(result) {
  var href = result && result.data && result.data.href;
  if (href) window.location.href = href;
}
```

- [ ] Wire toolbar clicks from the Browser shell, not from the Bot Page viewport:

```js
if (elements.ownerToolbar) {
  elements.ownerToolbar.addEventListener('click', function(event) {
    var target = closestWithAttribute(event && event.target, 'data-browser-owner-action');
    if (!target) return;
    handleOwnerAction(target.getAttribute('data-browser-owner-action')).catch(function(error) {
      setStatus('error', error && error.message ? error.message : 'Owner action failed.');
    });
  });
}
```

- [ ] Implement `handleOwnerAction(action)`:

```js
async function handleOwnerAction(action) {
  var owner = findLocalOwnerActor();
  if (!owner) return null;
  if (action === 'share') return openShareBotPageModal(owner);
  var kindMap = {
    'edit-profile': 'edit-profile',
    'configure-chat': 'configure-chat',
    'view-messages': 'view-messages',
  };
  var kind = kindMap[action];
  if (!kind) return null;
  var result = await commandApi(endpointWithActor(browserEndpoints.actions), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resourceUri: currentResourceUri(),
      kind: kind,
      payload: ownerActionPayload(owner),
    }),
  });
  openTrustedActionHref(result);
  return result;
}
```

- [ ] Implement `openShareBotPageModal(owner)` in Browser client only:

```js
function openShareBotPageModal(owner) {
  var globalMetaId = textValue(owner && owner.globalMetaId);
  var metaidUri = 'metaid://' + globalMetaId;
  var localPath = '/browser/metaid/' + encodeURIComponent(globalMetaId);
  var origin = window.location && window.location.origin ? window.location.origin : '';
  var localUrl = origin ? origin + localPath : localPath;
  renderModal(
    'Share Bot Page',
    '<div class="browser-share-list">' +
      '<button type="button" data-browser-share-copy="' + escapeHtml(metaidUri) + '">Copy metaid URI</button>' +
      '<button type="button" data-browser-share-copy="' + escapeHtml(localUrl) + '">Copy local Browser URL</button>' +
    '</div>',
    'Close',
    ''
  );
}
```

- [ ] If `state.runtime.host.publicBaseUrl` exists, include a third copy button for:

```text
<publicBaseUrl>/browser/metaid/<globalMetaId>
```

- [ ] Extend the modal click handler to copy share values:

```js
var shareCopy = closestWithAttribute(event && event.target, 'data-browser-share-copy');
if (shareCopy) {
  copyUri({ uri: shareCopy.getAttribute('data-browser-share-copy') || '' });
  return;
}
```

- [ ] In `oacBrowserHostAdapter.ts`, add owner action helpers:

```ts
function ownerActorIdFromPayload(payload: Record<string, unknown>): string {
  return normalizeText(payload.ownerActorId) || normalizeText(payload.actorId);
}

function botManagementHref(slug: string, tab: 'info' | 'history', focus: string): string {
  const query = new URLSearchParams({ profile: slug, tab, focus });
  return `/ui/bot?${query.toString()}`;
}
```

- [ ] In `runTrustedAction()`, handle owner actions before the unsupported-action branch. Load profiles, resolve `ownerActorId`, and return:

```ts
return commandSuccess({
  kind: actionInput.kind,
  handled: true,
  data: { href },
});
```

- [ ] Owner actions must not use the selected `Using` actor as the target. They must use `payload.ownerActorId`.
- [ ] Keep private-chat and service-call action behavior unchanged.

### Verification

- [ ] Run:

```bash
npm run build
node --test --test-concurrency=1 \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageState.test.mjs
```

- [ ] Commit:

```bash
git add src/core/browser/hostTypes.ts src/daemon/browser/oacBrowserHostAdapter.ts src/browser/app.ts \
  tests/daemon/oacBrowserHostAdapter.test.mjs tests/daemon/browserRoutes.test.mjs \
  tests/ui/browserPageActions.test.mjs tests/ui/browserPageState.test.mjs
git commit -m "feat: wire browser owner actions"
```

## Task 6: End-To-End Product Verification

### Automated Verification

- [ ] Run all targeted v1 tests:

```bash
npm run build
node --test --test-concurrency=1 \
  tests/bot/metabotProfileManager.test.mjs \
  tests/daemon/defaultBotHandlers.test.mjs \
  tests/ui/botPageScript.test.mjs \
  tests/daemon/oacBrowserHostAdapter.test.mjs \
  tests/daemon/browserRoutes.test.mjs \
  tests/ui/browserPageState.test.mjs \
  tests/ui/browserPageActions.test.mjs \
  tests/ui/browserPageLayout.test.mjs
```

- [ ] Run the full repository test suite:

```bash
npm test
```

### Manual Smoke Verification

- [ ] Start OAC dev mode:

```bash
npm run dev:mode
```

- [ ] In a fresh test home or clean profile set, open:

```text
http://127.0.0.1:<port>/browser
```

- [ ] Confirm no-Bot Browser state says:

```text
Create your first Bot
Your local Agent needs a Bot identity before it can appear on the Agent Internet.
```

- [ ] Click Create Bot and confirm the create form asks for only:

```text
Name
Avatar
Public bio
```

- [ ] Confirm the form does not ask for:

```text
LLM provider
Private chat
Auto-reply
Role
Soul
Goal
Chat skills
```

- [ ] Create a Bot and confirm the app opens:

```text
/browser/metaid/<globalMetaId>
```

- [ ] Confirm the Browser address input displays:

```text
metaid://<globalMetaId>
```

- [ ] Confirm the Bot Page shows Owner Mode toolbar as Browser chrome with:

```text
Local Bot: <name>
Edit Profile
Configure Chat
View Messages
Share Bot Page
```

- [ ] Confirm a remote Bot Page does not show Owner Mode.
- [ ] With two local Bots, set `Using` to Alice and open Eric's local Bot Page. Confirm Owner Mode says Eric and there is no `Switch to Eric`.
- [ ] Confirm Edit Profile, Configure Chat, and View Messages route to the expected `/ui/bot?...` URLs.
- [ ] Confirm Share Bot Page can copy `metaid://<globalMetaId>` and the local Browser URL.

### Final Commit

- [ ] If Task 6 required fixes, commit them:

```bash
git status --short
git add <changed-files>
git commit -m "test: verify bot activation loop v1"
```

- [ ] End state must satisfy:

```bash
git status --short
```

Only unrelated pre-existing untracked files may remain.

## Acceptance Criteria

- [ ] Fresh install/no local Bot user is strongly directed to create a Bot.
- [ ] Creation asks only for name, avatar, and public bio.
- [ ] UI creation uses current platform/default LLM provider without asking the user to select it.
- [ ] Private chat and auto-reply remain enabled by default without onboarding switches.
- [ ] New profile writes use `/info/bio` only for public introduction.
- [ ] New behavior/config writes use `/info/role`, `/info/soul`, `/info/goal`, `/info/chatSkills`, and `/info/LLM`.
- [ ] Successful Bot creation opens `/browser/metaid/<globalMetaId>`.
- [ ] Browser renders `metaid://<globalMetaId>` in the address input.
- [ ] Own Bot Page shows compact Owner Mode toolbar outside the content viewport.
- [ ] Owner Mode detects any local Bot, independent of the current `Using` actor.
- [ ] Owner Mode contains `Edit Profile`, `Configure Chat`, `View Messages`, and `Share Bot Page`.
- [ ] Owner Mode does not contain a `Switch to <Bot>` action.
- [ ] Remote Bot Pages and MetaApp pages do not show Owner Mode.
- [ ] Full `npm test` passes.
