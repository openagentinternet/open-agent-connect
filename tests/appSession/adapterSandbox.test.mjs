import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdapterSandbox, sandboxSha256Hex } from '../../dist/core/appSession/adapterSandbox.js';

const ADAPTER = `
export function initialState(config = {}) {
  return { phase: 'playing', turn: 'red', seats: {} };
}
export function getTurn(state) {
  return { phase: state.phase, seat: state.turn };
}
export function reduce(state, event) {
  if (event.type === 'action') state.turn = 'black';
  return state;
}
export function serializeState(state) {
  return JSON.parse(JSON.stringify(state));
}
export function getObservation(state) {
  return { state };
}
export function getActionSchema() {
  return { move: 'string' };
}
export function parseAction(text) {
  return { action: { move: text } };
}
export function validateAction(state, action) {
  return { ok: true, normalizedAction: action };
}
export function createMatch(config) {
  return initialState(config);
}
export function getResult(state) {
  return { finished: state.phase === 'finished' };
}
export function asyncExport() {
  return Promise.resolve(42);
}
`;

function hashOf(code) {
  return `sha256:${sandboxSha256Hex(code)}`;
}

test('adapter sandbox loads a module and calls exports with JSON results', async () => {
  const sandbox = createAdapterSandbox({
    adapterCode: ADAPTER,
    adapterHash: hashOf(ADAPTER),
  });
  try {
    const state = await sandbox.call('initialState', [{ gameId: 'x' }]);
    assert.deepEqual(state, { phase: 'playing', turn: 'red', seats: {} });
    const turn = await sandbox.call('getTurn', [state]);
    assert.deepEqual(turn, { phase: 'playing', seat: 'red' });
    const result = await sandbox.call('asyncExport', []);
    assert.equal(result, 42);
  } finally {
    sandbox.dispose();
  }
});

test('adapter sandbox rejects a hash mismatch before executing anything', () => {
  assert.throws(
    () => createAdapterSandbox({
      adapterCode: ADAPTER,
      adapterHash: `sha256:${'0'.repeat(64)}`,
    }),
    /adapterHash mismatch/u,
  );
});

test('adapter sandbox has no require/process/fetch/network access', async () => {
  const probe = `
export function initialState() {
  const probes = {
    require: typeof require,
    process: typeof process,
    fetch: typeof fetch,
    webSocket: typeof WebSocket,
    globalThisProcess: typeof globalThis.process,
    buffer: typeof Buffer,
  };
  return probes;
}
`;
  const sandbox = createAdapterSandbox({
    adapterCode: probe,
    adapterHash: hashOf(probe),
  });
  try {
    const probes = await sandbox.call('initialState', []);
    assert.deepEqual(probes, {
      require: 'undefined',
      process: 'undefined',
      fetch: 'undefined',
      webSocket: 'undefined',
      globalThisProcess: 'undefined',
      buffer: 'undefined',
    });
  } finally {
    sandbox.dispose();
  }
});

test('adapter sandbox blocks eval and Function construction', async () => {
  const probe = `
export function initialState() {
  let evalResult = 'blocked';
  try { evalResult = eval('1+1'); } catch (_) {}
  let functionResult = 'blocked';
  try { functionResult = new Function('return 1')(); } catch (_) {}
  return { evalResult, functionResult };
}
`;
  const sandbox = createAdapterSandbox({
    adapterCode: probe,
    adapterHash: hashOf(probe),
  });
  try {
    const result = await sandbox.call('initialState', []);
    assert.deepEqual(result, { evalResult: 'blocked', functionResult: 'blocked' });
  } finally {
    sandbox.dispose();
  }
});

test('adapter sandbox enforces call timeout', async () => {
  const slow = `
export function initialState() {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {}
  return { done: true };
}
`;
  const sandbox = createAdapterSandbox({
    adapterCode: slow,
    adapterHash: hashOf(slow),
    timeoutMs: 200,
  });
  try {
    await assert.rejects(
      sandbox.call('initialState', []),
      (error) => error.code === 'adapter_error',
    );
  } finally {
    sandbox.dispose();
  }
});

test('adapter sandbox enforces output size and JSON serializability', async () => {
  const big = `
export function initialState() {
  return { blob: 'x'.repeat(10_000_000) };
}
`;
  const sandbox = createAdapterSandbox({
    adapterCode: big,
    adapterHash: hashOf(big),
    maxOutputBytes: 1024,
  });
  try {
    await assert.rejects(
      sandbox.call('initialState', []),
      /output/u,
    );
  } finally {
    sandbox.dispose();
  }

  const circular = `
export function initialState() {
  const value = { name: 'loop' };
  value.self = value;
  return value;
}
`;
  const circularSandbox = createAdapterSandbox({
    adapterCode: circular,
    adapterHash: hashOf(circular),
  });
  try {
    await assert.rejects(
      circularSandbox.call('initialState', []),
      /JSON-serializable/u,
    );
  } finally {
    circularSandbox.dispose();
  }
});

test('adapter sandbox reports missing exports and wrong ABI shapes', async () => {
  const missing = `
export function initialState() {
  return {};
}
`;
  const sandbox = createAdapterSandbox({
    adapterCode: missing,
    adapterHash: hashOf(missing),
  });
  try {
    await assert.rejects(
      sandbox.call('getTurn', []),
      (error) => error.code === 'adapter_error' && /not found/u.test(error.message),
    );
  } finally {
    sandbox.dispose();
  }
});
