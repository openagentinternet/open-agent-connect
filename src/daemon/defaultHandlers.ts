import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  commandAwaitingConfirmation,
  commandFailed,
  commandManualActionRequired,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import {
  listIdentityProfiles,
  setActiveMetabotHome,
  upsertIdentityProfile,
} from '../core/identity/identityProfiles';
import {
  createRuntimeStateStore,
  type RuntimeDaemonRecord,
  type RuntimeIdentityRecord,
  type RuntimeState,
} from '../core/state/runtimeStateStore';
import type { MetabotDaemonHttpHandlers } from './routes/types';
import { buildPublishedService } from '../core/services/publishService';
import { publishServiceToChain } from '../core/services/servicePublishChain';
import { buildProviderConsoleSnapshot, type ProviderConsoleTraceRecord } from '../core/provider/providerConsole';
import { createProviderPresenceStateStore } from '../core/provider/providerPresenceState';
import { createRatingDetailStateStore } from '../core/ratings/ratingDetailState';
import { refreshRatingDetailCacheFromChain } from '../core/ratings/ratingDetailSync';
import { planRemoteCall } from '../core/delegation/remoteCall';
import { buildSessionTrace } from '../core/chat/sessionTrace';
import type { SessionTraceRecord } from '../core/chat/sessionTrace';
import { exportSessionArtifacts } from '../core/chat/transcriptExport';
import { sendPrivateChat } from '../core/chat/privateChat';
import { createLocalMnemonicSigner } from '../core/signing/localMnemonicSigner';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { uploadLocalFileToChain } from '../core/files/uploadFile';
import { postBuzzToChain } from '../core/buzz/postBuzz';
import { runBootstrapFlow } from '../core/bootstrap/bootstrapFlow';
import { readChainDirectoryWithFallback } from '../core/discovery/chainDirectoryReader';
import { HEARTBEAT_ONLINE_WINDOW_SEC } from '../core/discovery/chainHeartbeatDirectory';
import { createSessionStateStore } from '../core/a2a/sessionStateStore';
import { createA2ASessionEngine, type A2ASessionEngineEvent } from '../core/a2a/sessionEngine';
import { resolvePublicStatus } from '../core/a2a/publicStatus';
import { createServiceRunnerRegistry } from '../core/a2a/provider/serviceRunnerRegistry';
import type { ProviderServiceRunnerResult } from '../core/a2a/provider/serviceRunnerContracts';
import type { A2ASessionRecord, A2ATaskRunRecord } from '../core/a2a/sessionTypes';
import { buildTraceWatchEvents, serializeTraceWatchEvents } from '../core/a2a/watch/traceWatch';
import { isTerminalTraceWatchStatus } from '../core/a2a/watch/watchEvents';
import {
  createLocalIdentitySyncStep,
  createLocalMetabotStep,
  createMetabotSubsidyStep,
  isIdentityBootstrapReady,
} from '../core/bootstrap/localIdentityBootstrap';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import { buildDelegationOrderPayload } from '../core/orders/delegationOrderMessage';
import { createConfigStore } from '../core/config/configStore';
import {
  createSocketIoMetaWebReplyWaiter,
  type AwaitMetaWebServiceReplyInput,
  type AwaitMetaWebServiceReplyResult,
  type MetaWebServiceReplyWaiter,
} from '../core/a2a/metawebReplyWaiter';
import { parseMasterRequest, parseMasterResponse } from '../core/master/masterMessageSchema';
import { listMasters, readChainMasterDirectoryWithFallback, summarizePublishedMaster } from '../core/master/masterDirectory';
import { createPendingMasterAskStateStore } from '../core/master/masterPendingAskState';
import { createPublishedMasterStateStore } from '../core/master/masterPublishedState';
import { buildMasterAskPreview } from '../core/master/masterPreview';
import { publishMasterToChain } from '../core/master/masterServicePublish';
import { validateMasterServicePayload } from '../core/master/masterServiceSchema';
import type { MasterDirectoryItem, PublishedMasterRecord } from '../core/master/masterTypes';

const DIRECTORY_SEEDS_FILE = 'directory-seeds.json';
const DEFAULT_CALLER_FOREGROUND_WAIT_MS = 15_000;
const DEFAULT_CALLER_BACKGROUND_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_TRACE_WATCH_WAIT_MS = 75_000;
const TRACE_WATCH_POLL_INTERVAL_MS = 500;
const PROVIDER_RATING_SYNC_STALE_MS = 30_000;
const DEFAULT_MASTER_HOST_MODE = 'codex';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function sanitizeServiceSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'service';
}

function buildMasterTraceId(input: {
  providerGlobalMetaId: string;
  servicePinId: string;
  question: string;
  now: number;
}): string {
  const providerPart = sanitizeServiceSegment(normalizeText(input.providerGlobalMetaId).slice(0, 16)) || 'provider';
  const servicePart = sanitizeServiceSegment(normalizeText(input.servicePinId).slice(0, 16)) || 'master';
  const suffix = createHash('sha256')
    .update(`${input.now}:${input.question}`)
    .digest('hex')
    .slice(0, 8);
  return `trace-master-${providerPart}-${servicePart}-${suffix}`;
}

