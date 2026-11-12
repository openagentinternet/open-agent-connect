import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { createDefaultCliDependencies, mergeCliDependencies } = require('../../dist/cli/runtime.js');

function minimalContext() {
  return {
    stdout: { write: () => true },
    stderr: { write: () => true },
    env: {},
    cwd: '/x',
    readTextFile: async () => '',
    stdin: null,
    dependencies: {},
  };
}

/**
 * mergeCliDependencies carries every dependency group through an EXPLICIT
 * per-group whitelist. A group present in createDefaultCliDependencies but
 * missing from that list silently vanishes for every real CLI invocation:
 * the command layer answers not_implemented ("handler is not configured")
 * even though the daemon supports it — exactly what shipped with the local
 * session adapters P1–P5b (`metabot sessions *` answered not_implemented
 * against a fully capable daemon until this regression test existed).
 *
 * The guard is structural: every default group must survive the merge.
 */
test('mergeCliDependencies carries every default dependency group', () => {
  const context = minimalContext();
  const defaults = createDefaultCliDependencies(context);
  const merged = mergeCliDependencies(context);
  const dropped = Object.keys(defaults).filter((group) => !merged[group]);
  assert.deepEqual(dropped, [], `dependency groups dropped by mergeCliDependencies: ${dropped.join(', ')}`);
});

test('mergeCliDependencies lets provided handlers override defaults per group', () => {
  const context = minimalContext();
  const marker = { list: async () => ({ ok: true, state: 'success', data: { via: 'provided' } }) };
  const merged = mergeCliDependencies({ ...context, dependencies: { sessions: marker } });
  assert.equal(merged.sessions.list, marker.list, 'provided sessions handlers win');
  assert.ok(merged.chat, 'other groups keep their defaults');
});
