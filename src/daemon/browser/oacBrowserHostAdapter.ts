import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
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
  type BrowserConfigContainer,
  type BrowserNameAliasProvider,
  type BrowserCommandResult as CoreBrowserCommandResult,
  createBrowserSettingsSnapshot,
  type MetaAppGalleryRecord,
  resolveBrowserConfig,
  resolveBrowserResource,
  resolveMetaAppPinToRecord,
} from '@openagentinternet/agent-browser-core';
import { createBrowserNameAliasProviders } from '@openagentinternet/agent-browser-name-resolvers';
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
type OacMetaIdPinWriteOperation = 'create' | 'modify' | 'revoke';
type OacMetaIdPinWritePayloadEncoding = 'utf-8' | 'base64';

const DEFAULT_PIN_WRITE_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const PIN_ID_PATTERN = /^[0-9a-f]{64}i\d+$/iu;

export interface OacBrowserMetaAppBridgeActor {
  uri: string;
  globalMetaId: string;
  name: string;
  avatarPinId?: string;
}

export interface OacBrowserMetaIdPinWriteRequest {
  operation: OacMetaIdPinWriteOperation;
  path: string;
  encryption: '0' | '1' | '2';
  version: string;
  contentType: string;
  encoding: OacMetaIdPinWritePayloadEncoding;
  payload: string;
  originalId?: string;
  appAction?: string;
}

export interface OacBrowserMetaIdPinWriteResult {
  pinId: string;
  txid?: string;
  txids?: string[];
  operation?: OacMetaIdPinWriteOperation;
  path?: string;
  actor?: OacBrowserMetaAppBridgeActor;
}

type OacBrowserMetaIdPinWriteHandler = (input: {
  actorId?: string;
  resourceUri: string;
  request: OacBrowserMetaIdPinWriteRequest;
}) => Promise<MetabotCommandResult<OacBrowserMetaIdPinWriteResult>>;

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
  writeMetaIdPin?: OacBrowserMetaIdPinWriteHandler;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  confirmationTtlMs?: number;
  nameAliasProviders?: BrowserNameAliasProvider[];
  ensNameAliasProviderFactory?: (config: {
    chainId: 1;
    rpcUrls: string[];
    textKey: string;
  }) => BrowserNameAliasProvider;
}

