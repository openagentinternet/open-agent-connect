import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const browserModule = require('../../dist/browser/index.js');
const browserPageApp = require('../../dist/browser/app.js');
const { browserSuccess } = require('@openagentinternet/agent-browser-host-contract');

async function callBrowserRoute({ method = 'GET', path, body = {}, handlers }) {
  const sent = [];
  const handled = await browserModule.handleBrowserApiRoutes({
    method,
    url: new URL(`http://127.0.0.1${path}`),
    handlers,
    readJsonBody: async () => body,
    sendJson: (status, payload) => sent.push({ status, payload }),
    sendMethodNotAllowed: (allowed) => sent.push({ status: 405, allowed }),
  });
  return { handled, sent };
}

test('Browser module exports page rendering and API route boundary', async () => {
  assert.equal(typeof browserModule.renderBrowserPageHtml, 'function');
  assert.equal(typeof browserModule.handleBrowserApiRoutes, 'function');
  assert.equal(typeof browserModule.statusForBrowserResult, 'function');

  const html = await browserModule.renderBrowserPageHtml();

  assert.match(html, /Agent Internet Browser/);
  assert.match(html, /data-browser-shell/);
  assert.match(html, /data-browser-uri-input/);
  assert.match(html, /\/api\/browser\/runtime/);
  assert.match(html, /\/api\/browser\/actions/);
  // The default-served page must go through OAC's buildBrowserPageDefinition so
  // the bridge adapters are injected (not ABC's vanilla definition).
  assert.match(html, /oacBrowserHostAdapters/);
  assert.match(html, /oacHandleBridgeMetafileUpload/);
});

