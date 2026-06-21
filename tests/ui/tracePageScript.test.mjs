import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildTraceInspectorScript } = require('../../dist/ui/pages/trace/sseClient.js');

const TRACE_SESSIONS_ENDPOINT = '/api/trace/sessions?all=true&limit=500';
const REFUND_WORK_ENDPOINT = '/api/services/refunds?all=true';
const IMAGE_ARTIFACT = {
  uri: 'metafile://image-pin.png',
  pinId: 'image-pin',
  kind: 'image',
  fileName: 'weather-map.png',
  extension: '.png',
  contentType: 'image/png',
  byteLength: 1234,
  sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/image-pin',
  fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/image-pin',
  downloadUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/image-pin',
};

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

function createDetailElementStub(options = {}) {
  const element = createElementStub();
  let html = '';
  let buttons = [];
  let scroll = options.scroll || { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
  let renderCount = 0;
  const createScroll = (previousScroll) => ({
    scrollTop: options.nextScrollTop ?? previousScroll.scrollTop ?? 0,
    scrollHeight: options.nextScrollHeight ?? previousScroll.scrollHeight ?? 0,
    clientHeight: options.nextClientHeight ?? previousScroll.clientHeight ?? 0,
  });
  Object.defineProperty(element, 'innerHTML', {
    get() {
      return html;
    },
    set(value) {
      html = String(value || '');
      buttons = [];
      const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gu;
      for (const match of html.matchAll(buttonPattern)) {
        const button = createElementStub();
        button.listeners = new Map();
        button.addEventListener = (eventName, handler) => {
          button.listeners.set(eventName, handler);
        };
        const attrs = match[1] || '';
        button.textContent = stripTags(match[2] || '').trim();
        button.attrs = {};
        for (const attrMatch of attrs.matchAll(/\s([a-zA-Z0-9_-]+)="([^"]*)"/gu)) {
          button.attrs[attrMatch[1]] = attrMatch[2];
        }
        button.getAttribute = (name) => button.attrs[name] || '';
        buttons.push(button);
      }
      renderCount += 1;
      if (html.includes('messages-scroll')) {
        scroll = renderCount === 1 && options.scroll ? options.scroll : createScroll(scroll);
      }
    },
  });
  element.querySelector = (selector) => {
    if (selector === '.messages-scroll') return scroll;
    return null;
  };
  element.querySelectorAll = (selector) => (
    selector === '[data-process-refund]'
      ? buttons.filter((button) => button.attrs && Object.prototype.hasOwnProperty.call(button.attrs, 'data-process-refund'))
      : []
  );
  return {
    element,
    get scroll() {
      return scroll;
    },
    get renderCount() {
      return renderCount;
    },
  };
}

function stripTags(value) {
  return String(value || '').replace(/<[^>]*>/gu, '');
}

function createFakeDate(nowRef) {
  return class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [nowRef.value]));
    }

    static now() {
      return nowRef.value;
    }
  };
}

