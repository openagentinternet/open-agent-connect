import path from 'node:path';

export interface MetabotPaths {
  baseRoot: string;
  hotRoot: string;
  exportRoot: string;
  runtimeDbPath: string;
  runtimeStatePath: string;
  daemonStatePath: string;
  providerPresenceStatePath: string;
  ratingDetailStatePath: string;
  masterPendingAskStatePath: string;
  masterSuggestStatePath: string;
  secretsPath: string;
  configPath: string;
  evolutionRoot: string;
  evolutionExecutionsRoot: string;
  evolutionAnalysesRoot: string;
  evolutionArtifactsRoot: string;
  evolutionIndexPath: string;
  evolutionRemoteRoot: string;
  evolutionRemoteArtifactsRoot: string;
  evolutionRemoteIndexPath: string;
}

export function resolveMetabotPaths(homeDir: string): MetabotPaths {
  if (!homeDir || typeof homeDir !== 'string') {
    throw new Error('A home directory is required to resolve metabot paths');
  }

  const baseRoot = path.join(homeDir, '.metabot');
  const hotRoot = path.join(baseRoot, 'hot');
  const exportRoot = path.join(baseRoot, 'exports');
  const configPath = path.join(hotRoot, 'config.json');
  const evolutionRoot = path.join(baseRoot, 'evolution');
  const evolutionExecutionsRoot = path.join(evolutionRoot, 'executions');
  const evolutionAnalysesRoot = path.join(evolutionRoot, 'analyses');
  const evolutionArtifactsRoot = path.join(evolutionRoot, 'artifacts');
  const evolutionIndexPath = path.join(evolutionRoot, 'index.json');
  const evolutionRemoteRoot = path.join(evolutionRoot, 'remote');
  const evolutionRemoteArtifactsRoot = path.join(evolutionRemoteRoot, 'artifacts');
  const evolutionRemoteIndexPath = path.join(evolutionRemoteRoot, 'index.json');

  return {
    baseRoot,
    hotRoot,
    exportRoot,
    runtimeDbPath: path.join(hotRoot, 'runtime.sqlite'),
    runtimeStatePath: path.join(hotRoot, 'runtime-state.json'),
    daemonStatePath: path.join(hotRoot, 'daemon.json'),
    providerPresenceStatePath: path.join(hotRoot, 'provider-presence.json'),
    ratingDetailStatePath: path.join(hotRoot, 'rating-detail.json'),
    masterPendingAskStatePath: path.join(hotRoot, 'master-pending-asks.json'),
    masterSuggestStatePath: path.join(hotRoot, 'master-suggest-state.json'),
    secretsPath: path.join(hotRoot, 'secrets.json'),
    configPath,
    evolutionRoot,
    evolutionExecutionsRoot,
    evolutionAnalysesRoot,
    evolutionArtifactsRoot,
    evolutionIndexPath,
    evolutionRemoteRoot,
    evolutionRemoteArtifactsRoot,
    evolutionRemoteIndexPath
  };
}
