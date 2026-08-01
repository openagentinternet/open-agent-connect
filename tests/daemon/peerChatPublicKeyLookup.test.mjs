import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  lookupPeerChatPublicKey,
  fetchPeerChatPublicKey,
} = require('../../dist/daemon/defaultHandlers.js');

const CHAT_PUBLIC_KEY = '046671c57d5bb3352a6ea84a01f7edf8afd3c8c3d4d1a281fd1b20fdba14d05c367c69fea700da308cf96b1aedbcb113fca7c187147cfeba79fb11f3b085d893cf';
const GLOBAL_META_ID = 'idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz';

async function withMockedFetch(mockFetch, run) {
  const originalFetch = global.fetch;
  global.fetch = mockFetch;
  try {
    await run();
  } finally {
    global.fetch = originalFetch;
  }
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, statusText: status === 200 ? 'OK' : 'Error', json: async () => body };
}

test('lookupPeerChatPublicKey classifies all-unreachable endpoints as unreachable and preserves upstream errors', async () => {
  await withMockedFetch(async () => {
    throw new Error('ECONNRESET: socket hang up');
  }, async () => {
    const outcome = await lookupPeerChatPublicKey(GLOBAL_META_ID);
    assert.equal(outcome.status, 'unreachable');
    assert.ok(outcome.errors.length > 0, 'preserves at least one upstream error');
    assert.ok(outcome.errors.some((e) => e.includes('ECONNRESET')), 'error message is the real upstream error');
  });
});

test('lookupPeerChatPublicKey treats reachable endpoints with no chatpubkey as absent', async () => {
  await withMockedFetch(async () => jsonResponse({ data: { name: 'AI_Sunny' } }), async () => {
    const outcome = await lookupPeerChatPublicKey(GLOBAL_META_ID);
    assert.equal(outcome.status, 'absent');
  });
});

test('lookupPeerChatPublicKey returns found when the first endpoint carries a chatpubkey', async () => {
  await withMockedFetch(async () => jsonResponse({ data: { chatpubkey: CHAT_PUBLIC_KEY } }), async () => {
    const outcome = await lookupPeerChatPublicKey(GLOBAL_META_ID);
    assert.equal(outcome.status, 'found');
    assert.equal(outcome.chatPublicKey, CHAT_PUBLIC_KEY);
  });
});

test('lookupPeerChatPublicKey falls back to so.metaid.io when the primary endpoints fail', async () => {
  let calls = 0;
  await withMockedFetch(async (url) => {
    calls += 1;
    const urlString = String(url);
    // First endpoints (file/manapi/chain) fail with a transport error.
    if (!urlString.includes('so.metaid.io')) {
      throw new Error('TLS handshake failed');
    }
    // The so.metaid.io fallback answers with the key.
    return jsonResponse({ data: { chatpubkey: CHAT_PUBLIC_KEY } });
  }, async () => {
    const outcome = await lookupPeerChatPublicKey(GLOBAL_META_ID);
    assert.equal(outcome.status, 'found');
    assert.equal(outcome.chatPublicKey, CHAT_PUBLIC_KEY);
    assert.ok(calls > 1, 'more than one endpoint was attempted');
  });
});

test('lookupPeerChatPublicKey classifies mixed non-OK HTTP responses as unreachable', async () => {
  await withMockedFetch(async () => jsonResponse({ data: {} }, 503), async () => {
    const outcome = await lookupPeerChatPublicKey(GLOBAL_META_ID);
    assert.equal(outcome.status, 'unreachable');
    assert.ok(outcome.errors.some((e) => e.includes('503')), 'records the HTTP status');
  });
});

test('lookupPeerChatPublicKey prefers a reached endpoint (absent) over earlier transport errors', async () => {
  let first = true;
  await withMockedFetch(async () => {
    if (first) { first = false; throw new Error('ECONNRESET'); }
    return jsonResponse({ data: { name: 'AI_Sunny' } });
  }, async () => {
    const outcome = await lookupPeerChatPublicKey(GLOBAL_META_ID);
    assert.equal(outcome.status, 'absent');
  });
});

test('fetchPeerChatPublicKey keeps the string|null contract, returning the key only when found', async () => {
  await withMockedFetch(async () => jsonResponse({ data: { chatpubkey: CHAT_PUBLIC_KEY } }), async () => {
    assert.equal(await fetchPeerChatPublicKey(GLOBAL_META_ID), CHAT_PUBLIC_KEY);
  });
});

test('fetchPeerChatPublicKey returns null for both absent and unreachable outcomes', async () => {
  await withMockedFetch(async () => {
    throw new Error('ECONNRESET');
  }, async () => {
    assert.equal(await fetchPeerChatPublicKey(GLOBAL_META_ID), null);
  });
  await withMockedFetch(async () => jsonResponse({ data: {} }), async () => {
    assert.equal(await fetchPeerChatPublicKey(GLOBAL_META_ID), null);
  });
});

test('lookupPeerChatPublicKey returns absent for an empty globalMetaId', async () => {
  await withMockedFetch(async () => {
    assert.fail('fetch should not be called for an empty id');
  }, async () => {
    const outcome = await lookupPeerChatPublicKey('');
    assert.equal(outcome.status, 'absent');
  });
});