async function runTraceScriptWithUrl(search, options = {}) {
  const list = createElementStub();
  const detailStub = createDetailElementStub(options.detail || {});
  const detail = detailStub.element;
  const stats = new Map([
    ['[data-trace-total]', createElementStub()],
    ['[data-trace-caller]', createElementStub()],
    ['[data-trace-provider]', createElementStub()],
    ['[data-trace-last]', createElementStub()],
  ]);
  const fetchCalls = [];
  let refreshCallback = null;
  const localMetabotGlobalMetaId = 'idq-local';
  const peerGlobalMetaId = 'idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz';
  const defaultDetailData = {
    session: {
      sessionId: 'session-weather-1',
      traceId: 'trace-weather-1',
      role: 'caller',
      state: 'completed',
    },
    localMetabotName: 'Caller',
    localMetabotGlobalMetaId,
    localMetabotAvatar: '/content/f77ba5db20c19242f9a5e5025357d29ad83f897f3700d2b1972f6ce1485098d7i0',
    peerGlobalMetaId,
    peerName: 'AI_Sunny',
    peerAvatar: '/content/607b2da84bbd01e01397bb6ea8cd09e4f9b0e87552dd0d0e24b828f18884dd30i0',
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
  };

  const context = {
    console,
    Date: options.Date || Date,
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
    fetch: async (url, fetchOptions = {}) => {
      fetchCalls.push(String(url));
      if (url === '/api/services/refunds/settle') {
        return {
          ok: true,
          json: async () => options.settleResponse || { ok: true, data: { orderId: 'seller-order-refund-1' } },
        };
      }
      if (url === TRACE_SESSIONS_ENDPOINT) {
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
                  localMetabotName: 'Caller',
                  localMetabotGlobalMetaId,
                  peerGlobalMetaId,
                  peerName: 'AI_Sunny',
                },
              ],
              stats: { totalCount: 1, callerCount: 1, providerCount: 0, lastUpdatedAt: 1_777_000_001_000 },
            },
          }),
        };
      }
      if (url === REFUND_WORK_ENDPOINT) {
        return {
          ok: true,
          json: async () => ({
            data: options.refunds || { initiatedByMe: [], receivedByMe: [], totalCount: 0 },
          }),
        };
      }
      if (url === '/api/trace/sessions/session-weather-1') {
        const detailData = typeof options.detailData === 'function'
          ? options.detailData(structuredClone(defaultDetailData))
          : defaultDetailData;
        return {
          ok: true,
          json: async () => ({
            data: detailData,
          }),
        };
      }
      const profilePrefix = 'https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/';
      if (String(url).startsWith(profilePrefix) && options.profiles) {
        const gmid = decodeURIComponent(String(url).slice(profilePrefix.length));
        const profile = typeof options.profiles === 'function'
          ? options.profiles(gmid)
          : options.profiles[gmid];
        if (profile) {
          return {
            ok: true,
            json: async () => ({ data: profile }),
          };
        }
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildTraceInspectorScript(), context);
  for (let i = 0; i < 20 && !/Forecast detail/.test(detail.innerHTML); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  runTraceScriptWithUrl.refreshCallback = refreshCallback;
  return { fetchCalls, detail, list, detailScroll: detailStub.scroll, detailStub };
}

test('trace page URL with sessionId auto-loads that A2A session detail', async () => {
  const { fetchCalls, detail, list } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
  );

  assert.deepEqual(fetchCalls.filter((url) => url.startsWith('/api/')).slice(0, 3), [
    TRACE_SESSIONS_ENDPOINT,
    REFUND_WORK_ENDPOINT,
    '/api/trace/sessions/session-weather-1',
  ]);
  assert.match(detail.innerHTML, /Forecast detail/);
  assert.match(list.innerHTML, /AI_Sunny/);
  assert.match(list.innerHTML, /local: Caller/);
});

test('trace page URL with only traceId selects the matching A2A session', async () => {
  const { fetchCalls, detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1');

  assert.deepEqual(fetchCalls.filter((url) => url.startsWith('/api/')).slice(0, 3), [
    TRACE_SESSIONS_ENDPOINT,
    REFUND_WORK_ENDPOINT,
    '/api/trace/sessions/session-weather-1',
  ]);
  assert.match(detail.innerHTML, /Forecast detail/);
});

test('trace page marks sessions that have local seller refund work', async () => {
  const { list } = await runTraceScriptWithUrl('', {
    refunds: {
      initiatedByMe: [],
      receivedByMe: [{
        orderId: 'seller-order-refund-1',
        role: 'seller',
        traceId: 'trace-weather-1',
        status: 'failed',
        paymentTxid: 'a'.repeat(64),
        paymentAmount: '0.00001',
        manualActionRequired: true,
        refundRequestPinId: null,
        refundFinalizePinId: null,
      }],
      totalCount: 1,
    },
  });

  assert.match(list.innerHTML, /Refund required/);
  assert.match(list.innerHTML, /status-manual/);
});

test('trace page shows refund action in session detail from local refund work', async () => {
  const { detail, fetchCalls } = await runTraceScriptWithUrl('?traceId=trace-weather-1&sessionId=session-weather-1', {
    refunds: {
      initiatedByMe: [],
      receivedByMe: [{
        orderId: 'seller-order-refund-1',
        role: 'seller',
        traceId: 'trace-weather-1',
        localMetabotSlug: 'seller-bot',
        status: 'failed',
        paymentTxid: 'a'.repeat(64),
        paymentAmount: '0.00001',
        manualActionRequired: true,
        refundRequestPinId: null,
        refundFinalizePinId: null,
      }],
      totalCount: 1,
    },
  });

  assert.match(detail.innerHTML, /Provider refund needs operator attention/);
  assert.match(detail.innerHTML, /Process refund/);
  assert.doesNotMatch(detail.innerHTML, /Review refund/);
  const buttons = detail.querySelectorAll('[data-process-refund]');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].getAttribute('data-process-refund'), 'seller-order-refund-1');
  assert.equal(buttons[0].getAttribute('data-refund-from'), 'seller-bot');

  await buttons[0].listeners.get('click')();

  assert.ok(fetchCalls.includes('/api/services/refunds/settle'));
});

