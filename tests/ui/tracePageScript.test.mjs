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
                    content: '# Forecast\n\nSunny.',
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
  for (let i = 0; i < 20 && !/Forecast/.test(detail.innerHTML); i += 1) {
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
  assert.match(detail.innerHTML, /Forecast/);
});

test('trace page URL with only traceId selects the matching A2A session', async () => {
  const { fetchCalls, detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1');

  assert.deepEqual(fetchCalls.slice(0, 2), [
    '/api/trace/sessions',
    '/api/trace/sessions/session-weather-1',
  ]);
  assert.match(detail.innerHTML, /Forecast/);
});
