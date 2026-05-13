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

test('runCli dispatches `metabot services publish --payload-file --chain` for supported write chains', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-publish-network-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }), 'utf8');

  const calls = [];
  for (const chain of ['btc', 'doge', 'opcat']) {
    const exitCode = await runCli(['services', 'publish', '--payload-file', payloadFile, '--chain', chain], {
      stdout: { write: () => true },
      stderr: { write: () => true },
      dependencies: {
        services: {
          publish: async (input) => {
            calls.push(input);
            return commandSuccess({
              servicePinId: `service-tarot-${chain}`,
              network: input.network,
            });
          },
        },
      },
    });

    assert.equal(exitCode, 0);
  }

  assert.deepEqual(calls.map((entry) => entry.network), ['btc', 'doge', 'opcat']);
});

test('runCli dispatches `metabot services publish --from --payload-file --chain` with actor slug', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-publish-from-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceName: 'Tarot Reading',
    displayName: 'Tarot Reading',
    description: 'Performs tarot readings.',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli([
    'services',
    'publish',
    '--from',
    'alice',
    '--payload-file',
    payloadFile,
    '--chain',
    'doge',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({
            servicePinId: 'service-tarot-doge',
            network: input.network,
            from: input.from,
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
    from: 'alice',
    network: 'doge',
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
  const exitCode = await runCli(['services', 'publish', '--payload-file', payloadFile, '--chain', 'eth'], {
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

test('runCli dispatches canonical `metabot services skills --from` to the publishable skill lister', async () => {
  const calls = [];

  const exitCode = await runCli(['services', 'skills', '--from', 'alice'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listPublishSkills: async (input) => {
          calls.push(input);
          return commandSuccess({ skills: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice' }]);
});

test('runCli keeps `metabot services publish-skills --slug` as a compatibility alias', async () => {
  const calls = [];

  const exitCode = await runCli(['services', 'publish-skills', '--slug', 'alice'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listPublishSkills: async (input) => {
          calls.push(input);
          return commandSuccess({ skills: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice' }]);
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

test('runCli dispatches `metabot services call --from --request-file` with actor slug', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-call-from-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'gm-weather-seller',
      userTask: 'tell me tomorrow weather',
    },
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['services', 'call', '--from', 'buyer', '--request-file', requestFile], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        call: async (input) => {
          calls.push(input);
          return commandSuccess({ traceId: 'trace-weather-123' });
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
    },
    from: 'buyer',
  }]);
});

test('runCli dispatches `metabot services rate --request-file --chain` for supported write chains', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-rate-network-'));
  const requestFile = path.join(tempDir, 'rating.json');
  await writeFile(requestFile, JSON.stringify({
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
  }), 'utf8');

  const calls = [];
  for (const chain of ['btc', 'doge', 'opcat']) {
    const exitCode = await runCli(['services', 'rate', '--request-file', requestFile, '--chain', chain], {
      stdout: { write: () => true },
      stderr: { write: () => true },
      dependencies: {
        services: {
          rate: async (input) => {
            calls.push(input);
            return commandSuccess({
              pinId: `rating-pin-${chain}-1`,
              network: input.network,
            });
          },
        },
      },
    });

    assert.equal(exitCode, 0);
  }

  assert.deepEqual(calls.map((entry) => entry.network), ['btc', 'doge', 'opcat']);
});

test('runCli dispatches `metabot services rate --from --request-file --chain` with actor slug', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-rate-from-'));
  const requestFile = path.join(tempDir, 'rating.json');
  await writeFile(requestFile, JSON.stringify({
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli([
    'services',
    'rate',
    '--from',
    'buyer',
    '--request-file',
    requestFile,
    '--chain',
    'opcat',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        rate: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'rating-pin-opcat-1' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    traceId: 'trace-123',
    rate: 5,
    comment: 'Great result.',
    from: 'buyer',
    network: 'opcat',
  }]);
});

test('runCli dispatches `metabot services owned list` with owner filters and paging', async () => {
  const calls = [];
  const exitCode = await runCli([
    'services',
    'owned',
    'list',
    '--from',
    'alice',
    '--page',
    '2',
    '--page-size',
    '10',
    '--refresh',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listOwned: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    all: false,
    page: 2,
    pageSize: 10,
    refresh: true,
  }]);
});

test('runCli dispatches `metabot services owned list --all` for aggregate owner view', async () => {
  const calls = [];
  const exitCode = await runCli(['services', 'owned', 'list', '--all'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listOwned: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    all: true,
    page: 1,
    pageSize: 20,
    refresh: false,
  }]);
});

test('runCli dispatches `metabot services owned orders` with service id and pagination', async () => {
  const calls = [];
  const exitCode = await runCli([
    'services',
    'owned',
    'orders',
    '--service-id',
    'svc-1',
    '--all',
    '--page',
    '3',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listOwnedOrders: async (input) => {
          calls.push(input);
          return commandSuccess({ items: [] });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    serviceId: 'svc-1',
    all: true,
    page: 3,
    pageSize: 20,
    refresh: false,
  }]);
});

test('runCli dispatches `metabot services owned modify` from payload with actor and chain', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-owned-modify-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({
    serviceId: 'svc-1',
    displayName: 'Updated service',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli([
    'services',
    'owned',
    'modify',
    '--from',
    'alice',
    '--payload-file',
    payloadFile,
    '--chain',
    'btc',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        modifyOwned: async (input) => {
          calls.push(input);
          return commandSuccess({ serviceId: input.serviceId });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    serviceId: 'svc-1',
    displayName: 'Updated service',
    from: 'alice',
    network: 'btc',
  }]);
});

test('runCli dispatches `metabot services owned revoke` with actor and chain', async () => {
  const calls = [];
  const exitCode = await runCli([
    'services',
    'owned',
    'revoke',
    '--from',
    'alice',
    '--service-id',
    'svc-1',
    '--chain',
    'doge',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        revokeOwned: async (input) => {
          calls.push(input);
          return commandSuccess({ serviceId: input.serviceId });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    serviceId: 'svc-1',
    from: 'alice',
    network: 'doge',
  }]);
});

test('runCli rejects `--all` for owned service mutations', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-owned-invalid-all-'));
  const payloadFile = path.join(tempDir, 'payload.json');
  await writeFile(payloadFile, JSON.stringify({ serviceId: 'svc-1' }), 'utf8');

  const stdout = [];
  const calls = [];
  const modifyExitCode = await runCli([
    'services',
    'owned',
    'modify',
    '--all',
    '--payload-file',
    payloadFile,
  ], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        modifyOwned: async (input) => {
          calls.push(input);
          return commandSuccess({});
        },
      },
    },
  });

  const revokeExitCode = await runCli([
    'services',
    'owned',
    'revoke',
    '--all',
    '--service-id',
    'svc-1',
  ], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        revokeOwned: async (input) => {
          calls.push(input);
          return commandSuccess({});
        },
      },
    },
  });

  assert.equal(modifyExitCode, 1);
  assert.equal(revokeExitCode, 1);
  assert.deepEqual(calls, []);
  const envelopes = stdout.join('').trim().split(/\n(?=\{)/u).map((line) => JSON.parse(line));
  assert.equal(envelopes[0].code, 'invalid_flag');
  assert.equal(envelopes[1].code, 'invalid_flag');
});

test('runCli dispatches `metabot services refunds list` with aggregate and kind filters', async () => {
  const calls = [];
  const receivedExitCode = await runCli(['services', 'refunds', 'list', '--all', '--received'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listRefunds: async (input) => {
          calls.push(input);
          return commandSuccess({ receivedByMe: [] });
        },
      },
    },
  });

  const initiatedExitCode = await runCli(['services', 'refunds', 'list', '--from', 'alice', '--initiated'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listRefunds: async (input) => {
          calls.push(input);
          return commandSuccess({ initiatedByMe: [] });
        },
      },
    },
  });

  const kindExitCode = await runCli(['services', 'refunds', 'list', '--all', '--kind', 'received'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listRefunds: async (input) => {
          calls.push(input);
          return commandSuccess({ receivedByMe: [] });
        },
      },
    },
  });

  assert.equal(receivedExitCode, 0);
  assert.equal(initiatedExitCode, 0);
  assert.equal(kindExitCode, 0);
  assert.deepEqual(calls, [
    { all: true, kind: 'received' },
    { from: 'alice', all: false, kind: 'initiated' },
    { all: true, kind: 'received' },
  ]);
});

test('runCli rejects invalid `metabot services refunds list --kind` values', async () => {
  const calls = [];
  const stdout = [];

  const exitCode = await runCli(['services', 'refunds', 'list', '--kind', 'other'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listRefunds: async (input) => {
          calls.push(input);
          return commandSuccess({});
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: false,
    state: 'failed',
    code: 'invalid_refund_kind',
    message: 'Refund kind must be one of all, initiated, or received.',
  });
});

test('runCli rejects combining `metabot services refunds list --from` with --all', async () => {
  const calls = [];
  const stdout = [];

  const exitCode = await runCli(['services', 'refunds', 'list', '--from', 'alice', '--all'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      services: {
        listRefunds: async (input) => {
          calls.push(input);
          return commandSuccess({});
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, []);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: false,
    state: 'failed',
    code: 'invalid_flag',
    message: 'Use either --from <bot-slug> or --all for refund listing, not both.',
  });
});

test('runCli dispatches `metabot services refunds settle` with actor selector', async () => {
  const calls = [];
  const exitCode = await runCli(['services', 'refunds', 'settle', '--from', 'seller', '--order-id', 'order-1'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        settleRefund: async (input) => {
          calls.push(input);
          return commandSuccess({ orderId: input.orderId });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'seller', orderId: 'order-1' }]);
});

test('runCli dispatches `metabot services orders inspect` with actor selector', async () => {
  const calls = [];
  const exitCode = await runCli(['services', 'orders', 'inspect', '--from', 'seller', '--payment-txid', 'tx-1'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        inspectOrder: async (input) => {
          calls.push(input);
          return commandSuccess({ paymentTxid: input.paymentTxid });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'seller', paymentTxid: 'tx-1' }]);
});

test('runCli keeps provider order/refund commands as service lifecycle aliases', async () => {
  const calls = [];
  const orderExitCode = await runCli(['provider', 'order', 'inspect', '--payment-txid', 'tx-1'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        inspectOrder: async (input) => {
          calls.push(['inspect', input]);
          return commandSuccess({ paymentTxid: input.paymentTxid });
        },
      },
    },
  });
  const refundExitCode = await runCli(['provider', 'refund', 'settle', '--order-id', 'order-1'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      services: {
        settleRefund: async (input) => {
          calls.push(['settle', input]);
          return commandSuccess({ orderId: input.orderId });
        },
      },
    },
  });

  assert.equal(orderExitCode, 0);
  assert.equal(refundExitCode, 0);
  assert.deepEqual(calls, [
    ['inspect', { paymentTxid: 'tx-1' }],
    ['settle', { orderId: 'order-1' }],
  ]);
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
  const exitCode = await runCli(['services', 'rate', '--request-file', requestFile, '--chain', 'eth'], {
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
