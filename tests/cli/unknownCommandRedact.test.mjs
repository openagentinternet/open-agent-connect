import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { redactSensitiveArgs } = require('../../dist/cli/commands/helpers.js');

function makeContext(homeDir) {
  let output = '';
  const context = {
    stdout: { write: (chunk) => { output += String(chunk); return true; } },
    stderr: { write: () => true },
    env: { HOME: homeDir },
    cwd: homeDir,
    dependencies: {},
  };
  return { context, parseEnvelope: () => JSON.parse(output) };
}

test('redactSensitiveArgs masks values of secret-bearing flags in both forms', () => {
  assert.deepEqual(
    redactSensitiveArgs(['import', '--mnemonic', 'hush now hidden words', '--json']),
    ['import', '--mnemonic', '***', '--json'],
  );
  assert.deepEqual(
    redactSensitiveArgs(['--token=abc123', '--name', 'Alice']),
    ['--token=***', '--name', 'Alice'],
  );
  assert.deepEqual(
    redactSensitiveArgs(['--token', 't1', '--secret', 's1', '--private-key', 'k1']),
    ['--token', '***', '--secret', '***', '--private-key', '***'],
  );
  assert.deepEqual(redactSensitiveArgs(['--mnemonic']), ['--mnemonic'], 'a trailing flag has no value to redact');
  assert.deepEqual(redactSensitiveArgs(['--mnemonic-stdin']), ['--mnemonic-stdin'], 'longer flag names are not value flags');
  assert.deepEqual(redactSensitiveArgs(['user', 'who', '--json']), ['user', 'who', '--json']);
});

const SECRET = 'hush hidden seed words';

test('a typoed user subcommand echoes redacted argv without the mnemonic', async () => {
  const home = await mkdtempTempRoot('metabot-cli-redact-');
  const { context, parseEnvelope } = makeContext(home);
  assert.equal(
    await runCli(['user', 'improt', '--mnemonic', SECRET, '--json'], context),
    1,
  );
  const envelope = parseEnvelope();
  assert.equal(envelope.ok, false);
  assert.match(envelope.message, /\*\*\*/);
  for (const word of SECRET.split(' ')) {
    assert.equal(envelope.message.includes(word), false, `"${word}" must not appear in the error output`);
  }
});

test('a typoed wallet subcommand echoes redacted argv without the mnemonic', async () => {
  const home = await mkdtempTempRoot('metabot-cli-redact-');
  const { context, parseEnvelope } = makeContext(home);
  assert.equal(
    await runCli(['wallet', 'improt', '--mnemonic', SECRET, '--json'], context),
    1,
  );
  const envelope = parseEnvelope();
  assert.equal(envelope.ok, false);
  assert.match(envelope.message, /\*\*\*/);
  assert.equal(envelope.message.includes('hush'), false);
});
