import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBotPageDefinition } = require('../../dist/ui/pages/bot/app.js');
const { DICTIONARIES, translate } = require('../../dist/ui/i18n.js');

function zhI18nWindow() {
  return {
    __oacLocalUiI18n: {
      getLanguage: () => 'zh-CN',
      t: (key, replacements) => translate('zh-CN', key, replacements),
    },
  };
}

function field(value = '') {
  const attrs = new Map();
  const element = {
    value,
    textContent: '',
    className: '',
    disabled: false,
    focused: false,
    scrolled: false,
    focus: () => {
      element.focused = true;
    },
    scrollIntoView: () => {
      element.scrolled = true;
    },
    addEventListener: () => {},
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, next) => attrs.set(name, String(next)),
  };
  return element;
}

function toggleElement() {
  const attrs = new Map();
  const classes = new Set();
  const textEl = { textContent: '' };
  const element = {
    disabled: false,
    classList: {
      toggle: (name, enabled) => {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
      contains: (name) => classes.has(name),
    },
    querySelector: (selector) => (selector === '.toggle-text' ? textEl : null),
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, next) => attrs.set(name, String(next)),
    textEl,
  };
  return element;
}

function panelElement(attributeName, attributeValue, selectors = {}) {
  return {
    querySelector: (selector) => selectors[selector] ?? null,
    getAttribute: (name) => (name === attributeName ? attributeValue : null),
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function waitFor(condition, label) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (condition()) {
        resolve();
        return;
      }
      if (Date.now() - startedAt > 1000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(check, 5);
    };
    check();
  });
}

function assertDefaultWriteNetworkPicker(html, selectedNetwork) {
  const iconPaths = {
    mvc: '/ui/assets/chains/mvc.png',
    btc: '/ui/assets/chains/btc.svg',
    doge: '/ui/assets/chains/doge.svg',
    opcat: '/ui/assets/chains/opcat.png',
  };

  assert.match(html, /data-chain-picker="defaultWriteNetwork"/);
  assert.match(html, new RegExp(`data-chain-trigger="defaultWriteNetwork"[\\s\\S]*data-chain-icon="${selectedNetwork}"`));
  assert.doesNotMatch(html, /<select[^>]+data-field="defaultWriteNetwork"/);

  for (const [network, iconPath] of Object.entries(iconPaths)) {
    assert.match(html, new RegExp(`data-chain-option="${network}"`), network);
    assert.match(html, new RegExp(`data-chain-icon="${network}"`), network);
    assert.match(html, new RegExp(`<img src="${iconPath}" alt="" loading="lazy" />`), network);
    assert.equal(
      existsSync(new URL(`../../src${iconPath.replace(/^\/ui\//, '/ui/')}`, import.meta.url)),
      true,
      network,
    );
  }
}

function createBotScriptContext(overrides = {}) {
  const elements = overrides.elements ?? {};
  const root = elements['[data-modal-root]'] ?? {
    innerHTML: '',
    onclick: null,
    classList: {
      add: () => {},
      remove: () => {},
    },
  };
  elements['[data-modal-root]'] = root;
  return {
    document: {
      querySelector: (selector) => elements[selector] ?? null,
      querySelectorAll: overrides.querySelectorAll ?? (() => []),
      addEventListener: () => {},
    },
    fetch: overrides.fetch ?? (() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ ok: true, data: {} }),
    })),
    navigator: {},
    window: overrides.window ?? {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    ...overrides.globals,
  };
}

function tabElement(value) {
  const element = {
    active: false,
    listeners: new Map(),
    getAttribute: (name) => {
      if (name === 'data-tab' || name === 'data-tab-panel') return value;
      return null;
    },
    addEventListener(eventName, handler) {
      this.listeners.set(eventName, handler);
    },
    classList: {
      toggle: (name, enabled) => {
        if (name === 'active') element.active = Boolean(enabled);
      },
    },
  };
  return element;
}

test('bot page template uses an icon-only online indicator and copy buttons in the hero', () => {
  const template = readFileSync(new URL('../../src/ui/pages/bot/index.html', import.meta.url), 'utf8');

  assert.match(template, /<span class="live-indicator" data-live-indicator aria-label="Online" title="Online"><\/span>/);
  assert.match(template, /@keyframes bot-live-breathe/);
  assert.match(template, /@keyframes bot-create-chain-flow/);
  assert.match(template, /@keyframes bot-create-chain-pulse/);
  assert.match(template, /\.create-chain-modal\s*\{/);
  assert.match(template, /\.bot-workspace\s*\{[^}]*max-width:\s*1280px;[^}]*margin:\s*16px auto 24px;/s);
  assert.match(template, /\.detail-panel\s*\{[^}]*flex:\s*1 1 auto;[^}]*max-width:\s*none;/s);
  assert.match(template, /\.tab-bar\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.doesNotMatch(template, /data-live-indicator[^>]*>Live by default<\/span>/);
  assert.doesNotMatch(template, /data-copy-bot-uri[^>]*data-i18n-key="bot\.copy">Copy<\/button>/);
});

test('bot page hero renders bio copy and keeps online status icon-only', () => {
  const live = field('old status');
  const summary = { textContent: '', hidden: true };
  const copyUri = field();
  const elements = {
    '[data-bot-hero]': { hidden: true },
    '[data-hero-avatar]': { innerHTML: '' },
    '[data-hero-name]': field(),
    '[data-live-indicator]': live,
    '[data-hero-summary]': summary,
    '[data-hero-global-meta-id]': field(),
    '[data-hero-bot-uri]': field(),
    '[data-copy-global-meta-id]': field(),
    '[data-copy-bot-uri]': copyUri,
    '[data-act="view-bot-page"]': field(),
    '[data-act="view-conversations"]': field(),
  };
  const context = createBotScriptContext({ elements });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderBotHero({
    slug: 'alice-bot',
    name: 'Alice',
    bio: 'Builds wallet automation.',
    globalMetaId: 'idq1alice',
  });

  assert.equal(live.textContent, '');
  assert.equal(live.getAttribute('aria-label'), 'Online');
  assert.equal(summary.hidden, false);
  assert.equal(summary.textContent, 'Builds wallet automation.');
  assert.equal(copyUri.getAttribute('aria-label'), 'Copy Homepage URI');
});

test('bot page template ships a set-as-default toggle in the hero actions and Default badge styles', () => {
  const template = readFileSync(new URL('../../src/ui/pages/bot/index.html', import.meta.url), 'utf8');

  assert.match(template, /data-act="view-conversations"[\s\S]*data-default-bot-toggle/);
  assert.match(template, /data-default-bot-toggle[^>]*role="switch"/);
  assert.match(template, /data-i18n-key="bot\.defaultBadge"/);
  assert.match(template, /data-default-bot-status/);
  assert.match(template, /\.metabot-default-label\s*\{/);
});

test('bot page list marks only the default Bot with a Default badge', () => {
  const list = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': list,
      '[data-metabot-count]': { textContent: '' },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.profiles = [
    { slug: 'alice-bot', name: 'Alice', isActive: true },
    { slug: 'bob-bot', name: 'Bob', isActive: false },
  ];

  context.renderMetabotList();

  assert.equal((list.innerHTML.match(/metabot-default-label/g) || []).length, 1);
  assert.match(list.innerHTML, /data-slug="alice-bot"[\s\S]*metabot-default-label[\s\S]*>Default<\/span>[\s\S]*data-slug="bob-bot"/);
});

test('bot page list hides the Default badge when only one Bot exists', () => {
  const list = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': list,
      '[data-metabot-count]': { textContent: '' },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice', isActive: true }];

  context.renderMetabotList();

  assert.equal((list.innerHTML.match(/metabot-default-label/g) || []).length, 0);
});

test('bot page hero syncs the set-as-default toggle from the active profile', () => {
  const toggle = toggleElement();
  const control = { hidden: false };
  const status = { textContent: 'stale', className: 'save-status error', hidden: false };
  const elements = {
    '[data-bot-hero]': { hidden: true },
    '[data-hero-avatar]': { innerHTML: '' },
    '[data-hero-name]': field(),
    '[data-live-indicator]': field(),
    '[data-hero-summary]': { textContent: '', hidden: true },
    '[data-hero-global-meta-id]': field(),
    '[data-hero-bot-uri]': field(),
    '[data-copy-global-meta-id]': field(),
    '[data-copy-bot-uri]': field(),
    '[data-act="view-bot-page"]': field(),
    '[data-act="view-conversations"]': field(),
    '[data-default-bot-control]': control,
    '[data-default-bot-toggle]': toggle,
    '[data-default-bot-status]': status,
  };
  const context = createBotScriptContext({ elements });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.profiles = [
    { slug: 'alice-bot', name: 'Alice', isActive: false },
    { slug: 'bob-bot', name: 'Bob', isActive: true },
  ];
  context.renderBotHero({ slug: 'alice-bot', name: 'Alice', globalMetaId: 'gm-alice', isActive: false });

  assert.equal(control.hidden, false);
  assert.equal(status.hidden, false);
  assert.equal(toggle.classList.contains('on'), false);
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  assert.equal(toggle.getAttribute('title'), 'Set as default');
  assert.equal(toggle.textEl.textContent, 'Off');
  assert.equal(status.textContent, '');
  assert.equal(status.className, 'save-status');

  context.renderBotHero({ slug: 'alice-bot', name: 'Alice', globalMetaId: 'gm-alice', isActive: true });

  assert.equal(toggle.classList.contains('on'), true);
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  assert.equal(toggle.getAttribute('title'), 'This is the default Bot');
  assert.equal(toggle.textEl.textContent, 'On');
});

test('bot page hero hides the set-as-default toggle when only one Bot exists', () => {
  const toggle = toggleElement();
  const control = { hidden: false };
  const status = { textContent: '', className: 'save-status', hidden: false };
  const elements = {
    '[data-bot-hero]': { hidden: true },
    '[data-hero-avatar]': { innerHTML: '' },
    '[data-hero-name]': field(),
    '[data-live-indicator]': field(),
    '[data-hero-summary]': { textContent: '', hidden: true },
    '[data-hero-global-meta-id]': field(),
    '[data-hero-bot-uri]': field(),
    '[data-copy-global-meta-id]': field(),
    '[data-copy-bot-uri]': field(),
    '[data-act="view-bot-page"]': field(),
    '[data-act="view-conversations"]': field(),
    '[data-default-bot-control]': control,
    '[data-default-bot-toggle]': toggle,
    '[data-default-bot-status]': status,
  };
  const context = createBotScriptContext({ elements });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice', isActive: true }];
  context.renderBotHero({ slug: 'alice-bot', name: 'Alice', globalMetaId: 'gm-alice', isActive: true });

  assert.equal(control.hidden, true);
  assert.equal(status.hidden, true);
});

test('bot page set-as-default toggle activates the profile through the daemon API', async () => {
  const toggle = toggleElement();
  const status = { textContent: '', className: 'save-status' };
  const requests = [];
  const context = createBotScriptContext({
    elements: {
      '[data-default-bot-status]': status,
    },
    fetch: (url, options) => {
      requests.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { slug: 'bob-bot', activeHomeDir: '/tmp/bob' } }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'bob-bot';
  context.state.profiles = [
    { slug: 'alice-bot', name: 'Alice', isActive: true },
    { slug: 'bob-bot', name: 'Bob', isActive: false },
  ];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};

  await context.setSelectedBotDefault(toggle);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/bot/profiles/bob-bot/activate');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(context.state.profiles[0].isActive, false);
  assert.equal(context.state.profiles[1].isActive, true);
  assert.equal(status.textContent, 'Default Bot updated.');
  assert.equal(status.className, 'save-status success');
});

test('bot page set-as-default failure keeps the previous default and shows the error', async () => {
  const toggle = toggleElement();
  const status = { textContent: '', className: 'save-status' };
  const context = createBotScriptContext({
    elements: {
      '[data-default-bot-status]': status,
    },
    fetch: () => Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ ok: false, code: 'profile_not_found', message: 'MetaBot profile not found: bob-bot' }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'bob-bot';
  context.state.profiles = [
    { slug: 'alice-bot', name: 'Alice', isActive: true },
    { slug: 'bob-bot', name: 'Bob', isActive: false },
  ];

  await context.setSelectedBotDefault(toggle);

  assert.equal(context.state.profiles[0].isActive, true);
  assert.equal(context.state.profiles[1].isActive, false);
  assert.equal(toggle.classList.contains('loading'), false);
  assert.equal(status.textContent, 'MetaBot profile not found: bob-bot');
  assert.equal(status.className, 'save-status error');
});

test('bot page Basic tab owns LLM providers and Persona tab owns role fields', () => {
  const basicRoot = { innerHTML: '' };
  const personaRoot = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': basicRoot,
      '[data-behavior-content]': personaRoot,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    bio: 'Builds wallet automation.',
    role: 'Assistant',
    soul: 'Patient',
    goal: 'Help users',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
  }];
  context.state.runtimes = [
    { id: 'runtime-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' },
    { id: 'runtime-openclaw', provider: 'openclaw', displayName: 'OpenClaw', health: 'healthy' },
  ];

  context.renderPublicIdentityTab();
  context.renderBehaviorTab();

  assert.match(basicRoot.innerHTML, /Primary LLM Provider/);
  assert.match(basicRoot.innerHTML, /Fallback LLM Provider/);
  assert.doesNotMatch(personaRoot.innerHTML, /Primary LLM Provider/);
  assert.doesNotMatch(personaRoot.innerHTML, /Fallback LLM Provider/);
  assert.match(personaRoot.innerHTML, /data-field="role"/);
  assert.match(personaRoot.innerHTML, /data-field="soul"/);
  assert.match(personaRoot.innerHTML, /data-field="goal"/);
});

test('bot page Behavior tab renders empty persona fields for unset legacy defaults', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'legacy-default-bot';
  context.state.profiles = [{
    slug: 'legacy-default-bot',
    name: 'Legacy Default Bot',
    role: 'You are a helpful AI assistant.',
    soul: 'You are friendly and professional.',
    goal: 'Your goal is to help users accomplish their tasks effectively.',
  }];

  context.renderBehaviorTab();

  assert.match(root.innerHTML, /data-field="role"[^>]*placeholder="[^"]+"[^>]*><\/textarea>/);
  assert.match(root.innerHTML, /data-field="soul"[^>]*placeholder="[^"]+"[^>]*><\/textarea>/);
  assert.match(root.innerHTML, /data-field="goal"[^>]*placeholder="[^"]+"[^>]*><\/textarea>/);
  assert.doesNotMatch(root.innerHTML, /You are a helpful AI assistant/);
  assert.doesNotMatch(root.innerHTML, /You are friendly and professional/);
  assert.doesNotMatch(root.innerHTML, /Your goal is to help users accomplish their tasks effectively/);
});

test('bot page Basic tab renders Homepage source select from existing MetaApp chain data', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    globalMetaId: 'gm-alice',
    bio: 'Builds wallet automation.',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  }];
  context.state.runtimes = [
    { id: 'runtime-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' },
    { id: 'runtime-openclaw', provider: 'openclaw', displayName: 'OpenClaw', health: 'healthy' },
  ];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /<div class="provider-row">[\s\S]*data-field="primaryProvider"[\s\S]*data-field="fallbackProvider"[\s\S]*<\/div>/);
  assert.match(root.innerHTML, /data-homepage-panel/);
  assert.match(root.innerHTML, /data-field="homepage-source"/);
  assert.match(root.innerHTML, /<option value="default">Default<\/option>/);
  assert.match(root.innerHTML, /<option value="metafile">Metafile<\/option>/);
  assert.match(root.innerHTML, /<option value="metaapp" selected>MetaApp<\/option>/);
  assert.match(root.innerHTML, /Custom home page source/);
  assert.match(root.innerHTML, /homepage-protocol-prefix[\s\S]*metaapp:\/\//);
  assert.match(root.innerHTML, /data-field="homepage-metaapp-pin"/);
  assert.match(root.innerHTML, /value="metaapp-pin-123"/);
  assert.match(root.innerHTML, /data-act="select-homepage-metaapp"/);
  assert.doesNotMatch(root.innerHTML, /data-act="upload-homepage"/);
  assert.doesNotMatch(root.innerHTML, /data-homepage-file-input/);
  assert.match(root.innerHTML, />Select<\/button>/);
  assert.doesNotMatch(root.innerHTML, /data-act="preview-homepage-metaapp"/);
  assert.doesNotMatch(root.innerHTML, /data-act="set-homepage-metaapp"/);
  assert.doesNotMatch(root.innerHTML, /data-act="toggle-homepage-help"/);
  assert.doesNotMatch(root.innerHTML, /data-homepage-help-popover/);
  assert.doesNotMatch(root.innerHTML, /metabot-homepage-guide/);
  assert.doesNotMatch(root.innerHTML, /metabot-metaapp-publish/);
  assert.doesNotMatch(root.innerHTML, /metabot-metaapp/);
  assert.doesNotMatch(root.innerHTML, /Final URI/);
  assert.doesNotMatch(root.innerHTML, /metaapp:\/\/metaapp-pin-123/);
  assert.doesNotMatch(root.innerHTML, /Homepage package upload will be available later/);
});

test('bot page Basic tab renders Metafile upload control when existing homepage is a Metafile', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    globalMetaId: 'gm-alice',
    bio: 'Builds wallet automation.',
    homepage: {
      uri: 'metafile://homepage-file-pin.html',
      renderer: 'auto',
      contentType: 'text/html',
    },
  }];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /<option value="metafile" selected>Metafile<\/option>/);
  assert.match(root.innerHTML, /homepage-protocol-prefix[\s\S]*metafile:\/\//);
  assert.match(root.innerHTML, /data-field="homepage-metafile-pin"/);
  assert.match(root.innerHTML, /value="homepage-file-pin.html"/);
  assert.match(root.innerHTML, /data-act="upload-homepage"/);
  assert.match(root.innerHTML, /data-homepage-file-input/);
  assert.doesNotMatch(root.innerHTML, /data-field="homepage-metaapp-pin"/);
  assert.doesNotMatch(root.innerHTML, /data-act="preview-homepage-metaapp"/);
});

