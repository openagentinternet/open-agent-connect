import assert from 'node:assert/strict';
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

test('runCli dispatches `metabot metaapp publish --payload-file` with parsed payload input', async () => {
  const calls = [];
  const exitCode = await runCli([
    'metaapp',
    'publish',
    '--from',
    'alice',
    '--payload-file',
    'metaapp.json',
    '--chain',
    'mvc',
    '--confirm',
  ], {
    cwd: '/tmp/oac-cli-metaapp',
    readTextFile: async (filePath) => {
      assert.equal(filePath, '/tmp/oac-cli-metaapp/metaapp.json');
      return JSON.stringify({ title: 'Demo', appName: 'demo', runtime: ['browser'] });
    },
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
    from: 'alice',
    title: 'Demo',
    appName: 'demo',
    runtime: ['browser'],
    network: 'mvc',
    confirm: true,
  });
});

test('runCli dispatches `metabot metaapp list` with owner pagination input', async () => {
  const calls = [];
  const { exitCode } = await runMetaAppCli([
    'metaapp',
    'list',
    '--from',
    'alice',
    '--size',
    '12',
    '--cursor',
    'cursor-1',
  ], {
    metaapp: {
      list: async (input) => {
        calls.push(input);
        return commandSuccess({ records: [], nextCursor: '' });
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice', size: 12, cursor: 'cursor-1' }]);
});

test('runCli dispatches `metabot metaapp delete` only with confirmation', async () => {
  const pinId = 'b'.repeat(64) + 'i0';
  const calls = [];

  const missing = await runMetaAppCli(['metaapp', 'delete', '--target-pin-id', pinId], {
    metaapp: { delete: async () => commandSuccess({ shouldNotRun: true }) },
  });
  assert.equal(missing.exitCode, 1);
  assert.equal(missing.envelope.code, 'confirmation_required');

  const confirmed = await runMetaAppCli([
    'metaapp',
    'delete',
    '--from',
    'alice',
    '--target-pin-id',
    pinId,
    '--confirm',
    '--chain',
    'mvc',
  ], {
    metaapp: {
      delete: async (input) => {
        calls.push(input);
        return commandSuccess({ revokedPinId: pinId });
      },
    },
  });

  assert.equal(confirmed.exitCode, 0);
  assert.deepEqual(calls, [{ from: 'alice', targetPinId: pinId, network: 'mvc', confirm: true }]);
});

test('runCli dispatches project packaging through publish-project and update-project', async () => {
  const calls = [];
  const publish = await runMetaAppCli([
    'metaapp',
    'publish-project',
    '--project-dir',
    './dist-site',
    '--manifest-file',
    './metaapp.json',
    '--from',
    'alice',
    '--confirm',
  ], {
    metaapp: {
      publishProject: async (input) => {
        calls.push(['publishProject', input]);
        return commandSuccess({ pinId: 'c'.repeat(64) + 'i0' });
      },
    },
  });

  const update = await runMetaAppCli([
    'metaapp',
    'update-project',
    '--target-pin-id',
    'd'.repeat(64) + 'i0',
    '--project-dir',
    './dist-site',
    '--from',
    'alice',
    '--confirm',
  ], {
    metaapp: {
      updateProject: async (input) => {
        calls.push(['updateProject', input]);
        return commandSuccess({ pinId: 'e'.repeat(64) + 'i0' });
      },
    },
  });

  assert.equal(publish.exitCode, 0);
  assert.equal(update.exitCode, 0);
  assert.deepEqual(calls[0], ['publishProject', {
    projectDir: './dist-site',
    manifestFile: './metaapp.json',
    from: 'alice',
    confirm: true,
  }]);
  assert.deepEqual(calls[1], ['updateProject', {
    targetPinId: 'd'.repeat(64) + 'i0',
    projectDir: './dist-site',
    from: 'alice',
    confirm: true,
  }]);
});

test('runCli rejects old project-dir usage on publish and update', async () => {
  for (const args of [
    ['metaapp', 'publish', '--project-dir', './dist-site'],
    ['metaapp', 'update', '--target-pin-id', 'd'.repeat(64) + 'i0', '--project-dir', './dist-site'],
  ]) {
    const { exitCode, envelope } = await runMetaAppCli(args, {
      metaapp: {
        publish: async () => commandSuccess({ shouldNotRun: true }),
        update: async () => commandSuccess({ shouldNotRun: true }),
      },
    });
    assert.equal(exitCode, 1);
    assert.equal(envelope.code, 'invalid_flag');
    assert.match(envelope.message, /publish-project|update-project/);
  }
});

test('runCli fails metaapp preview without --project-dir', async () => {
  const { exitCode, envelope } = await runMetaAppCli(['metaapp', 'preview'], {
    metaapp: {
      preview: async () => commandSuccess({ shouldNotRun: true }),
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(envelope.ok, false);
  assert.equal(envelope.code, 'missing_flag');
  assert.match(envelope.message, /--project-dir/);
});

test('runCli fails `metabot metaapp update` without --target-pin-id', async () => {
  const { exitCode, envelope } = await runMetaAppCli([
    'metaapp',
    'update',
    '--payload-file',
    'metaapp.json',
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

test('runCli dispatches `metabot ui open --page metaapps` to the injected ui.open handler', async () => {
  const calls = [];
  const { exitCode, envelope } = await runMetaAppCli([
    'ui',
    'open',
    '--page',
    'metaapps',
  ], {
    ui: {
      open: async (input) => {
        calls.push(input);
        return commandSuccess({
          page: input.page,
          localUiUrl: 'http://127.0.0.1:4827/ui/metaapps',
        });
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ page: 'metaapps' }]);
  assert.equal(envelope.ok, true);
  assert.equal(envelope.data.page, 'metaapps');
  assert.match(envelope.data.localUiUrl, /\/ui\/metaapps$/);
});
