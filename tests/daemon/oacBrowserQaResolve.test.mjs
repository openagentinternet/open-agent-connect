import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const {
  createOacBrowserHostAdapter,
  tryResolveQaQuestionResource,
} = require('../../dist/daemon/browser/oacBrowserHostAdapter.js');
const { createMetabotProfileFromIdentity } = require('../../dist/core/bot/metabotProfileManager.js');
const { createMetaAppPreviewSessionRegistry } = require('../../dist/core/metaapp/previewSessions.js');

const QUESTION_PIN = '2bd3c7cf6c04c22cbb2d95404b946264c22b5ea98036a5c3c477ae11db3ffb77i0';
const OTHER_PIN = '3bd3c7cf6c04c22cbb2d95404b946264c22b5ea98036a5c3c477ae11db3ffb77i0';

function questionEnvelope() {
  return {
    code: 0,
    message: 'ok',
    data: {
      question: {
        pinId: QUESTION_PIN,
        currentPinId: QUESTION_PIN,
        chainName: 'mvc',
        title: 'How do I recover a wallet?',
        summary: 'summary',
        tags: ['wallet'],
        contentType: 'text/markdown',
        publisher: { globalMetaId: 'idq1asker', metaId: 'metaid-a', name: 'Asker', avatar: '' },
        createdAt: 1757200000,
        isMempool: false,
        likeCount: 3,
        dislikeCount: 1,
        commentCount: 0,
        answerCount: 2,
        topAnswer: null,
      },
      answers: [],
      nextCursor: null,
      hasMore: false,
    },
  };
}

function stubFetch(handler) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const body = await handler(String(url));
    return { status: 200, json: async () => body };
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test('probe: a simplequestion pin resolves to the bundled qanda viewer resource', async () => {
  const fetchStub = stubFetch(() => questionEnvelope());
  try {
    const result = await tryResolveQaQuestionResource(`pin://${QUESTION_PIN}`, 'https://so.example.test');
    assert.equal(result.ok, true);
    assert.equal(result.state, 'success');
    const resource = result.data;
    assert.equal(resource.resourceType, 'metaapp');
    assert.equal(resource.title, 'How do I recover a wallet?');
    assert.equal(resource.normalizedUri, `pin://${QUESTION_PIN}`);
    assert.equal(resource.renderer.type, 'html-iframe');
    assert.equal(resource.renderer.url, `/ui/qanda/app/index.html#q/${QUESTION_PIN}`);
    assert.equal(resource.owner.kind, 'metaapp-publisher');
    assert.equal(resource.owner.globalMetaId, 'idq1asker');
    assert.equal(resource.proof.protocolPath, '/protocols/simplequestion');
    assert.equal(resource.proof.details.answerCount, 2);
    assert.equal(resource.status.state, 'resolved');
    assert.deepEqual(
      resource.actions.map((action) => ({ id: action.id, kind: action.kind, uri: action.uri })),
      [{ id: 'copy-uri', kind: 'copy', uri: `pin://${QUESTION_PIN}` }],
    );
    assert.equal(resource.source.resolver, 'oac-qanda');
    assert.ok(fetchStub.calls[0].startsWith('https://so.example.test/api/qa/questions/'), 'honors the metaso base');
  } finally {
    fetchStub.restore();
  }
});

test('probe: non-pin URIs never fetch; definitive negatives are cached, outages are not', async () => {
  const fetchStub = stubFetch((url) => {
    if (url.includes(QUESTION_PIN)) return questionEnvelope();
    if (url.includes(OTHER_PIN)) return { code: 40400, data: null, message: 'not a question' };
    return { code: 50000, data: null, message: 'boom' };
  });
  try {
    assert.equal(await tryResolveQaQuestionResource('metaid://idq1asker'), null);
    assert.equal(await tryResolveQaQuestionResource('metaapp://pin'), null);
    assert.equal(await tryResolveQaQuestionResource(QUESTION_PIN), null, 'bare pinId without scheme does not probe');
    assert.equal(fetchStub.calls.length, 0);

    // Outage pin: falls through, re-probed next time (positives not cached either).
    const outagePin = '4' + 'c'.repeat(63) + 'i0';
    assert.equal(await tryResolveQaQuestionResource(`pin://${outagePin}`), null);
    assert.equal(await tryResolveQaQuestionResource(`pin://${outagePin}`), null);
    assert.equal(fetchStub.calls.filter((url) => url.includes(outagePin)).length, 2, 'indeterminate failures re-probe');

    // Definitive negative: cached after the first 40400.
    assert.equal(await tryResolveQaQuestionResource(`pin://${OTHER_PIN}`), null);
    assert.equal(await tryResolveQaQuestionResource(`pin://${OTHER_PIN}`), null);
    assert.equal(fetchStub.calls.filter((url) => url.includes(OTHER_PIN)).length, 1, '40400 cached');

    // Positives are NOT cached — a re-open re-fetches fresh counts.
    await tryResolveQaQuestionResource(`pin://${QUESTION_PIN}`);
    await tryResolveQaQuestionResource(`pin://${QUESTION_PIN}`);
    assert.equal(fetchStub.calls.filter((url) => url.includes(QUESTION_PIN)).length, 2, 'positives always re-probe');
  } finally {
    fetchStub.restore();
  }
});

test('adapter resolveResource routes question pins to the qanda viewer before the generic resolver', async (t) => {
  const profileHome = await createProfileHome('oac-browser-qa-resolve-');
  t.after(async () => cleanupProfileHome(profileHome));
  const systemHomeDir = deriveSystemHome(profileHome);
  const active = await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'QA Resolve Bot',
    homeDir: profileHome,
    globalMetaId: 'idq1qaresolve',
    mvcAddress: '1QaResolveBotAddr',
  });

  const fetchCalls = [];
  const adapter = createOacBrowserHostAdapter({
    homeDir: active.homeDir,
    systemHomeDir,
    metaAppPreviewSessions: createMetaAppPreviewSessionRegistry(),
    env: {},
    fetch: undefined,
    resolveActorWriteContext: async () => ({ homeDir: active.homeDir }),
  });

  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return { status: 200, json: async () => questionEnvelope() };
  };
  t.after(() => { globalThis.fetch = original; });

  const resolved = await adapter.resolveResource({
    actorId: active.slug,
    uri: `pin://${QUESTION_PIN}`,
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.resourceType, 'metaapp');
  assert.equal(resolved.data.renderer.type, 'html-iframe');
  assert.equal(resolved.data.renderer.url, `/ui/qanda/app/index.html#q/${QUESTION_PIN}`);
  assert.equal(resolved.data.proof.protocolPath, '/protocols/simplequestion');
  assert.ok(
    fetchCalls.some((url) => url.includes(`/api/qa/questions/${QUESTION_PIN}`)),
    'the question probe ran against the Q&A index',
  );
  assert.ok(
    !fetchCalls.some((url) => url.includes('/api/metaweb/pin/')),
    'the generic pin reader path was not consulted',
  );
});
