import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  createA2AContractEngine,
} = require('../../dist/core/a2a/contractEngine.js');

function createEngine() {
  let sequence = 0;
  return createA2AContractEngine({
    now: () => 1_744_444_444_000 + (sequence += 1),
    createContractId: () => `contract-test-${sequence}`,
  });
}

const BASE_INPUT = {
  specRef: 'specs/sdd-social-metaapp.md',
  roles: {
    specOwner: 'idq-spec-owner',
    contributors: ['idq-contributor-1'],
    acceptanceOwner: 'idq-acceptance-owner',
  },
  deadlines: {
    firstResponseDeadline: 1_744_444_500_000,
    deliveryDeadline: 1_744_445_000_000,
  },
  acceptance: 'fixture E1-E7 pass with no drift',
  openQuestions: ['E7 tree element shape?'],
};

test('contract engine creates a draft contract with normalized fields', () => {
  const engine = createEngine();
  const contract = engine.createDraft(BASE_INPUT);

  assert.equal(contract.contractId, 'contract-test-1');
  assert.equal(contract.state, 'draft');
  assert.equal(contract.specRef, 'specs/sdd-social-metaapp.md');
  assert.equal(contract.roles.specOwner, 'idq-spec-owner');
  assert.deepEqual(contract.roles.contributors, ['idq-contributor-1']);
  assert.equal(contract.deadlines.deliveryDeadline, 1_744_445_000_000);
  assert.deepEqual(contract.deliveryFacts, []);
  assert.deepEqual(contract.openQuestions, ['E7 tree element shape?']);
});

test('contract engine walks the happy path draft -> proposed -> open -> decided -> locked', () => {
  const engine = createEngine();
  let contract = engine.createDraft(BASE_INPUT);

  ({ contract } = engine.applyEvent({ contract, event: 'propose' }));
  assert.equal(contract.state, 'proposed');

  ({ contract } = engine.applyEvent({ contract, event: 'confirm' }));
  assert.equal(contract.state, 'open');

  ({ contract } = engine.applyEvent({ contract, event: 'decide' }));
  assert.equal(contract.state, 'decided');

  const mutation = engine.applyEvent({ contract, event: 'accept', note: 'E1-E7 all green' });
  assert.equal(mutation.contract.state, 'locked');
  assert.equal(mutation.previousState, 'decided');
  assert.equal(mutation.event, 'accept');
  assert.equal(mutation.contract.revisionNote, 'E1-E7 all green');
});

test('contract engine accepts from open without an intermediate decide', () => {
  const engine = createEngine();
  let contract = engine.createDraft(BASE_INPUT);

  ({ contract } = engine.applyEvent({ contract, event: 'propose' }));
  ({ contract } = engine.applyEvent({ contract, event: 'confirm' }));
  ({ contract } = engine.applyEvent({ contract, event: 'accept' }));

  assert.equal(contract.state, 'locked');
});

test('contract engine rejects invalid transitions', () => {
  const engine = createEngine();
  const contract = engine.createDraft(BASE_INPUT);

  assert.equal(engine.canApplyEvent(contract, 'confirm'), false);
  assert.equal(engine.canApplyEvent(contract, 'propose'), true);
  assert.throws(
    () => engine.applyEvent({ contract, event: 'confirm' }),
    /Invalid A2A contract transition: draft --confirm--> \?/,
  );
});

test('contract engine sends objection and insufficient events back to draft for revision', () => {
  const engine = createEngine();
  let contract = engine.createDraft(BASE_INPUT);

  ({ contract } = engine.applyEvent({ contract, event: 'propose' }));
  ({ contract } = engine.applyEvent({ contract, event: 'objection', note: 'E7 needs clarity' }));
  assert.equal(contract.state, 'draft');
  assert.equal(contract.revisionNote, 'E7 needs clarity');

  ({ contract } = engine.applyEvent({ contract, event: 'propose' }));
  ({ contract } = engine.applyEvent({ contract, event: 'confirm' }));
  ({ contract } = engine.applyEvent({ contract, event: 'insufficient', note: 'missing fixture' }));
  assert.equal(contract.state, 'draft');
});

test('contract engine only allows reopen from locked, as a spec bug record', () => {
  const engine = createEngine();
  const draft = engine.createDraft(BASE_INPUT);
  assert.equal(engine.canApplyEvent(draft, 'reopen'), false);

  let contract = engine.createDraft(BASE_INPUT);
  ({ contract } = engine.applyEvent({ contract, event: 'propose' }));
  ({ contract } = engine.applyEvent({ contract, event: 'confirm' }));
  ({ contract } = engine.applyEvent({ contract, event: 'accept' }));
  assert.equal(contract.state, 'locked');

  const reopened = engine.applyEvent({ contract, event: 'reopen', note: 'spec discrepancy: E7' });
  assert.equal(reopened.contract.state, 'open');
});

test('contract engine closes active states with bye and rejects draft/proposed/open', () => {
  const engine = createEngine();
  let contract = engine.createDraft(BASE_INPUT);
  ({ contract } = engine.applyEvent({ contract, event: 'bye' }));
  assert.equal(contract.state, 'closed');

  contract = engine.createDraft(BASE_INPUT);
  ({ contract } = engine.applyEvent({ contract, event: 'reject' }));
  assert.equal(contract.state, 'rejected');

  contract = engine.createDraft(BASE_INPUT);
  ({ contract } = engine.applyEvent({ contract, event: 'propose' }));
  ({ contract } = engine.applyEvent({ contract, event: 'confirm' }));
  ({ contract } = engine.applyEvent({ contract, event: 'reject' }));
  assert.equal(contract.state, 'rejected');
});
