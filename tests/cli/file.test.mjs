import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

test('runCli dispatches `metabot file upload --request-file` with parsed JSON request', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
    contentType: 'image/png',
  }), 'utf8');

  const stdout = [];
  const calls = [];

  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'file-pin-1',
            metafileUri: 'metafile://file-pin-1.png',
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/photo.png',
    contentType: 'image/png',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      pinId: 'file-pin-1',
      metafileUri: 'metafile://file-pin-1.png',
    },
  });
});

test('runCli dispatches `metabot file upload --request-file --chain btc` and sets network=btc', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-btc-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain', 'btc'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'file-pin-btc-1',
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/photo.png',
    network: 'btc',
  }]);
});

test('runCli dispatches `metabot file upload --request-file --chain opcat` and sets network=opcat', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-opcat-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain', 'opcat'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'file-pin-opcat-1',
            network: input.network,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/photo.png',
    network: 'opcat',
  }]);
});

test('runCli dispatches `metabot file upload --from` to the upload dependency', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-from-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--from', 'alice', '--request-file', requestFile, '--chain', 'opcat'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'file-pin-alice-1',
            network: input.network,
            from: input.from,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/photo.png',
    network: 'opcat',
    from: 'alice',
  }]);
});

test('runCli fails `metabot file upload` when --chain value is missing', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-missing-chain-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
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

test('runCli fails `metabot file upload` when --chain value is doge', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-invalid-chain-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/photo.png',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload', '--request-file', requestFile, '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        upload: async (input) => {
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

test('runCli dispatches `metabot file upload-large --request-file` to uploadLarge', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-large-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/video.mp4',
    contentType: 'video/mp4',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload-large', '--request-file', requestFile], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'large-file-pin-1',
            metafileUri: 'metafile://large-file-pin-1.mp4',
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/video.mp4',
    contentType: 'video/mp4',
  }]);
  assert.deepEqual(JSON.parse(stdout.join('').trim()), {
    ok: true,
    state: 'success',
    data: {
      pinId: 'large-file-pin-1',
      metafileUri: 'metafile://large-file-pin-1.mp4',
    },
  });
});

test('runCli resolves upload-large relative file paths from the request file directory', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-large-relative-'));
  const requestDir = path.join(tempDir, 'requests');
  const requestFile = path.join(requestDir, 'request.json');
  await mkdir(requestDir, { recursive: true });
  await writeFile(requestFile, JSON.stringify({
    filePath: '../media/video.mp4',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['file', 'upload-large', '--request-file', requestFile], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'large-file-relative-1' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: path.resolve(requestDir, '../media/video.mp4'),
  }]);
});

test('runCli dispatches upload-large flags for actor, chain, and verification', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-large-flags-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/archive.zip',
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli([
    'file',
    'upload-large',
    '--from',
    'alice',
    '--request-file',
    requestFile,
    '--chain',
    'btc',
    '--verify',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'large-file-btc-1',
            network: input.network,
            from: input.from,
            verify: input.verify,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/archive.zip',
    network: 'btc',
    from: 'alice',
    verify: true,
  }]);
});

test('runCli dispatches upload-large --chain opcat to uploadLarge', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-large-opcat-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/archive.zip',
    verify: true,
  }), 'utf8');

  const calls = [];
  const exitCode = await runCli(['file', 'upload-large', '--request-file', requestFile, '--chain', 'opcat'], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
          calls.push(input);
          return commandSuccess({
            pinId: 'large-file-opcat-1',
            network: input.network,
            verify: input.verify,
          });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{
    filePath: '/tmp/archive.zip',
    verify: true,
    network: 'opcat',
  }]);
});

test('runCli fails `metabot file upload-large` when --chain value is doge before dependency call', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'metabot-cli-file-large-doge-'));
  const requestFile = path.join(tempDir, 'request.json');
  await writeFile(requestFile, JSON.stringify({
    filePath: '/tmp/archive.zip',
  }), 'utf8');

  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload-large', '--request-file', requestFile, '--chain', 'doge'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
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

test('runCli fails `metabot file upload-large` when --request-file is missing', async () => {
  const stdout = [];
  const calls = [];
  const exitCode = await runCli(['file', 'upload-large'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: {
      file: {
        uploadLarge: async (input) => {
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
  assert.equal(envelope.code, 'missing_flag');
});

test('runCli still fails unknown file subcommands', async () => {
  const stdout = [];
  const exitCode = await runCli(['file', 'download'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });

  assert.equal(exitCode, 1);
  const envelope = JSON.parse(stdout.join('').trim());
  assert.equal(envelope.ok, false);
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.code, 'unknown_command');
});
