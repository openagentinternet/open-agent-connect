import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const helperPaths = [
  new URL('../../src/ui/metaapps/chat/idframework/utils/avatar-chain.js', import.meta.url),
  new URL('../../src/ui/metaapps/buzz/idframework/utils/avatar-chain.js', import.meta.url),
];

const connectButtonPaths = [
  new URL('../../src/ui/metaapps/chat/idframework/components/id-connect-button.js', import.meta.url),
  new URL('../../src/ui/metaapps/buzz/idframework/components/id-connect-button.js', import.meta.url),
];

async function loadHelper(fileUrl) {
  const source = await readFile(fileUrl, 'utf8');
  const script = new vm.Script(`${source.replace('export function buildAvatarMetaidData', 'function buildAvatarMetaidData')}\nexports.buildAvatarMetaidData = buildAvatarMetaidData;`);
  const context = vm.createContext({
    exports: {},
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
  });
  script.runInContext(context);
  return context.exports;
}

async function loadConnectButton(fileUrl, createPin) {
  const source = await readFile(fileUrl, 'utf8');
  const script = new vm.Script(`${source
    .replace("import { buildAvatarMetaidData } from '../utils/avatar-chain.js';", 'function buildAvatarMetaidData() { return null; }')
    .replace("customElements.define('id-connect-button', IdConnectButton);", 'exports.IdConnectButton = IdConnectButton;')}`);
  const context = vm.createContext({
    exports: {},
    window: {
      metaidwallet: { createPin },
    },
    customElements: {
      define() {},
    },
    HTMLElement: class {
      attachShadow() {
        return {
          addEventListener() {},
          querySelector() {
            return null;
          },
        };
      }
    },
  });
  script.runInContext(context);
  return context.exports;
}

test('metaapp avatar chain helper creates binary avatar metaidData', async () => {
  for (const helperPath of helperPaths) {
    const { buildAvatarMetaidData } = await loadHelper(helperPath);
    const metaidData = buildAvatarMetaidData({
      avatarBase64: 'ZmFrZQ==',
      avatarContentType: 'image/png',
      avatarId: 'old-avatar-pin',
    });

    assert.equal(metaidData.operation, 'create');
    assert.equal(metaidData.path, '/info/avatar');
    assert.equal(metaidData.encoding, 'binary');
    assert.equal(metaidData.contentType, 'image/png;binary');
    assert.equal(ArrayBuffer.isView(metaidData.body), true);
    assert.deepEqual(Array.from(metaidData.body), Array.from(Buffer.from('fake')));
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

test('metaapp id connect profile save creates fixed /info records instead of modifying old pins', async () => {
  for (const connectButtonPath of connectButtonPaths) {
    const createPinCalls = [];
    const { IdConnectButton } = await loadConnectButton(connectButtonPath, async (params) => {
      createPinCalls.push(params);
      return { txid: 'profile-save-tx' };
    });
    const button = new IdConnectButton();

    await button._createOrUpdateUserInfo({
      userData: {
        name: 'Alice Bot',
        bio: 'Builds protocol-compatible apps.',
        chatpubkey: 'new-chat-public-key',
      },
      oldUserData: {
        nameId: 'old-name-pin',
        bioId: 'old-bio-pin',
        chatpubkeyId: 'old-chatpubkey-pin',
      },
      options: {
        feeRate: 7,
      },
    });

    assert.equal(createPinCalls.length, 1);
    assert.equal(createPinCalls[0].feeRate, 7);
    const writes = JSON.parse(JSON.stringify(createPinCalls[0].dataList.map((item) => item.metaidData)));
    assert.deepEqual(writes.map((write) => write.path), ['/info/name', '/info/bio']);
    assert.deepEqual(writes.map((write) => write.operation), ['create', 'create']);
    assert.equal(writes.some((write) => write.path.startsWith('@')), false);
  }
});

test('metaapp id connect creates chat public key only when no previous key exists', async () => {
  for (const connectButtonPath of connectButtonPaths) {
    const createPinCalls = [];
    const { IdConnectButton } = await loadConnectButton(connectButtonPath, async (params) => {
      createPinCalls.push(params);
      return { txid: 'chatpubkey-create-tx' };
    });
    const button = new IdConnectButton();

    await button._createOrUpdateUserInfo({
      userData: {
        chatpubkey: 'new-chat-public-key',
      },
      oldUserData: {},
      options: {},
    });

    assert.equal(createPinCalls.length, 1);
    const writes = createPinCalls[0].dataList.map((item) => item.metaidData);
    assert.deepEqual(JSON.parse(JSON.stringify(writes)), [{
      operation: 'create',
      body: 'new-chat-public-key',
      path: '/info/chatpubkey',
      contentType: 'text/plain',
    }]);
  }
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