test('bot page Basic tab renders MetaApp picker list above Select with scroll-ready rows', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    globalMetaId: 'gm-alice',
    bio: 'Builds wallet automation.',
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  }];
  context.state._homepageMetaAppPickerOpen = true;
  context.state._homepageMetaAppsStatusBySlug['alice-bot'] = 'loaded';
  context.state._homepageMetaAppsBySlug['alice-bot'] = [
    { pinId: 'metaapp-pin-1', appName: 'Alpha', icon: 'metafile://icon-pin-1.png' },
    { pinId: 'metaapp-pin-2', appName: 'Beta' },
    { pinId: 'metaapp-pin-3', appName: 'Gamma' },
    { pinId: 'metaapp-pin-4', appName: 'Delta' },
  ];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /class="homepage-metaapp-picker"/);
  assert.match(root.innerHTML, /class="homepage-metaapp-list" data-homepage-metaapp-list/);
  assert.equal((root.innerHTML.match(/data-act="choose-homepage-metaapp"/g) || []).length, 4);
  assert.match(root.innerHTML, /Alpha/);
  assert.match(root.innerHTML, /metaapp-pin-4/);
  assert.match(root.innerHTML, /\/api\/file\/avatar\?ref=icon-pin-1\.png/);
});

test('bot page Basic tab renders MetaApp picker empty state with Apps link', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  }];
  context.state._homepageMetaAppPickerOpen = true;
  context.state._homepageMetaAppsStatusBySlug['alice-bot'] = 'loaded';
  context.state._homepageMetaAppsBySlug['alice-bot'] = [];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /No MetaApps published for this Bot/);
  assert.match(root.innerHTML, /href="\/ui\/apps\?from=alice-bot"/);
  assert.match(root.innerHTML, />Create MetaApp<\/a>/);
});

test('bot page Basic tab keeps the default homepage renderer view link', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    globalMetaId: 'gm-alice',
    bio: 'Builds wallet automation.',
  }];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /Default home page renderer is active\./);
  assert.match(root.innerHTML, /data-act="view-homepage"/);
  assert.match(root.innerHTML, /click here to view/);
});

test('bot page Default homepage source clears an existing custom homepage on save', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-source"]': field('default'),
    '[data-field="homepage-metaapp-pin"]': field(''),
  };
  let requestBody = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.savePublicIdentity();

  assert.deepEqual(requestBody, { homepage: null });
});

test('bot page Default homepage source ignores stale MetaApp input when unchanged from empty homepage', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-source"]': field('default'),
    '[data-field="homepage-metaapp-pin"]': field(' stale-metaapp-pin '),
  };
  let requestCount = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: () => {
      requestCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: {} }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];

  await context.savePublicIdentity();

  assert.equal(requestCount, 0);
  assert.equal(fields['[data-save-status]'].textContent, 'No changes');
});

test('bot page Homepage view link opens the selected public Bot Page', () => {
  const listeners = new Map();
  const viewLink = {
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
  };
  const context = createBotScriptContext({
    elements: {
      '[data-act="view-homepage"]': viewLink,
    },
    window: {
      location: {
        href: '/ui/bot',
      },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    globalMetaId: 'gm-alice',
  }];

  context.wireHomepageControls();
  listeners.get('click')();

  assert.equal(context.window.location.href, '/browser/metaid/gm-alice');
});

test('bot page saveInfo preserves unavailable provider bindings when saving unrelated profile fields', () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-info"]': field(),
    '[data-field="name"]': field('Alice Updated'),
    '[data-field="role"]': field('Original role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': field(''),
    '[data-field="fallbackProvider"]': field(''),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url, options) => {
      if (url === '/api/bot/stats') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: {} }),
        });
      }
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice Updated',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: 'openclaw',
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
  };

  context.saveInfo();

  assert.deepEqual(requestBody, { name: 'Alice Updated' });
});

test('bot page saveInfo sends provider changes only after the provider picker is touched', () => {
  const primary = field('codex');
  primary.setAttribute('data-provider-touched', '1');
  const fallback = field('');
  fallback.setAttribute('data-provider-touched', '1');
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-info"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="role"]': field('Original role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': primary,
    '[data-field="fallbackProvider"]': fallback,
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url, options) => {
      if (url === '/api/bot/stats') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: {} }),
        });
      }
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: null,
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'openclaw',
    fallbackProvider: 'gemini',
  };

  context.saveInfo();

  assert.deepEqual(requestBody, {
    primaryProvider: 'codex',
    fallbackProvider: null,
  });
});

test('bot page saveBehavior sends only persona field changes', () => {
  const behaviorFields = {
    '[data-save-status]': field(),
    '[data-act="save-behavior"]': field(),
    '[data-field="role"]': field('New role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
  };
  const behaviorPanel = panelElement('data-behavior-profile-slug', 'alice-bot', behaviorFields);
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => (selector === '[data-behavior-profile-slug]' ? behaviorPanel : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice Updated',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: 'openclaw',
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderBehaviorTab = () => {};
  context.showChainSuccessModal = () => {};

  context.saveBehavior();

  assert.deepEqual(requestBody, { role: 'New role' });
});

test('bot page saveBehavior reports automatic Codex persona projection', async () => {
  const status = field();
  const behaviorFields = {
    '[data-save-status]': status,
    '[data-act="save-behavior"]': field(),
    '[data-field="role"]': field('Projected role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
  };
  const behaviorPanel = panelElement('data-behavior-profile-slug', 'alice-bot', behaviorFields);
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-profile-slug]': behaviorPanel,
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profile: {
            slug: 'alice-bot',
            name: 'Alice',
            role: 'Projected role',
            soul: 'Original soul',
            goal: 'Original goal',
          },
          hostPersonaProjection: {
            ok: true,
            host: 'codex',
            operation: 'bind',
            action: 'updated',
          },
        },
      }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderBehaviorTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.saveBehavior();

  assert.equal(status.textContent, 'Persona saved and synced to Codex.');
  assert.equal(status.className, 'save-status success');
});

test('bot page distinguishes a saved persona from a failed Codex projection', () => {
  const context = createBotScriptContext();
  vm.runInNewContext(buildBotPageDefinition().script, context);

  const status = context.personaProjectionStatus({
    ok: false,
    host: 'codex',
    code: 'host_persona_conflict',
    message: 'The Codex agent file is user-owned.',
  });

  assert.equal(status.text, 'Persona saved, but Codex sync failed: The Codex agent file is user-owned.');
  assert.equal(status.className, 'save-status error');
});

test('bot page saveBehavior does not submit placeholders as persona content', () => {
  const status = field();
  const behaviorFields = {
    '[data-save-status]': status,
    '[data-act="save-behavior"]': field(),
    '[data-field="role"]': field(''),
    '[data-field="soul"]': field(''),
    '[data-field="goal"]': field(''),
  };
  const behaviorPanel = panelElement('data-behavior-profile-slug', 'empty-persona-bot', behaviorFields);
  let requestBody = null;
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-profile-slug]': behaviorPanel,
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: {} }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'empty-persona-bot';
  context.state.profiles = [{ slug: 'empty-persona-bot', name: 'Empty Persona Bot' }];
  context.state.originalProfile = {
    slug: 'empty-persona-bot',
    name: 'Empty Persona Bot',
    role: '',
    soul: '',
    goal: '',
  };

  context.saveBehavior();

  assert.equal(requestBody, null);
  assert.equal(status.textContent, 'No changes');
});

test('bot page savePublicIdentity sends provider changes only after the provider picker is touched', () => {
  const primary = field('codex');
  primary.setAttribute('data-provider-touched', '1');
  const fallback = field('');
  fallback.setAttribute('data-provider-touched', '1');
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="primaryProvider"]': primary,
    '[data-field="fallbackProvider"]': fallback,
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: null,
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    bio: 'Original public bio.',
    primaryProvider: 'openclaw',
    fallbackProvider: 'gemini',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    primaryProvider: 'codex',
    fallbackProvider: null,
  });
});

test('bot page savePublicIdentity sends only user edits and leaves LLM backfill to the backend', () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Updated public bio.'),
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field('openclaw'),
  };
  let requestBody = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              bio: 'Updated public bio.',
              primaryProvider: 'codex',
              fallbackProvider: 'openclaw',
            },
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    bio: 'Original public bio.',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    bio: 'Updated public bio.',
  });
});

test('bot page saveBehavior reads fields and save state from the behavior panel only', () => {
  const publicStatus = field();
  const publicButton = field();
  const behaviorStatus = field();
  const behaviorButton = field();
  const behaviorFields = {
    '[data-save-status]': behaviorStatus,
    '[data-act="save-behavior"]': behaviorButton,
    '[data-field="role"]': field('Behavior role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
  };
  const behaviorPanel = panelElement('data-behavior-profile-slug', 'alice-bot', behaviorFields);
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-profile-slug]': behaviorPanel,
      '[data-save-status]': publicStatus,
      '[data-act="save-behavior"]': publicButton,
      '[data-field="role"]': field('Hidden public role'),
      '[data-field="soul"]': field('Hidden public soul'),
      '[data-field="goal"]': field('Hidden public goal'),
    },
    fetch: (_url, options) => {
      context.requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              role: 'Behavior role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: 'openclaw',
            },
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderBehaviorTab = () => {};
  context.showChainSuccessModal = () => {};

  context.saveBehavior();

  assert.deepEqual(context.requestBody, { role: 'Behavior role' });
  assert.equal(behaviorStatus.textContent, 'Saving...');
  assert.equal(behaviorButton.disabled, true);
  assert.equal(publicStatus.textContent, '');
  assert.equal(publicButton.disabled, false);
});

test('bot page renders provider pickers with icons and only exposes none for fallback', () => {
  const definition = buildBotPageDefinition();
  assert.doesNotMatch(definition.script, /var icons=\{/);

  const context = {
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };

  vm.runInNewContext(definition.script, context);
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      logoPath: '/ui/assets/platforms/codex.svg',
      health: 'healthy',
    },
    {
      id: 'runtime-claude',
      provider: 'claude-code',
      displayName: 'Claude Code',
      logoPath: '/ui/assets/platforms/claude-code.svg',
      health: 'degraded',
    },
    {
      id: 'runtime-openclaw',
      provider: 'openclaw',
      displayName: 'OpenClaw',
      logoPath: '/ui/assets/platforms/openclaw.svg',
      health: 'unavailable',
    },
  ];

  const primaryPicker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', 'codex', false);
  const fallbackPicker = context.providerPickerMarkup('fallbackProvider', 'Fallback Provider', 'codex', true);

  assert.doesNotMatch(primaryPicker, /data-provider-option="none"/);
  assert.match(primaryPicker, /data-provider-picker="primaryProvider"/);
  assert.match(primaryPicker, /data-provider-icon="codex"/);
  assert.match(primaryPicker, /<img src="\/ui\/assets\/platforms\/codex\.svg" alt="" loading="lazy" \/>/);
  assert.match(primaryPicker, /data-provider-value="codex"[^>]*selected/);
  // Degraded providers render as disabled detected options, never as selectable values.
  assert.match(primaryPicker, /data-provider-icon="claude-code"/);
  assert.doesNotMatch(primaryPicker, /data-provider-value="claude-code"/);
  assert.match(primaryPicker, /provider-option-not-ready" disabled/);
  assert.doesNotMatch(primaryPicker, /data-provider-icon="openclaw"/);
  assert.match(fallbackPicker, /data-provider-option="none"/);
  assert.match(fallbackPicker, /<img src="\/ui\/assets\/platforms\/generic\.svg" alt="" loading="lazy" \/>/);
  assert.match(fallbackPicker, /data-provider-icon="claude-code"/);
  assert.doesNotMatch(fallbackPicker, /data-provider-value="claude-code"/);
  assert.doesNotMatch(fallbackPicker, /data-provider-icon="openclaw"/);
});

test('bot page removes an unavailable-provider reminder after selecting a ready provider', () => {
  const listeners = new Map();
  const input = field('openclaw');
  const trigger = { innerHTML: '' };
  const menu = {
    setAttribute: (name, value) => {
      menu[name] = value;
    },
  };
  const reminder = {
    removed: false,
    remove() {
      this.removed = true;
    },
  };
  const option = {
    attrs: new Map([['data-provider-value', 'codex']]),
    addEventListener: (eventName, handler) => listeners.set(eventName, handler),
    closest: (selector) => (selector === '[data-provider-picker]' ? picker : null),
    getAttribute(name) {
      return this.attrs.get(name) ?? null;
    },
    removeAttribute(name) {
      this.attrs.delete(name);
    },
    setAttribute(name, value) {
      this.attrs.set(name, String(value));
    },
  };
  const picker = {
    parentElement: {
      querySelector: (selector) => (selector === '[data-provider-open-runtimes]' ? reminder : null),
    },
    getAttribute: (name) => (name === 'data-provider-picker' ? 'primaryProvider' : null),
    querySelector: (selector) => {
      if (selector === '[data-field="primaryProvider"]') return input;
      if (selector === '[data-provider-toggle="primaryProvider"]') return trigger;
      return null;
    },
    querySelectorAll: (selector) => (selector === '[data-provider-value]' ? [option] : []),
  };
  const context = createBotScriptContext({
    elements: {
      '[data-provider-menu="primaryProvider"]': menu,
    },
    querySelectorAll: (selector) => (selector === '[data-provider-value]' ? [option] : []),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.runtimes = [{ id: 'runtime-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' }];
  context.wireProviderPickers();
  listeners.get('click').call(option, { preventDefault: () => {} });

  assert.equal(input.value, 'codex');
  assert.equal(input.getAttribute('data-provider-touched'), '1');
  assert.equal(reminder.removed, true);
});

test('bot page styles the unavailable-provider reminder as a lightweight inline hint', () => {
  const template = readFileSync(new URL('../../src/ui/pages/bot/index.html', import.meta.url), 'utf8');

  assert.match(template, /\.provider-unavailable-link\s*\{[^}]*background:\s*transparent;[^}]*font-family:\s*var\(--mono\);[^}]*font-size:\s*11px;[^}]*font-weight:\s*400;/s);
});

test('bot page renders provider-specific LLM icons even when runtime state has stale generic logos', () => {
  const summary = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-runtime-summary]': summary,
    },
  });
  const providerIcons = {
    'claude-code': '/ui/assets/platforms/claude-code.svg',
    codex: '/ui/assets/platforms/codex.svg',
    copilot: '/ui/assets/platforms/copilot.svg',
    opencode: '/ui/assets/platforms/opencode.svg',
    openclaw: '/ui/assets/platforms/openclaw.svg',
    hermes: '/ui/assets/platforms/hermes.svg',
    gemini: '/ui/assets/platforms/gemini.svg',
    pi: '/ui/assets/platforms/pi.svg',
    cursor: '/ui/assets/platforms/cursor.svg',
    kimi: '/ui/assets/platforms/kimi.svg',
    kiro: '/ui/assets/platforms/kiro.svg',
    codebuddy: '/ui/assets/platforms/codebuddy.svg',
    zcode: '/ui/assets/platforms/zcode.svg',
    workbuddy: '/ui/assets/platforms/codebuddy.svg',
  };
  const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'icon-bot';
  context.state.profiles = [{
    slug: 'icon-bot',
    name: 'Icon Bot',
    primaryProvider: 'zcode',
    fallbackProvider: 'workbuddy',
  }];
  context.state.runtimes = Object.keys(providerIcons).map((provider) => ({
    id: `runtime-${provider}`,
    provider,
    displayName: provider,
    logoPath: '/ui/assets/platforms/generic.svg',
    health: 'healthy',
  }));

  for (const [provider, iconPath] of Object.entries(providerIcons)) {
    const picker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', provider, false);
    const runtimeIcon = context.runtimeIconMarkup({ provider, logoPath: '/ui/assets/platforms/generic.svg' });
    const iconPattern = new RegExp(`<img src="${escapeRegExp(iconPath)}" alt="" loading="lazy" />`);

    assert.match(picker, new RegExp(`data-provider-icon="${provider}"`), provider);
    assert.match(picker, iconPattern, provider);
    assert.match(runtimeIcon, iconPattern, provider);
    assert.doesNotMatch(runtimeIcon, /\/ui\/assets\/platforms\/generic\.svg/, provider);
  }

  context.renderRuntimeSummary();

  assert.match(summary.innerHTML, /data-provider-icon="zcode"/);
  assert.match(summary.innerHTML, /\/ui\/assets\/platforms\/zcode\.svg/);
  assert.match(summary.innerHTML, /data-provider-icon="workbuddy"/);
  assert.match(summary.innerHTML, /\/ui\/assets\/platforms\/codebuddy\.svg/);
});

test('bot page renders the launch create flow and empty state in Simplified Chinese', () => {
  const list = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': list,
    },
    window: zhI18nWindow(),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);

  const createMarkup = context.createModalMarkup();
  assert.match(createMarkup, /创建 Bot/);
  assert.match(createMarkup, /Bot 名称/);
  assert.doesNotMatch(createMarkup, /上传/);
  assert.doesNotMatch(createMarkup, /公开简介/);
  assert.match(createMarkup, /取消/);

  context.renderMetabotList();
  assert.match(list.innerHTML, /还没有 Bot/);
});