function buildMasterRequestId(now: number): string {
  return `master-req-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolvePaymentAddress(identity: RuntimeIdentityRecord, currency: string): string {
  const normalized = normalizeText(currency).toUpperCase();
  if (normalized === 'BTC') return identity.btcAddress;
  if (normalized === 'DOGE') return identity.dogeAddress;
  return identity.mvcAddress;
}

function summarizeService(record: ReturnType<typeof buildPublishedService>['record']) {
  const chainPinIds = [...new Set([
    record.sourceServicePinId,
    record.currentPinId,
  ].filter(Boolean))];
  return {
    servicePinId: record.currentPinId,
    sourceServicePinId: record.sourceServicePinId,
    chainPinIds,
    providerGlobalMetaId: record.providerGlobalMetaId,
    providerAddress: record.paymentAddress,
    providerSkill: record.providerSkill,
    serviceName: record.serviceName,
    displayName: record.displayName,
    description: record.description,
    price: record.price,
    currency: record.currency,
    serviceIcon: record.serviceIcon,
    skillDocument: record.skillDocument,
    inputType: record.inputType,
    outputType: record.outputType,
    endpoint: record.endpoint,
    paymentAddress: record.paymentAddress,
    available: Boolean(record.available),
    online: true,
    updatedAt: record.updatedAt,
  };
}

function isProviderPresenceOnline(input: {
  enabled: boolean;
  lastHeartbeatAt: number | null;
  lastHeartbeatPinId: string | null;
}, nowMs: number = Date.now()): boolean {
  if (input.enabled !== true || !input.lastHeartbeatPinId || !Number.isFinite(input.lastHeartbeatAt)) {
    return false;
  }
  return (nowMs - Number(input.lastHeartbeatAt)) <= (HEARTBEAT_ONLINE_WINDOW_SEC * 1000);
}

function summarizeMaster(record: PublishedMasterRecord, options: {
  online?: boolean;
  lastSeenSec?: number | null;
  providerDaemonBaseUrl?: string | null;
  directorySeedLabel?: string | null;
} = {}) {
  return {
    ...summarizePublishedMaster(record),
    online: options.online === true,
    lastSeenSec: options.lastSeenSec ?? null,
    providerDaemonBaseUrl: normalizeText(options.providerDaemonBaseUrl) || null,
    directorySeedLabel: normalizeText(options.directorySeedLabel) || null,
  };
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function buildProviderSummaryPayload(input: {
  state: RuntimeState;
  presence: Awaited<ReturnType<ReturnType<typeof createProviderPresenceStateStore>['read']>>;
  ratingDetails?: Awaited<ReturnType<ReturnType<typeof createRatingDetailStateStore>['read']>>['items'];
  ratingSyncState?: 'ready' | 'sync_error';
  ratingSyncError?: string | null;
}) {
  const snapshot = buildProviderConsoleSnapshot({
    services: input.state.services,
    traces: input.state.traces as unknown as ProviderConsoleTraceRecord[],
    ratingDetails: input.ratingDetails,
    ratingSyncState: input.ratingSyncState,
  });

  return {
    identity: input.state.identity
      ? {
          metabotId: input.state.identity.metabotId,
          name: input.state.identity.name,
          globalMetaId: input.state.identity.globalMetaId,
          mvcAddress: input.state.identity.mvcAddress,
        }
      : null,
    presence: input.presence,
    services: snapshot.services,
    recentOrders: snapshot.recentOrders,
    manualActions: snapshot.manualActions,
    totals: snapshot.totals,
    ratingSyncState: input.ratingSyncState === 'sync_error' ? 'sync_error' : 'ready',
    ratingSyncError: normalizeText(input.ratingSyncError) || null,
  };
}

async function readRatingDetailSnapshot(input: {
  ratingDetailStateStore: ReturnType<typeof createRatingDetailStateStore>;
  chainApiBaseUrl?: string;
  now?: () => number;
}): Promise<{
  ratingDetails: Awaited<ReturnType<ReturnType<typeof createRatingDetailStateStore>['read']>>['items'];
  ratingSyncState: 'ready' | 'sync_error';
  ratingSyncError: string | null;
}> {
  const now = input.now ?? Date.now;
  const current = await input.ratingDetailStateStore.read();
  const lastSyncedAt = Number.isFinite(current.lastSyncedAt) ? Number(current.lastSyncedAt) : 0;
  const shouldRefresh = current.items.length === 0 || !lastSyncedAt || now() - lastSyncedAt >= PROVIDER_RATING_SYNC_STALE_MS;

  if (!shouldRefresh) {
    return {
      ratingDetails: current.items,
      ratingSyncState: 'ready',
      ratingSyncError: null,
    };
  }

  try {
    const refreshed = await refreshRatingDetailCacheFromChain({
      store: input.ratingDetailStateStore,
      chainApiBaseUrl: input.chainApiBaseUrl,
      now,
    });
    return {
      ratingDetails: refreshed.state.items,
      ratingSyncState: 'ready',
      ratingSyncError: null,
    };
  } catch (error) {
    return {
      ratingDetails: current.items,
      ratingSyncState: 'sync_error',
      ratingSyncError: error instanceof Error ? error.message : String(error),
    };
  }
}

function readCallRequest(rawInput: Record<string, unknown>) {
  const request = readObject(rawInput.request) ?? rawInput;
  return {
    servicePinId: normalizeText(request.servicePinId),
    providerGlobalMetaId: normalizeText(request.providerGlobalMetaId),
    providerDaemonBaseUrl: normalizeText(request.providerDaemonBaseUrl ?? rawInput.providerDaemonBaseUrl),
    userTask: normalizeText(request.userTask),
    taskContext: normalizeText(request.taskContext),
    rawRequest: normalizeText(request.rawRequest),
    spendCap: readObject(request.spendCap),
    policyMode: request.policyMode,
  };
}

function readPrivateChatRequest(rawInput: Record<string, unknown>) {
  let content = normalizeText(rawInput.content);
  if (!content && rawInput.content && typeof rawInput.content === 'object') {
    try {
      content = JSON.stringify(rawInput.content);
    } catch {
      content = '';
    }
  }

  return {
    to: normalizeText(rawInput.to),
    content,
    replyPin: normalizeText(rawInput.replyPin),
    peerChatPublicKey: normalizeText(rawInput.peerChatPublicKey),
  };
}

function describeStructuredPrivateChatContent(content: string): {
  messageType: 'master_request' | 'master_response' | null;
  requestId: string | null;
  traceId: string | null;
} {
  const request = parseMasterRequest(content);
  if (request.ok) {
    return {
      messageType: 'master_request',
      requestId: request.value.requestId,
      traceId: request.value.traceId,
    };
  }

  const response = parseMasterResponse(content);
  if (response.ok) {
    return {
      messageType: 'master_response',
      requestId: response.value.requestId,
      traceId: response.value.traceId,
    };
  }

  return {
    messageType: null,
    requestId: null,
    traceId: null,
  };
}

function readMasterAskDraft(rawInput: Record<string, unknown>) {
  const target = readObject(rawInput.target) ?? {};
  return {
    target: {
      servicePinId: normalizeText(target.servicePinId),
      providerGlobalMetaId: normalizeText(target.providerGlobalMetaId),
      masterKind: normalizeText(target.masterKind),
      displayName: normalizeText(target.displayName) || null,
    },
    triggerMode: normalizeText(rawInput.triggerMode) || null,
    contextMode: normalizeText(rawInput.contextMode) || null,
    userTask: normalizeText(rawInput.userTask),
    question: normalizeText(rawInput.question),
    goal: normalizeText(rawInput.goal) || null,
    workspaceSummary: normalizeText(rawInput.workspaceSummary) || null,
    errorSummary: normalizeText(rawInput.errorSummary) || null,
    diffSummary: normalizeText(rawInput.diffSummary) || null,
    relevantFiles: readStringArray(rawInput.relevantFiles),
    artifacts: Array.isArray(rawInput.artifacts) ? rawInput.artifacts : [],
    constraints: readStringArray(rawInput.constraints),
    desiredOutput: readObject(rawInput.desiredOutput),
  };
}

function readExecuteServiceRequest(rawInput: Record<string, unknown>) {
  const buyer = readObject(rawInput.buyer) ?? {};
  const request = readObject(rawInput.request) ?? {};
  return {
    traceId: normalizeText(rawInput.traceId),
    externalConversationId: normalizeText(rawInput.externalConversationId),
    servicePinId: normalizeText(rawInput.servicePinId),
    providerGlobalMetaId: normalizeText(rawInput.providerGlobalMetaId),
    buyer: {
      host: normalizeText(buyer.host),
      globalMetaId: normalizeText(buyer.globalMetaId),
      name: normalizeText(buyer.name),
    },
    request: {
      userTask: normalizeText(request.userTask),
      taskContext: normalizeText(request.taskContext),
    },
  };
}

function readServiceRateRequest(rawInput: Record<string, unknown>) {
  const request = readObject(rawInput.request) ?? rawInput;
  const rawRate = request.rate;
  const parsedRate = typeof rawRate === 'number'
    ? rawRate
    : Number.parseInt(normalizeText(rawRate), 10);
  return {
    traceId: normalizeText(request.traceId),
    rate: Number.isFinite(parsedRate) ? Math.trunc(parsedRate) : NaN,
    comment: normalizeText(request.comment),
  };
}

function buildServiceRatingFollowupMessage(input: {
  comment: string;
  ratingPinId: string | null;
}): string {
  const base = normalizeText(input.comment);
  const pinId = normalizeText(input.ratingPinId);
  const pinLine = pinId
    ? `\n\n我的评分已记录在链上（pin ID: ${pinId}）。`
    : '';
  return `${base}${pinLine}`.trim();
}

function renderDemoRemoteServiceResponse(input: {
  serviceName: string;
  displayName: string;
  userTask: string;
  taskContext: string;
}): string {
  const serviceName = normalizeText(input.serviceName).toLowerCase();
  const displayName = normalizeText(input.displayName);
  const userTask = normalizeText(input.userTask);
  const taskContext = normalizeText(input.taskContext);
  const weatherLike = serviceName.includes('weather')
    || displayName.toLowerCase().includes('weather')
    || /weather|天气/i.test(userTask)
    || /weather|天气/i.test(taskContext);

  if (weatherLike) {
    return 'Tomorrow will be bright with a light wind.';
  }

  const contextSuffix = taskContext ? ` Context: ${taskContext}` : '';
  return `${displayName || 'Remote agent'} completed the remote request: ${userTask}.${contextSuffix}`.trim();
}

function isSuccessfulCommandEnvelope(value: unknown): value is {
  ok: true;
  data: Record<string, unknown>;
} {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === true);
}

function isManualActionEnvelope(value: unknown): value is {
  ok: false;
  state: 'manual_action_required';
  code?: unknown;
  message?: unknown;
  localUiUrl?: unknown;
} {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as { ok?: unknown }).ok === false
    && (value as { state?: unknown }).state === 'manual_action_required'
  );
}

function isFailedCommandEnvelope(value: unknown): value is {
  ok: false;
  code?: unknown;
  message?: unknown;
} {
  return Boolean(value && typeof value === 'object' && (value as { ok?: unknown }).ok === false);
}

async function fetchRemoteAvailableServices(
  providerDaemonBaseUrl: string
): Promise<{ services: Array<Record<string, unknown>> } | MetabotCommandResult<unknown>> {
  try {
    const response = await fetch(`${providerDaemonBaseUrl}/api/network/services?online=true`);
    const payload = await response.json() as unknown;
    if (!response.ok) {
      return commandFailed('remote_directory_unreachable', `Remote service directory returned HTTP ${response.status}.`);
    }
    if (!isSuccessfulCommandEnvelope(payload)) {
      if (isManualActionEnvelope(payload)) {
        return commandManualActionRequired(
          normalizeText(payload.code) || 'remote_directory_manual_action_required',
          normalizeText(payload.message) || 'Remote directory requires manual action.',
          normalizeText(payload.localUiUrl) || undefined
        );
      }
      if (isFailedCommandEnvelope(payload)) {
        return commandFailed(
          normalizeText(payload.code) || 'remote_directory_unavailable',
          normalizeText(payload.message) || 'Remote directory is unavailable.'
        );
      }
      return commandFailed('remote_directory_invalid_response', 'Remote directory returned an invalid command envelope.');
    }

    const services = Array.isArray(payload.data.services)
      ? payload.data.services.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      : [];
    return { services };
  } catch (error) {
    return commandFailed(
      'remote_directory_unreachable',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function fetchRemoteAvailableMasters(
  providerDaemonBaseUrl: string
): Promise<{ masters: Array<Record<string, unknown>> } | MetabotCommandResult<unknown>> {
  try {
    const response = await fetch(`${providerDaemonBaseUrl}/api/master/list?online=true`);
    const payload = await response.json() as unknown;
    if (!response.ok) {
      return commandFailed('remote_master_directory_unreachable', `Remote master directory returned HTTP ${response.status}.`);
    }
    if (!isSuccessfulCommandEnvelope(payload)) {
      if (isManualActionEnvelope(payload)) {
        return commandManualActionRequired(
          normalizeText(payload.code) || 'remote_master_directory_manual_action_required',
          normalizeText(payload.message) || 'Remote master directory requires manual action.',
          normalizeText(payload.localUiUrl) || undefined
        );
      }
      if (isFailedCommandEnvelope(payload)) {
        return commandFailed(
          normalizeText(payload.code) || 'remote_master_directory_unavailable',
          normalizeText(payload.message) || 'Remote master directory is unavailable.'
        );
      }
      return commandFailed('remote_master_directory_invalid_response', 'Remote master directory returned an invalid command envelope.');
    }

    const masters = Array.isArray(payload.data.masters)
      ? payload.data.masters.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      : [];
    return { masters };
  } catch (error) {
    return commandFailed(
      'remote_master_directory_unreachable',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function readDirectorySeeds(hotRoot: string): Promise<Array<{ baseUrl: string; label: string | null }>> {
  const seedsPath = path.join(hotRoot, DIRECTORY_SEEDS_FILE);
  let payload: unknown;
  try {
    payload = JSON.parse(await fs.readFile(seedsPath, 'utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const providers = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { providers?: unknown })?.providers)
      ? (payload as { providers: unknown[] }).providers
      : [];

  const seen = new Set<string>();
  const normalizedProviders = [];
  for (const provider of providers) {
    const entry = readObject(provider);
    const baseUrl = normalizeText(entry?.baseUrl);
    if (!baseUrl || seen.has(baseUrl)) {
      continue;
    }
    seen.add(baseUrl);
    normalizedProviders.push({
      baseUrl,
      label: normalizeText(entry?.label) || null,
    });
  }
  return normalizedProviders;
}

async function writeDirectorySeeds(
  hotRoot: string,
  providers: Array<{ baseUrl: string; label: string | null }>
): Promise<void> {
  await fs.mkdir(hotRoot, { recursive: true });
  await fs.writeFile(
    path.join(hotRoot, DIRECTORY_SEEDS_FILE),
    `${JSON.stringify({ providers }, null, 2)}\n`,
    'utf8'
  );
}

function sortDirectorySeeds(
  providers: Array<{ baseUrl: string; label: string | null }>
): Array<{ baseUrl: string; label: string | null }> {
  return [...providers].sort((left, right) => left.baseUrl.localeCompare(right.baseUrl));
}

function dedupeServices(services: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const deduped = new Map<string, Record<string, unknown>>();

  for (const service of services) {
    const key = [
      normalizeText(service.providerGlobalMetaId),
      normalizeText(service.servicePinId || service.sourceServicePinId),
    ].join('::');
    if (!key || deduped.has(key)) {
      continue;
    }
    deduped.set(key, service);
  }

  return [...deduped.values()].sort((left, right) => {
    const leftUpdatedAt = Number(left.updatedAt ?? 0);
    const rightUpdatedAt = Number(right.updatedAt ?? 0);
    return rightUpdatedAt - leftUpdatedAt;
  });
}

async function fetchSeededDirectoryServices(hotRoot: string): Promise<Array<Record<string, unknown>>> {
  const seeds = await readDirectorySeeds(hotRoot);
  const mergedServices: Array<Record<string, unknown>> = [];

  for (const seed of seeds) {
    const remoteDirectory = await fetchRemoteAvailableServices(seed.baseUrl);
    if ('ok' in remoteDirectory) {
      continue;
    }

    for (const service of remoteDirectory.services) {
      mergedServices.push({
        ...service,
        providerDaemonBaseUrl: normalizeText(service.providerDaemonBaseUrl) || seed.baseUrl,
        directorySeedLabel: seed.label,
        online: service.online !== false,
      });
    }
  }

  return dedupeServices(mergedServices);
}

async function fetchSeededDirectoryMasters(hotRoot: string): Promise<MasterDirectoryItem[]> {
  const seeds = await readDirectorySeeds(hotRoot);
  const mergedMasters: Array<Record<string, unknown>> = [];

  for (const seed of seeds) {
    const remoteDirectory = await fetchRemoteAvailableMasters(seed.baseUrl);
    if ('ok' in remoteDirectory) {
      continue;
    }

    for (const master of remoteDirectory.masters) {
      mergedMasters.push({
        ...master,
        providerDaemonBaseUrl: normalizeText(master.providerDaemonBaseUrl) || seed.baseUrl,
        directorySeedLabel: seed.label,
        online: master.online !== false,
      });
    }
  }

  return listMasters({
    entries: mergedMasters,
    host: DEFAULT_MASTER_HOST_MODE,
  });
}

async function executeRemoteServiceCall(input: {
  providerDaemonBaseUrl: string;
  traceId: string;
  externalConversationId: string;
  servicePinId: string;
  providerGlobalMetaId: string;
  buyer: RuntimeIdentityRecord;
  request: {
    userTask: string;
    taskContext: string;
  };
}): Promise<MetabotCommandResult<Record<string, unknown>>> {
  try {
    const response = await fetch(`${input.providerDaemonBaseUrl}/api/services/execute`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        traceId: input.traceId,
        externalConversationId: input.externalConversationId,
        servicePinId: input.servicePinId,
        providerGlobalMetaId: input.providerGlobalMetaId,
        buyer: {
          host: 'local-runtime',
          globalMetaId: input.buyer.globalMetaId,
          name: input.buyer.name,
        },
        request: input.request,
      }),
    });
    const payload = await response.json() as unknown;
    if (!response.ok) {
      return commandFailed('remote_execution_failed', `Remote execution returned HTTP ${response.status}.`);
    }
    if (isSuccessfulCommandEnvelope(payload)) {
      return commandSuccess(payload.data);
    }
    if (isManualActionEnvelope(payload)) {
      return commandManualActionRequired(
        normalizeText(payload.code) || 'remote_execution_manual_action_required',
        normalizeText(payload.message) || 'Remote execution requires manual action.',
        normalizeText(payload.localUiUrl) || undefined
      );
    }
    if (isFailedCommandEnvelope(payload)) {
      return commandFailed(
        normalizeText(payload.code) || 'remote_execution_failed',
        normalizeText(payload.message) || 'Remote execution failed.'
      );
    }
    return commandFailed('remote_execution_invalid_response', 'Remote execution returned an invalid command envelope.');
  } catch (error) {
    return commandFailed(
      'remote_execution_failed',
      error instanceof Error ? error.message : String(error)
    );
  }
}

async function persistSessionMutation(
  sessionStateStore: ReturnType<typeof createSessionStateStore>,
  mutation: {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
    event: string;
  },
) {
  await sessionStateStore.writeSession(mutation.session);
  await sessionStateStore.writeTaskRun(mutation.taskRun);

  const publicStatus = resolvePublicStatus({ event: mutation.event });
  await sessionStateStore.appendPublicStatusSnapshots([
    {
      sessionId: mutation.session.sessionId,
      taskRunId: mutation.taskRun.runId,
      status: publicStatus.status,
      mapped: publicStatus.mapped,
      rawEvent: publicStatus.rawEvent ?? null,
      resolvedAt: mutation.session.updatedAt,
    },
  ]);

  return publicStatus;
}

async function appendA2ATranscriptItems(
  sessionStateStore: ReturnType<typeof createSessionStateStore>,
  items: Array<{
    id: string;
    sessionId: string;
    taskRunId?: string | null;
    timestamp: number;
    type: string;
    sender: 'caller' | 'provider' | 'system';
    content: string;
    metadata?: Record<string, unknown> | null;
  }>,
): Promise<void> {
  const normalizedItems = items
    .map((item) => ({
      ...item,
      id: normalizeText(item.id),
      sessionId: normalizeText(item.sessionId),
      taskRunId: normalizeText(item.taskRunId) || null,
      type: normalizeText(item.type) || 'message',
      content: normalizeText(item.content),
    }))
    .filter((item) => item.id && item.sessionId && item.content);

  if (!normalizedItems.length) {
    return;
  }

  await sessionStateStore.appendTranscriptItems(normalizedItems);
}

async function readOptionalUtf8(filePath: string | null | undefined): Promise<string | null> {
  const normalizedPath = normalizeText(filePath);
  if (!normalizedPath) {
    return null;
  }
  try {
    return await fs.readFile(normalizedPath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

function extractTraceResult(input: {
  transcriptItems: Array<{
    timestamp: number;
    sender: 'caller' | 'provider' | 'system';
    content: string;
    metadata?: Record<string, unknown> | null;
  }>;
}): {
  resultText: string | null;
  resultObservedAt: number | null;
  resultDeliveryPinId: string | null;
} {
  for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
    const item = input.transcriptItems[index];
    if (item.sender !== 'provider') {
      continue;
    }
    const content = normalizeText(item.content);
    if (!content) {
      continue;
    }
    const metadata = item.metadata ?? null;
    const deliveryPinId = normalizeText(metadata?.deliveryPinId);
    const publicStatus = normalizeText(metadata?.publicStatus);
    const event = normalizeText(metadata?.event);
    const looksLikeCompletedResult = Boolean(
      deliveryPinId
      || publicStatus === 'completed'
      || event === 'provider_completed'
    );
    if (!looksLikeCompletedResult) {
      continue;
    }
    return {
      resultText: content,
      resultObservedAt: Number.isFinite(item.timestamp) ? item.timestamp : null,
      resultDeliveryPinId: deliveryPinId || null,
    };
  }

  return {
    resultText: null,
    resultObservedAt: null,
    resultDeliveryPinId: null,
  };
}

function extractTraceRatingRequest(input: {
  transcriptItems: Array<{
    timestamp: number;
    sender: 'caller' | 'provider' | 'system';
    content: string;
    metadata?: Record<string, unknown> | null;
  }>;
}): {
  ratingRequestText: string | null;
  ratingRequestedAt: number | null;
} {
  for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
    const item = input.transcriptItems[index];
    if (item.sender !== 'provider') {
      continue;
    }
    const content = normalizeText(item.content);
    if (!content) {
      continue;
    }
    const metadata = item.metadata ?? null;
    if (metadata?.needsRating !== true) {
      continue;
    }
    return {
      ratingRequestText: content,
      ratingRequestedAt: Number.isFinite(item.timestamp) ? item.timestamp : null,
    };
  }

  return {
    ratingRequestText: null,
    ratingRequestedAt: null,
  };
}

function extractTraceRatingClosure(input: {
  trace: ReturnType<typeof buildSessionTrace>;
  transcriptItems: Array<{
    timestamp: number;
    sender: 'caller' | 'provider' | 'system';
    type: string;
    content: string;
    metadata?: Record<string, unknown> | null;
  }>;
  ratingDetail?: {
    pinId: string;
    rate: number;
    comment: string | null;
    createdAt: number | null;
  } | null;
}): {
  ratingRequested: boolean;
  ratingPublished: boolean;
  ratingPinId: string | null;
  ratingValue: number | null;
  ratingComment: string | null;
  ratingCreatedAt: number | null;
  ratingMessageSent: boolean | null;
  ratingMessagePinId: string | null;
  ratingMessageError: string | null;
  tStageCompleted: boolean;
} {
  let ratingPublished = Boolean(input.ratingDetail);
  let ratingPinId = normalizeText(input.ratingDetail?.pinId) || null;
  let ratingValue = Number.isFinite(input.ratingDetail?.rate)
    ? Number(input.ratingDetail?.rate)
    : null;
  let ratingComment = normalizeText(input.ratingDetail?.comment) || null;
  let ratingCreatedAt = Number.isFinite(input.ratingDetail?.createdAt)
    ? Number(input.ratingDetail?.createdAt)
    : null;
  let ratingMessageSent: boolean | null = null;
  let ratingMessagePinId: string | null = null;
  let ratingMessageError: string | null = null;

  for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
    const item = input.transcriptItems[index];
    const metadata = item.metadata ?? null;
    const metadataEvent = normalizeText(metadata?.event);
    const type = normalizeText(item.type);
    const content = normalizeText(item.content);
    const metadataPinId = normalizeText(metadata?.ratingPinId) || null;
    const metadataRate = Number.parseInt(normalizeText(metadata?.rate), 10);

    if (!ratingPinId && metadataPinId) {
      ratingPinId = metadataPinId;
      ratingPublished = true;
    }
    if (ratingValue === null && Number.isFinite(metadataRate)) {
      ratingValue = metadataRate;
    }
    if (!ratingComment && type === 'rating' && content) {
      ratingComment = content;
    }
    if (!ratingCreatedAt && type === 'rating' && Number.isFinite(item.timestamp)) {
      ratingCreatedAt = item.timestamp;
    }

    if (type === 'rating' || metadataEvent === 'service_rating_published') {
      ratingPublished = ratingPublished || Boolean(metadataPinId || content);
      if (typeof metadata?.ratingMessageSent === 'boolean' && ratingMessageSent === null) {
        ratingMessageSent = metadata.ratingMessageSent;
      }
      if (!ratingMessagePinId) {
        ratingMessagePinId = normalizeText(metadata?.ratingMessagePinId) || null;
      }
      if (!ratingMessageError) {
        ratingMessageError = normalizeText(metadata?.ratingMessageError) || null;
      }
    }

    if (metadataEvent === 'service_rating_message_sent') {
      ratingPublished = true;
      ratingMessageSent = true;
      ratingMessagePinId = normalizeText(metadata?.ratingMessagePinId) || ratingMessagePinId;
    }

    if (metadataEvent === 'service_rating_message_failed') {
      ratingPublished = true;
      if (ratingMessageSent === null) {
        ratingMessageSent = false;
      }
      ratingMessageError = normalizeText(metadata?.ratingMessageError) || content || ratingMessageError;
    }
  }

  const ratingRequest = extractTraceRatingRequest({ transcriptItems: input.transcriptItems });
  return {
    ratingRequested: Boolean(ratingRequest.ratingRequestText),
    ratingPublished,
    ratingPinId,
    ratingValue,
    ratingComment,
    ratingCreatedAt,
    ratingMessageSent,
    ratingMessagePinId,
    ratingMessageError,
    tStageCompleted: ratingPublished,
  };
}

async function buildTraceInspectorPayload(input: {
  traceId: string;
  trace: ReturnType<typeof buildSessionTrace>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
  ratingDetailStateStore: ReturnType<typeof createRatingDetailStateStore>;
  chainApiBaseUrl?: string;
}) {
  const sessionState = await input.sessionStateStore.readState();
  const sessions = sessionState.sessions
    .filter((entry) => entry.traceId === input.traceId)
    .sort((left, right) => left.createdAt - right.createdAt);
  const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
  const taskRuns = sessionState.taskRuns
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => left.createdAt - right.createdAt);
  const transcriptItems = sessionState.transcriptItems
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => left.timestamp - right.timestamp);
  const publicStatusSnapshots = sessionState.publicStatusSnapshots
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => left.resolvedAt - right.resolvedAt);
  const result = extractTraceResult({ transcriptItems });
  const ratingRequest = extractTraceRatingRequest({ transcriptItems });
  const ratingSnapshot = await readRatingDetailSnapshot({
    ratingDetailStateStore: input.ratingDetailStateStore,
    chainApiBaseUrl: input.chainApiBaseUrl,
  });
  const serviceId = normalizeText(input.trace.order?.serviceId);
  const servicePaidTx = normalizeText(input.trace.order?.paymentTxid);
  const ratingDetail = serviceId && servicePaidTx
    ? ratingSnapshot.ratingDetails.find((entry) => (
        normalizeText(entry.serviceId) === serviceId
        && normalizeText(entry.servicePaidTx) === servicePaidTx
      )) ?? null
    : null;
  const ratingClosure = extractTraceRatingClosure({
    trace: input.trace,
    transcriptItems,
    ratingDetail,
  });

  return {
    ...input.trace,
    ...result,
    ...ratingRequest,
    ...ratingClosure,
    ratingSyncState: ratingSnapshot.ratingSyncState,
    ratingSyncError: ratingSnapshot.ratingSyncError,
    inspector: {
      session: sessions.at(-1) ?? null,
      sessions,
      taskRuns,
      transcriptItems,
      publicStatusSnapshots,
      transcriptMarkdown: await readOptionalUtf8(input.trace.artifacts.transcriptMarkdownPath),
      traceMarkdown: await readOptionalUtf8(input.trace.artifacts.traceMarkdownPath),
    },
  };
}

async function fetchPeerChatPublicKey(globalMetaId: string): Promise<string | null> {
  const normalized = normalizeText(globalMetaId);
  if (!normalized) return null;

  const urls = [
    `https://file.metaid.io/metafile-indexer/api/v1/info/globalmetaid/${encodeURIComponent(normalized)}`,
    `https://manapi.metaid.io/api/info/metaid/${encodeURIComponent(normalized)}`,
  ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const payload = await response.json() as {
        data?: { chatpubkey?: unknown };
        chatpubkey?: unknown;
      };
      const chatPublicKey = normalizeText(payload?.data?.chatpubkey ?? payload?.chatpubkey);
      if (chatPublicKey) {
        return chatPublicKey;
      }
    } catch {
      // ignore and fall through
    }
  }

  return null;
}