test('trace page renders markdown tables, blockquotes, and txid copy affordance in bubbles', async () => {
  const { detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1&sessionId=session-weather-1');

  assert.match(detail.innerHTML, /<h4>Forecast detail<\/h4>/);
  assert.match(detail.innerHTML, /<table>/);
  assert.match(detail.innerHTML, /<th>Item<\/th>/);
  assert.match(detail.innerHTML, /<strong>Sunny<\/strong>/);
  assert.match(detail.innerHTML, /<blockquote>/);
  assert.match(detail.innerHTML, /txid: 65a469a2\.\.\.\./);
  assert.match(detail.innerHTML, /data-copy-text="65a469a273a5d212975309c2eda54b1c6c9ece97cab6e60d07e23e349f41932b"/);
  assert.match(detail.innerHTML, /class="copy-icon"/);
  assert.doesNotMatch(detail.innerHTML, />Copy<\/button>/);
});

test('trace page renders structured image artifacts without metafile text in the message', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Image delivered separately.';
        data.inspector.transcriptItems[0].artifacts = [IMAGE_ARTIFACT];
        return data;
      },
    },
  );

  assert.match(detail.innerHTML, /Image delivered separately\./);
  assert.match(detail.innerHTML, /weather-map\.png/);
  assert.match(detail.innerHTML, /<img src="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/image-pin"/);
});

test('trace page strips local path components from structured artifact file names', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Image delivered separately.';
        data.inspector.transcriptItems[0].artifacts = [
          {
            ...IMAGE_ARTIFACT,
            fileName: '/Users/alice/secret.png',
          },
        ];
        return data;
      },
    },
  );

  assert.match(detail.innerHTML, /secret\.png/);
  assert.doesNotMatch(detail.innerHTML, /\/Users\/alice\/secret\.png/);
});

test('trace page still renders old text-only metafile image, video, audio, and file links', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = [
          'metafile://old-image.png',
          'metafile://old-video.mp4',
          'metafile://old-video-m4v.m4v',
          'metafile://old-audio.mp3',
          'metafile://old-audio-ogg.ogg',
          'metafile://old-audio-m4a.m4a',
          'metafile://old-file.pdf',
        ].join('\n');
        return data;
      },
    },
  );

  assert.match(detail.innerHTML, /old-image\.png/);
  assert.equal((detail.innerHTML.match(/<video controls/g) || []).length, 2);
  assert.match(detail.innerHTML, /old-video/);
  assert.match(detail.innerHTML, /old-video-m4v/);
  assert.equal((detail.innerHTML.match(/<audio controls/g) || []).length, 3);
  assert.match(detail.innerHTML, /old-audio/);
  assert.match(detail.innerHTML, /old-audio-ogg/);
  assert.match(detail.innerHTML, /old-audio-m4a/);
  assert.match(detail.innerHTML, /Download<\/a>/);
  assert.match(detail.innerHTML, /old-file\.pdf/);
});