test('bot page uses Simplified Chinese create validation and progress copy', () => {
  const status = field();
  const confirm = field();
  const modal = {
    innerHTML: '',
    classList: {
      add: () => {},
      remove: () => {},
    },
  };
  const fields = {
    '[data-field="new-name"]': field(''),
    '[data-add-status]': status,
    '[data-act="confirm-add"]': confirm,
    '[data-modal="add-metabot"]': modal,
  };
  const context = createBotScriptContext({
    elements: fields,
    window: zhI18nWindow(),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.createMetabot();

  assert.equal(status.textContent, '请输入 Bot 名称');
  assert.equal(status.className, 'save-status error');

  fields['[data-field="new-name"]'].value = 'Alice Bot';
  context.api = () => new Promise(() => {});
  context.createMetabot();

  assert.match(modal.innerHTML, /正在上链/);
  assert.match(modal.innerHTML, /数据正在写入链上，请等候 15-30 秒。/);
  assert.doesNotMatch(modal.innerHTML, /data-act="confirm-add"/);
});

async function createBotWithLlmBinding(llmBinding, windowOverride) {
  const modal = {
    innerHTML: '',
    classList: {
      add: () => {},
      remove: () => {},
    },
  };
  const context = createBotScriptContext({
    elements: {
      '[data-field="new-name"]': field('Rin'),
      '[data-add-status]': field(),
      '[data-act="confirm-add"]': field(),
      '[data-modal="add-metabot"]': modal,
    },
    window: windowOverride ?? {},
  });
  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.api = () => Promise.resolve({
    ok: true,
    data: {
      profile: { slug: 'rin', name: 'Rin' },
      setup: { state: 'ready' },
      llmBinding,
    },
  });
  context.loadProfiles = () => Promise.resolve();
  await context.createMetabot();
  return modal.innerHTML;
}

test('bot page create success shows the bound LLM outcome from the response', async () => {
  const html = await createBotWithLlmBinding({ status: 'healthy', primaryProvider: 'workbuddy' });
  assert.match(html, /LLM bound: workbuddy/);
});

test('bot page create success shows the pending LLM outcome with its hint', async () => {
  const html = await createBotWithLlmBinding({ status: 'pending', primaryProvider: 'codex' });
  assert.match(html, /Selected codex — verifying availability…/);
  assert.match(html, /It becomes usable automatically once ready; you can also test it under LLM runtimes\./);
});

test('bot page create success shows the no-LLM outcome with its hint', async () => {
  const html = await createBotWithLlmBinding({ status: 'none' });
  assert.match(html, /No LLM discovered on this machine yet — detecting in the background\./);
  assert.match(html, /Bind one later from the bot settings page\./);
});

test('bot page create success omits the LLM outcome when the response has no llmBinding', async () => {
  const html = await createBotWithLlmBinding(null);
  assert.doesNotMatch(html, /create-chain-llm/);
});

test('bot page create LLM outcome copy exists in both dictionaries with Simplified Chinese parity', async () => {
  const keys = ['bot.createLlmBound', 'bot.createLlmPending', 'bot.createLlmPendingHint', 'bot.createLlmNone', 'bot.createLlmNoneHint'];
  for (const key of keys) {
    assert.equal(typeof DICTIONARIES.en[key], 'string', key);
    assert.equal(typeof DICTIONARIES['zh-CN'][key], 'string', key);
  }
  assert.equal(DICTIONARIES['zh-CN']['bot.createLlmBound'], '已绑定 LLM：{provider}');
  assert.equal(DICTIONARIES['zh-CN']['bot.createLlmPending'], '已选择 {provider}，正在验证可用性…');
  assert.equal(DICTIONARIES['zh-CN']['bot.createLlmPendingHint'], '就绪后会自动可用，也可在 LLM 运行时中手动测试。');
  assert.equal(DICTIONARIES['zh-CN']['bot.createLlmNone'], '本机暂未发现 LLM，已在后台检测。');
  assert.equal(DICTIONARIES['zh-CN']['bot.createLlmNoneHint'], '稍后可在 Bot 设置页面绑定。');

  const html = await createBotWithLlmBinding({ status: 'pending', primaryProvider: 'codex' }, zhI18nWindow());
  assert.match(html, /已选择 codex，正在验证可用性…/);
  assert.match(html, /就绪后会自动可用，也可在 LLM 运行时中手动测试。/);
});

test('bot page renders chat skills tab for private conversation replies only', async () => {
  const root = { innerHTML: '' };
  const activeChatSkillsPanel = {
    getAttribute: (name) => (name === 'data-chat-skills-profile-slug' ? 'alice-bot' : null),
  };
  const context = createBotScriptContext({
    elements: {
      '[data-chat-skills-content]': root,
      '[data-chat-skills-profile-slug]': activeChatSkillsPanel,
    },
    fetch: (url) => {
      if (url === '/api/chat/auto-reply/status?from=alice-bot') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { enabled: true, defaultStrategyId: null } }),
        });
      }
      assert.equal(url, '/api/services/skills?from=alice-bot&allowFallbackRuntime=true');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            skills: [
              { skillName: 'weather.lookup', title: 'Weather Lookup', description: 'Check current weather.' },
              { skillName: 'orders.create', title: 'Create Order', description: 'Create a new order.' },
            ],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    allowChatSkills: ['weather.lookup'],
  }];
  context.state.selectedTab = 'chatSkills';
  context.renderChatSkillsTab();

  await context.loadChatSkillOptions('alice-bot');

  assert.doesNotMatch(root.innerHTML, /<label>Chat Skills<\/label>/);
  assert.match(root.innerHTML, /Private Chat Allowed Skills/);
  assert.doesNotMatch(root.innerHTML, /<label>Chat Allowed Skills<\/label>/);
  assert.doesNotMatch(root.innerHTML, /private conversation replies/i);
  assert.match(root.innerHTML, /data-field="chatSkillSelect"/);
  assert.match(root.innerHTML, /class="btn btn-primary btn-sm" data-act="add-chat-skill"/);
  assert.match(root.innerHTML, /value="weather\.lookup"/);
  assert.match(root.innerHTML, /Weather Lookup/);
  assert.match(root.innerHTML, /value="orders\.create"/);
  assert.match(root.innerHTML, /data-chat-skill-chip="weather\.lookup"/);
  assert.doesNotMatch(root.innerHTML, /Publish Service/);
  assert.doesNotMatch(root.innerHTML, /marketplace/i);
});

test('bot page omits the local services tab because services are available in top navigation', () => {
  const template = readFileSync(new URL('../../src/ui/pages/bot/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(template, /data-tab="services"/);
  assert.doesNotMatch(template, /data-services-content/);
  assert.doesNotMatch(template, /data-i18n-key="bot\.publishService"/);
  assert.doesNotMatch(template, /data-i18n-key="bot\.manageServices"/);
});

test('bot page chat skill add and remove controls rerender chat skills tab', () => {
  const addButton = field();
  const removeButton = field();
  addButton.addEventListener = (_event, handler) => {
    addButton.click = handler;
  };
  removeButton.addEventListener = (_event, handler) => {
    removeButton.click = handler;
  };
  removeButton.getAttribute = (name) => (name === 'data-skill' ? 'weather.lookup' : null);
  const select = field('orders.create');
  const context = {
    document: {
      querySelector: (selector) => (selector === '[data-field="chatSkillSelect"]' ? select : null),
      querySelectorAll: (selector) => {
        if (selector === '[data-act="add-chat-skill"]') return [addButton];
        if (selector === '[data-act="remove-chat-skill"]') return [removeButton];
        return [];
      },
      addEventListener: () => {},
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', allowChatSkills: ['weather.lookup'] }];
  context.state.chatAllowedSkillsBySlug['alice-bot'] = ['weather.lookup'];
  context.state.selectedTab = 'chatSkills';
  let renderChatSkillsTabCalls = 0;
  context.renderChatSkillsTab = () => {
    renderChatSkillsTabCalls += 1;
  };
  context.renderInfoTab = () => {
    throw new Error('chat skill tab controls should not rerender legacy info');
  };

  context.wireChatSkillControls();
  addButton.click({ preventDefault: () => {} });
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['weather.lookup', 'orders.create']);
  assert.equal(renderChatSkillsTabCalls, 1);

  context.wireChatSkillControls();
  removeButton.click({ preventDefault: () => {} });
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['orders.create']);
  assert.equal(renderChatSkillsTabCalls, 2);
});

test('bot page rolls back the Auto-Reply toggle when persistence fails', async () => {
  const classes = new Set(['toggle-switch', 'on', 'loading']);
  const attrs = new Map([['aria-checked', 'true']]);
  const label = field('On');
  label.textContent = 'On';
  const toggle = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, value) => attrs.set(name, String(value)),
    querySelector: (selector) => (selector === '.toggle-text' ? label : null),
  };
  const status = field();
  const panel = panelElement('data-chat-skills-profile-slug', 'alice-bot', {
    '[data-auto-reply-toggle]': toggle,
    '[data-auto-reply-status]': status,
  });
  const context = createBotScriptContext({
    elements: {
      '[data-auto-reply-status]': status,
      '[data-chat-skills-profile-slug]': panel,
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: false,
        code: 'auto_reply_persist_failed',
        message: 'Failed to save the auto-reply setting.',
      }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  const profile = { slug: 'alice-bot' };
  context.state.profiles = [profile];
  context.state.selectedSlug = 'alice-bot';
  context.state.selectedTab = 'chatSkills';
  context.state.autoReplyBySlug['alice-bot'] = false;

  await context.toggleAutoReply(profile, true);

  assert.equal(classes.has('on'), false);
  assert.equal(classes.has('loading'), false);
  assert.equal(attrs.get('aria-checked'), 'false');
  assert.equal(label.textContent, 'Off');
  assert.equal(status.className, 'save-status error');
  assert.equal(status.textContent, 'Failed to save the auto-reply setting.');
});

test('bot page renders Auto-Reply param selects with the server-provided values', async () => {
  const root = { innerHTML: '' };
  const activeChatSkillsPanel = {
    getAttribute: (name) => (name === 'data-chat-skills-profile-slug' ? 'alice-bot' : null),
  };
  const context = createBotScriptContext({
    elements: {
      '[data-chat-skills-content]': root,
      '[data-chat-skills-profile-slug]': activeChatSkillsPanel,
    },
    fetch: (url) => {
      if (url === '/api/chat/auto-reply/status?from=alice-bot') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: { enabled: true, defaultStrategyId: null, maxTurns: 10, cooldownMs: 600000 },
          }),
        });
      }
      assert.equal(url, '/api/services/skills?from=alice-bot&allowFallbackRuntime=true');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { skills: [] } }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice', allowChatSkills: [] }];
  context.state.selectedTab = 'chatSkills';
  context.renderChatSkillsTab();

  await context.loadAutoReplyStatus('alice-bot');

  assert.match(root.innerHTML, /data-auto-reply-max-turns/);
  assert.match(root.innerHTML, /<option value="5">5<\/option>/);
  assert.match(root.innerHTML, /<option value="10" selected>10<\/option>/);
  assert.match(root.innerHTML, /<option value="30">30<\/option>/);
  assert.match(root.innerHTML, /data-auto-reply-cooldown/);
  assert.match(root.innerHTML, /<option value="60000">1 min<\/option>/);
  assert.match(root.innerHTML, /<option value="600000" selected>10 min<\/option>/);
  assert.match(root.innerHTML, /<option value="3600000">60 min<\/option>/);
  assert.match(root.innerHTML, /Max messages per round/);
  assert.match(root.innerHTML, /Cooldown after end/);

  const keys = [
    'bot.autoReplyMaxTurns',
    'bot.autoReplyMaxTurnsHint',
    'bot.autoReplyCooldown',
    'bot.autoReplyCooldownHint',
    'bot.autoReplyCooldownMinutes',
  ];
  for (const key of keys) {
    assert.equal(typeof DICTIONARIES.en[key], 'string', key);
    assert.equal(typeof DICTIONARIES['zh-CN'][key], 'string', key);
  }
});

test('bot page posts Auto-Reply param changes and reverts the select on failure', async () => {
  const maxTurnsSelect = field('10');
  maxTurnsSelect.addEventListener = (_event, handler) => {
    maxTurnsSelect.change = handler;
  };
  maxTurnsSelect.setAttribute('data-auto-reply-slug', 'alice-bot');
  const status = field();
  const panel = panelElement('data-chat-skills-profile-slug', 'alice-bot', {
    '[data-auto-reply-status]': status,
  });
  const requests = [];
  let failNext = false;
  const context = createBotScriptContext({
    elements: {
      '[data-auto-reply-status]': status,
      '[data-chat-skills-profile-slug]': panel,
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-auto-reply-max-turns]') return [maxTurnsSelect];
      return [];
    },
    fetch: (url, opts) => {
      requests.push({ url, opts });
      if (failNext) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: false,
            code: 'auto_reply_persist_failed',
            message: 'Failed to save the auto-reply setting.',
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { enabled: true, defaultStrategyId: null, maxTurns: 10, cooldownMs: 300000 },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  const profile = { slug: 'alice-bot' };
  context.state.profiles = [profile];
  context.state.selectedSlug = 'alice-bot';
  context.state.selectedTab = 'chatSkills';
  context.state.autoReplyMaxTurnsBySlug['alice-bot'] = 5;

  context.wireAutoReplyParams();
  maxTurnsSelect.change();
  await waitFor(() => requests.length === 1, 'auto-reply maxTurns save request');

  assert.equal(requests[0].url, '/api/chat/auto-reply/config');
  assert.equal(requests[0].opts.method, 'POST');
  assert.deepEqual(JSON.parse(requests[0].opts.body), { from: 'alice-bot', maxTurns: 10 });
  await waitFor(() => context.state.autoReplyMaxTurnsBySlug['alice-bot'] === 10, 'cached maxTurns update');
  assert.equal(status.className, 'save-status success');

  failNext = true;
  maxTurnsSelect.value = '15';
  maxTurnsSelect.change();
  await waitFor(() => requests.length === 2, 'auto-reply maxTurns failing save request');
  assert.deepEqual(JSON.parse(requests[1].opts.body), { from: 'alice-bot', maxTurns: 15 });
  await waitFor(() => status.className === 'save-status error', 'save-status error');
  assert.equal(maxTurnsSelect.value, '10');
  assert.equal(context.state.autoReplyMaxTurnsBySlug['alice-bot'], 10);
});

test('bot page preserves info form drafts when chat skill controls rerender the tab', () => {
  const root = { innerHTML: '' };
  const activeInfoPanel = {
    getAttribute: (name) => (name === 'data-info-profile-slug' ? 'alice-bot' : null),
  };
  const primaryProvider = field('claude-code');
  primaryProvider.setAttribute('data-provider-touched', '1');
  const fallbackProvider = field('');
  fallbackProvider.setAttribute('data-provider-touched', '1');
  const fields = {
    '[data-info-content]': root,
    '[data-info-profile-slug]': activeInfoPanel,
    '[data-field="name"]': field('Alice Draft'),
    '[data-field="role"]': field('Draft role'),
    '[data-field="soul"]': field('Draft soul'),
    '[data-field="goal"]': field('Draft goal'),
    '[data-field="primaryProvider"]': primaryProvider,
    '[data-field="fallbackProvider"]': fallbackProvider,
  };
  const context = createBotScriptContext({
    elements: fields,
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice Saved',
    role: 'Saved role',
    soul: 'Saved soul',
    goal: 'Saved goal',
    primaryProvider: 'codex',
    fallbackProvider: 'gemini',
    allowChatSkills: ['weather.lookup'],
  }];
  context.state.runtimes = [
    {
      id: 'runtime-claude',
      provider: 'claude-code',
      displayName: 'Claude Code',
      logoPath: '/ui/assets/platforms/claude-code.svg',
      health: 'healthy',
    },
  ];

  context.renderInfoTab();

  assert.match(root.innerHTML, /value="Alice Draft"/);
  assert.match(root.innerHTML, /Draft role/);
  assert.match(root.innerHTML, /Draft soul/);
  assert.match(root.innerHTML, /Draft goal/);
  assert.match(root.innerHTML, /data-field="primaryProvider" value="claude-code" data-provider-touched="1"/);
  assert.match(root.innerHTML, /data-field="fallbackProvider" value="" data-provider-touched="1"/);
  assert.doesNotMatch(root.innerHTML, /Alice Saved/);
  assert.doesNotMatch(root.innerHTML, /Saved role/);
});

test('bot page renders Basic tab with public identity and provider controls', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice Bot',
    globalMetaId: 'gm-alice',
    bio: 'Writes code with the user.',
    avatarDataUrl: 'data:image/png;base64,avatar',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
  }];
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      logoPath: '/ui/assets/platforms/codex.svg',
      health: 'healthy',
    },
    {
      id: 'runtime-openclaw',
      provider: 'openclaw',
      displayName: 'OpenClaw',
      logoPath: '/ui/assets/platforms/openclaw.svg',
      health: 'healthy',
    },
  ];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /Bot Name/);
  assert.match(root.innerHTML, /Avatar/);
  assert.match(root.innerHTML, /Upload \/ Replace/);
  assert.match(root.innerHTML, /data-act="upload-avatar"/);
  assert.match(root.innerHTML, /data-act="remove-avatar"/);
  assert.match(root.innerHTML, /Public Bio/);
  assert.match(root.innerHTML, /Homepage/);
  assert.match(root.innerHTML, /Default home page renderer/);
  assert.match(root.innerHTML, /data-field="homepage-source"/);
  assert.match(root.innerHTML, /<option value="default" selected>Default<\/option>/);
  assert.match(root.innerHTML, /data-act="view-homepage"/);
  assert.doesNotMatch(root.innerHTML, /data-act="upload-homepage"/);
  assert.match(root.innerHTML, /Primary LLM Provider/);
  assert.match(root.innerHTML, /Fallback LLM Provider/);
  assert.match(root.innerHTML, /data-field="primaryProvider"/);
  assert.match(root.innerHTML, /data-field="fallbackProvider"/);
  assert.match(root.innerHTML, /Save Public Identity/);
  assert.doesNotMatch(root.innerHTML, /data-act="reset-public-identity"/);
  assert.doesNotMatch(root.innerHTML, /Reset/);
  assert.match(root.innerHTML, /data-field="name"/);
  assert.match(root.innerHTML, /data-field="bio"/);
  assert.match(root.innerHTML, /data-homepage-panel/);
  assert.doesNotMatch(root.innerHTML, /data-field="homepage-metaapp-pin"/);
  assert.doesNotMatch(root.innerHTML, /data-field="role"/);
  assert.doesNotMatch(root.innerHTML, /data-field="soul"/);
  assert.doesNotMatch(root.innerHTML, /data-field="goal"/);
  assert.doesNotMatch(root.innerHTML, /data-field="chatSkillSelect"/);
  assert.doesNotMatch(root.innerHTML, /Chat Allowed Skills/);
  assert.doesNotMatch(root.innerHTML, /Wallet/);
  assert.doesNotMatch(root.innerHTML, /Backup/);
  assert.doesNotMatch(root.innerHTML, /Delete/);
  assert.doesNotMatch(root.innerHTML, /Delete Bot/);
  assert.doesNotMatch(root.innerHTML, /LLM Providers/);
  assert.doesNotMatch(root.innerHTML, /View providers/);
  assert.doesNotMatch(root.innerHTML, /Refresh Runtimes/);
  assert.doesNotMatch(root.innerHTML, /Default Write Network/);
  assert.doesNotMatch(root.innerHTML, /Execution History/);
});