function buildSyntheticPaymentTxid(input: {
  traceId: string;
  servicePinId: string;
  providerGlobalMetaId: string;
  userTask: string;
}): string {
  return createHash('sha256')
    .update([
      normalizeText(input.traceId),
      normalizeText(input.servicePinId),
      normalizeText(input.providerGlobalMetaId),
      normalizeText(input.userTask),
    ].join('\n'))
    .digest('hex');
}

async function listRuntimeDirectoryServices(input: {
  state: RuntimeState;
  hotRoot: string;
  chainApiBaseUrl?: string;
  onlineOnly: boolean;
}): Promise<{
  services: Array<Record<string, unknown>>;
  discoverySource: 'chain' | 'seeded';
  fallbackUsed: boolean;
}> {
  const localServices = input.state.services
    .filter((service) => service.available === 1)
    .map((service) => summarizeService(service));
  const directory = await readChainDirectoryWithFallback({
    chainApiBaseUrl: input.chainApiBaseUrl,
    onlineOnly: input.onlineOnly,
    fetchSeededDirectoryServices: async () => fetchSeededDirectoryServices(input.hotRoot),
  });

  return {
    services: dedupeServices([
      ...directory.services,
      ...localServices,
    ]),
    discoverySource: directory.source,
    fallbackUsed: directory.fallbackUsed,
  };
}

async function listRuntimeDirectoryMasters(input: {
  masterStateStore: ReturnType<typeof createPublishedMasterStateStore>;
  hotRoot: string;
  chainApiBaseUrl?: string;
  onlineOnly: boolean;
  host: string;
  masterKind?: string;
  localProviderOnline: boolean;
  localLastSeenSec: number | null;
  providerDaemonBaseUrl?: string | null;
  providerGlobalMetaId?: string | null;
}): Promise<{
  masters: MasterDirectoryItem[];
  discoverySource: 'chain' | 'seeded';
  fallbackUsed: boolean;
}> {
  const localMasterState = await input.masterStateStore.read();
  const localMasters = localMasterState.masters
    .filter((master) => master.available === 1)
    .map((master) => summarizeMaster(master, {
      online: input.localProviderOnline
        && normalizeText(master.providerGlobalMetaId) === normalizeText(input.providerGlobalMetaId),
      lastSeenSec: input.localProviderOnline ? input.localLastSeenSec : null,
      providerDaemonBaseUrl: input.providerDaemonBaseUrl || null,
    }));
  const directory = await readChainMasterDirectoryWithFallback({
    chainApiBaseUrl: input.chainApiBaseUrl,
    onlineOnly: input.onlineOnly,
    fetchSeededDirectoryMasters: async () => fetchSeededDirectoryMasters(input.hotRoot),
  });

  return {
    masters: listMasters({
      entries: [
        ...directory.masters,
        ...localMasters,
      ],
      onlineOnly: input.onlineOnly,
      host: input.host,
      masterKind: input.masterKind,
    }),
    discoverySource: directory.source,
    fallbackUsed: directory.fallbackUsed,
  };
}

async function resolveExplicitMasterTarget(input: {
  draft: ReturnType<typeof readMasterAskDraft>;
  masterStateStore: ReturnType<typeof createPublishedMasterStateStore>;
  hotRoot: string;
  chainApiBaseUrl?: string;
  providerGlobalMetaId?: string | null;
  localProviderOnline: boolean;
  localLastSeenSec: number | null;
  providerDaemonBaseUrl?: string | null;
}): Promise<MasterDirectoryItem | null> {
  const servicePinId = normalizeText(input.draft.target.servicePinId);
  const providerGlobalMetaId = normalizeText(input.draft.target.providerGlobalMetaId);
  const masterKind = normalizeText(input.draft.target.masterKind);
  if (!servicePinId || !providerGlobalMetaId || !masterKind) {
    return null;
  }

  const directory = await listRuntimeDirectoryMasters({
    masterStateStore: input.masterStateStore,
    hotRoot: input.hotRoot,
    chainApiBaseUrl: input.chainApiBaseUrl,
    onlineOnly: false,
    host: DEFAULT_MASTER_HOST_MODE,
    masterKind,
    localProviderOnline: input.localProviderOnline,
    localLastSeenSec: input.localLastSeenSec,
    providerDaemonBaseUrl: input.providerDaemonBaseUrl,
    providerGlobalMetaId: input.providerGlobalMetaId,
  });

  return directory.masters.find((entry) => (
    normalizeText(entry.masterPinId) === servicePinId
    && normalizeText(entry.providerGlobalMetaId) === providerGlobalMetaId
  )) ?? null;
}

async function persistTraceRecord(
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>,
  trace: SessionTraceRecord,
): Promise<void> {
  await runtimeStateStore.updateState((state) => ({
    ...state,
    traces: [
      trace,
      ...state.traces.filter((entry) => entry.traceId !== trace.traceId),
    ],
  }));
}