test('trace page prefers structured artifacts over duplicate text-parsed artifacts', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Structured wins: metafile://duplicate-pin.png';
        data.inspector.transcriptItems[0].artifacts = [
          {
            ...IMAGE_ARTIFACT,
            uri: 'metafile://duplicate-pin.png',
            pinId: 'duplicate-pin',
            fileName: 'structured-duplicate.png',
            sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/duplicate-pin',
            fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/duplicate-pin',
            downloadUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/duplicate-pin',
          },
        ];
        return data;
      },
    },
  );

  assert.equal((detail.innerHTML.match(/class="metafile-preview/g) || []).length, 1);
  assert.match(detail.innerHTML, /structured-duplicate\.png/);
  assert.match(detail.innerHTML, /Structured wins: metafile:\/\/duplicate-pin\.png/);
});

test('trace page renders video and audio cards with stable download links before playback hydration', async () => {
  const videoDownload = 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/video-pin';
  const audioDownload = 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/audio-pin';
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Playable files delivered.';
        data.inspector.transcriptItems[0].artifacts = [
          {
            uri: 'metafile://video-pin.mp4',
            pinId: 'video-pin',
            kind: 'video',
            fileName: 'clip.mp4',
            extension: '.mp4',
            contentType: 'video/mp4',
            byteLength: 4321,
            sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/video-pin',
            fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/video-pin',
            downloadUrl: videoDownload,
          },
          {
            uri: 'metafile://audio-pin.mp3',
            pinId: 'audio-pin',
            kind: 'audio',
            fileName: 'voice.mp3',
            extension: '.mp3',
            contentType: 'audio/mpeg',
            byteLength: 2345,
            sourceUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/audio-pin',
            fallbackUrl: 'https://file.metaid.io/metafile-indexer/api/v1/files/content/audio-pin',
            downloadUrl: audioDownload,
          },
        ];
        return data;
      },
    },
  );

  assert.match(detail.innerHTML, /<video controls/);
  assert.match(detail.innerHTML, /data-source-url="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/video-pin"/);
  assert.match(detail.innerHTML, new RegExp(`href="${videoDownload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(detail.innerHTML, /<audio controls/);
  assert.match(detail.innerHTML, /data-source-url="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/audio-pin"/);
  assert.match(detail.innerHTML, new RegExp(`href="${audioDownload.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
});

test('trace page rebuilds structured metafile URLs and rejects non-metafile artifacts', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Video delivered separately.';
        data.inspector.transcriptItems[0].artifacts = [
          {
            uri: 'metafile://abc123i0.mp4',
            sourceUrl: 'file:///Users/secret.mp4',
            fallbackUrl: '/Users/secret.mp4',
            downloadUrl: 'file:///tmp/secret.mp4',
          },
          {
            uri: 'https://attacker.example/evil.mp4',
            sourceUrl: 'file:///Users/evil.mp4',
            fallbackUrl: '/Users/evil.mp4',
            downloadUrl: 'file:///tmp/evil.mp4',
          },
        ];
        return data;
      },
    },
  );

  assert.match(detail.innerHTML, /<video controls/);
  assert.match(detail.innerHTML, /data-source-url="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/abc123i0"/);
  assert.match(detail.innerHTML, /data-fallback-url="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/content\/abc123i0"/);
  assert.match(detail.innerHTML, /href="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/abc123i0"/);
  assert.doesNotMatch(detail.innerHTML, /(?:href|data-source-url|data-fallback-url|data-download-url)="(?:file:|\/Users\/|https:\/\/attacker\.example)/);
});

test('trace page rejects path-like structured metafile artifact URIs', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Artifacts delivered separately.';
        data.inspector.transcriptItems[0].artifacts = [
          {
            uri: 'metafile://valid-image.png',
            fileName: 'valid-image.png',
          },
          {
            uri: 'metafile:///Users/alice/secret.png',
          },
          {
            uri: 'metafile://C:\\Users\\alice\\secret.png',
          },
        ];
        return data;
      },
    },
  );

  assert.match(detail.innerHTML, /valid-image\.png/);
  assert.match(detail.innerHTML, /files\/accelerate\/content\/valid-image/);
  assert.doesNotMatch(detail.innerHTML, /\/Users|secret\.png|%2FUsers%2Falice%2Fsecret|C%3A%5CUsers%5Calice%5Csecret/i);
});

