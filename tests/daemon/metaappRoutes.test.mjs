import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');
const { upsertIdentityProfile } = require('../../dist/core/identity/identityProfiles.js');
const { createMetaAppLocalCacheStore } = require('../../dist/core/metaapp/localCache.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');

const ALICE_MVC_ADDRESS = '16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS';
const TARGET_PIN_ID = '6ea8a0bd0bac9a9c6cf4e035e9ce0a18e3a89f390c355dcc43074010fbee7ee7i0';

function aliceIdentity() {
  return {
    metabotId: 1,
    name: 'alice',
    createdAt: 1_777_600_000_000,
    path: "m/44'/10001'/0'/0/0",
    publicKey: 'alice-public-key',
    chatPublicKey: 'alice-chat-public-key',
    addresses: {
      mvc: ALICE_MVC_ADDRESS,
    },
    mvcAddress: ALICE_MVC_ADDRESS,
    metaId: 'metaid-alice',
    globalMetaId: 'idq1alice',
    subsidyState: 'claimed',
    syncState: 'synced',
  };
}

async function createAliceFixture(t, options = {}) {
  const homeDir = await createProfileHome('metabot-metaapp-routes-', 'alice');
  const systemHomeDir = deriveSystemHome(homeDir);
  t.after(async () => cleanupProfileHome(homeDir));
  await upsertIdentityProfile({
    systemHomeDir,
    name: 'alice',
    homeDir,
    globalMetaId: 'idq1alice',
    mvcAddress: ALICE_MVC_ADDRESS,
  });
  if (options.withIdentity !== false) {
    await createRuntimeStateStore(homeDir).writeState({
      identity: aliceIdentity(),
      services: [],
      traces: [],
      sellerOrders: [],
    });
  }
  return { homeDir, systemHomeDir };
}

function fakeSigner(writes = []) {
  return {
    writePin: async (input) => {
      writes.push(input);
      const index = writes.length;
      const pinIds = [
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbi0',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccci0',
      ];
      return {
        pinId: pinIds[index - 1] ?? pinIds[0],
        txids: [`metaapp-write-tx-${index}`],
        totalCost: index,
        network: input.network ?? 'mvc',
        operation: input.operation,
        path: input.path,
        contentType: input.contentType,
      };
    },
  };
}

function localMetaAppRecord(pinId, overrides = {}) {
  return {
    pinId,
    firstPinId: overrides.firstPinId ?? pinId,
    operation: overrides.operation ?? 'create',
    title: overrides.title ?? 'Local MetaAPP',
    appName: overrides.appName ?? 'local-metaapp',
    version: overrides.version ?? '1.0.0',
    runtime: overrides.runtime ?? 'browser',
    indexFile: overrides.indexFile ?? 'index.html',
    code: overrides.code ?? `metafile://${pinId}.zip`,
    content: overrides.content ?? `metafile://${pinId}.zip`,
    contentType: overrides.contentType ?? 'application/zip',
    codeType: overrides.codeType ?? 'application/zip',
    tags: overrides.tags ?? [],
    ownerGlobalMetaId: overrides.ownerGlobalMetaId ?? 'idq1alice',
    ownerAddress: overrides.ownerAddress ?? ALICE_MVC_ADDRESS,
    network: overrides.network ?? 'mvc',
    metawebUrl: overrides.metawebUrl ?? `https://openagentinternet.org/browser/metaapp/${pinId}`,
    updatedAt: overrides.updatedAt ?? 1_700_000_000_000,
    source: overrides.source ?? 'local',
    raw: overrides.raw,
  };
}

async function startServer(handlers = {}) {
  const server = createHttpServer(handlers);

  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Expected TCP server address');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function fetchJson(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method ?? 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  return {
    response,
    payload: await response.json(),
  };
}

test('POST /api/metaapp/preview forwards the JSON body to metaapp.preview', async (t) => {
  const calls = [];
  const server = await startServer({
    metaapp: {
      preview: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: {
            previewId: 'metaapp-preview-1',
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapp/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectDir: '/tmp/metaapp-project',
      manifestFile: 'metaapp.json',
      open: true,
    }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      projectDir: '/tmp/metaapp-project',
      manifestFile: 'metaapp.json',
      open: true,
    },
  ]);
  assert.equal(payload.ok, true);
});

