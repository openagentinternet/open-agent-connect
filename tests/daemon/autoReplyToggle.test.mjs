import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { cleanupProfileHome, createProfileHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createConfigStore } = require('../../dist/core/config/configStore.js');

function readOnlySigner() {
  return {
    getIdentity: async () => ({}),
    getPrivateChatIdentity: async () => ({}),
    writePin: async () => {
      throw new Error('writePin should not be called by auto-reply config handlers');
    },
  };
}

async function createFixture(t) {
  const homeDir = await createProfileHome('metabot-auto-reply-toggle-', 'eric');
  t.after(async () => cleanupProfileHome(homeDir));
  return {
    homeDir,
    handlers: createDefaultMetabotDaemonHandlers({
      homeDir,
      signer: readOnlySigner(),
      getDaemonRecord: () => null,
    }),
  };
}

test('setAutoReply persists the enabled flag to the profile config.json', async (t) => {
  const { homeDir, handlers } = await createFixture(t);

  const initial = await handlers.chat.autoReplyStatus({});
  assert.equal(initial.ok, true);
  assert.equal(initial.data.enabled, true);

  const disabled = await handlers.chat.setAutoReply({ enabled: false });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.enabled, false);

  const persisted = JSON.parse(await readFile(createConfigStore(homeDir).paths.configPath, 'utf8'));
  assert.deepEqual(persisted.autoReply, { enabled: false });
});

test('setAutoReply toggling back to enabled updates the persisted config', async (t) => {
  const { homeDir, handlers } = await createFixture(t);

  await handlers.chat.setAutoReply({ enabled: false });
  await handlers.chat.setAutoReply({ enabled: true });

  const persisted = JSON.parse(await readFile(createConfigStore(homeDir).paths.configPath, 'utf8'));
  assert.deepEqual(persisted.autoReply, { enabled: true });
});

test('autoReplyStatus defaults to enabled when the config has not been touched', async (t) => {
  const { handlers } = await createFixture(t);

  const status = await handlers.chat.autoReplyStatus({});
  assert.equal(status.ok, true);
  assert.equal(status.data.enabled, true);
});
