import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { resolveMetabotPaths } = require('../../dist/core/state/paths.js');

test('resolveMetabotPaths returns the v2 manager and runtime graph for a profile home', () => {
  const paths = resolveMetabotPaths('/tmp/system-home/.metabot/profiles/charles-zhang');
  assert.deepEqual(
    {
      systemHomeDir: paths.systemHomeDir,
      metabotRoot: paths.metabotRoot,
      managerRoot: paths.managerRoot,
      skillsRoot: paths.skillsRoot,
      globalServicesRoot: paths.globalServicesRoot,
      onlineServicesCachePath: paths.onlineServicesCachePath,
      profilesRoot: paths.profilesRoot,
      profileRoot: paths.profileRoot,
      workspaceRoot: paths.workspaceRoot,
      runtimeRoot: paths.runtimeRoot,
      a2aRoot: paths.a2aRoot,
      sessionsRoot: paths.sessionsRoot,
      exportsRoot: paths.exportsRoot,
      stateRoot: paths.stateRoot,
      locksRoot: paths.locksRoot,
      evolutionRoot: paths.evolutionRoot,
      evolutionExecutionsRoot: paths.evolutionExecutionsRoot,
      evolutionAnalysesRoot: paths.evolutionAnalysesRoot,
      evolutionArtifactsRoot: paths.evolutionArtifactsRoot,
      evolutionIndexPath: paths.evolutionIndexPath,
      evolutionRemoteRoot: paths.evolutionRemoteRoot,
      evolutionRemoteArtifactsRoot: paths.evolutionRemoteArtifactsRoot,
      evolutionRemoteIndexPath: paths.evolutionRemoteIndexPath,
      identityProfilesPath: paths.identityProfilesPath,
      activeHomePath: paths.activeHomePath,
      configPath: paths.configPath,
      identitySecretsPath: paths.identitySecretsPath,
      providerSecretsPath: paths.providerSecretsPath,
      runtimeStatePath: paths.runtimeStatePath,
      daemonStatePath: paths.daemonStatePath,
      runtimeDbPath: paths.runtimeDbPath,
      sessionStatePath: paths.sessionStatePath,
      providerPresenceStatePath: paths.providerPresenceStatePath,
      ratingDetailStatePath: paths.ratingDetailStatePath,
      masterPendingAskStatePath: paths.masterPendingAskStatePath,
      masterSuggestStatePath: paths.masterSuggestStatePath,
      masterAutoFeedbackStatePath: paths.masterAutoFeedbackStatePath,
      masterPublishedStatePath: paths.masterPublishedStatePath,
      directorySeedsPath: paths.directorySeedsPath,
      daemonLockPath: paths.daemonLockPath,
    },
    {
      systemHomeDir: '/tmp/system-home',
      metabotRoot: '/tmp/system-home/.metabot',
      managerRoot: '/tmp/system-home/.metabot/manager',
      skillsRoot: '/tmp/system-home/.metabot/skills',
      globalServicesRoot: '/tmp/system-home/.metabot/services',
      onlineServicesCachePath: '/tmp/system-home/.metabot/services/services.json',
      profilesRoot: '/tmp/system-home/.metabot/profiles',
      profileRoot: '/tmp/system-home/.metabot/profiles/charles-zhang',
      workspaceRoot: '/tmp/system-home/.metabot/profiles/charles-zhang',
      runtimeRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime',
      a2aRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/A2A',
      sessionsRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/sessions',
      exportsRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/exports',
      stateRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state',
      locksRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/locks',
      evolutionRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution',
      evolutionExecutionsRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/executions',
      evolutionAnalysesRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/analyses',
      evolutionArtifactsRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/artifacts',
      evolutionIndexPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/index.json',
      evolutionRemoteRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/remote',
      evolutionRemoteArtifactsRoot: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/remote/artifacts',
      evolutionRemoteIndexPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/evolution/remote/index.json',
      identityProfilesPath: '/tmp/system-home/.metabot/manager/identity-profiles.json',
      activeHomePath: '/tmp/system-home/.metabot/manager/active-home.json',
      configPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/config.json',
      identitySecretsPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/identity-secrets.json',
      providerSecretsPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/provider-secrets.json',
      runtimeStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/runtime-state.json',
      daemonStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/daemon.json',
      runtimeDbPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/runtime.sqlite',
      sessionStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/sessions/a2a-session-state.json',
      providerPresenceStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/provider-presence.json',
      ratingDetailStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/rating-detail.json',
      masterPendingAskStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/master-pending-asks.json',
      masterSuggestStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/master-suggest-state.json',
      masterAutoFeedbackStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/master-auto-feedback-state.json',
      masterPublishedStatePath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/master-service-state.json',
      directorySeedsPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/state/directory-seeds.json',
      daemonLockPath: '/tmp/system-home/.metabot/profiles/charles-zhang/.runtime/locks/daemon.lock',
    }
  );
});

test('resolveMetabotPaths rejects direct workspace roots outside ~/.metabot/profiles/<slug>', () => {
  assert.throws(
    () => resolveMetabotPaths('/tmp/direct-workspace'),
    /Profile home must live under ~\/\.metabot\/profiles\/<slug>/
  );
});