test('bot page localizes owned console copy without translating Bot identity content', () => {
  const root = { innerHTML: '' };
  const hero = { hidden: true };
  const summary = field();
  const name = field();
  const live = field();
  const elements = {
    '[data-info-content]': root,
    '[data-bot-hero]': hero,
    '[data-hero-avatar]': { innerHTML: '' },
    '[data-hero-name]': name,
    '[data-live-indicator]': live,
    '[data-hero-summary]': summary,
    '[data-hero-global-meta-id]': field(),
    '[data-hero-bot-uri]': field(),
    '[data-copy-global-meta-id]': field(),
    '[data-copy-bot-uri]': field(),
    '[data-act="view-bot-page"]': field(),
    '[data-act="view-conversations"]': field(),
  };
  const context = createBotScriptContext({
    elements,
    window: zhI18nWindow(),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice Public Bot',
    globalMetaId: 'gm-alice',
    bio: 'Writes code with the user.',
  }];

  context.renderBotHero(context.state.profiles[0]);
  context.renderPublicIdentityTab();

  assert.equal(name.textContent, 'Alice Public Bot');
  assert.equal(summary.textContent, 'Writes code with the user.');
  assert.equal(live.textContent, '');
  assert.equal(live.getAttribute('aria-label'), '在线');
  assert.match(root.innerHTML, /Bot 名称/);
  assert.match(root.innerHTML, /公开简介/);
  assert.match(root.innerHTML, /默认主页渲染器/);
  assert.match(root.innerHTML, /保存公开身份/);
  assert.match(root.innerHTML, /Alice Public Bot/);
  assert.match(root.innerHTML, /Writes code with the user\./);
});

test('bot page renders behavior tab with only behavior controls', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice Bot',
    role: 'Build beside the user.',
    soul: 'Careful and direct.',
    goal: 'Ship useful work.',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
    wallet: { addresses: { btc: 'btc-address' } },
    allowChatSkills: ['weather.lookup'],
  }];
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      logoPath: '/ui/assets/platforms/codex.svg',
      health: 'healthy',
    },
    {
      id: 'runtime-openclaw',
      provider: 'openclaw',
      displayName: 'OpenClaw',
      logoPath: '/ui/assets/platforms/openclaw.svg',
      health: 'healthy',
    },
  ];

  context.renderBehaviorTab();

  assert.match(root.innerHTML, /Role/);
  assert.match(root.innerHTML, /Soul/);
  assert.match(root.innerHTML, /Goal/);
  assert.match(root.innerHTML, /Choose a Persona/);
  assert.match(root.innerHTML, /data-act="open-persona-presets"/);
  assert.doesNotMatch(root.innerHTML, /Primary LLM Provider/);
  assert.doesNotMatch(root.innerHTML, /Fallback LLM Provider/);
  assert.doesNotMatch(root.innerHTML, /data-field="primaryProvider"/);
  assert.doesNotMatch(root.innerHTML, /data-field="fallbackProvider"/);
  assert.match(root.innerHTML, /Save Behavior/);
  assert.doesNotMatch(root.innerHTML, /Wallet/);
  assert.doesNotMatch(root.innerHTML, /Backup/);
  assert.doesNotMatch(root.innerHTML, /Execution History/);
  assert.doesNotMatch(root.innerHTML, /Chat Allowed Skills/);
  assert.doesNotMatch(root.innerHTML, /data-field="chatSkillSelect"/);
  assert.doesNotMatch(root.innerHTML, /Homepage/);
  assert.doesNotMatch(root.innerHTML, /data-act="upload-homepage"/);
  assert.doesNotMatch(root.innerHTML, /Publish Service/);
});

test('bot page offers all 32 Persona presets without saving automatically', () => {
  const modalRoot = {
    innerHTML: '',
    onclick: null,
    classList: { add: () => {}, remove: () => {} },
  };
  const context = createBotScriptContext({
    elements: { '[data-modal-root]': modalRoot },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.openPersonaPresetModal();

  assert.equal((modalRoot.innerHTML.match(/data-persona-id=/g) ?? []).length, 32);
  assert.match(modalRoot.innerHTML, /Gentle Listener/);
  assert.match(modalRoot.innerHTML, /Software &amp; AI Development Partner/);
  assert.match(modalRoot.innerHTML, /Applying a preset only fills the three fields/);
});

test('applying a Persona preset fills Role, Soul, and Goal as an unsaved draft', () => {
  const role = field();
  const soul = field();
  const goal = field();
  const status = field();
  const panel = panelElement('data-behavior-profile-slug', 'alice', {
    '[data-field="role"]': role,
    '[data-field="soul"]': soul,
    '[data-field="goal"]': goal,
    '[data-save-status]': status,
  });
  let fetchCalls = 0;
  const context = createBotScriptContext({
    elements: { '[data-behavior-profile-slug]': panel },
    fetch: () => { fetchCalls += 1; return Promise.reject(new Error('unexpected save')); },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];

  assert.equal(context.applyPersonaPresetById('gentle-listener', false), true);
  assert.match(role.value, /patient listening companion/);
  assert.match(soul.value, /non-judgmental/);
  assert.match(goal.value, /feel heard/);
  assert.equal(status.textContent, 'Preset applied. Review the fields, then save when ready.');
  assert.equal(fetchCalls, 0);
});

test('applying a Persona preset asks before replacing existing drafts', () => {
  const role = field('My existing role');
  const soul = field('My existing soul');
  const goal = field('My existing goal');
  const panel = panelElement('data-behavior-profile-slug', 'alice', {
    '[data-field="role"]': role,
    '[data-field="soul"]': soul,
    '[data-field="goal"]': goal,
  });
  const modalRoot = {
    innerHTML: '',
    onclick: null,
    classList: { add: () => {}, remove: () => {} },
  };
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-profile-slug]': panel,
      '[data-modal-root]': modalRoot,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];

  assert.equal(context.applyPersonaPresetById('candid-partner', false), false);
  assert.equal(role.value, 'My existing role');
  assert.match(modalRoot.innerHTML, /Replace the current Persona/);
  assert.match(modalRoot.innerHTML, /Nothing is saved yet/);

  assert.equal(context.applyPersonaPresetById('candid-partner', true), true);
  assert.match(role.value, /candid thinking partner/);
});

test('Persona presets follow the Simplified Chinese UI language', () => {
  const modalRoot = {
    innerHTML: '',
    onclick: null,
    classList: { add: () => {}, remove: () => {} },
  };
  const context = createBotScriptContext({
    elements: { '[data-modal-root]': modalRoot },
    window: zhI18nWindow(),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.openPersonaPresetModal();

  assert.match(modalRoot.innerHTML, /温柔倾听者/);
  assert.match(modalRoot.innerHTML, /软件与 AI 开发伙伴/);
  assert.match(modalRoot.innerHTML, /应用预设只会填入三个字段/);
});

test('bot page public identity tab is not replaced when chat skill options load', async () => {
  const root = { innerHTML: '' };
  let renderInfoCalls = 0;
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
    fetch: (url) => {
      assert.equal(url, '/api/services/skills?from=alice&allowFallbackRuntime=true');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            skills: [
              { skillName: 'weather.lookup', title: 'Weather Lookup' },
            ],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.selectedTab = 'publicIdentity';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice Bot',
    bio: 'Writes code with the user.',
    allowChatSkills: ['weather.lookup'],
  }];
  context.renderPublicIdentityTab();
  context.renderInfoTab = () => {
    renderInfoCalls += 1;
    root.innerHTML = '<div data-field="role">Role</div><div data-field="primaryProvider">Primary Provider</div><div data-field="chatSkillSelect">Chat Allowed Skills</div>';
  };

  await context.loadChatSkillOptions('alice');

  assert.equal(renderInfoCalls, 0);
  assert.match(root.innerHTML, /Public Bio/);
  assert.match(root.innerHTML, /data-field="primaryProvider"/);
  assert.match(root.innerHTML, /Save Public Identity/);
  assert.doesNotMatch(root.innerHTML, /data-field="role"/);
  assert.doesNotMatch(root.innerHTML, /data-field="chatSkillSelect"/);
  assert.doesNotMatch(root.innerHTML, /Chat Allowed Skills/);
});

test('bot page savePublicIdentity sends only changed public identity fields', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice Updated'),
    '[data-field="bio"]': field('Updated public bio.'),
  };
  let requestBody = null;
  let successModal = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice Updated',
              bio: 'Updated public bio.',
              avatarDataUrl: '',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: 'openclaw',
              allowChatSkills: ['weather.lookup'],
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
    avatarDataUrl: 'data:image/png;base64,avatar',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: 'openclaw',
    allowChatSkills: ['weather.lookup'],
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.state._pendingAvatar = '';
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = (input) => { successModal = input; };

  await context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    name: 'Alice Updated',
    bio: 'Updated public bio.',
    avatarDataUrl: '',
  });
  for (const key of ['role', 'soul', 'goal', 'primaryProvider', 'fallbackProvider', 'providers', 'allowChatSkills']) {
    assert.equal(Object.hasOwn(requestBody, key), false, `request body should omit ${key}`);
  }
  assert.equal(successModal.title, 'Profile Updated On-Chain');
});

test('bot page savePublicIdentity ignores stale UI updates after selection changes', async () => {
  const response = deferred();
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice Updated'),
    '[data-field="bio"]': field('Updated public bio.'),
  };
  let requestUrl = null;
  let renderListCount = 0;
  let renderHeroCount = 0;
  let renderTabCount = 0;
  let successModalCount = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (url) => {
      requestUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => response.promise,
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'bob';
  context.state.profiles = [
    { slug: 'alice', name: 'Alice', bio: 'Original public bio.' },
    { slug: 'bob', name: 'Bob', bio: 'Bob public bio.' },
  ];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => { renderListCount += 1; };
  context.renderDetailHeader = () => { renderHeroCount += 1; };
  context.renderPublicIdentityTab = () => { renderTabCount += 1; };
  context.showChainSuccessModal = () => { successModalCount += 1; };

  const save = context.savePublicIdentity();
  context.state.originalProfile = context.state.profiles[1];
  response.resolve({
    ok: true,
    data: {
      profile: {
        slug: 'alice',
        name: 'Alice Updated',
        bio: 'Updated public bio.',
      },
      chainWrites: [],
    },
  });

  await save;

  assert.equal(requestUrl, '/api/bot/profiles/alice');
  assert.equal(context.state.selectedSlug, 'bob');
  assert.equal(context.state.originalProfile.slug, 'bob');
  assert.equal(renderListCount, 0);
  assert.equal(renderHeroCount, 0);
  assert.equal(renderTabCount, 0);
  assert.equal(successModalCount, 0);
});

test('bot page saveBehavior ignores stale UI updates after selection changes', async () => {
  const response = deferred();
  const behaviorFields = {
    '[data-save-status]': field(),
    '[data-act="save-behavior"]': field(),
    '[data-field="role"]': field('Alice updated role'),
    '[data-field="soul"]': field('Alice updated soul'),
    '[data-field="goal"]': field('Alice updated goal'),
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field(''),
  };
  const behaviorPanel = panelElement('data-behavior-profile-slug', 'alice', behaviorFields);
  let requestUrl = null;
  let renderListCount = 0;
  let renderHeroCount = 0;
  let renderTabCount = 0;
  let successModalCount = 0;
  const context = createBotScriptContext({
    elements: {
      '[data-behavior-profile-slug]': behaviorPanel,
    },
    fetch: (url) => {
      requestUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => response.promise,
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [
    { slug: 'alice', name: 'Alice', role: 'Original role', soul: 'Original soul', goal: 'Original goal' },
    { slug: 'bob', name: 'Bob', role: 'Bob role', soul: 'Bob soul', goal: 'Bob goal' },
  ];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => { renderListCount += 1; };
  context.renderDetailHeader = () => { renderHeroCount += 1; };
  context.renderBehaviorTab = () => { renderTabCount += 1; };
  context.showChainSuccessModal = () => { successModalCount += 1; };

  const save = context.saveBehavior();
  context.state.selectedSlug = 'bob';
  context.state.originalProfile = context.state.profiles[1];
  response.resolve({
    ok: true,
    data: {
      profile: {
        slug: 'alice',
        name: 'Alice',
        role: 'Alice updated role',
        soul: 'Alice updated soul',
        goal: 'Alice updated goal',
      },
      chainWrites: [],
    },
  });

  await save;

  assert.equal(requestUrl, '/api/bot/profiles/alice');
  assert.equal(context.state.selectedSlug, 'bob');
  assert.equal(context.state.originalProfile.slug, 'bob');
  assert.equal(renderListCount, 0);
  assert.equal(renderHeroCount, 0);
  assert.equal(renderTabCount, 0);
  assert.equal(successModalCount, 0);
});

test('bot page MetaApp homepage input normalizes bare pin IDs into save payload', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-metaapp-pin"]': field(' metaapp-pin-123 '),
  };
  let requestBody = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
              homepage: {
                uri: 'metaapp://metaapp-pin-123',
                renderer: 'metaapp',
                contentType: 'application/vnd.metaapp',
              },
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    homepage: {
      uri: 'metaapp://metaapp-pin-123',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  });
});

test('bot page savePublicIdentity rejects empty MetaApp homepage input', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-source"]': field('metaapp'),
    '[data-field="homepage-metaapp-pin"]': field(' '),
  };
  let requestCount = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: () => {
      requestCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: {} }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];

  await context.savePublicIdentity();

  assert.equal(requestCount, 0);
  assert.match(fields['[data-homepage-status]'].textContent, /MetaApp pin ID/);
  assert.match(fields['[data-homepage-status]'].className, /error/);
  assert.equal(fields['[data-field="homepage-metaapp-pin"]'].getAttribute('aria-invalid'), 'true');
  assert.equal(fields['[data-field="homepage-metaapp-pin"]'].focused, true);
});

test('bot page Metafile homepage input normalizes bare pin IDs into save payload', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-source"]': field('metafile'),
    '[data-field="homepage-metafile-pin"]': field(' homepage-pin-123.html '),
  };
  let requestBody = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
              homepage: {
                uri: 'metafile://homepage-pin-123.html',
                renderer: 'auto',
                contentType: 'application/octet-stream',
              },
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    homepage: {
      uri: 'metafile://homepage-pin-123.html',
      renderer: 'auto',
      contentType: 'application/octet-stream',
    },
  });
});

test('bot page savePublicIdentity rejects empty Metafile homepage input', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-source"]': field('metafile'),
    '[data-field="homepage-metafile-pin"]': field(' '),
  };
  let requestCount = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: () => {
      requestCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: {} }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];

  await context.savePublicIdentity();

  assert.equal(requestCount, 0);
  assert.match(fields['[data-homepage-status]'].textContent, /Metafile pin ID/);
  assert.match(fields['[data-homepage-status]'].className, /error/);
  assert.equal(fields['[data-field="homepage-metafile-pin"]'].getAttribute('aria-invalid'), 'true');
  assert.equal(fields['[data-field="homepage-metafile-pin"]'].focused, true);
});

test('bot page savePublicIdentity rejects malformed MetaApp homepage input', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-metaapp-pin"]': field(' metaapp://metaapp://metaapp-pin-123 '),
  };
  let requestCount = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: () => {
      requestCount += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: {} }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];

  await context.savePublicIdentity();

  assert.equal(requestCount, 0);
  assert.equal(context.state._pendingHomepage, undefined);
  assert.match(fields['[data-homepage-status]'].className, /error/);
});

test('bot page savePublicIdentity lets a MetaApp input override a pending Metafile homepage', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
    '[data-field="homepage-metaapp-pin"]': field(' metaapp-pin-456 '),
  };
  let requestBody = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
              homepage: {
                uri: 'metaapp://metaapp-pin-456',
                renderer: 'metaapp',
                contentType: 'application/vnd.metaapp',
              },
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.state._pendingHomepage = {
    uri: 'metafile://file-pin-123.png',
    renderer: 'auto',
    contentType: 'image/png',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.savePublicIdentity();

  assert.deepEqual(requestBody, {
    homepage: {
      uri: 'metaapp://metaapp-pin-456',
      renderer: 'metaapp',
      contentType: 'application/vnd.metaapp',
    },
  });
});

test('bot page chooseHomepageMetaAppPin stores selected MetaApp homepage draft', () => {
  const context = createBotScriptContext();

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];
  context.state._homepageMetaAppPickerOpen = true;
  let renderCount = 0;
  context.renderPublicIdentityTab = () => {
    renderCount += 1;
  };

  context.chooseHomepageMetaAppPin('metaapp-pin-789');

  assert.equal(context.state._pendingHomepage.uri, 'metaapp://metaapp-pin-789');
  assert.equal(context.state._pendingHomepage.renderer, 'metaapp');
  assert.equal(context.state._pendingHomepage.contentType, 'application/vnd.metaapp');
  assert.equal(context.state._homepageSource, 'metaapp');
  assert.equal(context.state._homepageMetaAppPickerOpen, false);
  assert.equal(renderCount, 1);
});

test('bot page loadHomepageMetaApps uses the Apps owner list API', async () => {
  let requestUrl = '';
  const context = createBotScriptContext({
    fetch: (url) => {
      requestUrl = url;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            records: [
              { pinId: 'metaapp-pin-1', appName: 'Alpha' },
              { pinId: '', appName: 'Missing pin' },
            ],
            nextCursor: '',
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.renderPublicIdentityTab = () => {};

  const records = await context.loadHomepageMetaApps('alice', true);

  assert.equal(requestUrl, '/api/metaapp/list?from=alice&size=24');
  assert.deepEqual(records, [{ pinId: 'metaapp-pin-1', appName: 'Alpha' }]);
  assert.equal(context.state._homepageMetaAppsStatusBySlug.alice, 'loaded');
});

test('bot page homepage upload success stores Metafile draft and save payload', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-homepage-status]': field(),
    '[data-act="upload-homepage"]': field(),
    '[data-act="save-public-identity"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="bio"]': field('Original public bio.'),
  };
  let uploadRequest = null;
  let saveRequest = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (url, options) => {
      if (url === '/api/bot/profiles/alice/homepage/upload?fileName=cover.png') {
        uploadRequest = {
          url,
          body: options.body,
          headers: options.headers,
        };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              pinId: 'file-pin-123',
              metafileUri: 'metafile://file-pin-123.png',
              contentType: 'image/png',
              txids: ['tx-file-1'],
              bytes: 7,
            },
          }),
        });
      }
      saveRequest = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice',
              name: 'Alice',
              bio: 'Original public bio.',
              homepage: {
                uri: 'metafile://file-pin-123.png',
                renderer: 'auto',
                contentType: 'image/png',
              },
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice',
    bio: 'Original public bio.',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderPublicIdentityTab = () => {};
  context.showChainSuccessModal = () => {};

  const selectedFile = { name: 'cover.png', type: 'image/png', size: 7 };
  await context.handleHomepageUploadFile(selectedFile);
  await context.savePublicIdentity();

  assert.equal(uploadRequest.url, '/api/bot/profiles/alice/homepage/upload?fileName=cover.png');
  assert.equal(uploadRequest.body, selectedFile);
  assert.equal(uploadRequest.headers['content-type'], 'image/png');
  assert.deepEqual(saveRequest, {
    homepage: {
      uri: 'metafile://file-pin-123.png',
      renderer: 'auto',
      contentType: 'image/png',
    },
  });
});

