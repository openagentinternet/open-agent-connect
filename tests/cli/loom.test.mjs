import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const {
  LOOM_DEV_ROUND_LLM_TIMEOUT_MS,
  LOOM_DRAFT_LLM_TIMEOUT_MS,
} = require('../../dist/cli/runtime.js');

const validTaskPinId = `${'a'.repeat(64)}i0`;
const fixtureMnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const fixturePath = "m/44'/10001'/0'/0/0";
const fixtureGlobalMetaId = 'idq1970463ym8fqmgawe4lylktne97ahhw4kqehkch';

test('loom dev rounds use a production-sized LLM timeout distinct from draft generation', () => {
  assert.equal(LOOM_DRAFT_LLM_TIMEOUT_MS, 120_000);
  assert.ok(LOOM_DEV_ROUND_LLM_TIMEOUT_MS > LOOM_DRAFT_LLM_TIMEOUT_MS);
  assert.ok(LOOM_DEV_ROUND_LLM_TIMEOUT_MS >= 900_000);
});

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

async function createIndexedHome(options = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-home-'));
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  const managerRoot = path.join(home, '.metabot', 'manager');
  const now = Date.now();
  await mkdir(profileHome, { recursive: true });
  await mkdir(managerRoot, { recursive: true });
  await writeFile(
    path.join(managerRoot, 'identity-profiles.json'),
    JSON.stringify({
      profiles: [{
        name: 'eric',
        slug: 'eric',
        aliases: ['eric'],
        homeDir: profileHome,
        globalMetaId: options.globalMetaId ?? '',
        mvcAddress: '',
        createdAt: now,
        updatedAt: now,
      }],
    }),
    'utf8',
  );
  await writeFile(
    path.join(managerRoot, 'active-home.json'),
    JSON.stringify({ homeDir: profileHome, updatedAt: now }),
    'utf8',
  );
  return home;
}

function cachedLoomRecord(protocol, pinId, payload, overrides = {}) {
  return {
    pinId,
    protocol,
    path: `/protocols/loom-${protocol}`,
    operation: 'create',
    contentType: 'application/json',
    timestamp: overrides.timestamp ?? 1,
    creatorAddress: '',
    creatorMetaId: '',
    globalMetaId: overrides.globalMetaId ?? '',
    payload,
    payloadValid: true,
    validationErrors: [],
    raw: {},
    ...overrides,
  };
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

function chainApiRow(record) {
  return {
    id: record.pinId,
    path: record.path,
    operation: record.operation,
    contentType: record.contentType,
    timestamp: record.timestamp,
    createAddress: record.creatorAddress,
    metaid: record.creatorMetaId,
    globalMetaId: record.globalMetaId,
    contentSummary: JSON.stringify(record.payload),
  };
}

async function withChainApiRows(records, handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const url = new URL(request.url, 'http://127.0.0.1');
    const requestedPath = url.searchParams.get('path');
    const list = records
      .filter((record) => record.path === requestedPath)
      .map(chainApiRow);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ data: { list, nextCursor: null } }));
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

async function withFailingChainApiServer(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    response.statusCode = 503;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ error: 'chain unavailable' }));
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

async function writeRawLoomCache(home, records, updatedAt = Date.now()) {
  const rawCachePath = path.join(home, '.metabot', 'loom', 'records.json');
  await mkdir(path.dirname(rawCachePath), { recursive: true });
  await writeFile(rawCachePath, JSON.stringify({
    version: 1,
    updatedAt,
    records: {
      task: [],
      claim: [],
      status: [],
      delivery: [],
      acceptance: [],
      'claim-reject': [],
      ...records,
    },
  }), 'utf8');
  return rawCachePath;
}

