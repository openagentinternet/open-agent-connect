import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildPublishPageViewModel } = require('../../dist/ui/pages/publish/viewModel.js');
const { buildMyServicesPageViewModel } = require('../../dist/ui/pages/my-services/viewModel.js');

test('buildPublishPageViewModel shows the local provider identity that will publish the service', () => {
  const model = buildPublishPageViewModel({
    providerSummary: {
      identity: {
        name: 'Alice Weather Bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
        mvcAddress: '1AliceWeatherProviderAddress11111111111111',
      },
    },
  });

  assert.equal(model.providerCard.title, 'Provider Identity');
  assert.match(model.providerCard.summary, /current chain identity/i);
  assert.deepEqual(model.providerCard.rows, [
    { label: 'Provider Name', value: 'Alice Weather Bot' },
    {
      label: 'Provider GlobalMetaId',
      value: 'idq1aliceweatherprovider000000000000000000000000000000',
    },
    {
      label: 'Payment Address',
      value: '1AliceWeatherProviderAddress11111111111111',
    },
  ]);
});

test('buildPublishPageViewModel exposes primary runtime catalog availability for publishing', () => {
  const model = buildPublishPageViewModel({
    providerSummary: {
      identity: {
        name: 'Alice Weather Bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
        mvcAddress: '1AliceWeatherProviderAddress11111111111111',
      },
    },
    publishSkills: {
      metaBotSlug: 'alice-weather-bot',
      identity: {
        name: 'Alice Weather Bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
      },
      runtime: {
        id: 'runtime-codex',
        provider: 'codex',
        displayName: 'Codex',
        health: 'healthy',
        version: '0.2.7',
      },
      platform: {
        id: 'codex',
        displayName: 'Codex',
      },
      skills: [
        {
          skillName: 'metabot-weather-oracle',
          title: 'Weather Oracle',
          description: 'Returns one concise forecast.',
        },
      ],
      rootDiagnostics: [
        {
          rootId: 'codex-home',
          status: 'readable',
          absolutePath: '/tmp/alice/.codex/skills',
        },
      ],
    },
  });

  assert.deepEqual(model.providerCard.rows, [
    { label: 'Provider Name', value: 'Alice Weather Bot' },
    { label: 'MetaBot Slug', value: 'alice-weather-bot' },
    {
      label: 'Provider GlobalMetaId',
      value: 'idq1aliceweatherprovider000000000000000000000000000000',
    },
    {
      label: 'Payment Address',
      value: '1AliceWeatherProviderAddress11111111111111',
    },
  ]);
  assert.equal(model.runtimeCard.title, 'Primary Runtime');
  assert.match(model.runtimeCard.summary, /healthy primary runtime/i);
  assert.deepEqual(model.runtimeCard.rows, [
    { label: 'Runtime', value: 'Codex' },
    { label: 'Provider', value: 'codex' },
    { label: 'Health', value: 'healthy' },
    { label: 'Version', value: '0.2.7' },
    { label: 'Readable Roots', value: '1 / 1' },
  ]);
  assert.deepEqual(model.skills, [
    {
      value: 'metabot-weather-oracle',
      label: 'metabot-weather-oracle',
      title: 'Weather Oracle',
      description: 'Returns one concise forecast.',
    },
  ]);
  assert.deepEqual(model.availability, {
    canPublish: true,
    reasonCode: 'ready',
    message: 'Ready to publish with the selected primary runtime skill.',
  });
});

test('buildPublishPageViewModel disables publishing when primary runtime or skill roots are unavailable', () => {
  const missingRuntime = buildPublishPageViewModel({
    providerSummary: {
      identity: {
        name: 'Alice Weather Bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
      },
    },
    publishSkillsError: {
      code: 'primary_runtime_missing',
      message: 'The selected MetaBot has no enabled primary runtime binding.',
    },
  });

  assert.equal(missingRuntime.availability.canPublish, false);
  assert.equal(missingRuntime.availability.reasonCode, 'primary_runtime_missing');
  assert.match(missingRuntime.runtimeCard.summary, /no enabled primary runtime/i);

  const unreadableRoots = buildPublishPageViewModel({
    providerSummary: {
      identity: {
        name: 'Alice Weather Bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
      },
    },
    publishSkills: {
      metaBotSlug: 'alice-weather-bot',
      runtime: {
        id: 'runtime-codex',
        provider: 'codex',
        displayName: 'Codex',
        health: 'healthy',
      },
      platform: {
        id: 'codex',
        displayName: 'Codex',
      },
      skills: [],
      rootDiagnostics: [
        {
          rootId: 'codex-home',
          status: 'missing',
          absolutePath: '/tmp/alice/.codex/skills',
        },
      ],
    },
  });

  assert.equal(unreadableRoots.availability.canPublish, false);
  assert.equal(unreadableRoots.availability.reasonCode, 'primary_skill_roots_unreadable');
  assert.match(unreadableRoots.availability.message, /No readable primary runtime skill roots/i);
});

