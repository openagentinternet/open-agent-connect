import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildPublishPageViewModel } = require('../../dist/ui/pages/publish/viewModel.js');
const {
  buildMyServicesPageViewModel,
  buildMyServicesPageViewModelRuntimeSource,
} = require('../../dist/ui/pages/my-services/viewModel.js');

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
    profiles: [
      {
        name: 'Alice Weather Bot',
        slug: 'alice-weather-bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
        mvcAddress: '1AliceWeatherProviderAddress11111111111111',
        primaryProvider: 'codex',
      },
      {
        name: 'Local Draft Bot',
        slug: 'local-draft-bot',
        primaryProvider: null,
      },
      {
        name: 'Unavailable Bot',
        slug: 'unavailable-bot',
        primaryProvider: 'claude-code',
      },
    ],
    runtimes: [
      {
        id: 'runtime-codex',
        provider: 'codex',
        displayName: 'Codex',
        health: 'healthy',
      },
      {
        id: 'runtime-claude',
        provider: 'claude-code',
        displayName: 'Claude Code',
        health: 'unavailable',
      },
    ],
    selectedMetaBotSlug: 'alice-weather-bot',
    providerSummary: {
      identity: {
        name: 'Current Default Bot',
        globalMetaId: 'idq1currentdefaultprovider00000000000000000000000000',
        mvcAddress: '1CurrentDefaultProviderAddress111111111111',
      },
    },
    publishSkills: {
      metaBotSlug: 'alice-weather-bot',
      identity: {
        name: 'Alice Weather Bot',
        globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
        mvcAddress: '1AliceWeatherProviderAddress11111111111111',
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
  assert.deepEqual(model.metabots, [
    {
      value: 'alice-weather-bot',
      label: 'Alice Weather Bot',
      title: 'Alice Weather Bot',
      description: 'Primary runtime: codex',
      globalMetaId: 'idq1aliceweatherprovider000000000000000000000000000000',
      primaryProvider: 'codex',
    },
  ]);
  assert.equal(model.selectedMetaBotSlug, 'alice-weather-bot');
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

test('buildPublishPageViewModel keeps publish results out of the side-card model', () => {
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

  assert.equal(model.resultCard, undefined);
});

test('buildMyServicesPageViewModel renders IDBots-style local service rows with metrics and actions', () => {
  const model = buildMyServicesPageViewModel({
    servicesPage: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: 'service-current-pin-1',
          currentPinId: 'service-current-pin-1',
          sourceServicePinId: 'service-source-pin-1',
          chainPinIds: ['service-source-pin-1', 'service-current-pin-1'],
          serviceName: 'weather-oracle',
          displayName: 'Weather Oracle',
          description: 'Returns a concise forecast.',
          price: '0.00004',
          currency: 'BTC-OPCAT',
          providerSkill: 'metabot-weather-oracle',
          outputType: 'text',
          creatorMetabotName: 'Alice Bot',
          creatorMetabotSlug: 'alice-bot',
          updatedAt: 1775000010000,
          successCount: 3,
          refundCount: 1,
          grossRevenue: '0.00016',
          netIncome: '0.00012',
          ratingAvg: 4.5,
          ratingCount: 2,
          canModify: true,
          canRevoke: true,
        },
      ],
    },
  });

  assert.equal(model.services.length, 1);
  assert.deepEqual(model.services[0], {
    key: 'service-current-pin-1',
    id: 'service-current-pin-1',
    currentPinId: 'service-current-pin-1',
    sourceServicePinId: 'service-source-pin-1',
    title: 'Weather Oracle',
    serviceName: 'weather-oracle',
    description: 'Returns a concise forecast.',
    iconUri: '',
    iconLabel: 'WO',
    skillLabel: 'metabot-weather-oracle',
    outputTypeLabel: 'text',
    priceLabel: '0.00004 BTC-OPCAT',
    creatorLabel: 'Alice Bot · alice-bot',
    updatedAtLabel: '1775000010000',
    metrics: [
      { label: 'Success', value: '3' },
      { label: 'Refunded', value: '1' },
      { label: 'Gross', value: '0.00016 BTC-OPCAT' },
      { label: 'Net', value: '0.00012 BTC-OPCAT' },
      { label: 'Rating', value: '4.5 / 5 · 2' },
    ],
    canModify: true,
    canRevoke: true,
    blockedReason: '',
  });
  assert.equal(model.pageLabel, '1 / 1 · 1 services');
  assert.equal(model.emptyState.title, 'No published services');
});

