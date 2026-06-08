import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveBrowserConfig } from '../../core/browser/config';
import { resolveBrowserResource } from '../../core/browser/browserResolver';
import type {
  BrowserActor,
  BrowserActorInput,
  BrowserCacheClearInput,
  BrowserCacheClearResult,
  BrowserCacheInput,
  BrowserCacheSnapshot,
  BrowserHostAdapter,
  BrowserResolveInput,
  BrowserRuntimeInput,
  BrowserRuntimeSnapshot,
  BrowserSettingsInput,
  BrowserSettingsSnapshot,
  BrowserSettingsUpdateInput,
  BrowserTrustedActionInput,
  BrowserTrustedActionResult,
} from '../../core/browser/hostTypes';
import { resolveMetaAppPinToRecord } from '../../core/browser/metaAppPinResolver';
import {
  applyBrowserSettingsUpdate,
  createBrowserSettingsSnapshot,
} from '../../core/browser/settings';
import type { BrowserResolveResult } from '../../core/browser/types';
import { createDefaultConfig, type MetabotConfig } from '../../core/config/configTypes';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';

const STANDALONE_ACTOR_ID = 'standalone-wallet';

export interface StandaloneBrowserPreviewAsset {
  body: Buffer | string;
  contentType: string;
}

export interface StandaloneBrowserPreviewAssetInput {
  previewId: string;
  assetPath: string;
}

export interface StandaloneBrowserHostAdapter extends BrowserHostAdapter {
  resolvePreviewAsset(input: StandaloneBrowserPreviewAssetInput): Promise<MetabotCommandResult<StandaloneBrowserPreviewAsset>>;
}

export interface CreateStandaloneBrowserHostAdapterInput {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}

