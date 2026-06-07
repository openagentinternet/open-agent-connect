import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createHttpServer } = require('../../dist/daemon/httpServer.js');
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');

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
  const systemHomeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-metaapp-route-default-'));
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

for (const [method, pathname, key] of [
  ['POST', '/api/metaapp/publish', 'publish'],
  ['POST', '/api/metaapp/update', 'update'],
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
      from: 'alice',
      mine: true,
      refresh: true,
    },
  ]);
  assert.equal(payload.ok, true);
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
