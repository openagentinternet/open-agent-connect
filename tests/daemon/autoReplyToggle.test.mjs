import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
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
  assert.deepEqual(persisted.autoReply, { enabled: false, maxTurns: 10, cooldownMs: 60000 });
});

test('setAutoReply toggling back to enabled updates the persisted config', async (t) => {
  const { homeDir, handlers } = await createFixture(t);

  await handlers.chat.setAutoReply({ enabled: false });
  await handlers.chat.setAutoReply({ enabled: true });

  const persisted = JSON.parse(await readFile(createConfigStore(homeDir).paths.configPath, 'utf8'));
  assert.deepEqual(persisted.autoReply, { enabled: true, maxTurns: 10, cooldownMs: 60000 });
});

test('autoReplyStatus defaults to enabled when the config has not been touched', async (t) => {
  const { handlers } = await createFixture(t);

  const status = await handlers.chat.autoReplyStatus({});
  assert.equal(status.ok, true);
  assert.equal(status.data.enabled, true);
  assert.equal(status.data.maxTurns, 10);
  assert.equal(status.data.cooldownMs, 60000);
});

test('setAutoReply persists maxTurns and cooldownMs to the profile config.json', async (t) => {
  const { homeDir, handlers } = await createFixture(t);

  const updatedTurns = await handlers.chat.setAutoReply({ maxTurns: 10 });
  assert.equal(updatedTurns.ok, true);
  assert.equal(updatedTurns.data.maxTurns, 10);

  const status = await handlers.chat.autoReplyStatus({});
  assert.equal(status.ok, true);
  assert.equal(status.data.maxTurns, 10);
  assert.equal(status.data.cooldownMs, 60000);
  assert.equal(status.data.enabled, true);

  let persisted = JSON.parse(await readFile(createConfigStore(homeDir).paths.configPath, 'utf8'));
  assert.deepEqual(persisted.autoReply, { enabled: true, maxTurns: 10, cooldownMs: 60000 });

  const updatedCooldown = await handlers.chat.setAutoReply({ cooldownMs: 600000 });
  assert.equal(updatedCooldown.ok, true);
  assert.equal(updatedCooldown.data.cooldownMs, 600000);

  persisted = JSON.parse(await readFile(createConfigStore(homeDir).paths.configPath, 'utf8'));
  assert.deepEqual(persisted.autoReply, { enabled: true, maxTurns: 10, cooldownMs: 600000 });
});

test('setAutoReply rejects values outside the allowed option sets', async (t) => {
  const { homeDir, handlers } = await createFixture(t);

  const badTurns = await handlers.chat.setAutoReply({ maxTurns: 7 });
  assert.equal(badTurns.ok, false);
  assert.equal(badTurns.code, 'invalid_auto_reply_max_turns');

  const badCooldown = await handlers.chat.setAutoReply({ cooldownMs: 123 });
  assert.equal(badCooldown.ok, false);
  assert.equal(badCooldown.code, 'invalid_auto_reply_cooldown_ms');

  const empty = await handlers.chat.setAutoReply({});
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'missing_auto_reply_update');

  const status = await handlers.chat.autoReplyStatus({});
  assert.equal(status.ok, true);
  assert.equal(status.data.maxTurns, 10);
  assert.equal(status.data.cooldownMs, 60000);
  // Rejected updates never touch the persisted config.
  await assert.rejects(
    readFile(createConfigStore(homeDir).paths.configPath, 'utf8'),
    /ENOENT/,
  );
});

test('setAutoReply reports a persistence failure and keeps the live setting unchanged', async (t) => {
  const { homeDir, handlers } = await createFixture(t);
  const configStore = createConfigStore(homeDir);
  await configStore.ensureLayout();
  const configPath = configStore.paths.configPath;
  await writeFile(configPath, '{ invalid json', 'utf8');

  const result = await handlers.chat.setAutoReply({ enabled: false });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'auto_reply_persist_failed');
  const status = await handlers.chat.autoReplyStatus({});
  assert.equal(status.ok, true);
  assert.equal(status.data.enabled, true);
});
