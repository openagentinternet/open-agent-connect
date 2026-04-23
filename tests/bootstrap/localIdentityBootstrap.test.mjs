import assert from 'node:assert/strict';
import { mkdtemp, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLocalMetabotStep,
  createMetabotSubsidyStep,
  createLocalIdentitySyncStep,
} = require('../../dist/core/bootstrap/localIdentityBootstrap.js');
const { ensureProfileWorkspace } = require('../../dist/core/identity/profileWorkspace.js');
const { createRuntimeStateStore } = require('../../dist/core/state/runtimeStateStore.js');
const { createFileSecretStore } = require('../../dist/core/secrets/fileSecretStore.js');

const FIXTURE_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

test('createLocalMetabotStep persists the first local identity with pending bootstrap state', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-bootstrap-local-'));
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const secretStore = createFileSecretStore(homeDir);

  const createMetabot = createLocalMetabotStep({
    runtimeStateStore,
    secretStore,
    now: () => 1_744_444_444_000,
    generateMnemonic: () => FIXTURE_MNEMONIC,
  });

  const created = await createMetabot({ name: 'Alice' });
  const state = await runtimeStateStore.readState();
  const secrets = await secretStore.readIdentitySecrets();

  assert.equal(created.metabot.name, 'Alice');
  assert.equal(created.metabot.subsidyState, 'pending');
  assert.equal(created.metabot.syncState, 'pending');
  assert.equal(created.subsidyInput.mvcAddress, created.metabot.mvcAddress);
  assert.equal(created.subsidyInput.mnemonic, FIXTURE_MNEMONIC);
  assert.equal(state.identity.name, 'Alice');
  assert.equal(state.identity.subsidyState, 'pending');
  assert.equal(state.identity.syncState, 'pending');
  assert.equal(secrets.mnemonic, FIXTURE_MNEMONIC);
  assert.equal(secrets.globalMetaId, created.metabot.globalMetaId);
});

test('createMetabotSubsidyStep persists claimed subsidy state after a successful reward flow', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-bootstrap-subsidy-'));
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const secretStore = createFileSecretStore(homeDir);

  const createMetabot = createLocalMetabotStep({
    runtimeStateStore,
    secretStore,
    now: () => 1_744_444_444_000,
    generateMnemonic: () => FIXTURE_MNEMONIC,
  });
  const created = await createMetabot({ name: 'Alice' });

  const requestSubsidy = createMetabotSubsidyStep({
    runtimeStateStore,
    requestMvcGasSubsidy: async (input) => ({
      success: true,
      step1: { address: input.mvcAddress },
      step2: { address: input.mvcAddress, rewarded: true },
    }),
  });

  const result = await requestSubsidy({
    request: { name: 'Alice' },
    metabot: created.metabot,
    subsidyInput: created.subsidyInput,
  });

  const state = await runtimeStateStore.readState();
  assert.equal(result.success, true);
  assert.equal(state.identity.subsidyState, 'claimed');
  assert.equal(state.identity.subsidyError, null);
});

test('createLocalIdentitySyncStep persists name first and retries chatpubkey without duplicating the name pin', async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-bootstrap-sync-'));
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const secretStore = createFileSecretStore(homeDir);

  const createMetabot = createLocalMetabotStep({
    runtimeStateStore,
    secretStore,
    now: () => 1_744_444_444_000,
    generateMnemonic: () => FIXTURE_MNEMONIC,
  });
  const created = await createMetabot({ name: 'Alice' });

  const calls = [];
  let chatAttempts = 0;
  const syncIdentityToChain = createLocalIdentitySyncStep({
    runtimeStateStore,
    signer: {
      writePin: async (input) => {
        calls.push(input.path);
        if (input.path === '/info/chatpubkey') {
          chatAttempts += 1;
          if (chatAttempts === 1) {
            throw new Error('indexer still catching up');
          }
        }
        return {
          pinId: `${input.path}-pin-${calls.length}`,
          txids: [`${input.path}-tx-${calls.length}`],
          totalCost: 1,
          network: 'mvc',
          operation: 'create',
          path: input.path,
          contentType: input.contentType,
          encoding: input.encoding ?? 'utf-8',
          globalMetaId: created.metabot.globalMetaId,
          mvcAddress: created.metabot.mvcAddress,
        };
      },
    },
    wait: async () => {},
    stepDelayMs: 0,
  });

  const firstAttempt = await syncIdentityToChain({
    request: { name: 'Alice' },
    metabot: created.metabot,
    subsidy: { success: true },
  });
  const stateAfterFirstAttempt = await runtimeStateStore.readState();

  assert.equal(firstAttempt.success, false);
  assert.equal(firstAttempt.canSkip, true);
  assert.equal(stateAfterFirstAttempt.identity.namePinId, '/info/name-pin-1');
  assert.equal(stateAfterFirstAttempt.identity.chatPublicKeyPinId, null);
  assert.equal(stateAfterFirstAttempt.identity.syncState, 'partial');

  const secondAttempt = await syncIdentityToChain({
    request: { name: 'Alice' },
    metabot: stateAfterFirstAttempt.identity,
    subsidy: { success: true },
  });
  const stateAfterSecondAttempt = await runtimeStateStore.readState();

  assert.deepEqual(calls, ['/info/name', '/info/chatpubkey', '/info/chatpubkey']);
  assert.equal(secondAttempt.success, true);
  assert.equal(stateAfterSecondAttempt.identity.namePinId, '/info/name-pin-1');
  assert.equal(stateAfterSecondAttempt.identity.chatPublicKeyPinId, '/info/chatpubkey-pin-3');
  assert.equal(stateAfterSecondAttempt.identity.syncState, 'synced');
  assert.equal(stateAfterSecondAttempt.identity.syncError, null);
});

test('ensureProfileWorkspace creates the required workspace files and eager runtime directories', async () => {
  const systemHome = await mkdtemp(path.join(os.tmpdir(), 'metabot-profile-workspace-'));
  const homeDir = path.join(systemHome, '.metabot', 'profiles', 'alice');

  await ensureProfileWorkspace({
    homeDir,
    name: 'Alice',
  });

  for (const relativePath of [
    'AGENTS.md',
    'SOUL.md',
    'IDENTITY.md',
    'USER.md',
    'MEMORY.md',
    'memory',
    '.runtime',
    '.runtime/sessions',
    '.runtime/evolution',
    '.runtime/exports',
    '.runtime/state',
    '.runtime/locks',
    '.runtime/config.json',
  ]) {
    const targetPath = path.join(homeDir, relativePath);
    const targetStat = await stat(targetPath);
    assert.equal(Boolean(targetStat), true, `${relativePath} should exist`);
  }
});
