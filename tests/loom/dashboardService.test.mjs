import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createLoomDashboardService,
  buildLoomDashboard,
} = require('../../dist/core/loom/index.js');

const requesterGlobalMetaId = 'requester-global';
const developerGlobalMetaId = 'developer-global';

function pin(seed) {
  return `${seed.repeat(64).slice(0, 64)}i0`;
}

function emptyRecords() {
  return {
    task: [],
    claim: [],
    status: [],
    delivery: [],
    acceptance: [],
    'claim-reject': [],
  };
}

function record(protocol, pinId, payload, options = {}) {
  return {
    pinId,
    protocol,
    path: `/protocols/loom-${protocol}`,
    operation: 'create',
    contentType: 'application/json',
    timestamp: options.timestamp ?? 1750000000000,
    creatorAddress: options.creatorAddress ?? `${protocol}-creator-address`,
    creatorMetaId: options.creatorMetaId ?? `${protocol}-creator-metaid`,
    globalMetaId: options.globalMetaId ?? requesterGlobalMetaId,
    payload,
    payloadValid: true,
    validationErrors: [],
    raw: { id: pinId, content: JSON.stringify(payload) },
  };
}

function taskRecord(seed, options = {}) {
  return record('task', pin(seed), {
    title: options.title ?? `Task ${seed}`,
    requirement: `Requirement ${seed}`,
    criteria: `Criteria ${seed}`,
    project: {
      repoUri: options.repoUri ?? 'https://github.com/openagentinternet/open-agent-connect',
      baseBranch: 'main',
    },
    tags: options.tags ?? ['loom', seed],
  }, {
    timestamp: options.timestamp ?? 1750000000000,
    creatorAddress: options.creatorAddress ?? 'requester-address',
    globalMetaId: options.globalMetaId ?? requesterGlobalMetaId,
  });
}

function claimRecord(taskPinId, claimPinId, options = {}) {
  return record('claim', claimPinId, {
    taskPinId,
    payoutAddress: 'developer-payout-address',
    message: options.message ?? 'I can build this.',
  }, {
    timestamp: options.timestamp ?? 1750000001000,
    creatorAddress: options.creatorAddress ?? 'developer-address',
    globalMetaId: options.globalMetaId ?? developerGlobalMetaId,
  });
}

function statusRecord(taskPinId, claimPinId, status, options = {}) {
  return record('status', options.pinId ?? pin('s'), {
    taskPinId,
    claimPinId,
    status,
    progressSummary: options.progressSummary ?? `Status is ${status}.`,
    branchName: 'codex/metabot-loom-cli',
    commits: [],
    processLogs: [],
  }, {
    timestamp: options.timestamp ?? 1750000002000,
    creatorAddress: 'developer-address',
    globalMetaId: developerGlobalMetaId,
  });
}

function cache(records, updatedAt = 1750000010000) {
  return {
    version: 1,
    updatedAt,
    records,
  };
}

function cacheWithOpenTask(seed = 'a', options = {}) {
  const records = emptyRecords();
  records.task.push(taskRecord(seed, options));
  return cache(records, options.updatedAt ?? 1750000010000);
}

function cacheWithWorkingTask(seed = 'b') {
  const records = emptyRecords();
  const task = taskRecord(seed, { title: 'Build filtered dashboard' });
  const claimPinId = pin(`${seed}c`);
  records.task.push(task);
  records.claim.push(claimRecord(task.pinId, claimPinId));
  records.status.push(statusRecord(task.pinId, claimPinId, 'in_progress'));
  return cache(records, 1750000020000);
}

function createMemoryDashboardStore(initial = null) {
  let state = initial;
  const writes = [];
  return {
    indexPath: '/tmp/loom-dashboard/index.json',
    writes,
    async read() {
      return state;
    },
    async write(next) {
      state = next;
      writes.push(next);
      return next;
    },
  };
}

function createService(overrides = {}) {
  const rawState = overrides.rawState ?? cacheWithOpenTask('a');
  const dashboardStore = overrides.dashboardStore ?? createMemoryDashboardStore();
  return {
    dashboardStore,
    service: createLoomDashboardService({
      rawCacheStore: {
        async read() {
          return rawState;
        },
      },
      dashboardStore,
      now: () => 1750000090000,
      ...overrides.dependencies,
    }),
  };
}

