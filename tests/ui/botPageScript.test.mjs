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

test('bot page wallet and backup panels render copyable addresses and twelve mnemonic words', () => {
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
    },
  });
  const backupMarkup = context.backupBodyMarkup({
    words: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'.split(' '),
  });

  assert.match(walletMarkup, /BTC/);
  assert.match(walletMarkup, /btc-address/);
  assert.match(walletMarkup, /MVC/);
  assert.match(walletMarkup, /mvc-address/);
  assert.match(walletMarkup, /data-act="copy-wallet-value"/);
  assert.match(backupMarkup, /Write these 12 words down/);
  assert.equal((backupMarkup.match(/class="mnemonic-word"/g) || []).length, 12);
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
