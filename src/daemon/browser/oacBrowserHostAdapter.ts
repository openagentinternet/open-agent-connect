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
import { createConfigStore } from '../../core/config/configStore';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import { createMetaAppArtifactCacheStore } from '../../core/metaapp/artifactCache';
import type { createMetaAppPreviewSessionRegistry } from '../../core/metaapp/previewSessions';

type MetaAppPreviewSessions = ReturnType<typeof createMetaAppPreviewSessionRegistry>;
type OacBrowserActionHandler = (input: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;

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
  privateChat?: OacBrowserActionHandler;
  serviceCall?: OacBrowserActionHandler;
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

function readActionPayload(input: BrowserTrustedActionInput): Record<string, unknown> {
  return input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload
    : {};
}

function ownerActorIdFromPayload(payload: Record<string, unknown>): string {
  return normalizeText(payload.ownerActorId);
}

function botManagementHref(slug: string, tab: 'info' | 'history', focus: string): string {
  const query = new URLSearchParams({ profile: slug, tab, focus });
  return `/ui/bot?${query.toString()}`;
}

function wrapTrustedActionResult(
  kind: BrowserTrustedActionInput['kind'],
  result: MetabotCommandResult<unknown>,
): MetabotCommandResult<BrowserTrustedActionResult> {
  if (!result.ok) {
    return result as MetabotCommandResult<BrowserTrustedActionResult>;
  }
  return {
    ...result,
    data: {
      kind,
      handled: true,
      data: result.data,
    },
  };
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
    const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
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
        noActorTitle: 'Create your first Bot',
        noActorBody: 'Your local Agent needs a Bot identity before it can appear on the Agent Internet.',
        noActorAction: {
          label: 'Create Bot',
          href: '/ui/bot?mode=create',
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
    const actor = await resolveActor(actionInput);
    if ('failure' in actor) return actor.failure;
    const from = actorSelector(actionInput);
    const payload = readActionPayload(actionInput);

    if (actionInput.kind === 'private-chat') {
      const to = normalizeText(payload.to) || normalizeText(payload.targetGlobalMetaId);
      const content = normalizeText(payload.content) || normalizeText(payload.message);
      if (!to || !content) {
        return commandFailed('invalid_browser_action', 'Browser private-chat action requires to and content.');
      }
      if (!input.privateChat) {
        return commandFailed('browser_action_not_supported', 'Browser private-chat action is not supported by the OAC adapter.');
      }
      const result = await input.privateChat({
        ...(from ? { from } : {}),
        to,
        content,
        ...(normalizeText(payload.replyPin) ? { replyPin: normalizeText(payload.replyPin) } : {}),
        ...(normalizeText(payload.peerChatPublicKey) ? { peerChatPublicKey: normalizeText(payload.peerChatPublicKey) } : {}),
        ...(normalizeText(payload.network) ? { network: normalizeText(payload.network) } : {}),
      });
      return wrapTrustedActionResult(actionInput.kind, result);
    }

    if (actionInput.kind === 'service-call') {
      const servicePinId = normalizeText(payload.servicePinId);
      const providerGlobalMetaId = normalizeText(payload.providerGlobalMetaId);
      const userTask = normalizeText(payload.userTask) || normalizeText(payload.rawRequest);
      if (!servicePinId || !providerGlobalMetaId || !userTask) {
        return commandFailed(
          'invalid_browser_action',
          'Browser service-call action requires servicePinId, providerGlobalMetaId, and userTask.',
        );
      }
      if (!input.serviceCall) {
        return commandFailed('browser_action_not_supported', 'Browser service-call action is not supported by the OAC adapter.');
      }
      const request: Record<string, unknown> = {
        servicePinId,
        providerGlobalMetaId,
        userTask,
        taskContext: normalizeText(payload.taskContext) || 'Requested from Agent Internet Browser',
        rawRequest: normalizeText(payload.rawRequest) || userTask,
        confirmed: payload.confirmed === false ? false : true,
      };
      if (normalizeText(payload.providerDaemonBaseUrl)) {
        request.providerDaemonBaseUrl = normalizeText(payload.providerDaemonBaseUrl);
      }
      if (payload.spendCap && typeof payload.spendCap === 'object' && !Array.isArray(payload.spendCap)) {
        request.spendCap = payload.spendCap;
      }
      if (normalizeText(payload.policyMode)) {
        request.policyMode = normalizeText(payload.policyMode);
      }
      const result = await input.serviceCall({
        ...(from ? { from } : {}),
        request,
      });
      return wrapTrustedActionResult(actionInput.kind, result);
    }

    if (
      actionInput.kind === 'edit-profile' ||
      actionInput.kind === 'configure-chat' ||
      actionInput.kind === 'view-messages'
    ) {
      const ownerActorId = ownerActorIdFromPayload(payload);
      if (!ownerActorId) {
        return commandFailed('invalid_browser_action', 'Browser owner action requires ownerActorId.');
      }
      const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
      const ownerProfile = profiles.find((profile) => profile.slug === ownerActorId) ?? null;
      if (!ownerProfile) {
        return commandFailed('profile_not_found', `MetaBot profile not found: ${ownerActorId}`);
      }
      const href = actionInput.kind === 'edit-profile'
        ? botManagementHref(ownerProfile.slug, 'info', 'profile')
        : actionInput.kind === 'configure-chat'
          ? botManagementHref(ownerProfile.slug, 'info', 'chat')
          : botManagementHref(ownerProfile.slug, 'history', 'messages');
      return commandSuccess({
        kind: actionInput.kind,
        handled: true,
        data: { href },
      });
    }

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