test('buildMyServicesPageViewModel renders selected service details, closed orders, and edit defaults', () => {
  const model = buildMyServicesPageViewModel({
    selectedServiceId: 'service-current-pin-1',
    servicesPage: {
      page: 1,
      pageSize: 20,
      total: 1,
      totalPages: 1,
      items: [
        {
          id: 'service-current-pin-1',
          currentPinId: 'service-current-pin-1',
          sourceServicePinId: 'service-source-pin-1',
          serviceName: 'weather-oracle',
          displayName: 'Weather Oracle',
          description: 'Returns a concise forecast.',
          serviceIcon: 'metafile://cover-pin',
          price: '0.00004',
          currency: 'BTC',
          providerSkill: 'metabot-weather-oracle',
          outputType: 'image',
          creatorMetabotName: 'Alice Bot',
          creatorMetabotSlug: 'alice-bot',
          updatedAt: 1775000010000,
          successCount: 1,
          refundCount: 1,
          grossRevenue: '0.00008',
          netIncome: '0.00004',
          ratingAvg: 5,
          ratingCount: 1,
          canModify: true,
          canRevoke: true,
        },
      ],
    },
    ordersPage: {
      page: 1,
      pageSize: 10,
      total: 2,
      totalPages: 1,
      items: [
        {
          id: 'order-refunded',
          status: 'refunded',
          traceId: 'trace-refunded',
          paymentTxid: 'payment-refunded',
          orderMessageTxid: 'order-message-refunded',
          paymentAmount: '0.00004',
          paymentCurrency: 'BTC',
          createdAt: 1775000020000,
          deliveredAt: null,
          refundCompletedAt: 1775000040000,
          counterpartyGlobalMetaid: 'idq1buyerrefund',
          coworkSessionId: 'session-refunded',
          runtimeId: 'runtime-codex',
          runtimeProvider: 'codex',
          llmSessionId: 'llm-refunded',
          rating: null,
        },
        {
          id: 'order-completed',
          status: 'completed',
          traceId: 'trace-completed',
          paymentTxid: 'payment-completed',
          orderMessageTxid: 'order-message-completed',
          paymentAmount: '0.00004',
          paymentCurrency: 'BTC',
          createdAt: 1775000020000,
          deliveredAt: 1775000030000,
          refundCompletedAt: null,
          counterpartyGlobalMetaid: 'idq1buyercomplete',
          coworkSessionId: 'session-completed',
          runtimeId: 'runtime-codex',
          runtimeProvider: 'codex',
          llmSessionId: 'llm-completed',
          rating: {
            pinId: 'rating-pin-1',
            rate: 5,
            comment: 'Excellent.',
            createdAt: 1775000050000,
            raterGlobalMetaId: 'idq1buyercomplete',
            raterMetaId: 'metaid-buyer',
          },
        },
      ],
    },
  });

  assert.equal(model.selectedService.title, 'Weather Oracle');
  assert.deepEqual(model.editForm, {
    serviceId: 'service-current-pin-1',
    displayName: 'Weather Oracle',
    serviceName: 'weather-oracle',
    description: 'Returns a concise forecast.',
    providerSkill: 'metabot-weather-oracle',
    outputType: 'image',
    price: '0.00004',
    currency: 'BTC',
    serviceIconUri: 'metafile://cover-pin',
  });
  assert.deepEqual(model.orders.map((order) => ({
    key: order.key,
    statusLabel: order.statusLabel,
    paymentLabel: order.paymentLabel,
    ratingLabel: order.ratingLabel,
    traceHref: order.traceHref,
  })), [
    {
      key: 'order-refunded',
      statusLabel: 'Refunded',
      paymentLabel: '0.00004 BTC · payment-refunded',
      ratingLabel: 'No rating',
      traceHref: '/ui/trace?traceId=trace-refunded',
    },
    {
      key: 'order-completed',
      statusLabel: 'Completed',
      paymentLabel: '0.00004 BTC · payment-completed',
      ratingLabel: '5 / 5',
      traceHref: '/ui/trace?traceId=trace-completed',
    },
  ]);
  assert.equal(model.orders[1].ratingComment, 'Excellent.');
  assert.equal(model.orderPageLabel, '1 / 1 · 2 orders');
});