test('buildPublishPageViewModel shows the publish result with the real chain pin, price, and output type', () => {
  const model = buildPublishPageViewModel({
    publishResult: {
      servicePinId: 'service-pin-weather-1',
      sourceServicePinId: 'source-pin-weather-1',
      price: '0.00001',
      currency: 'SPACE',
      outputType: 'text',
      path: '/protocols/skill-service',
    },
  });

  assert.equal(model.resultCard.hasResult, true);
  assert.match(model.resultCard.summary, /real chain pin/i);
  assert.deepEqual(model.resultCard.rows, [
    { label: 'Service Pin ID', value: 'service-pin-weather-1' },
    { label: 'Source Pin ID', value: 'source-pin-weather-1' },
    { label: 'Price', value: '0.00001 SPACE' },
    { label: 'Output Type', value: 'text' },
    { label: 'Path', value: '/protocols/skill-service' },
  ]);
});

test('buildMyServicesPageViewModel renders provider presence, current services, and chain publish metadata', () => {
  const model = buildMyServicesPageViewModel({
    providerSummary: {
      identity: {
        name: 'Provider Bot',
        globalMetaId: 'idq1provider000000000000000000000000000000000000',
      },
      presence: {
        enabled: true,
        lastHeartbeatAt: 1775000030000,
        lastHeartbeatPinId: '/protocols/metabot-heartbeat-pin-1',
      },
      services: [
        {
          servicePinId: '/protocols/skill-service-pin-1',
          sourceServicePinId: '/protocols/skill-service-pin-1',
          serviceName: 'tarot-rws-service',
          displayName: 'Tarot Reading',
          price: '0.00001',
          currency: 'SPACE',
          available: true,
          updatedAt: 1775000010000,
        },
      ],
      totals: {
        serviceCount: 1,
        activeServiceCount: 1,
        sellerOrderCount: 0,
        manualActionCount: 0,
      },
    },
  });

  assert.equal(model.presenceCard.title, 'Provider Presence');
  assert.equal(model.presenceCard.statusLabel, 'Online');
  assert.equal(model.presenceCard.actionLabel, 'Go offline');
  assert.deepEqual(model.presenceCard.rows, [
    { label: 'Provider', value: 'Provider Bot' },
    {
      label: 'GlobalMetaId',
      value: 'idq1provider000000000000000000000000000000000000',
    },
    { label: 'Last Heartbeat', value: '1775000030000' },
    { label: 'Heartbeat Pin', value: '/protocols/metabot-heartbeat-pin-1' },
    { label: 'Active Services', value: '1 / 1' },
  ]);

  assert.equal(model.serviceInventory.length, 1);
  assert.deepEqual(model.serviceInventory[0], {
    key: '/protocols/skill-service-pin-1',
    displayName: 'Tarot Reading',
    serviceName: 'tarot-rws-service',
    availabilityLabel: 'Available',
    priceLabel: '0.00001 SPACE',
    servicePinId: '/protocols/skill-service-pin-1',
    lastPublishAt: '1775000010000',
  });
});

