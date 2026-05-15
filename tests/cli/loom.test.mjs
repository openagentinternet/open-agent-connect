import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
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

async function runLoom(args, options = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    cwd: options.cwd,
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
