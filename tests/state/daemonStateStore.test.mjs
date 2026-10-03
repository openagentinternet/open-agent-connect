import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { mkdtempTempRoot } from '../helpers/tempRoots.mjs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDaemonStateStore } = require('../../dist/core/state/daemonStateStore.js');

async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function globalDaemonRecord(overrides = {}) {
  return {
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: 'metabot-daemon-test',
    pid: 12345,
    host: '127.0.0.1',
    port: 32123,
    baseUrl: 'http://127.0.0.1:32123',
    oacVersion: '0.0.0-test',
    runtimeFingerprint: 'test-runtime',
    supervisor: { kind: 'none', serviceId: null },
    startedAt: Date.now(),
    ...overrides,
  };
}

test('createDaemonStateStore persists one installation endpoint and global daemon process record', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-global-daemon-');
  const store = createDaemonStateStore(systemHomeDir);

  await store.writeInstallation({
    schemaVersion: 1,
    host: '127.0.0.1',
    port: 10002,
    selectionOrigin: 'fallback',
    updatedAt: 1_744_444_444_000,
  });
  await store.writeDaemon({
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: 'metabot-daemon-1',
    pid: 12345,
    host: '127.0.0.1',
    port: 10002,
    baseUrl: 'http://127.0.0.1:10002',
    oacVersion: '0.2.32',
    runtimeFingerprint: 'runtime-fingerprint',
    supervisor: {
      kind: 'none',
      serviceId: null,
    },
    startedAt: 1_744_444_444_000,
  });

  assert.deepEqual(await store.readInstallation(), {
    schemaVersion: 1,
    host: '127.0.0.1',
    port: 10002,
    selectionOrigin: 'fallback',
    updatedAt: 1_744_444_444_000,
  });
  assert.equal((await store.readDaemon())?.baseUrl, 'http://127.0.0.1:10002');
  assert.match(await readFile(store.paths.daemonStatePath, 'utf8'), /runtime-fingerprint/);
  assert.equal(store.paths.daemonStatePath.includes('/profiles/'), false);

  await store.clearDaemon(12345);
  assert.equal(await store.readDaemon(), null);
});

test('daemon state store journals lifecycle events and reads back the tail', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-daemon-events-');
  const store = createDaemonStateStore(systemHomeDir);

  await store.appendDaemonEvent({ at: 1, event: 'start', pid: 100, trigger: 'cli:daemon-start', detail: null });
  await store.appendDaemonEvent({ at: 2, event: 'stop', pid: 100, trigger: 'signal:SIGTERM', detail: null });
  await store.appendDaemonEvent({ at: 3, event: 'crash', pid: 100, trigger: 'cli:startup-scan', detail: 'record survived' });
  await store.appendDaemonEvent({ at: 4, event: 'respawn', pid: 200, trigger: 'cli:daemon-start', detail: 'replaced crashed daemon pid 100' });

  assert.deepEqual(await store.readDaemonEvents(10), [
    { at: 1, event: 'start', pid: 100, trigger: 'cli:daemon-start', detail: null },
    { at: 2, event: 'stop', pid: 100, trigger: 'signal:SIGTERM', detail: null },
    { at: 3, event: 'crash', pid: 100, trigger: 'cli:startup-scan', detail: 'record survived' },
    { at: 4, event: 'respawn', pid: 200, trigger: 'cli:daemon-start', detail: 'replaced crashed daemon pid 100' },
  ]);
  assert.equal((await store.readDaemonEvents(2)).map((event) => event.event).join(','), 'crash,respawn');
  assert.deepEqual(await store.readDaemonEvents(0), []);
  assert.equal(store.paths.daemonEventsPath.endsWith('daemon-events.jsonl'), true);
});

test('daemon state store compacts an oversized event journal but keeps recent events', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-daemon-events-compact-');
  const store = createDaemonStateStore(systemHomeDir);

  // >1MB of valid journal lines triggers the size-based compaction on append.
  await store.ensureLayout();
  const filler = { at: 0, event: 'start', pid: 1, trigger: 'filler', detail: 'x'.repeat(80) };
  const fillerLines = Array.from({ length: 14_000 }, () => JSON.stringify(filler)).join('\n');
  await writeFile(store.paths.daemonEventsPath, `${fillerLines}\n`, 'utf8');

  await store.appendDaemonEvent({ at: 9, event: 'crash', pid: 42, trigger: 'test', detail: null });

  const afterStat = await stat(store.paths.daemonEventsPath);
  assert.equal(afterStat.size < 1_000_000, true, 'journal should be compacted below the size cap');
  const events = await store.readDaemonEvents(10_000);
  assert.equal(events.length <= 201, true);
  assert.equal(events.at(-1)?.event, 'crash');
});

test('clearDaemon without a tracked record skips the unlink entirely', async () => {
  const systemHomeDir = await mkdtempTempRoot('metabot-daemon-clear-');
  const store = createDaemonStateStore(systemHomeDir);

  // No record was ever written: the clear must be a no-op, not an unlink of a
  // missing file (sandboxed hosts deny even that with raw EPERM).
  await store.clearDaemon();
  assert.equal(await store.readDaemon(), null);
  assert.equal(await exists(store.paths.daemonStatePath), false);

  await store.writeDaemon(globalDaemonRecord());
  await store.clearDaemon(999_999); // pid mismatch preserves the record
  assert.equal(await exists(store.paths.daemonStatePath), true);
  await store.clearDaemon(12345); // matching pid removes it
  assert.equal(await store.readDaemon(), null);
});
