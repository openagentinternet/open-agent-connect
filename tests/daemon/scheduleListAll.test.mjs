import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { cleanupProfileHome, createProfileHome, deriveSystemHome } from '../helpers/profileHome.mjs';

const require = createRequire(import.meta.url);
const { createScheduleDaemonHandlers } = require('../../dist/daemon/scheduleHandlers.js');
const { createMetabotProfileFromIdentity } = require('../../dist/core/bot/metabotProfileManager.js');
const { createScheduleStore } = require('../../dist/core/schedule/store.js');
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

test('schedule list with all:true groups every local profile that has tasks', async (t) => {
  const aliceHome = await createProfileHome('oac-schedule-list-all-', 'alice');
  t.after(async () => cleanupProfileHome(aliceHome));
  const systemHomeDir = deriveSystemHome(aliceHome);

  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Alice',
    homeDir: aliceHome,
    globalMetaId: 'idq1schedulealice',
    mvcAddress: '18ScheduleAlice',
  });
  const bobHome = path.join(systemHomeDir, '.metabot', 'profiles', 'bob');
  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Bob',
    homeDir: bobHome,
    globalMetaId: 'idq1schedulebob',
    mvcAddress: '18ScheduleBob',
  });
  // Carol has no tasks: the grouped list must skip empty profiles.
  const carolHome = path.join(systemHomeDir, '.metabot', 'profiles', 'carol');
  await createMetabotProfileFromIdentity(systemHomeDir, {
    name: 'Carol',
    homeDir: carolHome,
    globalMetaId: 'idq1schedulecarol',
    mvcAddress: '18ScheduleCarol',
  });

  await createScheduleStore(resolveMetabotPaths(aliceHome)).createTask({
    name: 'alice interval task',
    prompt: 'do a',
    schedule: { type: 'interval', intervalMs: 60_000 },
  });
  await createScheduleStore(resolveMetabotPaths(bobHome)).createTask({
    name: 'bob cron task',
    prompt: 'do b',
    schedule: { type: 'cron', expression: '0 9 * * *' },
  });

  const handlers = createScheduleDaemonHandlers({ systemHomeDir });
  const all = await handlers.list({ all: true });
  assert.equal(all.ok, true);
  const bySlug = new Map(all.data.groups.map((group) => [group.slug, group.tasks]));
  assert.deepEqual([...bySlug.keys()].sort(), ['alice', 'bob']);
  assert.equal(bySlug.get('alice')[0].name, 'alice interval task');
  assert.equal(bySlug.get('bob')[0].name, 'bob cron task');

  // The single-Bot path is unchanged.
  const single = await handlers.list({ from: 'alice' });
  assert.equal(single.ok, true);
  assert.equal(single.data.tasks.length, 1);
  assert.equal(single.data.tasks[0].name, 'alice interval task');
});
