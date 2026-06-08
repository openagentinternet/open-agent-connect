import path from 'node:path';
import { listMetabotProfiles, type MetabotProfileFull } from '../../core/bot/metabotProfileManager';
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
  BrowserSettingsUpdateInput,
  BrowserTrustedActionInput,
  BrowserTrustedActionResult,
} from '../../core/browser/hostTypes';
import { resolveMetaAppPinToRecord } from '../../core/browser/metaAppPinResolver';
import {
  applyBrowserSettingsUpdate,
  createBrowserSettingsSnapshot,
  type BrowserSettingsSnapshot,
} from '../../core/browser/settings';
import type { BrowserResolveResult } from '../../core/browser/types';
import { createConfigStore } from '../../core/config/configStore';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { createMetaAppArtifactCacheStore } from '../../core/metaapp/artifactCache';
import type { createMetaAppPreviewSessionRegistry } from '../../core/metaapp/previewSessions';

type MetaAppPreviewSessions = ReturnType<typeof createMetaAppPreviewSessionRegistry>;

export interface OacBrowserActorContext {
  homeDir: string;
}

export interface CreateOacBrowserHostAdapterInput {
  homeDir: string;
  systemHomeDir: string;
  resolveActorWriteContext: (
    rawActor: unknown,
  ) => Promise<OacBrowserActorContext | { failure: MetabotCommandResult<never> }>;
  metaAppPreviewSessions: MetaAppPreviewSessions;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function actorSelector(input?: BrowserActorInput): string {
  return normalizeText(input?.actorId) || normalizeText(input?.from);
}

function buildMetaAppPreviewAssetUrl(previewId: string, assetPath: string): string {
  const encodedPreviewId = encodeURIComponent(previewId);
  const normalizedAssetPath = assetPath
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/metaapp/preview-assets/${encodedPreviewId}/${normalizedAssetPath}`;
}

function profileToBrowserActor(profile: MetabotProfileFull, selectedHomeDir: string): BrowserActor {
  const isDefault = Boolean(selectedHomeDir && path.resolve(profile.homeDir) === selectedHomeDir);
  return {
    id: profile.slug,
    label: profile.name,
    kind: 'oac-bot',
    globalMetaId: profile.globalMetaId,
    ...(profile.avatarDataUrl ? { avatar: profile.avatarDataUrl } : {}),
    isDefault,
    capabilities: ['private-chat', 'service-call', 'template-settings'],
  };
}

function toBrowserRecord(value: object): Record<string, unknown> {
  return { ...value };
}

export function createOacBrowserHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;

  async function resolveActor(
    actorInput?: BrowserActorInput,
  ): Promise<OacBrowserActorContext | { failure: MetabotCommandResult<never> }> {
    return input.resolveActorWriteContext(actorSelector(actorInput));
  }

  async function getRuntime(runtimeInput: BrowserRuntimeInput = {}): Promise<MetabotCommandResult<BrowserRuntimeSnapshot>> {
    const requestedActor = actorSelector(runtimeInput);
    const activeHomeDir = path.resolve(input.homeDir);
    const profiles = await listMetabotProfiles(input.systemHomeDir);
    const selectedProfile = requestedActor
      ? profiles.find((profile) => profile.slug === requestedActor) ?? null
      : profiles.find((profile) => path.resolve(profile.homeDir) === activeHomeDir) ?? profiles[0] ?? null;

    if (requestedActor && !selectedProfile) {
      return commandFailed('profile_not_found', `MetaBot profile not found: ${requestedActor}`);
    }

    const selectedHomeDir = selectedProfile ? path.resolve(selectedProfile.homeDir) : '';
    const actors = profiles.map((profile) => profileToBrowserActor(profile, selectedHomeDir));
    const defaultActor = selectedProfile
      ? actors.find((actor) => actor.id === selectedProfile.slug) ?? null
      : null;

    return commandSuccess({
      host: {
        kind: 'oac',
        name: 'Open Agent Connect',
        localMode: true,
      },
      actors,
      defaultActor,
      defaultUri: defaultActor?.globalMetaId ? `metaid://${defaultActor.globalMetaId}` : null,
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
        noActorBody: 'Create a local Bot to message, call services, and sign Browser actions.',
        noActorAction: {
          label: 'Create Bot',
          href: '/ui/bot',
        },
      },
    });
  }

  async function getSettings(settingsInput: BrowserSettingsInput = {}): Promise<MetabotCommandResult<BrowserSettingsSnapshot>> {
    const actor = await resolveActor(settingsInput);
    if ('failure' in actor) return actor.failure;
    const targetConfigStore = createConfigStore(actor.homeDir);
    const config = await targetConfigStore.read();
    return commandSuccess(createBrowserSettingsSnapshot({
      config,
      configPath: targetConfigStore.paths.configPath,
      env,
    }));
  }

  async function updateSettings(settingsInput: BrowserSettingsUpdateInput): Promise<MetabotCommandResult<BrowserSettingsSnapshot>> {
    const actor = await resolveActor(settingsInput);
    if ('failure' in actor) return actor.failure;
    const targetConfigStore = createConfigStore(actor.homeDir);
    const current = await targetConfigStore.read();
    try {
      const next = applyBrowserSettingsUpdate(current, settingsInput.browser);
      await targetConfigStore.set(next);
      const saved = await targetConfigStore.read();
      return commandSuccess(createBrowserSettingsSnapshot({
        config: saved,
        configPath: targetConfigStore.paths.configPath,
        env,
      }));
    } catch (error) {
      return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function getCache(cacheInput: BrowserCacheInput = {}): Promise<MetabotCommandResult<BrowserCacheSnapshot>> {
    const actor = await resolveActor(cacheInput);
    if ('failure' in actor) return actor.failure;
    const stats = await createMetaAppArtifactCacheStore(actor.homeDir).getStats();
    return commandSuccess(toBrowserRecord(stats));
  }

  async function clearCache(cacheInput: BrowserCacheClearInput): Promise<MetabotCommandResult<BrowserCacheClearResult>> {
    const actor = await resolveActor(cacheInput);
    if ('failure' in actor) return actor.failure;
    try {
      const scope = normalizeText(cacheInput.scope) || 'all';
      if (scope === 'pin') {
        const result = await createMetaAppArtifactCacheStore(actor.homeDir).clear({
          scope,
          pinId: normalizeText(cacheInput.pinId),
        });
        return commandSuccess(toBrowserRecord(result));
      }
      if (scope === 'artifact') {
        const result = await createMetaAppArtifactCacheStore(actor.homeDir).clear({
          scope,
          cacheKey: normalizeText(cacheInput.cacheKey),
        });
        return commandSuccess(toBrowserRecord(result));
      }
      if (scope === 'all') {
        const result = await createMetaAppArtifactCacheStore(actor.homeDir).clear({ scope });
        return commandSuccess(toBrowserRecord(result));
      }
      return commandFailed('invalid_argument', 'Unsupported Browser cache clear scope.');
    } catch (error) {
      return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function resolveResource(resolveInput: BrowserResolveInput): Promise<MetabotCommandResult<BrowserResolveResult>> {
    const actor = await resolveActor(resolveInput);
    if ('failure' in actor) return actor.failure;
    const config = await createConfigStore(actor.homeDir).read();
    const browserConfig = resolveBrowserConfig(config, env);
    return resolveBrowserResource({
      uri: resolveInput.uri,
      config: browserConfig,
      fetch: fetchImpl,
      metaAppResolve: (pinId) => resolveMetaAppPinToRecord({
        pinId,
        fetch: fetchImpl,
        manApiBaseUrl: browserConfig.manApiBaseUrl,
        artifactCache: createMetaAppArtifactCacheStore(actor.homeDir),
        createPreviewSession: ({ artifactDir, indexFile }) => {
          const session = input.metaAppPreviewSessions.create({ artifactDir, indexFile });
          return {
            previewId: session.previewId,
            localPreviewUrl: buildMetaAppPreviewAssetUrl(session.previewId, indexFile),
          };
        },
      }),
    });
  }

  async function runTrustedAction(
    actionInput: BrowserTrustedActionInput,
  ): Promise<MetabotCommandResult<BrowserTrustedActionResult>> {
    return commandFailed(
      'browser_action_not_supported',
      `Browser trusted action is not supported by the OAC adapter yet: ${actionInput.kind}`,
    );
  }

  return {
    getRuntime,
    resolveResource,
    getSettings,
    updateSettings,
    getCache,
    clearCache,
    runTrustedAction,
  };
}
