import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  commandFailed,
  commandManualActionRequired,
  commandSuccess,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import {
  createRuntimeStateStore,
  type RuntimeDaemonRecord,
  type RuntimeIdentityRecord,
  type RuntimeState,
} from '../core/state/runtimeStateStore';
import type { MetabotDaemonHttpHandlers } from './routes/types';
import { buildPublishedService } from '../core/services/publishService';
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
import {
  createSocketIoMetaWebReplyWaiter,
  type AwaitMetaWebServiceReplyResult,
  type MetaWebServiceReplyWaiter,
} from '../core/a2a/metawebReplyWaiter';

const DIRECTORY_SEEDS_FILE = 'directory-seeds.json';
const DEFAULT_CALLER_FOREGROUND_WAIT_MS = 15_000;
const DEFAULT_TRACE_WATCH_WAIT_MS = 20_000;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeServiceSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'service';
}

function resolvePaymentAddress(identity: RuntimeIdentityRecord, currency: string): string {
  const normalized = normalizeText(currency).toUpperCase();
  if (normalized === 'BTC') return identity.btcAddress;
  if (normalized === 'DOGE') return identity.dogeAddress;
  return identity.mvcAddress;
}

function summarizeService(record: ReturnType<typeof buildPublishedService>['record']) {
  return {
    servicePinId: record.currentPinId,
    sourceServicePinId: record.sourceServicePinId,
    chainPinIds: [record.sourceServicePinId, record.currentPinId].filter(Boolean),
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
  return {
    to: normalizeText(rawInput.to),
    content: normalizeText(rawInput.content),
    replyPin: normalizeText(rawInput.replyPin),
    peerChatPublicKey: normalizeText(rawInput.peerChatPublicKey),
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
  return `${displayName || 'Remote MetaBot'} completed the remote request: ${userTask}.${contextSuffix}`.trim();
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

async function buildTraceInspectorPayload(input: {
  traceId: string;
  trace: ReturnType<typeof buildSessionTrace>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
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

  return {
    ...input.trace,
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
  await appendA2ATranscriptItems(input.sessionStateStore, [
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

async function applyCallerForegroundTimeout(input: {
  session: A2ASessionRecord;
  taskRun: A2ATaskRunRecord;
  sessionEngine: ReturnType<typeof createA2ASessionEngine>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  trace: SessionTraceRecord;
}): Promise<{ trace: SessionTraceRecord; artifacts: Awaited<ReturnType<typeof exportSessionArtifacts>> }> {
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

  return rebuildCallerTraceArtifacts({
    baseTrace: input.trace,
    runtimeStateStore: input.runtimeStateStore,
    sessionStateStore: input.sessionStateStore,
  });
}

export function createDefaultMetabotDaemonHandlers(input: {
  homeDir: string;
  getDaemonRecord: () => RuntimeDaemonRecord | null;
  secretStore?: SecretStore;
  signer?: Signer;
  identitySyncStepDelayMs?: number;
  chainApiBaseUrl?: string;
  fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  callerReplyWaiter?: MetaWebServiceReplyWaiter;
  requestMvcGasSubsidy?: (
    options: RequestMvcGasSubsidyOptions
  ) => Promise<RequestMvcGasSubsidyResult>;
}): MetabotDaemonHttpHandlers {
  const secretStore = input.secretStore ?? createFileSecretStore(input.homeDir);
  const signer = input.signer ?? createLocalMnemonicSigner({ secretStore });
  const runtimeStateStore = createRuntimeStateStore(input.homeDir);
  const sessionStateStore = createSessionStateStore(input.homeDir);
  const sessionEngine = createA2ASessionEngine();
  const resolvePeerChatPublicKey = input.fetchPeerChatPublicKey ?? fetchPeerChatPublicKey;
  const callerReplyWaiter = input.callerReplyWaiter ?? createSocketIoMetaWebReplyWaiter();

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
          return commandFailed('missing_name', 'MetaBot name is required.');
        }

        const state = await runtimeStateStore.readState();
        if (isIdentityBootstrapReady(state.identity)) {
          return commandSuccess(state.identity);
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
          return commandSuccess(nextState.identity);
        }

        return commandFailed(
          'identity_bootstrap_failed',
          bootstrap.error ?? 'MetaBot bootstrap failed before the identity was ready.'
        );
      },
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

        const now = Date.now();
        const servicePinId = `service-${sanitizeServiceSegment(serviceName)}-${now.toString(36)}`;
        const published = buildPublishedService({
          sourceServicePinId: servicePinId,
          currentPinId: servicePinId,
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
        });

        await runtimeStateStore.writeState({
          ...state,
          services: [
            published.record,
            ...state.services.filter((service) => service.currentPinId !== published.record.currentPinId),
          ],
        });

        return commandSuccess(summarizeService(published.record));
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
              'Remote MetaBot has no published chat public key on chain.'
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
          })
        );
      },
      watchTrace: async ({ traceId }) => {
        const sessionState = await sessionStateStore.readState();
        const events = buildTraceWatchEvents({
          traceId,
          sessions: sessionState.sessions,
          snapshots: sessionState.publicStatusSnapshots,
        });
        return serializeTraceWatchEvents(events);
      },
    },
  };
}
