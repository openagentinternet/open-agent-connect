import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { buildMetaAppsPageDefinition } = require('../../dist/ui/pages/metaapps/app.js');

function createFakeMetaAppsElement() {
  return {
    dataset: {},
    disabled: false,
    innerHTML: '',
    textContent: '',
    addEventListener() {},
  };
}

async function renderMetaAppsPage(records, search = '') {
  const elements = {
    list: createFakeMetaAppsElement(),
    detail: createFakeMetaAppsElement(),
    refresh: createFakeMetaAppsElement(),
    status: createFakeMetaAppsElement(),
  };
  const selectors = new Map([
    ['[data-metaapps-list]', elements.list],
    ['[data-metaapps-detail]', elements.detail],
    ['[data-metaapps-refresh]', elements.refresh],
    ['[data-metaapps-status]', elements.status],
  ]);
  let jsonRead;
  const jsonReadPromise = new Promise((resolve) => {
    jsonRead = resolve;
  });
  const context = {
    URL,
    URLSearchParams,
    document: {
      querySelector(selector) {
        return selectors.get(selector) ?? null;
      },
    },
    fetch: async () => ({
      ok: true,
      json: async () => {
        jsonRead();
        return { ok: true, data: { records } };
      },
    }),
    navigator: {},
    window: {
      location: {
        origin: 'http://127.0.0.1:24885',
        search,
      },
    },
  };

  vm.runInNewContext(buildMetaAppsPageDefinition().script, context, { timeout: 1000 });
  await jsonReadPromise;
  await new Promise((resolve) => setImmediate(resolve));
  return elements.detail.innerHTML;
}

function readMetaAppsActionLinks(detailHtml) {
  return [...detailHtml.matchAll(/<a class="metaapps-action" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)]
    .map((match) => ({ href: match[1], label: match[2] }));
}

test('metaapps page script prefers the Open Agent Internet MetaApp URL for open and share actions', async () => {
  const pinId = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';
  const detailHtml = await renderMetaAppsPage([{
    pinId,
    firstPinId: pinId,
    title: 'Shared MetaApp',
    appName: 'Shared MetaApp',
    version: '1.0.0',
    runtime: 'browser',
    network: 'mvc',
    ownerGlobalMetaId: 'idq1alice',
    ownerAddress: 'alice-address',
    source: 'indexer',
    updatedAt: 1_700_000_000_000,
    runUrl: `/browser/metaapp/${pinId}`,
    metawebUrl: `https://metaweb.world/metaapp/${pinId}`,
  }]);
  const links = readMetaAppsActionLinks(detailHtml);
  const openLink = links.find((entry) => entry.label === 'Open');

  assert.equal(openLink?.href, `https://openagentinternet.org/browser/metaapp/${pinId}`);
  assert.match(detailHtml, new RegExp(`data-metaapps-share="https://openagentinternet\\.org/browser/metaapp/${pinId}"`));
});
