import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  commandAwaitingConfirmation,
  commandFailed,
  commandManualActionRequired,
  commandSuccess,
  commandWaiting,
  type MetabotCommandResult,
} from '../core/contracts/commandResult';
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import {
  listIdentityProfiles,
  setActiveMetabotHome,
  upsertIdentityProfile,
} from '../core/identity/identityProfiles';
import {
  ensureProfileWorkspace,
  resolveIdentityCreateProfileHome,
} from '../core/identity/profileWorkspace';
import { resolveProfileNameMatch } from '../core/identity/profileNameResolution';
import {
  createRuntimeStateStore,
  type RuntimeDaemonRecord,
  type RuntimeIdentityRecord,
  type RuntimeState,
} from '../core/state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../core/state/paths';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import { discoverLlmRuntimes } from '../core/llm/llmRuntimeDiscovery';
import {
  isLlmProvider,
  normalizeLlmBinding,
} from '../core/llm/llmTypes';
import type { LlmProvider, LlmRuntime } from '../core/llm/llmTypes';
import type { LlmExecutor, LlmExecutionRequest } from '../core/llm/executor';
import {
  buildMetabotProfileDraftFromIdentity,
  createMetabotProfileFromIdentity,
  deleteMetabotProfile,
  getMetabotProfile,
  getMetabotMnemonicBackup,
  getMetabotWalletInfo,
  listMetabotProfiles,
  syncMetabotInfoToChain,
  updateMetabotProfile,
  validateAvatarDataUrl,
} from '../core/bot/metabotProfileManager';
import type {
  CreateMetabotInput,
  MetabotProfileFull,
  UpdateMetabotInfoInput,
} from '../core/bot/metabotProfileManager';
import type { MetabotDaemonHttpHandlers } from './routes/types';
import { buildPublishedService } from '../core/services/publishService';
import { publishServiceToChain } from '../core/services/servicePublishChain';
import { createPlatformSkillCatalog } from '../core/services/platformSkillCatalog';
import { validateServicePublishProviderSkill } from '../core/services/servicePublishValidation';
import { createProviderServiceRunner } from '../core/a2a/provider/providerServiceRunner';
import { buildProviderConsoleSnapshot, type ProviderConsoleTraceRecord } from '../core/provider/providerConsole';
import { createProviderPresenceStateStore } from '../core/provider/providerPresenceState';
import { createRatingDetailStateStore } from '../core/ratings/ratingDetailState';
import { refreshRatingDetailCacheFromChain } from '../core/ratings/ratingDetailSync';
import { planRemoteCall } from '../core/delegation/remoteCall';
import { buildSessionTrace } from '../core/chat/sessionTrace';
import type { SessionTraceRecord } from '../core/chat/sessionTrace';
import { exportSessionArtifacts } from '../core/chat/transcriptExport';
import { sendPrivateChat } from '../core/chat/privateChat';
import { loadChatPersona } from '../core/chat/chatPersonaLoader';
import { createDefaultChatReplyRunner } from '../core/chat/defaultChatReplyRunner';
import type { ChatReplyRunner } from '../core/chat/privateChatTypes';
import type { ChainWriteRequest, ChainWriteResult } from '../core/chain/writePin';
import {
  buildPrivateConversationResponse,
  normalizeConversationAfterIndex,
  normalizeConversationLimit,
  type ChatViewerMessage,
  type FetchPrivateHistory,
} from '../core/chat/privateConversation';
import { createLocalMnemonicSigner } from '../core/signing/localMnemonicSigner';
import type { SecretStore } from '../core/secrets/secretStore';
import type { Signer } from '../core/signing/signer';
import { uploadLocalFileToChain } from '../core/files/uploadFile';
import { postBuzzToChain } from '../core/buzz/postBuzz';
import { runBootstrapFlow } from '../core/bootstrap/bootstrapFlow';
import { readChainDirectoryWithFallback } from '../core/discovery/chainDirectoryReader';
import {
  buildOnlineServiceCacheState,
  createOnlineServiceCacheStore,
  searchOnlineServiceCacheServices,
} from '../core/discovery/onlineServiceCache';
import { HEARTBEAT_ONLINE_WINDOW_SEC } from '../core/discovery/chainHeartbeatDirectory';
import { readOnlineMetaBotsFromSocketPresence } from '../core/discovery/socketPresenceDirectory';
import { createSessionStateStore, type A2ATranscriptItemRecord } from '../core/a2a/sessionStateStore';
import { createPrivateChatStateStore } from '../core/chat/privateChatStateStore';
import type { PrivateChatAutoReplyConfig } from '../core/chat/privateChatTypes';
import { createA2ASessionEngine, type A2ASessionEngineEvent } from '../core/a2a/sessionEngine';
import { resolvePublicStatus, type PublicStatus } from '../core/a2a/publicStatus';
import type { ProviderServiceRunnerResult } from '../core/a2a/provider/serviceRunnerContracts';
import type { A2ASessionRecord, A2ATaskRunRecord } from '../core/a2a/sessionTypes';
import { buildTraceWatchEvents, serializeTraceWatchEvents } from '../core/a2a/watch/traceWatch';
import { isTerminalTraceWatchStatus } from '../core/a2a/watch/watchEvents';
import {
  buildA2APeerSessionId,
  persistA2AConversationMessage,
  persistA2AConversationMessageBestEffort,
  type A2AConversationMessagePersister,
} from '../core/a2a/conversationPersistence';
import {
  findUnifiedA2ATraceSessionForProfileByOrder,
  getUnifiedA2ATraceSessionForProfile,
  listUnifiedA2ATraceSessionsForProfile,
  type UnifiedA2ATraceSessionDetail,
} from '../core/a2a/traceProjection';
import {
  createLocalIdentitySyncStep,
  createLocalMetabotStep,
  createMetabotSubsidyStep,
  isIdentityBootstrapReady,
} from '../core/bootstrap/localIdentityBootstrap';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import { buildDelegationOrderPayload } from '../core/orders/delegationOrderMessage';
import {
  executeServiceOrderPayment,
  createWalletServicePaymentExecutor,
  type A2AOrderPaymentResult,
  type ServicePaymentExecutor,
} from '../core/payments/servicePayment';
import type { ChainAdapterRegistry } from '../core/chain/adapters/types';
import { createChainAdapterRegistry } from '../core/chain/adapters/registry';
import { mvcChainAdapter } from '../core/chain/adapters/mvc';
import { btcChainAdapter } from '../core/chain/adapters/btc';
import { dogeChainAdapter } from '../core/chain/adapters/doge';
import { createConfigStore } from '../core/config/configStore';
import {
  createSocketIoMetaWebReplyWaiter,
  normalizeOrderProtocolReference,
  type AwaitMetaWebServiceReplyInput,
  type AwaitMetaWebServiceReplyResult,
  type MetaWebServiceReplyWaiter,
} from '../core/a2a/metawebReplyWaiter';
import {
  buildOrderEndMessage,
  parseDeliveryMessage,
  parseNeedsRatingMessage,
  parseOrderEndMessage,
  parseOrderStatusMessage,
} from '../core/a2a/protocol/orderProtocol';
import { generateBuyerServiceRating } from '../core/a2a/callerRating';
import { parseMasterRequest, parseMasterResponse, type MasterResponseMessage } from '../core/master/masterMessageSchema';
import {
  type AwaitMetaWebMasterReplyInput,
  type AwaitMetaWebMasterReplyResult,
  type MetaWebMasterReplyWaiter,
} from '../core/master/metawebMasterReplyWaiter';
import { handleMasterProviderRequest } from '../core/master/masterProviderRuntime';
import { listMasters, readChainMasterDirectoryWithFallback, summarizePublishedMaster } from '../core/master/masterDirectory';
import { createPendingMasterAskStateStore, type PendingMasterAskRecord } from '../core/master/masterPendingAskState';
import { createPublishedMasterStateStore } from '../core/master/masterPublishedState';
import { buildMasterAskPreview } from '../core/master/masterPreview';
import {
  buildMasterTraceMetadata,
  buildMasterTraceView,
  type AskMasterTraceAutoMetadata,
} from '../core/master/masterTrace';
import { prepareAutoMasterAskPlan } from '../core/master/masterAutoOrchestrator';
import { prepareManualAskHostAction } from '../core/master/masterHostAdapter';
import {
  createMasterAutoFeedbackStateStore,
  deriveMasterTriggerMemoryStateFromAutoFeedbackState,
  findRecentAutoFeedbackForTarget,
} from '../core/master/masterAutoFeedbackState';
import {
  buildTriggerObservationFromHostContext,
  buildTriggerObservationFromHostObservationFrame,
} from '../core/master/masterHostSignalBridge';
import { evaluateMasterPolicy } from '../core/master/masterPolicyGate';
import { resolveMasterCandidate, selectMasterCandidate } from '../core/master/masterSelector';
import { publishMasterToChain } from '../core/master/masterServicePublish';
import { validateMasterServicePayload } from '../core/master/masterServiceSchema';
import {
  buildMasterSuggestionId,
  createMasterSuggestStateStore,
  deriveMasterTriggerMemoryStateFromSuggestState,
  type StoredMasterSuggestRecord,
} from '../core/master/masterSuggestState';
import {
  collectAndEvaluateMasterTrigger,
  createMasterTriggerMemoryState,
  mergeMasterTriggerMemoryStates,
  recordMasterTriggerOutcome,
  type TriggerDecision,
  type TriggerObservation,
} from '../core/master/masterTriggerEngine';
import type { MasterDirectoryItem, PublishedMasterRecord } from '../core/master/masterTypes';

const DEFAULT_CALLER_BACKGROUND_WAIT_MS = 30 * 60 * 1000;
const DEFAULT_TRACE_WATCH_WAIT_MS = 75_000;
const TRACE_WATCH_POLL_INTERVAL_MS = 500;
const PROVIDER_RATING_SYNC_STALE_MS = 30_000;
const DEFAULT_MASTER_HOST_MODE = 'codex';
const DEFAULT_NETWORK_BOT_LIST_LIMIT = 20;
const MAX_NETWORK_BOT_LIST_LIMIT = 100;
const DEFAULT_RATING_FOLLOWUP_RETRY_DELAYS_MS = [1_500, 5_000, 10_000];

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isMempoolConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /txn-mempool-conflict|mempool[-\s]?conflict/i.test(message);
}

function normalizeRetryDelays(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isFinite(entry) && entry >= 0)
    .map((entry) => Math.trunc(entry));
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function buildLlmExecutionRequest(body: Record<string, unknown>, runtime: LlmExecutionRequest['runtime']): LlmExecutionRequest | null {
  const runtimeId = normalizeText(body.runtimeId);
  const prompt = normalizeText(body.prompt);
  if (!runtimeId || !prompt) return null;

  return {
    runtimeId,
    runtime,
    prompt,
    systemPrompt: normalizeText(body.systemPrompt) || undefined,
    maxTurns: normalizePositiveInteger(body.maxTurns),
    timeout: normalizePositiveInteger(body.timeout),
    semanticInactivityTimeout: normalizePositiveInteger(body.semanticInactivityTimeout),
    cwd: normalizeText(body.cwd) || undefined,
    skills: normalizeStringArray(body.skills),
    resumeSessionId: normalizeText(body.resumeSessionId) || undefined,
    model: normalizeText(body.model) || undefined,
    metaBotSlug: normalizeText(body.metaBotSlug) || undefined,
    env: normalizeStringRecord(body.env),
    extraArgs: normalizeStringArray(body.extraArgs),
  };
}

function hasOwnField(input: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, field);
}

function normalizeMetabotProviderInput(value: unknown): LlmProvider | null {
  if (value === null) return null;
  const provider = normalizeText(value);
  if (!provider) return null;
  if (!isLlmProvider(provider) || provider === 'custom') {
    throw new Error(`Unsupported LLM provider: ${provider}`);
  }
  return provider;
}

function buildMetabotUpdateInput(input: Record<string, unknown>): UpdateMetabotInfoInput {
  const update: UpdateMetabotInfoInput = {};
  if (hasOwnField(input, 'name')) {
    update.name = normalizeText(input.name);
    if (!update.name) {
      throw new Error('MetaBot name is required.');
    }
  }
  if (hasOwnField(input, 'role')) {
    update.role = typeof input.role === 'string' ? input.role : '';
  }
  if (hasOwnField(input, 'soul')) {
    update.soul = typeof input.soul === 'string' ? input.soul : '';
  }
  if (hasOwnField(input, 'goal')) {
    update.goal = typeof input.goal === 'string' ? input.goal : '';
  }
  if (hasOwnField(input, 'avatarDataUrl')) {
    update.avatarDataUrl = normalizeText(input.avatarDataUrl);
    const avatarValidation = validateAvatarDataUrl(update.avatarDataUrl);
    if (!avatarValidation.valid) {
      throw new Error(avatarValidation.error ?? 'Invalid avatar data URL.');
    }
  }
  if (hasOwnField(input, 'primaryProvider')) {
    update.primaryProvider = normalizeMetabotProviderInput(input.primaryProvider);
  }
  if (hasOwnField(input, 'fallbackProvider')) {
    update.fallbackProvider = normalizeMetabotProviderInput(input.fallbackProvider);
  }
  return update;
}

function buildMetabotCreateInput(input: Record<string, unknown>): CreateMetabotInput {
  const name = normalizeText(input.name);
  if (!name) {
    throw new Error('MetaBot name is required.');
  }
  const createInput: CreateMetabotInput = { name };
  if (hasOwnField(input, 'role')) {
    createInput.role = typeof input.role === 'string' ? input.role : '';
  }
  if (hasOwnField(input, 'soul')) {
    createInput.soul = typeof input.soul === 'string' ? input.soul : '';
  }
  if (hasOwnField(input, 'goal')) {
    createInput.goal = typeof input.goal === 'string' ? input.goal : '';
  }
  if (hasOwnField(input, 'avatarDataUrl')) {
    createInput.avatarDataUrl = normalizeText(input.avatarDataUrl);
    const avatarValidation = validateAvatarDataUrl(createInput.avatarDataUrl);
    if (!avatarValidation.valid) {
      throw new Error(avatarValidation.error ?? 'Invalid avatar data URL.');
    }
  }
  if (hasOwnField(input, 'primaryProvider')) {
    createInput.primaryProvider = normalizeMetabotProviderInput(input.primaryProvider);
  }
  if (hasOwnField(input, 'fallbackProvider')) {
    createInput.fallbackProvider = normalizeMetabotProviderInput(input.fallbackProvider);
  }
  return createInput;
}

function calculateMetabotChangedFields(
  current: MetabotProfileFull,
  update: UpdateMetabotInfoInput,
): string[] {
  const changedFields: string[] = [];
  if (update.name !== undefined && update.name !== current.name) changedFields.push('name');
  if (update.role !== undefined && update.role !== current.role) changedFields.push('role');
  if (update.soul !== undefined && update.soul !== current.soul) changedFields.push('soul');
  if (update.goal !== undefined && update.goal !== current.goal) changedFields.push('goal');
  if (update.avatarDataUrl !== undefined && (update.avatarDataUrl || undefined) !== current.avatarDataUrl) {
    changedFields.push('avatar');
  }
  if (update.primaryProvider !== undefined && update.primaryProvider !== (current.primaryProvider ?? null)) {
    changedFields.push('primaryProvider');
  }
  if (update.fallbackProvider !== undefined && update.fallbackProvider !== (current.fallbackProvider ?? null)) {
    changedFields.push('fallbackProvider');
  }
  return changedFields;
}

function buildMetabotChainProfile(
  current: MetabotProfileFull,
  update: UpdateMetabotInfoInput,
): MetabotProfileFull {
  return {
    ...current,
    name: update.name ?? current.name,
    role: update.role ?? current.role,
    soul: update.soul ?? current.soul,
    goal: update.goal ?? current.goal,
    ...(update.avatarDataUrl !== undefined
      ? (update.avatarDataUrl ? { avatarDataUrl: update.avatarDataUrl } : { avatarDataUrl: undefined })
      : {}),
    primaryProvider: update.primaryProvider !== undefined ? update.primaryProvider : (current.primaryProvider ?? null),
    fallbackProvider: update.fallbackProvider !== undefined ? update.fallbackProvider : (current.fallbackProvider ?? null),
  };
}

function calculateMetabotCreateChainFields(input: CreateMetabotInput): string[] {
  const changedFields: string[] = [];
  if (
    input.role !== undefined
    || input.soul !== undefined
    || input.goal !== undefined
    || input.primaryProvider !== undefined
    || input.fallbackProvider !== undefined
  ) {
    changedFields.push('role');
  }
  if (normalizeText(input.avatarDataUrl)) {
    changedFields.push('avatar');
  }
  return changedFields;
}

async function validateMetabotProviderAvailability(
  profile: MetabotProfileFull,
  update: UpdateMetabotInfoInput,
): Promise<void> {
  const requestedProviders: LlmProvider[] = [];
  if (
    update.primaryProvider !== undefined
    && update.primaryProvider !== null
    && update.primaryProvider !== (profile.primaryProvider ?? null)
  ) {
    requestedProviders.push(update.primaryProvider);
  }
  if (
    update.fallbackProvider !== undefined
    && update.fallbackProvider !== null
    && update.fallbackProvider !== (profile.fallbackProvider ?? null)
  ) {
    requestedProviders.push(update.fallbackProvider);
  }
  if (requestedProviders.length === 0) {
    return;
  }
  const runtimeState = await createLlmRuntimeStore(resolveMetabotPaths(profile.homeDir)).read();
  for (const provider of requestedProviders) {
    const available = runtimeState.runtimes.some((runtime) => (
      runtime.provider === provider && runtime.health !== 'unavailable'
    ));
    if (!available) {
      throw new Error(`No available runtime found for provider: ${provider}`);
    }
  }
}

async function writePinRetryingMempoolConflict(input: {
  signer: Signer;
  request: ChainWriteRequest;
  retryDelaysMs: number[];
}) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await input.signer.writePin(input.request);
    } catch (error) {
      const delayMs = input.retryDelaysMs[attempt];
      if (delayMs === undefined || !isMempoolConflictError(error)) {
        throw error;
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }
}

async function ensureDefaultPersonaFiles(paths: MetabotPaths, metabotName: string): Promise<void> {
  const files: Array<{ filePath: string; content: string }> = [
    {
      filePath: paths.roleMdPath,
      content: [
        `I am ${metabotName}, a MetaBot on the Open Agent Connect network.`,
        '',
        '<!-- Edit this file to define your MetaBot\'s role. Example: -->',
        '<!-- I am a coding assistant who specializes in TypeScript and Node.js. -->',
      ].join('\n'),
    },
    {
      filePath: paths.soulMdPath,
      content: [
        'I am friendly, curious, and concise.',
        '',
        '<!-- Edit this file to define your MetaBot\'s personality and communication style. Example: -->',
        '<!-- I prefer short, direct messages. I like to ask good questions and share useful insights. -->',
      ].join('\n'),
    },
    {
      filePath: paths.goalMdPath,
      content: [
        'Get to know other MetaBots and explore collaboration opportunities.',
        '',
        '<!-- Edit this file to define your MetaBot\'s conversation goals. Example: -->',
        '<!-- Understand what the other MetaBot can do and find ways to work together on coding tasks. -->',
      ].join('\n'),
    },
  ];

  for (const file of files) {
    try {
      await fs.access(file.filePath);
    } catch {
      try {
        await fs.writeFile(file.filePath, `${file.content}\n`, 'utf8');
      } catch {
        // Best effort: do not fail identity creation if persona files cannot be written.
      }
    }
  }
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
  if (normalized === 'BTC') return identity.addresses.btc ?? identity.mvcAddress;
  if (normalized === 'DOGE') return identity.addresses.doge ?? identity.mvcAddress;
  return identity.mvcAddress;
}

export function resolveServiceOrderPaymentMetadata(currency: unknown): {
  paymentChain?: 'mvc' | 'btc';
  settlementKind?: 'native';
} {
  const normalized = normalizeText(currency).toUpperCase();
  if (normalized === 'SPACE' || normalized === 'MVC') {
    return {
      paymentChain: 'mvc',
      settlementKind: 'native',
    };
  }
  if (normalized === 'BTC') {
    return {
      paymentChain: 'btc',
      settlementKind: 'native',
    };
  }
  return {};
}

function buildDaemonLocalUiUrl(
  daemon: RuntimeDaemonRecord | null | undefined,
  pathname: string,
  query: Record<string, string | null | undefined> = {},
): string | undefined {
  const baseUrl = normalizeText(daemon?.baseUrl);
  if (!baseUrl) {
    return undefined;
  }

  const url = new URL(pathname, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    const normalized = normalizeText(value);
    if (normalized) {
      url.searchParams.set(key, normalized);
    }
  }
  return url.toString();
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
    online: false,
    lastSeenSec: null,
    lastSeenAt: null,
    updatedAt: record.updatedAt,
  };
}