test('bot page homepage upload ignores stale completion after selection changes', async () => {
  const uploadJson = deferred();
  const fields = {
    '[data-homepage-status]': field(),
    '[data-act="upload-homepage"]': field(),
  };
  let uploadRequest = null;
  let renderCount = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (url, options) => {
      uploadRequest = { url, body: options.body, headers: options.headers };
      return Promise.resolve({
        ok: true,
        json: () => uploadJson.promise,
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [
    { slug: 'alice', name: 'Alice', bio: 'Original public bio.' },
    { slug: 'bob', name: 'Bob', bio: 'Bob public bio.' },
  ];
  context.state.originalProfile = context.state.profiles[0];
  context.renderPublicIdentityTab = () => { renderCount += 1; };

  const selectedFile = { name: 'cover.png', type: 'image/png', size: 7 };
  const upload = context.handleHomepageUploadFile(selectedFile);
  await waitFor(() => uploadRequest !== null, 'homepage upload request');
  context.state.selectedSlug = 'bob';
  context.state.originalProfile = context.state.profiles[1];
  uploadJson.resolve({
    ok: true,
    data: {
      pinId: 'file-pin-123',
      metafileUri: 'metafile://file-pin-123.png',
      contentType: 'image/png',
    },
  });

  await upload;

  assert.equal(uploadRequest.url, '/api/bot/profiles/alice/homepage/upload?fileName=cover.png');
  assert.equal(uploadRequest.body, selectedFile);
  assert.equal(context.state.selectedSlug, 'bob');
  assert.equal(context.state._pendingHomepage, undefined);
  assert.equal(renderCount, 0);
});

test('bot page homepage upload allows files above the direct upload boundary', async () => {
  const fields = {
    '[data-homepage-status]': field(),
    '[data-act="upload-homepage"]': field(),
  };
  let uploadRequest = null;
  const context = createBotScriptContext({
    elements: fields,
    fetch: (url, options) => {
      uploadRequest = { url, body: options.body, headers: options.headers };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            pinId: 'large-file-pin-123',
            metafileUri: 'metafile://large-file-pin-123.html',
            contentType: 'text/html',
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];
  context.renderPublicIdentityTab = () => {};

  const selectedFile = {
    name: 'large.html',
    type: 'text/html',
    size: (2 * 1024 * 1024) + 1,
  };
  await context.handleHomepageUploadFile(selectedFile);

  assert.equal(uploadRequest.url, '/api/bot/profiles/alice/homepage/upload?fileName=large.html');
  assert.equal(uploadRequest.body, selectedFile);
  assert.equal(uploadRequest.headers['content-type'], 'text/html');
  assert.equal(context.state._pendingHomepage.uri, 'metafile://large-file-pin-123.html');
  assert.equal(context.state._pendingHomepage.renderer, 'auto');
  assert.equal(context.state._pendingHomepage.contentType, 'text/html');
});

test('bot page homepage upload appends file extension when response only returns pinId', async () => {
  const fields = {
    '[data-homepage-status]': field(),
    '[data-act="upload-homepage"]': field(),
  };
  const context = createBotScriptContext({
    elements: fields,
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          pinId: 'homepage-pin-123',
          contentType: 'text/html',
        },
      }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];
  context.renderPublicIdentityTab = () => {};

  await context.handleHomepageUploadFile({
    name: 'homepage.html',
    type: 'text/html',
    size: 12,
  });

  assert.equal(context.state._pendingHomepage.uri, 'metafile://homepage-pin-123.html');
  assert.equal(context.state._pendingHomepage.contentType, 'text/html');
});

test('bot page homepage upload rejects files above 50 MiB before fetch', async () => {
  const fields = {
    '[data-homepage-status]': field(),
    '[data-act="upload-homepage"]': field(),
  };
  let fetchCalls = 0;
  const context = createBotScriptContext({
    elements: fields,
    fetch: () => {
      fetchCalls += 1;
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: {} }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice' }];

  await context.handleHomepageUploadFile({
    name: 'too-large.html',
    type: 'text/html',
    size: (50 * 1024 * 1024) + 1,
  });

  assert.equal(fetchCalls, 0);
  assert.match(fields['[data-homepage-status]'].textContent, /50 MiB/);
});

test('bot page loadProfiles clears pending homepage when selected Bot changes', async () => {
  const context = createBotScriptContext({
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profiles: [{ slug: 'bob', name: 'Bob', bio: 'Bob public bio.' }],
        },
      }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state._pendingHomepage = {
    uri: 'metaapp://alice-homepage',
    renderer: 'metaapp',
    contentType: 'application/vnd.metaapp',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.setDetailVisible = () => {};
  context.renderCurrentTab = () => {};
  context.renderStats = () => {};

  await context.loadProfiles();

  assert.equal(context.state.selectedSlug, 'bob');
  assert.equal(context.state._pendingHomepage, undefined);
});

test('bot page loadProfiles seeds the selected Bot from the system default (isActive) rather than the first listed Bot', async () => {
  const context = createBotScriptContext({
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profiles: [
            { slug: 'first-bot', name: 'First', isActive: false },
            { slug: 'default-bot', name: 'Default', isActive: true },
            { slug: 'other-bot', name: 'Other', isActive: false },
          ],
        },
      }),
    }),
  });
  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.setDetailVisible = () => {};
  context.renderCurrentTab = () => {};
  context.renderStats = () => {};

  await context.loadProfiles();

  assert.equal(context.state.selectedSlug, 'default-bot');
});

test('bot page loadProfiles falls back to the first Bot when no Bot is marked isActive', async () => {
  const context = createBotScriptContext({
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profiles: [
            { slug: 'first-bot', name: 'First', isActive: false },
            { slug: 'other-bot', name: 'Other', isActive: false },
          ],
        },
      }),
    }),
  });
  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.setDetailVisible = () => {};
  context.renderCurrentTab = () => {};
  context.renderStats = () => {};

  await context.loadProfiles();

  assert.equal(context.state.selectedSlug, 'first-bot');
});

test('bot page public identity reset reverts profile draft and clears pending avatar', () => {
  const root = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{
    slug: 'alice',
    name: 'Alice Bot',
    bio: 'Writes code with the user.',
    avatarDataUrl: 'data:image/png;base64,current',
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.state._pendingAvatar = 'data:image/png;base64,draft';

  context.resetPublicIdentity();

  assert.equal(context.state._pendingAvatar, undefined);
  assert.match(root.innerHTML, /value="Alice Bot"/);
  assert.match(root.innerHTML, /Writes code with the user\./);
  assert.match(root.innerHTML, /data:image\/png;base64,current/);
});

test('bot page saveInfo sends normalized allowChatSkills only after selected chips change', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-info"]': field(),
    '[data-field="name"]': field('Alice'),
    '[data-field="role"]': field('Original role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field(''),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: null,
              allowChatSkills: ['orders.create', 'weather.lookup'],
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: ['weather.lookup'],
  };
  context.state.chatAllowedSkillsBySlug['alice-bot'] = ['orders.create', 'orders.create', ' ', 'weather.lookup'];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderInfoTab = () => {};
  context.renderStats = () => {};
  context.loadStats = () => Promise.resolve();
  context.showChainSuccessModal = () => {};

  await context.saveInfo();

  assert.deepEqual(requestBody, { allowChatSkills: ['orders.create', 'weather.lookup'] });
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['orders.create', 'weather.lookup']);
});

test('bot page saveChatSkills sends normalized allowChatSkills only after selected chips change', async () => {
  const chatSkillsFields = {
    '[data-save-status]': field(),
    '[data-act="save-chat-skills"]': field(),
  };
  const chatSkillsPanel = panelElement('data-chat-skills-profile-slug', 'alice-bot', chatSkillsFields);
  let requestBody = null;
  const context = createBotScriptContext({
    elements: {
      '[data-chat-skills-profile-slug]': chatSkillsPanel,
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice',
              allowChatSkills: ['orders.create', 'weather.lookup'],
            },
            chainWrites: [],
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    allowChatSkills: ['weather.lookup'],
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.state.chatAllowedSkillsBySlug['alice-bot'] = ['orders.create', 'orders.create', ' ', 'weather.lookup'];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderChatSkillsTab = () => {};
  context.showChainSuccessModal = () => {};

  await context.saveChatSkills();

  assert.deepEqual(requestBody, { allowChatSkills: ['orders.create', 'weather.lookup'] });
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['orders.create', 'weather.lookup']);
});

test('bot page saveChatSkills warns without blocking when the chain sync fails', async () => {
  const status = field();
  const chatSkillsPanel = panelElement('data-chat-skills-profile-slug', 'alice-bot', {
    '[data-save-status]': status,
    '[data-act="save-chat-skills"]': field(),
  });
  let successModalCount = 0;
  const context = createBotScriptContext({
    elements: {
      '[data-chat-skills-profile-slug]': chatSkillsPanel,
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profile: {
            slug: 'alice-bot',
            name: 'Alice',
            allowChatSkills: ['orders.create'],
          },
          chainWrites: [],
          chainSync: { ok: false, error: 'chain is offline' },
        },
      }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    allowChatSkills: [],
  }];
  context.state.originalProfile = context.state.profiles[0];
  context.state.chatAllowedSkillsBySlug['alice-bot'] = ['orders.create'];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderChatSkillsTab = () => {};
  context.showChainSuccessModal = () => { successModalCount += 1; };

  await context.saveChatSkills();

  assert.equal(status.textContent, 'Saved locally; chain sync failed: chain is offline');
  assert.equal(status.className, 'save-status warning');
  assert.equal(successModalCount, 0);
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['orders.create']);
});

test('bot page chat skills tab warns about configured skills that no longer resolve', async () => {
  const root = { innerHTML: '' };
  const activeChatSkillsPanel = {
    getAttribute: (name) => (name === 'data-chat-skills-profile-slug' ? 'alice-bot' : null),
  };
  const context = createBotScriptContext({
    elements: {
      '[data-chat-skills-content]': root,
      '[data-chat-skills-profile-slug]': activeChatSkillsPanel,
    },
    fetch: (url) => {
      if (url === '/api/chat/auto-reply/status?from=alice-bot') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { enabled: true, defaultStrategyId: null } }),
        });
      }
      assert.equal(url, '/api/services/skills?from=alice-bot&allowFallbackRuntime=true');
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            skills: [
              { skillName: 'weather.lookup', title: 'Weather Lookup', description: 'Check current weather.' },
            ],
            chatSkillResolution: {
              resolved: ['weather.lookup'],
              skipped: ['gone.skill', 'old.skill'],
              warning: 'Skipping unavailable chat skills: gone.skill, old.skill',
              checkedAt: '2026-05-06T00:00:00.000Z',
            },
          },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{
    slug: 'alice-bot',
    name: 'Alice',
    allowChatSkills: ['weather.lookup', 'gone.skill', 'old.skill'],
  }];
  context.state.selectedTab = 'chatSkills';
  context.renderChatSkillsTab();

  await context.loadChatSkillOptions('alice-bot');

  assert.match(root.innerHTML, /2 configured skills unavailable: gone\.skill, old\.skill/);
});

test('bot page chat skill warning copy exists in both dictionaries', () => {
  const keys = ['bot.chatSkillsSavedChainFailed', 'bot.chatSkillsUnavailable'];
  for (const key of keys) {
    assert.equal(typeof DICTIONARIES.en[key], 'string', key);
    assert.equal(typeof DICTIONARIES['zh-CN'][key], 'string', key);
  }
});

test('bot page saveInfo omits allowChatSkills when selected chips are unchanged', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-info"]': field(),
    '[data-field="name"]': field('Alice Updated'),
    '[data-field="role"]': field('Original role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field(''),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'alice-bot',
              name: 'Alice Updated',
              role: 'Original role',
              soul: 'Original soul',
              goal: 'Original goal',
              primaryProvider: 'codex',
              fallbackProvider: null,
              allowChatSkills: ['weather.lookup'],
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    allowChatSkills: ['weather.lookup'],
  };
  context.state.chatAllowedSkillsBySlug['alice-bot'] = ['weather.lookup'];
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderInfoTab = () => {};
  context.renderStats = () => {};
  context.loadStats = () => Promise.resolve();
  context.showChainSuccessModal = () => {};

  await context.saveInfo();

  assert.deepEqual(requestBody, { name: 'Alice Updated' });
});

test('bot page create flow sends only the minimal identity fields', async () => {
  const fields = {
    '[data-field="new-name"]': field('Alice'),
    '[data-field="new-bio"]': field('Builds with Codex.'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'fanny',
              name: 'Fanny',
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state._pendingCreateAvatar = 'data:image/png;base64,...';
  context.state.chatAllowedSkillsBySlug.alice = ['weather.lookup'];
  context.closeAddModal = () => {};
  context.loadProfiles = () => Promise.resolve();
  context.showChainSuccessModal = () => {};

  await context.createMetabot();

  assert.deepEqual(requestBody, {
    name: 'Alice',
    creationSource: 'ui',
  });
});

test('bot page create flow starts only from the Create button', async () => {
  const nameListeners = new Map();
  const confirmListeners = new Map();
  const name = field();
  const confirm = field();
  name.addEventListener = (eventName, handler) => nameListeners.set(eventName, handler);
  confirm.addEventListener = (eventName, handler) => confirmListeners.set(eventName, handler);
  const modalClasses = new Set(['hidden']);
  const modal = {
    innerHTML: '',
    classList: {
      add: (name) => modalClasses.add(name),
      remove: (name) => modalClasses.delete(name),
    },
  };
  const context = createBotScriptContext({
    elements: {
      '[data-modal="add-metabot"]': modal,
      '[data-field="new-name"]': name,
      '[data-add-status]': field(),
      '[data-act="cancel-add"]': field(),
      '[data-act="confirm-add"]': confirm,
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: { profile: { slug: 'alice', name: 'Alice' } },
      }),
    }),
  });
  let createRequests = 0;
  const originalFetch = context.fetch;
  context.fetch = (...args) => {
    createRequests += 1;
    return originalFetch(...args);
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.loadProfiles = () => Promise.resolve();
  context.openAddModal();
  name.value = 'Alice';

  nameListeners.get('keydown')({ key: 'Enter' });

  assert.equal(createRequests, 0);
  assert.equal(modalClasses.has('hidden'), false);

  await confirmListeners.get('click')();

  assert.equal(createRequests, 1);
});

test('bot page keeps subsidy failure visible after creation and retries setup', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  const modal = {
    innerHTML: '',
    classList: { add: () => {}, remove: () => {} },
  };
  fields['[data-modal="add-metabot"]'] = modal;
  const requests = [];
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url, options) => {
      requests.push({ url, method: options?.method });
      if (url.endsWith('/setup/retry')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profile: { slug: 'fanny', name: 'Fanny', globalMetaId: 'gm-fanny' },
              setup: { state: 'ready', retryable: false, error: null },
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: { slug: 'fanny', name: 'Fanny', globalMetaId: 'gm-fanny' },
            subsidy: { success: false, error: 'asset utxo list is empty' },
            setup: { state: 'subsidy_failed', retryable: true, error: 'asset utxo list is empty' },
          },
        }),
      });
    },
    window: {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.loadProfiles = () => Promise.resolve();
  context.showToast = () => {};

  await context.createMetabot();

  assert.match(modal.innerHTML, /Bot created; setup incomplete/);
  assert.match(modal.innerHTML, /asset utxo list is empty/);
  assert.match(modal.innerHTML, /data-act="retry-created-bot-setup"/);

  await context.retryMetabotSetup('fanny', true, field());

  assert.deepEqual(requests, [
    { url: '/api/bot/profiles', method: 'POST' },
    { url: '/api/bot/profiles/fanny/setup/retry', method: 'POST' },
  ]);
  assert.match(modal.innerHTML, /Bot created/);
  assert.match(modal.innerHTML, /Open Bot homepage/);
});

test('bot page renders a persistent subsidy warning for an affected Bot', () => {
  const alert = { hidden: true, innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-bot-setup-alert]': alert,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderBotSetupAlert({
    slug: 'fanny',
    setup: {
      state: 'subsidy_failed',
      retryable: true,
      error: 'subsidy unavailable',
    },
  });

  assert.equal(alert.hidden, false);
  assert.match(alert.innerHTML, /Subsidy claim failed/);
  assert.match(alert.innerHTML, /subsidy unavailable/);
  assert.match(alert.innerHTML, /data-act="retry-bot-setup"/);
});

test('bot page create flow forwards the host hint from the URL', async () => {
  const fields = {
    '[data-field="new-name"]': field('Codex Bot'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  let requestBody = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'codex-bot',
              name: 'Codex Bot',
            },
          },
        }),
      });
    },
    window: {
      location: {
        search: '?mode=create&host=codex',
      },
    },
    URLSearchParams,
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.loadProfiles = () => Promise.resolve();

  await context.createMetabot();

  assert.deepEqual(requestBody, {
    name: 'Codex Bot',
    creationSource: 'ui',
    host: 'codex',
  });
});