interface PendingPinWriteConfirmation {
  id: string;
  tokenHash: string;
  actorId: string;
  actorGlobalMetaId: string;
  actorUri: string;
  resourceUri: string;
  requestHash: string;
  expiresAt: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePreferredCreateHost(value: unknown): string | null {
  const provider = normalizeText(value);
  return provider && provider !== 'custom' && isLlmProvider(provider) ? provider : null;
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function hasExplicitEmptyEnsRpcUrls(config: BrowserConfigContainer, env: NodeJS.ProcessEnv): boolean {
  if (normalizeStringList(env.METABOT_BROWSER_ENS_RPC_URLS).length > 0) {
    return false;
  }
  const browser = browserRecord(config.browser);
  const nameResolution = browserRecord(browser.nameResolution);
  const ens = browserRecord(nameResolution.ens);
  return hasOwn(ens, 'rpcUrls') && normalizeStringList(ens.rpcUrls).length === 0;
}

function resolveBrowserHostConfig(input: {
  config: BrowserConfigContainer;
  env: NodeJS.ProcessEnv;
  configuredNameAliasProviders?: BrowserNameAliasProvider[];
  ensNameAliasProviderFactory?: CreateOacBrowserHostAdapterInput['ensNameAliasProviderFactory'];
}): {
  browserConfig: ReturnType<typeof resolveBrowserConfig>;
  nameAliasProviders: BrowserNameAliasProvider[];
} {
  const browserConfig = resolveBrowserConfig(input.config, input.env);
  const nameAliasConfig = hasExplicitEmptyEnsRpcUrls(input.config, input.env)
    ? {
        ...browserConfig,
        nameResolution: {
          ...browserConfig.nameResolution,
          ens: {
            ...browserConfig.nameResolution.ens,
            enabled: false,
            rpcUrls: [],
          },
        },
      }
    : browserConfig;

  return {
    browserConfig,
    nameAliasProviders: createBrowserNameAliasProviders({
      configured: input.configuredNameAliasProviders,
      config: nameAliasConfig,
      ...(input.ensNameAliasProviderFactory
        ? { ensNameAliasProviderFactory: input.ensNameAliasProviderFactory }
        : {}),
    }),
  };
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

function profileToMetaAppBridgeActor(profile: MetabotProfileFull): OacBrowserMetaAppBridgeActor | null {
  const globalMetaId = normalizeText(profile.globalMetaId);
  if (!globalMetaId) {
    return null;
  }
  return {
    uri: `metaid://${globalMetaId}`,
    globalMetaId,
    name: normalizeText(profile.name) || profile.slug,
  };
}

function toBrowserRecord(value: object): Record<string, unknown> {
  return { ...value };
}

function browserRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function safeBridgeMessage(value: unknown, fallback: string): string {
  const message = normalizeText(value);
  if (!message) return fallback;
  if (/\/Users\/|\.metabot|\/api\/|private\s*key|mnemonic|token|stack\s*trace/iu.test(message)) {
    return fallback;
  }
  return message;
}

function normalizeBridgeDisplay(value: unknown): { title?: string; summary?: string } | undefined {
  const source = browserRecord(value);
  const title = normalizeText(source.title);
  const summary = normalizeText(source.summary);
  if (!title && !summary) {
    return undefined;
  }
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
  };
}

function normalizePinWriteOperation(value: unknown): OacMetaIdPinWriteOperation | null {
  const operation = normalizeText(value).toLowerCase();
  return operation === 'create' || operation === 'modify' || operation === 'revoke' ? operation : null;
}

function normalizePinWriteEncryption(value: unknown): '0' | '1' | '2' | null {
  const encryption = normalizeText(value);
  return encryption === '0' || encryption === '1' || encryption === '2' ? encryption : null;
}

function normalizePinWritePayloadEncoding(value: unknown): OacMetaIdPinWritePayloadEncoding | null {
  const encoding = normalizeText(value).toLowerCase();
  if (encoding === 'utf8' || encoding === 'utf-8') return 'utf-8';
  if (encoding === 'base64') return 'base64';
  return null;
}

function isValidBase64Payload(value: string): boolean {
  if (!value || value.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) {
    return false;
  }
  try {
    Buffer.from(value, 'base64');
    return true;
  } catch {
    return false;
  }
}

function isPinId(value: string): boolean {
  return PIN_ID_PATTERN.test(value);
}

function normalizeTargetPinId(value: unknown): string {
  const text = normalizeText(value);
  if (!text) return '';
  if (text.startsWith('@')) return text.slice(1);
  if (text.startsWith('pin://')) return text.slice('pin://'.length);
  return text;
}

function targetPinIdFromPath(value: string): string {
  if (!value.startsWith('@')) return '';
  const pinId = value.slice(1);
  return isPinId(pinId) ? pinId : '';
}

function normalizeOptionalBridgeField(value: unknown, fieldName: string):
  | { value?: string }
  | { failure: BrowserCommandResult<BrowserTrustedActionResult> } {
  const text = normalizeText(value);
  if (!text) return {};
  if (/[\r\n]/u.test(text)) {
    return { failure: invalidBridgeParams(`metaid.pin.write ${fieldName} must be a single-line string.`) };
  }
  return { value: text };
}

function payloadByteSize(input: { payload: string; encoding: OacMetaIdPinWritePayloadEncoding }): number {
  return input.encoding === 'base64'
    ? Buffer.from(input.payload, 'base64').byteLength
    : Buffer.byteLength(input.payload, 'utf8');
}

function invalidBridgeParams(message: string): BrowserCommandResult<BrowserTrustedActionResult> {
  return browserFailure('invalid_params', message);
}

function validateMetaIdPinWritePayload(payload: Record<string, unknown>):
  | {
    request: OacBrowserMetaIdPinWriteRequest;
    bridgePayload: Record<string, unknown>;
    display?: { title?: string; summary?: string };
    hostConfirmation?: { id: string; token: string };
    confirmed: boolean;
    payloadSize: number;
  }
  | { failure: BrowserCommandResult<BrowserTrustedActionResult> } {
  const operation = normalizePinWriteOperation(payload.operation);
  if (!operation) {
    return { failure: invalidBridgeParams('metaid.pin.write operation must be create, modify, or revoke.') };
  }

  const pathValue = normalizeText(payload.path);
  if (operation === 'create') {
    if (!pathValue || !pathValue.startsWith('/')) {
      return { failure: invalidBridgeParams('metaid.pin.write create path must be an absolute MetaID protocol path.') };
    }
  } else {
    // OAC's signer targets modify/revoke writes through path: @pinId; originalId is preserved but must agree.
    const targetPinId = targetPinIdFromPath(pathValue);
    if (!targetPinId) {
      return { failure: invalidBridgeParams('metaid.pin.write modify and revoke path must be @<pinId>.') };
    }
    const originalId = normalizeTargetPinId(payload.originalId);
    if (originalId && (!isPinId(originalId) || originalId !== targetPinId)) {
      return { failure: invalidBridgeParams('metaid.pin.write originalId must match the @<pinId> path target.') };
    }
  }

  const encryption = normalizePinWriteEncryption(payload.encryption);
  if (!encryption) {
    return { failure: invalidBridgeParams('metaid.pin.write encryption must be 0, 1, or 2.') };
  }

  const version = normalizeText(payload.version);
  if (!version) {
    return { failure: invalidBridgeParams('metaid.pin.write version is required.') };
  }

  const contentType = normalizeText(payload.contentType);
  if (!contentType || /[\r\n]/u.test(contentType)) {
    return { failure: invalidBridgeParams('metaid.pin.write contentType is required.') };
  }

  const rawPayload = browserRecord(payload.payload);
  const encoding = normalizePinWritePayloadEncoding(rawPayload.encoding);
  const payloadValue = stringField(rawPayload.value);
  if (!encoding || payloadValue === null) {
    return { failure: invalidBridgeParams('metaid.pin.write payload requires encoding and string value.') };
  }
  if (encoding === 'base64' && !isValidBase64Payload(payloadValue)) {
    return { failure: invalidBridgeParams('metaid.pin.write base64 payload is invalid.') };
  }

  const originalIdResult = normalizeOptionalBridgeField(payload.originalId, 'originalId');
  if ('failure' in originalIdResult) return originalIdResult;
  const appActionResult = normalizeOptionalBridgeField(payload.appAction, 'appAction');
  if ('failure' in appActionResult) return appActionResult;
  const hostConfirmationSource = browserRecord(payload.hostConfirmation);
  const hostConfirmationId = normalizeText(hostConfirmationSource.id);
  const hostConfirmationToken = normalizeText(hostConfirmationSource.token);
  const hostConfirmation = hostConfirmationId && hostConfirmationToken
    ? { id: hostConfirmationId, token: hostConfirmationToken }
    : undefined;

  const request: OacBrowserMetaIdPinWriteRequest = {
    operation,
    path: pathValue,
    encryption,
    version,
    contentType,
    encoding,
    payload: payloadValue,
    ...(originalIdResult.value ? { originalId: originalIdResult.value } : {}),
    ...(appActionResult.value ? { appAction: appActionResult.value } : {}),
  };
  const display = normalizeBridgeDisplay(payload.display);
  const bridgePayload: Record<string, unknown> = {
    operation,
    path: pathValue,
    encryption,
    version,
    contentType,
    payload: {
      encoding: encoding === 'utf-8' ? 'utf8' : 'base64',
      value: payloadValue,
    },
    ...(originalIdResult.value ? { originalId: originalIdResult.value } : {}),
    ...(appActionResult.value ? { appAction: appActionResult.value } : {}),
    ...(display ? { display } : {}),
  };

  return {
    request,
    bridgePayload,
    ...(display ? { display } : {}),
    ...(hostConfirmation ? { hostConfirmation } : {}),
    confirmed: payload.confirmed === true,
    payloadSize: payloadByteSize(request),
  };
}

function sanitizeMetaAppBridgeActor(value: unknown): OacBrowserMetaAppBridgeActor | null {
  const source = browserRecord(value);
  const globalMetaId = normalizeText(source.globalMetaId);
  const uri = normalizeText(source.uri) || (globalMetaId ? `metaid://${globalMetaId}` : '');
  const name = normalizeText(source.name);
  if (!globalMetaId || !uri.startsWith('metaid://') || !name) {
    return null;
  }
  const avatarPinId = normalizeText(source.avatarPinId);
  return {
    uri,
    globalMetaId,
    name,
    ...(avatarPinId && !avatarPinId.includes('/') && !avatarPinId.includes('\\') ? { avatarPinId } : {}),
  };
}

function mapPinWriteFailureCode(value: string): string {
  if (value === 'profile_not_found' || value === 'identity_missing' || value === 'browser_identity_required') {
    return 'actor_required';
  }
  if (value === 'manual_action_required' || value === 'confirmation_required') {
    return 'manual_action_required';
  }
  if (value === 'invalid_argument' || value === 'invalid_browser_action') {
    return 'invalid_params';
  }
  return value || 'pin_write_failed';
}

function firstString(value: unknown): string {
  if (!Array.isArray(value)) return '';
  for (const item of value) {
    const text = normalizeText(item);
    if (text) return text;
  }
  return '';
}

function sanitizePinWriteResultData(input: {
  resultData: unknown;
  request: OacBrowserMetaIdPinWriteRequest;
  actor: OacBrowserMetaAppBridgeActor;
}): Record<string, unknown> | null {
  const source = browserRecord(input.resultData);
  const pinId = normalizeText(source.pinId);
  const txid = normalizeText(source.txid) || firstString(source.txids);
  if (!pinId || !txid) {
    return null;
  }
  const operation = normalizePinWriteOperation(source.operation) ?? input.request.operation;
  const pathValue = normalizeText(source.path) || input.request.path;
  const actor = sanitizeMetaAppBridgeActor(source.actor) ?? input.actor;
  return {
    pinId,
    txid,
    operation,
    path: pathValue,
    actor,
  };
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function safeHashEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, 'hex');
  const rightBuffer = Buffer.from(right, 'hex');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function pinWriteRequestHash(input: {
  actorId: string;
  actor: OacBrowserMetaAppBridgeActor;
  resourceUri: string;
  request: OacBrowserMetaIdPinWriteRequest;
}): string {
  const payloadHash = sha256Text(input.request.payload);
  return sha256Text(JSON.stringify({
    actorId: input.actorId,
    actorGlobalMetaId: input.actor.globalMetaId,
    actorUri: input.actor.uri,
    resourceUri: input.resourceUri,
    operation: input.request.operation,
    path: input.request.path,
    encryption: input.request.encryption,
    version: input.request.version,
    contentType: input.request.contentType,
    encoding: input.request.encoding,
    payloadHash,
    originalId: input.request.originalId ?? '',
    appAction: input.request.appAction ?? '',
  }));
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
  const nowMs = input.now ?? (() => Date.now());
  const confirmationTtlMs = Number.isFinite(input.confirmationTtlMs) && Number(input.confirmationTtlMs) > 0
    ? Math.floor(Number(input.confirmationTtlMs))
    : DEFAULT_PIN_WRITE_CONFIRMATION_TTL_MS;
  const pendingPinWriteConfirmations = new Map<string, PendingPinWriteConfirmation>();

  async function resolveActor(
    actorInput?: BrowserActorInput & { from?: string },
  ): Promise<OacBrowserActorContext | { failure: MetabotCommandResult<never> }> {
    return input.resolveActorWriteContext(actorSelector(actorInput));
  }

  async function resolveMetaAppBridgeActor(
    actorInput?: BrowserActorInput & { from?: string },
  ): Promise<{ actor: OacBrowserMetaAppBridgeActor; actorId: string } | { failure: BrowserCommandResult<BrowserTrustedActionResult> }> {
    const actor = await resolveActor(actorInput);
    if ('failure' in actor) {
      const code = mapPinWriteFailureCode(browserFailureCode(actor.failure));
      return {
        failure: browserManualActionRequired(
          code,
          safeBridgeMessage(browserFailureMessage(actor.failure), 'A selected MetaID Actor Bot is required.'),
        ),
      };
    }

    let profiles: MetabotProfileFull[];
    try {
      profiles = await listMetabotProfiles(input.systemHomeDir);
    } catch {
      return {
        failure: browserManualActionRequired(
          'actor_required',
          'A selected MetaID Actor Bot is required.',
        ),
      };
    }
    const selectedProfile = findProfileByHomeDir(profiles, actor.homeDir);
    const bridgeActor = selectedProfile ? profileToMetaAppBridgeActor(selectedProfile) : null;
    if (!selectedProfile || !bridgeActor) {
      return {
        failure: browserManualActionRequired(
          'actor_required',
          'A selected MetaID Actor Bot with a Global MetaID is required.',
        ),
      };
    }
    return { actor: bridgeActor, actorId: selectedProfile.slug };
  }

  function metaIdPinWriteConfirmation(inputForConfirmation: {
    actionInput: BrowserTrustedActionInput & { from?: string };
    actor: OacBrowserMetaAppBridgeActor;
    actorId: string;
    validation: Exclude<ReturnType<typeof validateMetaIdPinWritePayload>, { failure: BrowserCommandResult<BrowserTrustedActionResult> }>;
  }): BrowserCommandResult<BrowserTrustedActionResult> {
    const issuedAt = nowMs();
    for (const [id, pending] of pendingPinWriteConfirmations.entries()) {
      if (pending.expiresAt <= issuedAt) {
        pendingPinWriteConfirmations.delete(id);
      }
    }
    const confirmationId = `pin-write-${randomUUID()}`;
    const confirmationToken = randomBytes(32).toString('base64url');
    const expiresAt = issuedAt + confirmationTtlMs;
    const requestHash = pinWriteRequestHash({
      actorId: inputForConfirmation.actorId,
      actor: inputForConfirmation.actor,
      resourceUri: inputForConfirmation.actionInput.resourceUri,
      request: inputForConfirmation.validation.request,
    });
    pendingPinWriteConfirmations.set(confirmationId, {
      id: confirmationId,
      tokenHash: sha256Text(confirmationToken),
      actorId: inputForConfirmation.actorId,
      actorGlobalMetaId: inputForConfirmation.actor.globalMetaId,
      actorUri: inputForConfirmation.actor.uri,
      resourceUri: inputForConfirmation.actionInput.resourceUri,
      requestHash,
      expiresAt,
    });

    return browserManualActionRequired(
      'manual_action_required',
      'Confirm this MetaID PIN write before OAC signs or broadcasts it.',
      {
        data: {
          confirmation: {
            actor: inputForConfirmation.actor,
            operation: inputForConfirmation.validation.request.operation,
            path: inputForConfirmation.validation.request.path,
            contentType: inputForConfirmation.validation.request.contentType,
            payloadSize: inputForConfirmation.validation.payloadSize,
            confirmationId,
            expiresAt,
            ...(inputForConfirmation.validation.display ? { display: inputForConfirmation.validation.display } : {}),
          },
          confirmRequest: {
            resourceUri: inputForConfirmation.actionInput.resourceUri,
            kind: 'metaid-pin-write',
            payload: {
              ...inputForConfirmation.validation.bridgePayload,
              confirmed: true,
              hostConfirmation: {
                id: confirmationId,
                token: confirmationToken,
              },
            },
          },
        },
      },
    );
  }

  function consumeMetaIdPinWriteConfirmation(inputForConfirmation: {
    actionInput: BrowserTrustedActionInput & { from?: string };
    actor: OacBrowserMetaAppBridgeActor;
    actorId: string;
    validation: Exclude<ReturnType<typeof validateMetaIdPinWritePayload>, { failure: BrowserCommandResult<BrowserTrustedActionResult> }>;
  }): boolean {
    const hostConfirmation = inputForConfirmation.validation.hostConfirmation;
    if (!inputForConfirmation.validation.confirmed || !hostConfirmation) {
      return false;
    }

    const pending = pendingPinWriteConfirmations.get(hostConfirmation.id);
    if (!pending) {
      return false;
    }

    const currentTime = nowMs();
    if (pending.expiresAt <= currentTime) {
      pendingPinWriteConfirmations.delete(pending.id);
      return false;
    }

    const requestHash = pinWriteRequestHash({
      actorId: inputForConfirmation.actorId,
      actor: inputForConfirmation.actor,
      resourceUri: inputForConfirmation.actionInput.resourceUri,
      request: inputForConfirmation.validation.request,
    });
    const tokenHash = sha256Text(hostConfirmation.token);
    if (
      pending.actorId !== inputForConfirmation.actorId
      || pending.actorGlobalMetaId !== inputForConfirmation.actor.globalMetaId
      || pending.actorUri !== inputForConfirmation.actor.uri
      || pending.resourceUri !== inputForConfirmation.actionInput.resourceUri
      || pending.requestHash !== requestHash
      || !safeHashEqual(pending.tokenHash, tokenHash)
    ) {
      return false;
    }

    pendingPinWriteConfirmations.delete(pending.id);
    return true;
  }

  async function runMetaIdPinWriteAction(
    actionInput: BrowserTrustedActionInput & { from?: string },
  ): Promise<BrowserCommandResult<BrowserTrustedActionResult>> {
    const payload = readActionPayload(actionInput);
    const validation = validateMetaIdPinWritePayload(payload);
    if ('failure' in validation) {
      return validation.failure;
    }

    const actor = await resolveMetaAppBridgeActor(actionInput);
    if ('failure' in actor) {
      return actor.failure;
    }

    const confirmedByHost = consumeMetaIdPinWriteConfirmation({
      actionInput,
      actor: actor.actor,
      actorId: actor.actorId,
      validation,
    });
    if (!confirmedByHost) {
      return metaIdPinWriteConfirmation({
        actionInput,
        actor: actor.actor,
        actorId: actor.actorId,
        validation,
      });
    }

    if (!input.writeMetaIdPin) {
      return browserFailure('unsupported_method', 'OAC Browser MetaID PIN write is not configured.');
    }

    const result = await input.writeMetaIdPin({
      actorId: actor.actorId,
      resourceUri: actionInput.resourceUri,
      request: validation.request,
    });

    if (!result.ok) {
      const code = mapPinWriteFailureCode(browserFailureCode(result));
      const message = safeBridgeMessage(browserFailureMessage(result), 'MetaID PIN write failed.');
      if (result.state === 'manual_action_required') {
        return browserManualActionRequired(code, message);
      }
      if (result.state === 'waiting') {
        return browserWaiting(code, message);
      }
      return browserFailure(code === 'actor_required' ? code : 'pin_write_failed', message);
    }

    const data = sanitizePinWriteResultData({
      resultData: result.data,
      request: validation.request,
      actor: actor.actor,
    });
    if (!data) {
      return browserFailure('pin_write_failed', 'MetaID PIN write did not return a pinId and txid.');
    }
    return browserSuccess({
      kind: 'metaid-pin-write' as BrowserTrustedActionInput['kind'],
      handled: true,
      data: data as BrowserTrustedActionResult['data'],
    });
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
      // Do not preset a defaultUri: opening /browser should land on the welcome
      // page (matching the ABC standalone host), not auto-navigate into the
      // selected identity's own homepage. defaultActor is still returned so the
      // UI can highlight the active "Using" chip.
      defaultUri: null,
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
    const {
      browserConfig,
      nameAliasProviders,
    } = resolveBrowserHostConfig({
      config,
      env,
      configuredNameAliasProviders: input.nameAliasProviders,
      ensNameAliasProviderFactory: input.ensNameAliasProviderFactory,
    });
    const artifactCache = createMetaAppArtifactCacheStore(actor.homeDir);
    return resolveBrowserResource({
      uri: resolveInput.uri,
      config: browserConfig,
      fetch: fetchImpl,
      nameAliasProviders,
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

    if ((actionInput.kind as string) === 'metafile-upload') {
      return browserFailure(
        'unsupported_method',
        'OAC Browser MetaFile upload requires a host-owned file picker.',
      );
    }

    if ((actionInput.kind as string) === 'metaid-pin-write') {
      return runMetaIdPinWriteAction(actionInput);
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
