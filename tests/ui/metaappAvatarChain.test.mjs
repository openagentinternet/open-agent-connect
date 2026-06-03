import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const helperPaths = [
  new URL('../../src/ui/metaapps/chat/idframework/utils/avatar-chain.js', import.meta.url),
  new URL('../../src/ui/metaapps/buzz/idframework/utils/avatar-chain.js', import.meta.url),
];

async function loadHelper(fileUrl) {
  const source = await readFile(fileUrl, 'utf8');
  const script = new vm.Script(`${source.replace('export function buildAvatarMetaidData', 'function buildAvatarMetaidData')}\nexports.buildAvatarMetaidData = buildAvatarMetaidData;`);
  const context = vm.createContext({ exports: {} });
  script.runInContext(context);
  return context.exports;
}

test('metaapp avatar chain helper creates binary avatar metaidData', async () => {
  for (const helperPath of helperPaths) {
    const { buildAvatarMetaidData } = await loadHelper(helperPath);
    const metaidData = buildAvatarMetaidData({
      avatarBase64: 'ZmFrZQ==',
      avatarContentType: 'image/png',
      avatarId: '',
    });

    assert.deepEqual(JSON.parse(JSON.stringify(metaidData)), {
      operation: 'create',
      body: 'ZmFrZQ==',
      path: '/info/avatar',
      encoding: 'base64',
      contentType: 'image/png;binary',
    });
  }
});

test('metaapp avatar chain helper rejects data URL avatar bodies', async () => {
  const { buildAvatarMetaidData } = await loadHelper(helperPaths[0]);

  assert.throws(
    () => buildAvatarMetaidData({
      avatarBase64: 'data:image/png;base64,ZmFrZQ==',
      avatarContentType: 'image/png',
    }),
    /Avatar body must be raw base64 without a data URL prefix/u,
  );
});

test('metaapp avatar chain helper rejects malformed base64 avatar bodies', async () => {
  const { buildAvatarMetaidData } = await loadHelper(helperPaths[0]);

  assert.throws(
    () => buildAvatarMetaidData({
      avatarBase64: 'not raw base64!',
      avatarContentType: 'image/png',
    }),
    /Avatar body must be raw base64/u,
  );
});
