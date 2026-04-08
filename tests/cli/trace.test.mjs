import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

test('runCli dispatches `metabot trace watch --trace-id` and writes NDJSON public status events without a trailing JSON envelope', async () => {
  const stdout = [];
  const stderr = [];
  const calls = [];

  const exitCode = await runCli(['trace', 'watch', '--trace-id', 'trace-123'], {
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: (chunk) => { stderr.push(String(chunk)); return true; } },
    dependencies: {
      trace: {
        watch: async (input) => {
          calls.push(input);
          return [
            JSON.stringify({
              traceId: input.traceId,
              status: 'requesting_remote',
              terminal: false,
            }),
            JSON.stringify({
              traceId: input.traceId,
              status: 'completed',
              terminal: true,
            }),
            '',
          ].join('\n');
        },
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, [{ traceId: 'trace-123' }]);

  const output = stdout.join('');
  const lines = output.trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines, [
    {
      traceId: 'trace-123',
      status: 'requesting_remote',
      terminal: false,
    },
    {
      traceId: 'trace-123',
      status: 'completed',
      terminal: true,
    },
  ]);
  assert.equal(output.includes('"ok"'), false);
  assert.equal(stderr.join(''), '');
});
