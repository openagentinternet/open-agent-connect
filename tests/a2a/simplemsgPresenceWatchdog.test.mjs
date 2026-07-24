import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createA2ASimplemsgPresenceWatchdog,
} = require('../../dist/core/a2a/simplemsgPresenceWatchdog.js');

function createManager(report) {
  return {
    running: true,
    starts: 0,
    stops: 0,
    async start() {
      this.starts += 1;
      this.running = true;
      return report;
    },
    stop() {
      this.stops += 1;
      this.running = false;
    },
    isRunning() {
      return this.running;
    },
    getLastReport() {
      return report;
    },
  };
}

test('simplemsg presence watchdog restarts listener when a started local profile remains absent from socket presence', async () => {
  let nowMs = 0;
  const manager = createManager({
    started: [
      {
        slug: 'alpha',
        name: 'Alpha Bot',
        homeDir: '/tmp/alpha',
        globalMetaId: 'idq1alpha',
      },
      {
        slug: 'beta',
        name: 'Beta Bot',
        homeDir: '/tmp/beta',
        globalMetaId: 'idq1beta',
      },
    ],
    skipped: [],
  });
  const restartEvents = [];
  const watchdog = createA2ASimplemsgPresenceWatchdog({
    manager,
    gracePeriodMs: 50,
    restartCooldownMs: 0,
    now: () => nowMs,
    readOnlineMetaBots: async () => ({
      source: 'socket_presence',
      total: 1,
      onlineWindowSeconds: 1200,
      bots: [
        {
          globalMetaId: 'idq1alpha',
          lastSeenAt: nowMs,
          lastSeenAgoSeconds: 0,
          deviceCount: 1,
          online: true,
          name: 'Alpha Bot',
          goal: '',
        },
      ],
    }),
    onRestart: (event) => {
      restartEvents.push(event);
    },
  });

  const firstCheck = await watchdog.checkOnce();
  nowMs += 51;
  const secondCheck = await watchdog.checkOnce();

  assert.equal(firstCheck.status, 'missing_grace');
  assert.deepEqual(firstCheck.missing.map((profile) => profile.globalMetaId), ['idq1beta']);
  assert.equal(secondCheck.status, 'restarted');
  assert.deepEqual(secondCheck.missing.map((profile) => profile.globalMetaId), ['idq1beta']);
  assert.equal(manager.stops, 1);
  assert.equal(manager.starts, 1);
  assert.equal(restartEvents.length, 1);
  assert.deepEqual(restartEvents[0].missing.map((profile) => profile.globalMetaId), ['idq1beta']);
});

test('simplemsg presence watchdog treats a truncated presence page as healthy instead of restarting', async () => {
  let nowMs = 0;
  const manager = createManager({
    started: [
      {
        slug: 'alpha',
        name: 'Alpha Bot',
        homeDir: '/tmp/alpha',
        globalMetaId: 'idq1alpha',
      },
      {
        slug: 'beta',
        name: 'Beta Bot',
        homeDir: '/tmp/beta',
        globalMetaId: 'idq1beta',
      },
    ],
    skipped: [],
  });
  const restartEvents = [];
  const watchdog = createA2ASimplemsgPresenceWatchdog({
    manager,
    gracePeriodMs: 50,
    restartCooldownMs: 0,
    now: () => nowMs,
    readOnlineMetaBots: async () => ({
      source: 'socket_presence',
      total: 150,
      onlineWindowSeconds: 1200,
      bots: [
        {
          globalMetaId: 'idq1alpha',
          lastSeenAt: nowMs,
          lastSeenAgoSeconds: 0,
          deviceCount: 1,
          online: true,
          name: 'Alpha Bot',
          goal: '',
        },
      ],
    }),
    onRestart: (event) => {
      restartEvents.push(event);
    },
  });

  const firstCheck = await watchdog.checkOnce();
  nowMs += 51;
  const secondCheck = await watchdog.checkOnce();

  // idq1beta is absent from the page, but the server reports more online
  // identities than the capped page returned, so absence proves nothing.
  assert.equal(firstCheck.status, 'healthy');
  assert.deepEqual(firstCheck.missing, []);
  assert.equal(secondCheck.status, 'healthy');
  assert.deepEqual(secondCheck.missing, []);
  assert.equal(manager.stops, 0);
  assert.equal(manager.starts, 0);
  assert.equal(restartEvents.length, 0);
});
