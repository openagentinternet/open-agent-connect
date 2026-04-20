import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

test('resolveMetabotPaths splits hot state and exports under .metabot', () => {
  assert.deepEqual(resolveMetabotPaths('/tmp/home'), {
    baseRoot: '/tmp/home/.metabot',
    hotRoot: '/tmp/home/.metabot/hot',
    exportRoot: '/tmp/home/.metabot/exports',
    runtimeDbPath: '/tmp/home/.metabot/hot/runtime.sqlite',
    runtimeStatePath: '/tmp/home/.metabot/hot/runtime-state.json',
    daemonStatePath: '/tmp/home/.metabot/hot/daemon.json',
    providerPresenceStatePath: '/tmp/home/.metabot/hot/provider-presence.json',
    ratingDetailStatePath: '/tmp/home/.metabot/hot/rating-detail.json',
    masterPendingAskStatePath: '/tmp/home/.metabot/hot/master-pending-asks.json',
    masterSuggestStatePath: '/tmp/home/.metabot/hot/master-suggest-state.json',
    secretsPath: '/tmp/home/.metabot/hot/secrets.json',
    configPath: '/tmp/home/.metabot/hot/config.json',
    evolutionRoot: '/tmp/home/.metabot/evolution',
    evolutionExecutionsRoot: '/tmp/home/.metabot/evolution/executions',
    evolutionAnalysesRoot: '/tmp/home/.metabot/evolution/analyses',
    evolutionArtifactsRoot: '/tmp/home/.metabot/evolution/artifacts',
    evolutionIndexPath: '/tmp/home/.metabot/evolution/index.json',
    evolutionRemoteRoot: '/tmp/home/.metabot/evolution/remote',
    evolutionRemoteArtifactsRoot: '/tmp/home/.metabot/evolution/remote/artifacts',
    evolutionRemoteIndexPath: '/tmp/home/.metabot/evolution/remote/index.json',
  });
});