async function rebuildCallerTraceArtifacts(input: {
  baseTrace: SessionTraceRecord;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
}): Promise<{ trace: SessionTraceRecord; artifacts: Awaited<ReturnType<typeof exportSessionArtifacts>> }> {
  const sessionState = await input.sessionStateStore.readState();
  const sessions = sessionState.sessions
    .filter((entry) => entry.traceId === input.baseTrace.traceId)
    .sort((left, right) => left.createdAt - right.createdAt);
  const latestSession = sessions.at(-1) ?? null;
  const taskRuns = sessionState.taskRuns
    .filter((entry) => latestSession && entry.sessionId === latestSession.sessionId)
    .sort((left, right) => left.createdAt - right.createdAt);
  const latestTaskRun = taskRuns.at(-1) ?? null;
  const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
  const transcriptMessages = sessionState.transcriptItems
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => left.timestamp - right.timestamp)
    .map((entry) => ({
      id: entry.id,
      type: entry.sender === 'caller'
        ? 'user'
        : entry.sender === 'provider'
          ? 'assistant'
          : entry.type,
      timestamp: entry.timestamp,
      content: entry.content,
      metadata: entry.metadata ?? undefined,
    }));
  const latestSnapshot = sessionState.publicStatusSnapshots
    .filter((entry) => latestSession && entry.sessionId === latestSession.sessionId)
    .sort((left, right) => left.resolvedAt - right.resolvedAt)
    .at(-1);

  const nextTrace = buildSessionTrace({
    traceId: input.baseTrace.traceId,
    channel: input.baseTrace.channel,
    exportRoot: input.runtimeStateStore.paths.exportRoot,
    createdAt: input.baseTrace.createdAt,
    session: {
      ...input.baseTrace.session,
      externalConversationId: input.baseTrace.session.externalConversationId,
    },
    order: input.baseTrace.order,
    a2a: latestSession
      ? {
          sessionId: latestSession.sessionId,
          taskRunId: latestTaskRun?.runId ?? input.baseTrace.a2a?.taskRunId ?? null,
          role: latestSession.role,
          publicStatus: latestSnapshot?.status ?? input.baseTrace.a2a?.publicStatus ?? null,
          latestEvent: latestSnapshot?.rawEvent ?? input.baseTrace.a2a?.latestEvent ?? null,
          taskRunState: latestTaskRun?.state ?? input.baseTrace.a2a?.taskRunState ?? null,
          callerGlobalMetaId: latestSession.callerGlobalMetaId,
          callerName: input.baseTrace.a2a?.callerName ?? null,
          providerGlobalMetaId: latestSession.providerGlobalMetaId,
          providerName: input.baseTrace.a2a?.providerName ?? input.baseTrace.session.peerName ?? null,
          servicePinId: latestSession.servicePinId,
        }
      : input.baseTrace.a2a,
  });

  const artifacts = await exportSessionArtifacts({
    trace: nextTrace,
    transcript: {
      sessionId: nextTrace.session.id,
      title: nextTrace.session.title,
      messages: transcriptMessages,
    },
  });
  await persistTraceRecord(input.runtimeStateStore, nextTrace);

  return {
    trace: nextTrace,
    artifacts,
  };
}

async function loadCallerContinuationState(input: {
  traceId: string;
  sessionId: string;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
  fallbackTrace: SessionTraceRecord;
}): Promise<{
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  trace: SessionTraceRecord;
} | null> {
  const sessionState = await input.sessionStateStore.readState();
  const matchingSessions = sessionState.sessions
    .filter((entry) => entry.traceId === input.traceId && entry.role === 'caller')
    .sort((left, right) => left.updatedAt - right.updatedAt);
  const session = matchingSessions.find((entry) => entry.sessionId === input.sessionId)
    ?? matchingSessions.at(-1)
    ?? null;
  if (!session) {
    return null;
  }

  const taskRun = (
    session.currentTaskRunId
      ? sessionState.taskRuns.find((entry) => (
        entry.sessionId === session.sessionId && entry.runId === session.currentTaskRunId
      ))
      : null
  ) ?? sessionState.taskRuns
    .filter((entry) => entry.sessionId === session.sessionId)
    .sort((left, right) => left.updatedAt - right.updatedAt)
    .at(-1)
    ?? null;
  if (!taskRun) {
    return null;
  }

  const runtimeState = await input.runtimeStateStore.readState();
  const trace = runtimeState.traces.find((entry) => entry.traceId === input.traceId) ?? input.fallbackTrace;

  return {
    session,
    taskRun,
    trace,
  };
}

async function applyCallerReplyResult(input: {
  reply: AwaitMetaWebServiceReplyResult;
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  sessionEngine: ReturnType<typeof createA2ASessionEngine>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  trace: SessionTraceRecord;
}): Promise<{
  trace: SessionTraceRecord;
  artifacts: Awaited<ReturnType<typeof exportSessionArtifacts>>;
  mutation: {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
    event: A2ASessionEngineEvent;
    runnerResult: ProviderServiceRunnerResult | null;
  };
}> {
  await input.sessionStateStore.appendPublicStatusSnapshots([
    {
      sessionId: input.session.sessionId,
      taskRunId: input.taskRun.runId,
      status: 'remote_received',
      mapped: true,
      rawEvent: 'provider_received',
      resolvedAt: input.reply.state === 'completed' && input.reply.observedAt
        ? input.reply.observedAt
        : Date.now(),
    },
  ]);

  const runnerResult: ProviderServiceRunnerResult = {
    state: 'completed',
    responseText: input.reply.state === 'completed' ? input.reply.responseText : '',
  };
  const mutation = input.sessionEngine.applyProviderRunnerResult({
    session: input.session,
    taskRun: input.taskRun,
    result: runnerResult,
  });
  const publicStatus = await persistSessionMutation(input.sessionStateStore, mutation);
  const transcriptItems: Parameters<typeof appendA2ATranscriptItems>[1] = [
    {
      id: `${input.trace.traceId}-provider-delivery`,
      sessionId: input.session.sessionId,
      taskRunId: mutation.taskRun.runId,
      timestamp: mutation.session.updatedAt,
      type: 'assistant',
      sender: 'provider',
      content: input.reply.state === 'completed' ? input.reply.responseText : '',
      metadata: {
        publicStatus: publicStatus.status,
        event: mutation.event,
        deliveryPinId: input.reply.state === 'completed' ? input.reply.deliveryPinId : null,
      },
    },
  ];
  if (input.reply.state === 'completed' && normalizeText(input.reply.ratingRequestText)) {
    transcriptItems.push({
      id: `${input.trace.traceId}-provider-needs-rating`,
      sessionId: input.session.sessionId,
      taskRunId: mutation.taskRun.runId,
      timestamp: (input.reply.observedAt ?? mutation.session.updatedAt) + 1,
      type: 'rating_request',
      sender: 'provider',
      content: normalizeText(input.reply.ratingRequestText),
      metadata: {
        needsRating: true,
        event: 'needs_rating',
      },
    });
  }
  await appendA2ATranscriptItems(input.sessionStateStore, transcriptItems);

  const rebuilt = await rebuildCallerTraceArtifacts({
    baseTrace: input.trace,
    runtimeStateStore: input.runtimeStateStore,
    sessionStateStore: input.sessionStateStore,
  });

  return {
    trace: rebuilt.trace,
    artifacts: rebuilt.artifacts,
    mutation,
  };
}

async function applyCallerForegroundTimeout(input: {
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  sessionEngine: ReturnType<typeof createA2ASessionEngine>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  trace: SessionTraceRecord;
}): Promise<{
  trace: SessionTraceRecord;
  artifacts: Awaited<ReturnType<typeof exportSessionArtifacts>>;
  mutation: {
    session: A2ASessionRecord;
    taskRun: A2ATaskRunRecord;
    event: A2ASessionEngineEvent;
    runnerResult: ProviderServiceRunnerResult | null;
  };
}> {
  const mutation = input.sessionEngine.markForegroundTimeout({
    session: input.session,
    taskRun: input.taskRun,
  });
  const publicStatus = await persistSessionMutation(input.sessionStateStore, mutation);
  await appendA2ATranscriptItems(input.sessionStateStore, [
    {
      id: `${input.trace.traceId}-caller-timeout`,
      sessionId: input.session.sessionId,
      taskRunId: mutation.taskRun.runId,
      timestamp: mutation.session.updatedAt,
      type: 'status_note',
      sender: 'system',
      content: 'Foreground wait ended before the remote MetaBot returned. The task may still continue remotely.',
      metadata: {
        publicStatus: publicStatus.status,
        event: mutation.event,
      },
    },
  ]);

  const rebuilt = await rebuildCallerTraceArtifacts({
    baseTrace: input.trace,
    runtimeStateStore: input.runtimeStateStore,
    sessionStateStore: input.sessionStateStore,
  });

  return {
    trace: rebuilt.trace,
    artifacts: rebuilt.artifacts,
    mutation,
  };
}

