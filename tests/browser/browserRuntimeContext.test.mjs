import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { browserRuntimeToContextResult } = require('../../dist/core/browser/runtimeContext.js');

test('browserRuntimeToContextResult preserves the legacy using identity shape', () => {
  const context = browserRuntimeToContextResult({
    host: {
      kind: 'oac',
      name: 'Open Agent Connect',
      localMode: true,
    },
    actors: [
      {
        id: 'alice',
        label: 'Alice Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1alice',
        avatar: 'data:image/png;base64,alice',
        isDefault: true,
        capabilities: ['private-chat', 'service-call', 'template-settings'],
      },
      {
        id: 'bob',
        label: 'Bob Bot',
        kind: 'oac-bot',
        globalMetaId: 'idq1bob',
        isDefault: false,
        capabilities: ['private-chat'],
      },
    ],
    defaultActor: {
      id: 'alice',
      label: 'Alice Bot',
      kind: 'oac-bot',
      globalMetaId: 'idq1alice',
      avatar: 'data:image/png;base64,alice',
      isDefault: true,
      capabilities: ['private-chat', 'service-call', 'template-settings'],
    },
    defaultUri: 'metaid://idq1alice',
    features: {
      privateChat: true,
      serviceCall: true,
      cacheManagement: true,
      templateSettings: true,
      walletLogin: false,
    },
    labels: {
      actorChip: 'Using',
      noActorTitle: 'No Bot',
      noActorBody: 'Create a local Bot before using Browser actions.',
      noActorAction: {
        label: 'Create Bot',
        href: '/ui/bot',
      },
    },
  });

  assert.deepEqual(context, {
    usingIdentities: [
      {
        slug: 'alice',
        name: 'Alice Bot',
        globalMetaId: 'idq1alice',
        avatar: 'data:image/png;base64,alice',
        isDefault: true,
      },
      {
        slug: 'bob',
        name: 'Bob Bot',
        globalMetaId: 'idq1bob',
        isDefault: false,
      },
    ],
    defaultUsingIdentity: {
      slug: 'alice',
      name: 'Alice Bot',
      globalMetaId: 'idq1alice',
      avatar: 'data:image/png;base64,alice',
      isDefault: true,
    },
    defaultUri: 'metaid://idq1alice',
  });
});

test('browserRuntimeToContextResult includes pending OAC actors in legacy identities', () => {
  const pendingActor = {
    id: 'pending-bot',
    label: 'Pending Bot',
    kind: 'oac-bot',
    isDefault: true,
    capabilities: ['template-settings'],
  };

  const context = browserRuntimeToContextResult({
    host: {
      kind: 'oac',
      name: 'Open Agent Connect',
      localMode: true,
    },
    actors: [pendingActor],
    defaultActor: pendingActor,
    defaultUri: null,
    features: {
      privateChat: false,
      serviceCall: false,
      cacheManagement: false,
      templateSettings: true,
      walletLogin: false,
    },
    labels: {
      actorChip: 'Using',
      noActorTitle: 'No Bot',
      noActorBody: 'Create a local Bot before using Browser actions.',
      noActorAction: {
        label: 'Create Bot',
        href: '/ui/bot',
      },
    },
  });

  assert.deepEqual(context, {
    usingIdentities: [
      {
        slug: 'pending-bot',
        name: 'Pending Bot',
        globalMetaId: '',
        isDefault: true,
      },
    ],
    defaultUsingIdentity: null,
    defaultUri: null,
  });
});

test('browserRuntimeToContextResult excludes non-OAC actors from legacy identities', () => {
  const context = browserRuntimeToContextResult({
    host: {
      kind: 'standalone',
      name: 'Agent Internet Browser',
      localMode: false,
    },
    actors: [
      {
        id: 'wallet-1',
        label: 'Wallet User',
        kind: 'wallet',
        globalMetaId: 'idq1walletuser',
        address: '18WalletUser',
        isDefault: true,
        capabilities: ['wallet-sign'],
      },
      {
        id: 'idbots-agent-1',
        label: 'IDBots Agent',
        kind: 'idbots-agent',
        globalMetaId: 'idq1idbotsagent',
        isDefault: false,
        capabilities: ['private-chat'],
      },
    ],
    defaultActor: {
      id: 'wallet-1',
      label: 'Wallet User',
      kind: 'wallet',
      globalMetaId: 'idq1walletuser',
      address: '18WalletUser',
      isDefault: true,
      capabilities: ['wallet-sign'],
    },
    defaultUri: null,
    features: {
      privateChat: false,
      serviceCall: false,
      cacheManagement: false,
      templateSettings: false,
      walletLogin: true,
    },
    labels: {
      actorChip: 'Wallet',
      noActorTitle: 'Sign in',
      noActorBody: 'Sign in with a wallet to use Browser actions.',
    },
  });

  assert.deepEqual(context, {
    usingIdentities: [],
    defaultUsingIdentity: null,
    defaultUri: null,
  });
});
