import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  buildRemoteServicesPrompt,
  parseDelegationMessage,
  planRemoteCall,
} = require('../../dist/core/delegation/remoteCall.js');

function createAvailableService(overrides = {}) {
  return {
    servicePinId: 'service-weather',
    providerGlobalMetaId: 'seller-global-metaid',
    serviceName: 'Weather Oracle',
    displayName: 'Weather Oracle',
    description: 'Provides weather predictions.',
    price: '0.0001',
    currency: 'SPACE',
    ratingAvg: 4.8,
    ratingCount: 12,
    ...overrides,
  };
}

test('planRemoteCall allows payment when the service price is under the spend cap', () => {
  const result = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
      rawRequest: '帮我看看明天上海天气',
      spendCap: {
        amount: '0.0002',
        currency: 'SPACE',
      },
    },
    availableServices: [createAvailableService()],
  });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'ready');
  assert.equal(result.service.servicePinId, 'service-weather');
  assert.equal(result.payment.amount, '0.0001');
  assert.equal(result.payment.currency, 'SPACE');
  assert.equal(result.confirmation.requiresConfirmation, true);
  assert.equal(result.confirmation.policyMode, 'confirm_all');
});

test('planRemoteCall blocks payment before broadcast when the service price exceeds the spend cap', () => {
  const result = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
      spendCap: {
        amount: '0.00001',
        currency: 'SPACE',
      },
    },
    availableServices: [createAvailableService()],
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'blocked');
  assert.equal(result.code, 'spend_cap_exceeded');
  assert.match(result.message, /spend cap/i);
});

test('planRemoteCall rejects unpriced services instead of treating them as free', () => {
  const result = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
      policyMode: 'confirm_paid_only',
    },
    availableServices: [createAvailableService({ price: '' })],
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'blocked');
  assert.equal(result.code, 'invalid_price');
  assert.equal(result.confirmation.requiresConfirmation, true);
});

test('planRemoteCall returns offline when the requested remote service is not available', () => {
  const result = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
    },
    availableServices: [
      createAvailableService({
        servicePinId: 'other-service',
      }),
    ],
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'offline');
  assert.equal(result.code, 'service_offline');
});

test('planRemoteCall returns a trace id and confirmation metadata for successful calls', () => {
  const result = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
    },
    availableServices: [createAvailableService()],
    traceId: 'trace-weather-order-1',
  });

  assert.equal(result.ok, true);
  assert.equal(result.traceId, 'trace-weather-order-1');
  assert.equal(result.confirmation.requiresConfirmation, true);
  assert.equal(result.confirmation.policyReason, 'confirm_all_requires_confirmation');
});

test('planRemoteCall generates a unique trace id for each new remote call when none is supplied', () => {
  const first = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
    },
    availableServices: [createAvailableService()],
  });
  const second = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather again',
      taskContext: 'Shanghai tomorrow weather',
    },
    availableServices: [createAvailableService()],
  });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.traceId, second.traceId);
  assert.match(first.traceId, /^trace-seller-global-me-service-weather-[a-z0-9]+-[a-z0-9]+$/);
  assert.match(second.traceId, /^trace-seller-global-me-service-weather-[a-z0-9]+-[a-z0-9]+$/);
});

test('planRemoteCall surfaces manual_action_required when refund follow-up must be handled by a human', () => {
  const result = planRemoteCall({
    request: {
      servicePinId: 'service-weather',
      providerGlobalMetaId: 'seller-global-metaid',
      userTask: 'check tomorrow weather',
      taskContext: 'Shanghai tomorrow weather',
    },
    availableServices: [createAvailableService()],
    traceId: 'trace-weather-order-1',
    manualRefundRequired: true,
  });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'manual_action_required');
  assert.equal(result.code, 'manual_refund_required');
  assert.equal(result.traceId, 'trace-weather-order-1');
  assert.equal(result.confirmation.policyMode, 'confirm_all');
});

test('remote service prompt supports natural-language selection and free-service auto delegation policy', () => {
  const prompt = buildRemoteServicesPrompt([
    createAvailableService({
      servicePinId: 'tarot-service',
      serviceName: 'tarot-reading',
      displayName: '塔罗牌占卜',
      description: '为明天运程提供塔罗牌占卜。',
      price: '0',
      providerName: 'TarotBot',
      updatedAt: 1_775_000_000_000,
    }),
  ]);

  assert.match(prompt, /locally cached online remote on-chain services/);
  assert.match(prompt, /rating average|rating/i);
  assert.match(prompt, /policyMode "confirm_paid_only"/);
  assert.match(prompt, /<provider_name>TarotBot<\/provider_name>/);
  assert.match(prompt, /<updated_at>1775000000000<\/updated_at>/);

  const parsed = parseDelegationMessage(`[DELEGATE_REMOTE_SERVICE] {"servicePinId":"tarot-service","serviceName":"塔罗牌占卜","providerGlobalMetaid":"seller-global-metaid","price":"0","currency":"SPACE","rawRequest":"我想用塔罗牌占卜一下明天运程","userTask":"tarot tomorrow fortune","taskContext":"free tarot service match","policyMode":"confirm_paid_only"}`);
  assert.equal(parsed.policyMode, 'confirm_paid_only');
  assert.equal(parsed.rawRequest, '我想用塔罗牌占卜一下明天运程');
});