test('buildMyServicesPageViewModel exposes mutation txid notices and deterministic error state', () => {
  const success = buildMyServicesPageViewModel({
    mutationResult: {
      operation: 'modify',
      txids: ['modify-txid-1'],
      pinId: 'modify-pin-1',
    },
  });
  assert.deepEqual(success.notice, {
    tone: 'success',
    title: 'Modify broadcast',
    message: 'Local state has been updated after the chain write.',
    txids: ['modify-txid-1'],
    pinId: 'modify-pin-1',
  });

  const failed = buildMyServicesPageViewModel({
    error: {
      message: 'network offline',
    },
  });
  assert.deepEqual(failed.notice, {
    tone: 'error',
    title: 'My Services error',
    message: 'network offline',
    txids: [],
    pinId: '',
  });
});

test('buildMyServicesPageViewModelRuntimeSource executes with helper functions in browser-like context', () => {
  const context = {
    input: {
      servicesPage: {
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
        items: [
          {
            id: 'service-pin-runtime-source',
            currentPinId: 'service-pin-runtime-source',
            serviceName: 'weather-runtime',
            displayName: 'Weather Runtime',
            price: '0.00001',
            currency: 'SPACE',
            providerSkill: 'metabot-weather-oracle',
            outputType: 'text',
            creatorMetabotName: 'Runtime Bot',
            creatorMetabotSlug: 'runtime-bot',
            updatedAt: 1_775_000_010_000,
            successCount: 1,
            refundCount: 0,
            grossRevenue: '0.00001',
            netIncome: '0.00001',
            ratingAvg: 0,
            ratingCount: 0,
            canModify: true,
            canRevoke: true,
          },
        ],
      },
      ordersPage: {
        page: 1,
        pageSize: 10,
        total: 1,
        totalPages: 1,
        items: [
          {
            id: 'order-runtime-source',
            status: 'completed',
            traceId: 'trace-runtime-source',
            paymentTxid: 'payment-runtime-source',
            paymentAmount: '0.00001',
            paymentCurrency: 'SPACE',
            counterpartyGlobalMetaid: 'idq1buyerruntime',
            runtimeProvider: 'codex',
            runtimeId: 'runtime-codex',
            llmSessionId: 'llm-session-runtime',
            createdAt: 1_775_000_020_000,
            deliveredAt: 1_775_000_030_000,
            rating: null,
          },
        ],
      },
    },
    result: null,
  };
  vm.createContext(context);
  vm.runInContext(
    `${buildMyServicesPageViewModelRuntimeSource()}\nresult = buildMyServicesPageViewModel(input);`,
    context,
  );

  assert.equal(context.result.services.length, 1);
  assert.equal(context.result.services[0].title, 'Weather Runtime');
  assert.equal(context.result.orders.length, 1);
  assert.equal(context.result.orders[0].paymentLabel, '0.00001 SPACE · payment-runtime-source');
  assert.equal(context.result.orders[0].runtimeLabel, 'codex · runtime-codex · llm-session-runtime');
});
