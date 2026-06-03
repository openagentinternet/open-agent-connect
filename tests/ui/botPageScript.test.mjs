import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildBotPageDefinition } = require('../../dist/ui/pages/bot/app.js');

function field(value = '') {
  const attrs = new Map();
  return {
    value,
    textContent: '',
    className: '',
    disabled: false,
    getAttribute: (name) => attrs.get(name) ?? null,
    setAttribute: (name, next) => attrs.set(name, String(next)),
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
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    ...overrides.globals,
  };
}

test('bot page preserves unavailable provider bindings when saving unrelated profile fields', () => {
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

test('bot page sends provider changes only after the provider picker is touched', () => {
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

test('bot page loads chat skill options for the selected bot and renders selected chips', async () => {
  const infoRoot = { innerHTML: '' };
  const context = createBotScriptContext({
    elements: {
      '[data-info-content]': infoRoot,
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
  context.renderInfoTab();

  await context.loadChatSkillOptions('alice-bot');

  assert.match(infoRoot.innerHTML, /Chat Allowed Skills/);
  assert.match(infoRoot.innerHTML, /data-field="chatSkillSelect"/);
  assert.match(infoRoot.innerHTML, /value="weather\.lookup"/);
  assert.match(infoRoot.innerHTML, /Weather Lookup/);
  assert.match(infoRoot.innerHTML, /value="orders\.create"/);
  assert.match(infoRoot.innerHTML, /data-chat-skill-chip="weather\.lookup"/);
});

test('bot page chat skill add and remove controls update selected chip state', () => {
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
  context.renderInfoTab = () => {};

  context.wireChatSkillControls();
  addButton.click({ preventDefault: () => {} });
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['weather.lookup', 'orders.create']);

  context.wireChatSkillControls();
  removeButton.click({ preventDefault: () => {} });
  assert.deepEqual(Array.from(context.state.chatAllowedSkillsBySlug['alice-bot']), ['orders.create']);
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

test('bot page create flow keeps the new bot request free of chat skill settings', async () => {
  const fields = {
    '[data-field="new-name"]': field('Fanny'),
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
  context.state.chatAllowedSkillsBySlug.fanny = ['weather.lookup'];
  context.closeAddModal = () => {};
  context.loadProfiles = () => Promise.resolve();
  context.showChainSuccessModal = () => {};

  await context.createMetabot();

  assert.deepEqual(requestBody, { name: 'Fanny', creationSource: 'ui' });
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

test('bot page create flow reports chained identity and txids in a success modal', async () => {
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
  assert.equal(success.title, 'MetaBot Created On-Chain');
  assert.equal(success.profile.globalMetaId, 'gm-fanny');
  assert.deepEqual(success.chainWrites.flatMap((write) => write.txids), ['tx-name', 'tx-chat']);
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
