import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

const validTaskPinId = `${'a'.repeat(64)}i0`;

function validClaimPayload(overrides = {}) {
  return {
    taskPinId: validTaskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
    estimatedStartAt: 1750000000000,
    message: 'I can do this task.',
    ...overrides,
  };
}

async function writePayload(tempDir, payload) {
  const payloadFile = path.join(tempDir, 'claim.json');
  await writeFile(payloadFile, JSON.stringify(payload), 'utf8');
  return payloadFile;
}

async function createIndexedHome() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-home-'));
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  const managerRoot = path.join(home, '.metabot', 'manager');
  await mkdir(profileHome, { recursive: true });
  await mkdir(managerRoot, { recursive: true });
  await writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    JSON.stringify({ profiles: [{ slug: 'eric', homeDir: profileHome }] }),
    'utf8',
  );
  await writeFile(
    path.join(managerRoot, 'active-home.json'),
    JSON.stringify({ homeDir: profileHome }),
    'utf8',
  );
  return home;
}

async function withChainApiServer(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: { list: [], nextCursor: null } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    return await handler({
      baseUrl: `http://127.0.0.1:${address.port}`,
      requests,
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

async function runLoom(args, options = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    cwd: options.cwd,
    env: options.env,
    dependencies: options.dependencies,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  return {
    exitCode,
    envelope: JSON.parse(stdout.join('').trim()),
  };
}

test('runCli validates a valid loom claim payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-validate-'));
  const payloadFile = await writePayload(tempDir, validClaimPayload());

  const { exitCode, envelope } = await runLoom([
    'loom',
    'validate',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.protocol, 'claim');
  assert.equal(envelope.data.path, '/protocols/loom-claim');
  assert.equal(envelope.data.valid, true);
  assert.deepEqual(envelope.data.payload, validClaimPayload());
});

test('runCli fails loom validation for an invalid claim payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-invalid-'));
  const payloadFile = await writePayload(tempDir, {
    taskPinId: validTaskPinId,
  });

  const { exitCode, envelope } = await runLoom([
    'loom',
    'validate',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_payload');
  assert.match(envelope.message, /Invalid loom claim payload/i);
  assert.ok(envelope.data.validation.errors.some((error) => error.path === 'payoutAddress'));
});

test('runCli reports malformed loom payload JSON as invalid_payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-malformed-'));
  const payloadFile = path.join(tempDir, 'malformed.json');
  await writeFile(payloadFile, '{', 'utf8');

  const { exitCode, envelope } = await runLoom([
    'loom',
    'validate',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_payload');
  assert.equal(envelope.data.validation.protocol, 'claim');
  assert.equal(envelope.data.validation.path, '/protocols/loom-claim');
  assert.equal(envelope.data.validation.valid, false);
  assert.ok(envelope.data.validation.errors.some((error) => error.code === 'invalid_json'));
});

test('runCli reports non-object loom payload JSON as invalid_payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-array-'));
  const payloadFile = path.join(tempDir, 'array.json');
  await writeFile(payloadFile, '[]', 'utf8');

  const { exitCode, envelope } = await runLoom([
    'loom',
    'validate',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_payload');
  assert.equal(envelope.data.validation.protocol, 'claim');
  assert.equal(envelope.data.validation.path, '/protocols/loom-claim');
  assert.equal(envelope.data.validation.valid, false);
  assert.ok(envelope.data.validation.errors.some((error) => error.code === 'invalid_type'));
});

test('runCli exports a loom claim chain request in the command envelope', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-export-'));
  const payload = validClaimPayload();
  const payloadFile = await writePayload(tempDir, payload);

  const { exitCode, envelope } = await runLoom([
    'loom',
    'export-chain-request',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.protocol, 'claim');
  assert.equal(envelope.data.path, '/protocols/loom-claim');
  assert.deepEqual(envelope.data.request, {
    operation: 'create',
    path: '/protocols/loom-claim',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  });
});

