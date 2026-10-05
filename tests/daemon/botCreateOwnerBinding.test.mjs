import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createDefaultMetabotDaemonHandlers } = require('../../dist/daemon/defaultHandlers.js');
const { createOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
const { verifyOwnerBinding } = require('../../dist/core/owner/ownerBinding.js');

function recordingSigner(writes) {
  let counter = 0;
  return {
    writePin: async (request) => {
      counter += 1;
      writes.push(request);
      return { pinId: `pin-${counter}`, path: request.path, txids: [`tx-${counter}`] };
    },
  };
}

async function buildBotHandlers(t, { owner } = {}) {
  const homeDir = await createProfileHome('metabot-bot-owner-binding-', 'seed-home');
  t.after(async () => { await cleanupProfileHome(homeDir); });
  const systemHomeDir = deriveSystemHome(homeDir);
  if (owner) {
    await createOwnerIdentity(systemHomeDir, { name: owner });
  }
  const writes = [];
  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => null,
    createSignerForHome: () => recordingSigner(writes),
    requestMvcGasSubsidy: async () => ({ success: true }),
    identitySyncStepDelayMs: 0,
  });
  return { handlers, writes, systemHomeDir };
}

test('bot create defaults the owner to the local owner identity and signs the /info/owner pin', async (t) => {
  const { handlers, writes } = await buildBotHandlers(t, { owner: 'Alice' });

  const result = await handlers.bot.createProfile({ name: 'TestBot' });
  assert.equal(result.ok, true, `create failed: ${result.message ?? ''}`);
  const profile = result.data.profile;

  // Local binding defaulted to the machine's owner identity.
  const { readOwnerIdentity } = require('../../dist/core/owner/ownerIdentity.js');
  const owner = await readOwnerIdentity(deriveSystemHome(profile.homeDir));
  assert.ok(owner);
  assert.equal(profile.ownerGlobalMetaId, owner.globalMetaId);

  // The signed /info/owner pin was published through the Bot's signer.
  const ownerWrites = writes.filter((write) => write.path === '/info/owner');
  assert.equal(ownerWrites.length, 1);
  assert.equal(ownerWrites[0].contentType, 'application/json');
  assert.equal(
    verifyOwnerBinding(String(ownerWrites[0].payload), profile.globalMetaId),
    true,
    'the published /info/owner payload must verify against the Bot GlobalMetaID',
  );

  // The ordinary create pins (name/chatpubkey) still landed.
  const paths = writes.map((write) => write.path);
  assert.ok(paths.includes('/info/name'));
  assert.ok(paths.includes('/info/chatpubkey'));
});

test('bot create keeps an explicit foreign owner local-only', async (t) => {
  const { handlers, writes } = await buildBotHandlers(t, { owner: 'Alice' });

  const foreignOwner = 'idq1foreignowner000000000000000000000000';
  const result = await handlers.bot.createProfile({ name: 'ForeignBot', ownerGlobalMetaId: foreignOwner });
  assert.equal(result.ok, true, `create failed: ${result.message ?? ''}`);
  assert.equal(result.data.profile.ownerGlobalMetaId, foreignOwner);

  // A foreign owner gets the local field only — no signed pin is published
  // (the owner key on this machine cannot speak for that identity).
  assert.equal(writes.filter((write) => write.path === '/info/owner').length, 0);
});

test('bot create without any owner identity stays owner-less', async (t) => {
  const { handlers, writes } = await buildBotHandlers(t, {});
  const created = await handlers.bot.createProfile({ name: 'LonelyBot' });
  assert.equal(created.ok, true, `create failed: ${created.message ?? ''}`);
  assert.equal(created.data.profile.ownerGlobalMetaId ?? null, null);
  assert.equal(writes.filter((write) => write.path === '/info/owner').length, 0);
});
