import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLoomDashboardStore,
  resolveLoomDashboardIndexPath,
} = require('../../dist/core/loom/index.js');

const taskPinId = `${'a'.repeat(64)}i0`;

function normalizePathForAssert(filePath) {
  return filePath.split(path.sep).join('/');
}

async function profileHome(prefix = 'loom-dashboard-store-') {
  return path.join(await mkdtemp(path.join(os.tmpdir(), prefix)), '.metabot', 'profiles', 'eric');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function writeDashboardIndex(home, state) {
  const indexPath = resolveLoomDashboardIndexPath(home);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify(state)}\n`, 'utf8');
}

function botIdentity(role, seed) {
  return {
    role,
    displayName: `${role} ${seed}`,
    fallbackLabel: `${role}-${seed}`,
    initials: seed.slice(0, 2).toUpperCase(),
    globalMetaId: `${role}-global-${seed}`,
    address: `${role}-address-${seed}`,
  };
}

function taskRecord() {
  return {
    pinId: taskPinId,
    protocol: 'task',
    path: '/protocols/loom-task',
    operation: 'create',
    contentType: 'application/json',
    timestamp: 1750000000000,
    creatorAddress: 'requester-address',
    globalMetaId: 'requester-global',
    payload: { title: 'Add dashboard store' },
    payloadValid: true,
    validationErrors: [],
    raw: { id: taskPinId, content: '{"title":"Add dashboard store"}' },
  };
}

function dashboardState(overrides = {}) {
  const requester = botIdentity('requester', 'rq');
  const card = {
    taskPinId,
    state: 'open',
    stateTone: 'neutral',
    columnId: 'open',
    title: 'Add dashboard store',
    requester,
    tags: ['loom'],
    createdAt: 1750000000000,
    updatedAt: 1750000001000,
    activeClaimCount: 0,
    warningCount: 0,
    actorContext: {
      isRequester: true,
      isDeveloper: false,
      needsMyAction: false,
      role: 'requester',
    },
  };
  const detail = {
    taskPinId,
    state: 'open',
    columnId: 'open',
    title: 'Add dashboard store',
    requester,
    claims: [],
    warnings: [],
    timeline: [{
      id: `task:${taskPinId}`,
      kind: 'task',
      taskPinId,
      timestamp: 1750000000000,
      title: 'task',
      pinId: taskPinId,
      protocol: 'task',
    }],
    localWorkflow: [],
    task: taskRecord(),
    validRecords: {
      claims: [],
      statuses: [],
      deliveries: [],
      acceptances: [],
      claimRejects: [],
    },
  };

  return {
    version: 1,
    updatedAt: 1750000002000,
    rawCacheUpdatedAt: 1750000001000,
    actor: {
      profileSlug: 'eric',
      globalMetaId: 'requester-global',
      address: 'requester-address',
    },
    summary: {
      totalTasks: 1,
      open: 1,
      claimed: 0,
      inProgress: 0,
      delivered: 0,
      revisionNeeded: 0,
      rejected: 0,
      acceptedPaid: 0,
      failed: 0,
      invalidRecords: 0,
      needsMyAction: 0,
      newestActivityAt: 1750000001000,
    },
    filters: {},
    columns: [{
      id: 'open',
      title: 'Open',
      states: ['open'],
      cards: [card],
    }],
    tasks: [card],
    details: [detail],
    warnings: [],
    refresh: {
      requested: false,
      succeeded: true,
      updatedAt: 1750000001000,
      warning: null,
    },
    ...overrides,
  };
}

function dashboardCardEntries(state) {
  return [
    state.tasks[0],
    state.columns[0].cards[0],
  ];
}

test('resolves dashboard index path under profile runtime root', async () => {
  const home = await profileHome('loom-dashboard-store-path-');
  const indexPath = resolveLoomDashboardIndexPath(home);
  assert.match(normalizePathForAssert(indexPath), /\.metabot\/profiles\/eric\/\.runtime\/loom\/dashboard\/index\.json$/);

  const store = createLoomDashboardStore(home);
  assert.equal(store.indexPath, indexPath);
});

test('returns null when dashboard index is missing', async () => {
  const store = createLoomDashboardStore(await profileHome('loom-dashboard-store-missing-'));
  assert.equal(await store.read(), null);
});

test('returns null for malformed or invalid dashboard index', async () => {
  const home = await profileHome('loom-dashboard-store-malformed-');
  const indexPath = resolveLoomDashboardIndexPath(home);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, '{"version":1,\n', 'utf8');
  assert.equal(await createLoomDashboardStore(home).read(), null);

  await writeFile(indexPath, `${JSON.stringify({ version: 2, tasks: [] })}\n`, 'utf8');
  assert.equal(await createLoomDashboardStore(home).read(), null);
});

test('returns null when persisted summary fields are invalid', async () => {
  const home = await profileHome('loom-dashboard-store-invalid-summary-');
  const invalid = clone(dashboardState());
  invalid.summary.totalTasks = 'bad';
  await writeDashboardIndex(home, invalid);
  assert.equal(await createLoomDashboardStore(home).read(), null);

  const invalidOptional = clone(dashboardState());
  invalidOptional.summary.newestActivityAt = 'bad';
  await writeDashboardIndex(home, invalidOptional);
  assert.equal(await createLoomDashboardStore(home).read(), null);
});

test('returns null when persisted refresh or filter fields are invalid', async () => {
  const home = await profileHome('loom-dashboard-store-invalid-refresh-');
  const invalidRefresh = clone(dashboardState());
  invalidRefresh.refresh.requested = 'yes';
  await writeDashboardIndex(home, invalidRefresh);
  assert.equal(await createLoomDashboardStore(home).read(), null);

  const invalidFilter = clone(dashboardState());
  invalidFilter.filters.limit = '10';
  await writeDashboardIndex(home, invalidFilter);
  assert.equal(await createLoomDashboardStore(home).read(), null);
});

test('returns null when persisted dashboard arrays contain invalid entries', async () => {
  const cases = [
    { tasks: [null] },
    { details: [null] },
    { warnings: [null] },
    { columns: [null] },
  ];

  for (const invalidArrays of cases) {
    const home = await profileHome('loom-dashboard-store-invalid-array-entry-');
    await writeDashboardIndex(home, dashboardState(invalidArrays));
    assert.equal(await createLoomDashboardStore(home).read(), null);
  }
});

test('returns null when persisted task card required fields are invalid', async () => {
  const requiredFieldCases = [
    { field: 'stateTone', value: 123 },
    { field: 'actorContext', value: null },
  ];

  for (const { field, value } of requiredFieldCases) {
    const home = await profileHome('loom-dashboard-store-invalid-card-required-');
    const invalid = clone(dashboardState());
    for (const card of dashboardCardEntries(invalid)) {
      card[field] = value;
    }
    await writeDashboardIndex(home, invalid);
    assert.equal(await createLoomDashboardStore(home).read(), null);
  }
});

test('returns null when persisted task card optional nested fields are invalid', async () => {
  const optionalFieldCases = [
    { field: 'developer', value: { displayName: 'Incomplete Developer' } },
    { field: 'bounty', value: { amount: 10, currency: 'SPACE' } },
    { field: 'repo', value: { repoUri: 123, baseBranch: 'main' } },
    { field: 'local', value: { claimPinId: 'claim-only' } },
  ];

  for (const { field, value } of optionalFieldCases) {
    const home = await profileHome('loom-dashboard-store-invalid-card-optional-');
    const invalid = clone(dashboardState());
    for (const card of dashboardCardEntries(invalid)) {
      card[field] = value;
    }
    await writeDashboardIndex(home, invalid);
    assert.equal(await createLoomDashboardStore(home).read(), null);
  }
});

test('writes and reads a dashboard index roundtrip', async () => {
  const store = createLoomDashboardStore(await profileHome('loom-dashboard-store-roundtrip-'));
  const written = await store.write(dashboardState());
  const read = await store.read();

  assert.equal(written.version, 1);
  assert.deepEqual(read, written);
  assert.equal(read.tasks[0].taskPinId, taskPinId);
});

test('write normalizes version updatedAt and missing optional arrays', async () => {
  const store = createLoomDashboardStore(await profileHome('loom-dashboard-store-normalize-'));
  const state = dashboardState({
    version: 99,
    updatedAt: undefined,
    tasks: undefined,
    details: undefined,
    warnings: undefined,
    columns: undefined,
  });

  const before = Date.now();
  const written = await store.write(state);
  const after = Date.now();

  assert.equal(written.version, 1);
  assert.equal(Array.isArray(written.tasks), true);
  assert.equal(Array.isArray(written.details), true);
  assert.equal(Array.isArray(written.warnings), true);
  assert.equal(Array.isArray(written.columns), true);
  assert.deepEqual(written.tasks, []);
  assert.deepEqual(written.details, []);
  assert.deepEqual(written.warnings, []);
  assert.deepEqual(written.columns, []);
  assert.ok(written.updatedAt >= before && written.updatedAt <= after);
  assert.deepEqual(await store.read(), written);
});

test('atomic write creates parent dirs and leaves valid JSON without temp files', async () => {
  const store = createLoomDashboardStore(await profileHome('loom-dashboard-store-atomic-'));
  await store.write(dashboardState({ updatedAt: 1750000003000 }));
  await store.write(dashboardState({ updatedAt: 1750000004000 }));

  const raw = await readFile(store.indexPath, 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.updatedAt, 1750000004000);

  const entries = await readdir(path.dirname(store.indexPath));
  assert.equal(entries.filter((entry) => entry.endsWith('.tmp')).length, 0);
});
