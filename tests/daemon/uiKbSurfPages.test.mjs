import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { DICTIONARIES } = require('../../dist/ui/i18n.js');

async function startServer() {
  const server = createHttpServer({});
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server address');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test('GET /ui/kb serves the Knowledge page with console chrome', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/kb`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /data-kb-shell/);
  assert.match(html, /\/api\/kb\/list/);
  assert.match(html, /\/api\/kb\/study\/status/);
  assert.match(html, /data-kb-create-form/);
  assert.match(html, /data-kb-query-form/);
  assert.match(html, /data-kb-study-form/);
  // Topbar chrome: logo, injected controls, and the console nav.
  assert.match(html, /topbar-logo/);
  assert.match(html, /data-language-toggle/);
  assert.match(html, /data-settings-modal/);
  assert.match(html, /href="\/ui\/kb"[^>]*class="active"|class="active"[^>]*href="\/ui\/kb"/);
  // The client i18n script re-applies the tab title from this key.
  assert.match(html, /<title data-i18n-title="kb\.title">Knowledge — Open Agent Connect<\/title>/);
});

test('GET /ui/surf serves the Surf page with console chrome', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/surf`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /data-surf-shell/);
  assert.match(html, /\/api\/surf\/status/);
  assert.match(html, /\/api\/surf\/run/);
  assert.match(html, /data-surf-budget-form/);
  assert.match(html, /data-surf-reports-table/);
  assert.match(html, /data-language-toggle/);
  assert.match(html, /href="\/ui\/surf"[^>]*class="active"|class="active"[^>]*href="\/ui\/surf"/);
  assert.match(html, /<title data-i18n-title="surf\.title">Surf — Open Agent Connect<\/title>/);
});

test('GET /ui/kb and /ui/surf localize to Simplified Chinese with lang=zh-CN', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const kbResponse = await fetch(`${server.baseUrl}/ui/kb?lang=zh-CN`);
  const kbHtml = await kbResponse.text();
  assert.equal(kbResponse.status, 200);
  assert.match(kbHtml, /知识库 — Open Agent Connect/);
  assert.match(kbHtml, /<title data-i18n-title="kb\.title">知识库 — Open Agent Connect<\/title>/);
  assert.match(kbHtml, /创建知识库/);
  assert.match(kbHtml, /加入学习任务/);

  const surfResponse = await fetch(`${server.baseUrl}/ui/surf?lang=zh-CN`);
  const surfHtml = await surfResponse.text();
  assert.equal(surfResponse.status, 200);
  assert.match(surfHtml, /冲浪 — Open Agent Connect/);
  assert.match(surfHtml, /<title data-i18n-title="surf\.title">冲浪 — Open Agent Connect<\/title>/);
  assert.match(surfHtml, /立即冲浪/);
});

test('console navigation includes Knowledge and Surf between Apps and the trailing controls', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/kb`);
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
  ];
  let lastIndex = -1;
  for (const href of order) {
    const index = nav.indexOf(`href="${href}"`);
    assert.notEqual(index, -1, `nav should contain ${href}`);
    assert.ok(index > lastIndex, `${href} should follow the previous nav item`);
    lastIndex = index;
  }
  assert.match(nav, /data-i18n-key="nav.knowledge"/);
  assert.match(nav, /data-i18n-key="nav.surf"/);
});

test('GET /ui/<unknown> still rejects pages that are not registered', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/not-a-page`);
  const payload = await response.json();
  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'not_found');
});

test('i18n dictionaries keep surf/kb/nav/time key parity between en and zh-CN', () => {
  const enKeys = Object.keys(DICTIONARIES.en);
  const zhKeys = new Set(Object.keys(DICTIONARIES['zh-CN']));
  assert.equal(enKeys.length, zhKeys.size, 'dictionaries should hold the same number of keys');
  const missingInZh = enKeys.filter((key) => !zhKeys.has(key));
  assert.deepEqual(missingInZh, []);

  const requiredFamilies = ['nav.knowledge', 'nav.surf', 'time.justNow'];
  for (const key of requiredFamilies) {
    assert.ok(enKeys.includes(key), `en dictionary should include ${key}`);
    assert.ok(zhKeys.has(key), `zh-CN dictionary should include ${key}`);
  }
  for (const family of ['surf.', 'kb.']) {
    const familyKeys = enKeys.filter((key) => key.startsWith(family));
    assert.ok(familyKeys.length > 20, `${family} family should be fully i18n'd`);
    for (const key of familyKeys) {
      assert.ok(zhKeys.has(key), `zh-CN dictionary should include ${key}`);
    }
  }
});
