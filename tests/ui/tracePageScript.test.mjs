import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildTraceInspectorScript } = require('../../dist/ui/pages/trace/sseClient.js');

function createElementStub() {
  return {
    innerHTML: '',
    textContent: '',
    dataset: {},
    style: {},
    addEventListener() {},
    classList: {
      toggle() {},
    },
    querySelector(selector) {
      if (selector === '.messages-scroll') {
        return { scrollTop: 0, scrollHeight: 0 };
      }
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
}

async function runTraceScriptWithUrl(search) {
  const list = createElementStub();
  const detail = createElementStub();
  const stats = new Map([
    ['[data-trace-total]', createElementStub()],
    ['[data-trace-caller]', createElementStub()],
    ['[data-trace-provider]', createElementStub()],
    ['[data-trace-last]', createElementStub()],
  ]);
  const fetchCalls = [];

  const context = {
    console,
    Date,
    Map,
    Set,
    Number,
    Promise,
    String,
    Error,
    encodeURIComponent,
    URLSearchParams,
    setInterval() {
      return 1;
    },
    clearInterval() {},
    window: {
      location: { search },
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector(selector) {
        if (selector === '[data-session-list]') return list;
        if (selector === '[data-session-detail]') return detail;
        return stats.get(selector) ?? null;
      },
      querySelectorAll() {
        return [];
      },
    },
    fetch: async (url) => {
      fetchCalls.push(String(url));
      if (url === '/api/trace/sessions') {
        return {
          ok: true,
          json: async () => ({
            data: {
              sessions: [
                {
                  sessionId: 'session-weather-1',
                  traceId: 'trace-weather-1',
                  role: 'caller',
                  state: 'completed',
                  createdAt: 1_777_000_000_000,
                  updatedAt: 1_777_000_001_000,
                },
              ],
              stats: { totalCount: 1, callerCount: 1, providerCount: 0, lastUpdatedAt: 1_777_000_001_000 },
            },
          }),
        };
      }
      if (url === '/api/trace/sessions/session-weather-1') {
        return {
          ok: true,
          json: async () => ({
            data: {
              session: {
                sessionId: 'session-weather-1',
                traceId: 'trace-weather-1',
                role: 'caller',
                state: 'completed',
              },
              localMetabotName: 'Caller',
              inspector: {
                transcriptItems: [
                  {
                    id: 'delivery-1',
                    timestamp: 1_777_000_001_000,
                    type: 'delivery',
                    sender: 'provider',
                    content: [
                      '#### Forecast detail',
                      '',
                      '| Item | Value |',
                      '|------|-------|',
                      '| Weather | **Sunny** |',
                      '',
                      '> Bring sunglasses.',
                    ].join('\n'),
                    metadata: {
                      deliveryPinId: '65a469a273a5d212975309c2eda54b1c6c9ece97cab6e60d07e23e349f41932bi0',
                    },
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildTraceInspectorScript(), context);
  for (let i = 0; i < 20 && !/Forecast detail/.test(detail.innerHTML); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return { fetchCalls, detail };
}

test('trace page URL with sessionId auto-loads that A2A session detail', async () => {
  const { fetchCalls, detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
  );

  assert.deepEqual(fetchCalls.slice(0, 2), [
    '/api/trace/sessions',
    '/api/trace/sessions/session-weather-1',
  ]);
  assert.match(detail.innerHTML, /Forecast detail/);
});

test('trace page URL with only traceId selects the matching A2A session', async () => {
  const { fetchCalls, detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1');

  assert.deepEqual(fetchCalls.slice(0, 2), [
    '/api/trace/sessions',
    '/api/trace/sessions/session-weather-1',
  ]);
  assert.match(detail.innerHTML, /Forecast detail/);
});

test('trace page renders markdown tables, blockquotes, and txid copy affordance in bubbles', async () => {
  const { detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1&sessionId=session-weather-1');

  assert.match(detail.innerHTML, /<h4>Forecast detail<\/h4>/);
  assert.match(detail.innerHTML, /<table>/);
  assert.match(detail.innerHTML, /<th>Item<\/th>/);
  assert.match(detail.innerHTML, /<strong>Sunny<\/strong>/);
  assert.match(detail.innerHTML, /<blockquote>/);
  assert.match(detail.innerHTML, /txid: 65a469a2\.\.\.\./);
  assert.match(detail.innerHTML, /data-copy-txid="65a469a273a5d212975309c2eda54b1c6c9ece97cab6e60d07e23e349f41932b"/);
});

test('trace page background refresh keeps the current detail while the next fetch is in flight', async () => {
  const list = createElementStub();
  const detail = createElementStub();
  const stats = new Map([
    ['[data-trace-total]', createElementStub()],
    ['[data-trace-caller]', createElementStub()],
    ['[data-trace-provider]', createElementStub()],
    ['[data-trace-last]', createElementStub()],
  ]);
  let refreshCallback = null;
  let detailFetchCount = 0;
  let resolveSecondDetail;
  const secondDetail = new Promise((resolve) => {
    resolveSecondDetail = resolve;
  });

  const context = {
    console,
    Date,
    Map,
    Set,
    Number,
    Promise,
    String,
    Error,
    encodeURIComponent,
    URLSearchParams,
    setInterval(callback) {
      refreshCallback = callback;
      return 1;
    },
    clearInterval() {},
    window: {
      location: { search: '?traceId=trace-weather-1&sessionId=session-weather-1' },
    },
    document: {
      readyState: 'complete',
      addEventListener() {},
      querySelector(selector) {
        if (selector === '[data-session-list]') return list;
        if (selector === '[data-session-detail]') return detail;
        return stats.get(selector) ?? null;
      },
      querySelectorAll() {
        return [];
      },
    },
    fetch: async (url) => {
      if (url === '/api/trace/sessions') {
        return {
          ok: true,
          json: async () => ({
            data: {
              sessions: [
                {
                  sessionId: 'session-weather-1',
                  traceId: 'trace-weather-1',
                  role: 'caller',
                  state: 'completed',
                  createdAt: 1_777_000_000_000,
                  updatedAt: 1_777_000_001_000,
                },
              ],
              stats: { totalCount: 1, callerCount: 1, providerCount: 0, lastUpdatedAt: 1_777_000_001_000 },
            },
          }),
        };
      }
      if (url === '/api/trace/sessions/session-weather-1') {
        detailFetchCount += 1;
        if (detailFetchCount > 1) {
          await secondDetail;
        }
        return {
          ok: true,
          json: async () => ({
            data: {
              session: {
                sessionId: 'session-weather-1',
                traceId: 'trace-weather-1',
                role: 'caller',
                state: 'completed',
              },
              localMetabotName: 'Caller',
              inspector: {
                transcriptItems: [
                  {
                    id: `delivery-${detailFetchCount}`,
                    timestamp: 1_777_000_001_000 + detailFetchCount,
                    type: 'delivery',
                    sender: 'provider',
                    content: detailFetchCount > 1 ? '# Refreshed Forecast' : '# Initial Forecast',
                  },
                ],
              },
            },
          }),
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildTraceInspectorScript(), context);
  for (let i = 0; i < 20 && !/Initial Forecast/.test(detail.innerHTML); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const beforeRefresh = detail.innerHTML;
  assert.ok(refreshCallback);
  const refreshPromise = refreshCallback();
  await Promise.resolve();

  assert.equal(detail.innerHTML, beforeRefresh);
  assert.doesNotMatch(detail.innerHTML, /Loading session/);

  resolveSecondDetail();
  await refreshPromise;
  assert.match(detail.innerHTML, /Refreshed Forecast/);
});
