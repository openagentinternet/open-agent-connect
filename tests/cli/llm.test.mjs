import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { runCli } = require('../../dist/cli/main.js');

function commandSuccess(data = {}) {
  return { ok: true, state: 'success', data };
}

async function runLlm(args, dependencies) {
  const stdout = [];
  const exitCode = await runCli(args, {
    dependencies,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  });
  return {
    exitCode,
    payload: JSON.parse(stdout.join('').trim()),
  };
}

test('runCli uses --from as the canonical LLM binding actor selector', async () => {
  const calls = [];
  const dependencies = {
    llm: {
      listBindings: async (input) => {
        calls.push(['bindings', input]);
        return commandSuccess({ bindings: [] });
      },
      upsertBindings: async (input) => {
        calls.push(['bind', input]);
        return commandSuccess({ bindings: input.bindings });
      },
    },
  };
  const bindings = await runLlm(['llm', 'bindings', '--from', 'alice'], dependencies);
  const bind = await runLlm(['llm', 'bind', '--from', 'alice', '--runtime-id', 'runtime-1', '--role', 'primary'], dependencies);

  assert.equal(bindings.exitCode, 0);
  assert.equal(bind.exitCode, 0);
  assert.equal(bindings.payload.ok, true);
  assert.equal(bind.payload.ok, true);
  assert.deepEqual(calls.map(([name, input]) => [name, input.from, input.slug ?? null]), [
    ['bindings', 'alice', null],
    ['bind', 'alice', null],
  ]);
  assert.equal(calls[1][1].bindings[0].llmRuntimeId, 'runtime-1');
  assert.equal(calls[1][1].bindings[0].role, 'primary');
});

test('runCli forwards --from to LLM unbind and preferred runtime commands', async () => {
  const calls = [];
  const dependencies = {
    llm: {
      removeBinding: async (input) => {
        calls.push(['unbind', input]);
        return commandSuccess({ removed: true });
      },
      setPreferredRuntime: async (input) => {
        calls.push(['set-preferred', input]);
        return commandSuccess({ runtimeId: input.runtimeId });
      },
      getPreferredRuntime: async (input) => {
        calls.push(['get-preferred', input]);
        return commandSuccess({ runtimeId: 'runtime-1' });
      },
    },
  };
  await runLlm(['llm', 'unbind', '--from', 'alice', '--binding-id', 'binding-1'], dependencies);
  await runLlm(['llm', 'set-preferred', '--from', 'alice', '--runtime-id', 'runtime-1'], dependencies);
  await runLlm(['llm', 'get-preferred', '--from', 'alice'], dependencies);

  assert.deepEqual(calls.map(([name, input]) => [name, input.from, input.slug ?? null]), [
    ['unbind', 'alice', null],
    ['set-preferred', 'alice', null],
    ['get-preferred', 'alice', null],
  ]);
  assert.equal(calls[0][1].bindingId, 'binding-1');
  assert.equal(calls[1][1].runtimeId, 'runtime-1');
});

test('runCli delegates LLM profile commands without --from so dependencies can apply active fallback', async () => {
  const calls = [];
  const stdout = [];
  const dependencies = {
    llm: {
      listBindings: async (input) => {
        calls.push(['bindings', input]);
        return commandSuccess({ bindings: [] });
      },
      upsertBindings: async (input) => {
        calls.push(['bind', input]);
        return commandSuccess({ bindings: input.bindings });
      },
      removeBinding: async (input) => {
        calls.push(['unbind', input]);
        return commandSuccess({ removed: true });
      },
      setPreferredRuntime: async (input) => {
        calls.push(['set-preferred', input]);
        return commandSuccess({ runtimeId: input.runtimeId });
      },
      getPreferredRuntime: async (input) => {
        calls.push(['get-preferred', input]);
        return commandSuccess({ runtimeId: null });
      },
    },
  };

  const cliContext = {
    dependencies,
    stdout: { write: (chunk) => { stdout.push(String(chunk)); return true; } },
    stderr: { write: () => true },
  };

  assert.equal(await runCli(['llm', 'bindings'], cliContext), 0);
  assert.equal(await runCli(['llm', 'bind', '--runtime-id', 'runtime-1', '--role', 'primary'], cliContext), 0);
  assert.equal(await runCli(['llm', 'unbind', '--binding-id', 'binding-1'], cliContext), 0);
  assert.equal(await runCli(['llm', 'set-preferred', '--runtime-id', 'runtime-1'], cliContext), 0);
  assert.equal(await runCli(['llm', 'get-preferred'], cliContext), 0);

  assert.deepEqual(
    calls.map(([name, input]) => [name, input.from ?? null, input.slug ?? null]),
    [
      ['bindings', null, null],
      ['bind', null, null],
      ['unbind', null, null],
      ['set-preferred', null, null],
      ['get-preferred', null, null],
    ],
  );
  assert.equal(calls[1][1].bindings[0].llmRuntimeId, 'runtime-1');
  assert.equal(calls[1][1].bindings[0].role, 'primary');
});
