import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBotPageDefinition } = require('../../dist/ui/pages/bot/app.js');

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
      querySelectorAll: () => [],
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

test('bot page saveBehavior preserves unavailable provider bindings when saving unrelated behavior fields', () => {
  const behaviorFields = {
    '[data-save-status]': field(),
    '[data-act="save-behavior"]': field(),
    '[data-field="role"]': field('New role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': field(''),
    '[data-field="fallbackProvider"]': field(''),
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

test('bot page saveBehavior sends provider changes only after the provider picker is touched', () => {
  const primary = field('codex');
  primary.setAttribute('data-provider-touched', '1');
  const fallback = field('');
  fallback.setAttribute('data-provider-touched', '1');
  const behaviorFields = {
    '[data-save-status]': field(),
    '[data-act="save-behavior"]': field(),
    '[data-field="role"]': field('Original role'),
    '[data-field="soul"]': field('Original soul'),
    '[data-field="goal"]': field('Original goal'),
    '[data-field="primaryProvider"]': primary,
    '[data-field="fallbackProvider"]': fallback,
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
    role: 'Original role',
    soul: 'Original soul',
    goal: 'Original goal',
    primaryProvider: 'openclaw',
    fallbackProvider: 'gemini',
  };
  context.renderMetabotList = () => {};
  context.renderDetailHeader = () => {};
  context.renderBehaviorTab = () => {};
  context.showChainSuccessModal = () => {};

  context.saveBehavior();

  assert.deepEqual(requestBody, {
    primaryProvider: 'codex',
    fallbackProvider: null,
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
    '[data-field="primaryProvider"]': field('codex'),
    '[data-field="fallbackProvider"]': field('openclaw'),
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
  assert.doesNotMatch(primaryPicker, /data-provider-icon="claude-code"/);
  assert.match(primaryPicker, /data-provider-value="codex"[^>]*selected/);
  assert.doesNotMatch(primaryPicker, /data-provider-icon="openclaw"/);
  assert.match(fallbackPicker, /data-provider-option="none"/);
  assert.match(fallbackPicker, /<img src="\/ui\/assets\/platforms\/generic\.svg" alt="" loading="lazy" \/>/);
  assert.doesNotMatch(fallbackPicker, /data-provider-icon="claude-code"/);
  assert.doesNotMatch(fallbackPicker, /data-provider-icon="openclaw"/);
});

test('bot page renders the launch create flow and empty state in Simplified Chinese', () => {
  const list = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-metabot-list]': list,
    },
    window: {
      __oacLocalUiI18n: {
        getLanguage: () => 'zh-CN',
      },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);

  const createMarkup = context.createModalMarkup();
  assert.match(createMarkup, /创建 Bot/);
  assert.match(createMarkup, /上传头像/);
  assert.match(createMarkup, /Bot 名称/);
  assert.match(createMarkup, /简介/);
  assert.match(createMarkup, /取消/);

  context.renderMetabotList();
  assert.match(list.innerHTML, /还没有 Bot/);
});

test('bot page uses Simplified Chinese create validation and progress copy', () => {
  const status = field();
  const confirm = field();
  const fields = {
    '[data-field="new-name"]': field(''),
    '[data-field="new-bio"]': field(''),
    '[data-add-status]': status,
    '[data-act="confirm-add"]': confirm,
  };
  const context = createBotScriptContext({
    elements: fields,
    window: {
      __oacLocalUiI18n: {
        getLanguage: () => 'zh-CN',
      },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.createMetabot();

  assert.equal(status.textContent, '请输入 Bot 名称');
  assert.equal(status.className, 'save-status error');

  fields['[data-field="new-name"]'].value = 'Alice Bot';
  context.api = () => new Promise(() => {});
  context.createMetabot();

  assert.equal(status.textContent, '正在创建...');
  assert.equal(status.className, 'save-status saving');
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
      assert.equal(url, '/api/services/skills?from=alice-bot');
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

  assert.match(root.innerHTML, /Chat Skills/);
  assert.match(root.innerHTML, /private conversation replies/i);
  assert.match(root.innerHTML, /data-field="chatSkillSelect"/);
  assert.match(root.innerHTML, /data-act="add-chat-skill"/);
  assert.match(root.innerHTML, /value="weather\.lookup"/);
  assert.match(root.innerHTML, /Weather Lookup/);
  assert.match(root.innerHTML, /value="orders\.create"/);
  assert.match(root.innerHTML, /data-chat-skill-chip="weather\.lookup"/);
  assert.doesNotMatch(root.innerHTML, /Publish Service/);
  assert.doesNotMatch(root.innerHTML, /marketplace/i);
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

test('bot page renders public identity tab with only public identity controls', () => {
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
  }];

  context.renderPublicIdentityTab();

  assert.match(root.innerHTML, /Bot Name/);
  assert.match(root.innerHTML, /Upload \/ Replace/);
  assert.match(root.innerHTML, /data-act="upload-avatar"/);
  assert.match(root.innerHTML, /data-act="remove-avatar"/);
  assert.match(root.innerHTML, /Public Bio/);
  assert.match(root.innerHTML, /Homepage/);
  assert.match(root.innerHTML, /Default Bot Page renderer/);
  assert.match(root.innerHTML, /data-act="upload-homepage"/);
  assert.match(root.innerHTML, /Save Public Identity/);
  assert.match(root.innerHTML, /Reset/);
  assert.match(root.innerHTML, /data-field="name"/);
  assert.match(root.innerHTML, /data-field="bio"/);
  assert.doesNotMatch(root.innerHTML, /MetaApp/i);
  assert.doesNotMatch(root.innerHTML, /PINID/i);
  assert.doesNotMatch(root.innerHTML, /data-field="role"/);
  assert.doesNotMatch(root.innerHTML, /data-field="soul"/);
  assert.doesNotMatch(root.innerHTML, /data-field="goal"/);
  assert.doesNotMatch(root.innerHTML, /data-field="primaryProvider"/);
  assert.doesNotMatch(root.innerHTML, /data-field="fallbackProvider"/);
  assert.doesNotMatch(root.innerHTML, /data-field="chatSkillSelect"/);
  assert.doesNotMatch(root.innerHTML, /Chat Allowed Skills/);
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
  assert.match(root.innerHTML, /Primary LLM Provider/);
  assert.match(root.innerHTML, /Fallback LLM Provider/);
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

test('bot page public identity tab is not replaced when chat skill options load', async () => {
  const root = { innerHTML: '' };
  let renderInfoCalls = 0;
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': root,
    },
    fetch: (url) => {
      assert.equal(url, '/api/services/skills?from=alice');
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
  assert.match(root.innerHTML, /Save Public Identity/);
  assert.doesNotMatch(root.innerHTML, /data-field="role"/);
  assert.doesNotMatch(root.innerHTML, /data-field="primaryProvider"/);
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

test('bot page homepage upload opens a default renderer placeholder modal', () => {
  const context = createBotScriptContext();

  vm.runInNewContext(buildBotPageDefinition().script, context);

  context.openHomepageUploadPlaceholder();

  const modal = context.document.querySelector('[data-modal-root]');
  assert.match(modal.innerHTML, /Default Bot Page renderer/);
  assert.match(modal.innerHTML, /homepage package upload will be available later/i);
  assert.doesNotMatch(modal.innerHTML, /MetaApp/i);
  assert.doesNotMatch(modal.innerHTML, /PINID/i);
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

test('bot page create flow sends only public identity fields', async () => {
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
    bio: 'Builds with Codex.',
    avatarDataUrl: 'data:image/png;base64,...',
    creationSource: 'ui',
  });
  for (const key of [
    'primaryProvider',
    'fallbackProvider',
    'privateChat',
    'autoReply',
    'role',
    'soul',
    'goal',
    'allowChatSkills',
  ]) {
    assert.equal(Object.hasOwn(requestBody, key), false, `request body should omit ${key}`);
  }
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
  assert.match(modal.innerHTML, /data-field="new-avatar-file"/);
  assert.match(modal.innerHTML, /data-field="new-bio"/);
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
  assert.equal(calls.includes('/api/services/skills?from=bob'), false);
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
  assert.match(settingsRoot.innerHTML, /<option value="opcat" selected>OPCAT<\/option>/);
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
  assert.match(settingsRoot.innerHTML, /<option value="doge" selected>DOGE<\/option>/);
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
  assert.equal(calls.includes('/api/services/skills?from=alice'), false);
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
      if (url === '/api/services/skills?from=alice') {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ok: true, data: { skills: [] } }),
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
  assert.equal(calls.includes('/api/services/skills?from=alice'), false);
});

test('bot page create avatar upload clears a previous pending avatar after an oversized file', () => {
  const preview = { innerHTML: '' };
  const removeButton = field();
  removeButton.hidden = false;
  const status = field();
  const fields = {
    '[data-field="new-name"]': field('Alice'),
    '[data-create-avatar-preview]': preview,
    '[data-act="remove-create-avatar"]': removeButton,
    '[data-create-avatar-status]': status,
  };
  const context = createBotScriptContext({
    elements: fields,
    globals: {
      FileReader: class {
        readAsDataURL() {
          this.result = 'data:image/png;base64,valid';
          this.onload();
        }
      },
    },
  });

  vm.runInNewContext(buildBotPageDefinition().script, context);

  context.handleCreateAvatarUpload({ size: 1024 });
  assert.equal(context.state._pendingCreateAvatar, 'data:image/png;base64,valid');
  assert.equal(removeButton.hidden, false);
  assert.match(preview.innerHTML, /data:image\/png;base64,valid/);

  context.handleCreateAvatarUpload({ size: (200 * 1024) + 1 });

  assert.equal(context.state._pendingCreateAvatar, undefined);
  assert.equal(removeButton.hidden, true);
  assert.doesNotMatch(preview.innerHTML, /data:image\/png;base64,valid/);
  assert.equal(status.textContent, 'Avatar must be 200KB or smaller.');
  assert.equal(status.className, 'save-status error');
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

test('bot page marks profiles whose primary LLM is unavailable in the list', () => {
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
  ];
  context.state.profiles = [
    {
      slug: 'broken-bot',
      name: 'Broken Bot',
      primaryProvider: 'codex',
    },
    {
      slug: 'healthy-bot',
      name: 'Healthy Bot',
      primaryProvider: 'claude-code',
    },
  ];

  context.renderMetabotList();

  assert.match(list.innerHTML, /Broken Bot[\s\S]*\[LLM unavailable\]/);
  assert.doesNotMatch(list.innerHTML, /Healthy Bot[\s\S]*\[LLM unavailable\]/);
});

test('bot page create flow navigates to the Bot Page when the created profile has a GlobalMetaID', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
  let requestBody = null;
  let success = null;
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
              globalMetaId: 'gm-fanny',
            },
            chainWrites: [
              { path: '/info/name', txids: ['tx-name'] },
              { path: '/info/chatpubkey', txids: ['tx-chat'] },
            ],
          },
        }),
      });
    },
    window: {
      location: {
        href: '',
      },
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.closeAddModal = () => {};
  context.loadProfiles = () => Promise.resolve();
  context.showChainSuccessModal = (input) => {
    success = input;
  };

  await context.createMetabot();

  assert.deepEqual(requestBody, { name: 'Fanny', creationSource: 'ui' });
  assert.equal(context.state.selectedSlug, 'fanny');
  assert.equal(context.window.location.href, '/browser/metaid/gm-fanny');
  assert.equal(success, null);
});

test('bot page create flow redirects with a GlobalMetaID without waiting for profile reload', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
    '[data-add-status]': field(),
    '[data-act="confirm-add"]': field(),
  };
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
        href: '',
      },
    },
  };

  vm.runInNewContext(buildBotPageDefinition().script, context);
  context.closeAddModal = () => {};
  context.loadProfiles = () => Promise.reject(new Error('temporary reload failure'));
  context.showChainSuccessModal = () => {
    throw new Error('success modal should not open before redirect');
  };

  await context.createMetabot();

  assert.equal(context.window.location.href, '/browser/metaid/gm-fanny');
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

  assert.match(markup, /Deleting this MetaBot will remove all local information/);
  assert.match(markup, /Please make sure you have backed up the mnemonic/);
  assert.match(markup, /Confirm Delete \(5s\)/);
  assert.match(markup, /data-act="confirm-delete" disabled/);
});