export function createDefaultMetabotDaemonHandlers(input: {
  homeDir: string;
  systemHomeDir?: string;
  getDaemonRecord: () => RuntimeDaemonRecord | null;
  secretStore?: SecretStore;
  signer?: Signer;
  identitySyncStepDelayMs?: number;
  chainApiBaseUrl?: string;
  fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  callerReplyWaiter?: MetaWebServiceReplyWaiter;
  onProviderPresenceChanged?: (enabled: boolean) => Promise<void> | void;
  requestMvcGasSubsidy?: (
    options: RequestMvcGasSubsidyOptions
  ) => Promise<RequestMvcGasSubsidyResult>;
}): MetabotDaemonHttpHandlers {
  const secretStore = input.secretStore ?? createFileSecretStore(input.homeDir);
  const signer = input.signer ?? createLocalMnemonicSigner({ secretStore });
  const configStore = createConfigStore(input.homeDir);
  const runtimeStateStore = createRuntimeStateStore(input.homeDir);
  const masterStateStore = createPublishedMasterStateStore(input.homeDir);
  const pendingMasterAskStateStore = createPendingMasterAskStateStore(input.homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(input.homeDir);
  const ratingDetailStateStore = createRatingDetailStateStore(input.homeDir);
  const sessionStateStore = createSessionStateStore(input.homeDir);
  const sessionEngine = createA2ASessionEngine();
  const resolvePeerChatPublicKey = input.fetchPeerChatPublicKey ?? fetchPeerChatPublicKey;
  const callerReplyWaiter = input.callerReplyWaiter ?? createSocketIoMetaWebReplyWaiter();
  const normalizedSystemHomeDir = normalizeText(input.systemHomeDir) || input.homeDir;
  // Keep daemon-side follow-up consumers alive after foreground timeout so late deliveries still land in trace state.
  const pendingCallerReplyContinuations = new Map<string, Promise<void>>();

  async function trackActiveIdentityProfile(identity: RuntimeIdentityRecord): Promise<void> {
    try {
      await upsertIdentityProfile({
        systemHomeDir: normalizedSystemHomeDir,
        name: identity.name,
        homeDir: input.homeDir,
        globalMetaId: identity.globalMetaId,
        mvcAddress: identity.mvcAddress,
      });
      await setActiveMetabotHome({
        systemHomeDir: normalizedSystemHomeDir,
        homeDir: input.homeDir,
      });
    } catch {
      // Profile indexing is best-effort and should not block core identity bootstrap.
    }
  }

  function scheduleCallerReplyContinuation(input: {
    trace: SessionTraceRecord;
    sessionId: string;
    waiterInput: AwaitMetaWebServiceReplyInput;
  }): void {
    if (pendingCallerReplyContinuations.has(input.trace.traceId)) {
      return;
    }

    const continuation = (async () => {
      try {
        const reply = await callerReplyWaiter.awaitServiceReply({
          ...input.waiterInput,
          timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
        });
        if (reply.state !== 'completed') {
          return;
        }

        const current = await loadCallerContinuationState({
          traceId: input.trace.traceId,
          sessionId: input.sessionId,
          runtimeStateStore,
          sessionStateStore,
          fallbackTrace: input.trace,
        });
        if (!current || current.session.state === 'completed' || current.taskRun.state === 'completed') {
          return;
        }

        await applyCallerReplyResult({
          reply,
          session: current.session,
          taskRun: current.taskRun,
          sessionEngine,
          sessionStateStore,
          runtimeStateStore,
          trace: current.trace,
        });
      } catch {
        // Best effort follow-up: keep the persisted timeout state if late delivery capture fails.
      } finally {
        pendingCallerReplyContinuations.delete(input.trace.traceId);
      }
    })();

    pendingCallerReplyContinuations.set(input.trace.traceId, continuation);
  }

  return {
    chain: {
      write: async (rawInput) => {
        try {
          const result = await signer.writePin({
            operation: typeof rawInput.operation === 'string' ? rawInput.operation : undefined,
            path: typeof rawInput.path === 'string' ? rawInput.path : undefined,
            encryption: typeof rawInput.encryption === 'string' ? rawInput.encryption : undefined,
            version: typeof rawInput.version === 'string' ? rawInput.version : undefined,
            contentType: typeof rawInput.contentType === 'string' ? rawInput.contentType : undefined,
            payload: typeof rawInput.payload === 'string' ? rawInput.payload : undefined,
            encoding: typeof rawInput.encoding === 'string' ? rawInput.encoding : undefined,
            network: typeof rawInput.network === 'string' ? rawInput.network : undefined,
          });
          return commandSuccess(result);
        } catch (error) {
          return commandFailed(
            'chain_write_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
    buzz: {
      post: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before posting buzz.');
        }

        try {
          const result = await postBuzzToChain({
            content: normalizeText(rawInput.content),
            contentType: typeof rawInput.contentType === 'string' ? rawInput.contentType : undefined,
            attachments: readStringArray(rawInput.attachments),
            quotePin: typeof rawInput.quotePin === 'string' ? rawInput.quotePin : undefined,
            network: typeof rawInput.network === 'string' ? rawInput.network : undefined,
            signer,
          });
          return commandSuccess(result);
        } catch (error) {
          return commandFailed(
            'buzz_post_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
    daemon: {
      getStatus: async () => {
        const daemon = input.getDaemonRecord();
        return commandSuccess({
          daemonId: daemon?.ownerId || 'metabot-daemon',
          state: 'online',
          lockOwner: daemon?.ownerId || 'metabot-daemon',
          baseUrl: daemon?.baseUrl || null,
          pid: daemon?.pid ?? process.pid,
        });
      },
      doctor: async () => {
        const state = await runtimeStateStore.readState();
        const daemon = input.getDaemonRecord();
        return commandSuccess({
          checks: [
            { code: 'daemon_reachable', ok: true },
            { code: 'identity_loaded', ok: Boolean(state.identity) },
            { code: 'service_registry_loaded', ok: true, count: state.services.length },
          ],
          daemon: daemon
            ? {
                baseUrl: daemon.baseUrl,
                pid: daemon.pid,
              }
            : null,
        });
      },
    },
    identity: {
      create: async ({ name }) => {
        const normalizedName = normalizeText(name);
        if (!normalizedName) {
          return commandFailed('missing_name', 'MetaBot identity name is required.');
        }

        const profiles = await listIdentityProfiles(normalizedSystemHomeDir);
        const normalizedTargetName = normalizedName.toLowerCase();
        const duplicateByName = profiles.find((profile) => (
          profile.name.toLowerCase() === normalizedTargetName
          && path.resolve(profile.homeDir) !== path.resolve(input.homeDir)
        ));
        if (duplicateByName) {
          return commandFailed(
            'identity_name_taken',
            `Local MetaBot name "${normalizedName}" already exists. Use metabot identity assign --name "${duplicateByName.name}".`
          );
        }

        const state = await runtimeStateStore.readState();
        const existingName = normalizeText(state.identity?.name);
        if (state.identity && existingName && existingName !== normalizedName) {
          return commandFailed(
            'identity_name_conflict',
            `Current active local identity is "${existingName}". Switch profile first or choose the same name.`
          );
        }
        const existingIdentity = state.identity;
        if (existingIdentity && isIdentityBootstrapReady(existingIdentity)) {
          await trackActiveIdentityProfile(existingIdentity);
          return commandSuccess(existingIdentity);
        }

        const requestName = state.identity?.name || normalizedName;
        const bootstrap = await runBootstrapFlow({
          request: {
            name: requestName,
          },
          createMetabot: createLocalMetabotStep({
            runtimeStateStore,
            secretStore,
          }),
          requestSubsidy: createMetabotSubsidyStep({
            runtimeStateStore,
            requestMvcGasSubsidy: input.requestMvcGasSubsidy,
          }),
          syncIdentityToChain: createLocalIdentitySyncStep({
            runtimeStateStore,
            signer,
            stepDelayMs: input.identitySyncStepDelayMs,
          }),
        });

        const nextState = await runtimeStateStore.readState();
        if (nextState.identity && (bootstrap.success || bootstrap.canSkip)) {
          await trackActiveIdentityProfile(nextState.identity);
          return commandSuccess(nextState.identity);
        }

        return commandFailed(
          'identity_bootstrap_failed',
          bootstrap.error ?? 'MetaBot identity bootstrap failed before the identity was ready.'
        );
      },
    },
    master: {
      publish: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before publishing masters.');
        }

        const validation = validateMasterServicePayload(rawInput);
        if (!validation.ok) {
          return commandFailed(validation.code, validation.message);
        }

        try {
          const now = Date.now();
          const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;
          const published = await publishMasterToChain({
            signer,
            creatorMetabotId: state.identity.metabotId,
            providerGlobalMetaId: state.identity.globalMetaId,
            providerAddress: state.identity.mvcAddress,
            draft: validation.value,
            now,
            network,
          });

          await masterStateStore.update((currentState) => ({
            masters: [
              published.record,
              ...currentState.masters.filter((master) => master.currentPinId !== published.record.currentPinId),
            ],
          }));

          const presence = await providerPresenceStore.read();
          const daemon = input.getDaemonRecord();
          const online = isProviderPresenceOnline(presence, now);
          const lastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
            ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
            : null;
          return commandSuccess({
            ...summarizeMaster(published.record, {
              online,
              lastSeenSec,
              providerDaemonBaseUrl: daemon?.baseUrl || null,
            }),
            txids: published.chainWrite.txids,
            totalCost: published.chainWrite.totalCost,
            network: published.chainWrite.network,
            operation: published.chainWrite.operation,
            path: published.chainWrite.path,
            contentType: published.chainWrite.contentType,
          });
        } catch (error) {
          return commandFailed(
            'master_publish_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
      list: async ({ online, masterKind }) => {
        const state = await runtimeStateStore.readState();
        const daemon = input.getDaemonRecord();
        const presence = await providerPresenceStore.read();
        const localProviderOnline = isProviderPresenceOnline(presence);
        const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
          ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
          : null;
        const directory = await listRuntimeDirectoryMasters({
          masterStateStore,
          hotRoot: runtimeStateStore.paths.hotRoot,
          chainApiBaseUrl: input.chainApiBaseUrl,
          onlineOnly: online === true,
          host: DEFAULT_MASTER_HOST_MODE,
          masterKind,
          localProviderOnline,
          localLastSeenSec,
          providerDaemonBaseUrl: daemon?.baseUrl || null,
          providerGlobalMetaId: state.identity?.globalMetaId ?? null,
        });

        return commandSuccess({
          masters: directory.masters,
          discoverySource: directory.discoverySource,
          fallbackUsed: directory.fallbackUsed,
        });
      },
      ask: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
        }

        const config = await configStore.read();
        if (!config.askMaster.enabled) {
          return commandFailed('ask_master_disabled', 'Ask Master is disabled in the local config.');
        }

        const daemon = input.getDaemonRecord();
        const presence = await providerPresenceStore.read();
        const localProviderOnline = isProviderPresenceOnline(presence);
        const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
          ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
          : null;

        if (rawInput.confirm === true) {
          const traceId = normalizeText(rawInput.traceId);
          if (!traceId) {
            return commandFailed('missing_trace_id', 'Master ask confirmation requires traceId.');
          }

          let pendingAsk;
          try {
            pendingAsk = await pendingMasterAskStateStore.get(traceId);
          } catch {
            return commandFailed('pending_master_ask_not_found', `Pending Ask Master record not found: ${traceId}`);
          }

          const resolvedTarget = await resolveExplicitMasterTarget({
            draft: {
              target: {
                servicePinId: normalizeText(pendingAsk.target.servicePinId),
                providerGlobalMetaId: normalizeText(pendingAsk.target.providerGlobalMetaId),
                masterKind: normalizeText(pendingAsk.target.masterKind),
                displayName: normalizeText(pendingAsk.target.displayName) || null,
              },
              triggerMode: null,
              contextMode: null,
              userTask: normalizeText(pendingAsk.request.task.userTask),
              question: normalizeText(pendingAsk.request.task.question),
              goal: null,
              workspaceSummary: null,
              errorSummary: null,
              diffSummary: null,
              relevantFiles: [],
              artifacts: [],
              constraints: [],
              desiredOutput: null,
            },
            masterStateStore,
            hotRoot: runtimeStateStore.paths.hotRoot,
            chainApiBaseUrl: input.chainApiBaseUrl,
            localProviderOnline,
            localLastSeenSec,
            providerDaemonBaseUrl: daemon?.baseUrl || null,
            providerGlobalMetaId: state.identity.globalMetaId,
          });
          if (!resolvedTarget) {
            return commandFailed('master_target_not_found', 'Target Master is no longer available for confirmation.');
          }

          let privateChatIdentity;
          try {
            privateChatIdentity = await signer.getPrivateChatIdentity();
          } catch (error) {
            return commandFailed(
              'identity_secret_missing',
              error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.'
            );
          }

          const peerChatPublicKey = resolvedTarget.providerGlobalMetaId === state.identity.globalMetaId
            ? state.identity.chatPublicKey
            : await resolvePeerChatPublicKey(resolvedTarget.providerGlobalMetaId) ?? '';
          if (!peerChatPublicKey) {
            return commandFailed(
              'peer_chat_public_key_missing',
              'Target Master has no published chat public key on chain.'
            );
          }

          let outboundRequest;
          try {
            outboundRequest = sendPrivateChat({
              fromIdentity: {
                globalMetaId: privateChatIdentity.globalMetaId,
                privateKeyHex: privateChatIdentity.privateKeyHex,
              },
              toGlobalMetaId: resolvedTarget.providerGlobalMetaId,
              peerChatPublicKey,
              content: pendingAsk.requestJson,
            });
          } catch (error) {
            return commandFailed(
              'master_request_build_failed',
              error instanceof Error ? error.message : String(error)
            );
          }

          let messagePinId = '';
          try {
            const write = await signer.writePin({
              operation: 'create',
              path: outboundRequest.path,
              encryption: outboundRequest.encryption,
              version: outboundRequest.version,
              contentType: outboundRequest.contentType,
              payload: outboundRequest.payload,
              encoding: 'utf-8',
              network: 'mvc',
            });
            messagePinId = normalizeText(write.pinId);
          } catch (error) {
            return commandFailed(
              'master_request_broadcast_failed',
              error instanceof Error ? error.message : String(error)
            );
          }

          await pendingMasterAskStateStore.put({
            ...pendingAsk,
            confirmationState: 'sent',
            updatedAt: Date.now(),
            sentAt: Date.now(),
            messagePinId: messagePinId || null,
          });

          const currentTrace = state.traces.find((entry) => entry.traceId === traceId);
          const updatedTrace = currentTrace
            ? {
                ...currentTrace,
                a2a: {
                  ...(currentTrace.a2a ?? {
                    sessionId: null,
                    taskRunId: null,
                    role: 'caller',
                    publicStatus: null,
                    latestEvent: null,
                    taskRunState: null,
                    callerGlobalMetaId: state.identity.globalMetaId,
                    callerName: state.identity.name,
                    providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                    providerName: resolvedTarget.displayName,
                    servicePinId: resolvedTarget.masterPinId,
                  }),
                  publicStatus: 'requesting_remote',
                  latestEvent: 'request_sent',
                  taskRunState: 'running',
                },
              }
            : buildSessionTrace({
                traceId,
                channel: 'a2a',
                exportRoot: runtimeStateStore.paths.exportRoot,
                session: {
                  id: `master-${traceId}`,
                  title: `${resolvedTarget.displayName} Ask`,
                  type: 'a2a',
                  metabotId: state.identity.metabotId,
                  peerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                  peerName: resolvedTarget.displayName,
                  externalConversationId: `master:${state.identity.globalMetaId}:${resolvedTarget.providerGlobalMetaId}:${traceId}`,
                },
                a2a: {
                  role: 'caller',
                  publicStatus: 'requesting_remote',
                  latestEvent: 'request_sent',
                  taskRunState: 'running',
                  callerGlobalMetaId: state.identity.globalMetaId,
                  callerName: state.identity.name,
                  providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                  providerName: resolvedTarget.displayName,
                  servicePinId: resolvedTarget.masterPinId,
                },
              });

          const confirmCommand = `metabot master ask --trace-id ${traceId} --confirm`;
          const artifacts = await exportSessionArtifacts({
            trace: updatedTrace,
            transcript: {
              sessionId: updatedTrace.session.id,
              title: updatedTrace.session.title || 'Ask Master',
              messages: [
                {
                  id: `${traceId}-user`,
                  type: 'user',
                  timestamp: updatedTrace.createdAt,
                  content: normalizeText(pendingAsk.request.task.question),
                },
                {
                  id: `${traceId}-preview`,
                  type: 'assistant',
                  timestamp: updatedTrace.createdAt,
                  content: `Preview prepared for ${normalizeText(pendingAsk.target.displayName) || resolvedTarget.displayName}.`,
                  metadata: {
                    confirmCommand,
                  },
                },
                {
                  id: `${traceId}-sent`,
                  type: 'assistant',
                  timestamp: Date.now(),
                  content: `Ask Master request sent to ${resolvedTarget.displayName} over simplemsg.`,
                  metadata: {
                    messagePinId: messagePinId || null,
                    path: outboundRequest.path,
                  },
                },
              ],
            },
          });

          await persistTraceRecord(runtimeStateStore, updatedTrace);

          return commandSuccess({
            traceId,
            requestId: pendingAsk.requestId,
            messagePinId: messagePinId || null,
            session: {
              state: 'requesting_remote',
              publicStatus: 'requesting_remote',
              event: 'request_sent',
            },
            traceJsonPath: artifacts.traceJsonPath,
            traceMarkdownPath: artifacts.traceMarkdownPath,
            transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
          });
        }

        const draft = readMasterAskDraft(rawInput);
        const resolvedTarget = await resolveExplicitMasterTarget({
          draft,
          masterStateStore,
          hotRoot: runtimeStateStore.paths.hotRoot,
          chainApiBaseUrl: input.chainApiBaseUrl,
          localProviderOnline,
          localLastSeenSec,
          providerDaemonBaseUrl: daemon?.baseUrl || null,
          providerGlobalMetaId: state.identity.globalMetaId,
        });
        if (!resolvedTarget) {
          return commandFailed('master_target_not_found', 'Target Master could not be resolved from the local directory.');
        }

        const now = Date.now();
        const traceId = buildMasterTraceId({
          providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
          servicePinId: resolvedTarget.masterPinId,
          question: draft.question,
          now,
        });
        const requestId = buildMasterRequestId(now);
        let prepared;
        try {
          prepared = buildMasterAskPreview({
            draft,
            resolvedTarget,
            caller: {
              globalMetaId: state.identity.globalMetaId,
              name: state.identity.name,
              host: DEFAULT_MASTER_HOST_MODE,
            },
            traceId,
            requestId,
            confirmationMode: config.askMaster.confirmationMode,
          });
        } catch (error) {
          return commandFailed(
            'invalid_master_ask_draft',
            error instanceof Error ? error.message : String(error)
          );
        }

        await pendingMasterAskStateStore.put({
          traceId,
          requestId,
          createdAt: now,
          updatedAt: now,
          confirmationState: 'awaiting_confirmation',
          requestJson: prepared.requestJson,
          request: prepared.request,
          target: prepared.preview.target,
          preview: prepared.preview,
        });

        const trace = buildSessionTrace({
          traceId,
          channel: 'a2a',
          exportRoot: runtimeStateStore.paths.exportRoot,
          session: {
            id: `master-${traceId}`,
            title: `${resolvedTarget.displayName} Ask`,
            type: 'a2a',
            metabotId: state.identity.metabotId,
            peerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
            peerName: resolvedTarget.displayName,
            externalConversationId: `master:${state.identity.globalMetaId}:${resolvedTarget.providerGlobalMetaId}:${traceId}`,
          },
          a2a: {
            role: 'caller',
            publicStatus: 'awaiting_confirmation',
            latestEvent: 'master_preview_ready',
            taskRunState: 'queued',
            callerGlobalMetaId: state.identity.globalMetaId,
            callerName: state.identity.name,
            providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
            providerName: resolvedTarget.displayName,
            servicePinId: resolvedTarget.masterPinId,
          },
        });

        const artifacts = await exportSessionArtifacts({
          trace,
          transcript: {
            sessionId: trace.session.id,
            title: trace.session.title || 'Ask Master',
            messages: [
              {
                id: `${traceId}-user`,
                type: 'user',
                timestamp: now,
                content: prepared.request.task.question,
              },
              {
                id: `${traceId}-assistant`,
                type: 'assistant',
                timestamp: now,
                content: `Ask Master preview prepared for ${resolvedTarget.displayName}.`,
                metadata: {
                  confirmCommand: prepared.preview.confirmation.confirmCommand,
                  servicePinId: resolvedTarget.masterPinId,
                  providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
                },
              },
            ],
          },
        });

        await persistTraceRecord(runtimeStateStore, trace);

        return commandAwaitingConfirmation({
          traceId,
          requestId,
          confirmation: prepared.preview.confirmation,
          preview: prepared.preview,
          traceJsonPath: artifacts.traceJsonPath,
          traceMarkdownPath: artifacts.traceMarkdownPath,
          transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
        });
      },
      trace: async () => commandFailed('not_implemented', 'Master trace is not implemented yet.'),
    },
    network: {
      listServices: async ({ online }) => {
        const state = await runtimeStateStore.readState();
        const localServices = state.services
          .filter((service) => service.available === 1)
          .map((service) => summarizeService(service));
        const directory = await readChainDirectoryWithFallback({
          chainApiBaseUrl: input.chainApiBaseUrl,
          onlineOnly: online === true,
          fetchSeededDirectoryServices: async () => fetchSeededDirectoryServices(runtimeStateStore.paths.hotRoot),
        });
        const services = dedupeServices([
          ...directory.services,
          ...localServices,
        ]);

        return commandSuccess({
          services,
          discoverySource: directory.source,
          fallbackUsed: directory.fallbackUsed,
        });
      },
      listSources: async () => {
        const sources = sortDirectorySeeds(await readDirectorySeeds(runtimeStateStore.paths.hotRoot));
        return commandSuccess({ sources });
      },
      addSource: async ({ baseUrl, label }) => {
        const normalizedBaseUrl = normalizeText(baseUrl);
        if (!normalizedBaseUrl) {
          return commandFailed('missing_base_url', 'Network source baseUrl is required.');
        }

        let parsed: URL;
        try {
          parsed = new URL(normalizedBaseUrl);
        } catch {
          return commandFailed('invalid_base_url', `Invalid network source URL: ${normalizedBaseUrl}`);
        }
        if (!/^https?:$/.test(parsed.protocol)) {
          return commandFailed('invalid_base_url', `Network source URL must be http or https: ${normalizedBaseUrl}`);
        }

        const normalizedLabel = normalizeText(label) || null;
        const currentSources = await readDirectorySeeds(runtimeStateStore.paths.hotRoot);
        const nextSources = sortDirectorySeeds([
          ...currentSources.filter((entry) => entry.baseUrl !== parsed.toString().replace(/\/$/, '')),
          {
            baseUrl: parsed.toString().replace(/\/$/, ''),
            label: normalizedLabel,
          },
        ]);
        await writeDirectorySeeds(runtimeStateStore.paths.hotRoot, nextSources);

        return commandSuccess({
          baseUrl: parsed.toString().replace(/\/$/, ''),
          label: normalizedLabel,
          totalSources: nextSources.length,
        });
      },
      removeSource: async ({ baseUrl }) => {
        const normalizedBaseUrl = normalizeText(baseUrl).replace(/\/$/, '');
        if (!normalizedBaseUrl) {
          return commandFailed('missing_base_url', 'Network source baseUrl is required.');
        }

        const currentSources = await readDirectorySeeds(runtimeStateStore.paths.hotRoot);
        const nextSources = sortDirectorySeeds(
          currentSources.filter((entry) => entry.baseUrl !== normalizedBaseUrl)
        );
        const removed = nextSources.length !== currentSources.length;
        await writeDirectorySeeds(runtimeStateStore.paths.hotRoot, nextSources);

        return commandSuccess({
          removed,
          baseUrl: normalizedBaseUrl,
          totalSources: nextSources.length,
        });
      },
    },
    provider: {
      getSummary: async () => {
        const state = await runtimeStateStore.readState();
        const presence = await providerPresenceStore.read();
        const ratingSnapshot = await readRatingDetailSnapshot({
          ratingDetailStateStore,
          chainApiBaseUrl: input.chainApiBaseUrl,
        });
        return commandSuccess(buildProviderSummaryPayload({
          state,
          presence,
          ratingDetails: ratingSnapshot.ratingDetails,
          ratingSyncState: ratingSnapshot.ratingSyncState,
          ratingSyncError: ratingSnapshot.ratingSyncError,
        }));
      },
      setPresence: async ({ enabled }) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before changing provider presence.');
        }

        const presence = await providerPresenceStore.update((current) => ({
          ...current,
          enabled,
        }));
        await input.onProviderPresenceChanged?.(enabled);

        return commandSuccess({
          identity: {
            metabotId: state.identity.metabotId,
            name: state.identity.name,
            globalMetaId: state.identity.globalMetaId,
          },
          presence,
        });
      },
      confirmRefund: async ({ orderId }) => {
        const normalizedOrderId = normalizeText(orderId);
        if (!normalizedOrderId) {
          return commandFailed('invalid_refund_confirmation', 'Refund confirmation requires an orderId.');
        }

        const state = await runtimeStateStore.readState();
        const traceIndex = state.traces.findIndex((entry) => {
          const traceRecord = entry as unknown as Record<string, unknown>;
          const order = readObject(traceRecord.order);
          return normalizeText(order?.id) === normalizedOrderId
            && normalizeText(order?.role) === 'seller';
        });
        if (traceIndex < 0) {
          return commandFailed('order_not_found', `Provider order was not found: ${normalizedOrderId}`);
        }

        const currentTrace = state.traces[traceIndex] as unknown as Record<string, unknown>;
        const currentOrder = readObject(currentTrace.order);
        if (
          !currentOrder
          || normalizeText(currentOrder.status) !== 'refund_pending'
          || !normalizeText(currentOrder.refundRequestPinId)
        ) {
          return commandFailed('refund_not_required', 'Manual refund is not required.');
        }

        const now = Date.now();
        const nextTrace = {
          ...currentTrace,
          order: {
            ...currentOrder,
            status: 'refunded',
            refundConfirmedAt: now,
            refundedAt: now,
          },
        } as unknown as SessionTraceRecord;

        await runtimeStateStore.writeState({
          ...state,
          traces: [
            nextTrace,
            ...state.traces.filter((entry, index) => index !== traceIndex),
          ],
        });

        return commandSuccess({
          orderId: normalizedOrderId,
          traceId: normalizeText(currentTrace.traceId),
          state: 'refunded',
        });
      },
    },
    services: {
      publish: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before publishing services.');
        }

        const serviceName = normalizeText(rawInput.serviceName);
        const displayName = normalizeText(rawInput.displayName);
        const description = normalizeText(rawInput.description);
        const providerSkill = normalizeText(rawInput.providerSkill);
        const price = normalizeText(rawInput.price);
        const currency = normalizeText(rawInput.currency);
        const outputType = normalizeText(rawInput.outputType);
        const serviceIconUri = normalizeText(rawInput.serviceIconUri) || null;
        const skillDocument = normalizeText(rawInput.skillDocument);

        if (!serviceName || !displayName || !description || !providerSkill || !price || !currency || !outputType) {
          return commandFailed('invalid_service_payload', 'Service payload is missing one or more required fields.');
        }

        try {
          const now = Date.now();
          const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;
          const published = await publishServiceToChain({
            signer,
            creatorMetabotId: state.identity.metabotId,
            providerGlobalMetaId: state.identity.globalMetaId,
            paymentAddress: resolvePaymentAddress(state.identity, currency),
            draft: {
              serviceName,
              displayName,
              description,
              providerSkill,
              price,
              currency,
              outputType,
              serviceIconUri,
            },
            skillDocument,
            now,
            network,
          });

          await runtimeStateStore.writeState({
            ...state,
            services: [
              published.record,
              ...state.services.filter((service) => service.currentPinId !== published.record.currentPinId),
            ],
          });

          return commandSuccess({
            ...summarizeService(published.record),
            txids: published.chainWrite.txids,
            totalCost: published.chainWrite.totalCost,
            network: published.chainWrite.network,
            operation: published.chainWrite.operation,
            path: published.chainWrite.path,
            contentType: published.chainWrite.contentType,
          });
        } catch (error) {
          return commandFailed(
            'service_publish_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
      call: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before calling services.');
        }

        const request = readCallRequest(rawInput);
        if (!request.servicePinId || !request.providerGlobalMetaId || !request.userTask) {
          return commandFailed(
            'invalid_call_request',
            'Call request must include servicePinId, providerGlobalMetaId, and userTask.'
          );
        }

        let availableServices: Array<Record<string, unknown>>;
        if (request.providerDaemonBaseUrl) {
          const remoteDirectory = await fetchRemoteAvailableServices(request.providerDaemonBaseUrl);
          if ('ok' in remoteDirectory) {
            if (!remoteDirectory.ok && remoteDirectory.state === 'manual_action_required') {
              return remoteDirectory;
            }
            return remoteDirectory;
          }
          availableServices = remoteDirectory.services;
        } else {
          const directory = await listRuntimeDirectoryServices({
            state,
            hotRoot: runtimeStateStore.paths.hotRoot,
            chainApiBaseUrl: input.chainApiBaseUrl,
            onlineOnly: true,
          });
          availableServices = directory.services;
        }

        const plan = planRemoteCall({
          request: {
            servicePinId: request.servicePinId,
            providerGlobalMetaId: request.providerGlobalMetaId,
            userTask: request.userTask,
            taskContext: request.taskContext,
            rawRequest: request.rawRequest,
            spendCap: request.spendCap as { amount: string; currency: 'SPACE' | 'BTC' | 'DOGE' } | null,
            policyMode: request.policyMode,
          },
          availableServices,
        });

        if (!plan.ok) {
          if (plan.state === 'manual_action_required') {
            return commandManualActionRequired(plan.code, plan.message);
          }
          return commandFailed(plan.code, plan.message);
        }

        const service = availableServices.find((entry) => (
          normalizeText(entry.servicePinId) === plan.service.servicePinId
          && normalizeText(entry.providerGlobalMetaId) === plan.service.providerGlobalMetaId
        ));
        if (!service) {
          return commandFailed('service_not_found', 'Published service was not found in the available service directory.');
        }

        const started = sessionEngine.startCallerSession({
          traceId: plan.traceId,
          servicePinId: plan.service.servicePinId,
          callerGlobalMetaId: state.identity.globalMetaId,
          providerGlobalMetaId: plan.service.providerGlobalMetaId,
          userTask: request.userTask,
          taskContext: request.taskContext,
        });
        const serviceDisplayName = normalizeText(service.displayName) || normalizeText(service.serviceName);
        const paymentTxid = buildSyntheticPaymentTxid({
          traceId: plan.traceId,
          servicePinId: plan.service.servicePinId,
          providerGlobalMetaId: plan.service.providerGlobalMetaId,
          userTask: request.userTask,
        });
        let orderPinId: string | null = null;
        let providerReplyText: string | null = null;
        let deliveryPinId: string | null = null;

        if (request.providerDaemonBaseUrl) {
          const execution = await executeRemoteServiceCall({
            providerDaemonBaseUrl: request.providerDaemonBaseUrl,
            traceId: plan.traceId,
            externalConversationId: started.linkage.externalConversationId,
            servicePinId: plan.service.servicePinId,
            providerGlobalMetaId: plan.service.providerGlobalMetaId,
            buyer: state.identity,
            request: {
              userTask: request.userTask,
              taskContext: request.taskContext,
            },
          });
          if (!execution.ok) {
            if (execution.state === 'manual_action_required') {
              return execution;
            }
            return execution;
          }
        } else {
          let privateChatIdentity;
          try {
            privateChatIdentity = await signer.getPrivateChatIdentity();
          } catch (error) {
            return commandFailed(
              'identity_secret_missing',
              error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.'
            );
          }

          const peerChatPublicKey = plan.service.providerGlobalMetaId === state.identity.globalMetaId
            ? state.identity.chatPublicKey
            : await resolvePeerChatPublicKey(plan.service.providerGlobalMetaId) ?? '';
          if (!peerChatPublicKey) {
            return commandFailed(
              'peer_chat_public_key_missing',
              'Remote agent has no published chat public key on chain.'
            );
          }

          const orderPayload = buildDelegationOrderPayload({
            rawRequest: request.rawRequest || request.userTask,
            taskContext: request.taskContext,
            userTask: request.userTask,
            serviceName: serviceDisplayName,
            providerSkill: normalizeText(service.providerSkill) || normalizeText(service.serviceName),
            servicePinId: plan.service.servicePinId,
            paymentTxid,
            price: plan.payment.amount,
            currency: plan.payment.currency,
          });

          let outboundOrder;
          try {
            outboundOrder = sendPrivateChat({
              fromIdentity: {
                globalMetaId: privateChatIdentity.globalMetaId,
                privateKeyHex: privateChatIdentity.privateKeyHex,
              },
              toGlobalMetaId: plan.service.providerGlobalMetaId,
              peerChatPublicKey,
              content: orderPayload,
            });
          } catch (error) {
            return commandFailed(
              'remote_order_build_failed',
              error instanceof Error ? error.message : String(error)
            );
          }

          try {
            const orderWrite = await signer.writePin({
              operation: 'create',
              path: outboundOrder.path,
              encryption: outboundOrder.encryption,
              version: outboundOrder.version,
              contentType: outboundOrder.contentType,
              payload: outboundOrder.payload,
              encoding: 'utf-8',
              network: 'mvc',
            });
            orderPinId = orderWrite.pinId;
          } catch (error) {
            return commandFailed(
              'remote_order_broadcast_failed',
              error instanceof Error ? error.message : String(error)
            );
          }
        }

        const publicStatus = await persistSessionMutation(sessionStateStore, started);
        await appendA2ATranscriptItems(sessionStateStore, [
          {
            id: `${plan.traceId}-caller-user-task`,
            sessionId: started.session.sessionId,
            taskRunId: started.taskRun.runId,
            timestamp: started.session.createdAt,
            type: 'user_task',
            sender: 'caller',
            content: request.userTask,
            metadata: {
              taskContext: request.taskContext || null,
              servicePinId: plan.service.servicePinId,
              providerGlobalMetaId: plan.service.providerGlobalMetaId,
              paymentTxid,
            },
          },
          {
            id: `${plan.traceId}-caller-request-sent`,
            sessionId: started.session.sessionId,
            taskRunId: started.taskRun.runId,
            timestamp: started.session.updatedAt,
            type: 'status_note',
            sender: 'system',
            content: `Local MetaBot delegated this task to remote MetaBot ${normalizeText(service.displayName) || normalizeText(service.serviceName) || plan.service.providerGlobalMetaId}.`,
            metadata: {
              publicStatus: publicStatus.status,
              event: started.event,
              externalConversationId: started.linkage.externalConversationId,
              orderPinId,
              paymentTxid,
            },
          },
        ]);

        const trace = buildSessionTrace({
          traceId: plan.traceId,
          channel: 'a2a',
          exportRoot: runtimeStateStore.paths.exportRoot,
          session: {
            id: `session-${plan.traceId}`,
            title: `${serviceDisplayName} Call`,
            type: 'a2a',
            metabotId: state.identity.metabotId,
            peerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
            peerName: serviceDisplayName,
            externalConversationId: started.linkage.externalConversationId,
          },
          order: {
            id: `order-${plan.traceId}`,
            role: 'buyer',
            serviceId: plan.service.servicePinId,
            serviceName: serviceDisplayName,
            paymentTxid,
            paymentCurrency: plan.payment.currency,
            paymentAmount: plan.payment.amount,
          },
          a2a: {
            sessionId: started.session.sessionId,
            taskRunId: started.taskRun.runId,
            role: started.session.role,
            publicStatus: publicStatus.status,
            latestEvent: started.event,
            taskRunState: started.taskRun.state,
            callerGlobalMetaId: started.session.callerGlobalMetaId,
            providerGlobalMetaId: started.session.providerGlobalMetaId,
            providerName: serviceDisplayName,
            servicePinId: started.session.servicePinId,
          },
        });

        const artifacts = await exportSessionArtifacts({
          trace,
          transcript: {
            sessionId: trace.session.id,
            title: trace.session.title,
            messages: [
              {
                id: `${trace.traceId}-user`,
                type: 'user',
                timestamp: trace.createdAt,
                content: request.userTask,
                metadata: {
                  taskContext: request.taskContext || null,
                },
              },
              {
                id: `${trace.traceId}-assistant`,
                type: 'assistant',
                timestamp: trace.createdAt,
                content: `Local MetaBot runtime created a remote MetaBot task session for ${serviceDisplayName}.`,
                metadata: {
                  servicePinId: plan.service.servicePinId,
                  providerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
                  confirmationPolicyMode: plan.confirmation.policyMode,
                  confirmationRequired: plan.confirmation.requiresConfirmation,
                  providerDaemonBaseUrl: request.providerDaemonBaseUrl || null,
                  orderPinId,
                  paymentTxid,
                },
              },
            ],
          },
        });

        await persistTraceRecord(runtimeStateStore, trace);

        let responseTrace = trace;
        let responseArtifacts = artifacts;
        let responseSession = started.session;
        let responseTaskRun = started.taskRun;
        let responseEvent = started.event;
        let responsePublicStatus = publicStatus.status;
        if (!request.providerDaemonBaseUrl) {
          const privateChatIdentity = await signer.getPrivateChatIdentity();
          const peerChatPublicKey = plan.service.providerGlobalMetaId === state.identity.globalMetaId
            ? state.identity.chatPublicKey
            : await resolvePeerChatPublicKey(plan.service.providerGlobalMetaId) ?? '';
          const reply = await callerReplyWaiter.awaitServiceReply({
            callerGlobalMetaId: privateChatIdentity.globalMetaId,
            callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
            providerGlobalMetaId: plan.service.providerGlobalMetaId,
            providerChatPublicKey: peerChatPublicKey,
            servicePinId: plan.service.servicePinId,
            paymentTxid,
            timeoutMs: DEFAULT_CALLER_FOREGROUND_WAIT_MS,
          });
          if (reply.state === 'completed') {
            const applied = await applyCallerReplyResult({
              reply,
              session: started.session,
              taskRun: started.taskRun,
              sessionEngine,
              sessionStateStore,
              runtimeStateStore,
              trace,
            });
            responseTrace = applied.trace;
            responseArtifacts = applied.artifacts;
            responseSession = applied.mutation.session;
            responseTaskRun = applied.mutation.taskRun;
            responseEvent = applied.mutation.event;
            responsePublicStatus = 'completed';
            providerReplyText = reply.responseText;
            deliveryPinId = reply.deliveryPinId;
          } else if (reply.state === 'timeout') {
            const timedOut = await applyCallerForegroundTimeout({
              session: started.session,
              taskRun: started.taskRun,
              sessionEngine,
              sessionStateStore,
              runtimeStateStore,
              trace,
            });
            responseTrace = timedOut.trace;
            responseArtifacts = timedOut.artifacts;
            responseSession = timedOut.mutation.session;
            responseTaskRun = timedOut.mutation.taskRun;
            responseEvent = timedOut.mutation.event;
            responsePublicStatus = 'timeout';
            scheduleCallerReplyContinuation({
              trace: timedOut.trace,
              sessionId: timedOut.mutation.session.sessionId,
              waiterInput: {
                callerGlobalMetaId: privateChatIdentity.globalMetaId,
                callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                providerGlobalMetaId: plan.service.providerGlobalMetaId,
                providerChatPublicKey: peerChatPublicKey,
                servicePinId: plan.service.servicePinId,
                paymentTxid,
                timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
              },
            });
          }
        }

        return commandSuccess({
          traceId: responseTrace.traceId,
          providerGlobalMetaId: plan.service.providerGlobalMetaId,
          serviceName: serviceDisplayName,
          service: plan.service,
          payment: plan.payment,
          confirmation: plan.confirmation,
          paymentTxid,
          orderPinId,
          ...(deliveryPinId ? { deliveryPinId } : {}),
          ...(providerReplyText ? { responseText: providerReplyText } : {}),
          session: {
            sessionId: responseSession.sessionId,
            taskRunId: responseTaskRun.runId,
            role: responseSession.role,
            state: responseSession.state,
            publicStatus: responsePublicStatus,
            event: responseEvent,
            coworkSessionId: started.linkage.coworkSessionId,
            externalConversationId: started.linkage.externalConversationId,
          },
          traceJsonPath: responseArtifacts.traceJsonPath,
          traceMarkdownPath: responseArtifacts.traceMarkdownPath,
          transcriptMarkdownPath: responseArtifacts.transcriptMarkdownPath,
        });
      },
      rate: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before publishing service ratings.');
        }

        const request = readServiceRateRequest(rawInput);
        if (!request.traceId) {
          return commandFailed('invalid_service_rating_request', 'Service rating request must include traceId.');
        }
        if (!Number.isFinite(request.rate) || request.rate < 1 || request.rate > 5) {
          return commandFailed('invalid_service_rating_score', 'Service rating score must be an integer from 1 to 5.');
        }
        if (!request.comment) {
          return commandFailed('invalid_service_rating_comment', 'Service rating request must include a non-empty comment.');
        }

        const trace = state.traces.find((entry) => entry.traceId === request.traceId);
        if (!trace) {
          return commandFailed('trace_not_found', `Trace not found: ${request.traceId}`);
        }
        if (normalizeText(trace.order?.role) !== 'buyer') {
          return commandFailed('service_rating_not_buyer_trace', 'Only buyer-side remote traces can publish service ratings.');
        }

        const serviceId = normalizeText(trace.order?.serviceId);
        const servicePrice = normalizeText(trace.order?.paymentAmount);
        const serviceCurrency = normalizeText(trace.order?.paymentCurrency);
        const servicePaidTx = normalizeText(trace.order?.paymentTxid);
        const serverBot = normalizeText(trace.session.peerGlobalMetaId ?? trace.a2a?.providerGlobalMetaId);
        if (!serviceId || !servicePrice || !serviceCurrency || !servicePaidTx || !serverBot) {
          return commandFailed(
            'service_rating_trace_incomplete',
            'Trace is missing service or payment metadata required for skill-service-rate.'
          );
        }

        const directory = await listRuntimeDirectoryServices({
          state,
          hotRoot: runtimeStateStore.paths.hotRoot,
          chainApiBaseUrl: input.chainApiBaseUrl,
          onlineOnly: false,
        });
        const matchedService = directory.services.find((entry) => (
          normalizeText(entry.servicePinId) === serviceId
          || normalizeText(entry.sourceServicePinId) === serviceId
        ));
        const serviceSkill = normalizeText(
          matchedService?.providerSkill
          ?? matchedService?.serviceName
          ?? trace.order?.serviceName
        );
        const payload = {
          serviceID: serviceId,
          servicePrice,
          serviceCurrency,
          servicePaidTx,
          serviceSkill: serviceSkill || normalizeText(trace.order?.serviceName),
          serverBot,
          rate: String(request.rate),
          comment: request.comment,
        };
        const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;

        let ratingWrite;
        try {
          ratingWrite = await signer.writePin({
            operation: 'create',
            path: '/protocols/skill-service-rate',
            encryption: '0',
            version: '1.0.0',
            contentType: 'application/json',
            payload: JSON.stringify(payload),
            network,
          });
        } catch (error) {
          return commandFailed(
            'service_rating_publish_failed',
            error instanceof Error ? error.message : String(error)
          );
        }

        const combinedMessage = buildServiceRatingFollowupMessage({
          comment: request.comment,
          ratingPinId: ratingWrite.pinId ?? null,
        });
        let ratingMessageSent = false;
        let ratingMessagePinId: string | null = null;
        let ratingMessageError: string | null = null;
        if (combinedMessage) {
          try {
            const privateChatIdentity = await signer.getPrivateChatIdentity();
            const peerChatPublicKey = serverBot === state.identity.globalMetaId
              ? state.identity.chatPublicKey
              : await resolvePeerChatPublicKey(serverBot) ?? '';
            if (!peerChatPublicKey) {
              throw new Error('Remote agent has no published chat public key on chain.');
            }

            const outgoingRatingMessage = sendPrivateChat({
              fromIdentity: {
                globalMetaId: privateChatIdentity.globalMetaId,
                privateKeyHex: privateChatIdentity.privateKeyHex,
              },
              toGlobalMetaId: serverBot,
              peerChatPublicKey,
              content: combinedMessage,
            });

            const ratingMessageWrite = await signer.writePin({
              operation: 'create',
              path: outgoingRatingMessage.path,
              encryption: outgoingRatingMessage.encryption,
              version: outgoingRatingMessage.version,
              contentType: outgoingRatingMessage.contentType,
              payload: outgoingRatingMessage.payload,
              encoding: 'utf-8',
              network,
            });
            ratingMessageSent = true;
            ratingMessagePinId = ratingMessageWrite.pinId ?? null;
          } catch (error) {
            ratingMessageError = error instanceof Error ? error.message : String(error);
          }
        }

        const sessionState = await sessionStateStore.readState();
        const latestSession = sessionState.sessions
          .filter((entry) => entry.traceId === request.traceId)
          .sort((left, right) => left.updatedAt - right.updatedAt)
          .at(-1);
        let nextTrace = trace;
        let nextArtifacts = trace.artifacts;
        if (latestSession) {
          await appendA2ATranscriptItems(sessionStateStore, [
            {
              id: `${trace.traceId}-caller-rating-${Date.now().toString(36)}`,
              sessionId: latestSession.sessionId,
              taskRunId: latestSession.currentTaskRunId,
              timestamp: Date.now(),
              type: 'rating',
              sender: 'caller',
              content: request.comment,
              metadata: {
                event: 'service_rating_published',
                rate: String(request.rate),
                ratingPinId: ratingWrite.pinId ?? null,
                ratingMessageSent,
                ratingMessagePinId,
                ratingMessageError,
              },
            },
          ]);
          if (combinedMessage) {
            await appendA2ATranscriptItems(sessionStateStore, [
              {
                id: `${trace.traceId}-caller-rating-followup-${Date.now().toString(36)}`,
                sessionId: latestSession.sessionId,
                taskRunId: latestSession.currentTaskRunId,
                timestamp: Date.now() + 1,
                type: ratingMessageSent ? 'assistant' : 'status_note',
                sender: ratingMessageSent ? 'caller' : 'system',
                content: ratingMessageSent
                  ? combinedMessage
                  : `Buyer-side rating was published on-chain, but provider follow-up delivery failed: ${ratingMessageError ?? 'unknown error'}`,
                metadata: {
                  event: ratingMessageSent ? 'service_rating_message_sent' : 'service_rating_message_failed',
                  ratingPinId: ratingWrite.pinId ?? null,
                  ratingMessagePinId,
                  ratingMessageError,
                },
              },
            ]);
          }
          const rebuilt = await rebuildCallerTraceArtifacts({
            baseTrace: trace,
            runtimeStateStore,
            sessionStateStore,
          });
          nextTrace = rebuilt.trace;
          nextArtifacts = rebuilt.artifacts;
        }

        return commandSuccess({
          traceId: request.traceId,
          path: '/protocols/skill-service-rate',
          pinId: ratingWrite.pinId ?? null,
          txids: ratingWrite.txids,
          rate: String(request.rate),
          comment: request.comment,
          serviceId,
          servicePaidTx,
          serverBot,
          serviceSkill: payload.serviceSkill,
          ratingMessageSent,
          ratingMessagePinId,
          ratingMessageError,
          traceJsonPath: nextArtifacts.traceJsonPath ?? nextTrace.artifacts.traceJsonPath,
          traceMarkdownPath: nextArtifacts.traceMarkdownPath ?? nextTrace.artifacts.traceMarkdownPath,
          transcriptMarkdownPath: nextArtifacts.transcriptMarkdownPath ?? nextTrace.artifacts.transcriptMarkdownPath,
        });
      },
      execute: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before serving remote calls.');
        }

        const execution = readExecuteServiceRequest(rawInput);
        if (
          !execution.servicePinId
          || !execution.providerGlobalMetaId
          || !execution.request.userTask
        ) {
          return commandFailed(
            'invalid_service_execution_request',
            'Execution request must include servicePinId, providerGlobalMetaId, and request.userTask.'
          );
        }

        if (execution.providerGlobalMetaId !== state.identity.globalMetaId) {
          return commandFailed('provider_identity_mismatch', 'Execution request does not match the local provider identity.');
        }

        const service = state.services.find((entry) => (
          entry.available === 1
          && entry.currentPinId === execution.servicePinId
          && entry.providerGlobalMetaId === execution.providerGlobalMetaId
        ));
        if (!service) {
          return commandFailed('service_not_found', `Published service was not found: ${execution.servicePinId}`);
        }

        const traceId = execution.traceId || `trace-${sanitizeServiceSegment(service.serviceName)}-${Date.now().toString(36)}`;
        const received = sessionEngine.receiveProviderTask({
          traceId,
          servicePinId: service.currentPinId,
          callerGlobalMetaId: execution.buyer.globalMetaId,
          providerGlobalMetaId: execution.providerGlobalMetaId,
          userTask: execution.request.userTask,
          taskContext: execution.request.taskContext,
        });
        const receivedStatus = await persistSessionMutation(sessionStateStore, received);
        await appendA2ATranscriptItems(sessionStateStore, [
          {
            id: `${traceId}-provider-received-task`,
            sessionId: received.session.sessionId,
            taskRunId: received.taskRun.runId,
            timestamp: received.session.createdAt,
            type: 'user_task',
            sender: 'caller',
            content: execution.request.userTask,
            metadata: {
              taskContext: execution.request.taskContext || null,
              callerGlobalMetaId: execution.buyer.globalMetaId || null,
              callerName: execution.buyer.name || execution.buyer.host || null,
              publicStatus: receivedStatus.status,
            },
          },
        ]);

        const runnerRegistry = createServiceRunnerRegistry([
          {
            servicePinId: service.currentPinId,
            providerSkill: service.providerSkill,
            runner: async ({ userTask, taskContext }) => ({
              state: 'completed',
              responseText: renderDemoRemoteServiceResponse({
                serviceName: service.serviceName,
                displayName: service.displayName,
                userTask,
                taskContext,
              }),
            }),
          },
        ]);
        const runnerResult = await runnerRegistry.execute({
          servicePinId: service.currentPinId,
          providerSkill: service.providerSkill,
          providerGlobalMetaId: execution.providerGlobalMetaId,
          userTask: execution.request.userTask,
          taskContext: execution.request.taskContext,
          metadata: {
            traceId,
            externalConversationId: execution.externalConversationId || null,
            buyer: execution.buyer,
          },
        });
        const applied = sessionEngine.applyProviderRunnerResult({
          session: received.session,
          taskRun: received.taskRun,
          result: runnerResult,
        });
        const appliedStatus = await persistSessionMutation(sessionStateStore, applied);
        const responseText = runnerResult.state === 'completed'
          ? normalizeText(runnerResult.responseText)
          : '';
        const providerMessage = runnerResult.state === 'completed'
          ? normalizeText(runnerResult.responseText)
          : runnerResult.state === 'needs_clarification'
            ? normalizeText(runnerResult.question)
            : normalizeText(runnerResult.message);
        await appendA2ATranscriptItems(sessionStateStore, [
          {
            id: `${traceId}-provider-runner-result`,
            sessionId: received.session.sessionId,
            taskRunId: applied.taskRun.runId,
            timestamp: applied.session.updatedAt,
            type: runnerResult.state === 'needs_clarification'
              ? 'clarification_request'
              : runnerResult.state === 'failed'
                ? 'failure'
                : 'assistant',
            sender: runnerResult.state === 'failed' ? 'system' : 'provider',
            content: providerMessage,
            metadata: {
              publicStatus: appliedStatus.status,
              event: applied.event,
              runnerState: runnerResult.state,
            },
          },
        ]);

        const trace = buildSessionTrace({
          traceId,
          channel: 'a2a',
          exportRoot: runtimeStateStore.paths.exportRoot,
          session: {
            id: `session-${traceId}`,
            title: `${service.displayName} Execution`,
            type: 'a2a',
            metabotId: state.identity.metabotId,
            peerGlobalMetaId: execution.buyer.globalMetaId || null,
            peerName: execution.buyer.name || execution.buyer.host || null,
            externalConversationId: execution.externalConversationId || null,
          },
          order: {
            id: `order-${traceId}`,
            role: 'seller',
            serviceId: service.currentPinId,
            serviceName: service.displayName,
            paymentTxid: null,
            paymentCurrency: service.currency,
            paymentAmount: service.price,
          },
          a2a: {
            sessionId: received.session.sessionId,
            taskRunId: applied.taskRun.runId,
            role: received.session.role,
            publicStatus: appliedStatus.status,
            latestEvent: applied.event,
            taskRunState: applied.taskRun.state,
            callerGlobalMetaId: received.session.callerGlobalMetaId,
            callerName: execution.buyer.name || execution.buyer.host || null,
            providerGlobalMetaId: received.session.providerGlobalMetaId,
            servicePinId: received.session.servicePinId,
          },
        });

        const artifacts = await exportSessionArtifacts({
          trace,
          transcript: {
            sessionId: trace.session.id,
            title: trace.session.title,
            messages: [
              {
                id: `${trace.traceId}-buyer`,
                type: 'user',
                timestamp: trace.createdAt,
                content: execution.request.userTask,
                metadata: {
                  taskContext: execution.request.taskContext || null,
                  buyerHost: execution.buyer.host || null,
                  buyerGlobalMetaId: execution.buyer.globalMetaId || null,
                },
              },
              {
                id: `${trace.traceId}-provider`,
                type: 'assistant',
                timestamp: trace.createdAt,
                content: providerMessage,
                metadata: {
                  servicePinId: service.currentPinId,
                  providerGlobalMetaId: state.identity.globalMetaId,
                  providerSessionId: received.session.sessionId,
                  providerTaskRunId: received.taskRun.runId,
                  providerEvent: applied.event,
                },
              },
            ],
          },
        });

        await runtimeStateStore.writeState({
          ...state,
          traces: [
            trace,
            ...state.traces.filter((entry) => entry.traceId !== trace.traceId),
          ],
        });

        if (runnerResult.state === 'needs_clarification') {
          return commandManualActionRequired(
            'clarification_needed',
            runnerResult.question,
            `/ui/trace?traceId=${encodeURIComponent(trace.traceId)}`,
          );
        }
        if (runnerResult.state === 'failed') {
          return commandFailed(runnerResult.code, runnerResult.message);
        }

        return commandSuccess({
          traceId: trace.traceId,
          externalConversationId: trace.session.externalConversationId,
          responseText,
          providerGlobalMetaId: state.identity.globalMetaId,
          servicePinId: service.currentPinId,
          serviceName: service.displayName,
          traceJsonPath: artifacts.traceJsonPath,
          traceMarkdownPath: artifacts.traceMarkdownPath,
          transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
        });
      },
    },
    chat: {
      private: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before sending private chat.');
        }

        const request = readPrivateChatRequest(rawInput);
        if (!request.to || !request.content) {
          return commandFailed('invalid_chat_request', 'Private chat request must include to and content.');
        }

        let privateChatIdentity;
        try {
          privateChatIdentity = await signer.getPrivateChatIdentity();
        } catch (error) {
          return commandFailed(
            'identity_secret_missing',
            error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.'
          );
        }

        let peerChatPublicKey = request.peerChatPublicKey;
        if (!peerChatPublicKey && request.to === state.identity.globalMetaId) {
          peerChatPublicKey = state.identity.chatPublicKey;
        }
        if (!peerChatPublicKey) {
          peerChatPublicKey = await resolvePeerChatPublicKey(request.to) ?? '';
        }
        if (!peerChatPublicKey) {
          return commandFailed(
            'peer_chat_public_key_missing',
            'Target has no chat public key on chain and none was provided.'
          );
        }

        const sent = sendPrivateChat({
          fromIdentity: {
            globalMetaId: privateChatIdentity.globalMetaId,
            privateKeyHex: privateChatIdentity.privateKeyHex,
          },
          toGlobalMetaId: request.to,
          peerChatPublicKey,
          content: request.content,
          replyPinId: request.replyPin,
        });
        const structuredContent = describeStructuredPrivateChatContent(request.content);

        const traceId = `trace-private-${Date.now().toString(36)}`;
        const trace = buildSessionTrace({
          traceId,
          channel: 'simplemsg',
          exportRoot: runtimeStateStore.paths.exportRoot,
          session: {
            id: `chat-${traceId}`,
            title: 'Private Chat',
            type: 'a2a',
            metabotId: state.identity.metabotId,
            peerGlobalMetaId: request.to,
            peerName: null,
            externalConversationId: `simplemsg:${state.identity.globalMetaId}:${request.to}:${traceId}`,
          },
        });

        const artifacts = await exportSessionArtifacts({
          trace,
          transcript: {
            sessionId: trace.session.id,
            title: trace.session.title,
            messages: [
              {
                id: `${trace.traceId}-user`,
                type: 'user',
                timestamp: trace.createdAt,
                content: request.content,
              },
              {
                id: `${trace.traceId}-assistant`,
                type: 'assistant',
                timestamp: trace.createdAt,
                content: `Encrypted private message prepared for ${request.to}.`,
                metadata: {
                  path: sent.path,
                  replyPin: request.replyPin || null,
                  messageType: structuredContent.messageType,
                  requestId: structuredContent.requestId,
                  correlatedTraceId: structuredContent.traceId,
                },
              },
            ],
          },
        });

        await runtimeStateStore.writeState({
          ...state,
          traces: [
            trace,
            ...state.traces.filter((entry) => entry.traceId !== trace.traceId),
          ],
        });

        return commandSuccess({
          to: request.to,
          path: sent.path,
          payload: sent.payload,
          encryptedContent: sent.encryptedContent,
          secretVariant: sent.secretVariant,
          deliveryMode: 'local_runtime',
          peerChatPublicKey,
          messageType: structuredContent.messageType,
          requestId: structuredContent.requestId,
          correlatedTraceId: structuredContent.traceId,
          traceId: trace.traceId,
          transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
          traceMarkdownPath: artifacts.traceMarkdownPath,
          traceJsonPath: artifacts.traceJsonPath,
        });
      },
    },
    file: {
      upload: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before uploading files.');
        }

        try {
          const result = await uploadLocalFileToChain({
            filePath: normalizeText(rawInput.filePath),
            contentType: typeof rawInput.contentType === 'string' ? rawInput.contentType : undefined,
            network: typeof rawInput.network === 'string' ? rawInput.network : undefined,
            signer,
          });
          return commandSuccess(result);
        } catch (error) {
          return commandFailed(
            'file_upload_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
    trace: {
      getTrace: async ({ traceId }) => {
        const state = await runtimeStateStore.readState();
        const trace = state.traces.find((entry) => entry.traceId === traceId);
        if (!trace) {
          return commandFailed('trace_not_found', `Trace not found: ${traceId}`);
        }
        return commandSuccess(
          await buildTraceInspectorPayload({
            traceId,
            trace,
            sessionStateStore,
            ratingDetailStateStore,
            chainApiBaseUrl: input.chainApiBaseUrl,
          })
        );
      },
      watchTrace: async ({ traceId }) => {
        const normalizedTraceId = normalizeText(traceId);
        if (!normalizedTraceId) {
          return '';
        }

        const deadline = Date.now() + DEFAULT_TRACE_WATCH_WAIT_MS;
        while (true) {
          const sessionState = await sessionStateStore.readState();
          const events = buildTraceWatchEvents({
            traceId: normalizedTraceId,
            sessions: sessionState.sessions,
            snapshots: sessionState.publicStatusSnapshots,
          });
          if (events.length > 0) {
            const serialized = serializeTraceWatchEvents(events);
            if (events.at(-1)?.terminal || Date.now() >= deadline) {
              return serialized;
            }
          } else {
            const runtimeState = await runtimeStateStore.readState();
            const traceExists = runtimeState.traces.some((entry) => entry.traceId === normalizedTraceId)
              || sessionState.sessions.some((entry) => normalizeText(entry.traceId) === normalizedTraceId);
            if (!traceExists || Date.now() >= deadline) {
              return '';
            }
          }

          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            const finalState = await sessionStateStore.readState();
            const finalEvents = buildTraceWatchEvents({
              traceId: normalizedTraceId,
              sessions: finalState.sessions,
              snapshots: finalState.publicStatusSnapshots,
            });
            return serializeTraceWatchEvents(finalEvents);
          }
          await sleep(Math.min(TRACE_WATCH_POLL_INTERVAL_MS, remainingMs));
        }
      },
    },
  };
}
