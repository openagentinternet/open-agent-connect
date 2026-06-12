import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const browserModule = require('../../dist/browser/index.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

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
});

test('Browser page renders template preview images with browser-safe URLs', async () => {
  const html = await browserModule.renderBrowserPageHtml();

  assert.doesNotMatch(html, /builtin:\/\/bot-homepage\//);
  assert.match(html, /browser-template-preview/);
  assert.match(html, /data:image\/svg\+xml/);
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
      getRuntime: async (input) => commandSuccess({
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
        return commandSuccess({
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
        return commandSuccess({ browser: input.browser });
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
        return commandSuccess({ clearedArtifacts: 0, clearedPinRecords: 0, input });
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
        return commandSuccess({ action: 'noop', input });
      },
    },
  });

  assert.equal(handled, true);
  assert.deepEqual(received, { ...action, actorId: 'wallet-user' });
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.input.payload.servicePinId, 'service-pin');
});

test('OAC Browser route boundary still uses OAC command-result semantics', async () => {
  const { handled, sent } = await callBrowserRoute({
    path: '/api/browser/resolve?uri=metaid%3A%2F%2Fidq1alice&from=alice',
    handlers: {
      resolve: async (input) => commandSuccess({
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
