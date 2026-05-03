import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  evaluateDelegationPolicy,
  resolveDelegationPolicyMode,
} = require('../../dist/core/a2a/delegationPolicy.js');

test('confirm_all always requires confirmation', () => {
  const decision = evaluateDelegationPolicy({
    policyMode: 'confirm_all',
    estimatedCostAmount: '0',
    estimatedCostCurrency: 'SPACE',
  });

  assert.equal(decision.requiresConfirmation, true);
  assert.equal(decision.policyMode, 'confirm_all');
  assert.equal(decision.policyReason, 'confirm_all_requires_confirmation');
  assert.equal(decision.confirmationBypassed, false);
  assert.equal(decision.bypassReason, null);
});

test('policy decision shape exposes requiresConfirmation, policyMode, and policyReason', () => {
  const decision = evaluateDelegationPolicy({ policyMode: 'confirm_all' });

  assert.equal(typeof decision.requiresConfirmation, 'boolean');
  assert.equal(typeof decision.policyMode, 'string');
  assert.equal(typeof decision.policyReason, 'string');
});

test('confirm_paid_only bypasses confirmation for free services but still confirms paid services', () => {
  assert.equal(resolveDelegationPolicyMode('confirm_paid_only'), 'confirm_paid_only');
  assert.equal(resolveDelegationPolicyMode('auto_when_safe'), 'auto_when_safe');

  const freeDecision = evaluateDelegationPolicy({
    policyMode: 'confirm_paid_only',
    estimatedCostAmount: '0',
    estimatedCostCurrency: 'SPACE',
  });
  assert.equal(freeDecision.requestedPolicyMode, 'confirm_paid_only');
  assert.equal(freeDecision.policyMode, 'confirm_paid_only');
  assert.equal(freeDecision.requiresConfirmation, false);
  assert.equal(freeDecision.policyReason, 'free_service_auto_approved');
  assert.equal(freeDecision.confirmationBypassed, true);

  const unpricedDecision = evaluateDelegationPolicy({
    policyMode: 'confirm_paid_only',
    estimatedCostAmount: '',
    estimatedCostCurrency: 'SPACE',
  });
  assert.equal(unpricedDecision.requiresConfirmation, true);
  assert.equal(unpricedDecision.policyReason, 'paid_service_requires_confirmation');
  assert.equal(unpricedDecision.confirmationBypassed, false);

  const paidDecision = evaluateDelegationPolicy({
    policyMode: 'confirm_paid_only',
    estimatedCostAmount: '0.00001',
    estimatedCostCurrency: 'SPACE',
  });
  assert.equal(paidDecision.requestedPolicyMode, 'confirm_paid_only');
  assert.equal(paidDecision.policyMode, 'confirm_paid_only');
  assert.equal(paidDecision.requiresConfirmation, true);
  assert.equal(paidDecision.policyReason, 'paid_service_requires_confirmation');
  assert.equal(paidDecision.confirmationBypassed, false);
});

test('resolveDelegationPolicyMode normalizes trimmed and case-insensitive values', () => {
  assert.equal(resolveDelegationPolicyMode('  CoNfIrM_AlL  '), 'confirm_all');
});

test('resolveDelegationPolicyMode falls back for non-string policyMode', () => {
  assert.equal(resolveDelegationPolicyMode(null), 'confirm_all');
  assert.equal(resolveDelegationPolicyMode(123), 'confirm_all');
  assert.equal(resolveDelegationPolicyMode({ mode: 'confirm_all' }), 'confirm_all');
});

test('resolveDelegationPolicyMode falls back for unknown string policyMode', () => {
  assert.equal(resolveDelegationPolicyMode('confirm_never'), 'confirm_all');
});
