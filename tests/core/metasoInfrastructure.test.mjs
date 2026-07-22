import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_METASO_P2P_BASE_URL,
  resolveMetasoInfrastructureEndpoints,
} from '../../dist/core/network/metasoInfrastructure.js';

test('Metaso infrastructure defaults resolve every chat and presence endpoint from so.metaid.io', () => {
  assert.equal(DEFAULT_METASO_P2P_BASE_URL, 'https://so.metaid.io');
  assert.deepEqual(resolveMetasoInfrastructureEndpoints(), {
    metasoP2PBaseUrl: 'https://so.metaid.io',
    chatApiBaseUrl: 'https://so.metaid.io/chat-api/group-chat',
    socketPresenceApiBaseUrl: 'https://so.metaid.io/chat-api',
    socket: {
      url: 'wss://so.metaid.io',
      path: '/socket/socket.io',
    },
  });
});

test('Metaso infrastructure preserves reverse-proxy paths for every derived endpoint', () => {
  assert.deepEqual(resolveMetasoInfrastructureEndpoints('http://localhost:9000/metaso/'), {
    metasoP2PBaseUrl: 'http://localhost:9000/metaso',
    chatApiBaseUrl: 'http://localhost:9000/metaso/chat-api/group-chat',
    socketPresenceApiBaseUrl: 'http://localhost:9000/metaso/chat-api',
    socket: {
      url: 'ws://localhost:9000',
      path: '/metaso/socket/socket.io',
    },
  });
});