test('bot page opens the creation modal after initial load when mode=create is requested', async () => {
  const loaded = deferred();
  let domReady = null;
  let focused = false;
  const classNames = new Set(['hidden']);
  const modal = {
    innerHTML: '',
    onclick: null,
    addEventListener: () => {},
    classList: {
      add: (name) => classNames.add(name),
      remove: (name) => classNames.delete(name),
      contains: (name) => classNames.has(name),
    },
  };
  const name = field();
  name.focus = () => {
    focused = true;
  };
  const context = createBotScriptContext({
    elements: {
      '[data-modal="add-metabot"]': modal,
      '[data-field="new-name"]': name,
      '[data-add-status]': field(),
      '[data-act="add-metabot"]': field(),
      '[data-act="cancel-add"]': field(),
      '[data-act="confirm-add"]': field(),
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '?mode=create',
        },
      },
    },
  });
  context.document.addEventListener = (event, handler) => {
    if (event === 'DOMContentLoaded') domReady = handler;
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.loadAll = () => loaded.promise;

  domReady();
  assert.equal(classNames.has('hidden'), true);

  loaded.resolve();
  await loaded.promise;
  await Promise.resolve();

  assert.equal(classNames.has('hidden'), false);
  assert.equal(focused, true);
  assert.match(modal.innerHTML, /data-field="new-name"/);
  assert.doesNotMatch(modal.innerHTML, /data-field="new-avatar-file"/);
  assert.doesNotMatch(modal.innerHTML, /data-field="new-bio"/);
  assert.doesNotMatch(modal.innerHTML, /data-act="upload-create-avatar"/);
  assert.doesNotMatch(modal.innerHTML, /data-act="remove-create-avatar"/);
  assert.doesNotMatch(modal.innerHTML, /primaryProvider/);
  assert.doesNotMatch(modal.innerHTML, /fallbackProvider/);
  assert.doesNotMatch(modal.innerHTML, /data-field="role"/);
  assert.doesNotMatch(modal.innerHTML, /data-field="soul"/);
  assert.doesNotMatch(modal.innerHTML, /data-field="goal"/);
});

test('bot page defaults to the public identity tab after profiles load', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const infoRoot = { innerHTML: '' };
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': field(),
      '[data-metabot-count]': field(),
      '[data-bot-hero]': field(),
      '[data-hero-avatar]': field(),
      '[data-hero-name]': field(),
      '[data-hero-summary]': field(),
      '[data-hero-global-meta-id]': field(),
      '[data-hero-bot-uri]': field(),
      '[data-live-indicator]': field(),
      '[data-detail-empty]': field(),
      '[data-tab-bar]': field(),
      '[data-tab-content]': field(),
      '[data-info-content]': infoRoot,
      '[data-execution-history-list]': { innerHTML: '' },
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '',
        },
      },
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/profiles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profiles: [
                { slug: 'bob', name: 'Bob', globalMetaId: 'gm-bob', allowChatSkills: [] },
                { slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice', allowChatSkills: [] },
              ],
            },
          }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  await context.loadProfiles();

  assert.equal(context.state.selectedSlug, 'bob');
  assert.equal(context.state.selectedTab, 'publicIdentity');
  assert.equal(publicIdentityTab.active, true);
  assert.equal(behaviorTab.active, false);
  assert.equal(advancedTab.active, false);
  assert.match(infoRoot.innerHTML, /data-public-identity-profile-slug="bob"/);
  assert.doesNotMatch(infoRoot.innerHTML, /data-field="chatSkillSelect"/);
  assert.equal(calls.includes('/api/services/skills?from=bob&allowFallbackRuntime=true'), false);
  assert.equal(calls.includes('/api/bot/sessions?slug=alice&limit=50'), false);
});

test('bot page deep link maps legacy history messages links to advanced before loading sessions', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const historyRoot = field();
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': field(),
      '[data-metabot-count]': field(),
      '[data-bot-hero]': field(),
      '[data-hero-avatar]': field(),
      '[data-hero-name]': field(),
      '[data-hero-summary]': field(),
      '[data-hero-global-meta-id]': field(),
      '[data-hero-bot-uri]': field(),
      '[data-live-indicator]': field(),
      '[data-detail-empty]': field(),
      '[data-tab-bar]': field(),
      '[data-tab-content]': field(),
      '[data-info-content]': { innerHTML: '' },
      '[data-execution-history-list]': historyRoot,
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '?profile=alice&tab=history&focus=messages',
        },
      },
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/profiles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profiles: [
                { slug: 'bob', name: 'Bob', globalMetaId: 'gm-bob', allowChatSkills: [] },
                { slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice', allowChatSkills: [] },
              ],
            },
          }),
        });
      }
      if (url === '/api/bot/sessions?slug=alice&limit=50') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              sessions: [
                { metaBotSlug: 'alice', sessionId: 'session-alice', status: 'completed', prompt: 'hello' },
              ],
            },
          }),
        });
      }
      if (url === '/api/bot/profiles/alice/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: { chain: { defaultWriteNetwork: 'mvc' } },
          }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  await context.loadProfiles();
  await waitFor(() => calls.includes('/api/bot/sessions?slug=alice&limit=50'), 'Alice history load');
  await waitFor(() => context.state.sessions.length === 1, 'Alice history state update');

  assert.equal(context.state.selectedSlug, 'alice');
  assert.equal(context.state.selectedTab, 'advanced');
  assert.equal(publicIdentityTab.active, false);
  assert.equal(advancedTab.active, true);
  assert.deepEqual(context.state.sessions.map((session) => session.sessionId), ['session-alice']);
  assert.match(historyRoot.innerHTML, /session-alice/);
  assert.equal(historyRoot.focused, true);
  assert.equal(historyRoot.scrolled, true);
});

test('bot page advanced tab loads sessions and selected profile config', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const settingsRoot = field();
  const historyRoot = field();
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-settings-content]': settingsRoot,
      '[data-execution-history-list]': historyRoot,
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/sessions?slug=alice&limit=50') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              sessions: [
                { metaBotSlug: 'alice', sessionId: 'session-alice', status: 'completed', prompt: 'hello' },
              ],
            },
          }),
        });
      }
      if (url === '/api/bot/profiles/alice/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: { chain: { defaultWriteNetwork: 'opcat' } },
          }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice' }];

  context.switchTab('advanced');

  await waitFor(() => calls.includes('/api/bot/sessions?slug=alice&limit=50'), 'advanced sessions load');
  await waitFor(() => calls.includes('/api/bot/profiles/alice/config'), 'advanced config load');
  await waitFor(() => context.state.sessions.length === 1, 'advanced session state update');

  assert.equal(context.state.selectedTab, 'advanced');
  assert.equal(advancedTab.active, true);
  assert.match(historyRoot.innerHTML, /session-alice/);
  assert.match(settingsRoot.innerHTML, /Default Write Network/);
  assertDefaultWriteNetworkPicker(settingsRoot.innerHTML, 'opcat');
});

test('bot page renderAdvancedTab renders advanced controls and lazily loads local data', async () => {
  const settingsRoot = field();
  const historyRoot = field();
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-settings-content]': settingsRoot,
      '[data-execution-history-list]': historyRoot,
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/sessions?slug=alice&limit=50') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              sessions: [
                { metaBotSlug: 'alice', sessionId: 'session-alice', status: 'completed', prompt: 'hello' },
              ],
            },
          }),
        });
      }
      if (url === '/api/bot/profiles/alice/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: { chain: { defaultWriteNetwork: 'btc' } },
          }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice' }];

  assert.equal(typeof context.renderAdvancedTab, 'function');

  context.renderAdvancedTab();

  assert.match(settingsRoot.innerHTML, /Loading settings/);
  await waitFor(() => calls.includes('/api/bot/profiles/alice/config'), 'advanced config load');
  await waitFor(() => calls.includes('/api/bot/sessions?slug=alice&limit=50'), 'advanced sessions load');
  await waitFor(() => context.state.sessions.length === 1, 'advanced session state update');

  assert.match(settingsRoot.innerHTML, /Default Write Network/);
  assertDefaultWriteNetworkPicker(settingsRoot.innerHTML, 'btc');
  assert.match(historyRoot.innerHTML, /session-alice/);
});

test('bot page default write network picker keeps save payload compatible', async () => {
  const selectedNetwork = field('doge');
  const status = field();
  const button = field();
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-field="defaultWriteNetwork"]': selectedNetwork,
      '[data-settings-status]': status,
      '[data-act="save-settings"]': button,
    },
    fetch: (url, options = {}) => {
      calls.push({ url: String(url), body: options.body });
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: { chain: { defaultWriteNetwork: 'doge' } },
        }),
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice';
  context.state.profiles = [{ slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice' }];
  context.state.profileConfigs.alice = { chain: { defaultWriteNetwork: 'btc' } };

  await context.saveSettings();

  assert.deepEqual(calls, [{
    url: '/api/bot/profiles/alice/config',
    body: JSON.stringify({ chain: { defaultWriteNetwork: 'doge' } }),
  }]);
});

test('bot page maps legacy settings deep links to advanced and loads selected profile config', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const settingsRoot = field();
  const historyRoot = field();
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': field(),
      '[data-metabot-count]': field(),
      '[data-bot-hero]': field(),
      '[data-hero-avatar]': field(),
      '[data-hero-name]': field(),
      '[data-hero-summary]': field(),
      '[data-hero-global-meta-id]': field(),
      '[data-hero-bot-uri]': field(),
      '[data-live-indicator]': field(),
      '[data-detail-empty]': field(),
      '[data-tab-bar]': field(),
      '[data-tab-content]': field(),
      '[data-info-content]': { innerHTML: '' },
      '[data-settings-content]': settingsRoot,
      '[data-execution-history-list]': historyRoot,
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '?profile=alice&tab=settings',
        },
      },
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/profiles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profiles: [
                { slug: 'bob', name: 'Bob', globalMetaId: 'gm-bob', allowChatSkills: [] },
                { slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice', allowChatSkills: [] },
              ],
            },
          }),
        });
      }
      if (url === '/api/bot/sessions?slug=alice&limit=50') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { sessions: [] } }),
        });
      }
      if (url === '/api/bot/profiles/alice/config') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: { chain: { defaultWriteNetwork: 'doge' } },
          }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  await context.loadProfiles();
  await waitFor(() => calls.includes('/api/bot/profiles/alice/config'), 'legacy settings config load');
  await waitFor(() => /Default Write Network/.test(settingsRoot.innerHTML), 'legacy settings render');

  assert.equal(context.state.selectedSlug, 'alice');
  assert.equal(context.state.selectedTab, 'advanced');
  assert.equal(advancedTab.active, true);
  assert.match(settingsRoot.innerHTML, /Default Write Network/);
  assertDefaultWriteNetworkPicker(settingsRoot.innerHTML, 'doge');
});

test('bot page deep link maps legacy info profile links to public identity', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const infoRoot = { innerHTML: '' };
  const nameField = field('Alice');
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': field(),
      '[data-metabot-count]': field(),
      '[data-bot-hero]': field(),
      '[data-hero-avatar]': field(),
      '[data-hero-name]': field(),
      '[data-hero-summary]': field(),
      '[data-hero-global-meta-id]': field(),
      '[data-hero-bot-uri]': field(),
      '[data-live-indicator]': field(),
      '[data-detail-empty]': field(),
      '[data-tab-bar]': field(),
      '[data-tab-content]': field(),
      '[data-info-content]': infoRoot,
      '[data-field="name"]': nameField,
      '[data-execution-history-list]': field(),
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '?profile=alice&tab=info&focus=profile',
        },
      },
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/profiles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profiles: [
                { slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice', allowChatSkills: [] },
              ],
            },
          }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  await context.loadProfiles();

  assert.equal(context.state.selectedSlug, 'alice');
  assert.equal(context.state.selectedTab, 'publicIdentity');
  assert.equal(publicIdentityTab.active, true);
  assert.equal(nameField.focused, true);
  assert.equal(nameField.scrolled, true);
  assert.doesNotMatch(infoRoot.innerHTML, /data-field="chatSkillSelect"/);
  assert.equal(calls.includes('/api/services/skills?from=alice&allowFallbackRuntime=true'), false);
});

test('bot page deep link maps legacy info chat links to chat skills', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': field(),
      '[data-metabot-count]': field(),
      '[data-bot-hero]': field(),
      '[data-hero-avatar]': field(),
      '[data-hero-name]': field(),
      '[data-hero-summary]': field(),
      '[data-hero-global-meta-id]': field(),
      '[data-hero-bot-uri]': field(),
      '[data-live-indicator]': field(),
      '[data-detail-empty]': field(),
      '[data-tab-bar]': field(),
      '[data-tab-content]': field(),
      '[data-info-content]': { innerHTML: '' },
      '[data-chat-skills-content]': { innerHTML: '' },
      '[data-execution-history-list]': field(),
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '?profile=alice&tab=info&focus=chat',
        },
      },
    },
    fetch: (url) => {
      if (url === '/api/bot/profiles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profiles: [
                { slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice', allowChatSkills: [] },
              ],
            },
          }),
        });
      }
      if (url === '/api/services/skills?from=alice&allowFallbackRuntime=true') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { skills: [] } }),
        });
      }
      if (url === '/api/chat/auto-reply/status?from=alice') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { enabled: true, defaultStrategyId: null } }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  await context.loadProfiles();

  assert.equal(context.state.selectedSlug, 'alice');
  assert.equal(context.state.selectedTab, 'chatSkills');
  assert.equal(publicIdentityTab.active, false);
  assert.equal(chatSkillsTab.active, true);
});

test('bot page deep link focus is consumed after the first successful activation', async () => {
  const publicIdentityTab = tabElement('publicIdentity');
  const behaviorTab = tabElement('behavior');
  const chatSkillsTab = tabElement('chatSkills');
  const servicesTab = tabElement('services');
  const advancedTab = tabElement('advanced');
  const publicIdentityPanel = tabElement('publicIdentity');
  const behaviorPanel = tabElement('behavior');
  const chatSkillsPanel = tabElement('chatSkills');
  const servicesPanel = tabElement('services');
  const advancedPanel = tabElement('advanced');
  const infoRoot = { innerHTML: '' };
  const nameField = field('Alice');
  let focusCount = 0;
  let scrollCount = 0;
  nameField.focus = () => {
    nameField.focused = true;
    focusCount += 1;
  };
  nameField.scrollIntoView = () => {
    nameField.scrolled = true;
    scrollCount += 1;
  };
  const calls = [];
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': field(),
      '[data-metabot-count]': field(),
      '[data-bot-hero]': field(),
      '[data-hero-avatar]': field(),
      '[data-hero-name]': field(),
      '[data-hero-summary]': field(),
      '[data-hero-global-meta-id]': field(),
      '[data-hero-bot-uri]': field(),
      '[data-live-indicator]': field(),
      '[data-detail-empty]': field(),
      '[data-tab-bar]': field(),
      '[data-tab-content]': field(),
      '[data-info-content]': infoRoot,
      '[data-field="name"]': nameField,
      '[data-execution-history-list]': field(),
    },
    globals: {
      URLSearchParams,
      window: {
        location: {
          search: '?profile=alice&tab=info&focus=profile',
        },
      },
    },
    fetch: (url) => {
      calls.push(String(url));
      if (url === '/api/bot/profiles') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            data: {
              profiles: [
                { slug: 'alice', name: 'Alice', globalMetaId: 'gm-alice', allowChatSkills: [] },
              ],
            },
          }),
        });
      }
      if (url === '/api/bot/runtimes') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { runtimes: [] } }),
        });
      }
      if (url === '/api/bot/runtimes/discover') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { status: 'running', runtimes: [] } }),
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    },
  });
  context.document.querySelectorAll = (selector) => {
    if (selector === '[data-tab]') return [publicIdentityTab, behaviorTab, chatSkillsTab, servicesTab, advancedTab];
    if (selector === '[data-tab-panel]') return [publicIdentityPanel, behaviorPanel, chatSkillsPanel, servicesPanel, advancedPanel];
    return [];
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.chatSkillOptionsStatusBySlug.alice = 'loaded';

  await context.loadProfiles();
  await context.loadRuntimes();

  assert.equal(context.state.selectedSlug, 'alice');
  assert.equal(context.state.selectedTab, 'publicIdentity');
  assert.equal(focusCount, 1);
  assert.equal(scrollCount, 1);
  assert.equal(calls.includes('/api/services/skills?from=alice&allowFallbackRuntime=true'), false);
});

test('bot page runtime modal renders healthy and detected runtimes only', () => {
  const context = createBotScriptContext();

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      logoPath: '/ui/assets/platforms/codex.svg',
      binaryPath: '/bin/codex',
      version: '0.133.1',
      model: 'gpt-5.5-codex',
      authState: 'authenticated',
      health: 'healthy',
      lastSeenAt: '2026-05-22T06:00:00.000Z',
      healthCheckedAt: '2026-05-22T06:01:00.000Z',
    },
    {
      id: 'runtime-claude',
      provider: 'claude-code',
      displayName: 'Claude Code',
      logoPath: '/ui/assets/platforms/claude-code.svg',
      binaryPath: '/bin/claude',
      version: '2.0.0',
      authState: 'unknown',
      health: 'detected',
      healthReason: 'Readiness probe completed without returning output.',
      lastSeenAt: '2026-05-22T05:00:00.000Z',
      healthCheckedAt: '2026-05-22T05:01:00.000Z',
    },
    {
      id: 'runtime-openclaw',
      provider: 'openclaw',
      displayName: 'OpenClaw',
      binaryPath: '/bin/openclaw',
      health: 'unavailable',
      healthReason: 'Version probe failed.',
    },
  ];

  context.openRuntimeModal();

  const html = context.document.querySelector('[data-modal-root]').innerHTML;
  assert.match(html, /LLM Providers/);
  assert.match(html, /Codex/);
  assert.match(html, /Claude Code/);
  assert.doesNotMatch(html, /OpenClaw/);
  assert.match(html, /\/bin\/codex/);
  assert.match(html, /0\.133\.1/);
  assert.match(html, /gpt-5\.5-codex/);
  assert.match(html, /authenticated/);
  assert.match(html, /Readiness probe completed without returning output\./);
  assert.match(html, /runtime-health-dot runtime-health-healthy/);
});