test('GET /api/metaapp/preview-assets/<previewId>/index.html forwards the asset lookup', async (t) => {
  const calls = [];
  const server = await startServer({
    metaapp: {
      previewAsset: async (input) => {
        calls.push(input);
        return {
          body: '<!doctype html><title>MetaApp</title>',
          contentType: 'text/html; charset=utf-8',
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapp/preview-assets/metaapp-preview-1/index.html`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      previewId: 'metaapp-preview-1',
      assetPath: 'index.html',
    },
  ]);
  assert.equal(body, '<!doctype html><title>MetaApp</title>');
  assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});

test('GET /api/metaapp/preview-assets/<previewId>/missing.html maps failed asset results to non-success responses', async (t) => {
  const server = await startServer({
    metaapp: {
      previewAsset: async () => ({
        ok: false,
        state: 'failed',
        code: 'preview_asset_not_found',
        message: 'Preview asset was not found.',
      }),
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapp/preview-assets/metaapp-preview-1/missing.html`);
  const body = await response.text();

  assert.equal(response.status, 404);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/i);
  assert.doesNotMatch(body, /<!doctype html>/i);
  assert.doesNotMatch(body, /<title>MetaApp<\/title>/i);
  assert.match(body, /preview_asset_not_found/);
});

test('GET /api/metaapp/preview-assets from default handlers preserves registry failure codes', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-metaapp-route-default-');
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'alice');
  await mkdir(homeDir, { recursive: true });
  const server = await startServer(createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  }));
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapp/preview-assets/missing-preview/index.html`);
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'preview_session_not_found');
});

test('GET /api/browser/resolve serves preview-metaapp://localhost assets live from the workspace', async (t) => {
  const systemHomeDir = await mkdtempTempRoot('metabot-metaapp-route-preview-metaapp-');
  const homeDir = path.join(systemHomeDir, '.metabot', 'profiles', 'alice');
  await mkdir(homeDir, { recursive: true });
  const workspaceDir = await mkdtempTempRoot('metabot-preview-metaapp-live-');
  await writeFile(path.join(workspaceDir, 'index.html'), '<!doctype html><title>live-v1</title>', 'utf8');
  const server = await startServer(createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
  }));
  t.after(async () => server.close());

  const uri = `preview-metaapp://localhost${workspaceDir}`;
  const resolvedResponse = await fetch(`${server.baseUrl}/api/browser/resolve?uri=${encodeURIComponent(uri)}`);
  const resolved = await resolvedResponse.json();

  assert.equal(resolved.ok, true);
  assert.equal(resolved.data.resourceType, 'metaapp');
  assert.equal(resolved.data.renderer.type, 'html-iframe');
  assert.match(resolved.data.renderer.url, /^\/api\/metaapp\/preview-assets\/metaapp-preview-[^/]+\/index\.html$/);

  const assetResponse = await fetch(`${server.baseUrl}${resolved.data.renderer.url}`);
  assert.equal(assetResponse.status, 200);
  assert.equal(await assetResponse.text(), '<!doctype html><title>live-v1</title>');

  // Serving is live: edits on disk are picked up on the next fetch.
  await writeFile(path.join(workspaceDir, 'index.html'), '<!doctype html><title>live-v2</title>', 'utf8');
  const reloadedResponse = await fetch(`${server.baseUrl}${resolved.data.renderer.url}`);
  assert.equal(reloadedResponse.status, 200);
  assert.equal(await reloadedResponse.text(), '<!doctype html><title>live-v2</title>');
});

