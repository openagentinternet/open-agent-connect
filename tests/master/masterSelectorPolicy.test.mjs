import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { selectMasterCandidate } = require('../../dist/core/master/masterSelector.js');
const { evaluateMasterPolicy } = require('../../dist/core/master/masterPolicyGate.js');

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

function createPolicyConfig(overrides = {}) {
  return {
    enabled: true,
    triggerMode: 'suggest',
    confirmationMode: 'always',
    contextMode: 'standard',
    trustedMasters: [],
    ...overrides,
  };
}

test('selectMasterCandidate prioritizes an explicit display-name match over directory ranking', () => {
  const selected = selectMasterCandidate({
    hostMode: 'codex',
    preferredDisplayName: 'Community Debug Master',
    preferredMasterKind: 'debug',
    trustedMasters: ['master-pin-official'],
    onlineOnly: true,
    candidates: [
      createMaster({
        masterPinId: 'master-pin-official',
        sourceMasterPinId: 'master-pin-official',
        chainPinIds: ['master-pin-official'],
        displayName: 'Official Debug Master',
        serviceName: 'official-debug-master',
        updatedAt: 1_776_400_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-community',
        sourceMasterPinId: 'master-pin-community',
        chainPinIds: ['master-pin-community'],
        displayName: 'Community Debug Master',
        serviceName: 'community-debug-master',
        official: false,
        trustedTier: null,
        updatedAt: 1_776_100_000_000,
      }),
    ],
  });

  assert.equal(selected?.masterPinId, 'master-pin-community');
});

test('selectMasterCandidate keeps an explicit target even when the preferred kind conflicts', () => {
  const selected = selectMasterCandidate({
    hostMode: 'codex',
    preferredDisplayName: 'Official Architecture Master',
    preferredMasterKind: 'debug',
    trustedMasters: [],
    onlineOnly: true,
    candidates: [
      createMaster({
        masterPinId: 'master-pin-architecture',
        sourceMasterPinId: 'master-pin-architecture',
        chainPinIds: ['master-pin-architecture'],
        displayName: 'Official Architecture Master',
        serviceName: 'official-architecture-master',
        masterKind: 'architecture',
      }),
      createMaster(),
    ],
  });

  assert.equal(selected?.masterPinId, 'master-pin-architecture');
});

test('selectMasterCandidate applies host mode, master kind, trusted, official, online, and updatedAt ordering', () => {
  const selected = selectMasterCandidate({
    hostMode: 'claude',
    preferredMasterKind: 'debug',
    trustedMasters: ['master-pin-trusted-claude'],
    onlineOnly: true,
    candidates: [
      createMaster({
        masterPinId: 'master-pin-codex',
        sourceMasterPinId: 'master-pin-codex',
        chainPinIds: ['master-pin-codex'],
        displayName: 'Codex Debug Master',
        hostModes: ['codex'],
        updatedAt: 1_776_500_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-architecture',
        sourceMasterPinId: 'master-pin-architecture',
        chainPinIds: ['master-pin-architecture'],
        displayName: 'Claude Architecture Master',
        masterKind: 'architecture',
        hostModes: ['claude'],
        updatedAt: 1_776_450_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-official-claude',
        sourceMasterPinId: 'master-pin-official-claude',
        chainPinIds: ['master-pin-official-claude'],
        displayName: 'Official Claude Debug Master',
        hostModes: ['claude'],
        official: true,
        updatedAt: 1_776_350_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-trusted-claude',
        sourceMasterPinId: 'master-pin-trusted-claude',
        chainPinIds: ['master-pin-trusted-claude'],
        displayName: 'Trusted Claude Debug Master',
        hostModes: ['claude'],
        official: false,
        trustedTier: null,
        updatedAt: 1_776_250_000_000,
      }),
      createMaster({
        masterPinId: 'master-pin-offline-claude',
        sourceMasterPinId: 'master-pin-offline-claude',
        chainPinIds: ['master-pin-offline-claude'],
        displayName: 'Offline Claude Debug Master',
        hostModes: ['claude'],
        online: false,
        updatedAt: 1_776_600_000_000,
      }),
    ],
  });

  assert.equal(selected?.masterPinId, 'master-pin-trusted-claude');
});

test('evaluateMasterPolicy blocks Ask Master completely when disabled', () => {
  const decision = evaluateMasterPolicy({
    config: createPolicyConfig({ enabled: false }),
    action: 'manual_ask',
    selectedMaster: createMaster(),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'ask_master_disabled');
  assert.equal(decision.blockedReason, 'Ask Master is disabled by local config.');
});

test('evaluateMasterPolicy always requires confirmation when confirmationMode is always', () => {
  const decision = evaluateMasterPolicy({
    config: createPolicyConfig({ confirmationMode: 'always' }),
    action: 'manual_ask',
    selectedMaster: createMaster(),
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.requiresConfirmation, true);
});

test('evaluateMasterPolicy does not surface suggestions when triggerMode is manual', () => {
  const decision = evaluateMasterPolicy({
    config: createPolicyConfig({ triggerMode: 'manual' }),
    action: 'suggest',
    selectedMaster: createMaster(),
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, 'trigger_mode_disallows_suggest');
  assert.equal(decision.blockedReason, 'Ask Master trigger mode is manual.');
});

test('evaluateMasterPolicy keeps the phase-2 auto_candidate branch reachable without a selected master', () => {
  const decision = evaluateMasterPolicy({
    config: createPolicyConfig({ triggerMode: 'auto' }),
    action: 'auto_candidate',
    selectedMaster: null,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.code, null);
  assert.equal(decision.blockedReason, 'Auto Ask Master is not exposed in the phase-2 host flow.');
});
