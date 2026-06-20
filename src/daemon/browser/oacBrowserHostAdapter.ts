import path from 'node:path';
import { listMetabotProfiles, type MetabotProfileFull } from '../../core/bot/metabotProfileManager';
import type {
  BrowserActor,
  BrowserActorCapability,
  BrowserActorInput,
  BrowserCacheClearInput,
  BrowserCacheClearResult,
  BrowserCacheInput,
  BrowserCacheSnapshot,
  BrowserCommandFailureOptions,
  BrowserCommandResult,
  BrowserFollowUpAction,
  BrowserHostAdapter,
  BrowserOpenConversationPayload,
  BrowserResolveInput,
  BrowserResolveResult,
  BrowserRuntimeInput,
  BrowserRuntimeSnapshot,
  BrowserSettingsInput,
  BrowserSettingsSnapshot,
  BrowserSettingsUpdateInput,
  BrowserTrustedActionInput,
  BrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import {
  applyBrowserSettingsUpdate,
  type BrowserCommandResult as CoreBrowserCommandResult,
  createBrowserSettingsSnapshot,
  type MetaAppGalleryRecord,
  resolveBrowserConfig,
  resolveBrowserResource,
  resolveMetaAppPinToRecord,
} from '@openagentinternet/agent-browser-core';
import {
  browserFailure,
  browserManualActionRequired,
  browserSuccess,
  browserWaiting,
} from '@openagentinternet/agent-browser-host-contract';
import type {
  BrowserCommandFailure,
  BrowserCommandWaitingOptions,
} from '@openagentinternet/agent-browser-host-contract';
import { createConfigStore } from '../../core/config/configStore';
import {
  type MetabotCommandResult,
} from '../../core/contracts/commandResult';
import { buildMetafileContentUrls } from '../../core/files/metafileUrls';
import { isLlmProvider } from '../../core/llm/llmTypes';
import {
  createMetaAppArtifactCacheStore,
  normalizeMetaAppModifyHistory,
  type MetaAppArtifactCacheStore,
} from '../../core/metaapp/artifactCache';
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

function normalizePreferredCreateHost(value: unknown): string | null {
  const provider = normalizeText(value);
  return provider && provider !== 'custom' && isLlmProvider(provider) ? provider : null;
}

function actorSelector(input?: BrowserActorInput & { from?: string }): string {
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

function browserActorCapabilities(profile: MetabotProfileFull): BrowserActorCapability[] {
  const capabilities: BrowserActorCapability[] = ['template-settings'];
  if (normalizeText(profile.globalMetaId)) {
    capabilities.unshift('private-chat', 'service-call', 'message-view');
  }
  return capabilities;
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
    capabilities: browserActorCapabilities(profile),
  };
}

function toBrowserRecord(value: object): Record<string, unknown> {
  return { ...value };
}

function browserRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function followUpActionFromOac(result: MetabotCommandResult<unknown>): BrowserFollowUpAction | undefined {
  const resultData = browserRecord(result.data);
  const href = normalizeText((result as { localUiUrl?: unknown }).localUiUrl);
  const traceId = normalizeText(resultData.traceId);
  const route = href ? '' : traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '';
  if (!href && !route) return undefined;
  const action: BrowserFollowUpAction = {
    label: normalizeText((result as { actionLabel?: unknown }).actionLabel) || 'Open details',
  };
  if (href) action.href = href;
  if (route) action.route = route;
  return action;
}

function browserResultData(value: unknown): Record<string, unknown> | undefined {
  const data = browserRecord(value);
  return Object.keys(data).length ? data : undefined;
}

function browserFailureCode(result: MetabotCommandResult<unknown>): string {
  return normalizeText((result as { code?: unknown }).code) || normalizeText((result as { state?: unknown }).state) || 'browser_oac_failure';
}

function browserFailureMessage(result: MetabotCommandResult<unknown>): string {
  return normalizeText((result as { message?: unknown }).message) || 'OAC Browser command failed.';
}

function isZipMetaAppContent(contentType: string, contentReference: string): boolean {
  const normalizedContentType = normalizeText(contentType).toLowerCase();
  const normalizedReference = normalizeText(contentReference).toLowerCase().split(/[?#]/u, 1)[0] ?? '';
  return normalizedContentType === 'application/zip'
    || normalizedContentType.includes('/zip')
    || normalizedContentType.includes('+zip')
    || normalizedReference.endsWith('.zip');
}

function extractMetafilePinId(contentReference: string): string {
  if (!/^metafile:\/\//iu.test(contentReference)) {
    return '';
  }
  const withoutScheme = contentReference.slice('metafile://'.length).split(/[?#]/u, 1)[0] ?? '';
  if (!withoutScheme || withoutScheme.includes('/') || withoutScheme.includes('\\')) {
    return '';
  }
  return withoutScheme.replace(/\.[A-Za-z0-9]+$/u, '');
}

function metaAppArchiveUrls(contentReference: string): string[] {
  const normalizedReference = normalizeText(contentReference);
  if (!normalizedReference) {
    return [];
  }
  const metafilePinId = extractMetafilePinId(normalizedReference);
  if (metafilePinId) {
    const urls = buildMetafileContentUrls(metafilePinId);
    return [urls.accelerateUrl, urls.contentUrl, urls.legacyContentUrl];
  }
  return /^https?:\/\//iu.test(normalizedReference) ? [normalizedReference] : [];
}

async function downloadMetaAppArchive(
  fetchImpl: typeof fetch,
  contentReference: string,
): Promise<Buffer | null> {
  for (const url of metaAppArchiveUrls(contentReference)) {
    const response = await fetchImpl(url).catch(() => null);
    if (!response?.ok || typeof response.arrayBuffer !== 'function') {
      continue;
    }
    const archive = Buffer.from(await response.arrayBuffer());
    if (archive.byteLength > 0) {
      return archive;
    }
  }
  return null;
}

async function resolveMetaAppPreviewUrl(input: {
  pinId: string;
  contentReference: string;
  contentType: string;
  indexFile: string;
  pinRecord: Record<string, unknown>;
  artifactCache: MetaAppArtifactCacheStore;
  metaAppPreviewSessions: MetaAppPreviewSessions;
  fetchImpl: typeof fetch;
}): Promise<string> {
  if (!isZipMetaAppContent(input.contentType, input.contentReference)) {
    return '';
  }

  const modifyHistory = normalizeMetaAppModifyHistory(
    input.pinRecord.modify_history ?? input.pinRecord.modifyHistory,
  );
  const descriptor = {
    metaAppPinId: input.pinId,
    contentReference: normalizeText(input.contentReference),
    contentType: normalizeText(input.contentType) || 'application/octet-stream',
    indexFile: normalizeText(input.indexFile) || 'index.html',
    modifyHistory,
  };
  let artifact = await input.artifactCache.getArtifact(descriptor);
  if (!artifact) {
    const archive = await downloadMetaAppArchive(input.fetchImpl, descriptor.contentReference);
    if (!archive) {
      throw new Error('MetaApp ZIP content could not be downloaded.');
    }
    artifact = await input.artifactCache.writeArtifact({ ...descriptor, archive });
  }

  const session = input.metaAppPreviewSessions.create({
    artifactDir: artifact.artifactDir,
    indexFile: artifact.indexFile,
  });
  return buildMetaAppPreviewAssetUrl(session.previewId, artifact.indexFile);
}

function toBrowserFailure(result: MetabotCommandResult<unknown>): BrowserCommandFailure {
  const options: BrowserCommandFailureOptions = {};
  const action = followUpActionFromOac(result);
  const data = browserResultData(result.data);
  if (action) options.action = action;
  if (data) options.data = data;
  return browserFailure(browserFailureCode(result), browserFailureMessage(result), options);
}

function toBrowserResult<T>(result: MetabotCommandResult<T>): BrowserCommandResult<T> {
  if (result.ok) {
    return browserSuccess(result.data);
  }

  if (result.state === 'waiting') {
    const options: BrowserCommandWaitingOptions = {};
    const pollAfterMs = (result as { pollAfterMs?: unknown }).pollAfterMs;
    const action = followUpActionFromOac(result);
    const data = browserResultData(result.data);
    if (typeof pollAfterMs === 'number') options.pollAfterMs = pollAfterMs;
    if (action) options.action = action;
    if (data) options.data = data;
    return browserWaiting(browserFailureCode(result), browserFailureMessage(result), options);
  }

  if (result.state === 'manual_action_required') {
    const options: BrowserCommandFailureOptions = {};
    const action = followUpActionFromOac(result);
    const data = browserResultData(result.data);
    if (action) options.action = action;
    if (data) options.data = data;
    return browserManualActionRequired(browserFailureCode(result), browserFailureMessage(result), options);
  }

  return toBrowserFailure(result);
}

function readActionPayload(input: BrowserTrustedActionInput): Record<string, unknown> {
  return input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
    ? input.payload
    : {};
}

function trustedActionResultData(value: unknown): BrowserTrustedActionResult['data'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const source = value as Record<string, unknown>;
  const data: NonNullable<BrowserTrustedActionResult['data']> = {};
  for (const key of ['href', 'route', 'copiedText', 'message'] as const) {
    const field = source[key];
    if (typeof field === 'string' && field) {
      data[key] = field;
    }
  }
  return Object.keys(data).length ? data : undefined;
}

function ownerActorIdFromPayload(payload: Record<string, unknown>): string {
  return normalizeText(payload.ownerActorId);
}

function botManagementHref(slug: string, tab: 'info' | 'history', focus: string): string {
  const query = new URLSearchParams({ profile: slug, tab, focus });
  return `/ui/bot?${query.toString()}`;
}

function findProfileByHomeDir(profiles: MetabotProfileFull[], homeDir: string): MetabotProfileFull | null {
  const resolvedHomeDir = path.resolve(homeDir);
  return profiles.find((profile) => path.resolve(profile.homeDir) === resolvedHomeDir) ?? null;
}

function conversationHref(localGlobalMetaId: string, peerGlobalMetaId: string): string {
  const query = new URLSearchParams({
    local: localGlobalMetaId,
    peer: peerGlobalMetaId,
  });
  return `/ui/conversations?${query.toString()}`;
}

function createBotHref(env: NodeJS.ProcessEnv): string {
  const query = new URLSearchParams({ mode: 'create' });
  const host = normalizePreferredCreateHost(env.METABOT_HOST) ?? normalizePreferredCreateHost(env.OAC_HOST);
  if (host) query.set('host', host);
  return `/ui/bot?${query.toString()}`;
}

function toHostBrowserSettingsSnapshot(snapshot: ReturnType<typeof createBrowserSettingsSnapshot>): BrowserSettingsSnapshot {
  return {
    browser: toBrowserRecord(snapshot.browser ?? {}),
    effectiveBrowser: toBrowserRecord(snapshot.effectiveBrowser ?? {}),
    defaults: toBrowserRecord(snapshot.defaults ?? {}),
    ...(snapshot.configPath ? { configPath: snapshot.configPath } : {}),
  };
}

function toBrowserTrustedActionResult(
  kind: BrowserTrustedActionInput['kind'],
  result: MetabotCommandResult<unknown>,
) : BrowserCommandResult<BrowserTrustedActionResult> {
  if (!result.ok) {
    return toBrowserResult(result as MetabotCommandResult<BrowserTrustedActionResult>);
  }

  return browserSuccess({
    kind,
    handled: true,
    ...(trustedActionResultData(result.data) ? {
      data: trustedActionResultData(result.data),
    } : {}),
  });
}

function copyUriTrustedActionResult(actionInput: BrowserTrustedActionInput): BrowserCommandResult<BrowserTrustedActionResult> {
  const payload = readActionPayload(actionInput);
  const copiedText = normalizeText(payload.uri) || normalizeText(payload.currentUri) || normalizeText(actionInput.resourceUri);
  return browserSuccess({
    kind: 'copy-uri',
    handled: true,
    data: {
      copiedText,
    },
  });
}

function successTrustedActionResult(
  kind: BrowserTrustedActionInput['kind'],
  data?: BrowserTrustedActionResult['data'],
): BrowserCommandResult<BrowserTrustedActionResult> {
  return browserSuccess({
    kind,
    handled: true,
    ...(data ? { data } : {}),
  });
}

export function createOacBrowserHostAdapter(input: CreateOacBrowserHostAdapterInput): BrowserHostAdapter {
  const env = input.env ?? process.env;
  const fetchImpl = input.fetch ?? globalThis.fetch;

  async function resolveActor(
    actorInput?: BrowserActorInput & { from?: string },
  ): Promise<OacBrowserActorContext | { failure: MetabotCommandResult<never> }> {
    return input.resolveActorWriteContext(actorSelector(actorInput));
  }

  async function getRuntime(runtimeInput: BrowserRuntimeInput & { from?: string } = {}): Promise<BrowserCommandResult<BrowserRuntimeSnapshot>> {
    const requestedActor = actorSelector(runtimeInput);
    const activeHomeDir = path.resolve(input.homeDir);
    const profiles = await listMetabotProfiles(input.systemHomeDir).catch(() => [] as MetabotProfileFull[]);
    const selectedProfile = requestedActor
      ? profiles.find((profile) => profile.slug === requestedActor) ?? null
      : profiles.find((profile) => path.resolve(profile.homeDir) === activeHomeDir) ?? profiles[0] ?? null;

    if (requestedActor && !selectedProfile) {
      return browserFailure('profile_not_found', `MetaBot profile not found: ${requestedActor}`);
    }

    const selectedHomeDir = selectedProfile ? path.resolve(selectedProfile.homeDir) : '';
    const actors = profiles.map((profile) => profileToBrowserActor(profile, selectedHomeDir));
    const defaultActor = selectedProfile
      ? actors.find((actor) => actor.id === selectedProfile.slug) ?? null
      : null;

    return browserSuccess({
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
          href: createBotHref(env),
        },
      },
    });
  }

  async function getSettings(settingsInput: BrowserSettingsInput & { from?: string } = {}): Promise<BrowserCommandResult<BrowserSettingsSnapshot>> {
    const actor = await resolveActor(settingsInput);
    if ('failure' in actor) return toBrowserResult(actor.failure);
    const targetConfigStore = createConfigStore(actor.homeDir);
    const config = await targetConfigStore.read();
    return browserSuccess(toHostBrowserSettingsSnapshot(createBrowserSettingsSnapshot({
      config,
      configPath: targetConfigStore.paths.configPath,
      env,
    })));
  }

  async function updateSettings(settingsInput: BrowserSettingsUpdateInput & { from?: string }): Promise<BrowserCommandResult<BrowserSettingsSnapshot>> {
    const actor = await resolveActor(settingsInput);
    if ('failure' in actor) return toBrowserResult(actor.failure);
    const targetConfigStore = createConfigStore(actor.homeDir);
    const current = await targetConfigStore.read();
    try {
      const next = applyBrowserSettingsUpdate(current, settingsInput.browser);
      await targetConfigStore.set(next);
      const saved = await targetConfigStore.read();
      return browserSuccess(toHostBrowserSettingsSnapshot(createBrowserSettingsSnapshot({
        config: saved,
        configPath: targetConfigStore.paths.configPath,
        env,
      })));
    } catch (error) {
      return browserFailure('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function getCache(cacheInput: BrowserCacheInput & { from?: string } = {}): Promise<BrowserCommandResult<BrowserCacheSnapshot>> {
    const actor = await resolveActor(cacheInput);
    if ('failure' in actor) return toBrowserResult(actor.failure);
    const stats = await createMetaAppArtifactCacheStore(actor.homeDir).getStats();
    return browserSuccess(toBrowserRecord(stats));
  }

  async function clearCache(cacheInput: BrowserCacheClearInput & { from?: string }): Promise<BrowserCommandResult<BrowserCacheClearResult>> {
    const actor = await resolveActor(cacheInput);
    if ('failure' in actor) return toBrowserResult(actor.failure);
    try {
      const scope = normalizeText(cacheInput.scope) || 'all';
      if (scope === 'pin') {
        const result = await createMetaAppArtifactCacheStore(actor.homeDir).clear({
          scope,
          pinId: normalizeText(cacheInput.pinId),
        });
        return browserSuccess(toBrowserRecord(result));
      }
      if (scope === 'artifact') {
        const result = await createMetaAppArtifactCacheStore(actor.homeDir).clear({
          scope,
          cacheKey: normalizeText(cacheInput.cacheKey),
        });
        return browserSuccess(toBrowserRecord(result));
      }
      if (scope === 'all') {
        const result = await createMetaAppArtifactCacheStore(actor.homeDir).clear({ scope });
        return browserSuccess(toBrowserRecord(result));
      }
      return browserFailure('invalid_argument', 'Unsupported Browser cache clear scope.');
    } catch (error) {
      return browserFailure('invalid_argument', error instanceof Error ? error.message : String(error));
    }
  }

  async function resolveResource(resolveInput: BrowserResolveInput & { from?: string }): Promise<BrowserCommandResult<BrowserResolveResult>> {
    const actor = await resolveActor(resolveInput);
    if ('failure' in actor) return toBrowserResult(actor.failure);
    const config = await createConfigStore(actor.homeDir).read();
    const browserConfig = resolveBrowserConfig(config, env);
    const artifactCache = createMetaAppArtifactCacheStore(actor.homeDir);
    return resolveBrowserResource({
      uri: resolveInput.uri,
      config: browserConfig,
      fetch: fetchImpl,
      metaAppResolve: async (pinId): Promise<CoreBrowserCommandResult<MetaAppGalleryRecord>> => {
        return resolveMetaAppPinToRecord({
          pinId,
          fetch: fetchImpl,
          manApiBaseUrl: browserConfig.manApiBaseUrl,
          metafileContentBaseUrl: browserConfig.metafileContentBaseUrl,
          createPreviewSession: async ({ contentReference, contentType, indexFile, pinRecord }) => ({
            localPreviewUrl: await resolveMetaAppPreviewUrl({
              pinId,
              contentReference,
              contentType,
              indexFile,
              pinRecord,
              artifactCache,
              metaAppPreviewSessions: input.metaAppPreviewSessions,
              fetchImpl,
            }),
          }),
        });
      },
    });
  }

  async function runTrustedAction(
    actionInput: BrowserTrustedActionInput & { from?: string },
  ): Promise<BrowserCommandResult<BrowserTrustedActionResult>> {
    if (actionInput.kind === 'copy-uri') {
      return copyUriTrustedActionResult(actionInput);
    }

    const actor = await resolveActor(actionInput);
    if ('failure' in actor) return toBrowserResult(actor.failure);
    const from = actorSelector(actionInput);
    const payload = readActionPayload(actionInput);

    if (actionInput.kind === 'private-chat') {
      const to = normalizeText(payload.to) || normalizeText(payload.targetGlobalMetaId);
      const content = normalizeText(payload.content) || normalizeText(payload.message);
      if (!to || !content) {
        return browserFailure('invalid_browser_action', 'Browser private-chat action requires to and content.');
      }
      if (!input.privateChat) {
        return browserFailure('browser_action_not_supported', 'Browser private-chat action is not supported by the OAC adapter.');
      }
      const result = await input.privateChat({
        ...(from ? { from } : {}),
        to,
        content,
        ...(normalizeText(payload.replyPin) ? { replyPin: normalizeText(payload.replyPin) } : {}),
        ...(normalizeText(payload.peerChatPublicKey) ? { peerChatPublicKey: normalizeText(payload.peerChatPublicKey) } : {}),
        ...(normalizeText(payload.network) ? { network: normalizeText(payload.network) } : {}),
      });
      return toBrowserTrustedActionResult(actionInput.kind, result);
    }

    if (actionInput.kind === 'service-call') {
      const servicePinId = normalizeText(payload.servicePinId);
      const providerGlobalMetaId = normalizeText(payload.providerGlobalMetaId);
      const userTask = normalizeText(payload.userTask) || normalizeText(payload.rawRequest);
      if (!servicePinId || !providerGlobalMetaId || !userTask) {
        return browserFailure(
          'invalid_browser_action',
          'Browser service-call action requires servicePinId, providerGlobalMetaId, and userTask.',
        );
      }
      if (!input.serviceCall) {
        return browserFailure('browser_action_not_supported', 'Browser service-call action is not supported by the OAC adapter.');
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
      return toBrowserTrustedActionResult(actionInput.kind, result);
    }

    if (actionInput.kind === 'open-conversation') {
      const openPayload = payload as Partial<BrowserOpenConversationPayload>;
      const peerGlobalMetaId = normalizeText(openPayload.peerGlobalMetaId);
      if (!peerGlobalMetaId) {
        return browserFailure('invalid_browser_action', 'Browser open-conversation action requires peerGlobalMetaId.');
      }
      let profiles: MetabotProfileFull[];
      try {
        profiles = await listMetabotProfiles(input.systemHomeDir);
      } catch (error) {
        return browserFailure(
          'browser_profile_list_failed',
          error instanceof Error ? error.message : 'Browser open-conversation action could not list MetaBot profiles.',
        );
      }
      const selectedProfile = findProfileByHomeDir(profiles, actor.homeDir);
      const localGlobalMetaId = normalizeText(selectedProfile?.globalMetaId);
      if (!selectedProfile || !localGlobalMetaId) {
        return browserManualActionRequired(
          'browser_identity_required',
          'Open conversation requires a selected local Bot with a Global MetaID.',
        );
      }
      return successTrustedActionResult('open-conversation', {
        href: conversationHref(localGlobalMetaId, peerGlobalMetaId),
      });
    }

    if (
      actionInput.kind === 'edit-profile' ||
      actionInput.kind === 'configure-chat' ||
      actionInput.kind === 'view-messages'
    ) {
      const ownerActorId = ownerActorIdFromPayload(payload);
      if (!ownerActorId) {
        return browserFailure('invalid_browser_action', 'Browser owner action requires ownerActorId.');
      }
      let profiles: MetabotProfileFull[];
      try {
        profiles = await listMetabotProfiles(input.systemHomeDir);
      } catch (error) {
        return browserFailure(
          'browser_profile_list_failed',
          error instanceof Error ? error.message : 'Browser owner action could not list MetaBot profiles.',
        );
      }
      const ownerProfile = profiles.find((profile) => profile.slug === ownerActorId) ?? null;
      if (!ownerProfile) {
        return browserFailure('profile_not_found', `MetaBot profile not found: ${ownerActorId}`);
      }
      const href = actionInput.kind === 'edit-profile'
        ? botManagementHref(ownerProfile.slug, 'info', 'profile')
        : actionInput.kind === 'configure-chat'
          ? botManagementHref(ownerProfile.slug, 'info', 'chat')
          : botManagementHref(ownerProfile.slug, 'history', 'messages');
      return successTrustedActionResult(actionInput.kind, { href });
    }

    return browserFailure(
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
