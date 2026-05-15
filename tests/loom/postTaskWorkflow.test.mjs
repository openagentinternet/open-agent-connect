import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  runLoomPostTaskWorkflow,
} = require('../../dist/core/loom/index.js');

function validTaskPayload(overrides = {}) {
  return {
    title: 'Build a Loom post task workflow',
    requirementContentType: 'text/markdown',
    requirement: 'Publish valid Loom task payloads through the runtime.',
    criteriaContentType: 'text/markdown',
    criteria: 'Payload file and wish flows are both covered by tests.',
    projectBase: 'github',
    project: {
      repoUri: 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    bounty: {
      amount: '0.001',
      currency: 'BTC',
    },
    tags: ['loom', 'runtime'],
    ...overrides,
  };
}

test('payload-file path publishes a valid task through injected writeChain', async () => {
  const payload = validTaskPayload();
  const writes = [];
  const reads = [];
  const result = await runLoomPostTaskWorkflow({
    from: 'alice',
    payloadFile: 'task.json',
    chain: 'mvc',
    dryRun: false,
    readPayloadFile: async (filePath) => {
      reads.push(filePath);
      return payload;
    },
    writeChain: async (request) => {
      writes.push(request);
      return {
        ok: true,
        state: 'success',
        data: {
          pinId: 'task-pin-id',
          txids: ['tx1'],
          network: 'mvc',
        },
      };
    },
  });

  assert.deepEqual(reads, ['task.json']);
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0], {
    operation: 'create',
    path: '/protocols/loom-task',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    from: 'alice',
    network: 'mvc',
  });
  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'task-pin-id');
  assert.deepEqual(result.data.txids, ['tx1']);
  assert.equal(result.data.network, 'mvc');
});

test('dryRun returns payload and request without writing', async () => {
  const payload = validTaskPayload();
  let wrote = false;
  const result = await runLoomPostTaskWorkflow({
    payload,
    dryRun: true,
    writeChain: async () => {
      wrote = true;
      throw new Error('should not write during dry run');
    },
  });

  assert.equal(wrote, false);
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.payload, payload);
  assert.deepEqual(result.data.request, {
    operation: 'create',
    path: '/protocols/loom-task',
    encryption: '0',
    version: '1.0.0',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
  });
  assert.equal(result.data.dryRun, true);
});

test('invalid task returns invalid_payload without writing', async () => {
  let wrote = false;
  const result = await runLoomPostTaskWorkflow({
    payload: validTaskPayload({ title: '' }),
    dryRun: false,
    writeChain: async () => {
      wrote = true;
      throw new Error('should not write invalid payloads');
    },
  });

  assert.equal(wrote, false);
  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'invalid_payload');
  assert.match(result.message, /title/);
});

test('wish path uses injected draftTask and then writes', async () => {
  const payload = validTaskPayload({ title: 'Drafted from a wish' });
  const drafts = [];
  const writes = [];
  const result = await runLoomPostTaskWorkflow({
    from: 'alice',
    wish: 'Create a task from this wish.',
    dryRun: false,
    draftTask: async (wish) => {
      drafts.push(wish);
      return {
        ok: true,
        state: 'success',
        data: {
          payload,
        },
      };
    },
    writeChain: async (request) => {
      writes.push(request);
      return {
        ok: true,
        state: 'success',
        data: {
          pinId: 'drafted-task-pin-id',
        },
      };
    },
  });

  assert.deepEqual(drafts, ['Create a task from this wish.']);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload, JSON.stringify(payload));
  assert.equal(writes[0].from, 'alice');
  assert.equal(result.ok, true);
  assert.equal(result.data.pinId, 'drafted-task-pin-id');
});