test('bot page runtime summary prefers a healthy runtime for the selected provider', () => {
  const summary = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-runtime-summary]': summary,
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'bot-60';
  context.state.profiles = [{
    slug: 'bot-60',
    name: 'bot-60',
    primaryProvider: 'codex',
    fallbackProvider: 'cursor',
  }];
  context.state.runtimes = [
    {
      id: 'llm_codex_/Applications/Codex.app/Contents/Resources/codex',
      provider: 'codex',
      displayName: 'Codex (OpenAI)',
      binaryPath: '/Applications/Codex.app/Contents/Resources/codex',
      version: '0.142.2',
      health: 'unavailable',
    },
    {
      id: 'llm_codex_/opt/homebrew/bin/codex',
      provider: 'codex',
      displayName: 'Codex (OpenAI)',
      binaryPath: '/opt/homebrew/bin/codex',
      version: '0.135.0',
      health: 'healthy',
    },
    {
      id: 'llm_cursor_/Users/tusm/.local/bin/cursor-agent',
      provider: 'cursor',
      displayName: 'Cursor Agent',
      binaryPath: '/Users/tusm/.local/bin/cursor-agent',
      health: 'healthy',
    },
  ];

  context.renderRuntimeSummary();

  assert.match(summary.innerHTML, /Codex \(OpenAI\)/);
  assert.match(summary.innerHTML, /codex · healthy · v0\.135\.0/);
  assert.doesNotMatch(summary.innerHTML, /codex · unavailable · v0\.142\.2/);
});

test('bot page runtime Test action updates healthy state and refreshes related views', async () => {
  const response = deferred();
  const requests = [];
  const context = createBotScriptContext({
    fetch: (url, options) => {
      requests.push({ url, options });
      return Promise.resolve({
        ok: true,
        json: () => response.promise,
      });
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  let renderStatsCount = 0;
  let renderListCount = 0;
  let renderTabCount = 0;
  context.renderStats = () => { renderStatsCount += 1; };
  context.renderMetabotList = () => { renderListCount += 1; };
  context.renderCurrentTab = () => { renderTabCount += 1; };
  context.state._runtimeModalOpen = true;
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      binaryPath: '/bin/codex',
      health: 'detected',
    },
  ];

  const promise = context.testRuntime('runtime-codex');
  assert.equal(requests[0].url, '/api/bot/runtimes/runtime-codex/test');
  assert.equal(requests[0].options.method, 'POST');
  assert.match(context.document.querySelector('[data-modal-root]').innerHTML, /Testing\.\.\./);
  assert.match(context.document.querySelector('[data-modal-root]').innerHTML, /disabled/);

  response.resolve({
    ok: true,
    data: {
      runtime: {
        id: 'runtime-codex',
        provider: 'codex',
        displayName: 'Codex',
        binaryPath: '/bin/codex',
        health: 'healthy',
      },
      runtimes: [
        {
          id: 'runtime-codex',
          provider: 'codex',
          displayName: 'Codex',
          binaryPath: '/bin/codex',
          health: 'healthy',
        },
      ],
    },
  });
  await promise;

  assert.equal(context.state.runtimes[0].health, 'healthy');
  assert.match(context.document.querySelector('[data-modal-root]').innerHTML, /runtime-health-dot runtime-health-healthy/);
  assert.equal(renderStatsCount, 1);
  assert.equal(renderListCount, 1);
  assert.equal(renderTabCount, 1);
});

test('bot page runtime Test action keeps readiness failures out of provider pickers', async () => {
  const context = createBotScriptContext({
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          runtime: {
            id: 'runtime-codex',
            provider: 'codex',
            displayName: 'Codex',
            binaryPath: '/bin/codex',
            health: 'detected',
            healthReason: 'Readiness probe completed without returning output.',
          },
        },
      }),
    }),
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.renderStats = () => {};
  context.renderMetabotList = () => {};
  context.renderCurrentTab = () => {};
  context.state._runtimeModalOpen = true;
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      binaryPath: '/bin/codex',
      health: 'healthy',
    },
  ];

  await context.testRuntime('runtime-codex');

  assert.equal(context.state.runtimes[0].health, 'detected');
  assert.match(context.document.querySelector('[data-modal-root]').innerHTML, /Readiness probe completed without returning output\./);
  assert.doesNotMatch(context.providerPickerMarkup('primaryProvider', 'Primary Provider', 'codex', false), /data-provider-option="codex"/);
});

test('bot page local bots list marks bots with no usable primary or fallback LLM', () => {
  const list = {
    innerHTML: '',
  };
  const count = {
    textContent: '',
  };
  const context = {
    document: {
      querySelector: (selector) => {
        if (selector === '[data-metabot-list]') return list;
        if (selector === '[data-metabot-count]') return count;
        return null;
      },
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.runtimes = [
    {
      id: 'runtime-codex',
      provider: 'codex',
      displayName: 'Codex',
      health: 'unavailable',
    },
    {
      id: 'runtime-claude',
      provider: 'claude-code',
      displayName: 'Claude Code',
      health: 'healthy',
    },
    {
      id: 'runtime-openclaw',
      provider: 'openclaw',
      displayName: 'OpenClaw',
      health: 'unavailable',
    },
  ];
  context.state.profiles = [
    {
      slug: 'broken-bot',
      name: 'Broken Bot',
      primaryProvider: 'codex',
    },
    {
      slug: 'empty-bot',
      name: 'Empty Bot',
      primaryProvider: null,
      fallbackProvider: null,
    },
    {
      slug: 'fallback-broken-bot',
      name: 'Fallback Broken Bot',
      primaryProvider: 'codex',
      fallbackProvider: 'openclaw',
    },
    {
      slug: 'healthy-bot',
      name: 'Healthy Bot',
      primaryProvider: 'claude-code',
    },
    {
      slug: 'fallback-healthy-bot',
      name: 'Fallback Healthy Bot',
      primaryProvider: 'codex',
      fallbackProvider: 'claude-code',
    },
  ];

  context.renderMetabotList();

  const itemHtml = (slug) => {
    const marker = `data-slug="${slug}"`;
    const markerIndex = list.innerHTML.indexOf(marker);
    assert.notEqual(markerIndex, -1, `expected item for ${slug}`);
    const start = list.innerHTML.lastIndexOf('<div class="metabot-item"', markerIndex);
    const next = list.innerHTML.indexOf('<div class="metabot-item"', markerIndex + marker.length);
    return list.innerHTML.slice(start, next === -1 ? undefined : next);
  };
  const items = Object.fromEntries(context.state.profiles.map((profile) => [profile.slug, itemHtml(profile.slug)]));
  assert.match(items['broken-bot'], /LLM NOT READY[\s\S]*Broken Bot/);
  assert.match(items['empty-bot'], /NO LLM BOUND[\s\S]*Empty Bot/);
  assert.match(items['fallback-broken-bot'], /LLM NOT READY[\s\S]*Fallback Broken Bot/);
  assert.doesNotMatch(items['healthy-bot'], /LLM NOT READY|NO LLM BOUND/);
  assert.doesNotMatch(items['fallback-healthy-bot'], /LLM NOT READY|NO LLM BOUND/);
  assert.doesNotMatch(list.innerHTML, /unavailable/i);
  assert.doesNotMatch(list.innerHTML, /runtime-codex/);
  assert.doesNotMatch(list.innerHTML, /Claude Code/);
});

test('bot page create flow shows chain progress and success without replacing the current page', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  const modal = {
    innerHTML: '',
    classList: {
      add: () => {},
      remove: () => {},
    },
  };
  fields['[data-modal="add-metabot"]'] = modal;
  let requestBody = null;
  let opened = null;
  const createResponse = deferred();
  let success = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (_url, options) => {
      requestBody = JSON.parse(options.body);
      return createResponse.promise.then(() => ({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            profile: {
              slug: 'fanny',
              name: 'Fanny',
              globalMetaId: 'gm-fanny',
            },
            chainWrites: [
              { path: '/info/name', txids: ['tx-name'] },
              { path: '/info/chatpubkey', txids: ['tx-chat'] },
            ],
          },
        }),
      }));
    },
    window: {
      location: {
        href: '/ui/bot',
      },
      open: (url, target, features) => {
        opened = { url, target, features };
      },
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.loadProfiles = () => Promise.resolve();
  context.showChainSuccessModal = (input) => {
    success = input;
  };

  const createPromise = context.createMetabot();

  assert.match(modal.innerHTML, /create-chain-modal/);
  assert.match(modal.innerHTML, /Writing to chain/);
  assert.match(modal.innerHTML, /15-30 seconds/);
  assert.doesNotMatch(modal.innerHTML, /data-act="confirm-add"/);

  createResponse.resolve();
  await createPromise;

  assert.deepEqual(requestBody, { name: 'Fanny', creationSource: 'ui' });
  assert.equal(context.state.selectedSlug, 'fanny');
  assert.equal(context.window.location.href, '/ui/bot');
  assert.equal(success, null);
  assert.match(modal.innerHTML, /Bot created/);
  assert.match(modal.innerHTML, /data-act="close-created-bot"/);
  assert.match(modal.innerHTML, /data-act="open-created-bot-homepage"/);

  context.openCreatedBotHomepage();

  assert.deepEqual(opened, {
    url: '/browser/metaid/gm-fanny',
    target: '_blank',
    features: 'noopener',
  });
});

test('bot page create success remains visible when the profile reload fails', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  const modal = {
    innerHTML: '',
    classList: {
      add: () => {},
      remove: () => {},
    },
  };
  fields['[data-modal="add-metabot"]'] = modal;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profile: {
            slug: 'fanny',
            name: 'Fanny',
            globalMetaId: 'gm-fanny',
          },
        },
      }),
    }),
    window: {
      location: {
        href: '/ui/bot',
      },
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.loadProfiles = () => Promise.reject(new Error('temporary reload failure'));
  context.showChainSuccessModal = () => {
    throw new Error('success modal should not open before redirect');
  };

  await context.createMetabot();

  assert.equal(context.window.location.href, '/ui/bot');
  assert.match(modal.innerHTML, /Bot created/);
  assert.match(modal.innerHTML, /data-act="open-created-bot-homepage"/);
});

test('bot page save flow reports chain txids in a modal instead of inline saved text', async () => {
  const fields = {
    '[data-save-status]': field(),
    '[data-act="save-info"]': field(),
    '[data-field="name"]': field('Alice Updated'),
    '[data-field="role"]': field('Original role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field(''),
  };
  let success = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        data: {
          profile: {
            slug: 'alice-bot',
            name: 'Alice Updated',
            role: 'Original role',
            soul: 'Original soul',
            goal: 'Original goal',
            primaryProvider: 'codex',
            fallbackProvider: null,
            globalMetaId: 'gm-alice',
          },
          chainWrites: [
            { path: '/info/name', txids: ['tx-save-name'] },
          ],
        },
      }),
    }),
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice', globalMetaId: 'gm-alice' }];
  context.state.originalProfile = {
    slug: 'alice-bot',
    name: 'Alice',
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'codex',
    fallbackProvider: null,
    globalMetaId: 'gm-alice',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderInfoTab = () => {};
  context.renderStats = () => {};
  context.loadStats = () => Promise.resolve();
  context.showChainSuccessModal = (input) => {
    success = input;
  };

  await context.saveInfo();

  assert.equal(fields['[data-save-status]'].textContent, 'On-chain update confirmed.');
  assert.equal(success.title, 'Profile Updated On-Chain');
  assert.deepEqual(success.chainWrites[0].txids, ['tx-save-name']);
});

test('bot page wallet and backup panels render copyable four-chain addresses, balances, and twelve mnemonic words', () => {
  const context = {
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  const walletMarkup = context.walletBodyMarkup({
    addresses: {
      btc: 'btc-address',
      mvc: 'mvc-address',
      doge: 'doge-address',
      opcat: 'opcat-address',
    },
    balances: {
      btc: { totalSatoshis: 100000000 },
      mvc: { totalSatoshis: 200000000 },
      doge: { totalSatoshis: 300000000 },
      opcat: { totalSatoshis: 400 },
    },
  });
  const backupMarkup = context.backupBodyMarkup({
    words: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '),
  });

  assert.match(walletMarkup, /BTC/);
  assert.match(walletMarkup, /btc-address/);
  assert.match(walletMarkup, /MVC/);
  assert.match(walletMarkup, /mvc-address/);
  assert.match(walletMarkup, /DOGE/);
  assert.match(walletMarkup, /doge-address/);
  assert.match(walletMarkup, /OPCAT/);
  assert.match(walletMarkup, /opcat-address/);
  assert.match(walletMarkup, /Balance: 1\.00000000 BTC/);
  assert.match(walletMarkup, /Balance: 2\.00000000 SPACE/);
  assert.match(walletMarkup, /Balance: 3\.00000000 Doge/);
  assert.match(walletMarkup, /Balance: 0\.00000400 OPCAT-BTC/);
  assert.match(walletMarkup, /data-act="copy-wallet-value"/);
  assert.equal((walletMarkup.match(/data-act="wallet-transfer"/g) || []).length, 4);
  assert.match(backupMarkup, /Write these 12 words down/);
  assert.equal((backupMarkup.match(/class="mnemonic-word"/g) || []).length, 12);
});

test('bot page wallet transfer preview blocks amounts above the local balance', async () => {
  const fields = {
    '[data-field="wallet-transfer-to"]': field('recipient-address'),
    '[data-field="wallet-transfer-amount"]': field('1.00000001'),
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-preview"]': field(),
  };
  let didFetch = false;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: () => {
      didFetch = true;
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._walletPanel = {
    addresses: { btc: 'btc-address' },
    balances: { btc: { totalSatoshis: 100000000 } },
  };
  context.openWalletTransferForm('btc');

  await context.submitWalletTransferPreview();

  assert.equal(didFetch, false);
  assert.match(fields['[data-wallet-transfer-status]'].textContent, /Amount exceeds available balance: 1\.00000000 BTC/);
  assert.match(fields['[data-wallet-transfer-status]'].className, /error/);
});

test('bot page wallet transfer preview posts the canonical route body', async () => {
  const fields = {
    '[data-field="wallet-transfer-to"]': field('recipient-address'),
    '[data-field="wallet-transfer-amount"]': field('0.25'),
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-preview"]': field(),
  };
  let request = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url, options) => {
      request = { url, body: JSON.parse(options.body) };
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { preview: { feeSatoshis: 1000 } } }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._walletPanel = {
    addresses: { mvc: 'mvc-address' },
    balances: { mvc: { totalSatoshis: 200000000 } },
  };
  context.openWalletTransferForm('mvc');
  context.openDynamicModal = () => {};

  await context.submitWalletTransferPreview();

  assert.equal(request.url, '/api/bot/profiles/alice-bot/wallet/transfer/preview');
  assert.deepEqual(request.body, { chain: 'mvc', toAddress: 'recipient-address', amount: '0.25' });
});

test('bot page wallet transfer preview renders the direct daemon confirmation shape', async () => {
  const fields = {
    '[data-field="wallet-transfer-to"]': field('D-recipient'),
    '[data-field="wallet-transfer-amount"]': field('0.01'),
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-preview"]': field(),
  };
  let confirmBody = '';
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        state: 'awaiting_confirmation',
        data: {
          fromAddress: 'doge-address',
          toAddress: 'D-recipient',
          amount: '0.01000000 DOGE',
          estimatedFee: '0.00000392 DOGE',
          chain: 'doge',
        },
      }),
    }),
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._walletPanel = {
    addresses: { doge: 'doge-address' },
    balances: { doge: { totalSatoshis: 300000000 } },
  };
  context.openWalletTransferForm('doge');
  context.openDynamicModal = (_title, body) => {
    confirmBody = body;
  };

  await context.submitWalletTransferPreview();

  assert.match(confirmBody, /0\.00000392 Doge/);
  assert.doesNotMatch(confirmBody, /0\.00000392 DOGE/);
  assert.match(confirmBody, /From Address/);
  assert.match(confirmBody, /doge-address/);
  assert.match(confirmBody, /D-recipient/);
});

test('bot page wallet transfer preview normalizes direct OPCAT daemon display units', async () => {
  const fields = {
    '[data-field="wallet-transfer-to"]': field('bc1p-recipient'),
    '[data-field="wallet-transfer-amount"]': field('0.000001'),
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-preview"]': field(),
  };
  let confirmBody = '';
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({
        ok: true,
        state: 'awaiting_confirmation',
        data: {
          fromAddress: 'opcat-address',
          toAddress: 'bc1p-recipient',
          amount: '0.00000100 OPCAT',
          estimatedFee: '0.00000050 OPCAT',
          chain: 'opcat',
        },
      }),
    }),
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._walletPanel = {
    addresses: { opcat: 'opcat-address' },
    balances: { opcat: { totalSatoshis: 100000000 } },
  };
  context.openWalletTransferForm('opcat');
  context.openDynamicModal = (_title, body) => {
    confirmBody = body;
  };

  await context.submitWalletTransferPreview();

  assert.match(confirmBody, /0\.00000100 OPCAT-BTC/);
  assert.match(confirmBody, /0\.00000050 OPCAT-BTC/);
  assert.doesNotMatch(confirmBody, /0\.00000100 OPCAT</);
  assert.doesNotMatch(confirmBody, /0\.00000050 OPCAT</);
});

