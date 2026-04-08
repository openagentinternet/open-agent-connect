import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createServiceRunnerRegistry,
} = require('../../dist/core/a2a/provider/serviceRunnerRegistry.js');

test('service pin and provider skill each resolve to one runner', async () => {
  let weatherCalls = 0;
  let fortuneCalls = 0;

  const registry = createServiceRunnerRegistry([
    {
      servicePinId: 'pin-weather',
      providerSkill: 'weather.oracle',
      runner: async () => {
        weatherCalls += 1;
        return {
          state: 'completed',
          responseText: 'Tomorrow will be bright.',
        };
      },
    },
    {
      providerSkill: 'fortune.reader',
      runner: async () => {
        fortuneCalls += 1;
        return {
          state: 'completed',
          responseText: 'Fortune favors the bold.',
        };
      },
    },
  ]);

  const byPin = registry.resolve({
    servicePinId: 'pin-weather',
    providerSkill: '',
  });
  assert.equal(byPin.ok, true);
  assert.equal(byPin.matchBy, 'servicePinId');

  const pinResult = await registry.execute({
    servicePinId: 'pin-weather',
    providerSkill: '',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'What is tomorrow weather?',
    taskContext: '',
  });
  assert.equal(pinResult.state, 'completed');
  assert.equal(weatherCalls, 1);

  const bySkill = registry.resolve({
    servicePinId: '',
    providerSkill: 'fortune.reader',
  });
  assert.equal(bySkill.ok, true);
  assert.equal(bySkill.matchBy, 'providerSkill');

  const skillResult = await registry.execute({
    servicePinId: '',
    providerSkill: 'fortune.reader',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'How is my luck?',
    taskContext: '',
  });
  assert.equal(skillResult.state, 'completed');
  assert.equal(fortuneCalls, 1);
});

test('runner contract supports only completed, needs_clarification, or failed states', async () => {
  const registry = createServiceRunnerRegistry([
    {
      servicePinId: 'pin-complete',
      runner: async () => ({
        state: 'completed',
        responseText: 'done',
      }),
    },
    {
      servicePinId: 'pin-clarify',
      runner: async () => ({
        state: 'needs_clarification',
        question: 'Which city should I use?',
      }),
    },
    {
      servicePinId: 'pin-failed',
      runner: async () => ({
        state: 'failed',
        code: 'runner_failed',
        message: 'The provider runner could not complete the task.',
      }),
    },
  ]);

  const completed = await registry.execute({
    servicePinId: 'pin-complete',
    providerSkill: '',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'complete',
    taskContext: '',
  });
  const clarification = await registry.execute({
    servicePinId: 'pin-clarify',
    providerSkill: '',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'clarify',
    taskContext: '',
  });
  const failed = await registry.execute({
    servicePinId: 'pin-failed',
    providerSkill: '',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'fail',
    taskContext: '',
  });

  assert.deepEqual(
    [completed.state, clarification.state, failed.state],
    ['completed', 'needs_clarification', 'failed'],
  );
});

test('unknown service returns a provider-side not-found failure without invoking any runner', async () => {
  let runnerCalls = 0;
  const registry = createServiceRunnerRegistry([
    {
      servicePinId: 'pin-known',
      providerSkill: 'known.skill',
      runner: async () => {
        runnerCalls += 1;
        return {
          state: 'completed',
          responseText: 'known',
        };
      },
    },
  ]);

  const result = await registry.execute({
    servicePinId: 'pin-missing',
    providerSkill: 'missing.skill',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'missing',
    taskContext: '',
  });

  assert.equal(result.state, 'failed');
  assert.equal(result.code, 'service_runner_not_found');
  assert.equal('ok' in result, false);
  assert.equal('matchBy' in result, false);
  assert.equal(
    result.message.includes('pin-missing') || result.message.includes('missing.skill'),
    true,
  );
  assert.equal(runnerCalls, 0);
});

test('runner exceptions and invalid results are normalized into failed runner results', async () => {
  const registry = createServiceRunnerRegistry([
    {
      servicePinId: 'pin-exception',
      runner: async () => {
        throw new Error('runner exploded');
      },
    },
    {
      servicePinId: 'pin-invalid',
      runner: async () => ({ state: 'unknown' }),
    },
  ]);

  const exceptionResult = await registry.execute({
    servicePinId: 'pin-exception',
    providerSkill: '',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'explode',
    taskContext: '',
  });
  const invalidResult = await registry.execute({
    servicePinId: 'pin-invalid',
    providerSkill: '',
    providerGlobalMetaId: 'idq-provider',
    userTask: 'invalid',
    taskContext: '',
  });

  assert.deepEqual(
    [exceptionResult.state, exceptionResult.code],
    ['failed', 'service_runner_exception'],
  );
  assert.deepEqual(
    [invalidResult.state, invalidResult.code],
    ['failed', 'invalid_service_runner_result'],
  );
});

test('duplicate service pin or provider skill registration is rejected', () => {
  assert.throws(
    () => createServiceRunnerRegistry([
      {
        servicePinId: 'pin-duplicate',
        providerSkill: 'duplicate.skill',
        runner: async () => ({ state: 'completed', responseText: 'first' }),
      },
      {
        servicePinId: 'pin-duplicate',
        providerSkill: 'other.skill',
        runner: async () => ({ state: 'completed', responseText: 'second' }),
      },
    ]),
    /service pin/i,
  );

  assert.throws(
    () => createServiceRunnerRegistry([
      {
        servicePinId: 'pin-one',
        providerSkill: 'duplicate.skill',
        runner: async () => ({ state: 'completed', responseText: 'first' }),
      },
      {
        servicePinId: 'pin-two',
        providerSkill: 'duplicate.skill',
        runner: async () => ({ state: 'completed', responseText: 'second' }),
      },
    ]),
    /provider skill/i,
  );
});
