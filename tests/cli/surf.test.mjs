// `metabot surf` CLI dispatch — flag/positional parsing (budget value must
// never swallow a flag's argument) and trigger normalization.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');
const { commandSuccess } = require('../../dist/core/contracts/commandResult.js');

function makeContext(dependencies) {
  const lines = [];
  return {
    lines,
    stdout: { write: (chunk) => { lines.push(String(chunk)); return true; } },
    stderr: { write: () => true },
    readTextFile: async () => '{}',
    dependencies,
  };
}

/** The CLI prints one JSON envelope per command; read it back. */
function envelope(context) {
  const json = context.lines.join('').match(/\{[\s\S]*\}/);
  return json ? JSON.parse(json[0]) : null;
}

test('surf budget reads the positional after flag values, not the --from slug', async () => {
  const calls = [];
  const dependencies = {
    surf: {
      budget: async (input) => {
        calls.push(input);
        return commandSuccess({ interactionBudget: input.budget });
      },
    },
  };
  const context = makeContext(dependencies);

  // The live-smoke regression: `--from bob 0` must parse budget=0, from=bob.
  await runCli(['surf', 'budget', '--from', 'bob', '0'], context);
  assert.equal(envelope(context).ok, true);
  assert.deepEqual(calls[0], { from: 'bob', budget: 0 });

  // Flag form and slug-less form both work.
  await runCli(['surf', 'budget', '--value', '30'], context);
  assert.deepEqual(calls[1], { from: undefined, budget: 30 });
  await runCli(['surf', 'budget', '55'], context);
  assert.deepEqual(calls[2], { from: undefined, budget: 55 });

  // Out-of-range stays rejected before the handler is reached.
  const badContext = makeContext(dependencies);
  await runCli(['surf', 'budget', '--from', 'bob', '101'], badContext);
  assert.equal(envelope(badContext).ok, false);
  assert.equal(envelope(badContext).code, 'invalid_budget');
});

test('surf run normalizes unknown triggers and forwards --wait', async () => {
  const calls = [];
  const dependencies = {
    surf: {
      run: async (input) => {
        calls.push(input);
        return commandSuccess({ runId: 'r1' });
      },
    },
  };
  const context = makeContext(dependencies);

  await runCli(['surf', 'run', '--from', 'bob', '--trigger', 'pre-dream'], context);
  assert.deepEqual(calls[0], { from: 'bob', trigger: 'pre-dream' });

  const invalidContext = makeContext(dependencies);
  await runCli(['surf', 'run', '--trigger', 'evil'], invalidContext);
  assert.equal(envelope(invalidContext).ok, false);
  assert.equal(envelope(invalidContext).code, 'invalid_trigger');

  await runCli(['surf', 'run', '--wait'], context);
  assert.deepEqual(calls[1], { from: undefined, wait: true });
});

test('surf status forwards --from and --limit', async () => {
  const calls = [];
  const dependencies = {
    surf: {
      status: async (input) => {
        calls.push(input);
        return commandSuccess({});
      },
    },
  };
  await runCli(['surf', 'status', '--from', 'bob', '--limit', '8'], makeContext(dependencies));
  assert.deepEqual(calls[0], { from: 'bob', limit: 8 });
});