test('getDashboard reads raw cache without refresh and applies aggregation filters', async () => {
  const rawState = cacheWithWorkingTask('b');
  let refreshCalls = 0;
  const { service, dashboardStore } = createService({
    rawState,
    dependencies: {
      async refreshRawCache() {
        refreshCalls += 1;
        return rawState;
      },
      async resolveActorContext() {
        return { globalMetaId: developerGlobalMetaId, address: 'developer-address' };
      },
    },
  });

  const result = await service.getDashboard({
    from: 'developer',
    state: 'working',
    role: 'developer',
    query: 'filtered',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.data.dashboard.summary.totalTasks, 1);
  assert.equal(result.data.dashboard.tasks[0].state, 'in_progress');
  assert.deepEqual(result.data.dashboard.filters, {
    state: 'working',
    role: 'developer',
    query: 'filtered',
    limit: 1,
  });
  assert.equal(result.data.cache.refreshed, false);
  assert.equal(refreshCalls, 0);
  assert.equal(dashboardStore.writes.length, 0);
});

test('refresh calls raw refresh, writes derived dashboard index, and returns refresh metadata', async () => {
  const refreshed = cacheWithOpenTask('r', { updatedAt: 1750000030000 });
  const dashboardStore = createMemoryDashboardStore();
  const { service } = createService({
    rawState: cache(emptyRecords()),
    dashboardStore,
    dependencies: {
      async refreshRawCache(input) {
        assert.deepEqual(input, { limit: 7 });
        return refreshed;
      },
    },
  });

  const result = await service.refresh({ limit: 7 });

  assert.equal(result.ok, true);
  assert.equal(result.data.dashboard.refresh.requested, true);
  assert.equal(result.data.dashboard.refresh.succeeded, true);
  assert.equal(result.data.dashboard.rawCacheUpdatedAt, refreshed.updatedAt);
  assert.equal(result.data.cache.refreshed, true);
  assert.equal(result.data.indexPath, dashboardStore.indexPath);
  assert.equal(dashboardStore.writes.length, 1);
  assert.equal(dashboardStore.writes[0].rawCacheUpdatedAt, refreshed.updatedAt);
  assert.deepEqual(dashboardStore.writes[0].filters, {});
});

test('filtered refresh writes a full reusable dashboard index while returning the filtered view', async () => {
  const records = emptyRecords();
  const openTask = taskRecord('o', { title: 'Open reusable index task' });
  const workingTask = taskRecord('w', { title: 'Developer filtered task' });
  const workingClaimPinId = pin('wc');
  records.task.push(openTask, workingTask);
  records.claim.push(claimRecord(workingTask.pinId, workingClaimPinId));
  records.status.push(statusRecord(workingTask.pinId, workingClaimPinId, 'in_progress'));
  const refreshed = cache(records, 1750000035000);
  const dashboardStore = createMemoryDashboardStore();
  const { service } = createService({
    rawState: cache(emptyRecords()),
    dashboardStore,
    dependencies: {
      async refreshRawCache(input) {
        assert.deepEqual(input, { limit: 1 });
        return refreshed;
      },
      async resolveActorContext() {
        return { globalMetaId: developerGlobalMetaId, address: 'developer-address' };
      },
    },
  });

  const result = await service.getDashboard({
    refresh: true,
    state: 'working',
    role: 'developer',
    query: 'filtered',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.dashboard.tasks.map((task) => task.taskPinId), [workingTask.pinId]);
  assert.deepEqual(result.data.dashboard.filters, {
    state: 'working',
    role: 'developer',
    query: 'filtered',
    limit: 1,
  });
  assert.equal(dashboardStore.writes.length, 1);
  assert.equal(dashboardStore.writes[0].summary.totalTasks, 2);
  assert.deepEqual(dashboardStore.writes[0].tasks.map((task) => task.taskPinId).sort(), [
    openTask.pinId,
    workingTask.pinId,
  ].sort());
  assert.deepEqual(dashboardStore.writes[0].details.map((detail) => detail.taskPinId).sort(), [
    openTask.pinId,
    workingTask.pinId,
  ].sort());
  assert.deepEqual(dashboardStore.writes[0].filters, {});
  assert.deepEqual(dashboardStore.writes[0].actor, {
    globalMetaId: developerGlobalMetaId,
    address: 'developer-address',
  });
  assert.deepEqual(dashboardStore.writes[0].refresh, {
    requested: true,
    succeeded: true,
    updatedAt: refreshed.updatedAt,
    warning: null,
  });
});

test('successful raw refresh fails clearly when writing the dashboard index fails', async () => {
  const staleDashboard = buildLoomDashboard(cacheWithOpenTask('s'), { now: 1750000040000 });
  const dashboardStore = {
    indexPath: '/tmp/loom-dashboard/index.json',
    writes: [],
    async read() {
      return staleDashboard;
    },
    async write() {
      throw new Error('disk is full');
    },
  };
  const { service } = createService({
    dashboardStore,
    dependencies: {
      async refreshRawCache() {
        return cacheWithOpenTask('r', { updatedAt: 1750000030000 });
      },
    },
  });

  const result = await service.getDashboard({ refresh: true });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'loom_dashboard_index_write_failed');
  assert.match(result.message, /disk is full/);
  assert.deepEqual(result.data, {
    indexPath: dashboardStore.indexPath,
    warning: 'disk is full',
  });
});

test('refresh returns stale dashboard with warning metadata inside the dashboard when refresh fails', async () => {
  const staleDashboard = buildLoomDashboard(cacheWithOpenTask('s'), { now: 1750000040000 });
  const dashboardStore = createMemoryDashboardStore(staleDashboard);
  const { service } = createService({
    rawState: cache(emptyRecords()),
    dashboardStore,
    dependencies: {
      async refreshRawCache() {
        throw new Error('network unavailable');
      },
    },
  });

  const result = await service.getDashboard({ refresh: true });

  assert.equal(result.ok, true);
  assert.equal(result.code, 'loom_dashboard_stale');
  assert.deepEqual(result.data.dashboard.refresh, {
    requested: true,
    succeeded: false,
    updatedAt: staleDashboard.rawCacheUpdatedAt,
    warning: 'network unavailable',
  });
  assert.deepEqual(result.data.refresh, {
    requested: true,
    succeeded: false,
    warning: 'network unavailable',
  });
  assert.equal(result.data.cache.refreshed, false);
  assert.equal(dashboardStore.writes.length, 0);
});

test('refresh failure prefers full raw cache over an old filtered dashboard index', async () => {
  const records = emptyRecords();
  const openTask = taskRecord('o', { title: 'Open raw task' });
  const workingTask = taskRecord('w', { title: 'Working raw task' });
  const workingClaimPinId = pin('wc');
  records.task.push(openTask, workingTask);
  records.claim.push(claimRecord(workingTask.pinId, workingClaimPinId));
  records.status.push(statusRecord(workingTask.pinId, workingClaimPinId, 'in_progress'));
  const rawState = cache(records, 1750000037000);
  const filteredIndex = buildLoomDashboard(rawState, {
    filters: { state: 'working', limit: 1 },
    now: 1750000040000,
  });
  const dashboardStore = createMemoryDashboardStore(filteredIndex);
  const { service } = createService({
    rawState,
    dashboardStore,
    dependencies: {
      async refreshRawCache() {
        throw new Error('network unavailable');
      },
    },
  });

  const result = await service.getDashboard({
    refresh: true,
    state: 'open',
    query: 'raw task',
  });

  assert.equal(result.ok, true);
  assert.notEqual(result.code, 'loom_dashboard_stale');
  assert.deepEqual(result.data.dashboard.filters, {
    state: 'open',
    query: 'raw task',
  });
  assert.deepEqual(result.data.dashboard.tasks.map((task) => task.taskPinId), [openTask.pinId]);
  assert.deepEqual(result.data.dashboard.refresh, {
    requested: true,
    succeeded: false,
    updatedAt: rawState.updatedAt,
    warning: 'network unavailable',
  });
});

test('refresh stale fallback applies current filters and actor context', async () => {
  const records = emptyRecords();
  const requesterTask = taskRecord('q', { title: 'Requester task' });
  const developerTask = taskRecord('d', { title: 'Developer filtered task' });
  const developerClaimPinId = pin('dc');
  records.task.push(requesterTask, developerTask);
  records.claim.push(claimRecord(developerTask.pinId, developerClaimPinId));
  records.status.push(statusRecord(developerTask.pinId, developerClaimPinId, 'in_progress'));

  const staleDashboard = buildLoomDashboard(cache(records), {
    actorContext: { globalMetaId: requesterGlobalMetaId, address: 'requester-address' },
    now: 1750000040000,
  });
  const dashboardStore = createMemoryDashboardStore(staleDashboard);
  const { service } = createService({
    rawState: cache(emptyRecords()),
    dashboardStore,
    dependencies: {
      async refreshRawCache() {
        throw new Error('network unavailable');
      },
      async resolveActorContext() {
        return { globalMetaId: developerGlobalMetaId, address: 'developer-address' };
      },
    },
  });

  const result = await service.getDashboard({
    refresh: true,
    state: 'working',
    role: 'developer',
    query: 'filtered',
    limit: 1,
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.data.dashboard.filters, {
    state: 'working',
    role: 'developer',
    query: 'filtered',
    limit: 1,
  });
  assert.deepEqual(result.data.dashboard.actor, {
    globalMetaId: developerGlobalMetaId,
    address: 'developer-address',
  });
  assert.equal(result.data.dashboard.summary.totalTasks, 1);
  assert.equal(result.data.dashboard.summary.needsMyAction, 1);
  assert.deepEqual(result.data.dashboard.tasks.map((task) => task.taskPinId), [developerTask.pinId]);
  assert.equal(result.data.dashboard.tasks[0].actorContext.role, 'developer');
  assert.equal(result.data.dashboard.tasks[0].actorContext.needsMyAction, true);
  assert.equal(result.data.dashboard.columns.find((column) => column.id === 'working').cards.length, 1);
});

test('refresh failure returns command failure when dashboard index read throws and raw cache is empty', async () => {
  const dashboardStore = {
    indexPath: '/tmp/loom-dashboard/index.json',
    writes: [],
    async read() {
      throw new Error('index permission denied');
    },
    async write(next) {
      this.writes.push(next);
      return next;
    },
  };
  const { service } = createService({
    rawState: cache(emptyRecords()),
    dashboardStore,
    dependencies: {
      async refreshRawCache() {
        throw new Error('network unavailable');
      },
    },
  });

  const result = await service.getDashboard({ refresh: true });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'loom_dashboard_unavailable');
  assert.match(result.message, /network unavailable/);
  assert.deepEqual(result.data, {
    warning: 'network unavailable',
    indexWarning: 'index permission denied',
  });
});

test('refresh failure returns command failure when raw cache and dashboard index reads throw', async () => {
  const dashboardStore = {
    indexPath: '/tmp/loom-dashboard/index.json',
    writes: [],
    async read() {
      throw new Error('index permission denied');
    },
    async write(next) {
      this.writes.push(next);
      return next;
    },
  };
  const { service } = createService({
    dashboardStore,
    dependencies: {
      rawCacheStore: {
        async read() {
          throw new Error('cache permission denied');
        },
      },
      async refreshRawCache() {
        throw new Error('network unavailable');
      },
    },
  });

  const result = await service.getDashboard({ refresh: true });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'loom_dashboard_unavailable');
  assert.match(result.message, /network unavailable/);
  assert.deepEqual(result.data, {
    warning: 'network unavailable',
    cacheWarning: 'cache permission denied',
    indexWarning: 'index permission denied',
  });
});

test('refresh fails with stable code when refresh fails and no dashboard index exists', async () => {
  const { service } = createService({
    rawState: cache(emptyRecords()),
    dependencies: {
      async refreshRawCache() {
        throw new Error('chain unavailable');
      },
    },
  });

  const result = await service.refresh({});

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'loom_dashboard_unavailable');
});

test('rejects unsupported dashboard filters before aggregation', async () => {
  const { service } = createService();

  const result = await service.getDashboard({ state: 'blocked' });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'loom_dashboard_invalid_filter');
});

test('getTaskDetail returns stable not-found code for missing tasks', async () => {
  const { service } = createService();

  const result = await service.getTaskDetail({ taskPinId: pin('z') });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'loom_dashboard_task_not_found');
});