test('GET /api/metaapp/list forwards owner list query params to metaapp.list', async (t) => {
  const calls = [];
  const server = await startServer({
    metaapp: {
      list: async (input) => {
        calls.push(input);
        return commandSuccess({ records: [], nextCursor: 'cursor-2' });
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapp/list?from=alice&cursor=cursor-1&size=12&refresh=true`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.deepEqual(calls, [{ scope: 'owner', from: 'alice', cursor: 'cursor-1', size: 12, refresh: true }]);
});

test('POST /api/metaapp/delete forwards JSON body to metaapp.delete', async (t) => {
  const calls = [];
  const server = await startServer({
    metaapp: {
      delete: async (input) => {
        calls.push(input);
        return commandSuccess({ revokedPinId: input.targetPinId });
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapp/delete`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'alice', targetPinId: 'a'.repeat(64) + 'i0', confirm: true }),
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(calls[0].from, 'alice');
  assert.equal(calls[0].confirm, true);
});

for (const [method, pathname, key] of [
  ['POST', '/api/metaapp/publish', 'publish'],
  ['POST', '/api/metaapp/update', 'update'],
  ['POST', '/api/metaapp/publish-project', 'publishProject'],
  ['POST', '/api/metaapp/update-project', 'updateProject'],
  ['POST', '/api/metaapp/share', 'share'],
  ['POST', '/api/metaapp/comment', 'comment'],
] ) {
  test(`${method} ${pathname} forwards the JSON body to metaapp.${key}`, async (t) => {
    const calls = [];
    const server = await startServer({
      metaapp: {
        [key]: async (input) => {
          calls.push(input);
          return {
            ok: true,
            state: 'success',
            data: { ok: true },
          };
        },
      },
    });
    t.after(async () => server.close());

    const response = await fetch(`${server.baseUrl}${pathname}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectDir: '/tmp/metaapp-project',
        from: 'alice',
        pinId: 'a'.repeat(64) + 'i0',
      }),
    });
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].projectDir, '/tmp/metaapp-project');
  });
}

test('GET /api/metaapps forwards from/mine and refresh query params to metaapp.list', async (t) => {
  const calls = [];
  const server = await startServer({
    metaapp: {
      list: async (input) => {
        calls.push(input);
        return {
          ok: true,
          state: 'success',
          data: {
            records: [],
          },
        };
      },
    },
  });
  t.after(async () => server.close());

  const response = await fetch(`${server.baseUrl}/api/metaapps?from=alice&mine=true&refresh=true`);
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    {
      scope: 'compatibility',
      from: 'alice',
      mine: true,
      refresh: true,
    },
  ]);
  assert.equal(payload.ok, true);
});

test('GET /api/metaapps pinId query matches a modified record firstPinId', async (t) => {
  const fixture = await createAliceFixture(t);
  const cache = createMetaAppLocalCacheStore(fixture.homeDir);
  const updatedPinId = `${'d'.repeat(64)}i0`;
  await cache.upsertLocal(localMetaAppRecord(updatedPinId, {
    firstPinId: TARGET_PIN_ID,
    title: 'Modified Local MetaAPP',
    metawebUrl: `https://openagentinternet.org/browser/metaapp/${TARGET_PIN_ID}`,
  }));

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const { payload } = await fetchJson(server.baseUrl, `/api/metaapps?from=alice&pinId=${TARGET_PIN_ID}`);

  assert.equal(payload.ok, true);
  assert.equal(payload.data.records.length, 1);
  assert.equal(payload.data.records[0].pinId, updatedPinId);
  assert.equal(payload.data.records[0].firstPinId, TARGET_PIN_ID);
});

test('default metaapp owner list uses selected Bot MVC address against MAN', async (t) => {
  const fixture = await createAliceFixture(t);
  const urls = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
    metaAppManFetch: async (url) => {
      urls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({ code: 1, data: { list: [], nextCursor: '', total: 0 } }),
      };
    },
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const { payload } = await fetchJson(server.baseUrl, '/api/metaapp/list?from=alice&size=12');

  assert.equal(payload.ok, true);
  assert.equal(urls.length, 1);
  const manUrl = urls[0];
  assert.match(manUrl, /\/address\/pin\/list\/16UjcYNBG9GTK4uq2f7yYEbuifqCzoLMGS\?/);
  assert.match(manUrl, /(?:\?|&)path=%2Fprotocols%2Fmetaapp(?:&|$)/);
});

