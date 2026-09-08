import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createMetaAppStageHub } = require('../../dist/core/metaapp/stageEvents.js');

test('publish buffers events per op and delivers them to live subscribers', () => {
  const hub = createMetaAppStageHub({ now: () => 1_000 });
  const received = [];
  const unsubscribe = hub.subscribe('op-1', (event) => received.push(event));

  hub.publish('op-1', { stage: 'archive', bytes: 10, sha256: 'abc' });
  hub.publish('op-1', { stage: 'upload', artifactUri: 'metafile://pin.zip' });
  hub.publish('op-2', { stage: 'write' });

  assert.deepEqual(received.map((event) => event.stage), ['archive', 'upload']);
  assert.deepEqual(received[0], { op: 'op-1', stage: 'archive', at: 1_000, bytes: 10, sha256: 'abc' });
  unsubscribe();
  hub.publish('op-1', { stage: 'write' });
  assert.equal(received.length, 2, 'unsubscribed listeners stop receiving events');
});

test('publish with an empty op is a no-op', () => {
  const hub = createMetaAppStageHub();
  hub.publish('   ', { stage: 'archive' });
  const received = [];
  hub.subscribe('   ', (event) => received.push(event));
  assert.equal(received.length, 0);
});

test('a late subscriber replays the buffered sequence before live events', () => {
  const hub = createMetaAppStageHub({ now: () => 1_000 });
  hub.publish('op-1', { stage: 'archive', bytes: 10 });
  hub.publish('op-1', { stage: 'upload' });

  const received = [];
  hub.subscribe('op-1', (event) => received.push(event));
  assert.deepEqual(received.map((event) => event.stage), ['archive', 'upload']);

  hub.publish('op-1', { stage: 'write' });
  assert.deepEqual(received.map((event) => event.stage), ['archive', 'upload', 'write']);
});

test('the buffer keeps only the most recent events per op', () => {
  const hub = createMetaAppStageHub({ bufferSize: 3 });
  for (let index = 0; index < 5; index += 1) {
    hub.publish('op-1', { stage: `stage-${index}` });
  }
  const received = [];
  hub.subscribe('op-1', (event) => received.push(event));
  assert.deepEqual(received.map((event) => event.stage), ['stage-2', 'stage-3', 'stage-4']);
});

test('a terminal stage seals the op: listeners evicted, buffer replayable', () => {
  const hub = createMetaAppStageHub({ now: () => 1_000 });
  const first = [];
  hub.subscribe('op-1', (event) => first.push(event));
  hub.publish('op-1', { stage: 'write', pinId: 'pin' });
  hub.publish('op-1', { stage: 'done', pinId: 'pin' });
  assert.deepEqual(first.map((event) => event.stage), ['write', 'done']);

  // The done event sealed the op: further publishes on the same op id are
  // ignored instead of reopening the stream.
  hub.publish('op-1', { stage: 'write' });
  assert.equal(first.length, 2);

  // A subscriber connecting after the terminal event replays the buffer but
  // is not registered for live events.
  const late = [];
  const unsubscribe = hub.subscribe('op-1', (event) => late.push(event));
  assert.deepEqual(late.map((event) => event.stage), ['write', 'done']);
  hub.publish('op-1', { stage: 'upload' });
  assert.equal(late.length, 2, 'post-terminal subscribers only get the replay');
  unsubscribe();
});

test('ops are evicted after the TTL and beyond the op cap (oldest first)', () => {
  let at = 1_000;
  const hub = createMetaAppStageHub({ now: () => at, ttlMs: 60_000, maxOps: 2 });

  hub.publish('op-1', { stage: 'archive' });
  at += 1;
  hub.publish('op-2', { stage: 'archive' });
  at += 1;
  // Third op exceeds maxOps=2: the least recently touched op (op-1) is evicted.
  hub.publish('op-3', { stage: 'archive' });
  const replayed = [];
  hub.subscribe('op-1', (event) => replayed.push(event));
  assert.equal(replayed.length, 0, 'op-1 was evicted by the op cap');
  const surviving = [];
  hub.subscribe('op-2', (event) => surviving.push(event));
  assert.equal(surviving.length, 1, 'op-2 survives the cap');

  // Past the TTL the next publish prunes the expired op.
  at += 61_000;
  hub.publish('op-4', { stage: 'archive' });
  const expired = [];
  hub.subscribe('op-2', (event) => expired.push(event));
  assert.equal(expired.length, 0, 'op-2 expired past the TTL');
});
