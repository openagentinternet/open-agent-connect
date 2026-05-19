import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  projectLoomDashboardBotIdentity,
  resolveLoomDashboardIdentityProfile,
} = require('../../dist/core/loom/index.js');

function author(overrides = {}) {
  return {
    globalMetaId: 'developer-global-metaid-abcdef',
    creatorAddress: '1DeveloperAddress',
    ...overrides,
  };
}

test('projects requester identity with supplied name and avatar', () => {
  const identity = projectLoomDashboardBotIdentity({
    role: 'requester',
    author: author({ globalMetaId: 'requester-global', creatorAddress: '1RequesterAddress' }),
    profile: {
      displayName: 'Requester Bot',
      avatarUri: 'metafile://requester-avatar',
    },
  });

  assert.equal(identity.role, 'requester');
  assert.equal(identity.globalMetaId, 'requester-global');
  assert.equal(identity.address, '1RequesterAddress');
  assert.equal(identity.displayName, 'Requester Bot');
  assert.equal(identity.avatarUri, 'metafile://requester-avatar');
  assert.equal(identity.initials, 'RB');
});

test('projects stable fallback identity when profile and avatar are missing', () => {
  const first = projectLoomDashboardBotIdentity({
    role: 'developer',
    author: author({ globalMetaId: 'developer-global-metaid-abcdef', creatorAddress: '1DeveloperAddress' }),
  });
  const second = projectLoomDashboardBotIdentity({
    role: 'developer',
    author: author({ globalMetaId: 'developer-global-metaid-abcdef', creatorAddress: '1DeveloperAddress' }),
  });

  assert.equal(first.displayName, second.displayName);
  assert.equal(first.fallbackLabel, second.fallbackLabel);
  assert.equal(first.avatarUri, undefined);
  assert.equal(first.globalMetaId, 'developer-global-metaid-abcdef');
  assert.equal(first.address, '1DeveloperAddress');
  assert.ok(first.displayName.includes('...'));
  assert.match(first.initials, /^[A-Z0-9]{1,2}$/);
});

test('resolves identity profiles by globalMetaId before address', () => {
  const profile = resolveLoomDashboardIdentityProfile(
    author({ globalMetaId: 'developer-global', creatorAddress: '1DeveloperAddress' }),
    {
      '1DeveloperAddress': { displayName: 'Address Profile' },
      'developer-global': { displayName: 'Global Profile', avatarUri: 'metafile://global-avatar' },
    },
  );

  assert.deepEqual(profile, {
    displayName: 'Global Profile',
    avatarUri: 'metafile://global-avatar',
  });
});