test('default metaapp owner publish update and delete write expected chain operations', async (t) => {
  const fixture = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => ({ baseUrl: 'http://127.0.0.1:24885' }),
    signer: fakeSigner(writes),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());
  const body = {
    from: 'alice',
    title: 'Agent Wiki Builder',
    appName: 'Agent Wiki Builder',
    icon: TARGET_PIN_ID,
    coverImg: TARGET_PIN_ID,
    introImgs: [TARGET_PIN_ID],
    runtime: ['browser'],
    content: TARGET_PIN_ID,
    code: TARGET_PIN_ID,
    confirm: true,
  };

  const publish = await fetchJson(server.baseUrl, '/api/metaapp/publish', {
    method: 'POST',
    body,
  });
  const update = await fetchJson(server.baseUrl, '/api/metaapp/update', {
    method: 'POST',
    body: { ...body, targetPinId: TARGET_PIN_ID, disabled: true },
  });
  await fetchJson(server.baseUrl, '/api/metaapp/delete', {
    method: 'POST',
    body: { from: 'alice', targetPinId: TARGET_PIN_ID, confirm: true },
  });

  assert.equal(writes.length, 3);
  assert.equal(writes[0].operation, 'create');
  assert.equal(writes[0].path, '/protocols/metaapp');
  assert.equal(writes[0].contentType, 'application/json');
  assert.equal(JSON.parse(writes[0].payload).content, `metafile://${TARGET_PIN_ID}`);
  assert.equal(writes[1].operation, 'modify');
  assert.equal(writes[1].path, `@${TARGET_PIN_ID}`);
  assert.equal(JSON.parse(writes[1].payload).disabled, true);
  assert.equal(writes[2].operation, 'revoke');
  assert.equal(writes[2].path, `@${TARGET_PIN_ID}`);
  assert.match(publish.payload.data.localUiUrl, /^http:\/\/127\.0\.0\.1:24885\/ui\/apps\?/);
  assert.match(update.payload.data.localUiUrl, /^http:\/\/127\.0\.0\.1:24885\/ui\/apps\?/);
});

test('default metaapp owner delete hides matching local cache records immediately', async (t) => {
  const fixture = await createAliceFixture(t);
  await createMetaAppLocalCacheStore(fixture.homeDir).upsertLocal(localMetaAppRecord(TARGET_PIN_ID, {
    title: 'Stale Local MetaAPP',
  }));
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const deleted = await fetchJson(server.baseUrl, '/api/metaapp/delete', {
    method: 'POST',
    body: { from: 'alice', targetPinId: TARGET_PIN_ID, confirm: true },
  });
  const listed = await fetchJson(server.baseUrl, '/api/metaapps?from=alice&mine=true');

  assert.equal(deleted.payload.ok, true);
  assert.deepEqual(
    listed.payload.data.records.map((record) => record.pinId),
    [],
  );
});

test('default metaapp owner list hides MAN records revoked in local cache', async (t) => {
  const fixture = await createAliceFixture(t);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
    metaAppManFetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        code: 1,
        data: {
          list: [
            {
              id: TARGET_PIN_ID,
              operation: 'create',
              timestamp: 1_700_000_000_000,
              content: JSON.stringify({
                title: 'Deleted MetaAPP still visible from MAN',
                appName: 'deleted-metaapp',
                runtime: 'browser',
                version: '1.0.0',
                contentType: 'application/zip',
                codeType: 'application/zip',
                content: `metafile://${TARGET_PIN_ID}.zip`,
                code: `metafile://${TARGET_PIN_ID}.zip`,
              }),
            },
          ],
          nextCursor: '',
          total: 1,
        },
      }),
    }),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const deleted = await fetchJson(server.baseUrl, '/api/metaapp/delete', {
    method: 'POST',
    body: { from: 'alice', targetPinId: TARGET_PIN_ID, confirm: true },
  });
  const listed = await fetchJson(server.baseUrl, '/api/metaapp/list?from=alice&size=12');

  assert.equal(deleted.payload.ok, true);
  assert.deepEqual(
    listed.payload.data.records.map((record) => record.pinId),
    [],
  );
});

