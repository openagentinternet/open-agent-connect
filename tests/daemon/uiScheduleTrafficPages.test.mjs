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

test('GET /ui/schedule serves the Schedule page with console chrome and the schedule API surface', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/schedule`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /data-schedule-shell/);
  // Every management verb the page script talks to is wired in.
  assert.match(html, /\/api\/schedule\/list/);
  assert.match(html, /\/api\/schedule\/runs/);
  assert.match(html, /\/api\/schedule\/create/);
  assert.match(html, /\/api\/schedule\/update/);
  assert.match(html, /\/api\/schedule\/delete/);
  assert.match(html, /\/api\/schedule\/enable/);
  assert.match(html, /\/api\/schedule\/disable/);
  // Bot scoping for the per-Bot store.
  assert.match(html, /\/api\/bot\/profiles/);
  assert.match(html, /data-schedule-bot-select/);
  assert.match(html, /data-schedule-editor/);
  assert.match(html, /data-schedule-runs-card/);
  // Topbar chrome: logo, injected controls, and the console nav.
  assert.match(html, /topbar-logo/);
  assert.match(html, /data-language-toggle/);
  assert.match(html, /data-settings-modal/);
  assert.match(html, /href="\/ui\/schedule"[^>]*class="active"|class="active"[^>]*href="\/ui\/schedule"/);
});

test('GET /ui/traffic serves the Traffic page with console chrome and the traffic API surface', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/traffic`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/i);
  assert.match(html, /data-traffic-shell/);
  // Every verb the page script talks to is wired in.
  assert.match(html, /\/api\/traffic\/status/);
  assert.match(html, /\/api\/traffic\/mode/);
  assert.match(html, /\/api\/traffic\/balance/);
  assert.match(html, /\/api\/traffic\/ledger/);
  assert.match(html, /\/api\/traffic\/usage/);
  assert.match(html, /\/api\/traffic\/claim/);
  assert.match(html, /\/api\/traffic\/redeem/);
  assert.match(html, /\/api\/traffic\/api-base/);
  assert.match(html, /data-traffic-mode-seg/);
  assert.match(html, /data-traffic-meter/);
  assert.match(html, /data-traffic-ledger-table/);
  assert.match(html, /topbar-logo/);
  assert.match(html, /data-language-toggle/);
});

test('GET /ui/schedule localizes to Simplified Chinese with lang=zh-CN', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/schedule?lang=zh-CN`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /定时任务 — Open Agent Connect/);
  assert.match(html, /新建任务/);
  assert.match(html, /没有本地 Bot。|选择要管理的 Bot。/);
});

test('GET /ui/traffic localizes to Simplified Chinese with lang=zh-CN', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/traffic?lang=zh-CN`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /流量 — Open Agent Connect/);
  assert.match(html, /计费模式/);
  assert.match(html, /可用余额/);
  assert.match(html, /兑换码/);
});

test('console navigation includes Schedule after Memory and leaves Traffic to the settings link', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/schedule`);
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
    '/ui/schedule',
  ];
  let lastIndex = -1;
  for (const href of order) {
    const index = nav.indexOf(`href="${href}"`);
    assert.notEqual(index, -1, `nav should contain ${href}`);
    assert.ok(index > lastIndex, `${href} should follow the previous nav item`);
    lastIndex = index;
  }
  assert.match(nav, /data-i18n-key="nav.schedule"/);
  assert.doesNotMatch(nav, /href="\/ui\/traffic"/);
});

test('GET /ui/settings links to the Traffic page without adding it to top navigation', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/settings`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /href="\/ui\/traffic"/);
  assert.match(html, /data-i18n-key="settings\.traffic\.title"/);
  const navMatch = html.match(/<nav class="topbar-nav">([\s\S]*?)<\/nav>/);
  assert.ok(navMatch, 'topbar nav rendered');
  assert.doesNotMatch(navMatch[1], /href="\/ui\/traffic"/);
});

test('schedule and traffic pages reject non-GET methods', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  for (const path of ['/ui/schedule', '/ui/traffic']) {
    const response = await fetch(`${server.baseUrl}${path}`, { method: 'POST' });
    assert.equal(response.status, 405, `${path} should reject POST`);
    assert.match(response.headers.get('allow') ?? '', /GET/);
  }
});

test('i18n dictionaries keep exact en/zh-CN parity including the schedule and traffic families', () => {
  const enKeys = Object.keys(DICTIONARIES.en);
  const zhKeys = new Set(Object.keys(DICTIONARIES['zh-CN']));
  assert.equal(enKeys.length, zhKeys.size, 'dictionaries should hold the same number of keys');
  const missingInZh = enKeys.filter((key) => !zhKeys.has(key));
  assert.deepEqual(missingInZh, []);

  for (const key of ['nav.schedule', 'settings.traffic.title', 'schedule.heading', 'traffic.heading']) {
    assert.ok(enKeys.includes(key), `en dictionary should include ${key}`);
    assert.ok(zhKeys.has(key), `zh-CN dictionary should include ${key}`);
  }
  const scheduleKeys = enKeys.filter((key) => key.startsWith('schedule.'));
  assert.ok(scheduleKeys.length > 60, `schedule family should be fully i18n'd (${scheduleKeys.length} keys)`);
  const trafficKeys = enKeys.filter((key) => key.startsWith('traffic.'));
  assert.ok(trafficKeys.length > 70, `traffic family should be fully i18n'd (${trafficKeys.length} keys)`);
});
