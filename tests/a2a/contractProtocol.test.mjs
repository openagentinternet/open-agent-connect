import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildContractProtocolMessage,
  buildContractProposeMessage,
  parseContractProtocolMessage,
  parseContractProposeMessage,
} = require('../../dist/core/a2a/protocol/contractProtocol.js');
const {
  createA2AContractEngine,
} = require('../../dist/core/a2a/contractEngine.js');

function createContract() {
  let sequence = 0;
  const engine = createA2AContractEngine({
    now: () => 1_744_444_444_000 + (sequence += 1),
    createContractId: () => `contract-test-${sequence}`,
  });
  return engine.createDraft({
    specRef: 'specs/sdd-social-metaapp.md',
    roles: {
      specOwner: 'idq-spec-owner',
      contributors: ['idq-contributor-1'],
      acceptanceOwner: 'idq-acceptance-owner',
    },
    acceptance: 'E1-E7 fixtures pass',
    openQuestions: ['E7 tree shape?'],
  });
}

test('contract protocol builds and parses plain contract messages', () => {
  const contract = createContract();
  const message = buildContractProtocolMessage(
    'CONTRACT_CONFIRM',
    contract.contractId,
    'spec locked, work can start',
  );

  assert.equal(message, `[CONTRACT_CONFIRM:${contract.contractId}] spec locked, work can start`);

  const parsed = parseContractProtocolMessage(message);
  assert.equal(parsed.tag, 'CONTRACT_CONFIRM');
  assert.equal(parsed.contractId, contract.contractId);
  assert.equal(parsed.content, 'spec locked, work can start');
  assert.equal(parsed.payload, null);
});

test('contract protocol builds and parses the propose payload', () => {
  const contract = createContract();
  const message = buildContractProposeMessage(contract);

  assert.ok(message.startsWith(`[CONTRACT_PROPOSE:${contract.contractId}] `));

  const parsed = parseContractProposeMessage(message);
  assert.equal(parsed.contractId, contract.contractId);
  assert.equal(parsed.contract.specRef, 'specs/sdd-social-metaapp.md');
  assert.equal(parsed.contract.state, 'draft');
  assert.deepEqual(parsed.contract.roles.contributors, ['idq-contributor-1']);
  assert.deepEqual(parsed.contract.openQuestions, ['E7 tree shape?']);
});

test('contract protocol parser rejects malformed or unrelated content', () => {
  assert.equal(parseContractProtocolMessage('hello remote bot'), null);
  assert.equal(parseContractProtocolMessage('[CONTRACT_PROPOSE]'), null);
  assert.equal(parseContractProtocolMessage('[ORDER] not a contract'), null);
  assert.equal(parseContractProtocolMessage('[HELLO] random'), null);
  assert.equal(parseContractProposeMessage('[CONTRACT_CONFIRM:contract-test-1] ok'), null);
  assert.equal(parseContractProposeMessage('[CONTRACT_PROPOSE:contract-test-1] not json'), null);
});