test('runCli reports non-object loom export payload JSON as invalid_payload', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-export-array-'));
  const payloadFile = path.join(tempDir, 'array.json');
  await writeFile(payloadFile, '[]', 'utf8');

  const { exitCode, envelope } = await runLoom([
    'loom',
    'export-chain-request',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_payload');
  assert.equal(envelope.data.validation.protocol, 'claim');
  assert.equal(envelope.data.validation.path, '/protocols/loom-claim');
  assert.equal(envelope.data.validation.valid, false);
  assert.ok(envelope.data.validation.errors.some((error) => error.code === 'invalid_type'));
});

test('runCli writes a loom claim chain request to --out', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-out-'));
  const payload = validClaimPayload();
  const payloadFile = await writePayload(tempDir, payload);

  const { exitCode, envelope } = await runLoom([
    'loom',
    'export-chain-request',
    '--protocol',
    'claim',
    '--payload-file',
    payloadFile,
    '--out',
    'request.json',
  ], { cwd: tempDir });

  const outPath = path.join(tempDir, 'request.json');
  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, {
    outPath,
    protocol: 'claim',
    path: '/protocols/loom-claim',
  });

  const written = JSON.parse(await readFile(outPath, 'utf8'));
  assert.deepEqual(written, {
    operation: 'create',
    path: '/protocols/loom-claim',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  });
});

test('runCli rejects unsupported loom protocols', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-protocol-'));
  const payloadFile = await writePayload(tempDir, validClaimPayload());

  const { exitCode, envelope } = await runLoom([
    'loom',
    'validate',
    '--protocol',
    'unknown',
    '--payload-file',
    payloadFile,
  ]);

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_protocol');
  assert.match(envelope.message, /Unsupported Loom protocol: unknown/);
});

test('runCli rejects chain write flags on loom export commands', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-flags-'));
  const payloadFile = await writePayload(tempDir, validClaimPayload());

  for (const extraFlag of ['--chain', '--from']) {
    const { exitCode, envelope } = await runLoom([
      'loom',
      'export-chain-request',
      '--protocol',
      'claim',
      '--payload-file',
      payloadFile,
      extraFlag,
      extraFlag === '--chain' ? 'doge' : 'alice',
    ]);

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.state, 'failed');
    assert.equal(envelope.code, 'invalid_flag');
    assert.match(envelope.message, new RegExp(`${extraFlag} is not supported`));
  }
});

