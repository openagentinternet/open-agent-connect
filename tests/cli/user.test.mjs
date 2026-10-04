import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createRequire } from 'node:module';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { resolveCommandHelpSpec } = require('../../dist/cli/commandHelp.js');

function makeContext(homeDir, dependencies = {}, stdin) {
  let output = '';
  const context = {
    stdout: { write: (chunk) => { output += String(chunk); return true; } },
    stderr: { write: () => true },
    env: { HOME: homeDir },
    cwd: homeDir,
    dependencies,
    ...(stdin ? { stdin } : {}),
  };
  return {
    context,
    parseEnvelope: () => JSON.parse(output),
  };
}

/** Create a fresh identity in one home and return its mnemonic for import tests. */
async function seedMnemonic() {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const seeded = makeContext(home);
  await runCli(['user', 'create', '--name', 'Seed', '--json'], seeded.context);
  return seeded.parseEnvelope().data.mnemonic;
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

test('user import reads the mnemonic from stdin without argv exposure', async () => {
  const mnemonic = await seedMnemonic();
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const { context, parseEnvelope } = makeContext(home, {}, Readable.from([`${mnemonic}\n`]));
  assert.equal(await runCli(['user', 'import', '--name', 'Alice', '--mnemonic-stdin', '--json'], context), 0);
  const data = parseEnvelope().data;
  assert.equal(data.identity.name, 'Alice');
  assert.equal(data.mnemonic, mnemonic);
});

test('user import reports an empty stdin channel as missing_mnemonic', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const { context, parseEnvelope } = makeContext(home, {}, Readable.from(['   \n']));
  assert.equal(await runCli(['user', 'import', '--mnemonic-stdin', '--json'], context), 1);
  assert.equal(parseEnvelope().code, 'missing_mnemonic');
});

test('user import rejects conflicting mnemonic channels', async () => {
  const mnemonic = await seedMnemonic();
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const requestFile = path.join(home, 'import.json');
  await fs.writeFile(requestFile, JSON.stringify({ mnemonic }), 'utf8');
  const viaFileAndStdin = makeContext(home, {}, Readable.from([mnemonic]));
  assert.equal(
    await runCli(['user', 'import', '--request-file', requestFile, '--mnemonic-stdin', '--json'], viaFileAndStdin.context),
    1,
  );
  assert.equal(viaFileAndStdin.parseEnvelope().code, 'conflicting_flags');

  const viaArgvAndStdin = makeContext(home, {}, Readable.from([mnemonic]));
  assert.equal(
    await runCli(['user', 'import', '--mnemonic', mnemonic, '--mnemonic-stdin', '--json'], viaArgvAndStdin.context),
    1,
  );
  assert.equal(viaArgvAndStdin.parseEnvelope().code, 'conflicting_flags');
});

test('user import accepts a request file with mnemonic, name, and path', async () => {
  const mnemonic = await seedMnemonic();
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const requestFile = path.join(home, 'import.json');
  await fs.writeFile(
    requestFile,
    JSON.stringify({ name: 'Bob', mnemonic, path: "m/44'/10001'/0'/0/1" }),
    'utf8',
  );
  const { context, parseEnvelope } = makeContext(home);
  assert.equal(await runCli(['user', 'import', '--request-file', requestFile, '--json'], context), 0);
  const data = parseEnvelope().data;
  assert.equal(data.identity.name, 'Bob');
  assert.equal(data.identity.path, "m/44'/10001'/0'/0/1");
  assert.equal(data.mnemonic, mnemonic);
});

test('user import request file lets --name and --path flags win over the payload', async () => {
  const mnemonic = await seedMnemonic();
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const requestFile = path.join(home, 'import.json');
  await fs.writeFile(
    requestFile,
    JSON.stringify({ name: 'FromFile', mnemonic, path: "m/44'/10001'/0'/0/1" }),
    'utf8',
  );
  const { context, parseEnvelope } = makeContext(home);
  assert.equal(
    await runCli(['user', 'import', '--request-file', requestFile, '--name', 'FromFlag', '--json'], context),
    0,
  );
  const data = parseEnvelope().data;
  assert.equal(data.identity.name, 'FromFlag');
  assert.equal(data.identity.path, "m/44'/10001'/0'/0/1");
});