test('trace page ignores raw structured kind when rendering metafile artifacts', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Typed artifacts delivered.';
        data.inspector.transcriptItems[0].artifacts = [
          {
            uri: 'metafile://kind-video-pin.mp4',
            kind: 'image',
          },
          {
            uri: 'metafile://kind-image-pin.png',
            kind: 'video',
          },
          {
            uri: 'metafile://kind-audio-pin.bin',
            kind: 'image',
            contentType: 'audio/mpeg',
          },
        ];
        return data;
      },
    },
  );

  assert.equal((detail.innerHTML.match(/<video controls/g) || []).length, 1);
  assert.equal((detail.innerHTML.match(/<div class="metafile-preview"><img src=/g) || []).length, 1);
  assert.equal((detail.innerHTML.match(/<audio controls/g) || []).length, 1);
  assert.match(detail.innerHTML, /data-source-url="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/kind-video-pin"/);
  assert.match(detail.innerHTML, /<img src="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/kind-image-pin"/);
  assert.match(detail.innerHTML, /data-source-url="https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/kind-audio-pin"/);
});

test('trace page escapes structured artifact names, pin ids, and URLs', async () => {
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        data.inspector.transcriptItems[0].content = 'Escaped artifact.';
        data.inspector.transcriptItems[0].artifacts = [
          {
            uri: 'metafile://escape-pin.png',
            pinId: 'escape-pin"><script>alert(1)</script>',
            kind: 'image',
            fileName: 'evil<img src=x onerror=alert(2)>.png',
            extension: '.png',
            contentType: 'image/png',
            byteLength: 12,
            sourceUrl: 'https://files.example.test/image.png?x="><script>alert(3)</script>',
            fallbackUrl: 'https://files.example.test/fallback.png?x="><script>alert(4)</script>',
            downloadUrl: 'https://files.example.test/download.png?x="><script>alert(5)</script>',
          },
        ];
        return data;
      },
    },
  );

  assert.doesNotMatch(detail.innerHTML, /<script>/);
  assert.doesNotMatch(detail.innerHTML, /<img src=x/);
  assert.match(detail.innerHTML, /evil&lt;img src=x onerror=alert\(2\)&gt;\.png/);
  assert.doesNotMatch(detail.innerHTML, /escape-pin&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(detail.innerHTML, /https:\/\/file\.metaid\.io\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/escape-pin/);
  assert.doesNotMatch(detail.innerHTML, /files\.example\.test/);
});

test('trace page header renders remote on the left, local on the right, avatars, and icon trace copy', async () => {
  const { detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1&sessionId=session-weather-1');

  const remoteIndex = detail.innerHTML.indexOf('AI_Sunny');
  const traceIndex = detail.innerHTML.indexOf('trace: trace-weather-1');
  const localIndex = detail.innerHTML.indexOf('Caller');

  assert.ok(remoteIndex >= 0);
  assert.ok(traceIndex > remoteIndex);
  assert.ok(localIndex > traceIndex);
  assert.match(
    detail.innerHTML,
    /src="\/api\/file\/avatar\?ref=607b2da84bbd01e01397bb6ea8cd09e4f9b0e87552dd0d0e24b828f18884dd30i0"/,
  );
  assert.match(
    detail.innerHTML,
    /src="\/api\/file\/avatar\?ref=f77ba5db20c19242f9a5e5025357d29ad83f897f3700d2b1972f6ce1485098d7i0"/,
  );
  assert.match(detail.innerHTML, /data-copy-text="trace-weather-1"/);
  assert.match(detail.innerHTML, /aria-label="Copy trace id"/);
});

test('trace page links only remote Bot avatars to Browser Bot Pages in a new window', async () => {
  const { detail } = await runTraceScriptWithUrl('?traceId=trace-weather-1&sessionId=session-weather-1');

  const peerHref = '/browser/metaid/idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz';
  assert.match(detail.innerHTML, new RegExp(`href="${peerHref}"[^>]*target="_blank"`));
  assert.doesNotMatch(detail.innerHTML, /href="\/browser\/metaid\/idq-local"/);
});

test('trace page prefers latest profile avatars over stale or placeholder trace avatars', async () => {
  const latestLocalAvatar = '98a8137e6cc4b4352332faa7a7dd3a48b528eafd182035c15dea746b0e3590bdi0';
  const staleLocalAvatar = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0';
  const latestPeerAvatar = 'c16401c0097f86d77672900b91b6f8f4cd39e0d46b686654f0129660182f0812i0';
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      detailData(data) {
        return {
          ...data,
          localMetabotAvatar: `/content/${staleLocalAvatar}`,
          peerAvatar: '/content/',
        };
      },
      profiles: {
        'idq-local': { name: 'Caller', avatar: `/content/${latestLocalAvatar}` },
        idq14hmv23j5fnlx4ccnmvlyldjd38xjsechzwg9xz: { name: 'AI_Sunny', avatar: `/content/${latestPeerAvatar}` },
      },
    },
  );

  assert.match(detail.innerHTML, new RegExp(`/api/file/avatar\\?ref=${latestLocalAvatar}`));
  assert.match(detail.innerHTML, new RegExp(`/api/file/avatar\\?ref=${latestPeerAvatar}`));
  assert.doesNotMatch(detail.innerHTML, new RegExp(staleLocalAvatar));
  assert.doesNotMatch(detail.innerHTML, /src="\/content\/"/);
});

