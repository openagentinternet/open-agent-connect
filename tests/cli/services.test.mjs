import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches `metabot services publish --payload-file` with parsed JSON payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-publish-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }), 'utf8');

  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['services', 'publish', '--payload-file', payloadFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({
            servicePinId: 'service-tarot',
            displayName: input.displayName,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      servicePinId: 'service-tarot',
      displayName: 'Tarot Reading',
    },
  });
});

test('runCli dispatches `metabot services publish --payload-file --chain btc` and sets network=btc', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-publish-btc-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['services', 'publish', '--payload-file', payloadFile, '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({
            servicePinId: 'service-tarot-btc',
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
    network: 'btc',
  }]);
});

test('runCli fails `metabot services publish` when --chain value is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-publish-missing-chain-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['services', 'publish', '--payload-file', payloadFile, '--chain'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({ servicePinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Missing value for --chain/);
});

test('runCli fails `metabot services publish` when --chain value is unsupported', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-publish-invalid-chain-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['services', 'publish', '--payload-file', payloadFile, '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({ servicePinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Unsupported --chain value/);
});

test('runCli dispatches `metabot services publish-skills` to the primary runtime skill lister', async () => {
  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['services', 'publish-skills'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listPublishSkills: async () => {
          calls.push({});
          return commandSuccess({
            metaBotSlug: 'alice',
            runtime: {
              provider: 'codex',
              displayName: 'Codex',
              health: 'healthy',
            },
            skills: [
              { skillName: 'metabot-weather-oracle' },
            ],
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{}]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      metaBotSlug: 'alice',
      runtime: {
        provider: 'codex',
        displayName: 'Codex',
        health: 'healthy',
      },
      skills: [
        { skillName: 'metabot-weather-oracle' },
      ],
    },
  });
});

test('runCli dispatches `metabot services call --request-file` with parsed JSON request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-call-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'gm-weather-seller',
      userTask: 'tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
  }), 'utf8');

  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['services', 'call', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        call: async (input) => {
          calls.push(input);
          return commandSuccess({
            traceId: 'trace-weather-123',
            state: 'ready',
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'gm-weather-seller',
      userTask: 'tell me tomorrow weather',
      taskContext: 'Shanghai tomorrow',
    },
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      traceId: 'trace-weather-123',
      state: 'ready',
    },
  });
});

test('runCli dispatches `metabot services rate --request-file --chain btc` and sets network=btc', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-rate-btc-'));
  const requestFile = path.join(tempDir, 'rating.json');
  await writeFile(requestFile, JSON.stringify({
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['services', 'rate', '--request-file', requestFile, '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        rate: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'rating-pin-btc-1',
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
    network: 'btc',
  }]);
});

test('runCli fails `metabot services rate` when --chain value is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-rate-missing-chain-'));
  const requestFile = path.join(tempDir, 'rating.json');
  await writeFile(requestFile, JSON.stringify({
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['services', 'rate', '--request-file', requestFile, '--chain'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        rate: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Missing value for --chain/);
});

test('runCli fails `metabot services rate` when --chain value is unsupported', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-rate-invalid-chain-'));
  const requestFile = path.join(tempDir, 'rating.json');
  await writeFile(requestFile, JSON.stringify({
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['services', 'rate', '--request-file', requestFile, '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        rate: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'should-not-happen' });
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /Unsupported --chain value/);
});