async function writeIdentitySecrets(profileHome) {
  const secretsPath = path.join(profileHome, '.runtime', 'identity-secrets.json');
  await mkdir(path.dirname(secretsPath), { recursive: true });
  await writeFile(secretsPath, JSON.stringify({
    mnemonic: fixtureMnemonic,
    path: fixturePath,
  }), 'utf8');
  return secretsPath;
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

test('runCli default loom post-task reads a payload file and writes through chain dependency', async () => {
  const home = await createIndexedHome();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-post-task-'));
  const payload = {
    title: 'Publish a Loom task',
    requirementContentType: 'text/markdown',
    requirement: 'Wire post-task to the runtime workflow.',
    criteriaContentType: 'text/markdown',
    criteria: 'The CLI writes a valid loom-task record.',
    projectBase: 'chain',
    project: {},
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
  };
  const payloadFile = await writePayload(tempDir, payload);
  const writes = [];

  const { exitCode, envelope } = await runLoom([
    'loom',
    'post-task',
    '--from',
    'eric',
    '--payload-file',
    payloadFile,
    '--chain',
    'mvc',
  ], {
    env: {
      ...process.env,
      HOME: home,
    },
    dependencies: {
      chain: {
        write: async (input) => {
          writes.push(input);
          return {
            ok: true,
            state: 'success',
            data: {
              pinId: 'task-pin-id',
              network: 'mvc',
            },
          };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.pinId, 'task-pin-id');
  assert.deepEqual(writes, [{
    operation: 'create',
    path: '/protocols/loom-task',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    from: 'eric',
    network: 'mvc',
  }]);
});

test('runCli default loom post-task dry-run previews actor and network without writing', async () => {
  const home = await createIndexedHome();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-post-task-dry-run-'));
  const payload = {
    title: 'Preview a Loom task',
    requirementContentType: 'text/markdown',
    requirement: 'Return the chain write preview without writing.',
    criteriaContentType: 'text/markdown',
    criteria: 'The preview includes actor and network fields.',
    projectBase: 'chain',
    project: {},
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
  };
  const payloadFile = await writePayload(tempDir, payload);
  const writes = [];

  const { exitCode, envelope } = await runLoom([
    'loom',
    'post-task',
    '--from',
    'eric',
    '--payload-file',
    payloadFile,
    '--chain',
    'mvc',
    '--dry-run',
  ], {
    env: {
      ...process.env,
      HOME: home,
    },
    dependencies: {
      chain: {
        write: async (input) => {
          writes.push(input);
          return { ok: true, state: 'success', data: { pinId: 'should-not-write' } };
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.dryRun, true);
  assert.equal(envelope.data.request.from, 'eric');
  assert.equal(envelope.data.request.network, 'mvc');
  assert.deepEqual(writes, []);
});

test('runCli default loom post-task dry-run validates missing actor profile before previewing', async () => {
  const home = await createIndexedHome();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-loom-post-task-missing-actor-'));
  const payload = {
    title: 'Preview a Loom task',
    requirementContentType: 'text/markdown',
    requirement: 'Validate the requested actor before returning a dry-run preview.',
    criteriaContentType: 'text/markdown',
    criteria: 'Missing actor profiles fail before chain write.',
    projectBase: 'chain',
    project: {},
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
  };
  const payloadFile = await writePayload(tempDir, payload);
  const writes = [];

  const { exitCode, envelope } = await runLoom([
    'loom',
    'post-task',
    '--from',
    'missing-profile',
    '--payload-file',
    payloadFile,
    '--dry-run',
  ], {
    env: {
      ...process.env,
      HOME: home,
    },
    dependencies: {
      chain: {
        write: async (input) => {
          writes.push(input);
          return { ok: true, state: 'success', data: { pinId: 'should-not-write' } };
        },
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'profile_not_found');
  assert.deepEqual(writes, []);
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

test('runCli rejects loom claim-and-start with both payout and claim pin id modes', async () => {
  const calls = [];
  const claimPinId = `${'b'.repeat(64)}i0`;
  const { exitCode, envelope } = await runLoom([
    'loom',
    'claim-and-start',
    '--from',
    'bob',
    '--task-pin-id',
    validTaskPinId,
    '--payout-address',
    '1DeveloperPayoutAddress',
    '--claim-pin-id',
    claimPinId,
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
  assert.equal(envelope.code, 'invalid_flag');
  assert.match(envelope.message, /--payout-address/);
  assert.match(envelope.message, /--claim-pin-id/);
  assert.deepEqual(calls, []);
});

test('runCli reports loom claim-and-start file-chain validation against --file-chain', async () => {
  for (const args of [
    [
      'loom',
      'claim-and-start',
      '--task-pin-id',
      validTaskPinId,
      '--payout-address',
      '1DeveloperPayoutAddress',
      '--file-chain',
    ],
    [
      'loom',
      'claim-and-start',
      '--task-pin-id',
      validTaskPinId,
      '--payout-address',
      '1DeveloperPayoutAddress',
      '--file-chain',
      'doge',
    ],
  ]) {
    const calls = [];
    const { exitCode, envelope } = await runLoom(args, {
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
    assert.equal(envelope.code, 'invalid_flag');
    assert.match(envelope.message, /--file-chain/);
    assert.doesNotMatch(envelope.message, /--chain/);
    assert.deepEqual(calls, []);
  }
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

test('runCli default loom deliver dry-run uses indexed profile identity without signer secrets', async () => {
  const developerGlobalMetaId = 'metaid-eric';
  const home = await createIndexedHome({ globalMetaId: developerGlobalMetaId });
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  const claimPinId = `${'b'.repeat(64)}i0`;
  const statusPinId = `${'d'.repeat(64)}i0`;
  const taskPayload = {
    title: 'Preview delivery',
    requirementContentType: 'text/markdown',
    requirement: 'Preview a delivery without mutating identity secrets.',
    criteriaContentType: 'text/markdown',
    criteria: '- Review the PR',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
  };
  const rawCachePath = path.join(home, '.metabot', 'loom', 'records.json');
  const workflowPath = path.join(profileHome, '.runtime', 'loom', 'workflows', validTaskPinId, `${claimPinId}.json`);
  await mkdir(path.dirname(rawCachePath), { recursive: true });
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(rawCachePath, JSON.stringify({
    version: 1,
    updatedAt: Date.now(),
    records: {
      task: [cachedLoomRecord('task', validTaskPinId, taskPayload)],
      claim: [cachedLoomRecord('claim', claimPinId, {
        taskPinId: validTaskPinId,
        payoutAddress: '1DeveloperPayoutAddress',
      }, { globalMetaId: developerGlobalMetaId })],
      status: [],
      delivery: [],
      acceptance: [],
      'claim-reject': [],
    },
  }), 'utf8');
  await writeFile(workflowPath, JSON.stringify({
    version: 1,
    taskPinId: validTaskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    developerGlobalMetaId,
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    forkRepo: 'eric/open-agent-connect',
    branchName: 'loom/task-claim',
    workspacePath: path.join(profileHome, 'repo'),
    claim: { pinId: claimPinId },
    statuses: [{
      roundId: 'round-1',
      status: 'completed',
      pinId: statusPinId,
      commits: [],
      checksPassed: true,
    }],
    updatedAt: '2026-05-16T00:00:00.000Z',
  }), 'utf8');

  const { exitCode, envelope } = await runLoom([
    'loom',
    'deliver',
    '--from',
    'eric',
    '--task-pin-id',
    validTaskPinId,
    '--claim-pin-id',
    claimPinId,
    '--dry-run',
  ], {
    env: {
      ...process.env,
      HOME: home,
    },
    dependencies: {
      chain: {
        write: async () => {
          throw new Error('dry-run must not write chain data');
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.dryRun, true);
  assert.equal(envelope.data.pullRequest.head, 'eric:loom/task-claim');
  await assert.rejects(
    readFile(path.join(profileHome, '.runtime', 'identity-secrets.json'), 'utf8'),
    { code: 'ENOENT' },
  );
});

test('runCli default loom deliver refreshes raw cache before resolving related chain records', async () => {
  const developerGlobalMetaId = 'metaid-eric';
  const home = await createIndexedHome({ globalMetaId: developerGlobalMetaId });
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  const claimPinId = `${'b'.repeat(64)}i0`;
  const statusPinId = `${'d'.repeat(64)}i0`;
  const taskPayload = {
    title: 'Deliver after fresh chain writes',
    requirementContentType: 'text/markdown',
    requirement: 'Deliver without requiring a manual loom sync between commands.',
    criteriaContentType: 'text/markdown',
    criteria: '- Review the PR',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '1',
      currency: 'SPACE',
    },
  };
  await writeRawLoomCache(home, {});
  const workflowPath = path.join(profileHome, '.runtime', 'loom', 'workflows', validTaskPinId, `${claimPinId}.json`);
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, JSON.stringify({
    version: 1,
    taskPinId: validTaskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    developerGlobalMetaId,
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    forkRepo: 'eric/open-agent-connect',
    branchName: 'loom/task-claim',
    workspacePath: path.join(profileHome, 'repo'),
    claim: { pinId: claimPinId },
    statuses: [{
      roundId: 'round-1',
      status: 'completed',
      pinId: statusPinId,
      commits: [],
      checksPassed: true,
    }],
    updatedAt: '2026-05-16T00:00:00.000Z',
  }), 'utf8');

  await withChainApiRows([
    cachedLoomRecord('task', validTaskPinId, taskPayload, { globalMetaId: 'requester-metaid', timestamp: 1 }),
    cachedLoomRecord('claim', claimPinId, {
      taskPinId: validTaskPinId,
      payoutAddress: '1DeveloperPayoutAddress',
    }, { globalMetaId: developerGlobalMetaId, timestamp: 2 }),
  ], async ({ baseUrl, requests }) => {
    const { exitCode, envelope } = await runLoom([
      'loom',
      'deliver',
      '--from',
      'eric',
      '--task-pin-id',
      validTaskPinId,
      '--claim-pin-id',
      claimPinId,
      '--dry-run',
    ], {
      env: {
        ...process.env,
        HOME: home,
        METABOT_CHAIN_API_BASE_URL: baseUrl,
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.dryRun, true);
    assert.equal(envelope.data.pullRequest.head, 'eric:loom/task-claim');
    assert.equal(requests.length, 6);
  });
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

test('runCli default loom accept-and-pay confirm fails closed when raw cache refresh fails', async () => {
  const home = await createIndexedHome({ globalMetaId: fixtureGlobalMetaId });
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  await writeIdentitySecrets(profileHome);
  const claimPinId = `${'b'.repeat(64)}i0`;
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  await writeRawLoomCache(home, {
    task: [cachedLoomRecord('task', validTaskPinId, {
      title: 'Pay only after a fresh chain read',
      requirementContentType: 'text/markdown',
      requirement: 'Confirmed payment must not continue from stale cache after refresh failure.',
      criteriaContentType: 'text/markdown',
      criteria: '- Payment is guarded by a fresh chain read',
      projectBase: 'github',
      project: {
        repoUri: 'https://github.com/openagentinternet/open-agent-connect',
        baseBranch: 'main',
      },
      bounty: {
        amount: '1',
        currency: 'SPACE',
      },
    }, { globalMetaId: fixtureGlobalMetaId, timestamp: 1 })],
    claim: [cachedLoomRecord('claim', claimPinId, {
      taskPinId: validTaskPinId,
      payoutAddress: '1DeveloperPayoutAddress',
    }, { globalMetaId: 'developer-metaid', timestamp: 2 })],
    delivery: [cachedLoomRecord('delivery', deliveryPinId, {
      taskPinId: validTaskPinId,
      claimPinId,
      deliveryBase: 'github',
      deliverySummary: 'Ready for review.',
      delivery: {
        prUrl: 'https://github.com/openagentinternet/open-agent-connect/pull/123',
        prBranch: 'loom/task-claim',
        prBaseBranch: 'main',
        prTitle: 'feat: guarded payment',
      },
      reviewChecklist: [{ item: 'Payment guard checked.', status: 'passed' }],
    }, { globalMetaId: 'developer-metaid', timestamp: 3 })],
  });

  await withFailingChainApiServer(async ({ baseUrl, requests }) => {
    const { exitCode, envelope } = await runLoom([
      'loom',
      'accept-and-pay',
      '--from',
      'eric',
      '--task-pin-id',
      validTaskPinId,
      '--delivery-pin-id',
      deliveryPinId,
      '--score',
      '5',
      '--comment',
      'Looks good.',
      '--confirm-payment',
    ], {
      env: {
        ...process.env,
        HOME: home,
        METABOT_CHAIN_API_BASE_URL: baseUrl,
        METABOT_TEST_FAKE_CHAIN_WRITE: '1',
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, 'loom_refresh_failed');
    assert.equal(envelope.data.syncCommand, 'metabot loom sync');
    assert.match(envelope.data.cause, /loom_chain_reader_http_503/);
    assert.equal(requests.length, 1);
  });
});

test('runCli rejects loom accept-and-pay scores outside the literal 1 to 5 range', async () => {
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  for (const score of ['0', '6', '2.5', '1.0', '1e0', '05']) {
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

test('runCli rejects loom review-delivery scores outside the literal 1 to 5 range', async () => {
  const deliveryPinId = `${'c'.repeat(64)}i0`;
  for (const score of ['6', '1.0', '1e0', '05']) {
    const calls = [];
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
      score,
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
  }
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

test('runCli default loom state refresh returns derived state and cache metadata', async () => {
  const home = await createIndexedHome();
  const claimPinId = `${'b'.repeat(64)}i0`;
  const statusPinId = `${'d'.repeat(64)}i0`;
  await writeRawLoomCache(home, {
    task: [cachedLoomRecord('task', validTaskPinId, {
      title: 'Wire state runtime',
      requirementContentType: 'text/markdown',
      requirement: 'Return a derived task state.',
      criteriaContentType: 'text/markdown',
      criteria: 'The state command includes projection metadata.',
      projectBase: 'chain',
      project: {},
      bounty: { amount: '1', currency: 'SPACE' },
    }, { globalMetaId: 'requester-metaid' })],
    claim: [cachedLoomRecord('claim', claimPinId, {
      taskPinId: validTaskPinId,
      payoutAddress: '1DeveloperPayoutAddress',
    }, { globalMetaId: 'developer-metaid', timestamp: 2 })],
    status: [cachedLoomRecord('status', statusPinId, {
      taskPinId: validTaskPinId,
      claimPinId,
      status: 'in_progress',
    }, { globalMetaId: 'developer-metaid', timestamp: 3 })],
  }, 123);

  await withChainApiServer(async ({ baseUrl, requests }) => {
    const { exitCode, envelope } = await runLoom(['loom', 'state', validTaskPinId, '--refresh'], {
      env: {
        ...process.env,
        HOME: home,
        METABOT_CHAIN_API_BASE_URL: baseUrl,
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(envelope.ok, true);
    assert.equal(envelope.data.found, true);
    assert.equal(envelope.data.state, 'in_progress');
    assert.equal(envelope.data.valid.claims[0].pinId, claimPinId);
    assert.equal(envelope.data.latestStatus.pinId, statusPinId);
    assert.equal(envelope.data.cache.refreshed, true);
    assert.match(envelope.data.cache.path, /records\.json$/);
    assert.equal(typeof envelope.data.cache.updatedAt, 'number');
    assert.equal(requests.length, 6);
  });
});

test('runCli default loom state exposes invalid related records', async () => {
  const home = await createIndexedHome();
  const claimPinId = `${'b'.repeat(64)}i0`;
  const statusPinId = `${'d'.repeat(64)}i0`;
  await writeRawLoomCache(home, {
    task: [cachedLoomRecord('task', validTaskPinId, {
      title: 'Inspect invalid records',
      requirementContentType: 'text/markdown',
      requirement: 'Show invalid related records.',
      criteriaContentType: 'text/markdown',
      criteria: 'Invalid statuses remain visible.',
      projectBase: 'chain',
      project: {},
      bounty: { amount: '1', currency: 'SPACE' },
    }, { globalMetaId: 'requester-metaid' })],
    claim: [cachedLoomRecord('claim', claimPinId, {
      taskPinId: validTaskPinId,
      payoutAddress: '1DeveloperPayoutAddress',
    }, { globalMetaId: 'developer-metaid', timestamp: 2 })],
    status: [cachedLoomRecord('status', statusPinId, {
      taskPinId: validTaskPinId,
      claimPinId,
      status: 'in_progress',
    }, { globalMetaId: 'other-developer-metaid', timestamp: 3 })],
  });

  const { exitCode, envelope } = await runLoom(['loom', 'state', validTaskPinId], {
    env: {
      ...process.env,
      HOME: home,
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.invalid.statuses[0].record.pinId, statusPinId);
  assert.equal(envelope.data.invalid.statuses[0].reason.code, 'permission_denied');
});

test('runCli default loom state includes valid local workflow states', async () => {
  const home = await createIndexedHome({ globalMetaId: 'developer-metaid' });
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  const claimPinId = `${'b'.repeat(64)}i0`;
  await writeRawLoomCache(home, {
    task: [cachedLoomRecord('task', validTaskPinId, {
      title: 'Include local workflow',
      requirementContentType: 'text/markdown',
      requirement: 'Return local workflow state files.',
      criteriaContentType: 'text/markdown',
      criteria: 'The workflow state is normalized before returning.',
      projectBase: 'chain',
      project: {},
      bounty: { amount: '1', currency: 'SPACE' },
    })],
  });
  const workflowPath = path.join(profileHome, '.runtime', 'loom', 'workflows', validTaskPinId, `${claimPinId}.json`);
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, JSON.stringify({
    version: 1,
    taskPinId: validTaskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    developerGlobalMetaId: 'developer-metaid',
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    forkRepo: 'eric/open-agent-connect',
    branchName: 'loom/task-claim',
    workspacePath: path.join(profileHome, 'workspace'),
    claim: { pinId: claimPinId },
    statuses: [],
    updatedAt: '2026-05-16T00:00:00.000Z',
  }), 'utf8');
  await writeFile(path.join(path.dirname(workflowPath), 'malformed.json'), '{', 'utf8');

  const { exitCode, envelope } = await runLoom(['loom', 'state', validTaskPinId], {
    env: {
      ...process.env,
      HOME: home,
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.localWorkflows.length, 1);
  assert.equal(envelope.data.localWorkflows[0].claimPinId, claimPinId);
  assert.equal(envelope.data.localWorkflows[0].branchName, 'loom/task-claim');
  assert.equal(envelope.data.localWorkflows[0].workspacePath, path.join(profileHome, 'workspace'));
});

test('runCli default loom state missing task returns task_not_found with cache metadata and local workflows', async () => {
  const home = await createIndexedHome();
  const profileHome = path.join(home, '.metabot', 'profiles', 'eric');
  const claimPinId = `${'b'.repeat(64)}i0`;
  await writeRawLoomCache(home, {});
  const workflowPath = path.join(profileHome, '.runtime', 'loom', 'workflows', validTaskPinId, `${claimPinId}.json`);
  await mkdir(path.dirname(workflowPath), { recursive: true });
  await writeFile(workflowPath, JSON.stringify({
    version: 1,
    taskPinId: validTaskPinId,
    claimPinId,
    developerMetaBotSlug: 'eric',
    repoUri: 'https://github.com/openagentinternet/open-agent-connect',
    baseBranch: 'main',
    upstreamRemote: 'origin',
    forkRemote: 'fork',
    branchName: 'loom/task-claim',
    workspacePath: path.join(profileHome, 'workspace'),
    statuses: [],
    updatedAt: '2026-05-16T00:00:00.000Z',
  }), 'utf8');

  const { exitCode, envelope } = await runLoom(['loom', 'state', validTaskPinId], {
    env: {
      ...process.env,
      HOME: home,
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'task_not_found');
  assert.equal(envelope.data.found, false);
  assert.match(envelope.data.cache.path, /records\.json$/);
  assert.equal(envelope.data.cache.refreshed, false);
  assert.equal(envelope.data.localWorkflows.length, 1);
  assert.equal(envelope.data.localWorkflows[0].claimPinId, claimPinId);
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
