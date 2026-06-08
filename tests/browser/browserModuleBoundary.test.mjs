import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const browserModule = require('../../dist/browser/index.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

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

test('Browser API route boundary handles runtime without daemon route types', async () => {
  const sent = [];
  const handled = await browserModule.handleBrowserApiRoutes({
    method: 'GET',
    url: new URL('http://127.0.0.1/api/browser/runtime?actorId=wallet-user'),
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
    readJsonBody: async () => ({}),
    sendJson: (status, payload) => sent.push({ status, payload }),
    sendMethodNotAllowed: (allowed) => sent.push({ status: 405, allowed }),
  });

  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.data.host.kind, 'standalone');
  assert.equal(sent[0].payload.data.defaultActor.id, 'wallet-user');
});