test('bot page wallet transfer confirm posts the canonical route body', async () => {
  const fields = {
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-confirm"]': field(),
  };
  let request = null;
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url, options = {}) => {
      if (url.includes('/wallet/transfer/confirm')) {
        request = { url, body: JSON.parse(options.body) };
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { result: { txid: 'tx-confirmed' } } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          ok: true,
          data: {
            wallet: {
              addresses: { doge: 'doge-address' },
              balances: { doge: { totalSatoshis: 100000000 } },
            },
          },
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._sensitiveModalToken = 'wallet-transfer:alice-bot:1';
  context.state._walletPanel = {
    addresses: { doge: 'doge-address' },
    balances: { doge: { totalSatoshis: 300000000 } },
  };
  context.state._walletTransfer = {
    wallet: context.state._walletPanel,
    chain: 'doge',
    slug: 'alice-bot',
    token: 'wallet-transfer:alice-bot:1',
    toAddress: 'recipient-address',
    amount: '0.5',
    preview: { feeSatoshis: 1000 },
  };
  context.openDynamicModal = () => {};

  await context.submitWalletTransferConfirm();

  assert.equal(request.url, '/api/bot/profiles/alice-bot/wallet/transfer/confirm');
  assert.deepEqual(request.body, { chain: 'doge', toAddress: 'recipient-address', amount: '0.5' });
});

test('bot page wallet transfer confirm renders the direct daemon success shape', async () => {
  const fields = {
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-confirm"]': field(),
  };
  let successBody = '';
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url) => {
      if (url.includes('/wallet/transfer/confirm')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            ok: true,
            state: 'success',
            data: {
              txid: 'tx-real',
              explorerUrl: 'https://example.test/tx/tx-real',
              amount: '0.01000000 DOGE',
              toAddress: 'D-recipient',
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { wallet: { addresses: {}, balances: {} } } }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._sensitiveModalToken = 'wallet-transfer:alice-bot:1';
  context.state._walletTransfer = {
    chain: 'doge',
    slug: 'alice-bot',
    token: 'wallet-transfer:alice-bot:1',
    toAddress: 'D-recipient',
    amount: '0.01',
    preview: { estimatedFee: '0.00000392 DOGE' },
  };
  context.openDynamicModal = (_title, body) => {
    successBody = body;
  };

  await context.submitWalletTransferConfirm();

  assert.match(successBody, /tx-real/);
  assert.match(successBody, /0\.01000000 Doge/);
  assert.doesNotMatch(successBody, /0\.01000000 DOGE/);
});

test('bot page wallet transfer preview ignores stale async responses', async () => {
  const fields = {
    '[data-field="wallet-transfer-to"]': field('D-recipient'),
    '[data-field="wallet-transfer-amount"]': field('0.01'),
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-preview"]': field(),
  };
  let resolveJson;
  const modalBodies = [];
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: () => Promise.resolve({
      ok: true,
      json: () => new Promise((resolve) => {
        resolveJson = resolve;
      }),
    }),
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'alice-bot';
  context.state._walletPanel = {
    addresses: { doge: 'doge-address' },
    balances: { doge: { totalSatoshis: 300000000 } },
  };
  context.openWalletTransferForm('doge');
  context.openDynamicModal = (_title, body) => {
    modalBodies.push(body);
  };

  const pending = context.submitWalletTransferPreview();
  await Promise.resolve();
  context.state.selectedSlug = 'bob-bot';
  context.state._sensitiveModalToken = 'wallet-transfer:bob-bot:2';
  resolveJson({
    ok: true,
    state: 'awaiting_confirmation',
    data: {
      toAddress: 'D-recipient',
      amount: '0.01000000 DOGE',
      estimatedFee: '0.00000392 DOGE',
      chain: 'doge',
    },
  });
  await pending;

  assert.equal(modalBodies.some((body) => /Confirm Transfer/.test(body) || /0\.00000392 DOGE/.test(body)), false);
  assert.notEqual(context.state._walletTransfer?.preview?.estimatedFee, '0.00000392 DOGE');
});

test('bot page wallet transfer confirm keeps the captured profile slug', async () => {
  const fields = {
    '[data-wallet-transfer-status]': field(),
    '[data-act="wallet-transfer-confirm"]': field(),
  };
  let confirmUrl = '';
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url) => {
      if (url.includes('/wallet/transfer/confirm')) {
        confirmUrl = url;
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, state: 'success', data: { txid: 'tx-real' } }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true, data: { wallet: { addresses: {}, balances: {} } } }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'bob-bot';
  context.state._sensitiveModalToken = 'wallet-transfer:alice-bot:1';
  context.state._walletTransfer = {
    chain: 'doge',
    slug: 'alice-bot',
    token: 'wallet-transfer:alice-bot:1',
    toAddress: 'D-recipient',
    amount: '0.01',
    preview: { estimatedFee: '0.00000392 DOGE' },
  };
  context.openDynamicModal = () => {};

  await context.submitWalletTransferConfirm();

  assert.notEqual(confirmUrl, '/api/bot/profiles/bob-bot/wallet/transfer/confirm');
  assert.match(confirmUrl || '/ignored', /\/api\/bot\/profiles\/alice-bot\/wallet\/transfer\/confirm|\/ignored/);
});

test('bot page ignores stale wallet and backup responses after the sensitive modal closes', async () => {
  const fields = {
    '[data-modal-root]': {
      innerHTML: '',
      classList: {
        add: () => {},
        remove: () => {},
      },
    },
  };
  const requests = [];
  const context = {
    document: {
      querySelector: (selector) => fields[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    fetch: (url) => {
      let resolveJson;
      requests.push({
        url,
        resolve: (body) => resolveJson(body),
      });
      return Promise.resolve({
        ok: true,
        json: () => new Promise((resolve) => {
          resolveJson = resolve;
        }),
      });
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.profiles = [{ slug: 'alice-bot', name: 'Alice' }];
  context.state.selectedSlug = 'alice-bot';

  context.openWalletPanel();
  await Promise.resolve();
  context.closeDynamicModal();
  requests[0].resolve({
    ok: true,
    data: {
      wallet: {
        addresses: {
          btc: 'btc-stale',
          mvc: 'mvc-stale',
        },
      },
    },
  });
  await Promise.resolve();

  assert.doesNotMatch(fields['[data-modal-root]'].innerHTML, /btc-stale/);

  context.openBackupPanel();
  await Promise.resolve();
  context.closeDynamicModal();
  requests[1].resolve({
    ok: true,
    data: {
      backup: {
        words: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '),
      },
    },
  });
  await Promise.resolve();

  assert.doesNotMatch(fields['[data-modal-root]'].innerHTML, /abandon/);
});

test('bot page delete confirmation uses the required warning and disables confirm until countdown finishes', () => {
  const context = {
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);

  const markup = context.deleteConfirmMarkup({ name: 'Fanny', slug: 'fanny' }, 5, false);

  assert.match(markup, /Deleting this Bot will remove all local information/);
  assert.match(markup, /Please make sure you have backed up the mnemonic/);
  assert.match(markup, /Confirm Delete \(5s\)/);
  assert.match(markup, /data-act="confirm-delete" disabled/);
});


async function flushPromises(rounds = 6) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function createDiscoveryPollingHarness(runtimesResponses) {
  const intervals = [];
  const timeouts = [];
  const discoverPosts = [];
  const button = field();
  const queue = [...runtimesResponses];
  const context = createBotScriptContext({
    elements: {
      '[data-act="discover-runtimes"]': button,
    },
    globals: {
      setInterval: (fn, ms) => {
        intervals.push({ fn, ms });
        return intervals.length;
      },
      clearInterval: () => {},
      setTimeout: (fn, ms) => {
        timeouts.push({ fn, ms });
        return timeouts.length + 1000;
      },
      clearTimeout: () => {},
    },
    fetch: (url, opts) => {
      if (url === '/api/bot/runtimes/discover' && opts && opts.method === 'POST') {
        discoverPosts.push(opts.body ? JSON.parse(opts.body) : {});
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { status: 'running', runtimes: [] } }),
        });
      }
      if (url === '/api/bot/runtimes') {
        const payload = queue.length > 1 ? queue.shift() : queue[0];
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: payload }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, data: {} }) });
    },
  });
  vm.runInNewContext(buildBotPageDefinition().script, context);
  return { context, intervals, timeouts, discoverPosts, button };
}

test('bot page picker groups ready runtimes and disables detected providers with reason title', () => {
  const context = createBotScriptContext({});
  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.runtimes = [
    { id: 'rt-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' },
    { id: 'rt-workbuddy', provider: 'workbuddy', displayName: 'WorkBuddy', health: 'detected', healthReason: 'Readiness probe timed out after 30000ms.' },
  ];

  const picker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', '', false);

  const readyIndex = picker.indexOf('>Ready</div>');
  const detectedIndex = picker.indexOf('>Detected (not ready)</div>');
  assert.ok(readyIndex !== -1, 'ready group label renders');
  assert.ok(detectedIndex !== -1, 'detected group label renders');
  assert.ok(readyIndex < detectedIndex, 'ready group renders above the detected group');
  assert.match(picker, /data-provider-value="codex"/);
  assert.doesNotMatch(picker, /data-provider-value="workbuddy"/);
  assert.match(picker, /provider-option-not-ready" disabled aria-disabled="true" title="Readiness probe timed out after 30000ms\."/);
  assert.match(picker, /WorkBuddy \(not ready\)/);
});

test('bot page picker empty state distinguishes nothing discovered from detected-not-ready', () => {
  const context = createBotScriptContext({});
  vm.runInNewContext(buildBotPageDefinition().script, context);

  context.state.runtimes = [];
  let picker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', '', false);
  assert.match(picker, /No LLM runtimes discovered yet\./);

  context.state.runtimes = [
    { id: 'rt-workbuddy', provider: 'workbuddy', displayName: 'WorkBuddy', health: 'detected' },
  ];
  picker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', '', false);
  assert.match(picker, /1 runtime detected but not ready — open LLM runtimes to test\./);

  context.state.runtimes = [
    { id: 'rt-workbuddy', provider: 'workbuddy', displayName: 'WorkBuddy', health: 'detected' },
    { id: 'rt-zcode', provider: 'zcode', displayName: 'ZCode', health: 'degraded' },
  ];
  picker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', '', false);
  assert.match(picker, /2 runtimes detected but not ready — open LLM runtimes to test\./);

  context.state._runtimeDiscoveryPolling = true;
  picker = context.providerPickerMarkup('primaryProvider', 'Primary Provider', '', false);
  assert.match(picker, /Checking local LLM runtimes…/);
  assert.match(picker, /This can take up to a minute on the first run\./);
});

test('bot page sidebar splits not-bound and bound-not-ready LLM labels', () => {
  const context = createBotScriptContext({});
  vm.runInNewContext(buildBotPageDefinition().script, context);

  context.state._runtimesLoaded = false;
  context.state.runtimes = [];
  const unbound = context.noLlmLabelMarkup({ slug: 'a', primaryProvider: '', fallbackProvider: '' });
  assert.match(unbound, /NO LLM BOUND/);
  assert.match(unbound, /No Primary or Fallback LLM bound to this bot\./);

  const boundProfile = { slug: 'b', primaryProvider: 'codex' };
  assert.equal(context.noLlmLabelMarkup(boundProfile), '', 'no label before runtimes load');

  context.state._runtimesLoaded = true;
  context.state.runtimes = [{ id: 'rt-codex', provider: 'codex', displayName: 'Codex', health: 'detected' }];
  const notReady = context.noLlmLabelMarkup(boundProfile);
  assert.match(notReady, /LLM NOT READY/);
  assert.match(notReady, /Bound LLM runtimes are not ready yet\./);

  context.state.runtimes = [{ id: 'rt-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' }];
  assert.equal(context.noLlmLabelMarkup(boundProfile), '', 'no label when a bound provider is healthy');
});

test('bot page runtime summary shows a checking row while discovery runs', () => {
  const summary = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-runtime-summary]': summary,
    },
  });
  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.state.selectedSlug = 'bot-1';
  context.state.profiles = [{ slug: 'bot-1', name: 'Bot One', primaryProvider: 'workbuddy' }];
  context.state.runtimes = [{ id: 'rt-workbuddy', provider: 'workbuddy', displayName: 'WorkBuddy', health: 'detected' }];
  context.state.runtimeDiscoveryStatus = { running: true };

  context.renderRuntimeSummary();
  assert.match(summary.innerHTML, /Checking local LLM runtimes…/);
  assert.match(summary.innerHTML, /This can take up to a minute on the first run\./);

  context.state.runtimeDiscoveryStatus = { running: false };
  context.state.runtimes = [{ id: 'rt-workbuddy', provider: 'workbuddy', displayName: 'WorkBuddy', health: 'healthy' }];
  context.renderRuntimeSummary();
  assert.doesNotMatch(summary.innerHTML, /Checking local LLM runtimes…/);
});

test('bot page auto-fires one background discovery per load when nothing is healthy', async () => {
  const harness = createDiscoveryPollingHarness([
    { runtimes: [], discoveryStatus: { running: true } },
  ]);

  await harness.context.loadRuntimes();
  await flushPromises();
  assert.equal(harness.discoverPosts.length, 1);
  assert.deepEqual(harness.discoverPosts[0], { background: true });
  assert.equal(harness.context.state._runtimeDiscoveryPolling, true);

  await harness.context.loadRuntimes();
  await harness.context.loadRuntimes();
  await flushPromises();
  assert.equal(harness.discoverPosts.length, 1, 'auto discovery fires at most once per page load');
});

test('bot page does not auto-fire background discovery when a healthy runtime exists', async () => {
  const harness = createDiscoveryPollingHarness([
    { runtimes: [{ id: 'rt-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' }] },
  ]);

  await harness.context.loadRuntimes();
  await flushPromises();
  assert.equal(harness.discoverPosts.length, 0);
  assert.equal(harness.context.state._runtimeDiscoveryAutoTriggered, false);
  assert.equal(harness.context.state._runtimeDiscoveryPolling, false);
});

test('bot page manual refresh waits for the requested sweep even when another runtime is healthy', async () => {
  const harness = createDiscoveryPollingHarness([
    { runtimes: [{ id: 'rt-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' }], discoveryStatus: { running: true } },
    { runtimes: [{ id: 'rt-codex', provider: 'codex', displayName: 'Codex', health: 'healthy' }], discoveryStatus: { running: false } },
  ]);
  harness.context.state._runtimeDiscoveryAutoTriggered = true;

  harness.context.discoverRuntimes();
  await flushPromises();
  assert.equal(harness.discoverPosts.length, 1);
  assert.deepEqual(harness.discoverPosts[0], { background: true });
  assert.equal(harness.context.state._runtimeDiscoveryPolling, true);
  assert.equal(harness.button.disabled, true);
  assert.equal(harness.button.textContent, 'Refreshing...');
  assert.equal(harness.intervals.length, 1);
  assert.equal(harness.intervals[0].ms, 2000, 'polling runs every 2s');

  harness.context.discoverRuntimes();
  await flushPromises();
  assert.equal(harness.discoverPosts.length, 1, 'a manual click while polling is a no-op');

  await harness.intervals[0].fn();
  assert.equal(harness.context.state._runtimeDiscoveryPolling, false);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'Refresh Runtimes');
});

test('bot page provider modal refresh starts runtime discovery instead of only reloading stored state', async () => {
  const refreshButton = field();
  let clickHandler;
  refreshButton.addEventListener = (eventName, handler) => {
    if (eventName === 'click') clickHandler = handler;
  };
  const harness = createDiscoveryPollingHarness([
    { runtimes: [], discoveryStatus: { running: true } },
  ]);
  harness.context.document.querySelectorAll = (selector) => (
    selector === '[data-act="refresh-runtime-modal"]' ? [refreshButton] : []
  );
  harness.context.state._runtimeDiscoveryAutoTriggered = true;
  harness.context.openRuntimeModal();

  assert.equal(typeof clickHandler, 'function');
  clickHandler();
  await flushPromises();

  assert.equal(harness.discoverPosts.length, 1);
  assert.deepEqual(harness.discoverPosts[0], { background: true });
  assert.equal(harness.context.state._runtimeDiscoveryPolling, true);
});

test('bot page runtime discovery polling stops when the sweep reports not running', async () => {
  const harness = createDiscoveryPollingHarness([
    { runtimes: [], discoveryStatus: { running: true } },
    { runtimes: [{ id: 'rt-workbuddy', provider: 'workbuddy', displayName: 'WorkBuddy', health: 'detected' }], discoveryStatus: { running: false, lastFinishedAt: '2026-07-23T00:00:00.000Z' } },
  ]);
  harness.context.state._runtimeDiscoveryAutoTriggered = true;

  harness.context.discoverRuntimes();
  await flushPromises();
  assert.equal(harness.context.state._runtimeDiscoveryPolling, true);

  await harness.intervals[0].fn();
  assert.equal(harness.context.state._runtimeDiscoveryPolling, false);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'Refresh Runtimes');
});

test('bot page runtime discovery polling stops at the 60s hard timeout', async () => {
  const harness = createDiscoveryPollingHarness([
    { runtimes: [], discoveryStatus: { running: true } },
  ]);
  harness.context.state._runtimeDiscoveryAutoTriggered = true;

  harness.context.discoverRuntimes();
  await flushPromises();
  assert.equal(harness.context.state._runtimeDiscoveryPolling, true);
  const stopTimer = harness.timeouts.find((entry) => entry.ms === 60000);
  assert.ok(stopTimer, 'a 60s hard stop timer is armed');

  stopTimer.fn();
  assert.equal(harness.context.state._runtimeDiscoveryPolling, false);
  assert.equal(harness.button.disabled, false);
  assert.equal(harness.button.textContent, 'Refresh Runtimes');
});

test('bot page runtime discovery hard timeout falls back to the empty state', async () => {
  const harness = createDiscoveryPollingHarness([
    { runtimes: [], discoveryStatus: { running: true } },
  ]);
  harness.context.state._runtimeDiscoveryAutoTriggered = true;

  harness.context.discoverRuntimes();
  await flushPromises();
  assert.equal(harness.context.state._runtimeDiscoveryPolling, true);

  const stopTimer = harness.timeouts.find((entry) => entry.ms === 60000);
  assert.ok(stopTimer, 'a 60s hard stop timer is armed');
  stopTimer.fn();

  assert.equal(
    harness.context.state.runtimeDiscoveryStatus,
    null,
    'stale sweep status is cleared when polling stops',
  );
  assert.equal(harness.context.runtimeDiscoveryInProgress(), false);
  const picker = harness.context.providerPickerMarkup('primaryProvider', 'Primary Provider', '', false);
  assert.match(picker, /No LLM runtimes discovered yet\./);
  assert.doesNotMatch(picker, /Checking local LLM runtimes/);
});

test('bot page discovery rework i18n keys exist in both dictionaries', () => {
  const keys = [
    'bot.runtimeGroupReady',
    'bot.runtimeGroupDetected',
    'bot.runtimeNotReadySuffix',
    'bot.noRuntimesYet',
    'bot.detectedNotReadyOne',
    'bot.detectedNotReadyMany',
    'bot.checkingRuntimes',
    'bot.checkingRuntimesHint',
    'bot.noLlmBoundLabel',
    'bot.noLlmBoundTitle',
    'bot.llmNotReadyLabel',
    'bot.llmNotReadyTitle',
  ];
  for (const key of keys) {
    assert.notEqual(translate('en', key), key, `${key} missing from en dictionary`);
    assert.notEqual(translate('zh-CN', key), key, `${key} missing from zh-CN dictionary`);
  }
  assert.equal(
    translate('en', 'bot.detectedNotReadyMany', { count: 3 }),
    '3 runtimes detected but not ready — open LLM runtimes to test.',
  );
  assert.equal(
    translate('zh-CN', 'bot.detectedNotReadyMany', { count: 3 }),
    '已检测到 3 个运行时，但尚未就绪——请打开 LLM 运行时进行测试。',
  );
});