test('Browser page renders template preview images with browser-safe URLs', async () => {
  const html = await browserModule.renderBrowserPageHtml();

  assert.doesNotMatch(html, /builtin:\/\/bot-homepage\//);
  assert.match(html, /browser-template-preview/);
  assert.match(html, /data:image\/svg\+xml/);
});

test('Browser page render bakes the requested theme and defaults to light', async () => {
  const dark = await browserModule.renderBrowserPageHtml(undefined, null, { theme: 'dark' });
  assert.match(dark, /data-browser-theme="dark"/);
  assert.match(dark, /data-browser-resolved-theme="dark"/);
  assert.match(dark, /color-scheme: dark/);

  const system = await browserModule.renderBrowserPageHtml(undefined, null, { theme: 'system' });
  assert.match(system, /data-browser-theme="system"/);

  const fallback = await browserModule.renderBrowserPageHtml();
  assert.match(fallback, /data-browser-theme="light"/);
});

test('Browser module keeps exported page script English-only even for zh-CN callers', async () => {
  const definition = browserPageApp.buildBrowserPageDefinition();
  const html = await browserModule.renderBrowserPageHtml(undefined, 'zh-CN');

  assert.doesNotMatch(definition.script, /zh-CN/);
  assert.doesNotMatch(definition.script, /消息已发送|查看对话|关闭|访问主页|发送信息|复制 GlobalMetaId/);
  assert.match(definition.script, /Message sent/);
  assert.match(definition.script, /View conversation/);
  assert.match(definition.script, /Close/);

  assert.match(html, /<html lang="en"(?:\s|>)/);
  assert.doesNotMatch(html, /消息已发送|查看对话|关闭|访问主页|发送信息|复制 GlobalMetaId|创建你的第一个 Bot/);
});

test('Browser page modules consume the published ABC UI package', () => {
  const outputFiles = [
    '../../dist/browser/app.js',
    '../../dist/browser/page.js',
    '../../dist/browser/menuModel.js',
  ];

  for (const relativePath of outputFiles) {
    const contents = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.match(contents, /@openagentinternet\/agent-browser-ui\/browser/);
    assert.doesNotMatch(contents, /Browser page template not found/);
    assert.doesNotMatch(contents, /loadBrowserPageTemplate/);
  }
});

test('OAC Browser page script injects host bridge adapters for ABC gaps', () => {
  const definition = browserPageApp.buildBrowserPageDefinition();
  const script = definition.script;

  // Problem 1: host-owned file picker for metafile.upload.
  assert.match(script, /oacHandleBridgeMetafileUpload/);
  assert.match(script, /createElement\('input'\)/);
  // Problem 2: shared ABC client owns two-phase pin-write confirmation.
  assert.match(script, /submitMetaIdPinWrite/);
  assert.doesNotMatch(script, /oacHandleBridgePinWrite/);
  assert.doesNotMatch(script, /oac-pin-confirm/);
  assert.match(script, /confirmRequest\.payload/);
  // Problem 3: daemon-pushed tab opens feed ABC's client-only AgentBrowserTabs.
  assert.match(script, /\/api\/browser\/events/);
  assert.match(script, /agent-browser:open-tab/);
  assert.match(script, /AgentBrowserTabs/);
  assert.match(script, /globalThis\.EventSource/);
  // Problem 4: re-emit browser.actor.changed once runtime is ready.
  assert.match(script, /oacLoadRuntime/);
  assert.match(script, /browser\.actor\.changed/);
});

test('Browser API route boundary uses the published host contract result shape', () => {
  const contents = readFileSync(new URL('../../dist/browser/http.js', import.meta.url), 'utf8');

  assert.match(contents, /@openagentinternet\/agent-browser-host-contract/);
  assert.doesNotMatch(contents, /\.\.\/core\/contracts\/commandResult/);
});

test('Browser module output no longer exports standalone host helpers', () => {
  assert.equal(browserModule.createStandaloneBrowserHostAdapter, undefined);
  assert.equal(browserModule.createStandaloneBrowserServer, undefined);

  const contents = readFileSync(new URL('../../dist/browser/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(contents, /standalone\/adapter/);
  assert.doesNotMatch(contents, /standalone\/server/);
});

test('OAC default Browser handlers use exactly one Browser adapter', () => {
  const contents = readFileSync(new URL('../../dist/daemon/defaultHandlers.js', import.meta.url), 'utf8');

  assert.match(contents, /createOacBrowserHostAdapter/);
  assert.doesNotMatch(contents, /oacBrowserCoreBridge/);
  assert.doesNotMatch(contents, /createOacBrowserCoreHostAdapter/);
  assert.doesNotMatch(contents, /browserRuntimeToContextResult/);
});

test('OAC Browser adapter consumes published ABC packages directly', () => {
  const contents = readFileSync(new URL('../../dist/daemon/browser/oacBrowserHostAdapter.js', import.meta.url), 'utf8');

  assert.match(contents, /@openagentinternet\/agent-browser-host-contract/);
  assert.match(contents, /@openagentinternet\/agent-browser-core/);
  assert.doesNotMatch(contents, /\.\.\/\.\.\/core\/browser\//);
  assert.doesNotMatch(contents, /browser\/standalone/);
});

test('Browser page declarations keep ABC UI package subpath private', () => {
  const outputFiles = [
    '../../dist/browser/app.d.ts',
    '../../dist/browser/page.d.ts',
    '../../dist/browser/menuModel.d.ts',
  ];

  for (const relativePath of outputFiles) {
    const contents = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(contents, /@openagentinternet\/agent-browser-ui\/browser/);
  }
});

test('Browser API route boundary handles runtime without daemon route types', async () => {
  const { handled, sent } = await callBrowserRoute({
    path: '/api/browser/runtime?actorId=wallet-user',
    handlers: {
      getRuntime: async (input) => browserSuccess({
        host: { kind: 'standalone', name: 'Standalone Browser', localMode: false },
        actors: [{
          id: input.actorId,
          label: 'Wallet User',
          kind: 'wallet',
          isDefault: true,
          capabilities: [],
        }],
        defaultActor: {
          id: input.actorId,
          label: 'Wallet User',
          kind: 'wallet',
          isDefault: true,
          capabilities: [],
        },
        defaultUri: null,
        features: {
          privateChat: false,
          serviceCall: false,
          cacheManagement: false,
          templateSettings: true,
          walletLogin: false,
        },
        labels: {
          actorChip: 'Wallet',
          noActorTitle: 'No Wallet',
          noActorBody: 'Sign in to continue.',
        },
      }),
    },
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.host.kind, 'standalone');
  assert.equal(sent[0].payload.data.defaultActor.id, 'wallet-user');
});

test('Browser module output does not import OAC UI page modules', () => {
  const outputFiles = [
    '../../dist/browser/index.js',
    '../../dist/browser/page.js',
    '../../dist/browser/page.d.ts',
    '../../dist/browser/app.js',
    '../../dist/browser/app.d.ts',
  ];

  for (const relativePath of outputFiles) {
    const contents = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(contents, /ui\/pages\/browser/);
    assert.doesNotMatch(contents, /\.\.\/ui\/pages/);
  }
});

test('Browser API route boundary handles resolve without daemon route types', async () => {
  let received = null;
  const { handled, sent } = await callBrowserRoute({
    path: '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&actorId=wallet-user',
    handlers: {
      resolve: async (input) => {
        received = input;
        return browserSuccess({
          uri: input.uri,
          resource: {
            kind: 'bot-homepage',
            uri: input.uri,
            title: 'Alice Bot',
          },
          renderer: {
            kind: 'bot-homepage',
            mode: 'native',
            title: 'Alice Bot',
          },
          proof: {
            state: 'resolved',
            label: 'Resolved',
            details: [],
          },
        });
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, { uri: 'metaid://idq1alice', actorId: 'wallet-user' });
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.resource.kind, 'bot-homepage');
});

test('Browser API route boundary handles settings update without daemon route types', async () => {
  let received = null;
  const { handled, sent } = await callBrowserRoute({
    method: 'PUT',
    path: '/api/browser/settings?actorId=wallet-user',
    body: { browser: { botHomepageTemplateId: 'compact-list' } },
    handlers: {
      updateSettings: async (input) => {
        received = input;
        return browserSuccess({ browser: input.browser });
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, {
    browser: { botHomepageTemplateId: 'compact-list' },
    actorId: 'wallet-user',
  });
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.browser.botHomepageTemplateId, 'compact-list');
});

test('Browser API route boundary handles cache clear without daemon route types', async () => {
  let received = null;
  const { handled, sent } = await callBrowserRoute({
    method: 'DELETE',
    path: '/api/browser/cache?actorId=wallet-user',
    body: { scope: 'all' },
    handlers: {
      clearCache: async (input) => {
        received = input;
        return browserSuccess({ clearedArtifacts: 0, clearedPinRecords: 0, input });
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, { scope: 'all', actorId: 'wallet-user' });
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.input.actorId, 'wallet-user');
});

test('Browser API route boundary handles trusted actions without daemon route types', async () => {
  let received = null;
  const action = {
    kind: 'service-call',
    resourceUri: 'metaid://idq1alice',
    payload: {
      servicePinId: 'service-pin',
      providerGlobalMetaId: 'provider-gmid',
      userTask: 'Do it',
    },
  };
  const { handled, sent } = await callBrowserRoute({
    method: 'POST',
    path: '/api/browser/actions?actorId=wallet-user',
    body: action,
    handlers: {
      runTrustedAction: async (input) => {
        received = input;
        return browserSuccess({ action: 'noop', input });
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, { ...action, actorId: 'wallet-user' });
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.input.payload.servicePinId, 'service-pin');
});

test('Browser API route boundary uses Browser command-result semantics', async () => {
  const { handled, sent } = await callBrowserRoute({
    path: '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&from=alice',
    handlers: {
      resolve: async (input) => browserSuccess({
        uri: input.uri,
        normalizedUri: input.uri,
        resourceType: 'bot',
        title: 'Alice Bot',
        owner: {
          kind: 'bot',
          globalMetaId: 'idq1alice',
          name: 'Alice Bot',
          verificationState: 'partial',
        },
        renderer: {
          type: 'bot-page',
          contentType: 'application/vnd.oac.bot-homepage+json',
          templateId: 'document',
          data: {},
        },
        status: {
          state: 'resolved',
          verificationState: 'partial',
          message: 'Bot Page resolved.',
        },
        source: {
          resolver: 'test',
        },
        actions: [],
      }),
    },
  });

  assert.equal(handled, true);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.state, 'success');
  assert.equal(sent[0].payload.data.source.resolver, 'test');
});

test('Browser tab open POST fans out to every subscribed page and returns success', async () => {
  const delivered = [];
  const unregister = browserModule.registerBrowserTabSink((event) => delivered.push(event));
  try {
    const { handled, sent } = await callBrowserRoute({
      method: 'POST',
      path: '/api/browser/tabs/open',
      body: { uri: 'metaid://idq1alice' },
    });

    assert.equal(handled, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].status, 200);
    assert.equal(sent[0].payload.ok, true);
    assert.equal(sent[0].payload.data.uri, 'metaid://idq1alice');
    assert.equal(sent[0].payload.data.pagesReached, 1);
    assert.equal(sent[0].payload.data.note, undefined);

    // The sink received the fire-and-forget open-tab event.
    assert.deepEqual(delivered, [{ type: 'agent-browser:open-tab', uri: 'metaid://idq1alice' }]);
  } finally {
    unregister();
  }
});

test('Browser tab open POST reaches every connected page', async () => {
  const a = [];
  const b = [];
  const unA = browserModule.registerBrowserTabSink((event) => a.push(event));
  const unB = browserModule.registerBrowserTabSink((event) => b.push(event));
  try {
    const { sent } = await callBrowserRoute({
      method: 'POST',
      path: '/api/browser/tabs/open',
      body: { uri: 'metaapp://8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0' },
    });

    assert.equal(sent[0].status, 200);
    assert.equal(sent[0].payload.data.pagesReached, 2);
    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  } finally {
    unA();
    unB();
  }
});

test('Browser tab open POST with no page open reports pagesReached 0 and a note', async () => {
  // No sink registered (other tests clean theirs up).
  const { sent } = await callBrowserRoute({
    method: 'POST',
    path: '/api/browser/tabs/open',
    body: { uri: 'pin://8544d8a15126296abe36a0bad740a4f293580575b5b00d345029bf99b74c78eci0' },
  });

  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.ok, true);
  assert.equal(sent[0].payload.data.pagesReached, 0);
  assert.match(sent[0].payload.data.note, /no Browser page currently open/);
});

test('Browser tab open POST rejects missing or flag-like uri', async () => {
  const missing = await callBrowserRoute({
    method: 'POST',
    path: '/api/browser/tabs/open',
    body: {},
  });
  assert.equal(missing.sent[0].status, 400);
  assert.equal(missing.sent[0].payload.code, 'missing_uri');

  const empty = await callBrowserRoute({
    method: 'POST',
    path: '/api/browser/tabs/open',
    body: { uri: '   ' },
  });
  assert.equal(empty.sent[0].status, 400);
  assert.equal(empty.sent[0].payload.code, 'missing_uri');

  const flagLike = await callBrowserRoute({
    method: 'POST',
    path: '/api/browser/tabs/open',
    body: { uri: '--uri' },
  });
  assert.equal(flagLike.sent[0].status, 400);
  assert.equal(flagLike.sent[0].payload.code, 'invalid_browser_uri');
});

test('Browser tab open route rejects non-POST methods', async () => {
  const { handled, sent } = await callBrowserRoute({
    method: 'GET',
    path: '/api/browser/tabs/open',
  });
  assert.equal(handled, true);
  assert.equal(sent[0].status, 405);
});