test('buildMyServicesPageViewModel renders recent seller orders with trace linkage and manual refund state', () => {
  const model = buildMyServicesPageViewModel({
    providerSummary: {
      recentOrders: [
        {
          traceId: 'trace-provider-refund',
          orderId: 'order-refund-1',
          servicePinId: '/protocols/skill-service-pin-1',
          serviceName: 'Tarot Reading',
          buyerGlobalMetaId: 'idq1buyer0000000000000000000000000000000000000',
          buyerName: 'Buyer Bot',
          publicStatus: 'manual_action_required',
          state: 'refund_pending',
          ratingStatus: 'requested_unrated',
          ratingValue: null,
          ratingComment: null,
          ratingPinId: null,
          ratingCreatedAt: null,
          createdAt: 1775000020000,
        },
        {
          traceId: 'trace-provider-rated',
          orderId: 'order-rated-1',
          servicePinId: '/protocols/skill-service-pin-2',
          serviceName: 'Tarot Reading',
          buyerGlobalMetaId: 'idq1buyer1111111111111111111111111111111111111',
          buyerName: 'Buyer Rated',
          publicStatus: 'completed',
          ratingStatus: 'rated_on_chain',
          ratingValue: 4,
          ratingComment: '解释得很清楚。',
          ratingPinId: 'rating-pin-1',
          ratingCreatedAt: 1775000030000,
          createdAt: 1775000025000,
        },
        {
          traceId: 'trace-provider-unconfirmed',
          orderId: 'order-rated-2',
          servicePinId: '/protocols/skill-service-pin-3',
          serviceName: 'Tarot Reading',
          buyerGlobalMetaId: 'idq1buyer2222222222222222222222222222222222222',
          buyerName: 'Buyer Unconfirmed',
          publicStatus: 'completed',
          ratingStatus: 'rated_on_chain_followup_unconfirmed',
          ratingValue: 5,
          ratingComment: '闭环完整，回复及时。',
          ratingPinId: 'rating-pin-2',
          ratingCreatedAt: 1775000040000,
          createdAt: 1775000026000,
        },
        {
          traceId: 'trace-provider-sync-error',
          orderId: 'order-rated-3',
          servicePinId: '/protocols/skill-service-pin-4',
          serviceName: 'Tarot Reading',
          buyerGlobalMetaId: 'idq1buyer3333333333333333333333333333333333333',
          buyerName: 'Buyer Sync Error',
          publicStatus: 'completed',
          ratingStatus: 'sync_error',
          ratingValue: null,
          ratingComment: null,
          ratingPinId: null,
          ratingCreatedAt: null,
          createdAt: 1775000027000,
        },
      ],
      manualActions: [
        {
          kind: 'refund',
          traceId: 'trace-provider-refund',
          orderId: 'order-refund-1',
          refundRequestPinId: 'refund-pin-1',
          sessionId: 'seller-session-1',
        },
      ],
    },
  });

  assert.equal(model.recentOrders.length, 4);
  assert.deepEqual(model.recentOrders[0], {
    key: 'order-refund-1',
    serviceName: 'Tarot Reading',
    buyerLabel: 'Buyer Bot · idq1buyer0000000000000000000000000000000000000',
    stateLabel: 'Refund pending · 未评价',
    statusDetail: 'manual_action_required',
    traceHref: '/ui/trace?traceId=trace-provider-refund',
    traceLabel: 'trace-provider-refund',
    createdAt: '1775000020000',
    requiresManualRefund: true,
    ratingCommentPreview: '',
    ratingPinId: '',
  });

  assert.deepEqual(model.recentOrders[1], {
    key: 'order-rated-1',
    serviceName: 'Tarot Reading',
    buyerLabel: 'Buyer Rated · idq1buyer1111111111111111111111111111111111111',
    stateLabel: '已评价 · 4/5',
    statusDetail: 'completed',
    traceHref: '/ui/trace?traceId=trace-provider-rated',
    traceLabel: 'trace-provider-rated',
    createdAt: '1775000025000',
    requiresManualRefund: false,
    ratingCommentPreview: '解释得很清楚。',
    ratingPinId: 'rating-pin-1',
  });

  assert.deepEqual(model.recentOrders[2], {
    key: 'order-rated-2',
    serviceName: 'Tarot Reading',
    buyerLabel: 'Buyer Unconfirmed · idq1buyer2222222222222222222222222222222222222',
    stateLabel: '已评价 · 5/5 · 回传未确认',
    statusDetail: 'completed',
    traceHref: '/ui/trace?traceId=trace-provider-unconfirmed',
    traceLabel: 'trace-provider-unconfirmed',
    createdAt: '1775000026000',
    requiresManualRefund: false,
    ratingCommentPreview: '闭环完整，回复及时。',
    ratingPinId: 'rating-pin-2',
  });

  assert.deepEqual(model.recentOrders[3], {
    key: 'order-rated-3',
    serviceName: 'Tarot Reading',
    buyerLabel: 'Buyer Sync Error · idq1buyer3333333333333333333333333333333333333',
    stateLabel: '评分同步异常',
    statusDetail: 'completed',
    traceHref: '/ui/trace?traceId=trace-provider-sync-error',
    traceLabel: 'trace-provider-sync-error',
    createdAt: '1775000027000',
    requiresManualRefund: false,
    ratingCommentPreview: '',
    ratingPinId: '',
  });

  assert.equal(model.manualActions.length, 1);
  assert.deepEqual(model.manualActions[0], {
    key: 'order-refund-1',
    kindLabel: 'Refund confirmation',
    orderId: 'order-refund-1',
    refundRequestPinId: 'refund-pin-1',
    refundHref: '/ui/refund?orderId=order-refund-1',
    traceHref: '/ui/trace?traceId=trace-provider-refund',
  });
});
