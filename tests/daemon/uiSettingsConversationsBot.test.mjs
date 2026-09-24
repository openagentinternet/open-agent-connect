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

test('GET /ui/settings serves the owner identity (User) section in English', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/settings`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-user-section/);
  assert.match(html, /data-i18n-key="settings\.user\.title"/);
  assert.match(html, /settings\.user\.verbWho/);
  assert.match(html, /settings\.user\.verbCreate/);
  assert.match(html, /settings\.user\.verbImport/);
  assert.match(html, /settings\.user\.verbRename/);
  assert.match(html, /settings\.user\.verbReveal/);
  assert.match(html, /settings\.user\.verbDelete/);
  assert.match(html, /settings\.user\.consoleNote/);
  assert.match(html, /<code>metabot user who<\/code>/);
});

test('GET /ui/settings localizes the User section to Simplified Chinese with lang=zh-CN', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/settings?lang=zh-CN`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-user-section/);
  assert.match(html, /所有者身份/);
  assert.match(html, /查看当前所有者身份/);
  assert.match(html, /metabot user 命令/);
});

test('GET /ui/conversations serves the group-task section with console chrome', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/conversations`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-view-toggle="conversations"/);
  assert.match(html, /data-view-toggle="grouptask"/);
  assert.match(html, /data-grouptask-shell/);
  assert.match(html, /\/api\/grouptask\/list/);
  assert.match(html, /\/api\/grouptask\/detail/);
  assert.match(html, /\/api\/grouptask\/messages/);
  assert.match(html, /\/api\/grouptask\/close/);
  assert.match(html, /\/api\/grouptask\/reopen/);
  assert.match(html, /\/api\/grouptask\/member\/kick/);
  assert.match(html, /data-grouptask-list/);
  assert.match(html, /data-grouptask-detail-body/);
  assert.match(html, /data-i18n-key="conversations\.grouptask\.title"/);
});

test('GET /ui/conversations localizes the group-task section to Simplified Chinese', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/conversations?lang=zh-CN`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /群组任务/);
  assert.match(html, /选择一个群组任务/);
});

test('GET /ui/bot links Knowledge and Scheduled entries to the standalone pages', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/bot`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-tab-link="kb"[^>]*href="\/ui\/kb"/);
  assert.match(html, /data-tab-link="schedule"[^>]*href="\/ui\/schedule"/);
  assert.match(html, /data-i18n-key="bot\.knowledgeTab"/);
  assert.match(html, /data-i18n-key="bot\.scheduledTab"/);
});

test('GET /ui/bot localizes the Knowledge and Scheduled entries to Simplified Chinese', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/ui/bot?lang=zh-CN`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /data-tab-link="kb"/);
  assert.match(html, /data-tab-link="schedule"/);
  assert.match(html, /知识库/);
  assert.match(html, /定时任务/);
});

test('i18n debt pages render byte-identical English chrome and full Simplified Chinese', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const cases = [
    {
      page: 'hub',
      en: [/Online Services/, /LIVE SERVICES/, /data-i18n-key="hub\.colAction"/],
      zh: [/在线服务/, /实时服务/],
    },
    {
      page: 'publish',
      en: [/data-i18n-key="publish\.providerMetabot"/, /data-i18n-key="publish\.publishService"/],
      zh: [/提供方 MetaBot/, /发布服务/],
    },
    {
      page: 'refund',
      en: [/data-i18n-key="refund\.summaryTitle"/, /Local refund work queue/],
      zh: [/本地退款工作队列/, /需要我处理的退款/],
    },
  ];

  for (const { page, en, zh } of cases) {
    const enResponse = await fetch(`${server.baseUrl}/ui/${page}`);
    const enHtml = await enResponse.text();
    assert.equal(enResponse.status, 200, `${page} should render in English`);
    for (const pattern of en) {
      assert.match(enHtml, pattern, `${page} en render should match ${pattern}`);
    }

    const zhResponse = await fetch(`${server.baseUrl}/ui/${page}?lang=zh-CN`);
    const zhHtml = await zhResponse.text();
    assert.equal(zhResponse.status, 200, `${page} should render in Simplified Chinese`);
    for (const pattern of zh) {
      assert.match(zhHtml, pattern, `${page} zh-CN render should match ${pattern}`);
    }
  }
});

test('i18n dictionaries keep exact en/zh-CN parity after the C2 paydown', () => {
  const enKeys = Object.keys(DICTIONARIES.en);
  const zhKeys = new Set(Object.keys(DICTIONARIES['zh-CN']));
  assert.equal(enKeys.length, zhKeys.size, 'dictionaries should hold the same number of keys');
  const missingInZh = enKeys.filter((key) => !zhKeys.has(key));
  assert.deepEqual(missingInZh, []);

  const requiredFamilies = [
    'settings.user.title',
    'conversations.grouptask.title',
    'bot.knowledgeTab',
    'bot.scheduledTab',
    'hub.title',
    'publish.title',
    'refund.title',
  ];
  for (const key of requiredFamilies) {
    assert.ok(enKeys.includes(key), `en dictionary should include ${key}`);
    assert.ok(zhKeys.has(key), `zh-CN dictionary should include ${key}`);
  }
  for (const family of ['hub.', 'publish.', 'refund.', 'settings.user.', 'conversations.grouptask.']) {
    const familyKeys = enKeys.filter((key) => key.startsWith(family));
    assert.ok(familyKeys.length > 5, `${family} family should be fully i18n'd`);
    for (const key of familyKeys) {
      assert.ok(zhKeys.has(key), `zh-CN dictionary should include ${key}`);
    }
  }
});