test('user import help recommends the stdin channel over the argv mnemonic', async () => {
  const spec = resolveCommandHelpSpec(['user', 'import']);
  assert.ok(spec, 'user import help spec exists');
  assert.match(spec.usage, /--mnemonic-stdin/);
  assert.match(spec.usage, /--request-file/);
  const stdinFlag = spec.optionalFlags.find((flag) => flag.flag === '--mnemonic-stdin');
  assert.ok(stdinFlag, '--mnemonic-stdin documented');
  assert.match(stdinFlag.description, /Recommended/);
  const argvFlag = spec.optionalFlags.find((flag) => flag.flag === '--mnemonic');
  assert.ok(argvFlag, '--mnemonic still documented');
  assert.match(argvFlag.description, /Discouraged/);
  assert.match(argvFlag.description, /shell history/);
  const argvExample = (spec.examples ?? []).find((example) => example.includes('--mnemonic '));
  assert.equal(argvExample, undefined, 'help must not showcase the argv mnemonic channel');
});

test('user delete refuses without --confirm and keeps the identity', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  await runCli(['user', 'create', '--name', 'Alice', '--json'], makeContext(home).context);
  const refused = makeContext(home);
  assert.equal(await runCli(['user', 'delete', '--json'], refused.context), 1);
  const envelope = refused.parseEnvelope();
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'confirmation_required');
  assert.match(envelope.message, /reveal/);
  const who = makeContext(home);
  await runCli(['user', 'who', '--json'], who.context);
  assert.equal(who.parseEnvelope().data.identity.name, 'Alice');
});

test('user delete removes the identity with --confirm', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  await runCli(['user', 'create', '--name', 'Alice', '--json'], makeContext(home).context);
  assert.equal(await runCli(['user', 'delete', '--confirm', '--json'], makeContext(home).context), 0);
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

test('user update forwards --name to the daemon-backed handler', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const calls = [];
  const dependencies = {
    user: {
      update: async (input) => {
        calls.push(input);
        return { ok: true, state: 'success', data: { identity: { name: input.name }, chainWrites: [], chainSync: { ok: true } } };
      },
    },
  };
  const { context, parseEnvelope } = makeContext(home, dependencies);
  assert.equal(await runCli(['user', 'update', '--name', 'Alicia', '--json'], context), 0);
  assert.deepEqual(calls, [{ name: 'Alicia' }]);
  assert.equal(parseEnvelope().data.identity.name, 'Alicia');
});

test('user update reads the request file and forwards name and avatar', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');
  const calls = [];
  const dependencies = {
    user: {
      update: async (input) => {
        calls.push(input);
        return { ok: true, state: 'success', data: { identity: { name: input.name }, chainWrites: [], chainSync: { ok: true } } };
      },
    },
  };
  const requestFile = path.join(home, 'update.json');
  await fs.writeFile(requestFile, JSON.stringify({ name: 'Alicia', avatarDataUrl: 'data:image/png;base64,AAAA' }), 'utf8');
  const { context } = makeContext(home, dependencies);
  assert.equal(await runCli(['user', 'update', '--request-file', requestFile, '--json'], context), 0);
  assert.deepEqual(calls, [{ name: 'Alicia', avatarDataUrl: 'data:image/png;base64,AAAA' }]);
});

test('user update validates input and reports a bad request file', async () => {
  const home = await mkdtempTempRoot('metabot-user-cli-');

  const empty = makeContext(home, { user: { update: async () => ({ ok: true, state: 'success', data: {} }) } });
  assert.equal(await runCli(['user', 'update', '--json'], empty.context), 1);
  assert.equal(empty.parseEnvelope().code, 'missing_update');

  const badFile = makeContext(home, { user: { update: async () => ({ ok: true, state: 'success', data: {} }) } });
  assert.equal(await runCli(['user', 'update', '--request-file', path.join(home, 'nope.json'), '--json'], badFile.context), 1);
  assert.equal(badFile.parseEnvelope().code, 'invalid_request_file');
});