test('default metaapp owner publish keeps pin id in relative localUiUrl without daemon record', async (t) => {
  const fixture = await createAliceFixture(t);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const publish = await fetchJson(server.baseUrl, '/api/metaapp/publish', {
    method: 'POST',
    body: {
      from: 'alice',
      title: 'Agent Wiki Builder',
      appName: 'Agent Wiki Builder',
      icon: TARGET_PIN_ID,
      coverImg: TARGET_PIN_ID,
      runtime: ['browser'],
      content: TARGET_PIN_ID,
      code: TARGET_PIN_ID,
      confirm: true,
    },
  });

  assert.equal(publish.payload.data.localUiUrl, '/ui/apps?pinId=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0');
});

test('default metaapp owner update returns stable view links keyed by the original pin', async (t) => {
  const fixture = await createAliceFixture(t);
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const update = await fetchJson(server.baseUrl, '/api/metaapp/update', {
    method: 'POST',
    body: {
      from: 'alice',
      targetPinId: TARGET_PIN_ID,
      title: 'Updated Agent Wiki Builder',
      appName: 'Updated Agent Wiki Builder',
      icon: TARGET_PIN_ID,
      coverImg: TARGET_PIN_ID,
      runtime: ['browser'],
      content: TARGET_PIN_ID,
      code: TARGET_PIN_ID,
      confirm: true,
    },
  });

  assert.equal(update.payload.ok, true);
  assert.equal(update.payload.data.pinId, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaai0');
  assert.equal(update.payload.data.firstPinId, TARGET_PIN_ID);
  assert.equal(update.payload.data.metawebUrl, `https://openagentinternet.org/browser/metaapp/${TARGET_PIN_ID}`);
  assert.equal(update.payload.data.localUiUrl, `/ui/apps?pinId=${TARGET_PIN_ID}`);
});

test('default metaapp owner publish and update accept empty optional asset fields', async (t) => {
  const fixture = await createAliceFixture(t);
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(writes),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());
  const body = {
    from: 'alice',
    title: 'Minimal MetaAPP',
    appName: 'Minimal MetaAPP',
    icon: '',
    coverImg: '',
    introImgs: '',
    runtime: ['browser'],
    content: TARGET_PIN_ID,
    code: '',
    confirm: true,
  };

  const publish = await fetchJson(server.baseUrl, '/api/metaapp/publish', {
    method: 'POST',
    body,
  });
  const update = await fetchJson(server.baseUrl, '/api/metaapp/update', {
    method: 'POST',
    body: { ...body, targetPinId: TARGET_PIN_ID },
  });

  assert.equal(publish.payload.ok, true);
  assert.equal(update.payload.ok, true);
  assert.equal(writes.length, 2);
  const publishedPayload = JSON.parse(writes[0].payload);
  assert.equal(Object.prototype.hasOwnProperty.call(publishedPayload, 'icon'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(publishedPayload, 'coverImg'), false);
  assert.deepEqual(publishedPayload.introImgs, []);
  assert.equal(publishedPayload.content, `metafile://${TARGET_PIN_ID}`);
});

test('default metaapp owner list returns identity_missing when selected Bot has no runtime identity', async (t) => {
  const fixture = await createAliceFixture(t, { withIdentity: false });
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir: fixture.homeDir,
    systemHomeDir: fixture.systemHomeDir,
    getDaemonRecord: () => null,
    signer: fakeSigner(),
  });
  const server = await startServer(handlers);
  t.after(async () => server.close());

  const { payload } = await fetchJson(server.baseUrl, '/api/metaapp/list?from=alice');

  assert.equal(payload.ok, false);
  assert.equal(payload.code, 'identity_missing');
});

test('non-GET and non-POST metaapp routes return method_not_allowed', async (t) => {
  const server = await startServer();
  t.after(async () => server.close());

  const previewResponse = await fetch(`${server.baseUrl}/api/metaapp/publish`, {
    method: 'PUT',
  });
  const listResponse = await fetch(`${server.baseUrl}/api/metaapps`, {
    method: 'DELETE',
  });

  assert.equal(previewResponse.status, 405);
  assert.equal(listResponse.status, 405);
  assert.deepEqual(await previewResponse.json(), {
    ok: false,
    state: 'failed',
    code: 'method_not_allowed',
    message: 'Expected POST.',
  });
  assert.deepEqual(await listResponse.json(), {
    ok: false,
    state: 'failed',
    code: 'method_not_allowed',
    message: 'Expected GET.',
  });
});
