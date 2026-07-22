import assert from 'node:assert/strict';
import test from 'node:test';

import { handleBundledMetaAppRoutes } from '../../dist/daemon/routes/uiMetaApps.js';

test('bundled Chat entry receives Metaso-derived HTTP and Socket endpoints for the selected actor', async () => {
  let response = null;
  let requestedActorId = null;
  const handled = await handleBundledMetaAppRoutes({
    url: new URL('http://127.0.0.1:62860/ui/chat?from=alice'),
    req: { method: 'GET' },
    handlers: {
      browser: {
        getSettings: async ({ actorId }) => {
          requestedActorId = actorId;
          return {
            ok: true,
            state: 'success',
            data: {
              browser: {
                metasoP2PBaseUrl: 'https://metaso.example.test/proxy',
              },
            },
          };
        },
      },
    },
    sendMethodNotAllowed: () => {},
    sendJson: () => {},
    sendHtml: (status, html) => {
      response = { status, html };
    },
    sendText: () => {},
  });

  assert.equal(handled, true);
  assert.equal(requestedActorId, 'alice');
  assert.equal(response?.status, 200);
  assert.match(response.html, /window\.__OAC_INFRASTRUCTURE__/);
  assert.match(response.html, /https:\/\/metaso\.example\.test\/proxy\/chat-api\/group-chat/);
  assert.match(response.html, /wss:\/\/metaso\.example\.test/);
  assert.match(response.html, /\/proxy\/socket\/socket\.io/);
});
