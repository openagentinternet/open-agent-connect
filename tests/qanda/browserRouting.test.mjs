import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { tryQaQuestionBrowserPath } = require('../../dist/cli/runtime.js');

function stubFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = await handler(String(url));
    return { status: 200, json: async () => body };
  };
  return () => {
    globalThis.fetch = original;
  };
}

function envelope(data) {
  return { code: 0, data, message: 'ok' };
}

test('a simplequestion pin routes to the bundled qanda app question page', async () => {
  const questionPin = 'a'.repeat(64) + 'i0';
  const restore = stubFetch((url) => {
    assert.match(url, new RegExp(`/api/qa/questions/${questionPin}$`));
    return envelope({ question: {}, answers: [] });
  });
  try {
    const path = await tryQaQuestionBrowserPath(`pin://${questionPin}`);
    assert.equal(path, `/ui/qanda/app/index.html#q/${questionPin}`);
  } finally {
    restore();
  }
});

test('non-pin URIs never probe; non-question pins fall back (cached negatives)', async () => {
  let probes = 0;
  const restore = stubFetch(() => {
    probes += 1;
    return { code: 40400, data: null, message: 'not a question' };
  });
  try {
    assert.equal(await tryQaQuestionBrowserPath('metaid://idq1abc'), null);
    assert.equal(await tryQaQuestionBrowserPath('metaapp://pini0'), null);
    assert.equal(probes, 0, 'only bare pin:// URIs probe');

    const notQuestion = 'b'.repeat(64) + 'i0';
    assert.equal(await tryQaQuestionBrowserPath(`pin://${notQuestion}`), null);
    assert.equal(probes, 1);
    assert.equal(await tryQaQuestionBrowserPath(`pin://${notQuestion}`), null);
    assert.equal(probes, 1, 'definitive negatives are cached');
  } finally {
    restore();
  }
});

test('indexer outages fall back without caching', async () => {
  let probes = 0;
  const outagePin = 'c'.repeat(64) + 'i0';
  const restore = stubFetch(() => {
    probes += 1;
    return { code: 50000, data: null, message: 'boom' };
  });
  try {
    assert.equal(await tryQaQuestionBrowserPath(`pin://${outagePin}`), null);
    assert.equal(await tryQaQuestionBrowserPath(`pin://${outagePin}`), null);
    assert.equal(probes, 2, 'indeterminate failures are re-probed next open');
  } finally {
    restore();
  }
});
