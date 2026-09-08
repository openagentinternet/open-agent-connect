import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createMetaAppWriteGuard,
  stableMetaAppWriteHash,
} = require('../../dist/core/metaapp/writeGuard.js');
const { commandFailed, commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function key(parts) {
  return stableMetaAppWriteHash('metaapp-test', parts);
}

test('an identical write inside the window replays with idempotent:true and runs once', async () => {
  const guard = createMetaAppWriteGuard();
  let runs = 0;
  const fn = async () => {
    runs += 1;
    return commandSuccess({ pinId: 'pin-1' });
  };
  const first = await guard.run({ idemKey: key(['a']), fn });
  const second = await guard.run({ idemKey: key(['a']), fn });

  assert.equal(runs, 1);
  assert.equal(first.data.idempotent, undefined);
  assert.equal(second.data.idempotent, true);
  assert.equal(second.data.pinId, 'pin-1');
});

test('distinct keys each hit the chain', async () => {
  const guard = createMetaAppWriteGuard();
  let runs = 0;
  const fn = async () => {
    runs += 1;
    return commandSuccess({ pinId: `pin-${runs}` });
  };
  const first = await guard.run({ idemKey: key(['a']), fn });
  const second = await guard.run({ idemKey: key(['b']), fn });

  assert.equal(runs, 2);
  assert.equal(first.data.pinId, 'pin-1');
  assert.equal(second.data.pinId, 'pin-2');
  assert.equal(second.data.idempotent, undefined);
});

test('failed results are never cached, so retries reach the chain', async () => {
  const guard = createMetaAppWriteGuard();
  let runs = 0;
  const fn = async () => {
    runs += 1;
    return runs === 1
      ? commandFailed('metaapp_publish_failed', 'boom')
      : commandSuccess({ pinId: 'pin-retry' });
  };
  const failed = await guard.run({ idemKey: key(['a']), fn });
  const retried = await guard.run({ idemKey: key(['a']), fn });

  assert.equal(failed.ok, false);
  assert.equal(retried.ok, true);
  assert.equal(retried.data.idempotent, undefined);
  assert.equal(runs, 2);
});

test('a throwing fn is not cached and the error propagates', async () => {
  const guard = createMetaAppWriteGuard();
  let runs = 0;
  const fn = async () => {
    runs += 1;
    if (runs === 1) throw new Error('write exploded');
    return commandSuccess({ pinId: 'pin-after-throw' });
  };
  await assert.rejects(() => guard.run({ idemKey: key(['a']), fn }), /write exploded/);
  const result = await guard.run({ idemKey: key(['a']), fn });
  assert.equal(result.ok, true);
  assert.equal(runs, 2);
});

test('the window expires: the same write runs again afterwards', async () => {
  let now = 1_000_000;
  const guard = createMetaAppWriteGuard({ now: () => now, windowMs: 60_000 });
  let runs = 0;
  const fn = async () => {
    runs += 1;
    return commandSuccess({ pinId: `pin-${runs}` });
  };
  await guard.run({ idemKey: key(['a']), fn });
  now += 59_999;
  const within = await guard.run({ idemKey: key(['a']), fn });
  assert.equal(within.data.idempotent, true);
  now += 2;
  const after = await guard.run({ idemKey: key(['a']), fn });
  assert.equal(after.data.idempotent, undefined);
  assert.equal(runs, 2);
});

test('writes on the same app lock serialize even with different content', async () => {
  const guard = createMetaAppWriteGuard();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const order = [];
  const makeFn = (label) => async () => {
    order.push(`start:${label}`);
    if (label === 'one') await gate;
    order.push(`end:${label}`);
    return commandSuccess({ pinId: `pin-${label}` });
  };
  const first = guard.run({ idemKey: key(['one']), lockKey: 'metaapp:target', fn: makeFn('one') });
  const second = guard.run({ idemKey: key(['two']), lockKey: 'metaapp:target', fn: makeFn('two') });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start:one', 'end:one', 'start:two', 'end:two']);
});

test('a concurrent identical retry waits on the lock and replays instead of re-writing', async () => {
  const guard = createMetaAppWriteGuard();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let runs = 0;
  const fn = async () => {
    runs += 1;
    await gate;
    return commandSuccess({ pinId: 'pin-shared' });
  };
  const first = guard.run({ idemKey: key(['same']), lockKey: 'metaapp:target', fn });
  const second = guard.run({ idemKey: key(['same']), lockKey: 'metaapp:target', fn });
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(runs, 1);
  assert.equal(firstResult.data.idempotent, undefined);
  assert.equal(secondResult.data.idempotent, true);
});
