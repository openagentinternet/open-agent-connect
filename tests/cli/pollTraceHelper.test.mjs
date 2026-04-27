import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { pollTraceUntilComplete } = require('../../dist/cli/commands/pollTraceHelper.js');

function createMockStderr() {
  const lines = [];
  return {
    write(text) { lines.push(text); return true; },
    lines,
  };
}

test('returns completed when trace shows completed on first poll', async () => {
  const stderr = createMockStderr();
  const result = await pollTraceUntilComplete({
    traceId: 'trace-1',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-1',
    requestFn: async (_method, _path) => ({
      ok: true,
      state: 'success',
      data: {
        traceId: 'trace-1',
        sessions: [{ publicStatus: 'completed', responseText: 'done' }],
      },
    }),
    stderr,
    timeoutMs: 5000,
    intervalMs: 100,
  });
  assert.equal(result.completed, true);
  assert.ok(result.trace);
});

test('returns not completed after timeout', async () => {
  const stderr = createMockStderr();
  const result = await pollTraceUntilComplete({
    traceId: 'trace-2',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-2',
    requestFn: async (_method, _path) => ({
      ok: true,
      state: 'success',
      data: {
        traceId: 'trace-2',
        sessions: [{ publicStatus: 'requesting_remote' }],
      },
    }),
    stderr,
    timeoutMs: 300,
    intervalMs: 100,
  });
  assert.equal(result.completed, false);
});

test('prints initial status and trace URL to stderr', async () => {
  const stderr = createMockStderr();
  await pollTraceUntilComplete({
    traceId: 'trace-3',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-3',
    requestFn: async () => ({
      ok: true,
      state: 'success',
      data: { traceId: 'trace-3', sessions: [{ publicStatus: 'completed' }] },
    }),
    stderr,
    timeoutMs: 5000,
    intervalMs: 100,
  });
  const output = stderr.lines.join('');
  assert.ok(output.includes('Waiting for response'), 'should print waiting message');
  assert.ok(output.includes('http://localhost:5555/ui/trace'), 'should print trace URL');
});

test('handles request errors gracefully', async () => {
  const stderr = createMockStderr();
  let callCount = 0;
  const result = await pollTraceUntilComplete({
    traceId: 'trace-err',
    localUiUrl: 'http://localhost:5555/ui/trace?traceId=trace-err',
    requestFn: async () => {
      callCount++;
      if (callCount <= 2) throw new Error('connection refused');
      return {
        ok: true,
        state: 'success',
        data: { traceId: 'trace-err', sessions: [{ publicStatus: 'completed' }] },
      };
    },
    stderr,
    timeoutMs: 5000,
    intervalMs: 100,
  });
  assert.equal(result.completed, true);
  assert.ok(callCount >= 3, 'should retry after errors');
});