test('trace page refreshes profile avatar cache after a profile initially has no avatar', async () => {
  const nowRef = { value: 1_777_000_001_000 };
  const latestLocalAvatar = '98a8137e6cc4b4352332faa7a7dd3a48b528eafd182035c15dea746b0e3590bdi0';
  let profileHasAvatar = false;
  let localProfileFetches = 0;
  const { detail } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    {
      Date: createFakeDate(nowRef),
      detailData(data) {
        return {
          ...data,
          localMetabotAvatar: '',
        };
      },
      profiles(gmid) {
        if (gmid === 'idq-local') {
          localProfileFetches += 1;
          return {
            name: 'Caller',
            avatar: profileHasAvatar ? `/content/${latestLocalAvatar}` : '',
          };
        }
        return { name: 'AI_Sunny' };
      },
    },
  );

  assert.doesNotMatch(detail.innerHTML, new RegExp(latestLocalAvatar));

  profileHasAvatar = true;
  nowRef.value += 61_000;
  await runTraceScriptWithUrl.refreshCallback();

  assert.equal(localProfileFetches, 2);
  assert.match(detail.innerHTML, new RegExp(`/api/file/avatar\\?ref=${latestLocalAvatar}`));
});

test('trace page includes a toast target for copy feedback', () => {
  const html = readFileSync(new URL('../../src/ui/pages/trace/index.html', import.meta.url), 'utf8');

  assert.match(html, /data-copy-toast/);
});

