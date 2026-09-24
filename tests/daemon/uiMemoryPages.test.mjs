import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { DICTIONARIES } = require('../../dist/ui/i18n.js');

async function startServer() {
  const server = createHttpServer({});
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject : resolve)(error));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject : resolve)(error));
      });
    },
  };
}

test('GET /ui/memory serves the Memory page with console chrome and all five tabs', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/memory`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /data-memory-shell/);
  // Every tab's API surface is wired into the page script.
  assert.match(html, /\/api\/memory\/knowledge\/list/);
  assert.match(html, /\/api\/memory\/list/);
  assert.match(html, /\/api\/memory\/impressions\/list/);
  assert.match(html, /\/api\/memory\/impressions\/show/);
  assert.match(html, /\/api\/memory\/policy/);
  assert.match(html, /\/api\/memory\/hygiene\/status/);
  assert.match(html, /\/api\/memory\/hygiene\/run/);
  assert.match(html, /\/api\/dream\/status/);
  assert.match(html, /\/api\/dream\/due/);
  assert.match(html, /\/api\/dream\/summaries/);
  assert.match(html, /\/api\/dream\/self-identity/);
  assert.match(html, /\/api\/dream\/capabilities/);
  assert.match(html, /\/api\/dream\/run/);
  // Tab definitions ship with the page.
  assert.match(html, /\['knowledge', 'facts', 'contacts', 'dream', 'settings'\]/);
  assert.match(html, /data-memory-tab=/);
  // Topbar chrome: logo, injected controls, and the console nav.
  assert.match(html, /topbar-logo/);
  assert.match(html, /data-language-toggle/);
  assert.match(html, /data-settings-modal/);
  assert.match(html, /href="\/ui\/memory"[^>]*class="active"|class="active"[^>]*href="\/ui\/memory"/);
  assert.match(html, /<title data-i18n-title="memory\.title">Memory — Open Agent Connect<\/title>/);
});

test('GET /ui/dream permanently redirects to the Memory page dream tab', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/dream?from=alice&lang=zh-CN`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const location = new URL(response.headers.get('location') ?? '', server.baseUrl);
  assert.equal(location.pathname, '/ui/memory');
  assert.equal(location.searchParams.get('tab'), 'dream');
  assert.equal(location.searchParams.get('from'), 'alice');
  assert.equal(location.searchParams.get('lang'), 'zh-CN');
});

test('GET /ui/dream without params redirects to a bare dream tab link', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/dream`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/ui/memory?tab=dream');
});

test('GET /ui/memory rejects non-GET methods for the dream redirect target', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/dream`, { method: 'POST' });
  assert.equal(response.status, 405);
  assert.match(response.headers.get('allow') ?? '', /GET/);
});

test('GET /ui/memory localizes to Simplified Chinese with lang=zh-CN', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/memory?lang=zh-CN`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /记忆 — Open Agent Connect/);
  assert.match(html, /添加知识点/);
  assert.match(html, /立即做梦/);
  assert.match(html, /记忆整理/);
});

test('console navigation includes Memory after Surf', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/memory`);
  const html = await response.text();
  const navMatch = html.match(/<nav class="topbar-nav">([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, 'topbar nav rendered');
  const nav = navMatch[1];
  const order = [
    '/ui/bot',
    '/ui/conversations',
    '/ui/services',
    '/ui/apps',
    '/ui/kb',
    '/ui/surf',
    '/ui/memory',
  ];
  let lastIndex = -1;
  for (const href of order) {
    const index = nav.indexOf(`href="${href}"`);
    assert.notEqual(index, -1, `nav should contain ${href}`);
    assert.ok(index > lastIndex, `${href} should follow the previous nav item`);
    lastIndex = index;
  }
  assert.match(nav, /data-i18n-key="nav.memory"/);
});

test('i18n dictionaries keep exact en/zh-CN parity including the memory family', () => {
  const enKeys = Object.keys(DICTIONARIES.en);
  const zhKeys = new Set(Object.keys(DICTIONARIES['zh-CN']));
  assert.equal(enKeys.length, zhKeys.size, 'dictionaries should hold the same number of keys');
  const missingInZh = enKeys.filter((key) => !zhKeys.has(key));
  assert.deepEqual(missingInZh, []);

  assert.ok(enKeys.includes('nav.memory'), 'en dictionary should include nav.memory');
  assert.ok(zhKeys.has('nav.memory'), 'zh-CN dictionary should include nav.memory');
  const memoryKeys = enKeys.filter((key) => key.startsWith('memory.'));
  assert.ok(memoryKeys.length > 100, `memory family should be fully i18n'd (${memoryKeys.length} keys)`);
  for (const key of memoryKeys) {
    assert.ok(zhKeys.has(key), `zh-CN dictionary should include ${key}`);
  }
});