interface PreviewSession {
  artifactDir: string;
  indexFile: string;
  createdAt: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actorSelector(input?: BrowserActorInput): string {
  return normalizeText(input?.actorId) || normalizeText(input?.from);
}

function createStandaloneConfig(): MetabotConfig {
  const config = createDefaultConfig();
  return {
    ...config,
    browser: {
      ...config.browser,
      localMode: false,
    },
  };
}

function buildStandaloneActor(): BrowserActor {
  return {
    id: STANDALONE_ACTOR_ID,
    label: 'Standalone Wallet',
    kind: 'wallet',
    isDefault: true,
    capabilities: ['template-settings'],
  };
}

function encodeAssetPath(assetPath: string): string {
  return assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function contentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.html' || extension === '.htm') return 'text/html; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.js' || extension === '.mjs') return 'text/javascript; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function normalizePreviewAssetPath(value: unknown): string | null {
  const text = normalizeText(value).replace(/\\/g, '/');
  if (!text || text.startsWith('/') || text.includes('\0')) {
    return null;
  }
  const normalized = path.posix.normalize(text.replace(/^\.\//u, ''));
  if (!normalized || normalized === '.' || normalized.split('/').includes('..')) {
    return null;
  }
  return normalized;
}

export function createStandaloneBrowserHostAdapter(
  input: CreateStandaloneBrowserHostAdapterInput = {},
): StandaloneBrowserHostAdapter {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;
  const now = input.now ?? Date.now;
  let config = createStandaloneConfig();
  let cacheClearedAt: number | null = null;
  let previewCounter = 0;
  const previewSessions = new Map<string, PreviewSession>();

  function resolveActor(actorInput?: BrowserActorInput): { failure: MetabotCommandResult<never> } | null {
    const requestedActor = actorSelector(actorInput);
    if (requestedActor && requestedActor !== STANDALONE_ACTOR_ID) {
      return {
        failure: commandFailed('actor_not_found', `Standalone Browser actor not found: ${requestedActor}`),
      };
    }
    return null;
  }

  async function getRuntime(runtimeInput: BrowserRuntimeInput = {}): Promise<MetabotCommandResult<BrowserRuntimeSnapshot>> {
    const actorFailure = resolveActor(runtimeInput);
    if (actorFailure) return actorFailure.failure;
    const actor = buildStandaloneActor();
    return commandSuccess({
      host: {
        kind: 'standalone',
        name: 'Agent Internet Browser',
        localMode: false,
      },
      actors: [actor],
      defaultActor: actor,
      defaultUri: null,
      features: {
        privateChat: false,
        serviceCall: false,
        cacheManagement: true,
        templateSettings: true,
        walletLogin: false,
      },
      labels: {
        actorChip: 'Wallet',
        noActorTitle: 'No Wallet',
        noActorBody: 'Standalone Browser is running without wallet login.',
      },
    });
  }

  async function getSettings(settingsInput: BrowserSettingsInput = {}): Promise<MetabotCommandResult<BrowserSettingsSnapshot>> {
    const actorFailure = resolveActor(settingsInput);
    if (actorFailure) return actorFailure.failure;
    return commandSuccess(createBrowserSettingsSnapshot({ config, env }));
  }

  async function updateSettings(settingsInput: BrowserSettingsUpdateInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>> {
    const actorFailure = resolveActor(settingsInput);
    if (actorFailure) return actorFailure.failure;
    try {
      config = applyBrowserSettingsUpdate(config, settingsInput.browser);
      return commandSuccess(createBrowserSettingsSnapshot({ config, env }));
    } catch (error) {
      return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function getCache(cacheInput: BrowserCacheInput = {}): Promise<MetabotCommandResult<BrowserCacheSnapshot>> {
    const actorFailure = resolveActor(cacheInput);
    if (actorFailure) return actorFailure.failure;
    return commandSuccess({
      cacheRoot: 'standalone-memory',
      artifactCount: 0,
      pinRecordCount: 0,
      totalBytes: 0,
      ...(cacheClearedAt ? { lastClearedAt: cacheClearedAt } : {}),
    });
  }

  async function clearCache(cacheInput: BrowserCacheClearInput): Promise<MetabotCommandResult<BrowserCacheClearResult>> {
    const actorFailure = resolveActor(cacheInput);
    if (actorFailure) return actorFailure.failure;
    const scope = normalizeText(cacheInput.scope) || 'all';
    if (scope !== 'all' && scope !== 'pin' && scope !== 'artifact') {
      return commandFailed('invalid_argument', 'Unsupported Browser cache clear scope.');
    }
    cacheClearedAt = now();
    return commandSuccess({
      clearedArtifacts: 0,
      clearedPinRecords: 0,
      scope,
      cacheRoot: 'standalone-memory',
      lastClearedAt: cacheClearedAt,
    });
  }

  async function resolveResource(resolveInput: BrowserResolveInput): Promise<MetabotCommandResult<BrowserResolveResult>> {
    const actorFailure = resolveActor(resolveInput);
    if (actorFailure) return actorFailure.failure;
    const browserConfig = resolveBrowserConfig(config, env);
    return resolveBrowserResource({
      uri: resolveInput.uri,
      config: browserConfig,
      fetch: fetchImpl,
      metaAppResolve: (pinId) => resolveMetaAppPinToRecord({
        pinId,
        fetch: fetchImpl,
        manApiBaseUrl: browserConfig.manApiBaseUrl,
        createPreviewSession: ({ artifactDir, indexFile }) => {
          previewCounter += 1;
          const previewId = `standalone-${now().toString(36)}-${previewCounter.toString(36)}`;
          previewSessions.set(previewId, {
            artifactDir,
            indexFile,
            createdAt: now(),
          });
          return {
            previewId,
            localPreviewUrl: `/api/browser/preview-assets/${encodeURIComponent(previewId)}/${encodeAssetPath(indexFile)}`,
          };
        },
      }),
    });
  }

  async function runTrustedAction(
    actionInput: BrowserTrustedActionInput,
  ): Promise<MetabotCommandResult<BrowserTrustedActionResult>> {
    const actorFailure = resolveActor(actionInput);
    if (actorFailure) return actorFailure.failure;
    return commandFailed(
      'browser_action_not_supported',
      `Standalone Browser does not support trusted action: ${actionInput.kind}`,
    );
  }

  async function resolvePreviewAsset(
    assetInput: StandaloneBrowserPreviewAssetInput,
  ): Promise<MetabotCommandResult<StandaloneBrowserPreviewAsset>> {
    const previewId = normalizeText(assetInput.previewId);
    const assetPath = normalizePreviewAssetPath(assetInput.assetPath);
    if (!previewId || !assetPath) {
      return commandFailed('invalid_argument', 'Preview asset path is invalid.');
    }
    const session = previewSessions.get(previewId);
    if (!session) {
      return commandFailed('browser_resource_not_found', 'Preview session was not found.');
    }
    const artifactRoot = path.resolve(session.artifactDir);
    const filePath = path.resolve(artifactRoot, assetPath);
    if (filePath !== artifactRoot && !filePath.startsWith(`${artifactRoot}${path.sep}`)) {
      return commandFailed('invalid_argument', 'Preview asset path is outside the app package.');
    }
    try {
      const body = await fs.readFile(filePath);
      return commandSuccess({
        body,
        contentType: contentTypeForPath(filePath),
      });
    } catch {
      return commandFailed('browser_resource_not_found', 'Preview asset was not found.');
    }
  }

  return {
    getRuntime,
    resolveResource,
    getSettings,
    updateSettings,
    getCache,
    clearCache,
    runTrustedAction,
    resolvePreviewAsset,
  };
}
