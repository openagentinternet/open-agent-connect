import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runMetaAppCli(args, dependencies = {}) {
  const stdout = [];
  const exitCode = await runCli(args, {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies,
  });
  return {
    exitCode,
    envelope: stdout.length ? JSON.parse(stdout.join('').trim()) : null,
  };
}

test('runCli dispatches `metabot metaapp publish` with parsed project inputs', async () => {
  const projectDir = path.join(os.tmpdir(), 'metabot-cli-metaapp-publish');
  const calls = [];

  const exitCode = await runCli([
    'metaapp',
    'publish',
    '--project-dir',
    projectDir,
    '--from',
    'alice',
    '--chain',
    'opcat',
    '--confirm',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      metaapp: {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'metaapp-pin-1i0' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0], {
    projectDir,
    from: 'alice',
    network: 'opcat',
    confirm: true,
  });
});

test('runCli fails metaapp preview, publish, and update without --project-dir', async () => {
  for (const args of [
    ['metaapp', 'preview'],
    ['metaapp', 'publish', '--from', 'alice'],
    ['metaapp', 'update', '--target-pin-id', 'metaapp-pin-1i0'],
  ]) {
    const { exitCode, envelope } = await runMetaAppCli(args, {
      metaapp: {
        preview: async () => commandSuccess({ shouldNotRun: true }),
        publish: async () => commandSuccess({ shouldNotRun: true }),
        update: async () => commandSuccess({ shouldNotRun: true }),
      },
    });

    assert.equal(exitCode, 1);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, 'missing_flag');
    assert.match(envelope.message, /--project-dir/);
  }
});

test('runCli fails `metabot metaapp update` without --target-pin-id', async () => {
  const projectDir = path.join(os.tmpdir(), 'metabot-cli-metaapp-update');

  const { exitCode, envelope } = await runMetaAppCli([
    'metaapp',
    'update',
    '--project-dir',
    projectDir,
  ], {
    metaapp: {
      update: async () => commandSuccess({ shouldNotRun: true }),
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'missing_flag');
  assert.match(envelope.message, /--target-pin-id/);
});

test('runCli ignores share --chain unless --announce is present', async () => {
  const calls = [];
  const exitCode = await runCli([
    'metaapp',
    'share',
    '--pin-id',
    'metaapp-pin-1i0',
    '--chain',
    'doge',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      metaapp: {
        share: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'metaapp-pin-1i0' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0], {
    pinId: 'metaapp-pin-1i0',
    announce: false,
  });
});

test('runCli propagates share --announce write-chain selection', async () => {
  const calls = [];
  const exitCode = await runCli([
    'metaapp',
    'share',
    '--pin-id',
    'metaapp-pin-1i0',
    '--announce',
    '--chain',
    'doge',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      metaapp: {
        share: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'metaapp-pin-1i0', buzzPinId: 'buzz-pin-1i0' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0], {
    pinId: 'metaapp-pin-1i0',
    network: 'doge',
    announce: true,
  });
});

test('runCli rejects conflicting metaapp view selectors', async () => {
  for (const args of [
    ['metaapp', 'view', '--pin-id', 'metaapp-pin-1i0', '--first-pin-id', 'first-metaapp-pin-1i0'],
    ['metaapp', 'view', '--mine', '--pin-id', 'metaapp-pin-1i0'],
    ['metaapp', 'view', '--mine', '--first-pin-id', 'first-metaapp-pin-1i0'],
  ]) {
    const calls = [];
    const { exitCode, envelope } = await runMetaAppCli(args, {
      metaapp: {
        view: async (input) => {
          calls.push(input);
          return commandSuccess({ localUiUrl: 'http://127.0.0.1:4827/ui/metaapps' });
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(calls, []);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, 'invalid_flag');
  }
});

test('runCli rejects metaapp view selector flags with missing values', async () => {
  for (const args of [
    ['metaapp', 'view', '--pin-id', '--from', 'alice'],
    ['metaapp', 'view', '--first-pin-id'],
  ]) {
    const calls = [];
    const { exitCode, envelope } = await runMetaAppCli(args, {
      metaapp: {
        view: async (input) => {
          calls.push(input);
          return commandSuccess({ localUiUrl: 'http://127.0.0.1:4827/ui/metaapps' });
        },
      },
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(calls, []);
    assert.equal(envelope.ok, false);
    assert.equal(envelope.code, 'invalid_flag');
  }
});

test('runCli dispatches `metabot metaapp comment` with parsed comment inputs', async () => {
  const calls = [];
  const exitCode = await runCli([
    'metaapp',
    'comment',
    '--pin-id',
    'metaapp-pin-1i0',
    '--comment',
    'Great demo',
    '--from',
    'alice',
    '--chain',
    'btc',
  ], {
    stdout: { write: () => true },
    stderr: { write: () => true },
    dependencies: {
      metaapp: {
        comment: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'comment-pin-1i0' });
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls[0], {
    pinId: 'metaapp-pin-1i0',
    from: 'alice',
    network: 'btc',
    comment: 'Great demo',
  });
});