test('trace page background refresh keeps the current detail while the next fetch is in flight', async () => {
  const list = createElementStub();
  const detailStub = createDetailElementStub();
  const detail = detailStub.element;
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
      if (url === TRACE_SESSIONS_ENDPOINT) {
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
      if (url === REFUND_WORK_ENDPOINT) {
        return {
          ok: true,
          json: async () => ({
            data: { initiatedByMe: [], receivedByMe: [], totalCount: 0 },
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
                transcriptItems: detailFetchCount > 1
                  ? [
                    {
                      id: 'delivery-1',
                      timestamp: 1_777_000_001_000,
                      type: 'delivery',
                      sender: 'provider',
                      content: '# Initial Forecast',
                    },
                    {
                      id: 'delivery-2',
                      timestamp: 1_777_000_002_000,
                      type: 'delivery',
                      sender: 'provider',
                      content: '# Refreshed Forecast',
                    },
                  ]
                  : [
                    {
                      id: 'delivery-1',
                      timestamp: 1_777_000_001_000,
                      type: 'delivery',
                      sender: 'provider',
                      content: '# Initial Forecast',
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
  detailStub.scroll.scrollTop = 180;
  detailStub.scroll.scrollHeight = 1000;
  detailStub.scroll.clientHeight = 300;
  assert.ok(refreshCallback);
  const refreshPromise = refreshCallback();
  await Promise.resolve();

  assert.equal(detail.innerHTML, beforeRefresh);
  assert.doesNotMatch(detail.innerHTML, /Loading session/);

  resolveSecondDetail();
  await refreshPromise;
  assert.match(detail.innerHTML, /Refreshed Forecast/);
  assert.equal(detailStub.scroll.scrollTop, 1000);
});

test('trace page background refresh does not rerender unchanged details or reset historical scroll', async () => {
  const scroll = { scrollTop: 120, scrollHeight: 900, clientHeight: 300 };
  const { detail, detailScroll, detailStub } = await runTraceScriptWithUrl(
    '?traceId=trace-weather-1&sessionId=session-weather-1',
    { detail: { scroll } },
  );
  const initialHtml = detail.innerHTML;
  const initialRenderCount = detailStub.renderCount;
  assert.match(initialHtml, /Forecast detail/);

  detailScroll.scrollTop = 240;
  detailScroll.scrollHeight = 1200;
  detailScroll.clientHeight = 300;

  await runTraceScriptWithUrl.refreshCallback();

  assert.equal(detail.innerHTML, initialHtml);
  assert.equal(detailStub.renderCount, initialRenderCount);
  assert.equal(detailScroll.scrollTop, 240);
});

test('trace page silent refresh recovers from a transient detail fetch error when payload is unchanged', async () => {
  const list = createElementStub();
  const detailStub = createDetailElementStub();
  const detail = detailStub.element;
  const stats = new Map([
    ['[data-trace-total]', createElementStub()],
    ['[data-trace-caller]', createElementStub()],
    ['[data-trace-provider]', createElementStub()],
    ['[data-trace-last]', createElementStub()],
  ]);
  let refreshCallback = null;
  let detailFetchCount = 0;
  const payload = {
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
            content: '# Stable Forecast',
          },
        ],
      },
    },
  };

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
      if (url === TRACE_SESSIONS_ENDPOINT) {
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
      if (url === REFUND_WORK_ENDPOINT) {
        return {
          ok: true,
          json: async () => ({
            data: { initiatedByMe: [], receivedByMe: [], totalCount: 0 },
          }),
        };
      }
      if (url === '/api/trace/sessions/session-weather-1') {
        detailFetchCount += 1;
        if (detailFetchCount === 2) {
          throw new Error('temporary detail failure');
        }
        return {
          ok: true,
          json: async () => payload,
        };
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  };

  vm.runInNewContext(buildTraceInspectorScript(), context);
  for (let i = 0; i < 20 && !/Stable Forecast/.test(detail.innerHTML); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.match(detail.innerHTML, /Stable Forecast/);

  await refreshCallback();
  assert.match(detail.innerHTML, /Failed to load session/);

  await refreshCallback();
  assert.match(detail.innerHTML, /Stable Forecast/);
});

test('trace page metadata-only message refresh preserves historical scroll position', async () => {
  const list = createElementStub();
  const detailStub = createDetailElementStub({
    scroll: { scrollTop: 0, scrollHeight: 900, clientHeight: 300 },
  });
  const detail = detailStub.element;
  const stats = new Map([
    ['[data-trace-total]', createElementStub()],
    ['[data-trace-caller]', createElementStub()],
    ['[data-trace-provider]', createElementStub()],
    ['[data-trace-last]', createElementStub()],
  ]);
  let refreshCallback = null;
  let detailFetchCount = 0;

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
      if (url === TRACE_SESSIONS_ENDPOINT) {
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
      if (url === REFUND_WORK_ENDPOINT) {
        return {
          ok: true,
          json: async () => ({
            data: { initiatedByMe: [], receivedByMe: [], totalCount: 0 },
          }),
        };
      }
      if (url === '/api/trace/sessions/session-weather-1') {
        detailFetchCount += 1;
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
                    content: '# Forecast',
                    metadata: detailFetchCount > 1
                      ? { txid: '65a469a273a5d212975309c2eda54b1c6c9ece97cab6e60d07e23e349f41932b' }
                      : null,
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
  detailStub.scroll.scrollTop = 180;
  detailStub.scroll.scrollHeight = 900;
  detailStub.scroll.clientHeight = 300;

  await refreshCallback();

  assert.match(detail.innerHTML, /txid: 65a469a2\.\.\.\./);
  assert.equal(detailStub.scroll.scrollTop, 180);
});
