import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function makeContext(homeDir) {
  let output = '';
  const context = {
    stdout: { write: (chunk) => { output += String(chunk); return true; } },
    stderr: { write: () => true },
    env: { HOME: homeDir },
    cwd: homeDir,
    dependencies: {},
  };
  return {
    context,
    parseEnvelope: () => JSON.parse(output),
  };
}

test('user who is empty before any identity exists', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const { context, parseEnvelope } = makeContext(home);
  assert.equal(await runCli(['user', 'who', '--json'], context), 0);
  assert.equal(parseEnvelope().data.identity, null);
});

test('user create then who returns the public identity without the mnemonic', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const created = makeContext(home);
  assert.equal(await runCli(['user', 'create', '--name', 'Alice', '--json'], created.context), 0);
  const createdData = created.parseEnvelope().data;
  assert.equal(createdData.identity.name, 'Alice');
  assert.ok(typeof createdData.mnemonic === 'string' && createdData.mnemonic.split(/\s+/).length >= 12);

  const who = makeContext(home);
  assert.equal(await runCli(['user', 'who', '--json'], who.context), 0);
  const whoData = who.parseEnvelope().data;
  assert.equal(whoData.identity.name, 'Alice');
  assert.equal(whoData.identity.globalMetaId, createdData.identity.globalMetaId);
  assert.equal(whoData.mnemonic, undefined);
});

test('user rename updates the name and reveal returns the mnemonic', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const created = makeContext(home);
  await runCli(['user', 'create', '--name', 'Alice', '--json'], created.context);
  const mnemonic = created.parseEnvelope().data.mnemonic;

  const renamed = makeContext(home);
  assert.equal(await runCli(['user', 'rename', '--name', 'Alicia', '--json'], renamed.context), 0);
  assert.equal(renamed.parseEnvelope().data.identity.name, 'Alicia');

  const revealed = makeContext(home);
  assert.equal(await runCli(['user', 'reveal', '--json'], revealed.context), 0);
  assert.equal(revealed.parseEnvelope().data.mnemonic, mnemonic);
});

test('user import rejects an invalid mnemonic with a failed envelope', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const { context, parseEnvelope } = makeContext(home);
  assert.equal(await runCli(['user', 'import', '--mnemonic', 'definitely not valid', '--json'], context), 1);
  const envelope = parseEnvelope();
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'invalid_mnemonic');
});

test('user delete removes the identity', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  await runCli(['user', 'create', '--name', 'Alice', '--json'], makeContext(home).context);
  assert.equal(await runCli(['user', 'delete', '--json'], makeContext(home).context), 0);
  const who = makeContext(home);
  await runCli(['user', 'who', '--json'], who.context);
  assert.equal(who.parseEnvelope().data.identity, null);
});

test('user ensure creates a default identity once', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const first = makeContext(home);
  assert.equal(await runCli(['user', 'ensure', '--json'], first.context), 0);
  const firstData = first.parseEnvelope().data;
  assert.equal(firstData.created, true);
  assert.equal(firstData.identity.name, 'User');

  const second = makeContext(home);
  assert.equal(await runCli(['user', 'ensure', '--name', 'Other', '--json'], second.context), 0);
  const secondData = second.parseEnvelope().data;
  assert.equal(secondData.created, false);
  assert.equal(secondData.identity.globalMetaId, firstData.identity.globalMetaId);
});