function normalizeComparableGlobalMetaId(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function buildSocketPresenceLastSeenIndex(
  bots: Array<{ globalMetaId?: unknown; lastSeenAt?: unknown; lastSeenAgoSeconds?: unknown; name?: unknown }>
): Map<string, { lastSeenAt: number | null; lastSeenAgoSeconds: number; name: string }> {
  const index = new Map<string, { lastSeenAt: number | null; lastSeenAgoSeconds: number; name: string }>();
  for (const bot of bots) {
    const globalMetaId = normalizeComparableGlobalMetaId(bot.globalMetaId);
    if (!globalMetaId || index.has(globalMetaId)) {
      continue;
    }
    const lastSeenAt = typeof bot.lastSeenAt === 'number' && Number.isFinite(bot.lastSeenAt) && bot.lastSeenAt > 0
      ? Math.floor(bot.lastSeenAt)
      : null;
    const lastSeenAgoSeconds = typeof bot.lastSeenAgoSeconds === 'number' && Number.isFinite(bot.lastSeenAgoSeconds)
      ? Math.max(0, Math.floor(bot.lastSeenAgoSeconds))
      : 0;
    const name = typeof bot.name === 'string' ? bot.name.trim() : '';
    index.set(globalMetaId, { lastSeenAt, lastSeenAgoSeconds, name });
  }
  return index;
}

function markServicesOnlineForFallback(
  services: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  return services.map((service) => ({
    ...service,
    online: true,
    lastSeenAt: nowMs,
    lastSeenSec: nowSec,
  }));
}

function markServicesOfflineForPresenceUnavailable(
  services: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return services.map((service) => ({
    ...service,
    online: false,
    lastSeenAt: null,
    lastSeenSec: null,
  }));
}

async function decorateServicesWithSocketPresence(input: {
  services: Array<Record<string, unknown>>;
  socketPresenceApiBaseUrl?: string;
  socketPresenceFailureMode?: 'throw' | 'assume_service_providers_online';
  onlineOnly: boolean;
}): Promise<Array<Record<string, unknown>>> {
  try {
    const presence = await readOnlineMetaBotsFromSocketPresence({
      apiBaseUrl: input.socketPresenceApiBaseUrl,
      limit: MAX_NETWORK_BOT_LIST_LIMIT,
    });
    const lastSeenIndex = buildSocketPresenceLastSeenIndex(presence.bots);
    const decorated = input.services.map((service) => {
      const globalMetaId = normalizeComparableGlobalMetaId(
        service.providerGlobalMetaId ?? service.globalMetaId,
      );
      const botEntry = globalMetaId ? lastSeenIndex.get(globalMetaId) : undefined;
      const lastSeenAt = botEntry?.lastSeenAt ?? null;
      return {
        ...service,
        online: Boolean(botEntry),
        lastSeenAt,
        lastSeenSec: normalizeEpochSeconds(lastSeenAt),
        lastSeenAgoSeconds: botEntry?.lastSeenAgoSeconds ?? null,
        providerName: botEntry?.name ?? '',
      };
    });

    if (input.onlineOnly) {
      return decorated.filter((service) => service.online === true);
    }
    return decorated;
  } catch (error) {
    if (input.socketPresenceFailureMode === 'assume_service_providers_online') {
      const fallbackDecorated = markServicesOnlineForFallback(input.services);
      if (input.onlineOnly) {
        return fallbackDecorated.filter((service) => service.online === true);
      }
      return fallbackDecorated;
    }
    if (input.onlineOnly) {
      throw error;
    }
    return markServicesOfflineForPresenceUnavailable(input.services);
  }
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

function readBoolean(value: unknown): boolean {
  return value === true;
}

function readInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return fallback;
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

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function looksLikeMasterHostObservationFrame(value: Record<string, unknown>): boolean {
  return readObject(value.hints) !== null
    || readObject(value.activity)?.lastMeaningfulDiffAt !== undefined
    || readObject(value.diagnostics)?.lastFailureSummary !== undefined;
}

function parseMasterTriggerObservationRecord(observation: Record<string, unknown>): TriggerObservation {
  const userIntent = readObject(observation.userIntent) ?? {};
  const activity = readObject(observation.activity) ?? {};
  const diagnostics = readObject(observation.diagnostics) ?? {};
  const workState = readObject(observation.workState) ?? {};
  const directory = readObject(observation.directory) ?? {};

  return {
    now: readInteger(observation.now, Date.now()),
    traceId: normalizeText(observation.traceId) || null,
    hostMode: normalizeText(observation.hostMode) || DEFAULT_MASTER_HOST_MODE,
    workspaceId: normalizeText(observation.workspaceId) || null,
    userIntent: {
      explicitlyAskedForMaster: readBoolean(userIntent.explicitlyAskedForMaster),
      explicitlyRejectedSuggestion: readBoolean(userIntent.explicitlyRejectedSuggestion),
      explicitlyRejectedAutoAsk: readBoolean(userIntent.explicitlyRejectedAutoAsk),
    },
    activity: {
      recentUserMessages: readInteger(activity.recentUserMessages),
      recentAssistantMessages: readInteger(activity.recentAssistantMessages),
      recentToolCalls: readInteger(activity.recentToolCalls),
      recentFailures: readInteger(activity.recentFailures),
      repeatedFailureCount: readInteger(activity.repeatedFailureCount),
      noProgressWindowMs: observation.activity && activity.noProgressWindowMs !== undefined && activity.noProgressWindowMs !== null
        ? readInteger(activity.noProgressWindowMs)
        : null,
    },
    diagnostics: {
      failingTests: readInteger(diagnostics.failingTests),
      failingCommands: readInteger(diagnostics.failingCommands),
      repeatedErrorSignatures: readStringArray(diagnostics.repeatedErrorSignatures),
      uncertaintySignals: readStringArray(diagnostics.uncertaintySignals),
    },
    workState: {
      hasPlan: readBoolean(workState.hasPlan),
      todoBlocked: readBoolean(workState.todoBlocked),
      diffChangedRecently: readBoolean(workState.diffChangedRecently),
      onlyReadingWithoutConverging: readBoolean(workState.onlyReadingWithoutConverging),
    },
    directory: {
      availableMasters: readInteger(directory.availableMasters),
      trustedMasters: readInteger(directory.trustedMasters),
      onlineMasters: readInteger(directory.onlineMasters),
    },
    candidateMasterKindHint: normalizeText(observation.candidateMasterKindHint) || null,
  };
}

function mergeMasterTriggerObservation(
  base: TriggerObservation,
  overrideRecord: Record<string, unknown>,
  overrideObservation: TriggerObservation
): TriggerObservation {
  const overrideUserIntent = readObject(overrideRecord.userIntent) ?? {};
  const overrideActivity = readObject(overrideRecord.activity) ?? {};
  const overrideDiagnostics = readObject(overrideRecord.diagnostics) ?? {};
  const overrideWorkState = readObject(overrideRecord.workState) ?? {};
  const overrideDirectory = readObject(overrideRecord.directory) ?? {};
  const hostObservationOverride = looksLikeMasterHostObservationFrame(overrideRecord);

  return {
    now: hasOwn(overrideRecord, 'now') ? overrideObservation.now : base.now,
    traceId: hasOwn(overrideRecord, 'traceId') ? overrideObservation.traceId : base.traceId,
    hostMode: hasOwn(overrideRecord, 'hostMode') ? overrideObservation.hostMode : base.hostMode,
    workspaceId: hasOwn(overrideRecord, 'workspaceId') ? overrideObservation.workspaceId : base.workspaceId,
    userIntent: {
      explicitlyAskedForMaster: hasOwn(overrideUserIntent, 'explicitlyAskedForMaster')
        ? overrideObservation.userIntent?.explicitlyAskedForMaster === true
        : base.userIntent?.explicitlyAskedForMaster === true,
      explicitlyRejectedSuggestion: hasOwn(overrideUserIntent, 'explicitlyRejectedSuggestion')
        ? overrideObservation.userIntent?.explicitlyRejectedSuggestion === true
        : base.userIntent?.explicitlyRejectedSuggestion === true,
      explicitlyRejectedAutoAsk: hasOwn(overrideUserIntent, 'explicitlyRejectedAutoAsk')
        ? overrideObservation.userIntent?.explicitlyRejectedAutoAsk === true
        : base.userIntent?.explicitlyRejectedAutoAsk === true,
    },
    activity: {
      recentUserMessages: hasOwn(overrideActivity, 'recentUserMessages')
        ? overrideObservation.activity?.recentUserMessages ?? 0
        : base.activity?.recentUserMessages ?? 0,
      recentAssistantMessages: hasOwn(overrideActivity, 'recentAssistantMessages')
        ? overrideObservation.activity?.recentAssistantMessages ?? 0
        : base.activity?.recentAssistantMessages ?? 0,
      recentToolCalls: hasOwn(overrideActivity, 'recentToolCalls')
        ? overrideObservation.activity?.recentToolCalls ?? 0
        : base.activity?.recentToolCalls ?? 0,
      recentFailures: hasOwn(overrideActivity, 'recentFailures')
        ? overrideObservation.activity?.recentFailures ?? 0
        : base.activity?.recentFailures ?? 0,
      repeatedFailureCount: hasOwn(overrideActivity, 'repeatedFailureCount')
        ? overrideObservation.activity?.repeatedFailureCount ?? 0
        : base.activity?.repeatedFailureCount ?? 0,
      noProgressWindowMs: hasOwn(overrideActivity, 'noProgressWindowMs')
        ? (overrideObservation.activity?.noProgressWindowMs ?? null)
        : (base.activity?.noProgressWindowMs ?? null),
    },
    diagnostics: {
      failingTests: hasOwn(overrideDiagnostics, 'failingTests')
        ? overrideObservation.diagnostics?.failingTests ?? 0
        : base.diagnostics?.failingTests ?? 0,
      failingCommands: hasOwn(overrideDiagnostics, 'failingCommands')
        ? overrideObservation.diagnostics?.failingCommands ?? 0
        : base.diagnostics?.failingCommands ?? 0,
      repeatedErrorSignatures: hasOwn(overrideDiagnostics, 'repeatedErrorSignatures')
        ? overrideObservation.diagnostics?.repeatedErrorSignatures ?? []
        : base.diagnostics?.repeatedErrorSignatures ?? [],
      uncertaintySignals: hasOwn(overrideDiagnostics, 'uncertaintySignals')
        ? overrideObservation.diagnostics?.uncertaintySignals ?? []
        : base.diagnostics?.uncertaintySignals ?? [],
    },
    workState: {
      hasPlan: hasOwn(overrideWorkState, 'hasPlan')
        ? overrideObservation.workState?.hasPlan === true
        : base.workState?.hasPlan === true,
      todoBlocked: hasOwn(overrideWorkState, 'todoBlocked')
        ? overrideObservation.workState?.todoBlocked === true
        : base.workState?.todoBlocked === true,
      diffChangedRecently: hasOwn(overrideWorkState, 'diffChangedRecently')
        ? overrideObservation.workState?.diffChangedRecently === true
        : base.workState?.diffChangedRecently === true,
      onlyReadingWithoutConverging: hasOwn(overrideWorkState, 'onlyReadingWithoutConverging')
        ? overrideObservation.workState?.onlyReadingWithoutConverging === true
        : base.workState?.onlyReadingWithoutConverging === true,
    },
    directory: {
      availableMasters: hasOwn(overrideDirectory, 'availableMasters')
        ? overrideObservation.directory?.availableMasters ?? 0
        : base.directory?.availableMasters ?? 0,
      trustedMasters: hasOwn(overrideDirectory, 'trustedMasters')
        ? overrideObservation.directory?.trustedMasters ?? 0
        : base.directory?.trustedMasters ?? 0,
      onlineMasters: hasOwn(overrideDirectory, 'onlineMasters')
        ? overrideObservation.directory?.onlineMasters ?? 0
        : base.directory?.onlineMasters ?? 0,
    },
    candidateMasterKindHint: hasOwn(overrideRecord, 'candidateMasterKindHint') || hostObservationOverride
      ? overrideObservation.candidateMasterKindHint ?? null
      : base.candidateMasterKindHint ?? null,
  };
}

function readMasterTriggerObservation(rawInput: Record<string, unknown>): TriggerObservation {
  const context = readObject(rawInput.context);
  const contextObservation = context
    ? buildTriggerObservationFromHostContext(context)
    : null;
  const explicitObservation = readObject(rawInput.observation);
  if (!explicitObservation) {
    return contextObservation ?? parseMasterTriggerObservationRecord(rawInput);
  }

  const parsedExplicit = looksLikeMasterHostObservationFrame(explicitObservation)
    ? buildTriggerObservationFromHostObservationFrame(
      explicitObservation as unknown as Parameters<typeof buildTriggerObservationFromHostObservationFrame>[0]
    )
    : parseMasterTriggerObservationRecord(explicitObservation);

  return contextObservation
    ? mergeMasterTriggerObservation(contextObservation, explicitObservation, parsedExplicit)
    : parsedExplicit;
}

function readMasterTriggerDirectoryPresence(rawInput: Record<string, unknown>): {
  availableMasters: boolean;
  trustedMasters: boolean;
  onlineMasters: boolean;
} {
  const explicitDirectory = readObject(readObject(rawInput.observation)?.directory);
  const contextDirectory = readObject(readObject(readObject(rawInput.context)?.hostSignals)?.directory);
  const combined = {
    availableMasters: false,
    trustedMasters: false,
    onlineMasters: false,
  };

  for (const directory of [contextDirectory, explicitDirectory]) {
    if (!directory) {
      continue;
    }
    combined.availableMasters = combined.availableMasters || hasOwn(directory, 'availableMasters');
    combined.trustedMasters = combined.trustedMasters || hasOwn(directory, 'trustedMasters');
    combined.onlineMasters = combined.onlineMasters || hasOwn(directory, 'onlineMasters');
  }

  return combined;
}

async function hydrateMasterTriggerObservationDirectory(input: {
  observation: TriggerObservation;
  trustedMasters: string[];
  directoryPresence: {
    availableMasters: boolean;
    trustedMasters: boolean;
    onlineMasters: boolean;
  };
  masterStateStore: ReturnType<typeof createPublishedMasterStateStore>;
  directorySeedsPath: string;
  chainApiBaseUrl?: string;
  localProviderOnline: boolean;
  localLastSeenSec: number | null;
  providerDaemonBaseUrl?: string | null;
  providerGlobalMetaId?: string | null;
}): Promise<TriggerObservation> {
  if (
    input.directoryPresence.availableMasters
    && input.directoryPresence.onlineMasters
    && input.directoryPresence.trustedMasters
  ) {
    return input.observation;
  }

  const directory = await listRuntimeDirectoryMasters({
    masterStateStore: input.masterStateStore,
    directorySeedsPath: input.directorySeedsPath,
    chainApiBaseUrl: input.chainApiBaseUrl,
    onlineOnly: false,
    host: input.observation.hostMode,
    localProviderOnline: input.localProviderOnline,
    localLastSeenSec: input.localLastSeenSec,
    providerDaemonBaseUrl: input.providerDaemonBaseUrl,
    providerGlobalMetaId: input.providerGlobalMetaId,
  });
  const trustedPins = new Set(input.trustedMasters.map((entry) => normalizeText(entry)).filter(Boolean));
  const trustedCount = directory.masters.filter((master) => trustedPins.has(normalizeText(master.masterPinId))).length;
  const onlineCount = directory.masters.filter((master) => master.online).length;

  return {
    ...input.observation,
    directory: {
      availableMasters: input.directoryPresence.availableMasters
        ? (input.observation.directory?.availableMasters ?? 0)
        : Math.max(input.observation.directory?.availableMasters ?? 0, directory.masters.length),
      trustedMasters: input.directoryPresence.trustedMasters
        ? (input.observation.directory?.trustedMasters ?? 0)
        : Math.max(input.observation.directory?.trustedMasters ?? 0, trustedCount),
      onlineMasters: input.directoryPresence.onlineMasters
        ? (input.observation.directory?.onlineMasters ?? 0)
        : Math.max(input.observation.directory?.onlineMasters ?? 0, onlineCount),
    },
  };
}

function buildProviderSummaryPayload(input: {
  state: RuntimeState;
  presence: Awaited<ReturnType<ReturnType<typeof createProviderPresenceStateStore>['read']>>;
  masters?: PublishedMasterRecord[];
  ratingDetails?: Awaited<ReturnType<ReturnType<typeof createRatingDetailStateStore>['read']>>['items'];
  ratingSyncState?: 'ready' | 'sync_error';
  ratingSyncError?: string | null;
}) {
  const snapshot = buildProviderConsoleSnapshot({
    services: input.state.services,
    masters: input.masters,
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
    recentMasterRequests: snapshot.recentMasterRequests,
    totals: snapshot.totals,
    ratingSyncState: input.ratingSyncState === 'sync_error' ? 'sync_error' : 'ready',
    ratingSyncError: normalizeText(input.ratingSyncError) || null,
  };
}

interface InitiatedRefundItem {
  orderId: string;
  role: 'buyer';
  serviceName: string;
  paymentTxid: string | null;
  paymentAmount: string | null;
  paymentCurrency: string | null;
  status: 'refund_pending' | 'refunded';
  failureReason: string | null;
  refundRequestPinId: string | null;
  refundTxid: string | null;
  refundRequestedAt: number | null;
  refundCompletedAt: number | null;
  counterpartyGlobalMetaId: string | null;
  counterpartyName: string | null;
  coworkSessionId: string | null;
  createdAt: number;
  updatedAt: number;
}

function normalizeTimestamp(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.trunc(numeric);
}

function normalizeTraceTimestamp(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  if (numeric >= 1_000_000_000 && numeric < 1_000_000_000_000) {
    return Math.trunc(numeric * 1000);
  }
  return Math.trunc(numeric);
}

function getInitiatedRefundSortTimestamp(item: InitiatedRefundItem): number {
  if (item.status === 'refunded') {
    return item.refundCompletedAt ?? item.updatedAt ?? item.createdAt;
  }
  return item.refundRequestedAt ?? item.updatedAt ?? item.createdAt;
}

function compareInitiatedRefundItems(left: InitiatedRefundItem, right: InitiatedRefundItem): number {
  const rankLeft = left.status === 'refund_pending' ? 0 : 1;
  const rankRight = right.status === 'refund_pending' ? 0 : 1;
  if (rankLeft !== rankRight) {
    return rankLeft - rankRight;
  }

  const timeDelta = getInitiatedRefundSortTimestamp(right) - getInitiatedRefundSortTimestamp(left);
  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.orderId.localeCompare(right.orderId);
}

function buildInitiatedRefundsPayload(input: { state: RuntimeState }): {
  initiatedByMe: InitiatedRefundItem[];
  totalCount: number;
  pendingCount: number;
} {
  const initiatedByMe = input.state.traces
    .map((trace) => {
      const traceRecord = trace as unknown as Record<string, unknown>;
      const order = readObject(traceRecord.order);
      if (!order || normalizeText(order.role) !== 'buyer') {
        return null;
      }

      const status = normalizeText(order.status);
      if (status !== 'refund_pending' && status !== 'refunded') {
        return null;
      }

      const orderId = normalizeText(order.id);
      if (!orderId) {
        return null;
      }

      const createdAt = normalizeTimestamp(traceRecord.createdAt) ?? 0;
      const session = readObject(traceRecord.session) ?? {};
      const refundRequestedAt = normalizeTimestamp(order.refundRequestedAt);
      const refundCompletedAt = normalizeTimestamp(order.refundCompletedAt)
        ?? normalizeTimestamp(order.refundedAt);
      const updatedAt = normalizeTimestamp(order.updatedAt)
        ?? refundCompletedAt
        ?? refundRequestedAt
        ?? createdAt;
      return {
        orderId,
        role: 'buyer',
        serviceName: normalizeText(order.serviceName) || 'Unknown service',
        paymentTxid: normalizeText(order.paymentTxid) || null,
        paymentAmount: normalizeText(order.paymentAmount) || null,
        paymentCurrency: normalizeText(order.paymentCurrency) || null,
        status,
        failureReason: normalizeText(order.failureReason) || null,
        refundRequestPinId: normalizeText(order.refundRequestPinId) || null,
        refundTxid: normalizeText(order.refundTxid) || null,
        refundRequestedAt,
        refundCompletedAt,
        counterpartyGlobalMetaId: normalizeText(session.peerGlobalMetaId) || null,
        counterpartyName: normalizeText(session.peerName) || null,
        coworkSessionId: normalizeText(order.coworkSessionId) || null,
        createdAt,
        updatedAt,
      } satisfies InitiatedRefundItem;
    })
    .filter((entry): entry is InitiatedRefundItem => Boolean(entry))
    .sort(compareInitiatedRefundItems);

  return {
    initiatedByMe,
    totalCount: initiatedByMe.length,
    pendingCount: initiatedByMe.filter((entry) => entry.status === 'refund_pending').length,
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
  const rawRequest = normalizeText(request.rawRequest);
  const serviceQuery = normalizeText(request.query ?? request.intent ?? rawInput.query ?? rawInput.intent);
  const userTask = normalizeText(request.userTask) || rawRequest || serviceQuery;
  return {
    servicePinId: normalizeText(request.servicePinId),
    providerGlobalMetaId: normalizeText(request.providerGlobalMetaId),
    providerDaemonBaseUrl: normalizeText(request.providerDaemonBaseUrl ?? rawInput.providerDaemonBaseUrl),
    userTask,
    taskContext: normalizeText(request.taskContext),
    rawRequest,
    serviceQuery,
    spendCap: readObject(request.spendCap),
    policyMode: request.policyMode,
    confirmed: request.confirmed === true || rawInput.confirmed === true,
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

function readPrivateConversationRequest(rawInput: Record<string, unknown>) {
  return {
    peer: normalizeText(rawInput.peer),
    afterIndex: normalizeConversationAfterIndex(rawInput.afterIndex),
    limit: normalizeConversationLimit(rawInput.limit),
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

function readMasterHostActionRequest(rawInput: Record<string, unknown>) {
  const action = readObject(rawInput.action) ?? {};
  return {
    action: {
      kind: normalizeText(action.kind),
      utterance: normalizeText(action.utterance),
      preferredMasterName: normalizeText(action.preferredMasterName) || null,
      preferredMasterKind: normalizeText(action.preferredMasterKind) || null,
      traceId: normalizeText(action.traceId) || null,
      suggestionId: normalizeText(action.suggestionId) || null,
      reason: normalizeText(action.reason) || null,
    },
    context: readObject(rawInput.context) ?? {},
  };
}

function readExecuteServiceRequest(rawInput: Record<string, unknown>) {
  const buyer = readObject(rawInput.buyer) ?? {};
  const request = readObject(rawInput.request) ?? {};
  const payment = readObject(rawInput.payment) ?? {};
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
    payment: {
      paymentTxid: normalizeText(payment.paymentTxid) || null,
      paymentCommitTxid: normalizeText(payment.paymentCommitTxid) || null,
      paymentChain: normalizeText(payment.paymentChain) || null,
      paymentAmount: normalizeText(payment.paymentAmount),
      paymentCurrency: normalizeText(payment.paymentCurrency),
      settlementKind: normalizeText(payment.settlementKind) || null,
      orderReference: normalizeText(payment.orderReference) || null,
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
      ? payload.data.services
        .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
        .filter((entry) => entry.online === true)
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

async function readDirectorySeeds(directorySeedsPath: string): Promise<Array<{ baseUrl: string; label: string | null }>> {
  let payload: unknown;
  try {
    payload = JSON.parse(await fs.readFile(directorySeedsPath, 'utf8')) as unknown;
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
  directorySeedsPath: string,
  providers: Array<{ baseUrl: string; label: string | null }>
): Promise<void> {
  await fs.mkdir(path.dirname(directorySeedsPath), { recursive: true });
  await fs.writeFile(
    directorySeedsPath,
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

async function enrichServicesWithProviderChatPublicKeys(input: {
  services: Array<Record<string, unknown>>;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
}): Promise<Array<Record<string, unknown>>> {
  if (!input.resolvePeerChatPublicKey) {
    return input.services;
  }

  const chatKeyByProvider = new Map<string, string | null>();
  const enriched = [];
  for (const service of input.services) {
    const providerGlobalMetaId = normalizeText(service.providerGlobalMetaId ?? service.globalMetaId);
    const existingChatKey = normalizeText(service.providerChatPublicKey ?? service.chatPublicKey);
    if (!providerGlobalMetaId || existingChatKey) {
      enriched.push(existingChatKey ? { ...service, providerChatPublicKey: existingChatKey } : service);
      continue;
    }

    if (!chatKeyByProvider.has(providerGlobalMetaId)) {
      try {
        chatKeyByProvider.set(
          providerGlobalMetaId,
          normalizeText(await input.resolvePeerChatPublicKey(providerGlobalMetaId)) || null,
        );
      } catch {
        chatKeyByProvider.set(providerGlobalMetaId, null);
      }
    }

    const providerChatPublicKey = chatKeyByProvider.get(providerGlobalMetaId);
    enriched.push(providerChatPublicKey ? { ...service, providerChatPublicKey } : service);
  }
  return enriched;
}

function normalizeEpochSeconds(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  // Accept either second-based or millisecond-based timestamps.
  if (value > 1e12) {
    return Math.floor(value / 1000);
  }
  return Math.floor(value);
}

function dedupeOnlineBotsFromServices(
  services: Array<Record<string, unknown>>,
  limit: number,
  nowMs: number = Date.now(),
): Array<Record<string, unknown>> {
  const byGlobalMetaId = new Map<string, { lastSeenSec: number | null }>();

  for (const service of services) {
    const globalMetaId = normalizeText(service.providerGlobalMetaId);
    if (!globalMetaId) {
      continue;
    }

    const online = service.online !== false;
    if (!online) {
      continue;
    }

    const lastSeenSec = normalizeEpochSeconds(
      Number.isFinite(Number(service.lastSeenSec))
        ? Number(service.lastSeenSec)
        : Number(service.updatedAt),
    );
    const existing = byGlobalMetaId.get(globalMetaId);
    if (!existing) {
      byGlobalMetaId.set(globalMetaId, { lastSeenSec });
      continue;
    }
    if ((lastSeenSec ?? -Infinity) > (existing.lastSeenSec ?? -Infinity)) {
      byGlobalMetaId.set(globalMetaId, { lastSeenSec });
    }
  }

  const nowSec = Math.floor(nowMs / 1000);
  return [...byGlobalMetaId.entries()]
    .sort((left, right) => {
      const leftSeen = left[1].lastSeenSec ?? -Infinity;
      const rightSeen = right[1].lastSeenSec ?? -Infinity;
      if (leftSeen !== rightSeen) {
        return rightSeen - leftSeen;
      }
      return left[0].localeCompare(right[0]);
    })
    .slice(0, limit)
    .map(([globalMetaId, entry]) => ({
      globalMetaId,
      lastSeenAt: entry.lastSeenSec ? entry.lastSeenSec * 1000 : 0,
      lastSeenAgoSeconds: entry.lastSeenSec ? Math.max(0, nowSec - entry.lastSeenSec) : 0,
      deviceCount: 1,
      online: true,
    }));
}

async function fetchSeededDirectoryServices(directorySeedsPath: string): Promise<Array<Record<string, unknown>>> {
  const seeds = await readDirectorySeeds(directorySeedsPath);
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

async function fetchSeededDirectoryMasters(directorySeedsPath: string): Promise<MasterDirectoryItem[]> {
  const seeds = await readDirectorySeeds(directorySeedsPath);
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
  payment: A2AOrderPaymentResult;
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
        payment: {
          paymentTxid: input.payment.paymentTxid || null,
          paymentCommitTxid: input.payment.paymentCommitTxid || null,
          paymentChain: input.payment.paymentChain || null,
          paymentAmount: input.payment.paymentAmount,
          paymentCurrency: input.payment.paymentCurrency,
          settlementKind: input.payment.settlementKind,
          orderReference: input.payment.orderReference || null,
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
      resultObservedAt: Number.isFinite(item.timestamp) ? normalizeTraceTimestamp(item.timestamp) : null,
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
      ratingRequestedAt: Number.isFinite(item.timestamp) ? normalizeTraceTimestamp(item.timestamp) : null,
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
    ? normalizeTraceTimestamp(input.ratingDetail?.createdAt)
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
      ratingCreatedAt = normalizeTraceTimestamp(item.timestamp);
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

function readTranscriptMetadata(item: {
  metadata?: Record<string, unknown> | null;
}): Record<string, unknown> {
  return item.metadata && typeof item.metadata === 'object' && !Array.isArray(item.metadata)
    ? item.metadata
    : {};
}

function normalizedMetadataValue(
  item: { metadata?: Record<string, unknown> | null },
  key: string,
): string {
  return normalizeText(readTranscriptMetadata(item)[key]);
}

function readTranscriptNestedMetadataValue(
  item: { metadata?: Record<string, unknown> | null },
  objectKey: string,
  valueKey: string,
): string {
  const metadata = readTranscriptMetadata(item);
  const nested = metadata[objectKey];
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) {
    return '';
  }
  return normalizeText((nested as Record<string, unknown>)[valueKey]);
}

function transcriptItemsShareOrderReference(
  legacyItem: A2ATranscriptItemRecord,
  unifiedItem: A2ATranscriptItemRecord,
): boolean {
  const keys = ['orderTxid', 'paymentTxid', 'txid', 'pinId', 'deliveryPinId', 'ratingPinId'];
  return keys.some((key) => {
    const left = normalizedMetadataValue(legacyItem, key);
    const right = normalizedMetadataValue(unifiedItem, key);
    return Boolean(left && right && left === right);
  });
}

function transcriptItemMatchesTraceOrder(
  item: A2ATranscriptItemRecord,
  trace: ReturnType<typeof buildSessionTrace>,
): boolean {
  const orderTxid = normalizeChainTxid(trace.order?.orderTxid)
    || normalizeChainTxid(trace.order?.orderPinId)
    || (Array.isArray(trace.order?.orderTxids)
      ? trace.order.orderTxids.map((entry) => normalizeChainTxid(entry)).find(Boolean)
      : '')
    || '';
  const paymentTxid = normalizeText(trace.order?.paymentTxid);
  const servicePinId = normalizeText(trace.order?.serviceId)
    || normalizeText(trace.a2a?.servicePinId);
  if (!orderTxid && !paymentTxid && !servicePinId) {
    return true;
  }

  const metadata = readTranscriptMetadata(item);
  const rawContent = normalizeText(metadata.rawContent) || normalizeText(item.content);
  const delivery = parseDeliveryMessage(rawContent);
  const needsRating = parseNeedsRatingMessage(rawContent);
  const orderEnd = parseOrderEndMessage(rawContent);
  const status = parseOrderStatusMessage(rawContent);
  const itemOrderTxid = normalizeChainTxid(metadata.orderTxid)
    || normalizeChainTxid(metadata.txid)
    || normalizeChainTxid(metadata.pinId)
    || normalizeChainTxid(delivery?.orderTxid)
    || normalizeChainTxid(needsRating?.orderTxid)
    || normalizeChainTxid(orderEnd?.orderTxid)
    || normalizeChainTxid(status?.orderTxid);
  const itemPaymentTxid = normalizeText(metadata.paymentTxid)
    || normalizeText(delivery?.paymentTxid)
    || readTranscriptNestedMetadataValue(item, 'deliveryPayload', 'paymentTxid');
  const itemServicePinId = normalizeText(metadata.servicePinId)
    || normalizeText(delivery?.servicePinId)
    || readTranscriptNestedMetadataValue(item, 'deliveryPayload', 'servicePinId');

  return Boolean(
    (orderTxid && itemOrderTxid === orderTxid)
    || (paymentTxid && itemPaymentTxid === paymentTxid)
    || (!orderTxid && !paymentTxid && servicePinId && itemServicePinId === servicePinId)
  );
}

function filterTranscriptItemsForTraceOrder(
  trace: ReturnType<typeof buildSessionTrace>,
  items: A2ATranscriptItemRecord[] | null | undefined,
): A2ATranscriptItemRecord[] {
  return (items ?? [])
    .filter((item) => normalizeText(item.id) && normalizeText(item.content))
    .filter((item) => transcriptItemMatchesTraceOrder(item, trace));
}

function deriveA2AStatusFromTranscript(input: {
  trace: ReturnType<typeof buildSessionTrace>;
  transcriptItems: A2ATranscriptItemRecord[];
  publicStatusSnapshots: Array<{
    status?: string | null;
    rawEvent?: string | null;
  }>;
}): NonNullable<ReturnType<typeof buildSessionTrace>['a2a']> | null {
  const base = input.trace.a2a;
  if (!base) {
    return null;
  }
  const latestSnapshot = input.publicStatusSnapshots.at(-1) ?? null;
  let publicStatus = normalizeText(latestSnapshot?.status) || normalizeText(base.publicStatus) || null;
  let latestEvent = normalizeText(latestSnapshot?.rawEvent) || normalizeText(base.latestEvent) || null;
  let taskRunState = normalizeText(base.taskRunState) || null;

  for (let index = input.transcriptItems.length - 1; index >= 0; index -= 1) {
    const item = input.transcriptItems[index];
    const type = normalizeText(item.type).toLowerCase();
    const metadata = readTranscriptMetadata(item);
    const metadataStatus = normalizeText(metadata.publicStatus);
    const metadataEvent = normalizeText(metadata.event);
    const protocolTag = normalizeText(metadata.protocolTag).toUpperCase();
    const endReason = normalizeText(metadata.endReason);
    const endState = normalizeText(metadata.endState);

    if (type === 'order_end' || protocolTag === 'ORDER_END') {
      publicStatus = endState || (isRemoteFailureReason(endReason) ? 'remote_failed' : 'completed');
      latestEvent = publicStatus === 'remote_failed' ? 'provider_failed' : 'provider_completed';
      taskRunState = publicStatus === 'remote_failed' ? 'failed' : 'completed';
      break;
    }

    if (metadataStatus === 'completed' || type === 'delivery') {
      publicStatus = 'completed';
      latestEvent = metadataEvent || 'provider_completed';
      taskRunState = 'completed';
      break;
    }

    if (metadata.needsRating === true || type === 'needs_rating' || protocolTag === 'NEEDSRATING') {
      publicStatus = 'completed';
      latestEvent = 'provider_completed';
      taskRunState = 'completed';
      break;
    }
  }

  return {
    ...base,
    publicStatus,
    latestEvent,
    taskRunState,
  };
}

function withDerivedPublicStatusSnapshot(input: {
  snapshots: Array<Record<string, unknown>>;
  a2a: NonNullable<ReturnType<typeof buildSessionTrace>['a2a']> | null;
  sessionId: string | null;
  taskRunId: string | null;
  observedAt: number | null;
}): Array<Record<string, unknown>> {
  const status = normalizeText(input.a2a?.publicStatus);
  const sessionId = normalizeText(input.sessionId ?? input.a2a?.sessionId);
  if (!status || !sessionId) {
    return input.snapshots;
  }
  const latest = input.snapshots.at(-1);
  if (normalizeText(latest?.status) === status) {
    return input.snapshots;
  }
  return [
    ...input.snapshots,
    {
      sessionId,
      taskRunId: normalizeText(input.taskRunId ?? input.a2a?.taskRunId) || null,
      status,
      mapped: true,
      rawEvent: normalizeText(input.a2a?.latestEvent) || 'unified_a2a_order_history',
      resolvedAt: input.observedAt ?? Date.now(),
    },
  ];
}

function mergeLegacyTranscriptWithUnifiedChainMessages(input: {
  transcriptItems: A2ATranscriptItemRecord[];
  unifiedTranscriptItems?: A2ATranscriptItemRecord[] | null;
  chainTranscriptItems?: A2ATranscriptItemRecord[] | null;
}): A2ATranscriptItemRecord[] {
  const chainTranscriptItems = (input.chainTranscriptItems ?? [])
    .filter((item) => normalizeText(item.id) && normalizeText(item.content));
  if (chainTranscriptItems.length > 0) {
    return chainTranscriptItems
      .slice()
      .sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp));
  }

  const unifiedItems = (input.unifiedTranscriptItems ?? [])
    .filter((item) => normalizeText(item.id) && normalizeText(item.content));
  const unifiedOrders = unifiedItems
    .filter((item) => item.sender === 'caller' && item.type === 'order' && normalizeText(item.content));
  if (!unifiedItems.length) {
    return input.transcriptItems;
  }

  const usedUnifiedIds = new Set<string>();
  const merged = input.transcriptItems.map((item) => {
    const canReplace = item.sender === 'caller' && (
      item.type === 'user_task'
      || item.type === 'order'
      || item.type === 'message'
    );
    if (!canReplace) {
      return item;
    }
    const replacement = unifiedOrders.find((candidate) => (
      !usedUnifiedIds.has(candidate.id)
      && transcriptItemsShareOrderReference(item, candidate)
    ));
    if (!replacement) {
      return item;
    }
    usedUnifiedIds.add(replacement.id);
    return {
      ...item,
      timestamp: normalizeTraceTimestamp(replacement.timestamp) || item.timestamp,
      type: replacement.type,
      content: replacement.content,
      metadata: {
        ...readTranscriptMetadata(item),
        ...readTranscriptMetadata(replacement),
        legacyContent: item.content,
        legacyType: item.type,
        legacyId: item.id,
      },
    };
  });

  const existingIds = new Set(merged.map((item) => item.id));
  for (const item of unifiedItems) {
    if (usedUnifiedIds.has(item.id) || existingIds.has(item.id)) {
      continue;
    }
    merged.push(item);
  }

  return merged.sort((left, right) => (
    normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp)
  ));
}

interface ScopedPrivateHistoryProjection {
  transcriptItems: A2ATranscriptItemRecord[];
  localName: string | null;
  localAvatar: string | null;
  peerName: string | null;
  peerAvatar: string | null;
}

function normalizeChainTxid(value: unknown): string {
  const normalized = normalizeText(value).replace(/i\d+$/iu, '').toLowerCase();
  return /^[0-9a-f]{64}$/iu.test(normalized) ? normalized : '';
}

function normalizeMessageProtocolTag(content: string): string {
  const trimmed = String(content || '').trim();
  if (/^\[ORDER\]/iu.test(trimmed)) return 'ORDER';
  if (parseOrderStatusMessage(trimmed)) return 'ORDER_STATUS';
  if (parseDeliveryMessage(trimmed)) return 'DELIVERY';
  if (parseNeedsRatingMessage(trimmed)) return 'NeedsRating';
  if (parseOrderEndMessage(trimmed)) return 'ORDER_END';
  return '';
}

function stripOrderProtocolBubblePrefix(content: string): string {
  return String(content || '').replace(/^\[[A-Za-z_]+(?::[0-9a-fA-F]{64})?(?:\s+[A-Za-z0-9_-]+)?\]\s*/u, '').trim();
}

function extractOrderLineValue(content: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const match = String(content || '').match(new RegExp(`(?:^|\\n)\\s*${escapedLabel}\\s*:\\s*([^\\n]+)`, 'iu'));
  return normalizeText(match?.[1]);
}

function readChatUserName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return normalizeText(record.name)
    || normalizeText(record.nickname)
    || normalizeText(record.nickName)
    || null;
}

function readChatUserAvatar(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return normalizeText(record.avatar)
    || normalizeText(record.avatarUrl)
    || normalizeText(record.avatarImage)
    || normalizeText(record.avatarUri)
    || normalizeText(record.avatar_uri)
    || null;
}

function readMessageUserInfoForGlobalMetaId(
  message: ChatViewerMessage,
  globalMetaId: string,
): unknown | null {
  if (!globalMetaId) return null;
  if (message.fromGlobalMetaId === globalMetaId) {
    return message.fromUserInfo ?? message.userInfo ?? null;
  }
  if (message.toGlobalMetaId === globalMetaId) {
    return message.toUserInfo ?? null;
  }
  return null;
}

function privateHistoryMessageMatchesOrder(input: {
  message: ChatViewerMessage;
  orderTxid: string;
  paymentTxid: string;
  servicePinId: string;
}): boolean {
  const content = String(input.message.content || '');
  const hasStrongOrderReference = Boolean(input.orderTxid || input.paymentTxid);
  const messageTxid = normalizeChainTxid(input.message.txId ?? input.message.pinId ?? input.message.id);
  if (input.orderTxid && messageTxid === input.orderTxid) {
    return true;
  }

  const status = parseOrderStatusMessage(content);
  if (input.orderTxid && normalizeChainTxid(status?.orderTxid) === input.orderTxid) {
    return true;
  }
  const delivery = parseDeliveryMessage(content);
  if (delivery) {
    if (input.orderTxid && normalizeChainTxid(delivery.orderTxid) === input.orderTxid) {
      return true;
    }
    if (input.paymentTxid && normalizeText(delivery.paymentTxid) === input.paymentTxid) {
      return true;
    }
    if (!hasStrongOrderReference && input.servicePinId && normalizeText(delivery.servicePinId) === input.servicePinId) {
      return true;
    }
  }
  const needsRating = parseNeedsRatingMessage(content);
  if (input.orderTxid && normalizeChainTxid(needsRating?.orderTxid) === input.orderTxid) {
    return true;
  }
  const orderEnd = parseOrderEndMessage(content);
  if (input.orderTxid && normalizeChainTxid(orderEnd?.orderTxid) === input.orderTxid) {
    return true;
  }

  if (/^\[ORDER\]/iu.test(content)) {
    return Boolean(
      (input.paymentTxid && content.includes(input.paymentTxid))
      || (!hasStrongOrderReference && input.servicePinId && content.includes(input.servicePinId))
    );
  }

  return false;
}

function isRemoteFailureReason(reason: unknown): boolean {
  const normalized = normalizeText(reason).toLowerCase();
  return /\b(fail|failed|failure|error|declined|cancelled|canceled)\b/u.test(normalized);
}

function projectPrivateHistoryMessageToTranscript(input: {
  message: ChatViewerMessage;
  sessionId: string;
  localGlobalMetaId: string;
  localRole: 'caller' | 'provider';
  orderTxid: string;
  paymentTxid: string;
  servicePinId: string;
}): A2ATranscriptItemRecord | null {
  if (normalizeText(input.message.protocol) !== '/protocols/simplemsg') {
    return null;
  }
  if (!privateHistoryMessageMatchesOrder({
    message: input.message,
    orderTxid: input.orderTxid,
    paymentTxid: input.paymentTxid,
    servicePinId: input.servicePinId,
  })) {
    return null;
  }

  return projectPrivateHistorySimpleMessageToTranscript(input);
}

function projectPrivateHistorySimpleMessageToTranscript(input: {
  message: ChatViewerMessage;
  sessionId: string;
  localGlobalMetaId: string;
  localRole: 'caller' | 'provider';
  orderTxid?: string | null;
  paymentTxid?: string | null;
  servicePinId?: string | null;
}): A2ATranscriptItemRecord | null {
  if (normalizeText(input.message.protocol) !== '/protocols/simplemsg') {
    return null;
  }

  const rawContent = String(input.message.content || '');
  const protocolTag = normalizeMessageProtocolTag(rawContent);
  const messageTxid = normalizeChainTxid(input.message.txId ?? input.message.pinId ?? input.message.id);
  const status = parseOrderStatusMessage(rawContent);
  const delivery = parseDeliveryMessage(rawContent);
  const needsRating = parseNeedsRatingMessage(rawContent);
  const orderEnd = parseOrderEndMessage(rawContent);
  const parsedOrderTxid = normalizeChainTxid(input.orderTxid)
    || normalizeChainTxid(status?.orderTxid)
    || normalizeChainTxid(delivery?.orderTxid)
    || normalizeChainTxid(needsRating?.orderTxid)
    || normalizeChainTxid(orderEnd?.orderTxid)
    || (protocolTag === 'ORDER' ? messageTxid : '');
  const parsedPaymentTxid = normalizeText(input.paymentTxid)
    || normalizeText(delivery?.paymentTxid)
    || (protocolTag === 'ORDER' ? extractOrderLineValue(rawContent, 'txid') : '');
  const parsedServicePinId = normalizeText(input.servicePinId)
    || normalizeText(delivery?.servicePinId)
    || (protocolTag === 'ORDER' ? (
      extractOrderLineValue(rawContent, 'service id')
      || extractOrderLineValue(rawContent, 'serviceId')
      || extractOrderLineValue(rawContent, 'service pin id')
    ) : '');
  const sender: 'caller' | 'provider' = input.message.fromGlobalMetaId === input.localGlobalMetaId
    ? input.localRole
    : (input.localRole === 'caller' ? 'provider' : 'caller');
  const metadata: Record<string, unknown> = {
    source: 'private_history',
    protocol: normalizeText(input.message.protocol),
    protocolTag: protocolTag || null,
    direction: input.message.fromGlobalMetaId === input.localGlobalMetaId ? 'outgoing' : 'incoming',
    pinId: normalizeText(input.message.pinId) || null,
    txid: messageTxid || null,
    txids: messageTxid ? [messageTxid] : [],
    chain: normalizeText(input.message.chain) || null,
    rawContent,
    orderTxid: parsedOrderTxid || null,
    paymentTxid: parsedPaymentTxid || null,
    servicePinId: parsedServicePinId || null,
    fromGlobalMetaId: input.message.fromGlobalMetaId,
    toGlobalMetaId: input.message.toGlobalMetaId,
    fromUserInfo: input.message.fromUserInfo ?? null,
    toUserInfo: input.message.toUserInfo ?? null,
  };

  let type = protocolTag ? protocolTag.toLowerCase() : 'message';
  let content = stripOrderProtocolBubblePrefix(rawContent) || rawContent;
  if (protocolTag === 'ORDER') {
    type = 'order';
  } else if (protocolTag === 'ORDER_STATUS') {
    type = 'order_status';
    content = normalizeText(status?.content) || content;
  } else if (protocolTag === 'DELIVERY') {
    type = 'delivery';
    content = normalizeText(delivery?.result) || content;
    metadata.deliveryPinId = normalizeText(input.message.pinId) || null;
    metadata.deliveryPayload = delivery ?? null;
    metadata.publicStatus = 'completed';
    metadata.event = 'provider_completed';
    metadata.servicePinId = parsedServicePinId || null;
    metadata.deliveredAt = normalizeTraceTimestamp(delivery?.deliveredAt ?? input.message.timestamp);
  } else if (protocolTag === 'NeedsRating') {
    type = 'needs_rating';
    content = normalizeText(needsRating?.content) || content;
    metadata.needsRating = true;
  } else if (protocolTag === 'ORDER_END') {
    type = 'order_end';
    content = normalizeText(orderEnd?.content) || content;
    metadata.endReason = normalizeText(orderEnd?.reason) || null;
    metadata.orderEnd = true;
    metadata.endState = isRemoteFailureReason(orderEnd?.reason) ? 'remote_failed' : 'completed';
  }

  const id = normalizeText(input.message.pinId)
    || normalizeText(input.message.txId)
    || normalizeText(input.message.id);
  if (!id) return null;
  return {
    id,
    sessionId: input.sessionId,
    taskRunId: null,
    timestamp: normalizeTraceTimestamp(input.message.timestamp),
    type,
    sender,
    content,
    metadata,
  };
}

function projectScopedPrivateHistory(input: {
  messages: ChatViewerMessage[];
  sessionId: string;
  localGlobalMetaId: string;
  peerGlobalMetaId: string;
  localRole: 'caller' | 'provider';
  orderTxid: string;
  paymentTxid: string;
  servicePinId: string;
}): ScopedPrivateHistoryProjection | null {
  const transcriptItems = input.messages
    .map((message) => projectPrivateHistoryMessageToTranscript({
      message,
      sessionId: input.sessionId,
      localGlobalMetaId: input.localGlobalMetaId,
      localRole: input.localRole,
      orderTxid: input.orderTxid,
      paymentTxid: input.paymentTxid,
      servicePinId: input.servicePinId,
    }))
    .filter((item): item is A2ATranscriptItemRecord => item !== null)
    .sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp));

  if (!transcriptItems.length) {
    return null;
  }

  const firstLocalInfo = input.messages
    .map((message) => readMessageUserInfoForGlobalMetaId(message, input.localGlobalMetaId))
    .find((info) => info != null);
  const firstPeerInfo = input.messages
    .map((message) => readMessageUserInfoForGlobalMetaId(message, input.peerGlobalMetaId))
    .find((info) => info != null);
  return {
    transcriptItems,
    localName: readChatUserName(firstLocalInfo),
    localAvatar: readChatUserAvatar(firstLocalInfo),
    peerName: readChatUserName(firstPeerInfo),
    peerAvatar: readChatUserAvatar(firstPeerInfo),
  };
}

function projectPeerPrivateHistory(input: {
  messages: ChatViewerMessage[];
  sessionId: string;
  localGlobalMetaId: string;
  peerGlobalMetaId: string;
  localRole: 'caller' | 'provider';
}): ScopedPrivateHistoryProjection | null {
  const transcriptItems = input.messages
    .map((message) => projectPrivateHistorySimpleMessageToTranscript({
      message,
      sessionId: input.sessionId,
      localGlobalMetaId: input.localGlobalMetaId,
      localRole: input.localRole,
    }))
    .filter((item): item is A2ATranscriptItemRecord => item !== null)
    .sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp));

  if (!transcriptItems.length) {
    return null;
  }

  const firstLocalInfo = input.messages
    .map((message) => readMessageUserInfoForGlobalMetaId(message, input.localGlobalMetaId))
    .find((info) => info != null);
  const firstPeerInfo = input.messages
    .map((message) => readMessageUserInfoForGlobalMetaId(message, input.peerGlobalMetaId))
    .find((info) => info != null);
  return {
    transcriptItems,
    localName: readChatUserName(firstLocalInfo),
    localAvatar: readChatUserAvatar(firstLocalInfo),
    peerName: readChatUserName(firstPeerInfo),
    peerAvatar: readChatUserAvatar(firstPeerInfo),
  };
}

async function buildTraceInspectorPayload(input: {
  traceId: string;
  trace: ReturnType<typeof buildSessionTrace>;
  sessionStateStore: ReturnType<typeof createSessionStateStore>;
  ratingDetailStateStore: ReturnType<typeof createRatingDetailStateStore>;
  chainApiBaseUrl?: string;
  daemon?: RuntimeDaemonRecord | null;
  selectedSessionId?: string | null;
  unifiedTranscriptItems?: A2ATranscriptItemRecord[] | null;
  chainTranscriptItems?: A2ATranscriptItemRecord[] | null;
}) {
  const sessionState = await input.sessionStateStore.readState();
  const sessions = sessionState.sessions
    .filter((entry) => entry.traceId === input.traceId)
    .sort((left, right) => left.createdAt - right.createdAt);
  const selectedSession = sessions.find((entry) => entry.sessionId === input.selectedSessionId)
    ?? sessions.at(-1)
    ?? null;
  const selectedSessionId = normalizeText(selectedSession?.sessionId)
    || normalizeText(input.trace.a2a?.sessionId)
    || null;
  const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
  const taskRuns = sessionState.taskRuns
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => left.createdAt - right.createdAt);
  let transcriptItems = sessionState.transcriptItems
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp));
  transcriptItems = mergeLegacyTranscriptWithUnifiedChainMessages({
    transcriptItems,
    unifiedTranscriptItems: input.unifiedTranscriptItems ?? null,
    chainTranscriptItems: input.chainTranscriptItems ?? null,
  });
  const publicStatusSnapshots = sessionState.publicStatusSnapshots
    .filter((entry) => sessionIds.has(entry.sessionId))
    .sort((left, right) => normalizeTraceTimestamp(left.resolvedAt) - normalizeTraceTimestamp(right.resolvedAt));
  const result = extractTraceResult({ transcriptItems });
  const ratingRequest = extractTraceRatingRequest({ transcriptItems });
  const derivedA2A = deriveA2AStatusFromTranscript({
    trace: input.trace,
    transcriptItems,
    publicStatusSnapshots,
  }) ?? input.trace.a2a;
  const inspectorPublicStatusSnapshots = withDerivedPublicStatusSnapshot({
    snapshots: publicStatusSnapshots.map((snapshot) => ({ ...snapshot })),
    a2a: derivedA2A,
    sessionId: selectedSessionId,
    taskRunId: normalizeText(selectedSession?.currentTaskRunId) || normalizeText(input.trace.a2a?.taskRunId) || null,
    observedAt: result.resultObservedAt ?? ratingRequest.ratingRequestedAt,
  });
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
  const order = input.trace.order;
  const peerGlobalMetaId = input.trace.session.peerGlobalMetaId
    ?? (selectedSession?.role === 'caller'
      ? selectedSession.providerGlobalMetaId
      : selectedSession?.callerGlobalMetaId)
    ?? null;

  return {
    ...input.trace,
    a2a: derivedA2A,
    sessionId: selectedSessionId,
    orderPinId: order?.orderPinId ?? null,
    orderTxid: order?.orderTxid ?? null,
    orderTxids: order?.orderTxids ?? [],
    paymentTxid: order?.paymentTxid ?? null,
    localUiUrl: buildDaemonLocalUiUrl(input.daemon, '/ui/trace', {
      traceId: input.traceId,
      sessionId: selectedSessionId,
    }),
    session: {
      ...input.trace.session,
      ...(selectedSession ?? {}),
      id: input.trace.session.id,
      title: input.trace.session.title,
      type: input.trace.session.type,
      metabotId: input.trace.session.metabotId,
      peerGlobalMetaId,
      peerName: input.trace.session.peerName,
      externalConversationId: input.trace.session.externalConversationId,
    },
    ...result,
    ...ratingRequest,
    ...ratingClosure,
    ratingSyncState: ratingSnapshot.ratingSyncState,
    ratingSyncError: ratingSnapshot.ratingSyncError,
    inspector: {
      session: selectedSession,
      sessions,
      taskRuns,
      transcriptItems,
      publicStatusSnapshots: inspectorPublicStatusSnapshots,
      transcriptMarkdown: await readOptionalUtf8(input.trace.artifacts.transcriptMarkdownPath),
      traceMarkdown: await readOptionalUtf8(input.trace.artifacts.traceMarkdownPath),
    },
  };
}

export async function fetchPeerChatPublicKey(
  globalMetaId: string,
  options: { chainApiBaseUrl?: string } = {},
): Promise<string | null> {
  const normalized = normalizeText(globalMetaId);
  if (!normalized) return null;

  const urls = [
    ...(normalizeText(options.chainApiBaseUrl)
      ? [`${normalizeText(options.chainApiBaseUrl).replace(/\/$/, '')}/api/info/metaid/${encodeURIComponent(normalized)}`]
      : []),
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

async function listRuntimeDirectoryServices(input: {
  state: RuntimeState;
  directorySeedsPath: string;
  onlineServiceCacheStore?: ReturnType<typeof createOnlineServiceCacheStore>;
  ratingDetailStateStore?: ReturnType<typeof createRatingDetailStateStore>;
  resolvePeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  chainApiBaseUrl?: string;
  socketPresenceApiBaseUrl?: string;
  socketPresenceFailureMode?: 'throw' | 'assume_service_providers_online';
  onlineOnly: boolean;
  query?: string | null;
  cacheOnly?: boolean;
}): Promise<{
  services: Array<Record<string, unknown>>;
  discoverySource: 'chain' | 'seeded' | 'cache';
  fallbackUsed: boolean;
}> {
  const selectCachedServices = async (fallbackUsed: boolean) => {
    const cache = await input.onlineServiceCacheStore?.read().catch(() => null);
    if (!cache || cache.services.length === 0) {
      return null;
    }
    return {
      services: searchOnlineServiceCacheServices(cache.services, {
        query: input.query,
        onlineOnly: input.onlineOnly,
      }) as unknown as Array<Record<string, unknown>>,
      discoverySource: 'cache' as const,
      fallbackUsed,
    };
  };

  if (input.cacheOnly) {
    return (await selectCachedServices(false)) ?? {
      services: [],
      discoverySource: 'cache',
      fallbackUsed: false,
    };
  }

  const localServices = input.state.services
    .filter((service) => service.available === 1)
    .map((service) => summarizeService(service));
  let directory;
  let decoratedLocalServices;

  try {
    directory = await readChainDirectoryWithFallback({
      chainApiBaseUrl: input.chainApiBaseUrl,
      socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
      socketPresenceFailureMode: input.socketPresenceFailureMode,
      onlineOnly: input.onlineOnly,
      fetchSeededDirectoryServices: async () => fetchSeededDirectoryServices(input.directorySeedsPath),
    });
    decoratedLocalServices = await decorateServicesWithSocketPresence({
      services: localServices,
      socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
      socketPresenceFailureMode: input.socketPresenceFailureMode,
      onlineOnly: input.onlineOnly,
    });
  } catch (error) {
    const cached = await selectCachedServices(true);
    if (cached) {
      return cached;
    }
    throw error;
  }

  const mergedServices = await enrichServicesWithProviderChatPublicKeys({
    services: dedupeServices([
      ...directory.services,
      ...decoratedLocalServices,
    ]),
    resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
  });

  if (directory.fallbackUsed && mergedServices.length === 0) {
    const cached = await selectCachedServices(true);
    if (cached) {
      return cached;
    }
  }

  let ratingDetails: Awaited<ReturnType<ReturnType<typeof createRatingDetailStateStore>['read']>>['items'] = [];
  if (input.ratingDetailStateStore) {
    const current = await input.ratingDetailStateStore.read();
    try {
      const refreshed = await refreshRatingDetailCacheFromChain({
        store: input.ratingDetailStateStore,
        chainApiBaseUrl: input.chainApiBaseUrl,
      });
      ratingDetails = refreshed.state.items;
    } catch {
      ratingDetails = current.items;
    }
  }

  const cacheState = buildOnlineServiceCacheState({
    services: mergedServices,
    ratingDetails,
    discoverySource: directory.source,
    fallbackUsed: directory.fallbackUsed,
  });
  await input.onlineServiceCacheStore?.write(cacheState).catch(() => null);

  const services = searchOnlineServiceCacheServices(cacheState.services, {
    query: input.query,
    onlineOnly: input.onlineOnly,
  }) as unknown as Array<Record<string, unknown>>;

  return {
    services,
    discoverySource: directory.source,
    fallbackUsed: directory.fallbackUsed,
  };
}

async function listRuntimeDirectoryMasters(input: {
  masterStateStore: ReturnType<typeof createPublishedMasterStateStore>;
  directorySeedsPath: string;
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
    fetchSeededDirectoryMasters: async () => fetchSeededDirectoryMasters(input.directorySeedsPath),
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
  directorySeedsPath: string;
  chainApiBaseUrl?: string;
  host?: string | null;
  onlineOnly?: boolean;
  providerGlobalMetaId?: string | null;
  localProviderOnline: boolean;
  localLastSeenSec: number | null;
  providerDaemonBaseUrl?: string | null;
}): Promise<{
  selectedMaster: MasterDirectoryItem | null;
  failureCode: 'master_not_found' | 'master_offline' | 'master_host_mode_mismatch' | null;
  failureMessage: string | null;
}> {
  const servicePinId = normalizeText(input.draft.target.servicePinId);
  const providerGlobalMetaId = normalizeText(input.draft.target.providerGlobalMetaId);
  const masterKind = normalizeText(input.draft.target.masterKind);
  if (!servicePinId || !providerGlobalMetaId || !masterKind) {
    return {
      selectedMaster: null,
      failureCode: null,
      failureMessage: null,
    };
  }

  const directory = await listRuntimeDirectoryMasters({
    masterStateStore: input.masterStateStore,
    directorySeedsPath: input.directorySeedsPath,
    chainApiBaseUrl: input.chainApiBaseUrl,
    onlineOnly: false,
    host: '',
    masterKind: undefined,
    localProviderOnline: input.localProviderOnline,
    localLastSeenSec: input.localLastSeenSec,
    providerDaemonBaseUrl: input.providerDaemonBaseUrl,
    providerGlobalMetaId: input.providerGlobalMetaId,
  });

  return resolveMasterCandidate({
    hostMode: normalizeText(input.host) || DEFAULT_MASTER_HOST_MODE,
    preferredMasterPinId: servicePinId,
    preferredProviderGlobalMetaId: providerGlobalMetaId,
    preferredMasterKind: masterKind,
    onlineOnly: input.onlineOnly === true,
    candidates: directory.masters,
  });
}

async function resolveSuggestedMasterTarget(input: {
  draft: ReturnType<typeof readMasterAskDraft>;
  preferredMasterKind?: string | null;
  trustedMasters?: string[];
  masterStateStore: ReturnType<typeof createPublishedMasterStateStore>;
  directorySeedsPath: string;
  chainApiBaseUrl?: string;
  host?: string | null;
  providerGlobalMetaId?: string | null;
  localProviderOnline: boolean;
  localLastSeenSec: number | null;
  providerDaemonBaseUrl?: string | null;
}): Promise<MasterDirectoryItem | null> {
  const explicit = await resolveExplicitMasterTarget({
    draft: input.draft,
    masterStateStore: input.masterStateStore,
    directorySeedsPath: input.directorySeedsPath,
    chainApiBaseUrl: input.chainApiBaseUrl,
    host: input.host,
    onlineOnly: true,
    providerGlobalMetaId: input.providerGlobalMetaId,
    localProviderOnline: input.localProviderOnline,
    localLastSeenSec: input.localLastSeenSec,
    providerDaemonBaseUrl: input.providerDaemonBaseUrl,
  });
  if (explicit.selectedMaster?.online) {
    return explicit.selectedMaster;
  }

  const preferredMasterKind = normalizeText(input.preferredMasterKind) || normalizeText(input.draft.target.masterKind);
  const directory = await listRuntimeDirectoryMasters({
    masterStateStore: input.masterStateStore,
    directorySeedsPath: input.directorySeedsPath,
    chainApiBaseUrl: input.chainApiBaseUrl,
    onlineOnly: true,
    host: normalizeText(input.host) || DEFAULT_MASTER_HOST_MODE,
    masterKind: preferredMasterKind || undefined,
    localProviderOnline: input.localProviderOnline,
    localLastSeenSec: input.localLastSeenSec,
    providerDaemonBaseUrl: input.providerDaemonBaseUrl,
    providerGlobalMetaId: input.providerGlobalMetaId,
  });

  const trustedMasterSet = new Set(
    (input.trustedMasters ?? [])
      .map((entry) => normalizeText(entry))
      .filter(Boolean)
  );

  return selectMasterCandidate({
    hostMode: normalizeText(input.host) || DEFAULT_MASTER_HOST_MODE,
    preferredMasterKind,
    trustedMasters: [...trustedMasterSet],
    onlineOnly: true,
    candidates: directory.masters,
  });
}

function commandFailedForExplicitMasterSelection(input: {
  selection: Awaited<ReturnType<typeof resolveExplicitMasterTarget>>;
  notFoundMessage: string;
}): MetabotCommandResult<never> {
  const message = input.selection.failureMessage || input.notFoundMessage;
  if (input.selection.failureCode === 'master_offline') {
    return commandFailed('master_offline', message);
  }
  if (input.selection.failureCode === 'master_host_mode_mismatch') {
    return commandFailed('master_host_mode_mismatch', message);
  }
  return commandFailed('master_target_not_found', message);
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

async function createMasterAskPreviewResult(input: {
  draft: ReturnType<typeof readMasterAskDraft>;
  resolvedTarget: MasterDirectoryItem;
  state: RuntimeState;
  config: Awaited<ReturnType<ReturnType<typeof createConfigStore>['read']>>;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  pendingMasterAskStateStore: ReturnType<typeof createPendingMasterAskStateStore>;
  triggerModeOverride?: string | null;
  callerHostOverride?: string | null;
  traceIdOverride?: string | null;
  requiresConfirmationOverride?: boolean | null;
  latestEventOverride?: string | null;
  askMasterAutoMetadata?: AskMasterTraceAutoMetadata | null;
  afterPreviewPersisted?: (input: {
    trace: SessionTraceRecord;
    pendingAsk: PendingMasterAskRecord;
    preview: Awaited<ReturnType<typeof buildMasterAskPreview>>;
  }) => Promise<void> | void;
  sendPreparedRequest?: (input: {
    traceId: string;
    pendingAsk: PendingMasterAskRecord;
    resolvedTarget: MasterDirectoryItem;
    state: RuntimeState;
    config: Awaited<ReturnType<ReturnType<typeof createConfigStore>['read']>>;
  }) => Promise<any>;
}) {
  if (!input.state.identity) {
    return commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
  }

  const draft = {
    ...input.draft,
    triggerMode: normalizeText(input.triggerModeOverride) || input.draft.triggerMode,
  };
  const now = Date.now();
  const traceId = normalizeText(input.traceIdOverride) || buildMasterTraceId({
    providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
    servicePinId: input.resolvedTarget.masterPinId,
    question: draft.question,
    now,
  });
  const requestId = buildMasterRequestId(now);
  const callerHost = normalizeText(input.callerHostOverride) || DEFAULT_MASTER_HOST_MODE;

  let prepared;
  try {
    prepared = buildMasterAskPreview({
      draft,
      resolvedTarget: input.resolvedTarget,
      caller: {
        globalMetaId: input.state.identity.globalMetaId,
        name: input.state.identity.name,
        host: callerHost,
      },
      traceId,
      requestId,
      confirmationMode: input.config.askMaster.confirmationMode,
      requiresConfirmationOverride: input.requiresConfirmationOverride,
    });
  } catch (error) {
    return commandFailed(
      'invalid_master_ask_draft',
      error instanceof Error ? error.message : String(error)
    );
  }

  const pendingAskRecord: PendingMasterAskRecord = {
    traceId,
    requestId,
    createdAt: now,
    updatedAt: now,
    confirmationState: 'awaiting_confirmation',
    requestJson: prepared.requestJson,
    request: prepared.request,
    target: prepared.preview.target,
    preview: prepared.preview,
  };

  await input.pendingMasterAskStateStore.put({
    ...pendingAskRecord,
  });

  const previewLatestEvent = normalizeText(input.latestEventOverride) || 'master_preview_ready';

  const trace = buildSessionTrace({
    traceId,
    channel: 'a2a',
    exportRoot: input.runtimeStateStore.paths.exportsRoot,
    session: {
      id: `master-${traceId}`,
      title: `${input.resolvedTarget.displayName} Ask`,
      type: 'a2a',
      metabotId: input.state.identity.metabotId,
      peerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      peerName: input.resolvedTarget.displayName,
      externalConversationId: `master:${input.state.identity.globalMetaId}:${input.resolvedTarget.providerGlobalMetaId}:${traceId}`,
    },
    a2a: {
      role: 'caller',
      publicStatus: 'awaiting_confirmation',
      latestEvent: previewLatestEvent,
      taskRunState: 'queued',
      callerGlobalMetaId: input.state.identity.globalMetaId,
      callerName: input.state.identity.name,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      providerName: input.resolvedTarget.displayName,
      servicePinId: input.resolvedTarget.masterPinId,
    },
    askMaster: buildMasterTraceMetadata({
      role: 'caller',
      latestEvent: previewLatestEvent,
      publicStatus: 'awaiting_confirmation',
      requestId,
      masterKind: input.resolvedTarget.masterKind,
      servicePinId: input.resolvedTarget.masterPinId,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      displayName: input.resolvedTarget.displayName,
      triggerMode: normalizeText(prepared.request.trigger.mode),
      contextMode: normalizeText(prepared.request.extensions?.contextMode),
      confirmationMode: input.config.askMaster.confirmationMode,
      preview: {
        userTask: prepared.request.task.userTask,
        question: prepared.request.task.question,
      },
      auto: input.askMasterAutoMetadata,
    }),
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
          content: `Ask Master preview prepared for ${input.resolvedTarget.displayName}.`,
          metadata: {
            confirmCommand: prepared.preview.confirmation.confirmCommand,
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
          },
        },
      ],
    },
  });

  await persistTraceRecord(input.runtimeStateStore, trace);
  if (input.afterPreviewPersisted) {
    await input.afterPreviewPersisted({
      trace,
      pendingAsk: pendingAskRecord,
      preview: prepared,
    });
  }

  if (!prepared.preview.confirmation.requiresConfirmation) {
    return input.state.identity && input.sendPreparedRequest
      ? input.sendPreparedRequest({
          traceId,
          pendingAsk: pendingAskRecord,
          resolvedTarget: input.resolvedTarget,
          state: input.state,
          config: input.config,
        })
      : commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
  }

  return commandAwaitingConfirmation({
    traceId,
    requestId,
    confirmation: prepared.preview.confirmation,
    preview: prepared.preview,
    traceJsonPath: artifacts.traceJsonPath,
    traceMarkdownPath: artifacts.traceMarkdownPath,
    transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
  });
}

function buildStoredMasterSuggestDraft(input: {
  draft: ReturnType<typeof readMasterAskDraft>;
  resolvedTarget: MasterDirectoryItem;
}): Record<string, unknown> {
  return {
    target: {
      servicePinId: input.resolvedTarget.masterPinId,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      masterKind: input.resolvedTarget.masterKind,
      displayName: input.resolvedTarget.displayName,
    },
    triggerMode: 'suggest',
    contextMode: input.draft.contextMode,
    userTask: input.draft.userTask,
    question: input.draft.question,
    goal: input.draft.goal,
    workspaceSummary: input.draft.workspaceSummary,
    errorSummary: input.draft.errorSummary,
    diffSummary: input.draft.diffSummary,
    relevantFiles: [...input.draft.relevantFiles],
    artifacts: [...input.draft.artifacts],
    constraints: [...input.draft.constraints],
    desiredOutput: input.draft.desiredOutput,
  };
}

function buildMasterSuggestTriggerObservation(input: {
  now: number;
  traceId: string;
  hostMode: string;
  masterKind: string | null;
  failureSignatures: string[];
  explicitlyRejectedSuggestion?: boolean;
}): ReturnType<typeof readMasterTriggerObservation> {
  return {
    now: input.now,
    traceId: input.traceId,
    hostMode: input.hostMode,
    workspaceId: null,
    userIntent: {
      explicitlyAskedForMaster: false,
      explicitlyRejectedSuggestion: input.explicitlyRejectedSuggestion === true,
    },
    activity: {
      recentUserMessages: 0,
      recentAssistantMessages: 0,
      recentToolCalls: 0,
      recentFailures: 0,
      repeatedFailureCount: 0,
      noProgressWindowMs: null,
    },
    diagnostics: {
      failingTests: 0,
      failingCommands: 0,
      repeatedErrorSignatures: [...input.failureSignatures],
      uncertaintySignals: [],
    },
    workState: {
      hasPlan: false,
      todoBlocked: false,
      diffChangedRecently: false,
      onlyReadingWithoutConverging: false,
    },
    directory: {
      availableMasters: 1,
      trustedMasters: 0,
      onlineMasters: 1,
    },
    candidateMasterKindHint: input.masterKind,
  };
}

async function createMasterSuggestResult(input: {
  draft: ReturnType<typeof readMasterAskDraft>;
  resolvedTarget: MasterDirectoryItem;
  state: RuntimeState;
  config: Awaited<ReturnType<ReturnType<typeof createConfigStore>['read']>>;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  masterSuggestStateStore: ReturnType<typeof createMasterSuggestStateStore>;
  observation: ReturnType<typeof readMasterTriggerObservation>;
  decision: Extract<TriggerDecision, { action: 'suggest' }>;
}): Promise<MetabotCommandResult<Record<string, unknown>>> {
  if (!input.state.identity) {
    return commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
  }

  const now = Date.now();
  const traceId = normalizeText(input.observation.traceId) || buildMasterTraceId({
    providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
    servicePinId: input.resolvedTarget.masterPinId,
    question: input.draft.question,
    now,
  });
  const suggestionId = buildMasterSuggestionId(now);
  const hostMode = normalizeText(input.observation.hostMode) || DEFAULT_MASTER_HOST_MODE;
  const storedDraft = buildStoredMasterSuggestDraft({
    draft: input.draft,
    resolvedTarget: input.resolvedTarget,
  });
  const suggestionRecord: StoredMasterSuggestRecord = {
    suggestionId,
    traceId,
    createdAt: now,
    updatedAt: now,
    status: 'suggested',
    hostMode,
    candidateMasterKind: normalizeText(input.decision.candidateMasterKind) || input.resolvedTarget.masterKind,
    candidateDisplayName: input.resolvedTarget.displayName,
    reason: input.decision.reason,
    confidence: input.decision.confidence,
    failureSignatures: [...(input.observation.diagnostics?.repeatedErrorSignatures ?? [])],
    draft: storedDraft,
    target: {
      servicePinId: input.resolvedTarget.masterPinId,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      masterKind: input.resolvedTarget.masterKind,
      displayName: input.resolvedTarget.displayName,
    },
  };

  const trace = buildSessionTrace({
    traceId,
    channel: 'a2a',
    exportRoot: input.runtimeStateStore.paths.exportsRoot,
    createdAt: now,
    session: {
      id: `master-${traceId}`,
      title: `${input.resolvedTarget.displayName} Ask`,
      type: 'a2a',
      metabotId: input.state.identity.metabotId,
      peerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      peerName: input.resolvedTarget.displayName,
      externalConversationId: `master:${input.state.identity.globalMetaId}:${input.resolvedTarget.providerGlobalMetaId}:${traceId}`,
    },
    a2a: {
      role: 'caller',
      publicStatus: 'discovered',
      latestEvent: 'master_suggested',
      taskRunState: 'queued',
      callerGlobalMetaId: input.state.identity.globalMetaId,
      callerName: input.state.identity.name,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      providerName: input.resolvedTarget.displayName,
      servicePinId: input.resolvedTarget.masterPinId,
    },
    askMaster: buildMasterTraceMetadata({
      role: 'caller',
      canonicalStatus: 'suggested',
      latestEvent: 'master_suggested',
      publicStatus: 'discovered',
      requestId: null,
      masterKind: input.resolvedTarget.masterKind,
      servicePinId: input.resolvedTarget.masterPinId,
      providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
      displayName: input.resolvedTarget.displayName,
      triggerMode: 'suggest',
      contextMode: normalizeText(input.draft.contextMode) || input.config.askMaster.contextMode,
      confirmationMode: input.config.askMaster.confirmationMode,
      preview: {
        userTask: input.draft.userTask,
        question: input.draft.question,
      },
    }),
  });

  const artifacts = await exportSessionArtifacts({
    trace,
    transcript: {
      sessionId: trace.session.id,
      title: trace.session.title || 'Ask Master Suggestion',
      messages: [
        {
          id: `${traceId}-suggest`,
          type: 'assistant',
          timestamp: now,
          content: `Suggest asking ${input.resolvedTarget.displayName}: ${input.decision.reason}`,
          metadata: {
            suggestionId,
            confidence: input.decision.confidence,
          },
        },
      ],
    },
  });

  await persistTraceRecord(input.runtimeStateStore, trace);
  await input.masterSuggestStateStore.put(suggestionRecord);

  return commandSuccess({
    traceId,
    suggestion: {
      suggestionId,
      traceId,
      candidateMasterKind: suggestionRecord.candidateMasterKind,
      candidateDisplayName: suggestionRecord.candidateDisplayName,
      reason: suggestionRecord.reason,
      confidence: suggestionRecord.confidence,
      createdAt: suggestionRecord.createdAt,
    },
    traceJsonPath: artifacts.traceJsonPath,
    traceMarkdownPath: artifacts.traceMarkdownPath,
    transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
  });
}

function buildMasterRejectedSuggestionTrace(input: {
  baseTrace: SessionTraceRecord;
  suggestion: StoredMasterSuggestRecord;
  rejectedAt: number;
}): SessionTraceRecord {
  const preview = input.baseTrace.askMaster?.preview ?? {
    userTask: normalizeText(input.suggestion.draft.userTask) || null,
    question: normalizeText(input.suggestion.draft.question) || null,
  };

  return {
    ...input.baseTrace,
    a2a: input.baseTrace.a2a
      ? {
          ...input.baseTrace.a2a,
          role: 'caller',
          publicStatus: 'discovered',
          latestEvent: 'master_suggestion_rejected',
          taskRunState: 'queued',
        }
      : null,
    askMaster: buildMasterTraceMetadata({
      role: 'caller',
      canonicalStatus: 'discovered',
      latestEvent: 'master_suggestion_rejected',
      publicStatus: 'discovered',
      requestId: null,
      masterKind: normalizeText(input.suggestion.target.masterKind) || input.baseTrace.askMaster?.masterKind,
      servicePinId: normalizeText(input.suggestion.target.servicePinId) || input.baseTrace.askMaster?.servicePinId,
      providerGlobalMetaId: normalizeText(input.suggestion.target.providerGlobalMetaId)
        || input.baseTrace.askMaster?.providerGlobalMetaId,
      displayName: normalizeText(input.suggestion.target.displayName)
        || input.baseTrace.askMaster?.displayName
        || input.baseTrace.session.peerName,
      triggerMode: 'suggest',
      contextMode: input.baseTrace.askMaster?.contextMode,
      confirmationMode: input.baseTrace.askMaster?.confirmationMode,
      preview,
    }),
  };
}

function buildMasterCallerTraceAfterReply(input: {
  baseTrace: SessionTraceRecord;
  pendingAsk: PendingMasterAskRecord;
  latestEvent: 'provider_completed' | 'clarification_needed' | 'provider_failed' | 'timeout';
  publicStatus: 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
  taskRunState: 'completed' | 'needs_clarification' | 'failed' | 'timeout';
  response?: {
    status: string;
    summary: string;
    followUpQuestion: string | null;
    errorCode: string | null;
  } | null;
}): SessionTraceRecord {
  const preview = input.baseTrace.askMaster?.preview ?? {
    userTask: input.pendingAsk.request.task.userTask,
    question: input.pendingAsk.request.task.question,
  };
  const response = input.response
    ? {
        status: input.response.status,
        summary: input.response.summary,
        followUpQuestion: input.response.followUpQuestion,
        errorCode: input.response.errorCode,
      }
    : input.baseTrace.askMaster?.response;
  const failure = input.response && (
    input.response.status === 'failed'
    || input.response.status === 'declined'
    || input.response.status === 'unavailable'
  )
    ? {
        code: normalizeText(input.response.errorCode) || `master_${input.response.status}`,
        message: input.response.summary,
      }
    : null;

  return {
    ...input.baseTrace,
    a2a: {
      ...(input.baseTrace.a2a ?? {
        sessionId: null,
        taskRunId: null,
        role: 'caller',
        publicStatus: null,
        latestEvent: null,
        taskRunState: null,
        callerGlobalMetaId: null,
        callerName: null,
        providerGlobalMetaId: null,
        providerName: null,
        servicePinId: null,
      }),
      publicStatus: input.publicStatus,
      latestEvent: input.latestEvent,
      taskRunState: input.taskRunState,
    },
    askMaster: buildMasterTraceMetadata({
      role: input.baseTrace.a2a?.role,
      latestEvent: input.latestEvent,
      publicStatus: input.publicStatus,
      requestId: input.pendingAsk.requestId,
      masterKind: input.baseTrace.askMaster?.masterKind ?? input.pendingAsk.request.target.masterKind,
      servicePinId: input.baseTrace.askMaster?.servicePinId ?? input.pendingAsk.request.target.masterServicePinId,
      providerGlobalMetaId: input.baseTrace.askMaster?.providerGlobalMetaId ?? input.pendingAsk.request.target.providerGlobalMetaId,
      displayName: input.baseTrace.askMaster?.displayName
        || normalizeText(input.pendingAsk.target.displayName)
        || input.baseTrace.session.peerName,
      triggerMode: input.baseTrace.askMaster?.triggerMode ?? normalizeText(input.pendingAsk.request.trigger.mode),
      contextMode: input.baseTrace.askMaster?.contextMode ?? normalizeText(input.pendingAsk.request.extensions?.contextMode),
      confirmationMode: input.baseTrace.askMaster?.confirmationMode,
      preview,
      response,
      failure,
      auto: input.baseTrace.askMaster?.auto,
    }),
  };
}

async function exportAndPersistMasterCallerTrace(input: {
  trace: SessionTraceRecord;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  pendingAsk: PendingMasterAskRecord;
  requestPath: string;
  messagePinId: string | null;
  includeTimeoutNote?: boolean;
  outcome: {
    type: 'requesting_remote' | 'response' | 'timeout';
    timestamp: number;
    deliveryPinId?: string | null;
    responseStatus?: string | null;
    summary?: string | null;
    followUpQuestion?: string | null;
  };
}): Promise<Awaited<ReturnType<typeof exportSessionArtifacts>>> {
  const targetDisplayName = normalizeText(input.trace.askMaster?.displayName)
    || normalizeText(input.pendingAsk.target.displayName)
    || input.trace.session.peerName
    || 'Master';
  const shouldIncludeTimeoutNote = input.includeTimeoutNote === true
    || input.trace.askMaster?.canonicalStatus === 'timed_out'
    || input.trace.a2a?.publicStatus === 'timeout';
  const confirmCommand = `metabot master ask --trace-id ${input.trace.traceId} --confirm`;
  const messages: Parameters<typeof exportSessionArtifacts>[0]['transcript']['messages'] = [
    {
      id: `${input.trace.traceId}-user`,
      type: 'user',
      timestamp: input.trace.createdAt,
      content: normalizeText(input.pendingAsk.request.task.question),
    },
    {
      id: `${input.trace.traceId}-preview`,
      type: 'assistant',
      timestamp: input.trace.createdAt,
      content: `Preview prepared for ${targetDisplayName}.`,
      metadata: {
        confirmCommand,
      },
    },
    {
      id: `${input.trace.traceId}-sent`,
      type: 'assistant',
      timestamp: Number.isFinite(input.pendingAsk.sentAt) ? Number(input.pendingAsk.sentAt) : input.outcome.timestamp,
      content: `Ask Master request sent to ${targetDisplayName} over simplemsg.`,
      metadata: {
        messagePinId: input.messagePinId,
        path: input.requestPath,
      },
    },
  ];

  if (shouldIncludeTimeoutNote) {
    messages.push({
      id: `${input.trace.traceId}-timeout`,
      type: 'status_note',
      timestamp: Math.max(
        input.trace.createdAt + 1,
        input.outcome.timestamp - (input.outcome.type === 'response' ? 1 : 0),
      ),
      content: 'Foreground wait ended before the remote MetaBot returned. The task may still continue remotely.',
      metadata: {
        event: 'timeout',
      },
    });
  }

  if (input.outcome.type === 'response') {
    messages.push({
      id: `${input.trace.traceId}-response`,
      type: input.outcome.responseStatus === 'need_more_context'
        ? 'clarification_request'
        : input.outcome.responseStatus === 'failed'
          || input.outcome.responseStatus === 'declined'
          || input.outcome.responseStatus === 'unavailable'
          ? 'system'
          : 'assistant',
      timestamp: input.outcome.timestamp,
      content: normalizeText(input.outcome.summary),
      metadata: {
        responseStatus: input.outcome.responseStatus ?? null,
        followUpQuestion: input.outcome.followUpQuestion ?? null,
        deliveryPinId: input.outcome.deliveryPinId ?? null,
      },
    });
  } else if (input.outcome.type === 'timeout' && !shouldIncludeTimeoutNote) {
    messages.push({
      id: `${input.trace.traceId}-timeout`,
      type: 'status_note',
      timestamp: input.outcome.timestamp,
      content: 'Foreground wait ended before the remote MetaBot returned. The task may still continue remotely.',
      metadata: {
        event: 'timeout',
      },
    });
  }

  const artifacts = await exportSessionArtifacts({
    trace: input.trace,
    transcript: {
      sessionId: input.trace.session.id,
      title: input.trace.session.title || 'Ask Master',
      messages,
    },
  });
  await persistTraceRecord(input.runtimeStateStore, input.trace);
  return artifacts;
}

async function applyMasterCallerReplyResult(input: {
  reply: Extract<AwaitMetaWebMasterReplyResult, { state: 'completed' }>;
  trace: SessionTraceRecord;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  pendingAsk: PendingMasterAskRecord;
  requestPath: string;
  messagePinId: string | null;
}): Promise<{
  trace: SessionTraceRecord;
  artifacts: Awaited<ReturnType<typeof exportSessionArtifacts>>;
  session: {
    state: 'completed' | 'manual_action_required' | 'remote_failed';
    publicStatus: 'completed' | 'manual_action_required' | 'remote_failed';
    event: 'provider_completed' | 'clarification_needed' | 'provider_failed';
  };
}> {
  const responseStatus = input.reply.response.status;
  const includeTimeoutNote = input.trace.askMaster?.canonicalStatus === 'timed_out'
    || input.trace.a2a?.publicStatus === 'timeout';
  const session = responseStatus === 'completed'
    ? {
        state: 'completed' as const,
        publicStatus: 'completed' as const,
        event: 'provider_completed' as const,
      }
    : responseStatus === 'need_more_context'
      ? {
          state: 'manual_action_required' as const,
          publicStatus: 'manual_action_required' as const,
          event: 'clarification_needed' as const,
        }
      : {
          state: 'remote_failed' as const,
          publicStatus: 'remote_failed' as const,
          event: 'provider_failed' as const,
        };
  const taskRunState = responseStatus === 'completed'
    ? 'completed' as const
    : responseStatus === 'need_more_context'
      ? 'needs_clarification' as const
      : 'failed' as const;
  const trace = buildMasterCallerTraceAfterReply({
    baseTrace: input.trace,
    pendingAsk: input.pendingAsk,
    latestEvent: session.event,
    publicStatus: session.publicStatus,
    taskRunState,
    response: {
      status: input.reply.response.status,
      summary: input.reply.response.summary,
      followUpQuestion: input.reply.response.followUpQuestion,
      errorCode: input.reply.response.errorCode,
    },
  });
  const artifacts = await exportAndPersistMasterCallerTrace({
    trace,
    runtimeStateStore: input.runtimeStateStore,
    pendingAsk: input.pendingAsk,
    requestPath: input.requestPath,
    messagePinId: input.messagePinId,
    includeTimeoutNote,
    outcome: {
      type: 'response',
      timestamp: input.reply.observedAt ?? Date.now(),
      deliveryPinId: input.reply.deliveryPinId,
      responseStatus: input.reply.response.status,
      summary: input.reply.response.summary,
      followUpQuestion: input.reply.response.followUpQuestion,
    },
  });

  return {
    trace,
    artifacts,
    session,
  };
}


async function loadMasterContinuationTrace(input: {
  traceId: string;
  runtimeStateStore: ReturnType<typeof createRuntimeStateStore>;
  fallbackTrace: SessionTraceRecord;
}): Promise<SessionTraceRecord> {
  const runtimeState = await input.runtimeStateStore.readState();
  return runtimeState.traces.find((entry) => entry.traceId === input.traceId) ?? input.fallbackTrace;
}

export async function rebuildTraceArtifactsFromSessionState(input: {
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
    .sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp))
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
    .sort((left, right) => normalizeTraceTimestamp(left.resolvedAt) - normalizeTraceTimestamp(right.resolvedAt))
    .at(-1);

  const nextTrace = buildSessionTrace({
    traceId: input.baseTrace.traceId,
    channel: input.baseTrace.channel,
    exportRoot: input.runtimeStateStore.paths.exportsRoot,
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
    askMaster: input.baseTrace.askMaster
      ? buildMasterTraceMetadata({
          role: latestSession?.role ?? input.baseTrace.a2a?.role,
          latestEvent: latestSnapshot?.rawEvent ?? input.baseTrace.a2a?.latestEvent,
          publicStatus: latestSnapshot?.status ?? input.baseTrace.a2a?.publicStatus,
          requestId: input.baseTrace.askMaster.requestId,
          masterKind: input.baseTrace.askMaster.masterKind,
          servicePinId: latestSession?.servicePinId
            ?? input.baseTrace.askMaster.servicePinId
            ?? input.baseTrace.a2a?.servicePinId,
          providerGlobalMetaId: latestSession?.providerGlobalMetaId
            ?? input.baseTrace.askMaster.providerGlobalMetaId
            ?? input.baseTrace.a2a?.providerGlobalMetaId,
          displayName: input.baseTrace.askMaster.displayName,
          triggerMode: input.baseTrace.askMaster.triggerMode,
          contextMode: input.baseTrace.askMaster.contextMode,
          confirmationMode: input.baseTrace.askMaster.confirmationMode,
          preview: input.baseTrace.askMaster.preview,
          response: input.baseTrace.askMaster.response,
          failure: input.baseTrace.askMaster.failure,
          auto: input.baseTrace.askMaster.auto,
        })
      : null,
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

  const rebuilt = await rebuildTraceArtifactsFromSessionState({
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
  adapters?: ChainAdapterRegistry;
  identitySyncStepDelayMs?: number;
  chainApiBaseUrl?: string;
  idChatApiBaseUrl?: string;
  socketPresenceApiBaseUrl?: string;
  socketPresenceFailureMode?: 'throw' | 'assume_service_providers_online';
  fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  fetchPrivateChatHistory?: FetchPrivateHistory;
  callerReplyWaiter?: MetaWebServiceReplyWaiter;
  masterReplyWaiter?: MetaWebMasterReplyWaiter;
  servicePaymentExecutor?: ServicePaymentExecutor;
  ratingFollowupRetryDelaysMs?: number[];
  a2aConversationPersister?: A2AConversationMessagePersister;
  buyerRatingReplyRunner?: ChatReplyRunner;
  onProviderPresenceChanged?: (enabled: boolean) => Promise<void> | void;
  requestMvcGasSubsidy?: (
    options: RequestMvcGasSubsidyOptions
  ) => Promise<RequestMvcGasSubsidyResult>;
  createSignerForHome?: (homeDir: string) => Signer;
  autoReplyConfig?: PrivateChatAutoReplyConfig;
  llmExecutor?: Pick<LlmExecutor, 'execute' | 'getSession' | 'cancel' | 'listSessions' | 'streamEvents'>;
  providerRuntimeCanStart?: (runtime: LlmRuntime) => Promise<boolean> | boolean;
}): MetabotDaemonHttpHandlers {
  const secretStore = input.secretStore ?? createFileSecretStore(input.homeDir);
  // Create default adapter registry if none provided (backward compat)
  const adapters = input.adapters ?? createChainAdapterRegistry([
    mvcChainAdapter,
    btcChainAdapter,
    dogeChainAdapter,
  ]);
  const signer = input.signer ?? createLocalMnemonicSigner({
    secretStore,
    adapters,
  });
  const configStore = createConfigStore(input.homeDir);
  const runtimeStateStore = createRuntimeStateStore(input.homeDir);
  const llmRuntimeStore = createLlmRuntimeStore(input.homeDir);
  const llmBindingStore = createLlmBindingStore(input.homeDir);
  const masterStateStore = createPublishedMasterStateStore(input.homeDir);
  const pendingMasterAskStateStore = createPendingMasterAskStateStore(input.homeDir);
  const masterSuggestStateStore = createMasterSuggestStateStore(input.homeDir);
  const masterAutoFeedbackStateStore = createMasterAutoFeedbackStateStore(input.homeDir);
  const providerPresenceStore = createProviderPresenceStateStore(input.homeDir);
  const ratingDetailStateStore = createRatingDetailStateStore(input.homeDir);
  const onlineServiceCacheStore = createOnlineServiceCacheStore(input.homeDir);
  const sessionStateStore = createSessionStateStore(input.homeDir);
  const privateChatStateStore = createPrivateChatStateStore(input.homeDir);
  const autoReplyConfig: PrivateChatAutoReplyConfig = input.autoReplyConfig ?? {
    enabled: true,
    acceptPolicy: 'accept_all',
    defaultStrategyId: null,
  };
  const sessionEngine = createA2ASessionEngine();
  const resolvePeerChatPublicKey = input.fetchPeerChatPublicKey
    ?? ((globalMetaId: string) => fetchPeerChatPublicKey(globalMetaId, {
      chainApiBaseUrl: input.chainApiBaseUrl,
    }));
  const callerReplyWaiter = input.callerReplyWaiter ?? createSocketIoMetaWebReplyWaiter();
  const masterReplyWaiter = input.masterReplyWaiter ?? null;
  const servicePaymentExecutor = input.servicePaymentExecutor ?? createWalletServicePaymentExecutor({
    secretStore,
    adapters: adapters ?? new Map(),
  });
  const ratingMempoolRetryDelaysMs = normalizeRetryDelays(
    input.ratingFollowupRetryDelaysMs,
    DEFAULT_RATING_FOLLOWUP_RETRY_DELAYS_MS,
  );
  const a2aConversationPersister = input.a2aConversationPersister ?? persistA2AConversationMessage;
  const buyerRatingReplyRunner = input.buyerRatingReplyRunner ?? createDefaultChatReplyRunner();
  const normalizedSystemHomeDir = normalizeText(input.systemHomeDir) || input.homeDir;
  const getDaemonRecord = input.getDaemonRecord;
  // Keep daemon-side follow-up consumers alive after foreground timeout so late deliveries still land in trace state.
  const pendingCallerReplyContinuations = new Map<string, Promise<void>>();
  /** Serializes buyer auto-rating per trace so inbound simplemsg + socket continuation cannot publish duplicates. */
  const buyerAutoRatingPublishChains = new Map<string, Promise<void>>();
  const pendingMasterReplyContinuations = new Map<string, Promise<void>>();
  const pendingBuyerRatingPublishes = new Map<string, Promise<MetabotCommandResult<Record<string, unknown>>>>();
  let masterTriggerMemoryState = createMasterTriggerMemoryState();
  const masterAutoPrepareCounts = new Map<string, number>();
  let lastMasterAutoPreparedAt: number | null = null;

  function getMasterAutoPrepareCount(traceId: string | null | undefined): number {
    const normalizedTraceId = normalizeText(traceId);
    if (!normalizedTraceId) {
      return 0;
    }
    return masterAutoPrepareCounts.get(normalizedTraceId) ?? 0;
  }

  function recordMasterAutoPrepare(traceId: string | null | undefined, now: number): void {
    const normalizedTraceId = normalizeText(traceId);
    if (normalizedTraceId) {
      masterAutoPrepareCounts.set(normalizedTraceId, getMasterAutoPrepareCount(normalizedTraceId) + 1);
    }
    if (Number.isFinite(now)) {
      lastMasterAutoPreparedAt = Math.max(0, Math.trunc(now));
    }
  }

  async function loadPrivateHistoryMessagesForProfile(args: {
    profile: { homeDir?: string | null; globalMetaId?: string | null; name?: string | null };
    peerGlobalMetaId: string;
  }): Promise<{
    messages: ChatViewerMessage[];
    localGlobalMetaId: string;
    peerGlobalMetaId: string;
  } | null> {
    const localGlobalMetaId = normalizeText(args.profile.globalMetaId);
    const peerGlobalMetaId = normalizeText(args.peerGlobalMetaId);
    if (!localGlobalMetaId || !peerGlobalMetaId) {
      return null;
    }

    const profileHomeDir = normalizeText(args.profile.homeDir) || input.homeDir;
    const privateChatSigner = profileHomeDir === normalizeText(input.homeDir)
      ? signer
      : createLocalMnemonicSigner({ secretStore: createFileSecretStore(profileHomeDir) });

    let privateChatIdentity;
    try {
      privateChatIdentity = await privateChatSigner.getPrivateChatIdentity();
    } catch {
      return null;
    }

    let peerChatPublicKey = peerGlobalMetaId === localGlobalMetaId
      ? normalizeText(privateChatIdentity.chatPublicKey)
      : '';
    if (!peerChatPublicKey) {
      peerChatPublicKey = await resolvePeerChatPublicKey(peerGlobalMetaId) ?? '';
    }
    if (!peerChatPublicKey) {
      return null;
    }

    try {
      const messages: ChatViewerMessage[] = [];
      const seenIds = new Set<string>();
      let afterIndex: number | undefined;
      for (let page = 0; page < 10; page += 1) {
        const response = await buildPrivateConversationResponse({
          selfGlobalMetaId: localGlobalMetaId,
          peerGlobalMetaId,
          localPrivateKeyHex: privateChatIdentity.privateKeyHex,
          peerChatPublicKey,
          afterIndex,
          limit: 200,
          fetchHistory: input.fetchPrivateChatHistory,
          idChatApiBaseUrl: input.idChatApiBaseUrl,
        });
        for (const message of response.messages) {
          const id = normalizeText(message.id);
          if (!id || seenIds.has(id)) {
            continue;
          }
          seenIds.add(id);
          messages.push(message);
        }
        if (response.messages.length < 200 || response.nextPollAfterIndex <= (afterIndex ?? -1)) {
          break;
        }
        afterIndex = response.nextPollAfterIndex;
      }
      return {
        messages,
        localGlobalMetaId,
        peerGlobalMetaId,
      };
    } catch {
      return null;
    }
  }

  async function buildScopedPrivateHistoryProjectionForTrace(args: {
    profile: { homeDir?: string | null; globalMetaId?: string | null; name?: string | null };
    trace: SessionTraceRecord;
    session: A2ASessionRecord;
    peerGlobalMetaId: string;
  }): Promise<ScopedPrivateHistoryProjection | null> {
    const sessionId = normalizeText(args.session.sessionId);
    const orderTxid = normalizeChainTxid(args.trace.order?.orderTxid);
    const paymentTxid = normalizeText(args.trace.order?.paymentTxid);
    const servicePinId = normalizeText(args.trace.order?.serviceId)
      || normalizeText(args.trace.a2a?.servicePinId)
      || normalizeText(args.session.servicePinId);
    if (!sessionId || (!orderTxid && !paymentTxid && !servicePinId)) {
      return null;
    }

    const loaded = await loadPrivateHistoryMessagesForProfile({
      profile: args.profile,
      peerGlobalMetaId: args.peerGlobalMetaId,
    });
    if (!loaded) {
      return null;
    }

    return projectScopedPrivateHistory({
      messages: loaded.messages,
      sessionId,
      localGlobalMetaId: loaded.localGlobalMetaId,
      peerGlobalMetaId: loaded.peerGlobalMetaId,
      localRole: args.session.role === 'provider' ? 'provider' : 'caller',
      orderTxid,
      paymentTxid,
      servicePinId,
    });
  }

  async function buildPeerPrivateHistoryProjectionForUnifiedSession(args: {
    profile: { homeDir?: string | null; globalMetaId?: string | null; name?: string | null };
    session: UnifiedA2ATraceSessionDetail;
  }): Promise<ScopedPrivateHistoryProjection | null> {
    const sessionId = normalizeText(args.session.sessionId);
    const peerGlobalMetaId = normalizeText(args.session.peerGlobalMetaId)
      || normalizeText(args.session.session?.peerGlobalMetaId);
    if (!sessionId || !peerGlobalMetaId) {
      return null;
    }

    const loaded = await loadPrivateHistoryMessagesForProfile({
      profile: args.profile,
      peerGlobalMetaId,
    });
    if (!loaded) {
      return null;
    }

    return projectPeerPrivateHistory({
      messages: loaded.messages,
      sessionId,
      localGlobalMetaId: loaded.localGlobalMetaId,
      peerGlobalMetaId: loaded.peerGlobalMetaId,
      localRole: normalizeText(args.session.a2a?.role) === 'provider' ? 'provider' : 'caller',
    });
  }

  function enrichUnifiedSessionWithPeerHistory(
    session: UnifiedA2ATraceSessionDetail,
    projection: ScopedPrivateHistoryProjection | null,
  ): UnifiedA2ATraceSessionDetail {
    if (!projection?.transcriptItems.length) {
      return session;
    }

    const transcriptItems = projection.transcriptItems.map((item) => ({
      ...item,
      taskRunId: null,
      metadata: item.metadata ?? {},
    }));
    const result = extractTraceResult({ transcriptItems });
    const ratingRequest = extractTraceRatingRequest({ transcriptItems });
    const latestOrder = transcriptItems
      .slice()
      .reverse()
      .find((item) => item.type === 'order');
    const latestOrderMetadata = latestOrder?.metadata ?? {};
    const orderTxid = normalizeChainTxid(latestOrderMetadata.orderTxid)
      || normalizeChainTxid(latestOrderMetadata.txid)
      || normalizeChainTxid(session.orderTxid);
    const paymentTxid = normalizeText(latestOrderMetadata.paymentTxid)
      || normalizeText(session.paymentTxid)
      || null;
    const localMetabotName = projection.localName ?? session.localMetabotName;
    const localMetabotAvatar = projection.localAvatar ?? session.localMetabotAvatar;
    const peerName = projection.peerName ?? session.peerName;
    const peerAvatar = projection.peerAvatar ?? session.peerAvatar;
    const sessionRecord = {
      ...session.session,
      peerName,
      peerAvatar,
    };
    const order = session.order
      ? {
          ...session.order,
          ...(orderTxid ? { orderTxid } : {}),
          ...(paymentTxid ? { paymentTxid } : {}),
        }
      : session.order;

    return {
      ...session,
      session: sessionRecord,
      transcriptItems,
      order,
      orderTxid: orderTxid || session.orderTxid,
      orderTxids: orderTxid ? [orderTxid] : session.orderTxids,
      paymentTxid: paymentTxid || session.paymentTxid,
      resultText: result.resultText,
      responseText: result.resultText,
      resultObservedAt: result.resultObservedAt,
      resultDeliveryPinId: result.resultDeliveryPinId,
      ratingRequestText: ratingRequest.ratingRequestText,
      ratingRequestedAt: ratingRequest.ratingRequestedAt,
      ratingRequested: Boolean(ratingRequest.ratingRequestText),
      localMetabotName,
      localMetabotAvatar,
      peerName,
      peerAvatar,
      inspector: {
        ...session.inspector,
        session: sessionRecord,
        sessions: [sessionRecord],
        transcriptItems,
      },
    };
  }

  async function resolveCurrentTraceProfile(): Promise<{
    homeDir: string;
    name?: string | null;
    slug?: string | null;
    globalMetaId?: string | null;
  } | null> {
    const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
    const profile = profiles.find((entry) => path.resolve(entry.homeDir) === path.resolve(input.homeDir));
    if (profile) {
      return profile;
    }

    const state = await runtimeStateStore.readState().catch(() => null);
    if (!state?.identity?.globalMetaId) {
      return null;
    }
    return {
      homeDir: input.homeDir,
      name: state.identity.name,
      slug: path.basename(runtimeStateStore.paths.profileRoot),
      globalMetaId: state.identity.globalMetaId,
    };
  }

  async function buildTraceOrderHistoryProjection(args: {
    trace: SessionTraceRecord;
    selectedSession?: A2ASessionRecord | null;
    profile?: {
      homeDir: string;
      name?: string | null;
      slug?: string | null;
      globalMetaId?: string | null;
    } | null;
    includePrivateHistory?: boolean;
  }): Promise<{
    unifiedTranscriptItems: A2ATranscriptItemRecord[] | null;
    chainTranscriptItems: A2ATranscriptItemRecord[] | null;
  }> {
    const profile = args.profile ?? await resolveCurrentTraceProfile();
    if (!profile) {
      return {
        unifiedTranscriptItems: null,
        chainTranscriptItems: null,
      };
    }

    const unifiedOrderSession = await findUnifiedA2ATraceSessionForProfileByOrder({
      profile,
      orderTxid: args.trace.order?.orderTxid ?? null,
      paymentTxid: args.trace.order?.paymentTxid ?? null,
      daemon: input.getDaemonRecord(),
    }).catch(() => null);
    const unifiedTranscriptItems = filterTranscriptItemsForTraceOrder(
      args.trace,
      unifiedOrderSession?.transcriptItems as A2ATranscriptItemRecord[] | null | undefined,
    );

    let chainTranscriptItems: A2ATranscriptItemRecord[] | null = null;
    if (args.includePrivateHistory !== false && args.selectedSession) {
      const peerGlobalMetaId = args.trace.session.peerGlobalMetaId
        ?? (args.selectedSession.role === 'caller'
          ? args.selectedSession.providerGlobalMetaId
          : args.selectedSession.callerGlobalMetaId)
        ?? null;
      if (peerGlobalMetaId) {
        const privateHistoryProjection = await buildScopedPrivateHistoryProjectionForTrace({
          profile,
          trace: args.trace,
          session: args.selectedSession,
          peerGlobalMetaId,
        }).catch(() => null);
        chainTranscriptItems = privateHistoryProjection?.transcriptItems ?? null;
      }
    }

    return {
      unifiedTranscriptItems: unifiedTranscriptItems.length ? unifiedTranscriptItems : null,
      chainTranscriptItems,
    };
  }

  async function buildUnifiedOrderTraceWatchEvents(traceId: string): Promise<ReturnType<typeof buildTraceWatchEvents>> {
    const runtimeState = await runtimeStateStore.readState();
    const trace = runtimeState.traces.find((entry) => entry.traceId === traceId);
    if (!trace) {
      return [];
    }
    const sessionState = await sessionStateStore.readState();
    const sessions = sessionState.sessions.filter((entry) => entry.traceId === traceId);
    const selectedSession = sessions
      .slice()
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .at(-1) ?? null;
    const orderHistoryProjection = await buildTraceOrderHistoryProjection({
      trace,
      selectedSession,
      includePrivateHistory: false,
    });
    const transcriptItems = mergeLegacyTranscriptWithUnifiedChainMessages({
      transcriptItems: sessionState.transcriptItems.filter((entry) => (
        sessions.some((session) => session.sessionId === entry.sessionId)
      )),
      unifiedTranscriptItems: orderHistoryProjection.unifiedTranscriptItems,
      chainTranscriptItems: null,
    });
    const derivedA2A = deriveA2AStatusFromTranscript({
      trace,
      transcriptItems,
      publicStatusSnapshots: sessionState.publicStatusSnapshots.filter((entry) => (
        sessions.some((session) => session.sessionId === entry.sessionId)
      )),
    });
    const status = normalizeText(derivedA2A?.publicStatus);
    const sessionId = normalizeText(selectedSession?.sessionId) || normalizeText(trace.a2a?.sessionId);
    const publicStatus = status as PublicStatus;
    if (!status || !sessionId || !isTerminalTraceWatchStatus(publicStatus)) {
      return [];
    }
    return [
      {
        traceId,
        sessionId,
        taskRunId: normalizeText(selectedSession?.currentTaskRunId) || normalizeText(trace.a2a?.taskRunId) || null,
        status: publicStatus,
        terminal: true,
        observedAt: Date.now(),
      },
    ];
  }

  function buildAutoTriggerReasonSignature(input: {
    observation?: TriggerObservation | null;
    autoReason?: string | null;
  }): string | null {
    const repeatedErrorSignatures = readStringArray(readObject(input.observation?.diagnostics)?.repeatedErrorSignatures);
    if (repeatedErrorSignatures.length > 0) {
      return repeatedErrorSignatures[0];
    }
    return normalizeText(input.autoReason) || null;
  }

  function buildAskMasterAutoMetadata(input: {
    reason?: string | null;
    confidence?: number | null;
    frictionMode?: 'preview_confirm' | 'direct_send' | null;
    detectorVersion?: string | null;
    selectedMasterTrusted?: boolean | null;
    sensitivity?: {
      isSensitive?: boolean | null;
      reasons?: string[] | null;
    } | null;
  }): AskMasterTraceAutoMetadata | null {
    const reason = normalizeText(input.reason) || null;
    const confidence = typeof input.confidence === 'number' && Number.isFinite(input.confidence)
      ? input.confidence
      : Number.isFinite(Number(input.confidence))
        ? Number(input.confidence)
        : null;
    const frictionMode = normalizeText(input.frictionMode);
    const sensitivityReasons = readStringArray(input.sensitivity?.reasons);
    const auto: AskMasterTraceAutoMetadata = {
      reason,
      confidence,
      frictionMode: frictionMode === 'preview_confirm' || frictionMode === 'direct_send'
        ? frictionMode
        : null,
      detectorVersion: normalizeText(input.detectorVersion) || null,
      selectedMasterTrusted: typeof input.selectedMasterTrusted === 'boolean'
        ? input.selectedMasterTrusted
        : null,
      sensitivity: input.sensitivity
        ? {
            isSensitive: input.sensitivity.isSensitive === true,
            reasons: sensitivityReasons,
          }
        : null,
    };

    return auto.reason
      || auto.confidence !== null
      || auto.frictionMode
      || auto.detectorVersion
      || auto.selectedMasterTrusted !== null
      || auto.sensitivity
      ? auto
      : null;
  }

  async function readMasterAutoFeedback(traceId: string | null | undefined) {
    const normalizedTraceId = normalizeText(traceId);
    if (!normalizedTraceId) {
      return null;
    }
    try {
      return await masterAutoFeedbackStateStore.get(normalizedTraceId);
    } catch {
      return null;
    }
  }

  async function putMasterAutoFeedback(input: {
    traceId: string | null | undefined;
    status: 'prepared' | 'confirmed' | 'rejected' | 'sent' | 'timed_out' | 'completed';
    masterKind?: string | null;
    masterServicePinId?: string | null;
    triggerReasonSignature?: string | null;
    updatedAt?: number | null;
    createdAt?: number | null;
  }): Promise<void> {
    const traceId = normalizeText(input.traceId);
    if (!traceId) {
      return;
    }

    const existing = await readMasterAutoFeedback(traceId);
    const createdAt = Number.isFinite(input.createdAt) && input.createdAt !== null
      ? Math.max(0, Math.trunc(Number(input.createdAt)))
      : existing?.createdAt ?? Date.now();
    const updatedAt = Number.isFinite(input.updatedAt) && input.updatedAt !== null
      ? Math.max(0, Math.trunc(Number(input.updatedAt)))
      : Date.now();

    await masterAutoFeedbackStateStore.put({
      traceId,
      masterKind: normalizeText(input.masterKind) || existing?.masterKind || null,
      masterServicePinId: normalizeText(input.masterServicePinId) || existing?.masterServicePinId || null,
      triggerReasonSignature: normalizeText(input.triggerReasonSignature) || existing?.triggerReasonSignature || null,
      status: input.status,
      createdAt,
      updatedAt,
    });
  }

  async function registerActiveIdentityProfile(identity: RuntimeIdentityRecord): Promise<void> {
    const profile = await upsertIdentityProfile({
      systemHomeDir: normalizedSystemHomeDir,
      name: identity.name,
      homeDir: input.homeDir,
      globalMetaId: identity.globalMetaId,
      mvcAddress: identity.mvcAddress,
    });
    await setActiveMetabotHome({
      systemHomeDir: normalizedSystemHomeDir,
      homeDir: profile.homeDir,
    });
  }

  function createSignerForProfileHome(profileHomeDir: string): Signer {
    const normalizedProfileHomeDir = path.resolve(profileHomeDir);
    if (normalizedProfileHomeDir === path.resolve(input.homeDir)) {
      return signer;
    }
    if (input.createSignerForHome) {
      return input.createSignerForHome(normalizedProfileHomeDir);
    }
    const profileAdapters = adapters ?? new Map();
    return createLocalMnemonicSigner({
      secretStore: createFileSecretStore(normalizedProfileHomeDir),
      adapters: profileAdapters,
    });
  }

  async function publishBuyerServiceRating(request: {
    traceId: string;
    rate: number;
    comment: string;
    network?: string;
  }): Promise<MetabotCommandResult<Record<string, unknown>>> {
    const traceId = normalizeText(request.traceId);
    if (!traceId) {
      return publishBuyerServiceRatingUnlocked(request);
    }

    const pending = pendingBuyerRatingPublishes.get(traceId);
    if (pending) {
      return pending;
    }

    const publish = publishBuyerServiceRatingUnlocked({ ...request, traceId });
    pendingBuyerRatingPublishes.set(traceId, publish);
    try {
      return await publish;
    } finally {
      if (pendingBuyerRatingPublishes.get(traceId) === publish) {
        pendingBuyerRatingPublishes.delete(traceId);
      }
    }
  }

  async function publishBuyerServiceRatingUnlocked(request: {
    traceId: string;
    rate: number;
    comment: string;
    network?: string;
  }): Promise<MetabotCommandResult<Record<string, unknown>>> {
    const state = await runtimeStateStore.readState();
    if (!state.identity) {
      return commandFailed('identity_missing', 'Create a local MetaBot identity before publishing service ratings.');
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

    const existingSessionState = await sessionStateStore.readState();
    const existingSessions = existingSessionState.sessions.filter((entry) => entry.traceId === request.traceId);
    const existingSessionIds = new Set(existingSessions.map((entry) => entry.sessionId));
    const existingClosure = extractTraceRatingClosure({
      trace,
      transcriptItems: existingSessionState.transcriptItems.filter((entry) => existingSessionIds.has(entry.sessionId)),
      ratingDetail: null,
    });
    if (existingClosure.ratingPublished && existingClosure.ratingPinId) {
      return commandSuccess({
        traceId: request.traceId,
        path: '/protocols/skill-service-rate',
        pinId: existingClosure.ratingPinId,
        txids: [],
        rate: String(existingClosure.ratingValue ?? request.rate),
        comment: existingClosure.ratingComment ?? request.comment,
        serviceId,
        servicePaidTx,
        serverBot,
        serviceSkill: normalizeText(trace.order?.serviceName),
        ratingMessageSent: existingClosure.ratingMessageSent ?? false,
        ratingMessagePinId: existingClosure.ratingMessagePinId,
        ratingMessageError: existingClosure.ratingMessageError,
        a2aStorePersisted: null,
        a2aStoreError: null,
        traceJsonPath: trace.artifacts.traceJsonPath,
        traceMarkdownPath: trace.artifacts.traceMarkdownPath,
        transcriptMarkdownPath: trace.artifacts.transcriptMarkdownPath,
      });
    }

    const directory = await listRuntimeDirectoryServices({
      state,
      directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
      onlineServiceCacheStore,
      ratingDetailStateStore,
      resolvePeerChatPublicKey,
      chainApiBaseUrl: input.chainApiBaseUrl,
      socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
      socketPresenceFailureMode: input.socketPresenceFailureMode,
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

    let ratingWrite;
    try {
      ratingWrite = await writePinRetryingMempoolConflict({
        signer,
        retryDelaysMs: ratingMempoolRetryDelaysMs,
        request: {
          operation: 'create',
          path: '/protocols/skill-service-rate',
          encryption: '0',
          version: '1.0.0',
          contentType: 'application/json',
          payload: JSON.stringify(payload),
          network: request.network,
        },
      });
    } catch (error) {
      return commandFailed(
        'service_rating_publish_failed',
        error instanceof Error ? error.message : String(error)
      );
    }

    const orderTxid = normalizeOrderProtocolReference(trace.order?.orderTxid)
      || normalizeOrderProtocolReference(trace.order?.orderPinId)
      || normalizeOrderProtocolReference(Array.isArray(trace.order?.orderTxids) ? trace.order?.orderTxids[0] : null)
      || '';
    const combinedBody = buildServiceRatingFollowupMessage({
      comment: request.comment,
      ratingPinId: ratingWrite.pinId ?? null,
    });
    const combinedMessage = orderTxid
      ? buildOrderEndMessage(orderTxid, 'rated', combinedBody)
      : buildOrderEndMessage('', 'rated', combinedBody);

    let ratingMessageSent = false;
    let ratingMessagePinId: string | null = null;
    let ratingMessageError: string | null = null;
    let ratingMessageTxids: string[] = [];
    let peerChatPublicKey = '';
    if (combinedMessage) {
      try {
        const privateChatIdentity = await signer.getPrivateChatIdentity();
        peerChatPublicKey = serverBot === state.identity.globalMetaId
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

        const ratingMessageWrite = await writePinRetryingMempoolConflict({
          signer,
          retryDelaysMs: ratingMempoolRetryDelaysMs,
          request: {
            operation: 'create',
            path: outgoingRatingMessage.path,
            encryption: outgoingRatingMessage.encryption,
            version: outgoingRatingMessage.version,
            contentType: outgoingRatingMessage.contentType,
            payload: outgoingRatingMessage.payload,
            encoding: 'utf-8',
            network: request.network,
          },
        });
        ratingMessageSent = true;
        ratingMessagePinId = ratingMessageWrite.pinId ?? null;
        ratingMessageTxids = Array.isArray(ratingMessageWrite.txids)
          ? ratingMessageWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
          : [];
      } catch (error) {
        ratingMessageError = error instanceof Error ? error.message : String(error);
      }
    }

    let a2aStorePersisted: boolean | null = null;
    let a2aStoreError: string | null = null;
    if (ratingMessageSent) {
      const a2aStoreResult = await persistA2AConversationMessageBestEffort({
        paths: runtimeStateStore.paths,
        local: {
          profileSlug: path.basename(runtimeStateStore.paths.profileRoot),
          globalMetaId: state.identity.globalMetaId,
          name: state.identity.name,
          chatPublicKey: state.identity.chatPublicKey,
        },
        peer: {
          globalMetaId: serverBot,
          name: normalizeText(trace.session.peerName) || normalizeText(trace.order?.serviceName) || null,
          chatPublicKey: peerChatPublicKey || null,
        },
        message: {
          direction: 'outgoing',
          content: combinedMessage,
          pinId: ratingMessagePinId,
          txid: ratingMessageTxids[0] ?? ratingMessagePinId,
          txids: ratingMessageTxids,
          chain: request.network ?? 'mvc',
          orderTxid: orderTxid || normalizeText(trace.order?.orderTxid) || null,
          paymentTxid: servicePaidTx,
          timestamp: Date.now(),
          raw: {
            ratingPinId: ratingWrite.pinId ?? null,
          },
        },
        orderSession: {
          role: 'caller',
          state: 'completed',
          orderTxid: orderTxid || normalizeText(trace.order?.orderTxid) || null,
          paymentTxid: servicePaidTx,
          servicePinId: serviceId,
          serviceName: normalizeText(trace.order?.serviceName) || null,
          outputType: null,
          endReason: 'rated',
        },
      }, a2aConversationPersister);
      a2aStorePersisted = a2aStoreResult.persisted;
      a2aStoreError = a2aStoreResult.errorMessage;
    }

    const sessionState = await sessionStateStore.readState();
    const latestSession = sessionState.sessions
      .filter((entry) => entry.traceId === request.traceId)
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .at(-1);
    let nextTrace = trace;
    let nextArtifacts = trace.artifacts;
    if (latestSession) {
      const now = Date.now();
      await appendA2ATranscriptItems(sessionStateStore, [
        {
          id: `${trace.traceId}-caller-rating-${now.toString(36)}`,
          sessionId: latestSession.sessionId,
          taskRunId: latestSession.currentTaskRunId,
          timestamp: now,
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
        {
          id: `${trace.traceId}-caller-rating-followup-${now.toString(36)}`,
          sessionId: latestSession.sessionId,
          taskRunId: latestSession.currentTaskRunId,
          timestamp: now + 1,
          type: ratingMessageSent ? 'order_end' : 'status_note',
          sender: ratingMessageSent ? 'caller' : 'system',
          content: ratingMessageSent
            ? combinedMessage
            : `Buyer-side rating was published on-chain, but provider follow-up delivery failed: ${ratingMessageError ?? 'unknown error'}`,
          metadata: {
            event: ratingMessageSent ? 'service_rating_message_sent' : 'service_rating_message_failed',
            protocolTag: ratingMessageSent ? 'ORDER_END' : null,
            orderTxid: orderTxid || normalizeText(trace.order?.orderTxid) || null,
            paymentTxid: servicePaidTx,
            ratingPinId: ratingWrite.pinId ?? null,
            ratingMessagePinId,
            ratingMessageError,
            rawContent: combinedMessage,
          },
        },
      ]);
      const rebuilt = await rebuildTraceArtifactsFromSessionState({
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
      a2aStorePersisted,
      a2aStoreError,
      traceJsonPath: nextArtifacts.traceJsonPath ?? nextTrace.artifacts.traceJsonPath,
      traceMarkdownPath: nextArtifacts.traceMarkdownPath ?? nextTrace.artifacts.traceMarkdownPath,
      transcriptMarkdownPath: nextArtifacts.transcriptMarkdownPath ?? nextTrace.artifacts.transcriptMarkdownPath,
    });
  }

  async function autoPublishBuyerRatingForReply(input: {
    trace: SessionTraceRecord;
    reply: AwaitMetaWebServiceReplyResult;
  }): Promise<void> {
    const traceKey = normalizeText(input.trace.traceId);
    if (!traceKey) {
      return;
    }
    const previous = buyerAutoRatingPublishChains.get(traceKey) ?? Promise.resolve();
    const job = previous.catch(() => {}).then(async () => {
      const ratingRequestText = input.reply.state === 'completed'
        ? normalizeText(input.reply.ratingRequestText)
        : '';
      if (!ratingRequestText) {
        return;
      }

      const runtimeState = await runtimeStateStore.readState();
      const trace = runtimeState.traces.find((entry) => entry.traceId === input.trace.traceId) ?? input.trace;
      const sessionState = await sessionStateStore.readState();
      const sessions = sessionState.sessions.filter((entry) => entry.traceId === trace.traceId);
      const sessionIds = new Set(sessions.map((entry) => entry.sessionId));
      const transcriptItems = sessionState.transcriptItems
        .filter((entry) => sessionIds.has(entry.sessionId))
        .sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp));
      const ratingClosure = extractTraceRatingClosure({
        trace,
        transcriptItems,
        ratingDetail: null,
      });
      if (ratingClosure.ratingPublished) {
        return;
      }

      const persona = await loadChatPersona(runtimeStateStore.paths);
      const rating = await generateBuyerServiceRating({
        replyRunner: buyerRatingReplyRunner,
        persona,
        traceId: trace.traceId,
        providerGlobalMetaId: normalizeText(trace.a2a?.providerGlobalMetaId) || normalizeText(trace.session.peerGlobalMetaId),
        providerName: normalizeText(trace.a2a?.providerName) || normalizeText(trace.session.peerName),
        originalRequest: normalizeText((trace.order as Record<string, unknown> | null | undefined)?.requestText),
        serviceResult: input.reply.state === 'completed' ? input.reply.responseText : null,
        expectedOutputType: normalizeText((trace.order as Record<string, unknown> | null | undefined)?.outputType),
        ratingRequestText,
        transcriptItems,
      });
      await publishBuyerServiceRating({
        traceId: trace.traceId,
        rate: rating.rate,
        comment: rating.comment,
        network: 'mvc',
      });
    });
    buyerAutoRatingPublishChains.set(traceKey, job);
    try {
      await job;
    } finally {
      if (buyerAutoRatingPublishChains.get(traceKey) === job) {
        buyerAutoRatingPublishChains.delete(traceKey);
      }
    }
  }

  function findBuyerTraceForInboundOrderProtocol(input: {
    traces: SessionTraceRecord[];
    providerGlobalMetaId: string;
    orderTxid?: string | null;
    paymentTxid?: string | null;
  }): SessionTraceRecord | null {
    const providerGlobalMetaId = normalizeText(input.providerGlobalMetaId);
    const orderTxid = normalizeOrderProtocolReference(input.orderTxid);
    const paymentTxid = normalizeText(input.paymentTxid);
    return input.traces.find((trace) => {
      if (normalizeText(trace.order?.role) !== 'buyer') {
        return false;
      }
      const traceProvider = normalizeText(trace.a2a?.providerGlobalMetaId)
        || normalizeText(trace.session.peerGlobalMetaId);
      if (providerGlobalMetaId && traceProvider && providerGlobalMetaId !== traceProvider) {
        return false;
      }
      const traceOrderTxid = normalizeOrderProtocolReference(trace.order?.orderTxid)
        || normalizeOrderProtocolReference(trace.order?.orderPinId)
        || (Array.isArray(trace.order?.orderTxids)
          ? trace.order.orderTxids.map((entry) => normalizeOrderProtocolReference(entry)).find(Boolean)
          : '')
        || '';
      const tracePaymentTxid = normalizeText(trace.order?.paymentTxid);
      return Boolean(
        (orderTxid && traceOrderTxid === orderTxid)
        || (paymentTxid && tracePaymentTxid === paymentTxid)
      );
    }) ?? null;
  }

  async function handleInboundOrderProtocolMessage(inputMessage: {
    fromGlobalMetaId: string;
    content: string;
    messagePinId?: string | null;
    timestamp?: number | null;
  }): Promise<MetabotCommandResult<Record<string, unknown>>> {
    const content = normalizeText(inputMessage.content);
    const delivery = parseDeliveryMessage(content);
    const needsRating = parseNeedsRatingMessage(content);
    if (!delivery && !needsRating) {
      return commandSuccess({ handled: false, rated: false });
    }

    const runtimeState = await runtimeStateStore.readState();
    const trace = findBuyerTraceForInboundOrderProtocol({
      traces: runtimeState.traces,
      providerGlobalMetaId: inputMessage.fromGlobalMetaId,
      orderTxid: delivery?.orderTxid ?? needsRating?.orderTxid ?? null,
      paymentTxid: delivery?.paymentTxid ?? null,
    });
    if (!trace) {
      return commandSuccess({ handled: false, rated: false });
    }

    if (!needsRating) {
      return commandSuccess({
        handled: true,
        rated: false,
        traceId: trace.traceId,
      });
    }

    const sessionState = await sessionStateStore.readState();
    const sessions = sessionState.sessions.filter((entry) => entry.traceId === trace.traceId);
    const selectedSession = sessions
      .slice()
      .sort((left, right) => left.updatedAt - right.updatedAt)
      .at(-1) ?? null;
    const orderHistoryProjection = await buildTraceOrderHistoryProjection({
      trace,
      selectedSession,
      includePrivateHistory: false,
    });
    const transcriptItems = mergeLegacyTranscriptWithUnifiedChainMessages({
      transcriptItems: sessionState.transcriptItems.filter((entry) => (
        sessions.some((session) => session.sessionId === entry.sessionId)
      )),
      unifiedTranscriptItems: orderHistoryProjection.unifiedTranscriptItems,
      chainTranscriptItems: null,
    });
    const result = extractTraceResult({ transcriptItems });
    const ratingRequest = extractTraceRatingRequest({ transcriptItems });

    await autoPublishBuyerRatingForReply({
      trace,
      reply: {
        state: 'completed',
        responseText: result.resultText ?? '',
        deliveryPinId: result.resultDeliveryPinId ?? null,
        observedAt: ratingRequest.ratingRequestedAt
          ?? (Number.isFinite(inputMessage.timestamp) ? Number(inputMessage.timestamp) : Date.now()),
        rawMessage: null,
        ratingRequestText: ratingRequest.ratingRequestText || normalizeText(needsRating.content),
      },
    });

    return commandSuccess({
      handled: true,
      rated: true,
      traceId: trace.traceId,
    });
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

        const applied = await applyCallerReplyResult({
          reply,
          session: current.session,
          taskRun: current.taskRun,
          sessionEngine,
          sessionStateStore,
          runtimeStateStore,
          trace: current.trace,
        });
        await autoPublishBuyerRatingForReply({
          trace: applied.trace,
          reply,
        });
      } catch {
        // Best effort follow-up: keep the persisted timeout state if late delivery capture fails.
      } finally {
        pendingCallerReplyContinuations.delete(input.trace.traceId);
      }
    })();

    pendingCallerReplyContinuations.set(input.trace.traceId, continuation);
  }

  function scheduleMasterReplyContinuation(input: {
    trace: SessionTraceRecord;
    pendingAsk: PendingMasterAskRecord;
    requestPath: string;
    messagePinId: string | null;
    waiterInput: AwaitMetaWebMasterReplyInput;
  }): void {
    if (!masterReplyWaiter || pendingMasterReplyContinuations.has(input.trace.traceId)) {
      return;
    }

    const continuation = (async () => {
      try {
        const reply = await masterReplyWaiter.awaitMasterReply({
          ...input.waiterInput,
          timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
        });
        if (reply.state !== 'completed') {
          return;
        }

        const currentTrace = await loadMasterContinuationTrace({
          traceId: input.trace.traceId,
          runtimeStateStore,
          fallbackTrace: input.trace,
        });
        const currentStatus = normalizeText(
          currentTrace.askMaster?.canonicalStatus
          ?? currentTrace.a2a?.publicStatus,
        );
        if (
          currentStatus === 'completed'
          || currentStatus === 'need_more_context'
          || currentStatus === 'failed'
        ) {
          return;
        }

        await applyMasterCallerReplyResult({
          reply,
          trace: currentTrace,
          runtimeStateStore,
          pendingAsk: input.pendingAsk,
          requestPath: input.requestPath,
          messagePinId: input.messagePinId,
        });
        if (normalizeText(input.pendingAsk.request.trigger.mode) === 'auto') {
          await putMasterAutoFeedback({
            traceId: input.trace.traceId,
            status: 'completed',
            masterKind: input.pendingAsk.request.target.masterKind,
            masterServicePinId: input.pendingAsk.request.target.masterServicePinId,
            updatedAt: reply.observedAt ?? Date.now(),
          });
        }
      } catch {
        // Best effort follow-up: keep the persisted timeout state if late delivery capture fails.
      } finally {
        pendingMasterReplyContinuations.delete(input.trace.traceId);
      }
    })();

    pendingMasterReplyContinuations.set(input.trace.traceId, continuation);
  }

  async function sendPendingMasterAskRequest(input: {
    traceId: string;
    pendingAsk: PendingMasterAskRecord;
    resolvedTarget: MasterDirectoryItem;
    state: RuntimeState;
    config: Awaited<ReturnType<ReturnType<typeof createConfigStore>['read']>>;
  }) {
    const initialState = await runtimeStateStore.readState();
    const currentIdentity = initialState.identity ?? input.state.identity;
    if (!currentIdentity) {
      return commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
    }
    const existingTrace = initialState.traces.find((entry) => entry.traceId === input.traceId) ?? null;
    const previewConfirmation = readObject(input.pendingAsk.preview)?.confirmation;
    const requiresConfirmation = readObject(previewConfirmation)?.requiresConfirmation === true;
    const isAutoAsk = normalizeText(
      existingTrace?.askMaster?.triggerMode
      ?? input.pendingAsk.request.trigger.mode
    ) === 'auto';
    const requestingLatestEvent = isAutoAsk && !requiresConfirmation
      ? 'auto_sent_without_confirmation'
      : 'request_sent';
    const markSendFailure = async (code: string, message: string) => {
      if (existingTrace) {
        const failedTrace = {
          ...existingTrace,
          a2a: {
            ...(existingTrace.a2a ?? {
              sessionId: null,
              taskRunId: null,
              role: 'caller',
              publicStatus: null,
              latestEvent: null,
              taskRunState: null,
              callerGlobalMetaId: currentIdentity.globalMetaId,
              callerName: currentIdentity.name,
              providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
              providerName: input.resolvedTarget.displayName,
              servicePinId: input.resolvedTarget.masterPinId,
            }),
            publicStatus: 'local_runtime_error',
            latestEvent: 'provider_delivery_failed',
            taskRunState: 'failed',
          },
          askMaster: buildMasterTraceMetadata({
            role: existingTrace.a2a?.role ?? 'caller',
            latestEvent: 'provider_delivery_failed',
            publicStatus: 'local_runtime_error',
            requestId: existingTrace.askMaster?.requestId ?? input.pendingAsk.requestId,
            masterKind: existingTrace.askMaster?.masterKind ?? input.resolvedTarget.masterKind,
            servicePinId: existingTrace.askMaster?.servicePinId ?? input.resolvedTarget.masterPinId,
            providerGlobalMetaId: existingTrace.askMaster?.providerGlobalMetaId
              ?? input.resolvedTarget.providerGlobalMetaId,
            displayName: existingTrace.askMaster?.displayName ?? input.resolvedTarget.displayName,
            triggerMode: existingTrace.askMaster?.triggerMode ?? normalizeText(input.pendingAsk.request.trigger.mode),
            contextMode: existingTrace.askMaster?.contextMode
              ?? normalizeText(input.pendingAsk.request.extensions?.contextMode),
            confirmationMode: existingTrace.askMaster?.confirmationMode ?? input.config.askMaster.confirmationMode,
            preview: existingTrace.askMaster?.preview ?? {
              userTask: input.pendingAsk.request.task.userTask,
              question: input.pendingAsk.request.task.question,
            },
            response: existingTrace.askMaster?.response,
            failure: {
              code,
              message,
            },
            auto: existingTrace.askMaster?.auto,
          }),
        };
        await exportSessionArtifacts({
          trace: failedTrace,
          transcript: {
            sessionId: failedTrace.session.id,
            title: failedTrace.session.title || 'Ask Master',
            messages: [
              {
                id: `${input.traceId}-user`,
                type: 'user',
                timestamp: failedTrace.createdAt,
                content: normalizeText(input.pendingAsk.request.task.question),
              },
              {
                id: `${input.traceId}-preview`,
                type: 'assistant',
                timestamp: failedTrace.createdAt,
                content: `Preview prepared for ${normalizeText(input.pendingAsk.target.displayName) || input.resolvedTarget.displayName}.`,
                metadata: requiresConfirmation
                  ? {
                      confirmCommand: `metabot master ask --trace-id ${input.traceId} --confirm`,
                    }
                  : undefined,
              },
              {
                id: `${input.traceId}-failure`,
                type: 'system',
                timestamp: Date.now(),
                content: `Ask Master auto send failed: ${message}`,
                metadata: {
                  code,
                },
              },
            ],
          },
        });
        await persistTraceRecord(runtimeStateStore, failedTrace);
      }
      if (isAutoAsk) {
        await putMasterAutoFeedback({
          traceId: input.traceId,
          status: 'prepared',
          masterKind: existingTrace?.askMaster?.masterKind ?? input.resolvedTarget.masterKind,
          masterServicePinId: existingTrace?.askMaster?.servicePinId ?? input.resolvedTarget.masterPinId,
        });
      }

      const traceSuffix = existingTrace ? ` Trace ID: ${input.traceId}` : '';
      return commandFailed(code, `${message}${traceSuffix}`);
    };

    let privateChatIdentity;
    try {
      privateChatIdentity = await signer.getPrivateChatIdentity();
    } catch (error) {
      return markSendFailure(
        'identity_secret_missing',
        error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.'
      );
    }

    const peerChatPublicKey = input.resolvedTarget.providerGlobalMetaId === currentIdentity.globalMetaId
      ? currentIdentity.chatPublicKey
      : await resolvePeerChatPublicKey(input.resolvedTarget.providerGlobalMetaId) ?? '';
    if (!peerChatPublicKey) {
      return markSendFailure(
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
        toGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
        peerChatPublicKey,
        content: input.pendingAsk.requestJson,
      });
    } catch (error) {
      return markSendFailure(
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
      return markSendFailure(
        'master_request_broadcast_failed',
        error instanceof Error ? error.message : String(error)
      );
    }

    const sentAt = Date.now();
    const sentPendingAsk: PendingMasterAskRecord = {
      ...input.pendingAsk,
      confirmationState: 'sent',
      updatedAt: sentAt,
      sentAt,
      messagePinId: messagePinId || null,
    };
    await pendingMasterAskStateStore.put(sentPendingAsk);
    if (isAutoAsk) {
      await putMasterAutoFeedback({
        traceId: input.traceId,
        status: 'sent',
        masterKind: input.resolvedTarget.masterKind,
        masterServicePinId: input.resolvedTarget.masterPinId,
        updatedAt: sentAt,
      });
    }

    const currentState = await runtimeStateStore.readState();
    const currentTrace = currentState.traces.find((entry) => entry.traceId === input.traceId);
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
              callerGlobalMetaId: currentIdentity.globalMetaId,
              callerName: currentIdentity.name,
              providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
              providerName: input.resolvedTarget.displayName,
              servicePinId: input.resolvedTarget.masterPinId,
            }),
            publicStatus: 'requesting_remote',
            latestEvent: requestingLatestEvent,
            taskRunState: 'running',
          },
          askMaster: buildMasterTraceMetadata({
            role: 'caller',
            latestEvent: requestingLatestEvent,
            publicStatus: 'requesting_remote',
            requestId: input.pendingAsk.requestId,
            masterKind: input.resolvedTarget.masterKind,
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            displayName: input.resolvedTarget.displayName,
            triggerMode: currentTrace.askMaster?.triggerMode ?? normalizeText(input.pendingAsk.request.trigger.mode),
            contextMode: currentTrace.askMaster?.contextMode
              ?? normalizeText(input.pendingAsk.request.extensions?.contextMode),
            confirmationMode: currentTrace.askMaster?.confirmationMode ?? input.config.askMaster.confirmationMode,
            preview: currentTrace.askMaster?.preview ?? {
              userTask: input.pendingAsk.request.task.userTask,
              question: input.pendingAsk.request.task.question,
            },
            response: currentTrace.askMaster?.response,
            failure: null,
            auto: currentTrace.askMaster?.auto,
          }),
        }
      : buildSessionTrace({
          traceId: input.traceId,
          channel: 'a2a',
          exportRoot: runtimeStateStore.paths.exportsRoot,
          session: {
            id: `master-${input.traceId}`,
            title: `${input.resolvedTarget.displayName} Ask`,
            type: 'a2a',
            metabotId: currentIdentity.metabotId,
            peerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            peerName: input.resolvedTarget.displayName,
            externalConversationId: `master:${currentIdentity.globalMetaId}:${input.resolvedTarget.providerGlobalMetaId}:${input.traceId}`,
          },
          a2a: {
            role: 'caller',
            publicStatus: 'requesting_remote',
            latestEvent: requestingLatestEvent,
            taskRunState: 'running',
            callerGlobalMetaId: currentIdentity.globalMetaId,
            callerName: currentIdentity.name,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            providerName: input.resolvedTarget.displayName,
            servicePinId: input.resolvedTarget.masterPinId,
          },
          askMaster: buildMasterTraceMetadata({
            role: 'caller',
            latestEvent: requestingLatestEvent,
            publicStatus: 'requesting_remote',
            requestId: input.pendingAsk.requestId,
            masterKind: input.resolvedTarget.masterKind,
            servicePinId: input.resolvedTarget.masterPinId,
            providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
            displayName: input.resolvedTarget.displayName,
            triggerMode: normalizeText(input.pendingAsk.request.trigger.mode),
            contextMode: normalizeText(input.pendingAsk.request.extensions?.contextMode),
            confirmationMode: input.config.askMaster.confirmationMode,
            preview: {
              userTask: input.pendingAsk.request.task.userTask,
              question: input.pendingAsk.request.task.question,
            },
            auto: existingTrace?.askMaster?.auto ?? null,
          }),
        });

    const confirmCommand = `metabot master ask --trace-id ${input.traceId} --confirm`;
    const transcriptMessages = [
      {
        id: `${input.traceId}-user`,
        type: 'user' as const,
        timestamp: updatedTrace.createdAt,
        content: normalizeText(input.pendingAsk.request.task.question),
      },
      ...(requiresConfirmation
        ? [{
            id: `${input.traceId}-preview`,
            type: 'assistant' as const,
            timestamp: updatedTrace.createdAt,
            content: `Preview prepared for ${normalizeText(input.pendingAsk.target.displayName) || input.resolvedTarget.displayName}.`,
            metadata: {
              confirmCommand,
            },
          }]
        : []),
      {
        id: `${input.traceId}-sent`,
        type: 'assistant' as const,
        timestamp: sentAt,
        content: `Ask Master request sent to ${input.resolvedTarget.displayName} over simplemsg.`,
        metadata: {
          messagePinId: messagePinId || null,
          path: outboundRequest.path,
        },
      },
    ];
    const artifacts = await exportSessionArtifacts({
      trace: updatedTrace,
      transcript: {
        sessionId: updatedTrace.session.id,
        title: updatedTrace.session.title || 'Ask Master',
        messages: transcriptMessages,
      },
    });

    await persistTraceRecord(runtimeStateStore, updatedTrace);

    let finalTrace = updatedTrace;
    let finalArtifacts = artifacts;
    let finalSession: {
      state: 'requesting_remote' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
      publicStatus: 'requesting_remote' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
      event: 'request_sent' | 'provider_completed' | 'clarification_needed' | 'provider_failed' | 'timeout';
    } = {
      state: 'requesting_remote',
      publicStatus: 'requesting_remote',
      event: 'request_sent',
    };
    let responseJson: string | null = null;
    let deliveryPinId: string | null = null;
    let structuredResponse: MasterResponseMessage | null = null;

    if (masterReplyWaiter) {
      scheduleMasterReplyContinuation({
        trace: updatedTrace,
        pendingAsk: sentPendingAsk,
        requestPath: outboundRequest.path,
        messagePinId: messagePinId || null,
        waiterInput: {
          callerGlobalMetaId: privateChatIdentity.globalMetaId,
          callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
          providerGlobalMetaId: input.resolvedTarget.providerGlobalMetaId,
          providerChatPublicKey: peerChatPublicKey,
          masterServicePinId: input.resolvedTarget.masterPinId,
          requestId: input.pendingAsk.requestId,
          traceId: input.traceId,
          timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
        },
      });

      const daemon = getDaemonRecord();
      return commandWaiting(
        'ask_sent_awaiting_master',
        'Request sent to master. Waiting for response...',
        3000,
        {
          localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId: input.traceId }),
          data: {
            traceId: input.traceId,
            requestId: input.pendingAsk.requestId,
            messagePinId: messagePinId || null,
            session: {
              state: 'requesting_remote',
              publicStatus: 'requesting_remote',
              event: 'request_sent',
            },
            traceJsonPath: artifacts.traceJsonPath,
            traceMarkdownPath: artifacts.traceMarkdownPath,
            transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
          },
        },
      );
    }

    return commandSuccess({
      localUiUrl: buildDaemonLocalUiUrl(getDaemonRecord(), '/ui/trace', { traceId: input.traceId }),
      traceId: input.traceId,
      requestId: input.pendingAsk.requestId,
      messagePinId: messagePinId || null,
      ...(deliveryPinId ? { deliveryPinId } : {}),
      ...(structuredResponse ? {
        response: structuredResponse,
        responseJson,
      } : {}),
      session: finalSession,
      traceJsonPath: finalArtifacts.traceJsonPath,
      traceMarkdownPath: finalArtifacts.traceMarkdownPath,
      transcriptMarkdownPath: finalArtifacts.transcriptMarkdownPath,
    });
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
          return commandSuccess({
            ...result,
            localUiUrl: buildDaemonLocalUiUrl(
              input.getDaemonRecord(),
              '/ui/buzz/app/index.html',
              { pinId: result.pinId }
            ) ?? '/ui/buzz/app/index.html',
          });
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
      create: async ({ name, host }) => {
        const normalizedName = normalizeText(name);
        if (!normalizedName) {
          return commandFailed('missing_name', 'MetaBot identity name is required.');
        }

        const state = await runtimeStateStore.readState();
        const existingName = normalizeText(state.identity?.name);
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir);
        const duplicateMatch = resolveProfileNameMatch(normalizedName, profiles);
        if (
          duplicateMatch.status === 'matched'
          && duplicateMatch.matchType !== 'ranked'
          && path.resolve(duplicateMatch.match.homeDir) !== path.resolve(input.homeDir)
        ) {
          return commandFailed(
            'identity_name_taken',
            `Local MetaBot name "${normalizedName}" already exists. Use metabot identity assign --name "${duplicateMatch.match.name}".`
          );
        }
        if (
          duplicateMatch.status === 'ambiguous'
          && duplicateMatch.candidates.some((profile) => path.resolve(profile.homeDir) !== path.resolve(input.homeDir))
        ) {
          return commandFailed(
            'identity_name_taken',
            duplicateMatch.message
          );
        }

        if (state.identity && existingName && existingName !== normalizedName) {
          return commandFailed(
            'identity_name_conflict',
            `Current active local identity is "${existingName}". Switch profile first or choose the same name.`
          );
        }
        const existingIdentity = state.identity;
        if (existingIdentity && isIdentityBootstrapReady(existingIdentity)) {
          await ensureProfileWorkspace({
            homeDir: input.homeDir,
            name: existingIdentity.name,
          });
          await registerActiveIdentityProfile(existingIdentity);
          return commandSuccess(existingIdentity);
        }

        const resolvedHome = resolveIdentityCreateProfileHome({
          systemHomeDir: normalizedSystemHomeDir,
          requestedName: normalizedName,
          profiles,
        });
        if (resolvedHome.status === 'duplicate') {
          return commandFailed(
            'identity_name_taken',
            resolvedHome.message
          );
        }

        const requestName = state.identity?.name || normalizedName;
        await ensureProfileWorkspace({
          homeDir: input.homeDir,
          name: requestName,
        });
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
          await registerActiveIdentityProfile(nextState.identity);
          await ensureDefaultPersonaFiles(runtimeStateStore.paths, normalizedName);

          // Auto-bind to LLM runtime if host is specified or detectable.
          try {
            const resolvedHost = normalizeText(host) || normalizeText(process.env.METABOT_HOST || '') || '';
            if (resolvedHost && ['claude-code', 'codex', 'openclaw'].includes(resolvedHost)) {
              const discoveryResult = await discoverLlmRuntimes({ env: process.env });
              const matchedRuntime = discoveryResult.runtimes.find((r) => r.provider === resolvedHost);
              if (matchedRuntime) {
                const runtimeStore = createLlmRuntimeStore(input.homeDir);
                await runtimeStore.upsertRuntime(matchedRuntime);
                const resolvedSlug = path.basename(input.homeDir);
                const bindingStore = createLlmBindingStore(input.homeDir);
                await bindingStore.upsertBinding({
                  id: `lb_${resolvedSlug}_${matchedRuntime.id}_primary`,
                  metaBotSlug: resolvedSlug,
                  llmRuntimeId: matchedRuntime.id,
                  role: 'primary',
                  priority: 0,
                  enabled: true,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                });
              }
            }
          } catch {
            // Auto-binding is best-effort; never fail identity creation.
          }

          return commandSuccess(nextState.identity);
        }

        return commandFailed(
          'identity_bootstrap_failed',
          bootstrap.error ?? 'MetaBot identity bootstrap failed before the identity was ready.'
        );
      },
      listProfiles: async () => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        return commandSuccess({
          profiles: profiles.map((p) => ({
            name: p.name,
            slug: p.slug,
            globalMetaId: p.globalMetaId,
            mvcAddress: p.mvcAddress,
            homeDir: p.homeDir,
          })),
        });
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
          directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
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
      hostAction: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
        }
        const identity = state.identity;

        const request = readMasterHostActionRequest(rawInput);
        const actionKind = normalizeText(request.action.kind);
        const config = await configStore.read();
        if (!config.askMaster.enabled && actionKind !== 'reject_suggest' && actionKind !== 'reject_auto_preview') {
          return commandFailed('ask_master_disabled', 'Ask Master is disabled in the local config.');
        }

        const daemon = input.getDaemonRecord();
        const presence = await providerPresenceStore.read();
        const localProviderOnline = isProviderPresenceOnline(presence);
        const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
          ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
          : null;
        const hostContext = readObject(request.context) ?? {};
        const hostMode = normalizeText(hostContext.hostMode) || DEFAULT_MASTER_HOST_MODE;
        if (actionKind === 'accept_suggest') {
          const traceId = normalizeText(request.action.traceId);
          const suggestionId = normalizeText(request.action.suggestionId);
          if (!traceId || !suggestionId) {
            return commandFailed(
              'invalid_master_host_action',
              'Accepting an Ask Master suggestion requires both traceId and suggestionId.'
            );
          }

          let suggestion;
          try {
            suggestion = await masterSuggestStateStore.get(traceId, suggestionId);
          } catch {
            return commandFailed(
              'master_suggestion_not_found',
              `Ask Master suggestion not found: ${traceId}:${suggestionId}`
            );
          }

          if (suggestion.status === 'rejected') {
            return commandFailed(
              'master_suggestion_rejected',
              'This Ask Master suggestion was already rejected.'
            );
          }

          const previewDraft = readMasterAskDraft(suggestion.draft);
          const resolvedTarget = await resolveExplicitMasterTarget({
            draft: previewDraft,
            masterStateStore,
            directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
            chainApiBaseUrl: input.chainApiBaseUrl,
            host: suggestion.hostMode,
            onlineOnly: true,
            localProviderOnline,
            localLastSeenSec,
            providerDaemonBaseUrl: daemon?.baseUrl || null,
            providerGlobalMetaId: identity.globalMetaId,
          });
          if (!resolvedTarget.selectedMaster) {
            return commandFailedForExplicitMasterSelection({
              selection: resolvedTarget,
              notFoundMessage: 'Suggested Master is no longer available for preview.',
            });
          }
          const policy = evaluateMasterPolicy({
            config: config.askMaster,
            action: 'accept_suggest',
            selectedMaster: resolvedTarget.selectedMaster,
          });
          if (!policy.allowed) {
            return commandFailed(
              policy.blockedReason === 'Ask Master is disabled by local config.'
                ? 'ask_master_disabled'
                : 'master_target_not_found',
              policy.blockedReason || 'Ask Master policy blocked the accepted suggestion.'
            );
          }

          const previewResult = await createMasterAskPreviewResult({
            draft: previewDraft,
            resolvedTarget: resolvedTarget.selectedMaster,
            state,
            config,
            runtimeStateStore,
            pendingMasterAskStateStore,
            triggerModeOverride: 'suggest',
            callerHostOverride: suggestion.hostMode,
            traceIdOverride: suggestion.traceId,
            sendPreparedRequest: sendPendingMasterAskRequest,
          });
          if (previewResult.ok) {
            const acceptedAt = Date.now();
            await masterSuggestStateStore.put({
              ...suggestion,
              status: 'accepted',
              updatedAt: acceptedAt,
              acceptedAt,
            });
            masterTriggerMemoryState = recordMasterTriggerOutcome({
              state: masterTriggerMemoryState,
              observation: buildMasterSuggestTriggerObservation({
                now: acceptedAt,
                traceId: suggestion.traceId,
                hostMode: suggestion.hostMode,
                masterKind: suggestion.candidateMasterKind,
                failureSignatures: suggestion.failureSignatures,
              }),
              decision: {
                action: 'manual_requested',
                reason: 'User accepted Ask Master suggestion.',
              },
            });
          }

          if (!previewResult.ok) {
            return previewResult;
          }

          return {
            ...previewResult,
            data: {
              ...previewResult.data,
              hostAction: 'accept_suggest',
              suggestionId,
            },
          };
        }

        if (actionKind === 'reject_suggest') {
          const traceId = normalizeText(request.action.traceId);
          const suggestionId = normalizeText(request.action.suggestionId);
          if (!traceId || !suggestionId) {
            return commandFailed(
              'invalid_master_host_action',
              'Rejecting an Ask Master suggestion requires both traceId and suggestionId.'
            );
          }

          let suggestion;
          try {
            suggestion = await masterSuggestStateStore.get(traceId, suggestionId);
          } catch {
            return commandFailed(
              'master_suggestion_not_found',
              `Ask Master suggestion not found: ${traceId}:${suggestionId}`
            );
          }

          const rejectionReason = normalizeText(request.action.reason) || null;
          const rejectedAt = Date.now();
          await masterSuggestStateStore.put({
            ...suggestion,
            status: 'rejected',
            updatedAt: rejectedAt,
            rejectedAt,
            rejectionReason,
          });
          masterTriggerMemoryState = recordMasterTriggerOutcome({
            state: masterTriggerMemoryState,
            observation: buildMasterSuggestTriggerObservation({
              now: rejectedAt,
              traceId: suggestion.traceId,
              hostMode: suggestion.hostMode,
              masterKind: suggestion.candidateMasterKind,
              failureSignatures: suggestion.failureSignatures,
              explicitlyRejectedSuggestion: true,
            }),
            decision: {
              action: 'no_action',
              reason: 'User rejected the previous suggestion.',
            },
          });
          const currentState = await runtimeStateStore.readState();
          const baseTrace = currentState.traces.find((entry) => entry.traceId === traceId) ?? null;
          if (baseTrace) {
            const updatedTrace = buildMasterRejectedSuggestionTrace({
              baseTrace,
              suggestion,
              rejectedAt,
            });
            await exportSessionArtifacts({
              trace: updatedTrace,
              transcript: {
                sessionId: updatedTrace.session.id,
                title: updatedTrace.session.title || 'Ask Master Suggestion',
                messages: [
                  {
                    id: `${traceId}-suggest`,
                    type: 'assistant',
                    timestamp: suggestion.createdAt,
                    content: `Suggest asking ${suggestion.target.displayName || suggestion.candidateDisplayName || 'the Master'}: ${suggestion.reason}`,
                    metadata: {
                      suggestionId,
                      confidence: suggestion.confidence,
                    },
                  },
                  {
                    id: `${traceId}-reject`,
                    type: 'user',
                    timestamp: rejectedAt,
                    content: rejectionReason
                      ? `Rejected Ask Master suggestion: ${rejectionReason}`
                      : 'Rejected Ask Master suggestion.',
                    metadata: {
                      event: 'master_suggestion_rejected',
                      suggestionId,
                    },
                  },
                ],
              },
            });
            await persistTraceRecord(runtimeStateStore, updatedTrace);
          }

          return commandSuccess({
            hostAction: 'reject_suggest',
            traceId,
            suggestionId,
            rejected: true,
            reason: rejectionReason,
          });
        }

        if (actionKind === 'reject_auto_preview') {
          const traceId = normalizeText(request.action.traceId);
          if (!traceId) {
            return commandFailed(
              'invalid_master_host_action',
              'Rejecting an automatic Ask Master preview requires traceId.'
            );
          }

          let pendingAsk;
          try {
            pendingAsk = await pendingMasterAskStateStore.get(traceId);
          } catch {
            return commandFailed(
              'pending_master_ask_not_found',
              `Pending Ask Master record not found: ${traceId}`
            );
          }
          if (normalizeText(pendingAsk.request.trigger.mode) !== 'auto') {
            return commandFailed(
              'not_auto_preview',
              `Trace is not an automatic Ask Master preview: ${traceId}`
            );
          }
          if (pendingAsk.confirmationState === 'sent') {
            return commandFailed(
              'master_request_already_sent',
              `Ask Master request has already been sent for this trace: ${traceId}.`
            );
          }

          const rejectedAt = Date.now();
          const rejectionReason = normalizeText(request.action.reason) || null;
          const currentState = await runtimeStateStore.readState();
          const baseTrace = currentState.traces.find((entry) => entry.traceId === traceId) ?? null;
          if (!baseTrace) {
            return commandFailed('trace_not_found', `Trace not found: ${traceId}`);
          }

          const updatedTrace = {
            ...baseTrace,
            a2a: {
              ...(baseTrace.a2a ?? {
                sessionId: null,
                taskRunId: null,
                role: 'caller',
                publicStatus: null,
                latestEvent: null,
                taskRunState: null,
                callerGlobalMetaId: state.identity.globalMetaId,
                callerName: state.identity.name,
                providerGlobalMetaId: pendingAsk.request.target.providerGlobalMetaId,
                providerName: normalizeText(pendingAsk.target.displayName) || baseTrace.session.peerName,
                servicePinId: pendingAsk.request.target.masterServicePinId,
              }),
              publicStatus: 'local_runtime_error',
              latestEvent: 'auto_preview_rejected',
              taskRunState: 'failed',
            },
            askMaster: buildMasterTraceMetadata({
              role: 'caller',
              latestEvent: 'auto_preview_rejected',
              publicStatus: 'local_runtime_error',
              requestId: pendingAsk.requestId,
              masterKind: pendingAsk.request.target.masterKind,
              servicePinId: pendingAsk.request.target.masterServicePinId,
              providerGlobalMetaId: pendingAsk.request.target.providerGlobalMetaId,
              displayName: normalizeText(pendingAsk.target.displayName) || baseTrace.askMaster?.displayName || baseTrace.session.peerName,
              triggerMode: 'auto',
              contextMode: baseTrace.askMaster?.contextMode ?? normalizeText(pendingAsk.request.extensions?.contextMode),
              confirmationMode: baseTrace.askMaster?.confirmationMode ?? config.askMaster.confirmationMode,
              preview: baseTrace.askMaster?.preview ?? {
                userTask: pendingAsk.request.task.userTask,
                question: pendingAsk.request.task.question,
              },
              response: baseTrace.askMaster?.response,
              failure: {
                code: 'auto_rejected_by_user',
                message: rejectionReason
                  ? `User declined the automatic Ask Master preview: ${rejectionReason}`
                  : 'User declined the automatic Ask Master preview.',
              },
              auto: baseTrace.askMaster?.auto,
            }),
          };

          await exportSessionArtifacts({
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
                  content: `Preview prepared for ${normalizeText(pendingAsk.target.displayName) || updatedTrace.session.peerName || 'the Master'}.`,
                  metadata: {
                    confirmCommand: `metabot master ask --trace-id ${traceId} --confirm`,
                  },
                },
                {
                  id: `${traceId}-reject`,
                  type: 'user',
                  timestamp: rejectedAt,
                  content: rejectionReason
                    ? `Declined automatic Ask Master preview: ${rejectionReason}`
                    : 'Declined automatic Ask Master preview.',
                  metadata: {
                    event: 'auto_preview_rejected',
                    code: 'auto_rejected_by_user',
                  },
                },
              ],
            },
          });
          await persistTraceRecord(runtimeStateStore, updatedTrace);
          await putMasterAutoFeedback({
            traceId,
            status: 'rejected',
            masterKind: pendingAsk.request.target.masterKind,
            masterServicePinId: pendingAsk.request.target.masterServicePinId,
            updatedAt: rejectedAt,
          });

          return commandSuccess({
            hostAction: 'reject_auto_preview',
            traceId,
            rejected: true,
            reason: rejectionReason,
          });
        }

        if (actionKind !== 'manual_ask') {
          return commandFailed(
            'not_implemented',
            `Master host-action kind is not implemented yet: ${actionKind || 'unknown'}.`
          );
        }

        const directory = await listRuntimeDirectoryMasters({
          masterStateStore,
          directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
          chainApiBaseUrl: input.chainApiBaseUrl,
          onlineOnly: false,
          host: hostMode,
          localProviderOnline,
          localLastSeenSec,
          providerDaemonBaseUrl: daemon?.baseUrl || null,
          providerGlobalMetaId: identity.globalMetaId,
        });
        const eligibleMasters = directory.masters.map((entry) => (
          normalizeText(entry.providerGlobalMetaId) === identity.globalMetaId
            ? {
                ...entry,
                online: true,
              }
            : entry
        ));

        let prepared;
        try {
          prepared = prepareManualAskHostAction({
            action: request.action,
            context: request.context,
            masters: eligibleMasters,
            config: {
              enabled: config.askMaster.enabled,
              triggerMode: config.askMaster.triggerMode,
              confirmationMode: config.askMaster.confirmationMode,
              contextMode: config.askMaster.contextMode,
              trustedMasters: config.askMaster.trustedMasters,
            },
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const errorCode = error && typeof error === 'object' && 'code' in error && typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : null;
          return commandFailed(
            errorCode
              || (message.includes('No eligible online Master')
                ? 'master_target_not_found'
                : 'invalid_master_host_action'),
            message
          );
        }

        const previewDraft = readMasterAskDraft({
          ...prepared.draft,
          target: {
            servicePinId: prepared.selectedTarget.masterPinId,
            providerGlobalMetaId: prepared.selectedTarget.providerGlobalMetaId,
            masterKind: prepared.selectedTarget.masterKind,
            displayName: prepared.selectedTarget.displayName,
          },
        });
        const previewResult = await createMasterAskPreviewResult({
          draft: previewDraft,
          resolvedTarget: prepared.selectedTarget,
          state,
          config,
          runtimeStateStore,
          pendingMasterAskStateStore,
          triggerModeOverride: 'manual',
          callerHostOverride: hostMode,
          sendPreparedRequest: sendPendingMasterAskRequest,
        });
        if (previewResult.ok && previewResult.state === 'awaiting_confirmation') {
          masterTriggerMemoryState = recordMasterTriggerOutcome({
            state: masterTriggerMemoryState,
            observation: {
              now: Date.now(),
              traceId: previewResult.data.traceId,
              hostMode,
              userIntent: {
                explicitlyAskedForMaster: true,
                explicitlyRejectedSuggestion: false,
              },
              directory: {
                availableMasters: eligibleMasters.length,
                trustedMasters: eligibleMasters.filter((entry) => (
                  config.askMaster.trustedMasters.includes(entry.masterPinId)
                )).length,
                onlineMasters: eligibleMasters.filter((entry) => entry.online).length,
              },
              candidateMasterKindHint: prepared.selectedTarget.masterKind,
            },
            decision: {
              action: 'manual_requested',
              reason: 'Host adapter received a manual Ask Master action.',
            },
          });
        }

        if (!previewResult.ok) {
          return previewResult;
        }

        return {
          ...previewResult,
          data: {
            ...previewResult.data,
            hostAction: 'manual_ask',
          },
        };
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
          const isAutoPreview = normalizeText(pendingAsk.request.trigger.mode) === 'auto';
          if (pendingAsk.confirmationState === 'sent') {
            return commandFailed(
              'master_request_already_sent',
              `Ask Master request has already been sent for this trace: ${traceId}. Create a new Ask Master request to retry.`
            );
          }
          if (isAutoPreview) {
            const feedback = await readMasterAutoFeedback(traceId);
            if (feedback?.status === 'rejected') {
              return commandFailed(
                'auto_preview_rejected',
                `This automatic Ask Master preview was already rejected: ${traceId}`
              );
            }
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
            directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
            chainApiBaseUrl: input.chainApiBaseUrl,
            host: normalizeText(pendingAsk.request.caller.host) || DEFAULT_MASTER_HOST_MODE,
            localProviderOnline,
            localLastSeenSec,
            providerDaemonBaseUrl: daemon?.baseUrl || null,
            providerGlobalMetaId: state.identity.globalMetaId,
          });
          if (!resolvedTarget.selectedMaster) {
            return commandFailedForExplicitMasterSelection({
              selection: resolvedTarget,
              notFoundMessage: 'Target Master is no longer available for confirmation.',
            });
          }
          const selectedTarget = resolvedTarget.selectedMaster;

          let privateChatIdentity;
          try {
            privateChatIdentity = await signer.getPrivateChatIdentity();
          } catch (error) {
            return commandFailed(
              'identity_secret_missing',
              error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.'
            );
          }

          const peerChatPublicKey = selectedTarget.providerGlobalMetaId === state.identity.globalMetaId
            ? state.identity.chatPublicKey
            : await resolvePeerChatPublicKey(selectedTarget.providerGlobalMetaId) ?? '';
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
              toGlobalMetaId: selectedTarget.providerGlobalMetaId,
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
          if (isAutoPreview) {
            await putMasterAutoFeedback({
              traceId,
              status: 'confirmed',
              masterKind: pendingAsk.request.target.masterKind,
              masterServicePinId: pendingAsk.request.target.masterServicePinId,
              updatedAt: Date.now(),
            });
          }

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
                    providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                    providerName: selectedTarget.displayName,
                    servicePinId: selectedTarget.masterPinId,
                  }),
                  publicStatus: 'requesting_remote',
                  latestEvent: 'request_sent',
                  taskRunState: 'running',
                },
                askMaster: buildMasterTraceMetadata({
                  role: 'caller',
                  latestEvent: 'request_sent',
                  publicStatus: 'requesting_remote',
                  requestId: pendingAsk.requestId,
                  masterKind: selectedTarget.masterKind,
                  servicePinId: selectedTarget.masterPinId,
                  providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                  displayName: selectedTarget.displayName,
                  triggerMode: currentTrace.askMaster?.triggerMode ?? normalizeText(pendingAsk.request.trigger.mode),
                  contextMode: currentTrace.askMaster?.contextMode
                    ?? normalizeText(pendingAsk.request.extensions?.contextMode),
                  confirmationMode: currentTrace.askMaster?.confirmationMode ?? config.askMaster.confirmationMode,
                  preview: currentTrace.askMaster?.preview ?? {
                    userTask: pendingAsk.request.task.userTask,
                    question: pendingAsk.request.task.question,
                  },
                  response: currentTrace.askMaster?.response,
                  failure: null,
                  auto: currentTrace.askMaster?.auto,
                }),
              }
            : buildSessionTrace({
                traceId,
                channel: 'a2a',
                exportRoot: runtimeStateStore.paths.exportsRoot,
                session: {
                  id: `master-${traceId}`,
                  title: `${selectedTarget.displayName} Ask`,
                  type: 'a2a',
                  metabotId: state.identity.metabotId,
                  peerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                  peerName: selectedTarget.displayName,
                  externalConversationId: `master:${state.identity.globalMetaId}:${selectedTarget.providerGlobalMetaId}:${traceId}`,
                },
                a2a: {
                  role: 'caller',
                  publicStatus: 'requesting_remote',
                  latestEvent: 'request_sent',
                  taskRunState: 'running',
                  callerGlobalMetaId: state.identity.globalMetaId,
                  callerName: state.identity.name,
                  providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                  providerName: selectedTarget.displayName,
                  servicePinId: selectedTarget.masterPinId,
                },
                askMaster: buildMasterTraceMetadata({
                  role: 'caller',
                  latestEvent: 'request_sent',
                  publicStatus: 'requesting_remote',
                  requestId: pendingAsk.requestId,
                  masterKind: selectedTarget.masterKind,
                  servicePinId: selectedTarget.masterPinId,
                  providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                  displayName: selectedTarget.displayName,
                  triggerMode: normalizeText(pendingAsk.request.trigger.mode),
                  contextMode: normalizeText(pendingAsk.request.extensions?.contextMode),
                  confirmationMode: config.askMaster.confirmationMode,
                  preview: {
                    userTask: pendingAsk.request.task.userTask,
                    question: pendingAsk.request.task.question,
                  },
                  auto: null,
                }),
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
                  content: `Preview prepared for ${normalizeText(pendingAsk.target.displayName) || selectedTarget.displayName}.`,
                  metadata: {
                    confirmCommand,
                  },
                },
                {
                  id: `${traceId}-sent`,
                  type: 'assistant',
                  timestamp: Date.now(),
                  content: `Ask Master request sent to ${selectedTarget.displayName} over simplemsg.`,
                  metadata: {
                    messagePinId: messagePinId || null,
                    path: outboundRequest.path,
                  },
                },
              ],
            },
          });

          await persistTraceRecord(runtimeStateStore, updatedTrace);

          let finalTrace = updatedTrace;
          let finalArtifacts = artifacts;
          let finalSession: {
            state: 'requesting_remote' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
            publicStatus: 'requesting_remote' | 'completed' | 'manual_action_required' | 'remote_failed' | 'timeout';
            event: 'request_sent' | 'provider_completed' | 'clarification_needed' | 'provider_failed' | 'timeout';
          } = {
            state: 'requesting_remote',
            publicStatus: 'requesting_remote',
            event: 'request_sent',
          };
          let responseJson: string | null = null;
          let deliveryPinId: string | null = null;
          let structuredResponse: MasterResponseMessage | null = null;

          if (masterReplyWaiter) {
            scheduleMasterReplyContinuation({
              trace: updatedTrace,
              pendingAsk: {
                ...pendingAsk,
                confirmationState: 'sent',
                updatedAt: Date.now(),
                sentAt: Number.isFinite(pendingAsk.sentAt) ? pendingAsk.sentAt : Date.now(),
                messagePinId: messagePinId || null,
              },
              requestPath: outboundRequest.path,
              messagePinId: messagePinId || null,
              waiterInput: {
                callerGlobalMetaId: privateChatIdentity.globalMetaId,
                callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
                providerGlobalMetaId: selectedTarget.providerGlobalMetaId,
                providerChatPublicKey: peerChatPublicKey,
                masterServicePinId: selectedTarget.masterPinId,
                requestId: pendingAsk.requestId,
                traceId,
                timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
              },
            });

            const daemon = input.getDaemonRecord();
            return commandWaiting(
              'ask_sent_awaiting_master',
              'Request sent to master. Waiting for response...',
              3000,
              {
                localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', { traceId }),
                data: {
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
                },
              },
            );
          }

          return commandSuccess({
            localUiUrl: buildDaemonLocalUiUrl(input.getDaemonRecord(), '/ui/trace', { traceId }),
            traceId,
            requestId: pendingAsk.requestId,
            messagePinId: messagePinId || null,
            ...(deliveryPinId ? { deliveryPinId } : {}),
            ...(structuredResponse ? {
              response: structuredResponse,
              responseJson,
            } : {}),
            session: finalSession,
            traceJsonPath: finalArtifacts.traceJsonPath,
            traceMarkdownPath: finalArtifacts.traceMarkdownPath,
            transcriptMarkdownPath: finalArtifacts.transcriptMarkdownPath,
          });
        }

        const draft = readMasterAskDraft(rawInput);
        const resolvedTarget = await resolveExplicitMasterTarget({
          draft,
          masterStateStore,
          directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
          chainApiBaseUrl: input.chainApiBaseUrl,
          localProviderOnline,
          localLastSeenSec,
          providerDaemonBaseUrl: daemon?.baseUrl || null,
          providerGlobalMetaId: state.identity.globalMetaId,
        });
        if (!resolvedTarget.selectedMaster) {
          return commandFailedForExplicitMasterSelection({
            selection: resolvedTarget,
            notFoundMessage: 'Target Master could not be resolved from the local directory.',
          });
        }
        const selectedTarget = resolvedTarget.selectedMaster;

        const previewResult = await createMasterAskPreviewResult({
          draft,
          resolvedTarget: selectedTarget,
          state,
          config,
          runtimeStateStore,
          pendingMasterAskStateStore,
          triggerModeOverride: 'manual',
          sendPreparedRequest: sendPendingMasterAskRequest,
        });
        if (previewResult.ok && previewResult.state === 'awaiting_confirmation') {
          masterTriggerMemoryState = recordMasterTriggerOutcome({
            state: masterTriggerMemoryState,
            observation: {
              now: Date.now(),
              traceId: previewResult.data.traceId,
              hostMode: DEFAULT_MASTER_HOST_MODE,
              userIntent: {
                explicitlyAskedForMaster: true,
                explicitlyRejectedSuggestion: false,
              },
              directory: {
                availableMasters: 1,
                trustedMasters: config.askMaster.trustedMasters.includes(selectedTarget.masterPinId) ? 1 : 0,
                onlineMasters: selectedTarget.online ? 1 : 0,
              },
              candidateMasterKindHint: selectedTarget.masterKind,
            },
            decision: {
              action: 'manual_requested',
              reason: 'Caller explicitly invoked metabot master ask.',
            },
          });
        }
        return previewResult;
      },
      suggest: async (rawInput: Record<string, unknown>) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before asking a Master.');
        }

        const config = await configStore.read();
        const daemon = input.getDaemonRecord();
        const presence = await providerPresenceStore.read();
        const localProviderOnline = isProviderPresenceOnline(presence);
        const localLastSeenSec = Number.isFinite(presence.lastHeartbeatAt)
          ? Math.floor(Number(presence.lastHeartbeatAt) / 1000)
          : null;
        const draft = readMasterAskDraft(readObject(rawInput.draft) ?? rawInput);
        const directoryPresence = readMasterTriggerDirectoryPresence(rawInput);
        const observation = await hydrateMasterTriggerObservationDirectory({
          observation: readMasterTriggerObservation(rawInput),
          trustedMasters: config.askMaster.trustedMasters,
          directoryPresence,
          masterStateStore,
          directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
          chainApiBaseUrl: input.chainApiBaseUrl,
          localProviderOnline,
          localLastSeenSec,
          providerDaemonBaseUrl: daemon?.baseUrl || null,
          providerGlobalMetaId: state.identity.globalMetaId,
        });
        const suggestState = await masterSuggestStateStore.read();
        const autoFeedbackState = await masterAutoFeedbackStateStore.read();
        const trigger = await collectAndEvaluateMasterTrigger({
          config: config.askMaster,
          suppression: mergeMasterTriggerMemoryStates(
            masterTriggerMemoryState,
            deriveMasterTriggerMemoryStateFromSuggestState({
              state: suggestState,
              now: observation.now,
            }),
            deriveMasterTriggerMemoryStateFromAutoFeedbackState({
              state: autoFeedbackState,
              now: observation.now,
            })
          ),
          collectObservation: async () => observation,
        });

        if (
          trigger.collected
          && (
            trigger.observation?.userIntent.explicitlyRejectedSuggestion
            || trigger.observation?.userIntent.explicitlyRejectedAutoAsk
          )
        ) {
          masterTriggerMemoryState = recordMasterTriggerOutcome({
            state: masterTriggerMemoryState,
            observation: trigger.observation,
            decision: trigger.decision,
          });
        }

        if (trigger.decision.action === 'no_action') {
          const blocked = trigger.decision.reason === 'Ask Master is disabled by local config.'
            ? {
                code: 'ask_master_disabled',
                message: trigger.decision.reason,
              }
            : trigger.decision.reason === 'Ask Master trigger mode is manual.'
              ? {
                  code: 'trigger_mode_disallows_suggest',
                  message: trigger.decision.reason,
                }
              : null;
          return commandSuccess({
            collected: trigger.collected,
            decision: trigger.decision,
            blocked,
          });
        }

        if (trigger.decision.action === 'manual_requested') {
          const policy = evaluateMasterPolicy({
            config: config.askMaster,
            action: trigger.decision.action,
            selectedMaster: null,
          });
          if (trigger.observation) {
            masterTriggerMemoryState = recordMasterTriggerOutcome({
              state: masterTriggerMemoryState,
              observation: trigger.observation,
              decision: trigger.decision,
            });
          }
          return commandSuccess({
            collected: trigger.collected,
            decision: policy.allowed
              ? trigger.decision
              : {
                  action: 'no_action',
                  reason: policy.blockedReason || trigger.decision.reason,
                },
            blocked: !policy.allowed
              ? {
                  code: policy.code,
                  message: policy.blockedReason || trigger.decision.reason,
                }
              : null,
          });
        }

        const resolvedTarget = await resolveSuggestedMasterTarget({
          draft,
          preferredMasterKind: 'candidateMasterKind' in trigger.decision
            ? normalizeText(trigger.decision.candidateMasterKind)
            : null,
          trustedMasters: config.askMaster.trustedMasters,
          masterStateStore,
          directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
          chainApiBaseUrl: input.chainApiBaseUrl,
          host: observation.hostMode,
          localProviderOnline,
          localLastSeenSec,
          providerDaemonBaseUrl: daemon?.baseUrl || null,
          providerGlobalMetaId: state.identity.globalMetaId,
        });
        if (!resolvedTarget) {
          return commandSuccess({
            collected: trigger.collected,
            decision: {
              action: 'no_action',
              reason: 'No matching online Master could be resolved for this suggestion.',
            },
            blocked: {
              code: 'master_not_found',
              message: 'No matching online Master could be resolved for this suggestion.',
            },
          });
        }
        if (trigger.decision.action === 'auto_candidate') {
          const recentTargetFeedback = findRecentAutoFeedbackForTarget({
            state: autoFeedbackState,
            masterServicePinId: resolvedTarget.masterPinId,
            now: observation.now,
          });
          if (recentTargetFeedback) {
            const reason = recentTargetFeedback.status === 'timed_out'
              ? 'The same Master target timed out recently.'
              : 'The same Master target was rejected recently.';
            return commandSuccess({
              collected: trigger.collected,
              decision: {
                action: 'no_action',
                reason,
              },
              blocked: {
                code: recentTargetFeedback.status === 'timed_out'
                  ? 'auto_global_cooldown'
                  : 'auto_per_trace_limited',
                message: reason,
              },
              target: {
                masterPinId: resolvedTarget.masterPinId,
                displayName: resolvedTarget.displayName,
                masterKind: resolvedTarget.masterKind,
                providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
              },
            });
          }

          const autoPlan = prepareAutoMasterAskPlan({
            draft,
            resolvedTarget,
            caller: {
              globalMetaId: state.identity.globalMetaId,
              name: state.identity.name,
              host: observation.hostMode,
            },
            config: config.askMaster,
            auto: {
              reason: trigger.decision.reason,
              confidence: trigger.decision.confidence,
              traceAutoPrepareCount: getMasterAutoPrepareCount(observation.traceId),
              lastAutoAt: lastMasterAutoPreparedAt,
              now: observation.now,
            },
          });
          if (!autoPlan.policy.allowed) {
            return commandSuccess({
              collected: trigger.collected,
              decision: {
                action: 'no_action',
                reason: autoPlan.policy.blockedReason || trigger.decision.reason,
              },
              blocked: {
                code: autoPlan.policy.code,
                message: autoPlan.policy.blockedReason || trigger.decision.reason,
              },
              autoPolicy: {
                selectedFrictionMode: autoPlan.policy.selectedFrictionMode,
                requiresConfirmation: autoPlan.policy.requiresConfirmation,
                policyReason: autoPlan.policy.policyReason,
                sensitivity: autoPlan.policy.sensitivity,
              },
              target: {
                masterPinId: resolvedTarget.masterPinId,
                displayName: resolvedTarget.displayName,
                masterKind: resolvedTarget.masterKind,
                providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
              },
            });
          }

          const autoTraceMetadata = buildAskMasterAutoMetadata({
            reason: autoPlan.autoReason || trigger.decision.reason,
            confidence: autoPlan.confidence,
            frictionMode: autoPlan.policy.selectedFrictionMode,
            detectorVersion: 'phase3-v1',
            selectedMasterTrusted: autoPlan.policy.trustedTarget,
            sensitivity: autoPlan.policy.sensitivity,
          });

          const autoResult = await createMasterAskPreviewResult({
            draft,
            resolvedTarget,
            state,
            config,
            runtimeStateStore,
            pendingMasterAskStateStore,
            triggerModeOverride: 'auto',
            callerHostOverride: observation.hostMode,
            traceIdOverride: observation.traceId,
            requiresConfirmationOverride: autoPlan.policy.requiresConfirmation,
            latestEventOverride: 'auto_preview_prepared',
            askMasterAutoMetadata: autoTraceMetadata,
            afterPreviewPersisted: async ({ trace }) => {
              await putMasterAutoFeedback({
                traceId: trace.traceId,
                status: 'prepared',
                masterKind: resolvedTarget.masterKind,
                masterServicePinId: resolvedTarget.masterPinId,
                triggerReasonSignature: buildAutoTriggerReasonSignature({
                  observation,
                  autoReason: autoPlan.autoReason || trigger.decision.reason,
                }),
                createdAt: trace.createdAt,
                updatedAt: trace.createdAt,
              });
            },
            sendPreparedRequest: sendPendingMasterAskRequest,
          });
          if (!autoResult.ok) {
            return autoResult;
          }

          recordMasterAutoPrepare(observation.traceId, observation.now);
          if (trigger.observation) {
            masterTriggerMemoryState = recordMasterTriggerOutcome({
              state: masterTriggerMemoryState,
              observation: trigger.observation,
              decision: trigger.decision,
            });
          }

          let preview = readObject(autoResult.data.preview) ?? null;
          if (!preview) {
            try {
              const pendingAsk = await pendingMasterAskStateStore.get(autoResult.data.traceId);
              preview = readObject(pendingAsk.preview) ?? null;
            } catch {
              preview = null;
            }
          }

          return {
            ...autoResult,
            data: {
              ...autoResult.data,
              collected: trigger.collected,
              blocked: null,
              triggerMode: 'auto',
              decision: trigger.decision,
              autoReason: autoPlan.autoReason || trigger.decision.reason,
              confidence: autoPlan.confidence,
              autoPolicy: {
                selectedFrictionMode: autoPlan.policy.selectedFrictionMode,
                requiresConfirmation: autoPlan.policy.requiresConfirmation,
                policyReason: autoPlan.policy.policyReason,
                sensitivity: autoPlan.policy.sensitivity,
              },
              target: {
                masterPinId: resolvedTarget.masterPinId,
                displayName: resolvedTarget.displayName,
                masterKind: resolvedTarget.masterKind,
                providerGlobalMetaId: resolvedTarget.providerGlobalMetaId,
              },
              ...(preview ? { preview } : {}),
            },
          };
        }
        const policy = evaluateMasterPolicy({
          config: config.askMaster,
          action: 'suggest',
          selectedMaster: resolvedTarget,
        });
        if (!policy.allowed) {
          return commandSuccess({
            collected: trigger.collected,
            decision: {
              action: 'no_action',
              reason: policy.blockedReason || 'Ask Master policy blocked this suggestion.',
            },
            blocked: {
              code: policy.code,
              message: policy.blockedReason || 'Ask Master policy blocked this suggestion.',
            },
          });
        }

        const suggestResult = await createMasterSuggestResult({
          draft,
          resolvedTarget,
          state,
          config,
          runtimeStateStore,
          masterSuggestStateStore,
          observation,
          decision: trigger.decision,
        });
        if (suggestResult.ok && trigger.observation) {
          const suggestData = suggestResult.data;
          masterTriggerMemoryState = recordMasterTriggerOutcome({
            state: masterTriggerMemoryState,
            observation: trigger.observation,
            decision: trigger.decision,
          });
          return {
            ...suggestResult,
            data: {
              ...suggestData,
              collected: trigger.collected,
              decision: trigger.decision,
            },
          };
        }

        return suggestResult;
      },
      receive: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before serving Ask Master requests.');
        }

        const masterState = await masterStateStore.read();
        const handled = await handleMasterProviderRequest({
          rawRequest: rawInput,
          providerIdentity: {
            globalMetaId: state.identity.globalMetaId,
            name: state.identity.name,
          },
          publishedMasters: masterState.masters,
          sessionEngine,
        });
        if (!handled.ok) {
          return commandFailed(handled.code, handled.message);
        }

        const receivedStatus = await persistSessionMutation(sessionStateStore, handled.received);
        await appendA2ATranscriptItems(sessionStateStore, [
          {
            id: `${handled.request.traceId}-master-request`,
            sessionId: handled.received.session.sessionId,
            taskRunId: handled.received.taskRun.runId,
            timestamp: handled.received.session.createdAt,
            type: 'user_task',
            sender: 'caller',
            content: handled.request.task.question,
            metadata: {
              userTask: handled.request.task.userTask,
              callerGlobalMetaId: handled.request.caller.globalMetaId,
              callerName: handled.request.caller.name,
              publicStatus: receivedStatus.status,
              servicePinId: handled.publishedMaster.currentPinId,
              masterKind: handled.publishedMaster.masterKind,
            },
          },
        ]);

        const appliedStatus = await persistSessionMutation(sessionStateStore, handled.applied);
        await appendA2ATranscriptItems(sessionStateStore, [
          {
            id: `${handled.request.traceId}-master-response`,
            sessionId: handled.received.session.sessionId,
            taskRunId: handled.applied.taskRun.runId,
            timestamp: handled.applied.session.updatedAt,
            type: handled.response.status === 'failed'
              ? 'failure'
              : handled.response.status === 'need_more_context'
                ? 'clarification_request'
                : 'assistant',
            sender: handled.response.status === 'failed' ? 'system' : 'provider',
            content: handled.response.summary,
            metadata: {
              publicStatus: appliedStatus.status,
              event: handled.applied.event,
              requestId: handled.request.requestId,
              responseStatus: handled.response.status,
              servicePinId: handled.publishedMaster.currentPinId,
              masterKind: handled.publishedMaster.masterKind,
            },
          },
        ]);

        const trace = buildSessionTrace({
          traceId: handled.request.traceId,
          channel: 'a2a',
          exportRoot: runtimeStateStore.paths.exportsRoot,
          session: {
            id: `master-provider-${handled.request.traceId}`,
            title: `${handled.publishedMaster.displayName} Ask`,
            type: 'a2a',
            metabotId: state.identity.metabotId,
            peerGlobalMetaId: handled.request.caller.globalMetaId,
            peerName: handled.request.caller.name || null,
            externalConversationId: `master:${handled.request.caller.globalMetaId}:${state.identity.globalMetaId}:${handled.request.traceId}`,
          },
          a2a: {
            sessionId: handled.received.session.sessionId,
            taskRunId: handled.applied.taskRun.runId,
            role: handled.received.session.role,
            publicStatus: appliedStatus.status,
            latestEvent: handled.applied.event,
            taskRunState: handled.applied.taskRun.state,
            callerGlobalMetaId: handled.request.caller.globalMetaId,
            callerName: handled.request.caller.name || null,
            providerGlobalMetaId: state.identity.globalMetaId,
            providerName: state.identity.name,
            servicePinId: handled.publishedMaster.currentPinId,
          },
          askMaster: buildMasterTraceMetadata({
            role: handled.received.session.role,
            latestEvent: handled.applied.event,
            publicStatus: appliedStatus.status,
            requestId: handled.request.requestId,
            masterKind: handled.publishedMaster.masterKind,
            servicePinId: handled.publishedMaster.currentPinId,
            providerGlobalMetaId: state.identity.globalMetaId,
            displayName: handled.publishedMaster.displayName,
            triggerMode: normalizeText(handled.request.trigger.mode),
            contextMode: normalizeText(handled.request.extensions?.contextMode),
            preview: {
              userTask: handled.request.task.userTask,
              question: handled.request.task.question,
            },
            response: {
              status: handled.response.status,
              summary: handled.response.summary,
              followUpQuestion: handled.response.followUpQuestion,
            },
          }),
        });
        const artifacts = await exportSessionArtifacts({
          trace,
          transcript: {
            sessionId: trace.session.id,
            title: trace.session.title || 'Ask Master Provider Runtime',
            messages: [
              {
                id: `${trace.traceId}-caller`,
                type: 'user',
                timestamp: trace.createdAt,
                content: handled.request.task.question,
                metadata: {
                  requestId: handled.request.requestId,
                  callerGlobalMetaId: handled.request.caller.globalMetaId,
                  servicePinId: handled.publishedMaster.currentPinId,
                  masterKind: handled.publishedMaster.masterKind,
                },
              },
              {
                id: `${trace.traceId}-provider`,
                type: handled.response.status === 'failed' ? 'system' : 'assistant',
                timestamp: handled.applied.session.updatedAt,
                content: handled.response.summary,
                metadata: {
                  responseStatus: handled.response.status,
                  followUpQuestion: handled.response.followUpQuestion,
                  providerGlobalMetaId: state.identity.globalMetaId,
                  requestId: handled.request.requestId,
                },
              },
            ],
          },
        });
        await persistTraceRecord(runtimeStateStore, trace);

        const shouldDeliverResponse = rawInput.deliverResponse !== false;
        const replyPin = normalizeText(rawInput.replyPin);
        const explicitCallerChatPublicKey = normalizeText(rawInput.callerChatPublicKey);
        let messagePinId: string | null = null;
        const markDeliveryFailure = async (code: string, message: string) => {
          const failedTrace = {
            ...trace,
            a2a: trace.a2a
              ? {
                  ...trace.a2a,
                  publicStatus: 'local_runtime_error',
                  latestEvent: 'provider_delivery_failed',
                }
              : trace.a2a,
            askMaster: buildMasterTraceMetadata({
              role: trace.a2a?.role,
              latestEvent: 'provider_delivery_failed',
              publicStatus: 'local_runtime_error',
              requestId: trace.askMaster?.requestId,
              masterKind: trace.askMaster?.masterKind,
              servicePinId: trace.askMaster?.servicePinId,
              providerGlobalMetaId: trace.askMaster?.providerGlobalMetaId,
              displayName: trace.askMaster?.displayName,
              triggerMode: trace.askMaster?.triggerMode,
              contextMode: trace.askMaster?.contextMode,
              confirmationMode: trace.askMaster?.confirmationMode,
              preview: trace.askMaster?.preview,
              response: trace.askMaster?.response,
              failure: {
                code,
                message,
              },
            }),
          };
          if (trace.a2a?.sessionId) {
            await sessionStateStore.appendPublicStatusSnapshots([
              {
                sessionId: trace.a2a.sessionId,
                taskRunId: trace.a2a.taskRunId ?? null,
                status: 'local_runtime_error',
                mapped: true,
                rawEvent: 'provider_delivery_failed',
                resolvedAt: Date.now(),
              },
            ]);
          }
          await rebuildTraceArtifactsFromSessionState({
            baseTrace: failedTrace,
            runtimeStateStore,
            sessionStateStore,
          });
          return commandFailed(code, message);
        };

        if (shouldDeliverResponse) {
          let privateChatIdentity;
          try {
            privateChatIdentity = await signer.getPrivateChatIdentity();
          } catch (error) {
            return markDeliveryFailure(
              'identity_secret_missing',
              error instanceof Error ? error.message : 'Local private chat key is missing from the secret store.'
            );
          }

          const callerChatPublicKey = explicitCallerChatPublicKey
            || (await resolvePeerChatPublicKey(handled.request.caller.globalMetaId))
            || '';
          if (!callerChatPublicKey) {
            return markDeliveryFailure(
              'peer_chat_public_key_missing',
              'Caller has no published chat public key on chain and none was provided.'
            );
          }

          let outboundResponse;
          try {
            outboundResponse = sendPrivateChat({
              fromIdentity: {
                globalMetaId: privateChatIdentity.globalMetaId,
                privateKeyHex: privateChatIdentity.privateKeyHex,
              },
              toGlobalMetaId: handled.request.caller.globalMetaId,
              peerChatPublicKey: callerChatPublicKey,
              content: handled.responseJson,
              replyPinId: replyPin || null,
            });
          } catch (error) {
            return markDeliveryFailure(
              'master_response_build_failed',
              error instanceof Error ? error.message : String(error)
            );
          }

          try {
            const write = await signer.writePin({
              operation: 'create',
              path: outboundResponse.path,
              encryption: outboundResponse.encryption,
              version: outboundResponse.version,
              contentType: outboundResponse.contentType,
              payload: outboundResponse.payload,
              encoding: 'utf-8',
              network: 'mvc',
            });
            messagePinId = normalizeText(write.pinId) || null;
          } catch (error) {
            return markDeliveryFailure(
              'master_response_delivery_failed',
              error instanceof Error ? error.message : String(error)
            );
          }
        }

        return commandSuccess({
          traceId: handled.request.traceId,
          requestId: handled.request.requestId,
          response: handled.response,
          responseJson: handled.responseJson,
          messagePinId,
          traceSummary: handled.traceSummary,
          session: {
            state: handled.applied.session.state,
            publicStatus: appliedStatus.status,
            event: handled.applied.event,
          },
          traceJsonPath: artifacts.traceJsonPath,
          traceMarkdownPath: artifacts.traceMarkdownPath,
          transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
        });
      },
      trace: async ({ traceId }) => {
        const state = await runtimeStateStore.readState();
        const trace = state.traces.find((entry) => entry.traceId === traceId);
        if (!trace) {
          return commandFailed('trace_not_found', `Trace not found: ${traceId}`);
        }

        const view = buildMasterTraceView(trace);
        if (!view) {
          return commandFailed('trace_not_master_flow', `Trace is not an Ask Master flow: ${traceId}`);
        }

        return commandSuccess(view);
      },
    },
    network: {
      listServices: async ({ online, query, cached }) => {
        const state = await runtimeStateStore.readState();
        const directory = await listRuntimeDirectoryServices({
          state,
          directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
          onlineServiceCacheStore,
          ratingDetailStateStore,
          resolvePeerChatPublicKey,
          chainApiBaseUrl: input.chainApiBaseUrl,
          socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
          socketPresenceFailureMode: input.socketPresenceFailureMode,
          onlineOnly: online === true,
          query,
          cacheOnly: cached === true,
        });

        return commandSuccess({
          services: directory.services,
          discoverySource: directory.discoverySource,
          fallbackUsed: directory.fallbackUsed,
        });
      },
      listBots: async ({ online, limit }) => {
        const normalizedLimit = Number.isFinite(limit)
          ? Math.min(MAX_NETWORK_BOT_LIST_LIMIT, Math.max(1, Math.floor(limit as number)))
          : DEFAULT_NETWORK_BOT_LIST_LIMIT;
        const onlineOnly = online !== false;

        try {
          const presence = await readOnlineMetaBotsFromSocketPresence({
            apiBaseUrl: input.socketPresenceApiBaseUrl,
            limit: normalizedLimit,
          });
          return commandSuccess({
            source: presence.source,
            fallbackUsed: false,
            total: presence.total,
            onlineWindowSeconds: presence.onlineWindowSeconds,
            bots: onlineOnly
              ? presence.bots
              : presence.bots.map((entry) => ({ ...entry })),
          });
        } catch (error) {
          try {
            const state = await runtimeStateStore.readState();
            const directory = await listRuntimeDirectoryServices({
              state,
              directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
              onlineServiceCacheStore,
              ratingDetailStateStore,
              resolvePeerChatPublicKey,
              chainApiBaseUrl: input.chainApiBaseUrl,
              socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
              socketPresenceFailureMode: input.socketPresenceFailureMode,
              onlineOnly: false,
            });
            const bots = dedupeOnlineBotsFromServices(directory.services, normalizedLimit);

            return commandSuccess({
              source: 'service_directory_fallback',
              fallbackUsed: true,
              total: bots.length,
              onlineWindowSeconds: null,
              bots,
            });
          } catch {
            return commandFailed(
              'socket_presence_unavailable',
              error instanceof Error ? error.message : String(error)
            );
          }
        }
      },
      listSources: async () => {
        const sources = sortDirectorySeeds(await readDirectorySeeds(runtimeStateStore.paths.directorySeedsPath));
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
        const currentSources = await readDirectorySeeds(runtimeStateStore.paths.directorySeedsPath);
        const nextSources = sortDirectorySeeds([
          ...currentSources.filter((entry) => entry.baseUrl !== parsed.toString().replace(/\/$/, '')),
          {
            baseUrl: parsed.toString().replace(/\/$/, ''),
            label: normalizedLabel,
          },
        ]);
        await writeDirectorySeeds(runtimeStateStore.paths.directorySeedsPath, nextSources);

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

        const currentSources = await readDirectorySeeds(runtimeStateStore.paths.directorySeedsPath);
        const nextSources = sortDirectorySeeds(
          currentSources.filter((entry) => entry.baseUrl !== normalizedBaseUrl)
        );
        const removed = nextSources.length !== currentSources.length;
        await writeDirectorySeeds(runtimeStateStore.paths.directorySeedsPath, nextSources);

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
        const masterState = await masterStateStore.read();
        const presence = await providerPresenceStore.read();
        const ratingSnapshot = await readRatingDetailSnapshot({
          ratingDetailStateStore,
          chainApiBaseUrl: input.chainApiBaseUrl,
        });
        return commandSuccess(buildProviderSummaryPayload({
          state,
          presence,
          masters: masterState.masters,
          ratingDetails: ratingSnapshot.ratingDetails,
          ratingSyncState: ratingSnapshot.ratingSyncState,
          ratingSyncError: ratingSnapshot.ratingSyncError,
        }));
      },
      getInitiatedRefunds: async () => {
        const state = await runtimeStateStore.readState();
        return commandSuccess(buildInitiatedRefundsPayload({ state }));
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
      listPublishSkills: async () => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before listing publishable skills.');
        }

        const metaBotSlug = path.basename(input.homeDir);
        const catalog = createPlatformSkillCatalog({
          runtimeStore: llmRuntimeStore,
          bindingStore: llmBindingStore,
          systemHomeDir: runtimeStateStore.paths.systemHomeDir,
          projectRoot: runtimeStateStore.paths.profileRoot,
          env: process.env,
        });
        const result = await catalog.listPrimaryRuntimeSkills({ metaBotSlug });
        if (!result.ok) {
          return commandFailed(result.code, result.message);
        }

        return commandSuccess({
          metaBotSlug,
          identity: {
            metabotId: state.identity.metabotId,
            name: state.identity.name,
            globalMetaId: state.identity.globalMetaId,
          },
          runtime: {
            id: result.runtime.id,
            provider: result.runtime.provider,
            displayName: result.runtime.displayName,
            health: result.runtime.health,
            version: result.runtime.version,
            logoPath: result.runtime.logoPath,
          },
          platform: result.platform,
          skills: result.skills,
          rootDiagnostics: result.rootDiagnostics,
        });
      },
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

        const metaBotSlug = path.basename(input.homeDir);
        const validation = await validateServicePublishProviderSkill({
          metaBotSlug,
          providerSkill,
          runtimeStore: llmRuntimeStore,
          bindingStore: llmBindingStore,
          systemHomeDir: runtimeStateStore.paths.systemHomeDir,
          projectRoot: runtimeStateStore.paths.profileRoot,
          env: process.env,
        });
        if (!validation.ok) {
          return commandFailed(validation.code, validation.message);
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

        let request = readCallRequest(rawInput);
        let selectedFromCache = false;
        let cachedSelectionServices: Array<Record<string, unknown>> | null = null;
        if ((!request.servicePinId || !request.providerGlobalMetaId) && request.userTask) {
          const cache = await onlineServiceCacheStore.read().catch(() => null);
          const matches = cache
            ? searchOnlineServiceCacheServices(cache.services, {
                query: request.serviceQuery || request.rawRequest || request.userTask,
                onlineOnly: true,
                limit: 1,
              })
            : [];
          const selected = matches[0] as unknown as Record<string, unknown> | undefined;
          if (!selected) {
            return commandFailed(
              'cached_service_match_not_found',
              'No cached online service matched this request. Refresh online services or provide servicePinId and providerGlobalMetaId.'
            );
          }
          request = {
            ...request,
            servicePinId: normalizeText(selected.servicePinId),
            providerGlobalMetaId: normalizeText(selected.providerGlobalMetaId),
            providerDaemonBaseUrl: request.providerDaemonBaseUrl || normalizeText(selected.providerDaemonBaseUrl),
            taskContext: request.taskContext || `Selected cached online service: ${normalizeText(selected.displayName) || normalizeText(selected.serviceName)}`,
            confirmed: false,
          };
          selectedFromCache = true;
          cachedSelectionServices = [selected];
        }
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
        } else if (cachedSelectionServices) {
          availableServices = cachedSelectionServices;
        } else {
          const directory = await listRuntimeDirectoryServices({
            state,
            directorySeedsPath: runtimeStateStore.paths.directorySeedsPath,
            onlineServiceCacheStore,
            ratingDetailStateStore,
            resolvePeerChatPublicKey,
            chainApiBaseUrl: input.chainApiBaseUrl,
            socketPresenceApiBaseUrl: input.socketPresenceApiBaseUrl,
            socketPresenceFailureMode: input.socketPresenceFailureMode,
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

        const serviceDisplayName = normalizeText(service.displayName) || normalizeText(service.serviceName);
        if (
          plan.confirmation.requiresConfirmation
          && request.confirmed !== true
          && (plan.confirmation.policyMode === 'confirm_paid_only' || plan.confirmation.policyMode === 'auto_when_safe')
        ) {
          const confirmRequest: Record<string, unknown> = {
            servicePinId: plan.service.servicePinId,
            providerGlobalMetaId: plan.service.providerGlobalMetaId,
            userTask: request.userTask,
            taskContext: request.taskContext,
            rawRequest: request.rawRequest,
            policyMode: plan.confirmation.policyMode,
            confirmed: true,
          };
          if (request.providerDaemonBaseUrl) {
            confirmRequest.providerDaemonBaseUrl = request.providerDaemonBaseUrl;
          }
          if (request.spendCap) {
            confirmRequest.spendCap = request.spendCap;
          }
          return commandAwaitingConfirmation({
            traceId: null,
            providerGlobalMetaId: plan.service.providerGlobalMetaId,
            serviceName: serviceDisplayName,
            selectedFromCache,
            service: plan.service,
            payment: plan.payment,
            confirmation: plan.confirmation,
            confirmRequest: {
              request: confirmRequest,
            },
          });
        }

        const resolveServicePeerChatPublicKey = async () => (
          normalizeText(service.providerChatPublicKey ?? service.chatPublicKey)
          || (
            plan.service.providerGlobalMetaId === state.identity!.globalMetaId
              ? state.identity!.chatPublicKey
              : await resolvePeerChatPublicKey(plan.service.providerGlobalMetaId) ?? ''
          )
        );
        let orderPayment: A2AOrderPaymentResult | null = null;
        let paymentTxid = '';
        let orderReference = '';
        const paymentMempoolRetryDelays = DEFAULT_RATING_FOLLOWUP_RETRY_DELAYS_MS;
        const createOrderPayment = async (): Promise<
          { ok: true; payment: A2AOrderPaymentResult }
          | { ok: false; failure: MetabotCommandResult<never> }
        > => {
          for (let attempt = 0; ; attempt += 1) {
            try {
              const payment = await executeServiceOrderPayment({
                traceId: plan.traceId,
                servicePinId: plan.service.servicePinId,
                providerGlobalMetaId: plan.service.providerGlobalMetaId,
                paymentAddress: normalizeText(service.paymentAddress) || normalizeText(service.providerAddress),
                amount: plan.payment.amount,
                currency: plan.payment.currency,
                executor: servicePaymentExecutor,
              });
              return { ok: true, payment };
            } catch (error) {
              const delayMs = paymentMempoolRetryDelays[attempt];
              if (delayMs === undefined || !isMempoolConflictError(error)) {
                const message = error instanceof Error ? error.message : String(error);
                const code = message.split(':', 1)[0] || 'service_payment_failed';
                return { ok: false, failure: commandFailed(code, message) };
              }
              if (delayMs > 0) {
                await sleep(delayMs);
              }
            }
          }
        };

        const started = sessionEngine.startCallerSession({
          traceId: plan.traceId,
          servicePinId: plan.service.servicePinId,
          callerGlobalMetaId: state.identity.globalMetaId,
          providerGlobalMetaId: plan.service.providerGlobalMetaId,
          userTask: request.userTask,
          taskContext: request.taskContext,
        });
        let orderPinId: string | null = null;
        let orderTxid: string | null = null;
        let orderTxids: string[] = [];
        let a2aStorePersisted: boolean | null = null;
        let a2aStoreError: string | null = null;
        let providerReplyText: string | null = null;
        let deliveryPinId: string | null = null;
        let orderPayloadForTrace = '';
        const persistCallerTraceSnapshot = async (failure?: {
          code?: string | null;
          message?: string | null;
        }) => {
          if (!orderPayment) {
            throw new Error('Service order payment metadata was not created.');
          }
          const publicStatus = await persistSessionMutation(sessionStateStore, started);
          const callerChainContent = normalizeText(orderPayloadForTrace);
          await appendA2ATranscriptItems(sessionStateStore, [
            {
              id: `${plan.traceId}-caller-user-task`,
              sessionId: started.session.sessionId,
              taskRunId: started.taskRun.runId,
              timestamp: started.session.createdAt,
              type: callerChainContent ? 'order' : 'user_task',
              sender: 'caller',
              content: callerChainContent || request.userTask,
              metadata: {
                taskContext: request.taskContext || null,
                servicePinId: plan.service.servicePinId,
                providerGlobalMetaId: plan.service.providerGlobalMetaId,
                protocolTag: callerChainContent ? 'ORDER' : null,
                pinId: orderPinId,
                txid: orderTxid,
                txids: orderTxids,
                orderTxid,
                paymentTxid: paymentTxid || null,
                orderReference: orderReference || null,
                rawContent: callerChainContent || null,
              },
            },
            {
              id: `${plan.traceId}-caller-request-sent`,
              sessionId: started.session.sessionId,
              taskRunId: started.taskRun.runId,
              timestamp: started.session.updatedAt,
              type: failure?.code ? 'failure' : 'status_note',
              sender: 'system',
              content: failure?.message
                ? `Local MetaBot prepared a remote MetaBot task session for ${normalizeText(service.displayName) || normalizeText(service.serviceName) || plan.service.providerGlobalMetaId}, but dispatch failed: ${failure.message}`
                : `Local MetaBot delegated this task to remote MetaBot ${normalizeText(service.displayName) || normalizeText(service.serviceName) || plan.service.providerGlobalMetaId}.`,
              metadata: {
                publicStatus: publicStatus.status,
                event: failure?.code || started.event,
                externalConversationId: started.linkage.externalConversationId,
                orderPinId,
                orderTxid,
                orderTxids,
                paymentTxid: paymentTxid || null,
                orderReference: orderReference || null,
                failureCode: failure?.code || null,
              },
            },
          ]);

          const trace = buildSessionTrace({
            traceId: plan.traceId,
            channel: 'a2a',
            exportRoot: runtimeStateStore.paths.exportsRoot,
            session: {
              id: `session-${plan.traceId}`,
              title: `${serviceDisplayName} Call`,
              type: 'a2a',
              metabotId: state.identity?.metabotId ?? null,
              peerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
              peerName: serviceDisplayName,
              externalConversationId: started.linkage.externalConversationId,
            },
            order: {
              id: `order-${plan.traceId}`,
              role: 'buyer',
              serviceId: plan.service.servicePinId,
              serviceName: serviceDisplayName,
              orderPinId,
              orderTxid,
              orderTxids,
              paymentTxid,
              orderReference,
              paymentCurrency: orderPayment.paymentCurrency,
              paymentAmount: orderPayment.paymentAmount,
            },
            a2a: {
              sessionId: started.session.sessionId,
              taskRunId: started.taskRun.runId,
              role: started.session.role,
              publicStatus: publicStatus.status,
              latestEvent: failure?.code || started.event,
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
                  type: failure?.code ? 'system' : 'assistant',
                  timestamp: trace.createdAt,
                  content: failure?.message
                    ? `Local MetaBot runtime recorded the paid remote MetaBot task session for ${serviceDisplayName}, but dispatch failed: ${failure.message}`
                    : `Local MetaBot runtime created a remote MetaBot task session for ${serviceDisplayName}.`,
                  metadata: {
                    servicePinId: plan.service.servicePinId,
                    providerGlobalMetaId: normalizeText(service.providerGlobalMetaId),
                    confirmationPolicyMode: plan.confirmation.policyMode,
                    confirmationRequired: plan.confirmation.requiresConfirmation,
                    providerDaemonBaseUrl: request.providerDaemonBaseUrl || null,
                    orderPinId,
                    orderTxid,
                    orderTxids,
                    paymentTxid: paymentTxid || null,
                    orderReference: orderReference || null,
                    failureCode: failure?.code || null,
                  },
                },
              ],
            },
          });

          await persistTraceRecord(runtimeStateStore, trace);
          return { publicStatus, trace, artifacts };
        };

        if (request.providerDaemonBaseUrl) {
          const paymentResult = await createOrderPayment();
          if (!paymentResult.ok) {
            return paymentResult.failure;
          }
          orderPayment = paymentResult.payment;
          paymentTxid = orderPayment.paymentTxid || '';
          orderReference = orderPayment.orderReference || '';

          const execution = await executeRemoteServiceCall({
            providerDaemonBaseUrl: request.providerDaemonBaseUrl,
            traceId: plan.traceId,
            externalConversationId: started.linkage.externalConversationId,
            servicePinId: plan.service.servicePinId,
            providerGlobalMetaId: plan.service.providerGlobalMetaId,
            buyer: state.identity,
            payment: orderPayment,
            request: {
              userTask: request.userTask,
              taskContext: request.taskContext,
            },
          });
          if (!execution.ok) {
            await persistCallerTraceSnapshot({
              code: normalizeText(execution.code) || 'remote_execution_failed',
              message: normalizeText(execution.message) || 'Remote execution failed.',
            });
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

          const peerChatPublicKey = await resolveServicePeerChatPublicKey();
          if (!peerChatPublicKey) {
            return commandFailed(
              'peer_chat_public_key_missing',
              'Remote agent has no published chat public key on chain.'
            );
          }

          try {
            sendPrivateChat({
              fromIdentity: {
                globalMetaId: privateChatIdentity.globalMetaId,
                privateKeyHex: privateChatIdentity.privateKeyHex,
              },
              toGlobalMetaId: plan.service.providerGlobalMetaId,
              peerChatPublicKey,
              content: '[ORDER] preflight',
            });
          } catch (error) {
            return commandFailed(
              'remote_order_build_failed',
              error instanceof Error ? error.message : String(error)
            );
          }

          const paymentResult = await createOrderPayment();
          if (!paymentResult.ok) {
            return paymentResult.failure;
          }
          orderPayment = paymentResult.payment;
          paymentTxid = orderPayment.paymentTxid || '';
          orderReference = orderPayment.orderReference || '';

          const orderPayload = buildDelegationOrderPayload({
            rawRequest: request.rawRequest || request.userTask,
            taskContext: request.taskContext,
            userTask: request.userTask,
            serviceName: serviceDisplayName,
            providerSkill: normalizeText(service.providerSkill) || normalizeText(service.serviceName),
            servicePinId: plan.service.servicePinId,
            paymentTxid,
            paymentCommitTxid: orderPayment.paymentCommitTxid,
            paymentChain: orderPayment.paymentChain,
            settlementKind: orderPayment.settlementKind,
            orderReference,
            price: orderPayment.paymentAmount,
            currency: orderPayment.paymentCurrency,
            outputType: normalizeText(service.outputType),
          });
          orderPayloadForTrace = orderPayload;

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
            const message = error instanceof Error ? error.message : String(error);
            await persistCallerTraceSnapshot({
              code: 'remote_order_build_failed',
              message,
            });
            return commandFailed(
              'remote_order_build_failed',
              message
            );
          }

          let orderWrite;
          try {
            orderWrite = await writePinRetryingMempoolConflict({
              signer,
              retryDelaysMs: DEFAULT_RATING_FOLLOWUP_RETRY_DELAYS_MS,
              request: {
                operation: 'create',
                path: outboundOrder.path,
                encryption: outboundOrder.encryption,
                version: outboundOrder.version,
                contentType: outboundOrder.contentType,
                payload: outboundOrder.payload,
                encoding: 'utf-8',
                network: 'mvc',
              },
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await persistCallerTraceSnapshot({
              code: 'remote_order_broadcast_failed',
              message,
            });
            return commandFailed(
              'remote_order_broadcast_failed',
              message
            );
          }

          orderPinId = orderWrite.pinId;
          orderTxids = Array.isArray(orderWrite.txids)
            ? orderWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
            : [];
          orderTxid = (
            normalizeOrderProtocolReference(orderTxids[0])
            || normalizeOrderProtocolReference(orderPinId)
            || orderTxids[0]
            || null
          );
          const a2aStoreResult = await persistA2AConversationMessageBestEffort({
            paths: runtimeStateStore.paths,
            local: {
              profileSlug: path.basename(runtimeStateStore.paths.profileRoot),
              globalMetaId: state.identity.globalMetaId,
              name: state.identity.name,
              chatPublicKey: state.identity.chatPublicKey,
            },
            peer: {
              globalMetaId: plan.service.providerGlobalMetaId,
              name: serviceDisplayName,
              chatPublicKey: peerChatPublicKey,
            },
            message: {
              direction: 'outgoing',
              content: orderPayload,
              pinId: orderPinId,
              txid: orderTxid,
              txids: orderTxids,
              chain: 'mvc',
              orderTxid,
              paymentTxid: paymentTxid || null,
              timestamp: Date.now(),
              raw: {
                chainWrite: {
                  path: outboundOrder.path,
                  contentType: outboundOrder.contentType,
                },
              },
            },
            orderSession: {
              role: 'caller',
              state: 'awaiting_delivery',
              orderTxid,
              paymentTxid: paymentTxid || null,
              servicePinId: plan.service.servicePinId,
              serviceName: serviceDisplayName,
              outputType: normalizeText(service.outputType) || null,
            },
          }, a2aConversationPersister);
          a2aStorePersisted = a2aStoreResult.persisted;
          a2aStoreError = a2aStoreResult.errorMessage;
        }

        if (!orderPayment) {
          return commandFailed('service_payment_missing', 'Service order payment metadata was not created.');
        }

        const { publicStatus, trace, artifacts } = await persistCallerTraceSnapshot();

        let responseTrace = trace;
        let responseArtifacts = artifacts;
        let responseSession = started.session;
        let responseTaskRun = started.taskRun;
        let responseEvent = started.event;
        let responsePublicStatus = publicStatus.status;
        if (!request.providerDaemonBaseUrl) {
          const privateChatIdentity = await signer.getPrivateChatIdentity();
          const peerChatPublicKey = await resolveServicePeerChatPublicKey();

          // Schedule background continuation immediately (was previously only on timeout)
          scheduleCallerReplyContinuation({
            trace,
            sessionId: started.session.sessionId,
            waiterInput: {
              callerGlobalMetaId: privateChatIdentity.globalMetaId,
              callerPrivateKeyHex: privateChatIdentity.privateKeyHex,
              providerGlobalMetaId: plan.service.providerGlobalMetaId,
              providerChatPublicKey: peerChatPublicKey,
              servicePinId: plan.service.servicePinId,
              paymentTxid,
              orderTxid: normalizeOrderProtocolReference(orderTxid) || normalizeOrderProtocolReference(orderPinId) || null,
              timeoutMs: DEFAULT_CALLER_BACKGROUND_WAIT_MS,
            },
          });

          // Return immediately — CLI will poll trace API for completion
          const daemon = input.getDaemonRecord();
          return commandWaiting(
            'order_sent_awaiting_provider',
            'Order sent to provider. Waiting for response...',
            3000,
            {
              localUiUrl: buildDaemonLocalUiUrl(daemon, '/ui/trace', {
                traceId: trace.traceId,
                sessionId: started.session.sessionId,
              }),
              data: {
                traceId: trace.traceId,
                servicePinId: plan.service.servicePinId,
                providerGlobalMetaId: plan.service.providerGlobalMetaId,
                serviceName: serviceDisplayName,
                selectedFromCache,
                service: plan.service,
                payment: plan.payment,
                confirmation: plan.confirmation,
                paymentTxid: paymentTxid || null,
                orderReference: orderReference || null,
                orderPinId,
                orderTxid,
                orderTxids,
                a2aStorePersisted,
                a2aStoreError,
                session: {
                  sessionId: started.session.sessionId,
                  taskRunId: started.taskRun.runId,
                  role: started.session.role,
                  state: started.session.state,
                  publicStatus: publicStatus.status,
                  event: started.event,
                  coworkSessionId: started.linkage.coworkSessionId,
                  externalConversationId: started.linkage.externalConversationId,
                },
                traceJsonPath: artifacts.traceJsonPath,
                traceMarkdownPath: artifacts.traceMarkdownPath,
                transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
              },
            },
          );
        }

        return commandSuccess({
          traceId: responseTrace.traceId,
          servicePinId: plan.service.servicePinId,
          providerGlobalMetaId: plan.service.providerGlobalMetaId,
          serviceName: serviceDisplayName,
          selectedFromCache,
          service: plan.service,
          payment: plan.payment,
          confirmation: plan.confirmation,
          paymentTxid: paymentTxid || null,
          orderReference: orderReference || null,
          orderPinId,
          orderTxid,
          orderTxids,
          a2aStorePersisted,
          a2aStoreError,
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
          localUiUrl: buildDaemonLocalUiUrl(input.getDaemonRecord(), '/ui/trace', {
            traceId: responseTrace.traceId,
            sessionId: responseSession.sessionId,
          }),
        });
      },
      handleInboundOrderProtocolMessage,
      rate: async (rawInput) => {
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

        const network = typeof rawInput.network === 'string' ? rawInput.network : undefined;
        return publishBuyerServiceRating({
          traceId: request.traceId,
          rate: request.rate,
          comment: request.comment,
          network,
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
              paymentTxid: execution.payment.paymentTxid,
              orderReference: execution.payment.orderReference,
            },
          },
        ]);

        const metaBotSlug = path.basename(input.homeDir);
        const providerRunner = createProviderServiceRunner({
          metaBotSlug,
          systemHomeDir: runtimeStateStore.paths.systemHomeDir,
          projectRoot: runtimeStateStore.paths.profileRoot,
          runtimeStore: llmRuntimeStore,
          bindingStore: llmBindingStore,
          llmExecutor: input.llmExecutor ?? {
            async execute() {
              throw new Error('LLM executor is not configured.');
            },
            async getSession() {
              return null;
            },
            async cancel() {},
          },
          env: process.env,
          canStartRuntime: input.providerRuntimeCanStart,
        });
        const runnerResult = await providerRunner.execute({
          servicePinId: service.currentPinId,
          providerSkill: service.providerSkill,
          providerGlobalMetaId: execution.providerGlobalMetaId,
          userTask: execution.request.userTask,
          taskContext: execution.request.taskContext,
          serviceName: service.serviceName,
          displayName: service.displayName,
          outputType: service.outputType,
          metadata: {
            traceId,
            externalConversationId: execution.externalConversationId || null,
            buyer: execution.buyer,
            payment: execution.payment,
          },
        });
        if (runnerResult.state === 'failed') {
          return commandFailed(runnerResult.code, runnerResult.message);
        }
        if (runnerResult.state === 'needs_clarification') {
          return commandManualActionRequired(
            'clarification_needed',
            runnerResult.question,
            `/ui/trace?traceId=${encodeURIComponent(traceId)}`,
          );
        }
        const applied = sessionEngine.applyProviderRunnerResult({
          session: received.session,
          taskRun: received.taskRun,
          result: runnerResult,
        });
        const appliedStatus = await persistSessionMutation(sessionStateStore, applied);
        const responseText = normalizeText(runnerResult.responseText);
        const providerMessage = responseText;
        await appendA2ATranscriptItems(sessionStateStore, [
          {
            id: `${traceId}-provider-runner-result`,
            sessionId: received.session.sessionId,
            taskRunId: applied.taskRun.runId,
            timestamp: applied.session.updatedAt,
            type: 'assistant',
            sender: 'provider',
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
          exportRoot: runtimeStateStore.paths.exportsRoot,
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
            paymentTxid: execution.payment.paymentTxid,
            orderReference: execution.payment.orderReference,
            paymentCurrency: execution.payment.paymentCurrency || service.currency,
            paymentAmount: execution.payment.paymentAmount || service.price,
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
                  paymentTxid: execution.payment.paymentTxid,
                  orderReference: execution.payment.orderReference,
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
      privateConversation: async (rawInput) => {
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before viewing private chat.');
        }

        const request = readPrivateConversationRequest(rawInput);
        if (!request.peer) {
          return commandFailed('missing_peer', 'peer query parameter is required.');
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

        let peerChatPublicKey = request.peer === state.identity.globalMetaId
          ? normalizeText(state.identity.chatPublicKey) || privateChatIdentity.chatPublicKey
          : '';
        if (!peerChatPublicKey) {
          peerChatPublicKey = await resolvePeerChatPublicKey(request.peer) ?? '';
        }
        if (!peerChatPublicKey) {
          return commandFailed(
            'peer_chat_public_key_missing',
            'Target has no chat public key on chain.'
          );
        }

        try {
          const response = await buildPrivateConversationResponse({
            selfGlobalMetaId: state.identity.globalMetaId,
            peerGlobalMetaId: request.peer,
            localPrivateKeyHex: privateChatIdentity.privateKeyHex,
            peerChatPublicKey,
            afterIndex: request.afterIndex,
            limit: request.limit,
            fetchHistory: input.fetchPrivateChatHistory,
            idChatApiBaseUrl: input.idChatApiBaseUrl,
          });
          return commandSuccess(response);
        } catch (error) {
          return commandFailed(
            'history_fetch_failed',
            error instanceof Error ? error.message : 'Failed to fetch private chat history.'
          );
        }
      },
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
        let chatWrite;
        try {
          chatWrite = await signer.writePin({
            operation: 'create',
            path: sent.path,
            encryption: sent.encryption,
            version: sent.version,
            contentType: sent.contentType,
            payload: sent.payload,
            encoding: 'utf-8',
            network: 'mvc',
          });
        } catch (error) {
          return commandFailed(
            'chat_broadcast_failed',
            error instanceof Error ? error.message : 'Failed to broadcast private chat to chain.'
          );
        }
        const chatTxids = Array.isArray(chatWrite.txids)
          ? chatWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
          : [];
        const chatA2AStoreResult = await persistA2AConversationMessageBestEffort({
          paths: runtimeStateStore.paths,
          local: {
            profileSlug: path.basename(runtimeStateStore.paths.profileRoot),
            globalMetaId: state.identity.globalMetaId,
            name: state.identity.name,
            chatPublicKey: state.identity.chatPublicKey,
          },
          peer: {
            globalMetaId: request.to,
            name: request.to === state.identity.globalMetaId ? state.identity.name : null,
            chatPublicKey: peerChatPublicKey,
          },
          message: {
            direction: 'outgoing',
            content: request.content,
            pinId: normalizeText(chatWrite.pinId) || null,
            txid: chatTxids[0] || null,
            txids: chatTxids,
            replyPinId: request.replyPin || null,
            chain: normalizeText(chatWrite.network) || 'mvc',
            timestamp: Date.now(),
            raw: {
              chainWrite: {
                path: sent.path,
                contentType: sent.contentType,
              },
            },
          },
        }, a2aConversationPersister);
        let a2aSessionId = chatA2AStoreResult.message?.sessionId ?? null;
        if (!a2aSessionId) {
          try {
            a2aSessionId = buildA2APeerSessionId(state.identity.globalMetaId, request.to);
          } catch {
            a2aSessionId = null;
          }
        }
        const structuredContent = describeStructuredPrivateChatContent(request.content);

        const traceId = `trace-private-${Date.now().toString(36)}`;
        const trace = buildSessionTrace({
          traceId,
          channel: 'simplemsg',
          exportRoot: runtimeStateStore.paths.exportsRoot,
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
                  pinId: normalizeText(chatWrite.pinId) || null,
                  txids: Array.isArray(chatWrite.txids) ? chatWrite.txids : [],
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
          pinId: normalizeText(chatWrite.pinId) || null,
          txids: Array.isArray(chatWrite.txids) ? chatWrite.txids : [],
          totalCost: Number.isFinite(Number(chatWrite.totalCost))
            ? Number(chatWrite.totalCost)
            : null,
          network: normalizeText(chatWrite.network) || 'mvc',
          deliveryMode: 'onchain_simplemsg',
          messageType: structuredContent.messageType,
          requestId: structuredContent.requestId,
          correlatedTraceId: structuredContent.traceId,
          a2aStorePersisted: chatA2AStoreResult.persisted,
          a2aStoreError: chatA2AStoreResult.errorMessage,
          a2aSessionId,
          traceId: trace.traceId,
          localUiUrl: buildDaemonLocalUiUrl(
            input.getDaemonRecord(),
            '/ui/trace',
            a2aSessionId
              ? { traceId: a2aSessionId, sessionId: a2aSessionId }
              : { traceId: trace.traceId },
          ),
          transcriptMarkdownPath: artifacts.transcriptMarkdownPath,
          traceMarkdownPath: artifacts.traceMarkdownPath,
          traceJsonPath: artifacts.traceJsonPath,
        });
      },

      privateChatConversations: async () => {
        const state = await privateChatStateStore.readState();
        return commandSuccess({ conversations: state.conversations });
      },

      privateChatMessages: async (msgInput) => {
        const messages = await privateChatStateStore.getRecentMessages(
          normalizeText(msgInput.conversationId),
          typeof msgInput.limit === 'number' && Number.isFinite(msgInput.limit)
            ? Math.max(1, Math.trunc(msgInput.limit))
            : 50,
        );
        return commandSuccess({ messages });
      },

      autoReplyStatus: async () => {
        return commandSuccess({
          enabled: autoReplyConfig.enabled,
          acceptPolicy: autoReplyConfig.acceptPolicy,
          defaultStrategyId: autoReplyConfig.defaultStrategyId,
        });
      },

      setAutoReply: async (autoReplyInput) => {
        autoReplyConfig.enabled = autoReplyInput.enabled === true;
        if (autoReplyInput.defaultStrategyId !== undefined) {
          autoReplyConfig.defaultStrategyId = normalizeText(autoReplyInput.defaultStrategyId) || null;
        }
        return commandSuccess({
          enabled: autoReplyConfig.enabled,
          defaultStrategyId: autoReplyConfig.defaultStrategyId,
        });
      },

      stopConversation: async ({ peer }) => {
        const normalizedPeer = normalizeText(peer);
        if (!normalizedPeer) {
          return commandFailed('missing_peer', 'Peer globalMetaId is required.');
        }
        const conversation = await privateChatStateStore.getConversationByPeer(normalizedPeer);
        if (!conversation) {
          return commandFailed('conversation_not_found', 'No conversation found for this peer.');
        }
        await privateChatStateStore.upsertConversation({
          ...conversation,
          state: 'closed',
          updatedAt: Date.now(),
        });
        return commandSuccess({ conversationId: conversation.conversationId, state: 'closed' });
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
        const sessionState = await sessionStateStore.readState();
        const selectedSession = sessionState.sessions
          .filter((entry) => entry.traceId === traceId)
          .sort((left, right) => left.updatedAt - right.updatedAt)
          .at(-1) ?? null;
        const orderHistoryProjection = await buildTraceOrderHistoryProjection({
          trace,
          selectedSession,
        });
        return commandSuccess(
          await buildTraceInspectorPayload({
            traceId,
            trace,
            sessionStateStore,
            ratingDetailStateStore,
            chainApiBaseUrl: input.chainApiBaseUrl,
            daemon: input.getDaemonRecord(),
            unifiedTranscriptItems: orderHistoryProjection.unifiedTranscriptItems,
            chainTranscriptItems: orderHistoryProjection.chainTranscriptItems,
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
          const projectedEvents = events.some((event) => event.terminal)
            ? []
            : await buildUnifiedOrderTraceWatchEvents(normalizedTraceId);
          if (events.length > 0) {
            const combinedEvents = projectedEvents.length > 0
              ? [
                  ...events.filter((event) => event.status !== projectedEvents.at(-1)?.status),
                  ...projectedEvents,
                ]
              : events;
            const serialized = serializeTraceWatchEvents(combinedEvents);
            if (combinedEvents.at(-1)?.terminal || Date.now() >= deadline) {
              return serialized;
            }
          } else {
            if (projectedEvents.length > 0) {
              return serializeTraceWatchEvents(projectedEvents);
            }
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
      listSessions: async () => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const results: Array<Record<string, unknown>> = [];
        const seenSessionIds = new Set<string>();
        const seenPeerWindowKeys = new Set<string>();

        const buildPeerWindowKey = (
          localGlobalMetaId: unknown,
          peerGlobalMetaId: unknown,
        ): string | null => {
          const local = normalizeText(localGlobalMetaId);
          const peer = normalizeText(peerGlobalMetaId);
          return local && peer ? `${local}::${peer}` : null;
        };

        const pushSession = (session: unknown, options: {
          localGlobalMetaId?: string | null;
          dedupeByPeer?: boolean;
        } = {}) => {
          if (!session || typeof session !== 'object' || Array.isArray(session)) {
            return;
          }
          const record = session as Record<string, unknown>;
          const sessionId = normalizeText(record.sessionId);
          if (!sessionId || seenSessionIds.has(sessionId)) {
            return;
          }
          const peerWindowKey = buildPeerWindowKey(
            normalizeText(record.localMetabotGlobalMetaId) || options.localGlobalMetaId,
            record.peerGlobalMetaId,
          );
          if (options.dedupeByPeer && peerWindowKey && seenPeerWindowKeys.has(peerWindowKey)) {
            return;
          }
          seenSessionIds.add(sessionId);
          if (peerWindowKey) {
            seenPeerWindowKeys.add(peerWindowKey);
          }
          results.push(record);
        };

        await Promise.all(profiles.map(async (profile) => {
          try {
            const unifiedSessions = await listUnifiedA2ATraceSessionsForProfile({
              profile,
              daemon: input.getDaemonRecord(),
            });
            for (const session of unifiedSessions) {
              pushSession(session, {
                localGlobalMetaId: profile.globalMetaId,
                dedupeByPeer: true,
              });
            }
          } catch {
            // Skip profiles with unreadable unified A2A conversations.
          }

          try {
            const store = createSessionStateStore(profile.homeDir);
            const state = await store.readState();
            for (const session of state.sessions) {
              const isCallerLocal = session.role === 'caller';
              const peerGlobalMetaId = isCallerLocal
                ? session.providerGlobalMetaId
                : session.callerGlobalMetaId;
              pushSession({
                ...session,
                localMetabotName: profile.name,
                localMetabotGlobalMetaId: profile.globalMetaId,
                peerGlobalMetaId,
              }, {
                localGlobalMetaId: profile.globalMetaId,
                dedupeByPeer: true,
              });
            }
          } catch {
            // Skip profiles with unreadable session state
          }
        }));

        results.sort((a, b) => {
          const bTime = typeof b.updatedAt === 'number' ? b.updatedAt : 0;
          const aTime = typeof a.updatedAt === 'number' ? a.updatedAt : 0;
          return bTime - aTime;
        });

        const totalCount = results.length;
        const callerCount = results.filter((s) => s.role === 'caller').length;
        const providerCount = results.filter((s) => s.role === 'provider').length;
        const lastUpdatedAt = results[0]?.updatedAt ?? null;

        return commandSuccess({
          sessions: results,
          stats: { totalCount, callerCount, providerCount, lastUpdatedAt },
        });
      },
      getSession: async ({ sessionId }) => {
        const normalizedSessionId = normalizeText(sessionId);
        if (!normalizedSessionId) {
          return commandFailed('missing_session_id', 'Session ID is required.');
        }

        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);

        for (const profile of profiles) {
          try {
            const unifiedSession = await getUnifiedA2ATraceSessionForProfile({
              profile,
              sessionId: normalizedSessionId,
              daemon: input.getDaemonRecord(),
            });
            if (unifiedSession) {
              const privateHistoryProjection = await buildPeerPrivateHistoryProjectionForUnifiedSession({
                profile,
                session: unifiedSession,
              }).catch(() => null);
              return commandSuccess(enrichUnifiedSessionWithPeerHistory(
                unifiedSession,
                privateHistoryProjection,
              ));
            }
          } catch {
            // Try legacy session-state for this profile below.
          }

          try {
            const store = createSessionStateStore(profile.homeDir);
            const state = await store.readState();
            const session = state.sessions.find((s) => s.sessionId === normalizedSessionId);
            if (!session) continue;

            const transcriptItems = state.transcriptItems.filter(
              (item) => item.sessionId === normalizedSessionId,
            ).sort((left, right) => normalizeTraceTimestamp(left.timestamp) - normalizeTraceTimestamp(right.timestamp));
            const taskRuns = state.taskRuns.filter(
              (run) => run.sessionId === normalizedSessionId,
            ).sort((left, right) => left.createdAt - right.createdAt);
            const publicStatusSnapshots = state.publicStatusSnapshots.filter(
              (snap) => snap.sessionId === normalizedSessionId,
            ).sort((left, right) => normalizeTraceTimestamp(left.resolvedAt) - normalizeTraceTimestamp(right.resolvedAt));
            const isCallerLocal = session.role === 'caller';
            const peerGlobalMetaId = isCallerLocal
              ? session.providerGlobalMetaId
              : session.callerGlobalMetaId;
            const traceId = normalizeText(session.traceId);
            let trace: SessionTraceRecord | null = null;
            try {
              const profileRuntimeStateStore = createRuntimeStateStore(profile.homeDir);
              const runtimeState = await profileRuntimeStateStore.readState();
              trace = runtimeState.traces.find((entry) => entry.traceId === traceId) ?? null;
            } catch {
              trace = null;
            }
            if (trace) {
              const privateHistoryProjection = await buildScopedPrivateHistoryProjectionForTrace({
                profile,
                trace,
                session,
                peerGlobalMetaId,
              }).catch(() => null);
              const orderHistoryProjection = await buildTraceOrderHistoryProjection({
                trace,
                selectedSession: session,
                profile,
                includePrivateHistory: false,
              });
              const payload = await buildTraceInspectorPayload({
                traceId,
                trace,
                sessionStateStore: store,
                ratingDetailStateStore: createRatingDetailStateStore(profile.homeDir),
                chainApiBaseUrl: input.chainApiBaseUrl,
                daemon: input.getDaemonRecord(),
                selectedSessionId: normalizedSessionId,
                unifiedTranscriptItems: orderHistoryProjection.unifiedTranscriptItems,
                chainTranscriptItems: privateHistoryProjection?.transcriptItems
                  ?? orderHistoryProjection.chainTranscriptItems,
              });

              return commandSuccess({
                ...payload,
                localMetabotName: privateHistoryProjection?.localName ?? profile.name,
                localMetabotGlobalMetaId: profile.globalMetaId,
                localMetabotAvatar: privateHistoryProjection?.localAvatar ?? null,
                peerGlobalMetaId,
                peerName: privateHistoryProjection?.peerName ?? null,
                peerAvatar: privateHistoryProjection?.peerAvatar ?? null,
              });
            }
            const latestStatusSnapshot = publicStatusSnapshots.at(-1) ?? null;

            return commandSuccess({
              traceId,
              sessionId: normalizedSessionId,
              session: {
                ...session,
                id: normalizedSessionId,
                title: null,
                type: 'a2a',
                metabotId: null,
                peerGlobalMetaId,
                peerName: null,
                externalConversationId: null,
              },
              transcriptItems,
              taskRuns,
              publicStatusSnapshots,
              order: null,
              orderPinId: null,
              orderTxid: null,
              orderTxids: [],
              paymentTxid: null,
              localUiUrl: buildDaemonLocalUiUrl(input.getDaemonRecord(), '/ui/trace', {
                traceId,
                sessionId: normalizedSessionId,
              }),
              a2a: {
                sessionId: normalizedSessionId,
                taskRunId: session.currentTaskRunId,
                role: session.role,
                publicStatus: latestStatusSnapshot?.status ?? session.state,
                latestEvent: latestStatusSnapshot?.rawEvent ?? null,
                taskRunState: session.latestTaskRunState,
                callerGlobalMetaId: session.callerGlobalMetaId,
                callerName: null,
                providerGlobalMetaId: session.providerGlobalMetaId,
                providerName: null,
                servicePinId: session.servicePinId,
              },
              artifacts: {
                transcriptMarkdownPath: null,
                traceMarkdownPath: null,
                traceJsonPath: null,
              },
              inspector: {
                session,
                sessions: [session],
                taskRuns,
                transcriptItems,
                publicStatusSnapshots,
                transcriptMarkdown: null,
                traceMarkdown: null,
              },
              localMetabotName: profile.name,
              localMetabotGlobalMetaId: profile.globalMetaId,
              peerGlobalMetaId,
            });
          } catch {
            // Try next profile
          }
        }

        return commandFailed('session_not_found', `A2A session not found: ${normalizedSessionId}`);
      },
    },
    bot: {
      getStats: async () => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const runtimeStore = createLlmRuntimeStore(input.homeDir);
        const runtimeState = await runtimeStore.read();
        const sessions = input.llmExecutor
          ? await input.llmExecutor.listSessions(1000)
          : [];
        const totalExecutions = sessions.length;
        const completedExecutions = sessions.filter((session) => session.status === 'completed').length;
        return commandSuccess({
          botCount: profiles.length,
          healthyRuntimes: runtimeState.runtimes.filter((runtime) => runtime.health === 'healthy').length,
          totalExecutions,
          successRate: totalExecutions > 0
            ? Math.round((completedExecutions / totalExecutions) * 100)
            : 0,
        });
      },
      listProfiles: async () => {
        const profiles = await listMetabotProfiles(normalizedSystemHomeDir);
        return commandSuccess({ profiles });
      },
      getProfile: async ({ slug }) => {
        const profile = await getMetabotProfile(normalizedSystemHomeDir, slug);
        if (!profile) {
          return commandFailed('profile_not_found', `MetaBot profile not found: ${normalizeText(slug) || '<missing>'}`);
        }
        return commandSuccess({ profile });
      },
      createProfile: async (body) => {
        let createInput: CreateMetabotInput;
        try {
          createInput = buildMetabotCreateInput(body);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /name is required/i.test(message)
            ? commandFailed('missing_name', 'MetaBot name is required.')
            : commandFailed('invalid_metabot_profile_create', message);
        }
        const name = createInput.name;
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const resolvedHome = resolveIdentityCreateProfileHome({
          systemHomeDir: normalizedSystemHomeDir,
          requestedName: name,
          profiles,
        });
        if (resolvedHome.status !== 'resolved') {
          return commandFailed('name_taken', resolvedHome.message);
        }

        const profileHomeDir = resolvedHome.homeDir;
        const profileRuntimeStateStore = createRuntimeStateStore(profileHomeDir);
        const profileSecretStore = createFileSecretStore(profileHomeDir);
        const profileSigner = createSignerForProfileHome(profileHomeDir);
        const providerValidationProfile = buildMetabotProfileDraftFromIdentity({
          ...createInput,
          homeDir: profileHomeDir,
          globalMetaId: 'pending',
          mvcAddress: 'pending',
        });
        try {
          await validateMetabotProviderAvailability(providerValidationProfile, {
            primaryProvider: createInput.primaryProvider,
            fallbackProvider: createInput.fallbackProvider,
          });
        } catch (error) {
          return commandFailed('invalid_metabot_profile_create', error instanceof Error ? error.message : String(error));
        }
        try {
          const bootstrap = await runBootstrapFlow({
            request: {
              name,
            },
            createMetabot: createLocalMetabotStep({
              runtimeStateStore: profileRuntimeStateStore,
              secretStore: profileSecretStore,
            }),
            requestSubsidy: createMetabotSubsidyStep({
              runtimeStateStore: profileRuntimeStateStore,
              requestMvcGasSubsidy: input.requestMvcGasSubsidy,
            }),
            syncIdentityToChain: createLocalIdentitySyncStep({
              runtimeStateStore: profileRuntimeStateStore,
              signer: profileSigner,
              stepDelayMs: input.identitySyncStepDelayMs,
            }),
          });
          const nextState = await profileRuntimeStateStore.readState();
          const identity = nextState.identity;
          if (!bootstrap.success || !identity) {
            await fs.rm(profileHomeDir, { recursive: true, force: true });
            return commandFailed(
              'identity_bootstrap_failed',
              bootstrap.error ?? 'MetaBot identity bootstrap failed before the identity was ready.'
              );
          }
          const chainProfile = buildMetabotProfileDraftFromIdentity({
            ...createInput,
            homeDir: profileHomeDir,
            globalMetaId: identity.globalMetaId,
            mvcAddress: identity.mvcAddress,
          });
          const profileChainWrites = await syncMetabotInfoToChain(
            profileSigner,
            chainProfile,
            calculateMetabotCreateChainFields(createInput),
            {
              delayMs: input.identitySyncStepDelayMs,
              operation: 'create',
            },
          );
          const profile = await createMetabotProfileFromIdentity(normalizedSystemHomeDir, {
            ...createInput,
            homeDir: profileHomeDir,
            globalMetaId: identity.globalMetaId,
            mvcAddress: identity.mvcAddress,
          });
          return commandSuccess({
            profile,
            identity,
            chainWrites: [...(bootstrap.sync?.chainWrites ?? []), ...profileChainWrites],
            subsidy: bootstrap.subsidy,
          });
        } catch (error) {
          await deleteMetabotProfile(normalizedSystemHomeDir, resolvedHome.slug)
            .catch(() => fs.rm(profileHomeDir, { recursive: true, force: true }))
            .catch(() => undefined);
          const message = error instanceof Error ? error.message : String(error);
          if (/already exists|ambiguous|duplicate/i.test(message)) {
            return commandFailed('name_taken', message);
          }
          return commandFailed('metabot_profile_create_failed', message);
        }
      },
      updateProfile: async (body) => {
        const slug = normalizeText(body.slug);
        const current = await getMetabotProfile(normalizedSystemHomeDir, slug);
        if (!current) {
          return commandFailed('profile_not_found', `MetaBot profile not found: ${slug || '<missing>'}`);
        }

        let update: UpdateMetabotInfoInput;
        try {
          update = buildMetabotUpdateInput(body);
          if (update.name !== undefined && update.name !== current.name) {
            const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
            const duplicate = resolveProfileNameMatch(update.name, profiles.filter((profile) => profile.slug !== current.slug));
            if (duplicate.status === 'matched' && duplicate.matchType !== 'ranked') {
              return commandFailed('name_taken', `MetaBot name already exists: ${update.name}`);
            }
          }
          await validateMetabotProviderAvailability(current, update);
        } catch (error) {
          return commandFailed('invalid_metabot_profile_update', error instanceof Error ? error.message : String(error));
        }

        const changedFields = calculateMetabotChangedFields(current, update);
        let chainWrites: ChainWriteResult[] = [];
        if (changedFields.length > 0 && !current.globalMetaId) {
          return commandFailed(
            'chain_identity_missing',
            'This MetaBot has no chained identity yet, so profile changes cannot be saved safely.'
          );
        }
        if (changedFields.length > 0) {
          try {
            const profileSigner = createSignerForProfileHome(current.homeDir);
            chainWrites = await syncMetabotInfoToChain(profileSigner, buildMetabotChainProfile(current, update), changedFields);
          } catch (error) {
            return commandFailed('chain_sync_failed', `Chain sync failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        }

        try {
          const profile = await updateMetabotProfile(normalizedSystemHomeDir, slug, update);
          return commandSuccess({ profile, chainWrites });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not found/i.test(message)) {
            return commandFailed('profile_not_found', message);
          }
          return commandFailed('metabot_profile_update_failed', message);
        }
      },
      getWallet: async ({ slug }) => {
        try {
          const wallet = await getMetabotWalletInfo(normalizedSystemHomeDir, slug);
          return commandSuccess({ wallet });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not found/i.test(message)) {
            return commandFailed('profile_not_found', message);
          }
          return commandFailed('metabot_wallet_unavailable', message);
        }
      },
      getBackup: async ({ slug }) => {
        try {
          const backup = await getMetabotMnemonicBackup(normalizedSystemHomeDir, slug);
          return commandSuccess({ backup });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not found/i.test(message)) {
            return commandFailed('profile_not_found', message);
          }
          return commandFailed('metabot_backup_unavailable', message);
        }
      },
      deleteProfile: async ({ slug }) => {
        try {
          const result = await deleteMetabotProfile(normalizedSystemHomeDir, slug);
          return commandSuccess({
            deleted: true,
            profile: result.profile,
            removedExecutorSessions: result.removedExecutorSessions,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/not found/i.test(message)) {
            return commandFailed('profile_not_found', message);
          }
          return commandFailed('metabot_profile_delete_failed', message);
        }
      },
      listRuntimes: async () => {
        const runtimeStore = createLlmRuntimeStore(input.homeDir);
        const state = await runtimeStore.read();
        return commandSuccess(state);
      },
      discoverRuntimes: async () => {
        const result = await discoverLlmRuntimes({ env: process.env });
        const runtimeStore = createLlmRuntimeStore(input.homeDir);
        const previous = await runtimeStore.read();
        const discoveredRuntimeIds = new Set(result.runtimes.map((runtime) => runtime.id));
        for (const runtime of result.runtimes) {
          await runtimeStore.upsertRuntime(runtime);
        }
        for (const runtime of previous.runtimes) {
          if (runtime.provider === 'custom') continue;
          if (!discoveredRuntimeIds.has(runtime.id) && runtime.health !== 'unavailable') {
            await runtimeStore.updateHealth(runtime.id, 'unavailable');
          }
        }
        const updated = await runtimeStore.read();
        return commandSuccess({ discovered: result.runtimes.length, runtimes: updated.runtimes, errors: result.errors });
      },
      listSessions: async ({ slug, limit }) => {
        if (!input.llmExecutor) {
          return commandFailed('llm_executor_not_configured', 'LLM executor is not configured.');
        }
        const normalizedSlug = normalizeText(slug);
        const sessions = await input.llmExecutor.listSessions(limit, normalizedSlug ? { metaBotSlug: normalizedSlug } : undefined);
        return commandSuccess({
          sessions,
        });
      },
    },
    llm: {
      execute: async (body) => {
        if (!input.llmExecutor) {
          return commandFailed('llm_executor_not_configured', 'LLM executor is not configured.');
        }
        const runtimeId = normalizeText(body.runtimeId);
        const runtimeStore = createLlmRuntimeStore(input.homeDir);
        const runtimeState = await runtimeStore.read();
        const runtime = runtimeState.runtimes.find((entry) => entry.id === runtimeId);
        if (!runtime) {
          return commandFailed('llm_runtime_not_found', `LLM runtime not found: ${runtimeId || '<missing>'}`);
        }
        if (runtime.health !== 'healthy') {
          return commandFailed('llm_runtime_unhealthy', `LLM runtime is not healthy: ${runtimeId}`);
        }
        const request = buildLlmExecutionRequest(body, runtime);
        if (!request) {
          return commandFailed('invalid_llm_execute_request', 'runtimeId and prompt are required.');
        }
        try {
          const sessionId = await input.llmExecutor.execute(request);
          return commandSuccess({ sessionId, status: 'starting' });
        } catch (error) {
          return commandFailed('llm_execute_failed', error instanceof Error ? error.message : String(error));
        }
      },
      getSession: async ({ sessionId }) => {
        if (!input.llmExecutor) {
          return commandFailed('llm_executor_not_configured', 'LLM executor is not configured.');
        }
        const session = await input.llmExecutor.getSession(sessionId);
        if (!session) {
          return commandFailed('llm_session_not_found', `LLM session not found: ${sessionId}`);
        }
        return commandSuccess(session);
      },
      cancelSession: async ({ sessionId }) => {
        if (!input.llmExecutor) {
          return commandFailed('llm_executor_not_configured', 'LLM executor is not configured.');
        }
        await input.llmExecutor.cancel(sessionId);
        return commandSuccess({ status: 'cancelled' });
      },
      listSessions: async ({ limit }) => {
        if (!input.llmExecutor) {
          return commandFailed('llm_executor_not_configured', 'LLM executor is not configured.');
        }
        const sessions = await input.llmExecutor.listSessions(limit);
        return commandSuccess({ sessions });
      },
      streamSessionEvents: async ({ sessionId }) => {
        if (!input.llmExecutor) {
          return (async function* emptyStream() {})();
        }
        return input.llmExecutor.streamEvents(sessionId);
      },
      listRuntimes: async () => {
        const runtimeStore = createLlmRuntimeStore(input.homeDir);
        const state = await runtimeStore.read();
        return commandSuccess(state);
      },
      discoverRuntimes: async () => {
        const result = await discoverLlmRuntimes({ env: process.env });
        const runtimeStore = createLlmRuntimeStore(input.homeDir);
        const previous = await runtimeStore.read();
        const discoveredRuntimeIds = new Set(result.runtimes.map((runtime) => runtime.id));
        for (const runtime of result.runtimes) {
          await runtimeStore.upsertRuntime(runtime);
        }
        for (const runtime of previous.runtimes) {
          if (runtime.provider === 'custom') continue;
          if (!discoveredRuntimeIds.has(runtime.id) && runtime.health !== 'unavailable') {
            await runtimeStore.updateHealth(runtime.id, 'unavailable');
          }
        }
        const updated = await runtimeStore.read();
        return commandSuccess({ discovered: result.runtimes.length, runtimes: updated.runtimes, errors: result.errors });
      },
      listBindings: async ({ slug }) => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const profile = profiles.find((p) => p.slug === slug);
        if (!profile) return commandFailed('profile_not_found', `Profile not found: ${slug}`);
        const paths = resolveMetabotPaths(profile.homeDir);
        const bindingStore = createLlmBindingStore(paths);
        const state = await bindingStore.read();
        return commandSuccess(state);
      },
      upsertBindings: async ({ slug, bindings }) => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const profile = profiles.find((p) => p.slug === slug);
        if (!profile) return commandFailed('profile_not_found', `Profile not found: ${slug}`);
        const paths = resolveMetabotPaths(profile.homeDir);
        const bindingStore = createLlmBindingStore(paths);
        const state = await bindingStore.read();
        const otherBindings = state.bindings.filter((b) => b.metaBotSlug !== slug);
        const normalizedBindings = bindings
          .map((b) => normalizeLlmBinding({ ...b, metaBotSlug: slug }))
          .filter((b): b is NonNullable<ReturnType<typeof normalizeLlmBinding>> => b !== null);
        const nextState = { ...state, bindings: [...otherBindings, ...normalizedBindings], version: state.version + 1 };
        const written = await bindingStore.write(nextState);
        return commandSuccess(written);
      },
      removeBinding: async ({ bindingId }) => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        for (const profile of profiles) {
          const paths = resolveMetabotPaths(profile.homeDir);
          const bindingStore = createLlmBindingStore(paths);
          const state = await bindingStore.read();
          if (state.bindings.some((b) => b.id === bindingId)) {
            const next = await bindingStore.removeBinding(bindingId);
            return commandSuccess(next);
          }
        }
        return commandFailed('binding_not_found', `Binding not found: ${bindingId}`);
      },
      getPreferredRuntime: async ({ slug }) => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const profile = profiles.find((p) => p.slug === slug);
        if (!profile) return commandFailed('profile_not_found', `Profile not found: ${slug}`);
        const paths = resolveMetabotPaths(profile.homeDir);
        try {
          const raw = await fs.readFile(paths.preferredLlmRuntimePath, 'utf8');
          const data = JSON.parse(raw);
          return commandSuccess({ runtimeId: typeof data.runtimeId === 'string' ? data.runtimeId : null });
        } catch {
          return commandSuccess({ runtimeId: null });
        }
      },
      setPreferredRuntime: async ({ slug, runtimeId }) => {
        const profiles = await listIdentityProfiles(normalizedSystemHomeDir).catch(() => []);
        const profile = profiles.find((p) => p.slug === slug);
        if (!profile) return commandFailed('profile_not_found', `Profile not found: ${slug}`);
        const paths = resolveMetabotPaths(profile.homeDir);
        await fs.mkdir(path.dirname(paths.preferredLlmRuntimePath), { recursive: true });
        await fs.writeFile(paths.preferredLlmRuntimePath, JSON.stringify({ runtimeId }, null, 2) + '\n', 'utf8');
        return commandSuccess({ runtimeId });
      },
    },
  };
}