test('runCli delegates loom draft-task wish to runtime dependencies', async () => {
  const calls = [];
  const { exitCode, envelope } = await runLoom(['loom', 'draft-task', '--wish', 'Add a task draft command.'], {
    dependencies: {
      loom: {
        draftTask: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { drafted: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ wish: 'Add a task draft command.', allowInvalid: false }]);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { drafted: true });
});

test('runCli forwards from and allowInvalid to loom draft-task dependencies', async () => {
  const calls = [];
  const { exitCode } = await runLoom([
    'loom',
    'draft-task',
    '--wish',
    'Draft an intentionally incomplete task.',
    '--from',
    'alice',
    '--allow-invalid',
  ], {
    dependencies: {
      loom: {
        draftTask: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { drafted: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    wish: 'Draft an intentionally incomplete task.',
    from: 'alice',
    allowInvalid: true,
  }]);
});

test('runCli delegates loom post-task payload-file input to runtime dependencies', async () => {
  const calls = [];
  const { exitCode, envelope } = await runLoom([
    'loom',
    'post-task',
    '--from',
    'alice',
    '--payload-file',
    'task.json',
    '--chain',
    'mvc',
    '--dry-run',
  ], {
    dependencies: {
      loom: {
        postTask: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { posted: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    payloadFile: 'task.json',
    chain: 'mvc',
    dryRun: true,
  }]);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { posted: true });
});

test('runCli delegates loom post-task wish input to runtime dependencies', async () => {
  const calls = [];
  const { exitCode } = await runLoom([
    'loom',
    'post-task',
    '--from',
    'alice',
    '--wish',
    'Build a CLI workflow surface.',
    '--chain',
    'mvc',
  ], {
    dependencies: {
      loom: {
        postTask: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { posted: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    wish: 'Build a CLI workflow surface.',
    chain: 'mvc',
    dryRun: false,
  }]);
});

test('runCli rejects loom post-task without exactly one task source', async () => {
  for (const args of [
    ['loom', 'post-task', '--from', 'alice'],
    ['loom', 'post-task', '--payload-file', 'task.json', '--wish', 'Build it.'],
  ]) {
    const calls = [];
    const { exitCode, envelope } = await runLoom(args, {
      dependencies: {
        loom: {
          postTask: async (input) => {
            calls.push(input);
            return { ok: true, state: 'success', data: { posted: true } };
          },
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.state, 'failed');
    assert.match(envelope.code, /missing_flag|invalid_flag/);
    assert.deepEqual(calls, []);
  }
});

test('runCli delegates loom claim-and-start payout input to runtime dependencies', async () => {
  const calls = [];
  const { exitCode } = await runLoom([
    'loom',
    'claim-and-start',
    '--from',
    'bob',
    '--task-pin-id',
    validTaskPinId,
    '--payout-address',
    '1DeveloperPayoutAddress',
    '--chain',
    'mvc',
    '--file-chain',
    'btc',
    '--message',
    'hi',
  ], {
    dependencies: {
      loom: {
        claimAndStart: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { claimed: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'bob',
    taskPinId: validTaskPinId,
    payoutAddress: '1DeveloperPayoutAddress',
    chain: 'mvc',
    fileChain: 'btc',
    message: 'hi',
    dryRun: false,
    resetWorkspace: false,
  }]);
});

test('runCli delegates loom claim-and-start claim-pin input to runtime dependencies', async () => {
  const calls = [];
  const claimPinId = `${'b'.repeat(64)}i0`;
  const { exitCode } = await runLoom([
    'loom',
    'claim-and-start',
    '--from',
    'bob',
    '--task-pin-id',
    validTaskPinId,
    '--claim-pin-id',
    claimPinId,
    '--chain',
    'mvc',
    '--reset-workspace',
  ], {
    dependencies: {
      loom: {
        claimAndStart: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { claimed: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'bob',
    taskPinId: validTaskPinId,
    claimPinId,
    chain: 'mvc',
    dryRun: false,
    resetWorkspace: true,
  }]);
});

test('runCli rejects loom claim-and-start without a payout or claim pin id', async () => {
  const calls = [];
  const { exitCode, envelope } = await runLoom([
    'loom',
    'claim-and-start',
    '--from',
    'bob',
    '--task-pin-id',
    validTaskPinId,
  ], {
    dependencies: {
      loom: {
        claimAndStart: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { claimed: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'missing_flag');
  assert.match(envelope.message, /--payout-address|--claim-pin-id/);
  assert.deepEqual(calls, []);
});

test('runCli forwards repeated loom run-dev-round checks', async () => {
  const calls = [];
  const claimPinId = `${'b'.repeat(64)}i0`;
  const { exitCode } = await runLoom([
    'loom',
    'run-dev-round',
    '--from',
    'alice',
    '--task-pin-id',
    validTaskPinId,
    '--claim-pin-id',
    claimPinId,
    '--chain',
    'mvc',
    '--file-chain',
    'btc',
    '--check',
    'npm run build',
    '--check',
    'node --test tests/cli/loom.test.mjs',
    '--round-note',
    'Parser round.',
  ], {
    dependencies: {
      loom: {
        runDevRound: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { round: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    taskPinId: validTaskPinId,
    claimPinId,
    chain: 'mvc',
    fileChain: 'btc',
    checks: ['npm run build', 'node --test tests/cli/loom.test.mjs'],
    roundNote: 'Parser round.',
  }]);
});

test('runCli rejects loom run-dev-round --check without a value', async () => {
  const calls = [];
  const claimPinId = `${'b'.repeat(64)}i0`;
  const { exitCode, envelope } = await runLoom([
    'loom',
    'run-dev-round',
    '--task-pin-id',
    validTaskPinId,
    '--claim-pin-id',
    claimPinId,
    '--check',
    '--round-note',
    'Parser round.',
  ], {
    dependencies: {
      loom: {
        runDevRound: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { round: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /--check/);
  assert.deepEqual(calls, []);
});

test('runCli forwards loom deliver dry-run, pr title, and delivery summary', async () => {
  const calls = [];
  const claimPinId = `${'b'.repeat(64)}i0`;
  const { exitCode } = await runLoom([
    'loom',
    'deliver',
    '--from',
    'alice',
    '--task-pin-id',
    validTaskPinId,
    '--claim-pin-id',
    claimPinId,
    '--chain',
    'mvc',
    '--dry-run',
    '--pr-title',
    'feat: add parser',
    '--delivery-summary',
    'CLI surface added.',
  ], {
    dependencies: {
      loom: {
        deliver: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { delivered: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    taskPinId: validTaskPinId,
    claimPinId,
    chain: 'mvc',
    prTitle: 'feat: add parser',
    deliverySummary: 'CLI surface added.',
    dryRun: true,
  }]);
});

test('runCli forwards loom accept-and-pay confirmation, score, and comment', async () => {
  const calls = [];
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  const { exitCode } = await runLoom([
    'loom',
    'accept-and-pay',
    '--from',
    'alice',
    '--task-pin-id',
    validTaskPinId,
    '--delivery-pin-id',
    deliveryPinId,
    '--score',
    '5',
    '--comment',
    'Looks good.',
    '--chain',
    'mvc',
    '--confirm-payment',
  ], {
    dependencies: {
      loom: {
        acceptAndPay: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { accepted: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    taskPinId: validTaskPinId,
    deliveryPinId,
    score: 5,
    comment: 'Looks good.',
    chain: 'mvc',
    confirmPayment: true,
  }]);
});

test('runCli rejects loom accept-and-pay scores outside the 1 to 5 range', async () => {
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  for (const score of ['0', '6', '2.5']) {
    const calls = [];
    const { exitCode, envelope } = await runLoom([
      'loom',
      'accept-and-pay',
      '--task-pin-id',
      validTaskPinId,
      '--delivery-pin-id',
      deliveryPinId,
      '--score',
      score,
      '--comment',
      'Looks good.',
    ], {
      dependencies: {
        loom: {
          acceptAndPay: async (input) => {
            calls.push(input);
            return { ok: true, state: 'success', data: { accepted: true } };
          },
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.state, 'failed');
    assert.equal(envelope.code, 'invalid_flag');
    assert.match(envelope.message, /--score/);
    assert.match(envelope.message, /1 to 5/);
    assert.deepEqual(calls, []);
  }
});

test('runCli keeps missing loom accept-and-pay score as missing_flag', async () => {
  const calls = [];
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  const { exitCode, envelope } = await runLoom([
    'loom',
    'accept-and-pay',
    '--task-pin-id',
    validTaskPinId,
    '--delivery-pin-id',
    deliveryPinId,
    '--comment',
    'Looks good.',
  ], {
    dependencies: {
      loom: {
        acceptAndPay: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { accepted: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'missing_flag');
  assert.match(envelope.message, /--score/);
  assert.deepEqual(calls, []);
});

test('runCli forwards loom review-delivery verdict, score, comment, and attachments', async () => {
  const calls = [];
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  const { exitCode } = await runLoom([
    'loom',
    'review-delivery',
    '--from',
    'alice',
    '--task-pin-id',
    validTaskPinId,
    '--delivery-pin-id',
    deliveryPinId,
    '--verdict',
    'revision_needed',
    '--score',
    '2',
    '--comment',
    'Please add tests.',
    '--chain',
    'mvc',
    '--attachment',
    'metafile://one',
    '--attachment',
    'metafile://two',
  ], {
    dependencies: {
      loom: {
        reviewDelivery: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { reviewed: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    from: 'alice',
    taskPinId: validTaskPinId,
    deliveryPinId,
    verdict: 'revision_needed',
    score: 2,
    comment: 'Please add tests.',
    chain: 'mvc',
    attachments: ['metafile://one', 'metafile://two'],
  }]);
});

test('runCli rejects loom review-delivery scores outside the 1 to 5 range', async () => {
  const calls = [];
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  const { exitCode, envelope } = await runLoom([
    'loom',
    'review-delivery',
    '--task-pin-id',
    validTaskPinId,
    '--delivery-pin-id',
    deliveryPinId,
    '--verdict',
    'revision_needed',
    '--score',
    '6',
    '--comment',
    'Please add tests.',
  ], {
    dependencies: {
      loom: {
        reviewDelivery: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { reviewed: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /--score/);
  assert.match(envelope.message, /1 to 5/);
  assert.deepEqual(calls, []);
});

test('runCli rejects loom review-delivery --attachment without a value', async () => {
  const calls = [];
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  const { exitCode, envelope } = await runLoom([
    'loom',
    'review-delivery',
    '--task-pin-id',
    validTaskPinId,
    '--delivery-pin-id',
    deliveryPinId,
    '--verdict',
    'revision_needed',
    '--score',
    '2',
    '--comment',
    'Please add tests.',
    '--attachment',
    '--chain',
    'mvc',
  ], {
    dependencies: {
      loom: {
        reviewDelivery: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { reviewed: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /--attachment/);
  assert.deepEqual(calls, []);
});

test('runCli delegates loom state task pin and refresh flag to runtime dependencies', async () => {
  const calls = [];
  const { exitCode } = await runLoom(['loom', 'state', validTaskPinId, '--refresh'], {
    dependencies: {
      loom: {
        state: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { found: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ taskPinId: validTaskPinId, refresh: true }]);
});

test('runCli rejects loom draft-task --from without an actor value', async () => {
  for (const args of [
    ['loom', 'draft-task', '--wish', 'hi', '--from'],
    ['loom', 'draft-task', '--wish', 'hi', '--from', '--allow-invalid'],
  ]) {
    const calls = [];
    const { exitCode, envelope } = await runLoom(args, {
      dependencies: {
        loom: {
          draftTask: async (input) => {
            calls.push(input);
            return { ok: true, state: 'success', data: { drafted: true } };
          },
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.state, 'failed');
    assert.equal(envelope.code, 'invalid_flag');
    assert.match(envelope.message, /--from/);
    assert.deepEqual(calls, []);
  }
});

test('runCli requires --wish for loom draft-task', async () => {
  for (const args of [
    ['loom', 'draft-task'],
    ['loom', 'draft-task', '--wish', '--from', 'alice'],
  ]) {
    const { exitCode, envelope } = await runLoom(args);

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.state, 'failed');
    assert.equal(envelope.code, 'missing_flag');
    assert.match(envelope.message, /--wish/);
  }
});

test('runCli delegates loom sync to runtime dependencies', async () => {
  const calls = [];
  const { exitCode, envelope } = await runLoom(['loom', 'sync'], {
    dependencies: {
      loom: {
        sync: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { synced: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{}]);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { synced: true });
});

test('runCli delegates loom list to runtime dependencies', async () => {
  const calls = [];
  const { exitCode, envelope } = await runLoom(['loom', 'list'], {
    dependencies: {
      loom: {
        list: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { tasks: [] } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ refresh: false }]);
  assert.equal(envelope.ok, true);
  assert.deepEqual(envelope.data, { tasks: [] });
});

test('runCli passes refresh flag to loom list dependencies', async () => {
  const calls = [];
  const { exitCode } = await runLoom(['loom', 'list', '--refresh'], {
    dependencies: {
      loom: {
        list: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { tasks: [] } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ refresh: true }]);
});

test('runCli passes task pin and refresh flag to loom show dependencies', async () => {
  const calls = [];
  const { exitCode } = await runLoom(['loom', 'show', validTaskPinId, '--refresh'], {
    dependencies: {
      loom: {
        show: async (input) => {
          calls.push(input);
          return { ok: true, state: 'success', data: { found: true } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ taskPinId: validTaskPinId, refresh: true }]);
});

test('runCli rejects invalid loom sync limit values', async () => {
  for (const args of [
    ['loom', 'sync', '--limit', '0'],
    ['loom', 'sync', '--limit'],
  ]) {
    const { exitCode, envelope } = await runLoom(args);

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, 'invalid_flag');
    assert.match(envelope.message, /--limit/);
  }
});

test('runCli rejects loom show without a task pin id', async () => {
  const { exitCode, envelope } = await runLoom(['loom', 'show', '--refresh']);

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'missing_argument');
  assert.match(envelope.message, /taskPinId/);
});

test('runCli does not use loom list display limit as refresh sync page size', async () => {
  const home = await createIndexedHome();
  await withChainApiServer(async ({ baseUrl, requests }) => {
    const { exitCode, envelope } = await runLoom(['loom', 'list', '--refresh', '--limit', '5'], {
      env: {
        ...process.env,
        HOME: home,
        METABOT_CHAIN_API_BASE_URL: baseUrl,
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(envelope.ok, true);
    assert.equal(requests.length, 6);
    for (const request of requests) {
      const parsed = new URL(request, baseUrl);
      assert.equal(parsed.searchParams.get('size'), '200');
    }
  });
});
