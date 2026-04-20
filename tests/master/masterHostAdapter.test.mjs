import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { prepareManualAskHostAction } = require('../../dist/core/master/masterHostAdapter.js');

function createMaster(overrides = {}) {
  return {
    masterPinId: 'master-pin-1',
    sourceMasterPinId: 'master-pin-1',
    chainPinIds: ['master-pin-1'],
    providerGlobalMetaId: 'idq1provider',
    providerMetaId: 'metaid-provider',
    providerAddress: 'mvc-address',
    serviceName: 'official-debug-master',
    displayName: 'Official Debug Master',
    description: 'Structured debugging help.',
    masterKind: 'debug',
    specialties: ['debugging'],
    hostModes: ['codex'],
    modelInfo: { provider: 'metaweb', model: 'official-debug-master-v1' },
    style: 'direct_and_structured',
    pricingMode: 'free',
    price: '0',
    currency: 'MVC',
    responseMode: 'structured',
    contextPolicy: 'standard',
    official: true,
    trustedTier: 'official',
    available: true,
    online: true,
    updatedAt: 1_776_300_000_000,
    ...overrides,
  };
}

function createHostContext() {
  return {
    now: 1_776_300_100_000,
    hostMode: 'codex',
    traceId: 'trace-host-adapter-1',
    conversation: {
      currentUserRequest: 'Go ask Debug Master about this bug and preview it first.',
      recentMessages: [
        { role: 'user', content: 'The Ask Master preview never leaves confirmation after I accept it.' },
        { role: 'assistant', content: 'I checked the current trace and pending state paths.' },
      ],
    },
    tools: {
      recentToolResults: [
        {
          toolName: 'npm test',
          exitCode: 1,
          stdout: 'not ok 2 - master host-action should generate a preview from host context',
          stderr: 'AssertionError: expected preview state to be awaiting_confirmation',
        },
      ],
    },
    workspace: {
      goal: 'Generate a safe Ask Master preview from host-visible context.',
      constraints: ['Do not upload the whole repository.'],
      relevantFiles: ['src/daemon/defaultHandlers.ts', 'tests/master/masterAskFlow.test.mjs'],
      diffSummary: 'Wiring the phase-2 host bridge.',
      fileExcerpts: [],
    },
    planner: {
      hasPlan: true,
      todoBlocked: true,
      onlyReadingWithoutConverging: false,
    },
  };
}

test('prepareManualAskHostAction resolves Debug Master from utterance and packages a draft from host-visible context', () => {
  const result = prepareManualAskHostAction({
    action: {
      kind: 'manual_ask',
      utterance: 'Go ask Debug Master about this bug and preview it first.',
    },
    context: createHostContext(),
    masters: [
      createMaster(),
      createMaster({
        masterPinId: 'master-pin-2',
        sourceMasterPinId: 'master-pin-2',
        chainPinIds: ['master-pin-2'],
        displayName: 'Official Architecture Master',
        serviceName: 'official-architecture-master',
        masterKind: 'architecture',
        updatedAt: 1_776_299_000_000,
      }),
    ],
    config: {
      contextMode: 'standard',
      trustedMasters: [],
    },
  });

  assert.equal(result.selectedTarget.displayName, 'Official Debug Master');
  assert.equal(result.draft.target?.servicePinId, 'master-pin-1');
  assert.equal(result.draft.triggerMode, 'manual');
  assert.match(result.draft.question, /preview never leaves confirmation/i);
  assert.deepEqual(result.draft.relevantFiles, [
    'src/daemon/defaultHandlers.ts',
    'tests/master/masterAskFlow.test.mjs',
  ]);
});

test('prepareManualAskHostAction falls back to the best trusted online master when the utterance does not name one', () => {
  const result = prepareManualAskHostAction({
    action: {
      kind: 'manual_ask',
      utterance: 'Please ask a master about this blocked task.',
    },
    context: {
      ...createHostContext(),
      conversation: {
        currentUserRequest: 'Please ask a master about this blocked task.',
        recentMessages: [
          { role: 'user', content: 'The current trace times out after confirmation and never shows a response.' },
        ],
      },
    },
    masters: [
      createMaster({
        masterPinId: 'master-pin-untrusted',
        sourceMasterPinId: 'master-pin-untrusted',
        chainPinIds: ['master-pin-untrusted'],
        displayName: 'Community Debug Master',
        serviceName: 'community-debug-master',
        official: false,
        trustedTier: null,
        updatedAt: 1_776_400_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-trusted',
        sourceMasterPinId: 'master-pin-trusted',
        chainPinIds: ['master-pin-trusted'],
        displayName: 'Official Debug Master',
        serviceName: 'official-debug-master',
        updatedAt: 1_776_299_000_000,
      }),
    ],
    config: {
      contextMode: 'compact',
      trustedMasters: ['master-pin-trusted'],
    },
  });

  assert.equal(result.selectedTarget.masterPinId, 'master-pin-trusted');
  assert.match(result.draft.question, /trace times out after confirmation/i);
});

test('prepareManualAskHostAction infers a named master from the utterance instead of silently falling back', () => {
  const result = prepareManualAskHostAction({
    action: {
      kind: 'manual_ask',
      utterance: 'Please ask Architecture Master about the planner getting stuck.',
    },
    context: {
      ...createHostContext(),
      conversation: {
        currentUserRequest: 'Please ask Architecture Master about the planner getting stuck.',
        recentMessages: [
          { role: 'user', content: 'The planner keeps reading files without converging on an implementation path.' },
        ],
      },
    },
    masters: [
      createMaster({
        masterPinId: 'master-pin-debug',
        sourceMasterPinId: 'master-pin-debug',
        chainPinIds: ['master-pin-debug'],
        displayName: 'Official Debug Master',
        serviceName: 'official-debug-master',
        masterKind: 'debug',
        updatedAt: 1_776_400_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-architecture',
        sourceMasterPinId: 'master-pin-architecture',
        chainPinIds: ['master-pin-architecture'],
        displayName: 'Official Architecture Master',
        serviceName: 'official-architecture-master',
        masterKind: 'architecture',
        updatedAt: 1_776_200_000_000,
      }),
    ],
    config: {
      contextMode: 'standard',
      trustedMasters: [],
    },
  });

  assert.equal(result.selectedTarget.masterPinId, 'master-pin-architecture');
  assert.match(result.draft.question, /planner keeps reading files without converging/i);
});

test('prepareManualAskHostAction fails loudly when the named master is unavailable', () => {
  assert.throws(() => prepareManualAskHostAction({
    action: {
      kind: 'manual_ask',
      utterance: 'Please ask Architecture Master about the planner getting stuck.',
    },
    context: {
      ...createHostContext(),
      conversation: {
        currentUserRequest: 'Please ask Architecture Master about the planner getting stuck.',
        recentMessages: [
          { role: 'user', content: 'The planner keeps reading files without converging on an implementation path.' },
        ],
      },
    },
    masters: [
      createMaster({
        masterPinId: 'master-pin-debug',
        sourceMasterPinId: 'master-pin-debug',
        chainPinIds: ['master-pin-debug'],
        displayName: 'Official Debug Master',
        serviceName: 'official-debug-master',
        masterKind: 'debug',
      }),
    ],
    config: {
      contextMode: 'standard',
      trustedMasters: [],
    },
  }), (error) => {
    assert.equal(error?.code, 'master_not_found');
    assert.match(String(error?.message), /No eligible online Master matched the current host action/i);
    assert.match(String(error?.message), /requested Master could not be found/i);
    return true;
  });
});
