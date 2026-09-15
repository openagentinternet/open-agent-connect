import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

async function runProtocol(argv, protocolDeps) {
  const stdout = [];
  const exitCode = await runCli(['protocol', ...argv], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    dependencies: { protocol: protocolDeps },
  });
  const raw = stdout.join('').trim();
  return { exitCode, result: raw ? JSON.parse(raw) : null };
}

test('protocol list parses filters and dispatches', async () => {
  const calls = [];
  const { exitCode } = await runProtocol(
    ['list', '--query', 'buzz', '--publisher', 'idq1x', '--size', '15', '--cursor', 'c9'],
    {
      list: async (input) => {
        calls.push(input);
        return commandSuccess({ items: [], hasMore: false, nextCursor: null, formatted: 'x' });
      },
    },
  );
  assert.equal(exitCode, 0);
  assert.equal(calls[0].query, 'buzz');
  assert.equal(calls[0].publisher, 'idq1x');
  assert.equal(calls[0].size, 15);
  assert.equal(calls[0].cursor, 'c9');
});

test('protocol read/versions require a locator and pass it through', async () => {
  const calls = [];
  const read = await runProtocol(['read', '--path', '/protocols/simplebuzz'], {
    read: async (input) => {
      calls.push(input);
      return commandSuccess({ record: {}, formatted: 'sheet' });
    },
  });
  assert.equal(read.exitCode, 0);
  assert.equal(calls[0].protocolPath, '/protocols/simplebuzz');

  const byName = await runProtocol(['versions', '--name', 'SimpleBuzz'], {
    versions: async (input) => {
      calls.push(input);
      return commandSuccess({ versions: [], formatted: 'chain' });
    },
  });
  assert.equal(byName.exitCode, 0);
  assert.equal(calls[1].protocolName, 'SimpleBuzz');

  const missing = await runProtocol(['read'], { read: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');
});

test('protocol check requires --path', async () => {
  const missing = await runProtocol(['check'], { check: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');
  const ok = await runProtocol(['check', '--path', '/protocols/simplebuzz'], {
    check: async (input) => {
      assert.equal(input.protocolPath, '/protocols/simplebuzz');
      return commandSuccess({ available: true, formatted: 'free' });
    },
  });
  assert.equal(ok.exitCode, 0);
});

test('protocol publish/update require --request-file and map snake_case fields', async () => {
  const missing = await runProtocol(['publish'], { publish: async () => commandSuccess({}) });
  assert.equal(missing.result.code, 'missing_flag');

  const calls = [];
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'metaprotocol-cli-'));
  const requestFile = path.join(tmp, 'request.json');
  await fs.writeFile(requestFile, JSON.stringify({
    title: 'New Proto',
    protocol_name: 'NewProto',
    protocol_content: '{ x: 1 }',
  }), 'utf8');
  try {
    const published = await runProtocol(
      ['publish', '--from', 'alice', '--request-file', requestFile],
      {
        publish: async (input) => {
          calls.push(input);
          return commandSuccess({ pinId: 'p1', formatted: 'receipt' });
        },
      },
    );
    assert.equal(published.exitCode, 0);
    assert.equal(calls[0].protocolName, 'NewProto');
    assert.equal(calls[0].protocolContent, '{ x: 1 }');
    assert.equal(calls[0].from, 'alice');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('protocol unknown subcommand and missing subcommand fail cleanly', async () => {
  const bogus = await runProtocol(['bogus'], {});
  assert.equal(bogus.result.code, 'unknown_command');
  const none = await runProtocol([], {});
  assert.equal(none.result.code, 'missing_subcommand');
});
