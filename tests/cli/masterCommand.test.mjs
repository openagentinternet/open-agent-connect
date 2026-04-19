import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function parseJsonEnvelope(chunks) {
  return JSON.parse(chunks.join('').trim());
}

test('runCli routes unknown master subcommands through the master command family', async () => {
  const stdout = [];

  const exitCode = await runCli(['master', 'wat'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(parseJsonEnvelope(stdout), {
    ok: false,
    state: 'failed',
    code: 'unknown_command',
    message: 'Unknown command: master wat',
  });
});

test('runCli dispatches `metabot master list` and returns not_implemented when the handler is missing', async () => {
  const stdout = [];

  const exitCode = await runCli(['master', 'list'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        list: undefined,
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(parseJsonEnvelope(stdout), {
    ok: false,
    state: 'failed',
    code: 'not_implemented',
    message: 'Master list handler is not configured.',
  });
});

test('runCli dispatches `metabot master list` without forcing an online filter by default', async () => {
  const calls = [];

  const exitCode = await runCli(['master', 'list'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      master: {
        list: async (input) => {
          calls.push(input);
          return {
            ok: true,
            state: 'success',
            data: {
              masters: [],
            },
          };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      online: undefined,
      masterKind: undefined,
    },
  ]);
});

test('runCli dispatches `metabot master list --online --kind debug` with parsed filters', async () => {
  const calls = [];

  const exitCode = await runCli(['master', 'list', '--online', '--kind', 'debug'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      master: {
        list: async (input) => {
          calls.push(input);
          return {
            ok: true,
            state: 'success',
            data: {
              masters: [],
            },
          };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [
    {
      online: true,
      masterKind: 'debug',
    },
  ]);
});

test('runCli dispatches `metabot master publish --payload-file --chain btc` and sets network=btc', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-master-publish-'));
  const payloadFile = path.join(tempDir, 'master-service.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfo: {
      provider: 'metaweb',
      model: 'official-debug-master-v1',
    },
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'SPACE',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: true,
    trustedTier: 'official',
  }), 'utf8');

  const calls = [];

  const exitCode = await runCli(['master', 'publish', '--payload-file', payloadFile, '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      master: {
        publish: async (input) => {
          calls.push(input);
          return {
            ok: true,
            state: 'success',
            data: {
              masterPinId: 'master-pin-1',
              network: input.network,
            },
          };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].serviceName, 'official-debug-master');
  assert.equal(calls[0].network, 'btc');
});

test('runCli dispatches `metabot master ask --request-file` and returns not_implemented when the handler is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-master-ask-'));
  const requestFile = path.join(tempDir, 'master-request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      type: 'master_request',
      masterServicePinId: 'master-pin-1',
      providerGlobalMetaId: 'gm-debug-master',
      masterKind: 'debug',
      userTask: 'help me debug a failing test',
      question: 'What should I check first?',
    },
  }), 'utf8');

  const stdout = [];

  const exitCode = await runCli(['master', 'ask', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      master: {
        ask: undefined,
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(parseJsonEnvelope(stdout), {
    ok: false,
    state: 'failed',
    code: 'not_implemented',
    message: 'Master ask handler is not configured.',
  });
});
