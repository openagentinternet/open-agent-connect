import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { collectDaemonStartupDiagnostics, formatDaemonStartupTimeoutMessage } from './daemonStartupDiagnostics';
import { CLI_VERSION } from './version';
import { commandAwaitingConfirmation, commandFailed, commandManualActionRequired, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { createConfigStore, type ConfigStore } from '../core/config/configStore';
import { createInfrastructureConfigStore } from '../core/config/infrastructureConfigStore';
import {
  DEFAULT_AUTO_REPLY_COOLDOWN_MS,
  DEFAULT_AUTO_REPLY_MAX_TURNS,
  DEFAULT_WRITE_NETWORKS,
  type DefaultWriteNetwork,
} from '../core/config/configTypes';
import { bindHostSkills, bindPlatformSkills, HostSkillBindingError } from '../core/host/hostSkillBinding';
import {
  bindHostPersonaProjection,
  getHostPersonaProjectionStatus,
  HostPersonaProjectionError,
  unbindHostPersonaProjection,
} from '../core/host/hostPersonaProjection';
import { uploadLocalFileToChain } from '../core/files/uploadFile';
import { resolveTwinHomeDir } from '../core/bot/twinRole';
import {
  listIdentityProfiles,
  type IdentityProfileRecord,
} from '../core/identity/identityProfiles';
import { resolveIdentityCreateProfileHome } from '../core/identity/profileWorkspace';
import { resolveProfileNameMatch } from '../core/identity/profileNameResolution';
import { readOwnerIdentity } from '../core/owner/ownerIdentity';
import { renderResolvedSkillContract } from '../core/skills/skillResolver';
import type { ConcreteSkillHost, SkillRenderFormat } from '../core/skills/skillContractTypes';
import {
  resolveMetabotDaemonPaths,
  resolveMetabotPaths,
  type MetabotPaths,
} from '../core/state/paths';
import { createChainHistoryStore, type ChainHistorySearchOptions } from '../core/chainhistory/store';
import { recordMetawebPinRead } from '../core/chainhistory/readLedger';
import { createMemoryStore } from '../core/memory/memoryStore';
import { createMemoryPolicyStore } from '../core/memory/memoryPolicy';
import {
  applyTurnMemoryExtraction,
  buildMemoryBlocksForRequest,
} from '../core/memory/memoryService';
import {
  appendTranscriptTurn,
  listRecentChats,
  searchConversations,
} from '../core/memory/transcriptStore';
import type { MemoryCreateInput, MemoryUpdateInput } from '../core/memory/memoryTypes';
import { createDreamStore } from '../core/memory/dreamStore';
import {
  commitDream,
  dreamStatus,
  dueDreamDates,
  failDream,
  planDream,
  runDream,
  synthesizeDream,
  type DreamModelLimits,
} from '../core/memory/dreamService';
import { createHygieneStore } from '../core/memory/hygieneStore';
import {
  memoryHygieneDue,
  runMemoryHygiene,
  type MemoryHygieneLlmCompletion,
} from '../core/memory/memoryHygieneService';
import { createScheduleStore, type ScheduleRunExecutor } from '../core/schedule/store';
import { runScheduledTask } from '../core/schedule/service';
import {
  formatExperienceRecallResults,
  formatExperienceTimelineFallback,
  formatLocalDate,
  resolveExperienceRecallQuery,
} from '../core/memory/experiencePromptBlocks';
import { getDayBoundsMs } from '../core/memory/dreamPrompt';
import { createExperienceStore } from '../core/memory/experienceStore';
import { createImpressionStore } from '../core/memory/impressionStore';
import { resolveContactNames } from '../core/memory/contactNames';
import { createKnowledgeStore, KNOWLEDGE_KINDS, type KnowledgeKind } from '../core/memory/knowledgeStore';
import { formatKnowledgeUpsertResult } from '../core/memory/knowledgePromptBlocks';
import { createProcedureStore, scoreProceduresForQuery } from '../core/memory/procedureStore';
import { loadChatPersona } from '../core/chat/chatPersonaLoader';
import { createOrchestrationStore } from '../core/memory/orchestrationStore';
import {
  buildTwinWorkerRoster,
  formatTwinWorkerRosterBlock,
  resolveCurrentTwinSlug,
} from '../core/bot/twinRole';
import {
  normalizeSystemHomeDir as normalizeSelectedSystemHomeDir,
  resolveMetabotManagerLayout,
  resolveMetabotHomeSelectionSync,
} from '../core/state/homeSelection';
import {
  createRuntimeStateStore,
  type RuntimeDaemonRecord,
} from '../core/state/runtimeStateStore';
import {
  createDaemonStateStore,
  type DaemonInstallationRecord,
  type GlobalDaemonRecord,
} from '../core/state/daemonStateStore';
import { createProviderPresenceStateStore } from '../core/provider/providerPresenceState';
import { createOnlineServiceCacheStore, DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS } from '../core/discovery/onlineServiceCache';
import { refreshOnlineServiceCacheFromChain } from '../core/discovery/onlineServiceCacheSync';
import { buildRemoteServicesPrompt } from '../core/delegation/remoteCall';
import { createRatingDetailStateStore } from '../core/ratings/ratingDetailState';
import { readOnlineMetaBotsFromSocketPresence } from '../core/discovery/socketPresenceDirectory';
import { resolveMetasoInfrastructureEndpoints } from '../core/network/metasoInfrastructure';
import {
  listMetaAppForks,
  MetaAppSearchApiError,
  MetaAppSearchNotFoundError,
  searchMetaApps,
  trimMetaAppSearchItems,
  type TrimmedMetaAppSearchItem,
} from '../core/metaapp/metaAppSearchApi';
import {
  getMetaIdDetail,
  MetaIdSearchApiError,
  MetaIdSearchNotFoundError,
  searchMetaIds,
  trimMetaIdSearchItems,
  type MetaIdDetail,
  type TrimmedMetaIdSearchItem,
} from '../core/metaid/metaIdSearchApi';
import { materializeMetaAppSource } from '../core/metaapp/metaAppSource';
import {
  searchMetaweb,
  type MetawebSearchProtocol,
} from '../core/metaweb/search';
import { readMetawebPin, MetawebPinNotFoundError } from '../core/metaweb/pinRead';
import { formatMetawebPinDetail, formatMetawebSearchBullets } from '../core/metaweb/format';
import { METAWEB_CITATION_RULE } from '../core/metaweb/uri';
import {
  extractSkillPinDescriptor,
  installSkillFromReference,
  listInstalledSkills,
  readInstalledSkill,
  SkillInstallError,
  uninstallInstalledSkill,
} from '../core/skills/skillInstall';
import {
  getInstallSkillRoots,
  resolvePlatformSkillRootPath,
} from '../core/platform/platformRegistry';
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import type { LocalIdentitySecrets } from '../core/secrets/secretStore';
import {
  createLocalMnemonicSigner,
  executeTransfer,
} from '../core/signing/localMnemonicSigner';
import { createTrafficAccountService } from '../core/traffic/trafficAccountService';
import { createTrafficSponsorWritePinResolver } from '../core/subsidy/mvcSponsorWritePin';
import { normalizeChainWriteRequest, type ChainWriteNetwork } from '../core/chain/writePin';
import { createDefaultChainAdapterRegistry } from '../core/chain/adapters/registry';
import {
  confirmWalletTransfer,
  previewWalletTransfer,
  queryWalletBalances,
} from '../core/wallet/nativeWallet';
import type { Signer } from '../core/signing/signer';
import { createMetabotDaemon } from '../daemon';
import { createDefaultMetabotDaemonHandlers, fetchPeerChatPublicKey as fetchPeerChatPublicKeyFromChain, llmDiscoverySweepRunningForHomeDir, type A2ACallerReplyResumeReport } from '../daemon/defaultHandlers';
import { createGroupTaskServiceContext } from '../daemon/grouptaskHandlers';
import { createGroupTaskEngine } from '../core/grouptask/engine';
import {
  createGroupTaskEngineLogWriter,
  resolveGroupTaskEngineLogPath,
} from '../core/grouptask/engineLog';
import { createMetasoPinVerifier } from '../core/grouptask/deliverableVerification';
import { createProfileScopedUpload } from '../core/files/profileUploadGate';
import { getMetabotProfile, listMetabotProfiles } from '../core/bot/metabotProfileManager';
import {
  createKnowledgeBaseService,
} from '../core/knowledgebase/service';
import {
  createStudyJobStore,
  runStudyTick,
  runStudyTurnWithTools,
  STUDY_TICK_INTERVAL_MINUTES,
} from '../core/knowledgebase/studyJobs';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import type { MetaWebServiceReplyWaiter } from '../core/a2a/metawebReplyWaiter';
import {
  createA2ASimplemsgListenerManager,
  type A2ASimplemsgListenerManager,
  type A2ASimplemsgListenerStartReport,
} from '../core/a2a/simplemsgListener';
import {
  createA2ASimplemsgPresenceWatchdog,
  type A2ASimplemsgPresenceWatchdog,
} from '../core/a2a/simplemsgPresenceWatchdog';
import { classifySimplemsgContent } from '../core/a2a/simplemsgClassifier';
import { createSessionStateStore } from '../core/a2a/sessionStateStore';
import { SERVICE_ORDER_DEADLINE_SWEEP_INTERVAL_MS } from '../core/orders/orderLifecycle';
import { createHasActiveOrderWithPeer } from '../core/orders/orderChatSuppression';
import {
  createPrivateChatAutoReplyOrchestrator,
  type PrivateChatAutoReplyDependencies,
  type PrivateChatAutoReplyOrchestrator,
} from '../core/chat/privateChatAutoReply';
import { createPrivateChatSendFailureFileLogger } from '../core/chat/privateChatSendFailureLog';
import {
  createPrivateChatAutoReplyBackfillLoop,
  createPrivateChatAutoReplyBackfillProfileManager,
  type PrivateChatAutoReplyBackfillProfileManager,
} from '../core/chat/privateChatAutoReplyBackfill';
import { createPrivateChatStateStore } from '../core/chat/privateChatStateStore';
import { fetchPrivateChatPeerGlobalMetaIds } from '../core/chat/privateConversation';
import { buildLocalA2AProjectedPeerIndex } from '../core/chat/privateChatPeerDiscovery';
import { createChatStrategyStore } from '../core/chat/chatStrategyStore';
import {
  createHostLlmChatReplyRunner,
  PRIVATE_CHAT_REPLY_GENERATION_ENV,
} from '../core/chat/hostLlmChatReplyRunner';
import { createPrivateChatAllowedSkillsResolver } from '../core/chat/privateChatAllowedSkills';
import { createChatSkillWaitNoticeGenerator } from '../core/chat/chatSkillWaitNotice';
import { createLlmOrderProtocolTextGenerator } from '../core/a2a/orderProtocolTextGenerator';
import {
  PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS,
  sweepProviderRunWorkspaces,
} from '../core/a2a/provider/providerWorkspaceCleanup';
import type {
  ChatReplyRunner,
  PrivateChatAutoReplyConfig,
  PrivateChatInboundMessage,
  PrivateChatMessage,
} from '../core/chat/privateChatTypes';
import { createTestServicePaymentExecutor } from '../core/payments/servicePayment';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import {
  createLlmRuntimeResolver,
  summarizeResolvedLlmRuntime,
} from '../core/llm/llmRuntimeResolver';
import { discoverLlmRuntimes } from '../core/llm/llmRuntimeDiscovery';
import { createLlmAvailabilityRecovery } from '../core/llm/llmAvailabilityRecovery';
import type { LlmAvailabilityRecovery } from '../core/llm/llmAvailabilityRecovery';
import { createPlatformSkillCatalog } from '../core/services/platformSkillCatalog';
import {
  LlmExecutor,
  createRegistryBackendFactories,
} from '../core/llm/executor';
import { runLlmPromptWithRuntimeFallback } from '../core/llm/llmRuntimeExecution';
import { runSystemUpdate } from '../core/system/update';
import { runSystemUninstall } from '../core/system/uninstall';
import type { CliDependencies, CliRuntimeContext } from './types';

const DEFAULT_DAEMON_BASE_URL = 'http://127.0.0.1:10001';
const DEFAULT_DAEMON_HOST = '127.0.0.1';
const DEFAULT_DAEMON_START_TIMEOUT_MS = 30_000;
const DAEMON_START_POLL_INTERVAL_MS = 100;
const DAEMON_HEALTH_TIMEOUT_MS = 1_500;
const DAEMON_PREFERRED_PORT_ENV = 'METABOT_DAEMON_PREFERRED_PORT';
const DEFAULT_DAEMON_PORT = 10_001;
const DAEMON_FALLBACK_PORT_START = 10_002;
const DAEMON_FALLBACK_PORT_END = 10_020;
const TEST_FAKE_CHAIN_WRITE_ENV = 'METABOT_TEST_FAKE_CHAIN_WRITE';
const TEST_FAKE_SUBSIDY_ENV = 'METABOT_TEST_FAKE_SUBSIDY';
const TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV = 'METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY';
const TEST_FAKE_METAWEB_REPLY_ENV = 'METABOT_TEST_FAKE_METAWEB_REPLY';
const TEST_FAKE_BUYER_RATING_REPLY_ENV = 'METABOT_TEST_FAKE_BUYER_RATING_REPLY';
const TEST_FAKE_PROVIDER_LLM_REPLY_ENV = 'METABOT_TEST_FAKE_PROVIDER_LLM_REPLY';
const TEST_SKIP_BACKGROUND_LLM_DISCOVERY_ENV = 'METABOT_TEST_SKIP_BACKGROUND_LLM_DISCOVERY';
const ALLOW_UNINDEXED_HOME_ENV = 'METABOT_ALLOW_UNINDEXED_HOME';
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
const METALET_HOST = 'https://www.metalet.space';
const CHAIN_NET = 'livenet';
const DEFAULT_SERVICE_REFUND_SYNC_INTERVAL_MS = 10 * 60 * 1000;
/** Scheduled-task daemon tick cadence (IDBots scheduler parity). */
const SCHEDULE_TICK_INTERVAL_MS = 30_000;
let cachedDaemonRuntimeFingerprint: string | null = null;

type A2ASimplemsgInboundDispatcherMessage = Pick<
  PrivateChatInboundMessage,
  'fromGlobalMetaId' | 'content' | 'messagePinId' | 'timestamp'
> & Partial<PrivateChatInboundMessage>;

function normalizeDispatcherPrivateChatMessage(
  message: A2ASimplemsgInboundDispatcherMessage
): PrivateChatInboundMessage {
  return {
    fromGlobalMetaId: message.fromGlobalMetaId,
    content: message.content,
    messagePinId: message.messagePinId ?? null,
    fromChatPublicKey: message.fromChatPublicKey ?? null,
    timestamp: Number.isFinite(message.timestamp) ? Math.trunc(Number(message.timestamp)) : Date.now(),
    rawMessage: message.rawMessage ?? null,
  };
}

export function buildA2ASimplemsgInboundDispatcher(input: {
  handleOrderProtocolMessage?: (message: A2ASimplemsgInboundDispatcherMessage) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
  handleGenericPrivateChatMessage: (message: PrivateChatInboundMessage) => Promise<void> | void;
  logWarning?: (scope: string, error: unknown) => void;
}): (message: A2ASimplemsgInboundDispatcherMessage) => Promise<void> {
  const logWarning = input.logWarning ?? ((scope: string, error: unknown) => {
    console.warn(scope, error instanceof Error ? error.message : String(error));
  });

  return async (message) => {
    const simplemsgClassification = classifySimplemsgContent(message.content);
    const orderProtocolHandler = input.handleOrderProtocolMessage;
    if (orderProtocolHandler) {
      try {
        const result = await orderProtocolHandler(message);
        if (
          simplemsgClassification.kind === 'order_protocol'
          || (result?.ok === true && (result.data as { handled?: unknown } | undefined)?.handled === true)
        ) {
          return;
        }
      } catch (error) {
        logWarning('[A2A order protocol handler]', error);
        if (simplemsgClassification.kind === 'order_protocol') {
          return;
        }
      }
    }
    await input.handleGenericPrivateChatMessage(normalizeDispatcherPrivateChatMessage(message));
  };
}

export async function refreshA2ASimplemsgListenerForIdentityProfileRegistration(input: {
  enabled: boolean;
  listener: Pick<A2ASimplemsgListenerManager, 'start' | 'stop'>;
  backfill?: Pick<PrivateChatAutoReplyBackfillProfileManager, 'start' | 'stop'>;
  watchdog?: Pick<A2ASimplemsgPresenceWatchdog, 'start' | 'stop'>;
}): Promise<{ refreshed: boolean; report: A2ASimplemsgListenerStartReport | null }> {
  if (!input.enabled) {
    return {
      refreshed: false,
      report: null,
    };
  }

  input.watchdog?.stop();
  input.listener.stop();
  input.backfill?.stop();
  const report = await input.listener.start();
  await input.backfill?.start();
  input.watchdog?.start();
  return {
    refreshed: true,
    report,
  };
}

type ServiceRefundSyncIntervalHandle = {
  unref?: () => void;
};

export interface ServiceRefundSyncLoop {
  runOnce: () => Promise<void>;
  stop: () => void;
}

export function createServiceRefundSyncLoop(input: {
  syncRefunds: () => Promise<unknown>;
  intervalMs?: number;
  setIntervalFn?: (
    callback: () => Promise<void>,
    intervalMs: number,
  ) => ServiceRefundSyncIntervalHandle;
  clearIntervalFn?: (handle: ServiceRefundSyncIntervalHandle) => void;
  logWarning?: (message: string) => void;
}): ServiceRefundSyncLoop {
  const intervalMs = Math.max(60_000, Math.floor(input.intervalMs ?? DEFAULT_SERVICE_REFUND_SYNC_INTERVAL_MS));
  const setIntervalFn = input.setIntervalFn
    ?? ((callback, nextIntervalMs) => setInterval(callback, nextIntervalMs) as ServiceRefundSyncIntervalHandle);
  const clearIntervalFn = input.clearIntervalFn
    ?? ((handle) => clearInterval(handle as ReturnType<typeof setInterval>));
  const logWarning = input.logWarning ?? ((message) => console.warn(message));
  let running = false;
  let stopped = false;
  let cleared = false;

  const runOnce = async () => {
    if (running || stopped) {
      return;
    }
    running = true;
    try {
      await input.syncRefunds();
    } catch (error) {
      logWarning(`[service refund sync] ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      running = false;
    }
  };

  const handle = setIntervalFn(runOnce, intervalMs);
  handle.unref?.();

  return {
    runOnce,
    stop() {
      stopped = true;
      if (cleared) {
        return;
      }
      cleared = true;
      clearIntervalFn(handle);
    },
  };
}

interface MetaletEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_DAEMON_BASE_URL;
}

function normalizeEnvText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

async function fetchMetaletData<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = await response.json() as MetaletEnvelope<T>;
  if (payload?.code !== 0) {
    throw new Error(payload?.message || 'Metalet request failed.');
  }
  return (payload?.data ?? null) as T;
}

function parseDaemonPort(value: string | undefined): number | null {
  const parsed = Number.parseInt(normalizeEnvText(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

export function getDefaultDaemonPort(_systemHomeDir?: string): number {
  return DEFAULT_DAEMON_PORT;
}

type SupportedBooleanConfigKey = 'a2a.simplemsgListenerEnabled' | 'chain.mvcSponsorUploadEnabled';

type SupportedEnumConfigKey = 'chain.defaultWriteNetwork';

type SupportedConfigKey = SupportedBooleanConfigKey | SupportedEnumConfigKey;

type SupportedConfigValue = boolean | DefaultWriteNetwork;

const SUPPORTED_CONFIG_KEYS = new Set<SupportedConfigKey>([
  'a2a.simplemsgListenerEnabled',
  'chain.defaultWriteNetwork',
  'chain.mvcSponsorUploadEnabled',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSupportedConfigKey(key: string): key is SupportedConfigKey {
  return SUPPORTED_CONFIG_KEYS.has(key as SupportedConfigKey);
}

function isSupportedBooleanConfigKey(key: SupportedConfigKey): key is SupportedBooleanConfigKey {
  return key === 'a2a.simplemsgListenerEnabled' || key === 'chain.mvcSponsorUploadEnabled';
}

function readConfigValue(
  config: Awaited<ReturnType<ConfigStore['read']>>,
  key: SupportedConfigKey,
): SupportedConfigValue {
  if (key === 'a2a.simplemsgListenerEnabled') {
    return config.a2a.simplemsgListenerEnabled;
  }
  if (key === 'chain.defaultWriteNetwork') {
    return config.chain.defaultWriteNetwork;
  }
  if (key === 'chain.mvcSponsorUploadEnabled') {
    return config.chain.mvcSponsorUploadEnabled;
  }
  return config.chain.defaultWriteNetwork;
}

function writeConfigValue(
  config: Awaited<ReturnType<ConfigStore['read']>>,
  key: SupportedConfigKey,
  value: SupportedConfigValue,
): Awaited<ReturnType<ConfigStore['read']>> {
  if (key === 'chain.defaultWriteNetwork') {
    return {
      ...config,
      chain: {
        ...config.chain,
        defaultWriteNetwork: value as DefaultWriteNetwork,
      },
    };
  }
  if (key === 'chain.mvcSponsorUploadEnabled') {
    return {
      ...config,
      chain: {
        ...config.chain,
        mvcSponsorUploadEnabled: value === true,
      },
    };
  }
  if (key === 'a2a.simplemsgListenerEnabled') {
    return {
      ...config,
      a2a: {
        ...config.a2a,
        simplemsgListenerEnabled: value === true,
      },
    };
  }
  return config;
}

function normalizeConfigValueForKey(input: {
  key: SupportedConfigKey;
  value: boolean | string;
}): {
  ok: true;
  value: SupportedConfigValue;
} | {
  ok: false;
  message: string;
} {
  if (isSupportedBooleanConfigKey(input.key)) {
    if (typeof input.value !== 'boolean') {
      return {
        ok: false,
        message: `Config key ${input.key} requires a boolean value.`,
      };
    }
    return {
      ok: true,
      value: input.value,
    };
  }

  if (input.key === 'chain.defaultWriteNetwork') {
    const value = typeof input.value === 'string' ? input.value.trim().toLowerCase() : '';
    if (!DEFAULT_WRITE_NETWORKS.includes(value as DefaultWriteNetwork)) {
      return {
        ok: false,
        message: `Config value for chain.defaultWriteNetwork must be one of ${DEFAULT_WRITE_NETWORKS.join(', ')}.`,
      };
    }
    return {
      ok: true,
      value: value as DefaultWriteNetwork,
    };
  }

  return {
    ok: false,
    message: `Unsupported config key: ${input.key}`,
  };
}

async function readArtifactFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.promises.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}
function collectRuntimeFingerprintEntries(rootDir: string, directory: string, entries: string[]): void {
  for (const dirent of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, dirent.name);
    if (dirent.isDirectory()) {
      collectRuntimeFingerprintEntries(rootDir, absolutePath, entries);
      continue;
    }
    if (!dirent.isFile() || !absolutePath.endsWith('.js')) {
      continue;
    }
    const stat = fs.statSync(absolutePath);
    entries.push(`${path.relative(rootDir, absolutePath)}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
  }
}

export function getDaemonRuntimeFingerprint(rootDir?: string): string {
  const normalizedRoot = rootDir
    ? path.resolve(rootDir)
    : path.resolve(__dirname, '..');
  if (!rootDir && cachedDaemonRuntimeFingerprint) {
    return cachedDaemonRuntimeFingerprint;
  }

  const entries: string[] = [];
  try {
    collectRuntimeFingerprintEntries(normalizedRoot, normalizedRoot, entries);
  } catch {
    const fallbackEntry = resolveCliEntrypoint();
    try {
      const stat = fs.statSync(fallbackEntry);
      entries.push(`${path.basename(fallbackEntry)}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      entries.push(`fallback:${fallbackEntry}`);
    }
  }

  entries.sort();
  const fingerprint = createHash('sha256').update(entries.join('\n')).digest('hex');
  if (!rootDir) {
    cachedDaemonRuntimeFingerprint = fingerprint;
  }
  return fingerprint;
}

export function buildDaemonConfigHash(
  env: NodeJS.ProcessEnv,
  options: { runtimeFingerprint?: string } = {},
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      runtimeFingerprint: options.runtimeFingerprint ?? getDaemonRuntimeFingerprint(),
      chainApiBaseUrl: normalizeEnvText(env.METABOT_CHAIN_API_BASE_URL),
      fakeChainWrite: normalizeEnvText(env[TEST_FAKE_CHAIN_WRITE_ENV]),
      fakeSubsidy: normalizeEnvText(env[TEST_FAKE_SUBSIDY_ENV]),
      fakeProviderChatPublicKey: normalizeEnvText(env[TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV]),
      fakeMetaWebReply: normalizeEnvText(env[TEST_FAKE_METAWEB_REPLY_ENV]),
      fakeBuyerRatingReply: normalizeEnvText(env[TEST_FAKE_BUYER_RATING_REPLY_ENV]),
    }))
    .digest('hex');
}

function normalizeHomeDir(
  env: NodeJS.ProcessEnv,
  cwd: string,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): string {
  return resolveMetabotHomeSelectionSync({
    env,
    cwd,
    allowUnindexedExplicitHome: options.allowUnindexedExplicitHome,
  }).homeDir;
}

function normalizeSystemHomeDir(env: NodeJS.ProcessEnv, cwd: string): string {
  return normalizeSelectedSystemHomeDir(env, cwd);
}

async function resolveActorHomeDir(
  context: CliRuntimeContext,
  from?: string,
): Promise<{ homeDir: string } | MetabotCommandResult<never>> {
  const requestedFrom = normalizeEnvText(from);
  if (!requestedFrom) {
    return { homeDir: normalizeHomeDir(context.env, context.cwd) };
  }

  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const profiles = await listIdentityProfiles(systemHomeDir).catch(() => []);
  const resolved = resolveProfileNameMatch(requestedFrom, profiles);
  if (resolved.status === 'not_found') {
    return commandFailed('profile_not_found', resolved.message);
  }
  if (resolved.status === 'ambiguous') {
    return commandFailed('identity_profile_ambiguous', resolved.message);
  }
  return { homeDir: resolved.match.homeDir };
}

function normalizeReadOnlyIdentityProfile(value: unknown): IdentityProfileRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const record = value as Partial<IdentityProfileRecord>;
  const name = normalizeEnvText(record.name);
  const slug = normalizeEnvText(record.slug);
  const homeDir = normalizeEnvText(record.homeDir);
  const globalMetaId = normalizeEnvText(record.globalMetaId);
  if (!name || !slug || !homeDir) {
    return null;
  }
  return {
    name,
    slug,
    aliases: Array.isArray(record.aliases)
      ? record.aliases.map((alias) => normalizeEnvText(alias)).filter(Boolean)
      : [],
    homeDir: path.resolve(homeDir),
    globalMetaId,
    mvcAddress: normalizeEnvText(record.mvcAddress),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
      ? record.createdAt
      : 0,
    updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
      ? record.updatedAt
      : 0,
  };
}

async function readIdentityProfilesReadonly(systemHomeDir: string): Promise<IdentityProfileRecord[]> {
  const layout = resolveMetabotManagerLayout(systemHomeDir);
  let raw: string;
  try {
    raw = await fs.promises.readFile(layout.identityProfilesPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }

  const record = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as { profiles?: unknown }
    : {};
  const profiles = Array.isArray(record.profiles) ? record.profiles : [];
  return profiles
    .map(normalizeReadOnlyIdentityProfile)
    .filter((profile): profile is IdentityProfileRecord => Boolean(profile));
}

async function resolveActorProfileReadonly(
  context: CliRuntimeContext,
  from?: string,
): Promise<{ homeDir: string; profile: IdentityProfileRecord } | MetabotCommandResult<never>> {
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const profiles = await readIdentityProfilesReadonly(systemHomeDir);
  const requestedFrom = normalizeEnvText(from);
  let profile: IdentityProfileRecord | undefined;

  if (requestedFrom) {
    const resolved = resolveProfileNameMatch(requestedFrom, profiles);
    if (resolved.status === 'not_found') {
      return commandFailed('profile_not_found', resolved.message);
    }
    if (resolved.status === 'ambiguous') {
      return commandFailed('identity_profile_ambiguous', resolved.message);
    }
    profile = resolved.match;
  } else {
    const explicitHome = normalizeEnvText(context.env.METABOT_HOME);
    const selectedHome = explicitHome ? path.resolve(explicitHome) : await resolveTwinHomeDir(systemHomeDir);
    if (!selectedHome) {
      return commandFailed('profile_not_found', 'No Twin Bot profile found for dry-run delivery.');
    }
    profile = profiles.find((entry) => path.resolve(entry.homeDir) === selectedHome);
    if (!profile) {
      return commandFailed('profile_not_found', `MetaBot profile not found in the manager index for home: ${selectedHome}`);
    }
  }

  if (!profile.globalMetaId) {
    return commandFailed(
      'identity_unavailable',
      `MetaBot profile ${profile.slug} does not have a globalMetaId in the manager index. Initialize or sync the profile identity before dry-run delivery.`,
    );
  }

  return {
    homeDir: profile.homeDir,
    profile,
  };
}

async function resolveActorProfileSlug(
  context: CliRuntimeContext,
  input: { from?: string; slug?: string } = {},
): Promise<{ slug: string } | MetabotCommandResult<never>> {
  const requestedSelector = normalizeEnvText(input.from) || normalizeEnvText(input.slug);
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  if (requestedSelector) {
    return { slug: requestedSelector };
  }

  const profiles = await listIdentityProfiles(systemHomeDir).catch(() => []);
  const twinHomeDir = path.resolve(normalizeHomeDir(context.env, context.cwd));
  const twinProfile = profiles.find((profile) => path.resolve(profile.homeDir) === twinHomeDir);
  if (!twinProfile?.slug) {
    return commandFailed(
      'profile_not_found',
      `Twin Bot profile not found in the manager index for home: ${twinHomeDir}`,
    );
  }
  return { slug: twinProfile.slug };
}

function cloneContextWithHomeDir(context: CliRuntimeContext, homeDir: string): CliRuntimeContext {
  return {
    ...context,
    env: {
      ...context.env,
      METABOT_HOME: homeDir,
    },
  };
}

function tryNormalizeHomeDir(
  env: NodeJS.ProcessEnv,
  cwd: string,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): string | null {
  try {
    return normalizeHomeDir(env, cwd, options);
  } catch {
    return null;
  }
}

function resolveCliEntrypoint(): string {
  return path.join(__dirname, 'main.js');
}

function resolveLocalUiPath(page: string): string {
  if (page === 'buzz') {
    return '/ui/buzz/app/index.html';
  }
  if (page === 'chat') {
    return '/ui/chat/app/chat.html';
  }
  return `/ui/${page}`;
}

const BROWSER_DEEP_LINK_SCHEMES = new Set(['metaid', 'metaapp', 'metafile', 'pin']);
const BROWSER_PIN_ID_PATTERN = /^[0-9a-f]{64}i0$/iu;
const BROWSER_DOMAIN_ALIAS_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;
// preview-metaapp://localhost<path-to-dir-or-entry> carries an absolute path, so
// unlike the host-only deep links above it needs its own RESTful Browser path.
const PREVIEW_METAAPP_URI_PATTERN = /^preview-metaapp:\/\/([^/?#]+)(\/.*)?$/iu;

function resolveLocalBrowserPath(uri: string): string {
  const trimmedUri = uri.trim();
  const match = trimmedUri === uri
    ? /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)$/iu.exec(uri)
    : null;
  const scheme = match?.[1]?.toLowerCase();
  const resourceId = match?.[2];
  if (scheme && resourceId && BROWSER_DEEP_LINK_SCHEMES.has(scheme)) {
    return `/browser/${scheme}/${encodeURIComponent(resourceId)}`;
  }
  // Render preview-metaapp://localhost<path> as a path-style Browser URL so it
  // survives chat surfaces that mangle the ?uri=<encoded> query form. The host
  // and each absolute-path segment are encoded independently.
  const previewMatch = trimmedUri === uri ? PREVIEW_METAAPP_URI_PATTERN.exec(uri) : null;
  if (previewMatch) {
    const host = previewMatch[1];
    const rawPath = previewMatch[2] || '';
    const segments = rawPath.split('/').filter(Boolean).map((segment) => encodeURIComponent(segment));
    const pathSuffix = segments.length ? '/' + segments.join('/') : '';
    return `/browser/preview-metaapp/${encodeURIComponent(host)}${pathSuffix}`;
  }
  if (!match && trimmedUri === uri && BROWSER_PIN_ID_PATTERN.test(uri)) {
    return `/browser/pin/${encodeURIComponent(uri)}`;
  }
  if (!match && trimmedUri === uri && BROWSER_DOMAIN_ALIAS_PATTERN.test(uri)) {
    return `/browser/metaid/${encodeURIComponent(uri)}`;
  }

  const query = new URLSearchParams();
  query.set('uri', uri);
  return `/browser?${query.toString()}`;
}

/**
 * Best-effort daemon base URL for decorating read-only results with clickable
 * http links. Unlike ensureDaemonBaseUrl this never starts or restarts a
 * daemon: links are only attached when a base URL is already configured or a
 * running daemon is reachable.
 */
async function readReachableDaemonBaseUrl(context: CliRuntimeContext): Promise<string | null> {
  const explicitBaseUrl = normalizeEnvText(context.env.METABOT_DAEMON_BASE_URL);
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl);
  }
  const daemonRecord = await resolveDaemonRecord(context);
  if (
    daemonRecord?.baseUrl
    && daemonConfigMatchesContext(daemonRecord, context)
    && await isDaemonReachable(daemonRecord.baseUrl, daemonRecord.ownerId)
  ) {
    return normalizeBaseUrl(daemonRecord.baseUrl);
  }
  return null;
}

/**
 * Adds clickable per-item http links for hosts whose markdown renderer cannot
 * intercept metaapp:// or metaid:// deep links: `localUiUrl` opens the app in
 * the local Browser, `publisherLocalUiUrl` opens the publisher's Bot page.
 */
function withMetaAppCandidateLinks(
  items: TrimmedMetaAppSearchItem[],
  daemonBaseUrl: string | null,
): Array<TrimmedMetaAppSearchItem & { localUiUrl?: string; publisherLocalUiUrl?: string }> {
  if (!daemonBaseUrl) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    ...(item.pinId
      ? { localUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaapp://${item.pinId}`)}` }
      : {}),
    ...(item.publisherGlobalMetaId
      ? { publisherLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaid://${item.publisherGlobalMetaId}`)}` }
      : {}),
  }));
}

/**
 * Same link decoration for MetaID search candidates: `localUiUrl` opens the
 * identity's Bot page in the local Browser, `avatarLocalUiUrl` the avatar
 * metafile. Only attached when a daemon base URL is reachable.
 */
function withMetaIdCandidateLinks(
  items: TrimmedMetaIdSearchItem[],
  daemonBaseUrl: string | null,
): Array<TrimmedMetaIdSearchItem & { localUiUrl?: string; avatarLocalUiUrl?: string }> {
  if (!daemonBaseUrl) {
    return items;
  }
  return items.map((item) => ({
    ...item,
    ...(item.globalMetaId
      ? { localUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaid://${item.globalMetaId}`)}` }
      : {}),
    ...(item.avatarId
      ? { avatarLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metafile://${item.avatarId}`)}` }
      : {}),
  }));
}

/**
 * Link decoration for a MetaID detail record: Bot page, avatar metafile, and
 * the declared custom homepage when its URI resolves to a Browser surface.
 */
function withMetaIdDetailLinks(
  detail: MetaIdDetail,
  daemonBaseUrl: string | null,
): MetaIdDetail & { localUiUrl?: string; avatarLocalUiUrl?: string; homepageLocalUiUrl?: string } {
  if (!daemonBaseUrl) {
    return detail;
  }
  const homepage = detail.homepage;
  const homepageRecord = homepage && typeof homepage === 'object' && !Array.isArray(homepage)
    ? homepage as Record<string, unknown>
    : null;
  const homepageUri = normalizeEnvText(typeof homepageRecord?.uri === 'string' ? homepageRecord.uri : undefined);
  return {
    ...detail,
    ...(detail.globalMetaId
      ? { localUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metaid://${detail.globalMetaId}`)}` }
      : {}),
    ...(detail.avatarId
      ? { avatarLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(`metafile://${detail.avatarId}`)}` }
      : {}),
    ...(homepageUri
      ? { homepageLocalUiUrl: `${daemonBaseUrl}${resolveLocalBrowserPath(homepageUri)}` }
      : {}),
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveRuntimeInputPath(context: CliRuntimeContext, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(context.cwd, filePath);
}

async function readJsonObjectFile(
  context: CliRuntimeContext,
  filePath: string,
): Promise<Record<string, unknown>> {
  const raw = await context.readTextFile(resolveRuntimeInputPath(context, filePath));
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('payload file must contain a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

async function readPreferredLlmRuntimeId(paths: MetabotPaths): Promise<string | null> {
  try {
    const raw = await fs.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
    const data = JSON.parse(raw) as { runtimeId?: string | null };
    return typeof data.runtimeId === 'string' ? data.runtimeId : null;
  } catch {
    return null;
  }
}

async function refreshLlmRuntimeStoreFromDiscovery(
  runtimeStore: ReturnType<typeof createLlmRuntimeStore>,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  const previous = await runtimeStore.read();
  const result = await discoverLlmRuntimes({ env, knownRuntimes: previous.runtimes });
  const discoveredRuntimeIds = new Set(result.runtimes.map((runtime) => runtime.id));
  for (const runtime of result.runtimes) {
    await runtimeStore.upsertRuntime(runtime, { preserveRecentHealthyOnDetected: true });
  }
  for (const runtime of previous.runtimes) {
    if (runtime.provider === 'custom') continue;
    if (!discoveredRuntimeIds.has(runtime.id) && runtime.health !== 'unavailable') {
      await runtimeStore.updateHealth(runtime.id, 'unavailable');
    }
  }
}

function createCliLlmRuntimeResolver(paths: MetabotPaths) {
  return createLlmRuntimeResolver({
    runtimeStore: createLlmRuntimeStore(paths),
    bindingStore: createLlmBindingStore(paths),
    getPreferredRuntimeId: async () => readPreferredLlmRuntimeId(paths),
  });
}

function parseDreamLimits(payload: Record<string, unknown>): Partial<DreamModelLimits> | undefined {
  const source = payload.limits && typeof payload.limits === 'object' && !Array.isArray(payload.limits)
    ? payload.limits as Record<string, unknown>
    : payload;
  const contextWindow = typeof source.contextWindow === 'number' && Number.isFinite(source.contextWindow)
    ? source.contextWindow
    : undefined;
  const maxOutputTokens = typeof source.maxOutputTokens === 'number' && Number.isFinite(source.maxOutputTokens)
    ? source.maxOutputTokens
    : undefined;
  if (contextWindow === undefined && maxOutputTokens === undefined) return undefined;
  return {
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxOutputTokens !== undefined ? { maxOutputTokens } : {}),
  };
}

async function isPortBindable(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const probe = net.createServer();
    const finalize = (result: boolean) => {
      probe.removeAllListeners();
      resolve(result);
    };
    probe.once('error', () => finalize(false));
    probe.listen(port, host, () => {
      probe.close(() => finalize(true));
    });
  });
}

async function selectDaemonInstallation(
  context: Pick<CliRuntimeContext, 'env' | 'cwd'>,
): Promise<DaemonInstallationRecord> {
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const store = createDaemonStateStore(systemHomeDir);
  const existing = await store.readInstallation();
  if (existing) {
    return existing;
  }

  const explicitPort = parseDaemonPort(context.env.METABOT_DAEMON_PORT)
    ?? parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV]);
  const candidates = explicitPort
    ? [explicitPort]
    : [
      DEFAULT_DAEMON_PORT,
      ...Array.from(
        { length: DAEMON_FALLBACK_PORT_END - DAEMON_FALLBACK_PORT_START + 1 },
        (_value, index) => DAEMON_FALLBACK_PORT_START + index,
      ),
    ];

  for (const port of candidates) {
    if (!await isPortBindable(DEFAULT_DAEMON_HOST, port)) {
      continue;
    }
    const record: DaemonInstallationRecord = {
      schemaVersion: 1,
      host: DEFAULT_DAEMON_HOST,
      port,
      selectionOrigin: explicitPort
        ? 'explicit_migration'
        : port === DEFAULT_DAEMON_PORT
          ? 'default'
          : 'fallback',
      updatedAt: Date.now(),
    };
    return store.writeInstallation(record);
  }

  if (explicitPort) {
    throw new Error(`daemon_port_unavailable: ${DEFAULT_DAEMON_HOST}:${explicitPort} is unavailable.`);
  }
  throw new Error(
    `daemon_port_unavailable: no free loopback port in ${DEFAULT_DAEMON_PORT} or ${DAEMON_FALLBACK_PORT_START}-${DAEMON_FALLBACK_PORT_END}.`,
  );
}

export interface DaemonStatusProbe {
  reachable: boolean;
  ownerId: string | null;
  pid: number | null;
}

export async function probeDaemonStatus(
  baseUrl: string,
  timeoutMs = DAEMON_HEALTH_TIMEOUT_MS,
): Promise<DaemonStatusProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/api/daemon/status`, {
      signal: controller.signal,
    });
    if (!response.ok) {
      return { reachable: false, ownerId: null, pid: null };
    }
    const payload = await response.json() as {
      ok?: unknown;
      data?: { daemonId?: unknown; pid?: unknown };
    };
    if (payload.ok !== true) {
      return { reachable: false, ownerId: null, pid: null };
    }
    return {
      reachable: true,
      ownerId: typeof payload.data?.daemonId === 'string'
        ? normalizeEnvText(payload.data.daemonId) || null
        : null,
      pid: typeof payload.data?.pid === 'number' && Number.isInteger(payload.data.pid)
        ? payload.data.pid
        : null,
    };
  } catch {
    return { reachable: false, ownerId: null, pid: null };
  } finally {
    clearTimeout(timeout);
  }
}

async function isDaemonReachable(baseUrl: string, expectedOwnerId?: string): Promise<boolean> {
  const status = await probeDaemonStatus(baseUrl);
  return status.reachable
    && (!expectedOwnerId || status.ownerId === expectedOwnerId);
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }

  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code !== 'ESRCH';
  }
}

async function readDaemonLockInfo(lockPath: string): Promise<{ ownerId: string | null; pid: number | null }> {
  try {
    const raw = await fs.promises.readFile(lockPath, 'utf8');
    const parsed = JSON.parse(raw) as { ownerId?: unknown; pid?: unknown };
    return {
      ownerId: typeof parsed.ownerId === 'string'
        ? normalizeEnvText(parsed.ownerId) || null
        : null,
      pid: typeof parsed.pid === 'number' && Number.isInteger(parsed.pid) ? parsed.pid : null,
    };
  } catch {
    return { ownerId: null, pid: null };
  }
}

async function readProcessCommand(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('ps', ['-p', String(pid), '-o', 'command='], (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      const command = stdout.trim();
      resolve(command || null);
    });
  });
}

class DaemonOwnershipVerificationError extends Error {
  constructor(pid: number, lockPath: string) {
    super(
      `Unable to verify ownership of daemon process ${pid}. It was not stopped. Inspect ${lockPath} and the daemon record before retrying.`,
    );
    this.name = 'DaemonOwnershipVerificationError';
  }
}

async function verifyDaemonProcessOwnership(input: {
  daemonRecord: RuntimeDaemonRecord;
  lockPath: string;
}): Promise<'dead' | 'verified' | 'unverified'> {
  const { daemonRecord, lockPath } = input;
  if (!isProcessAlive(daemonRecord.pid)) {
    return 'dead';
  }

  const status = await probeDaemonStatus(daemonRecord.baseUrl);
  if (
    status.reachable
    && status.ownerId === daemonRecord.ownerId
    && status.pid === daemonRecord.pid
  ) {
    return 'verified';
  }

  const lock = await readDaemonLockInfo(lockPath);
  if (lock.ownerId !== daemonRecord.ownerId || lock.pid !== daemonRecord.pid) {
    return 'unverified';
  }

  const command = await readProcessCommand(daemonRecord.pid);
  return command?.includes('daemon serve') ? 'verified' : 'unverified';
}

async function resolveDaemonRecord(
  context: CliRuntimeContext,
): Promise<GlobalDaemonRecord | null> {
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const store = createDaemonStateStore(systemHomeDir);
  return store.readDaemon();
}

function daemonConfigMatchesContext(
  daemonRecord: RuntimeDaemonRecord | null,
  context: CliRuntimeContext,
): boolean {
  if (!daemonRecord) {
    return false;
  }
  return normalizeEnvText(daemonRecord.configHash) === buildDaemonConfigHash(context.env);
}

async function stopRunningDaemon(input: {
  daemonRecord: RuntimeDaemonRecord;
  lockPath: string;
}): Promise<'already_stopped' | 'stopped'> {
  const { daemonRecord, lockPath } = input;
  if (!Number.isFinite(daemonRecord.pid) || daemonRecord.pid <= 0) {
    return 'already_stopped';
  }

  const ownership = await verifyDaemonProcessOwnership({ daemonRecord, lockPath });
  if (ownership === 'dead') {
    const portReleased = await isPortBindable(
      daemonRecord.host || DEFAULT_DAEMON_HOST,
      daemonRecord.port,
    );
    if (!portReleased) {
      throw new Error(
        `Daemon process ${daemonRecord.pid} is already gone, but ${daemonRecord.host || DEFAULT_DAEMON_HOST}:${daemonRecord.port} is still occupied.`,
      );
    }
    return 'already_stopped';
  }
  if (ownership !== 'verified') {
    throw new DaemonOwnershipVerificationError(daemonRecord.pid, lockPath);
  }

  try {
    process.kill(daemonRecord.pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return 'already_stopped';
    }
    throw error;
  }

  const waitForStop = async (): Promise<boolean> => {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < DAEMON_CONFIG_RESTART_TIMEOUT_MS) {
      if (
        !isProcessAlive(daemonRecord.pid)
        && await isPortBindable(daemonRecord.host || DEFAULT_DAEMON_HOST, daemonRecord.port)
      ) {
        return true;
      }
      await sleep(DAEMON_START_POLL_INTERVAL_MS);
    }
    return false;
  };

  if (await waitForStop()) {
    return 'stopped';
  }

  try {
    process.kill(daemonRecord.pid, 'SIGKILL');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ESRCH') {
      throw error;
    }
  }
  if (await waitForStop()) {
    return 'stopped';
  }

  throw new Error(`Timed out while stopping the verified local MetaBot daemon process ${daemonRecord.pid}.`);
}

async function quarantineLegacyDaemonPath(filePath: string): Promise<void> {
  try {
    await fs.promises.rename(filePath, `${filePath}.migrated-${Date.now()}`);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }
}

async function writeDaemonMigrationSnapshot(input: {
  systemHomeDir: string;
  entries: Array<Record<string, unknown>>;
}): Promise<void> {
  const paths = resolveMetabotDaemonPaths(input.systemHomeDir);
  await fs.promises.mkdir(paths.recoveryRoot, { recursive: true });
  const content = `${JSON.stringify({
    schemaVersion: 1,
    updatedAt: Date.now(),
    entries: input.entries,
  }, null, 2)}\n`;
  const temporaryPath = `${paths.migrationStatePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.promises.writeFile(temporaryPath, content, 'utf8');
    await fs.promises.rename(temporaryPath, paths.migrationStatePath);
  } catch (error) {
    await fs.promises.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function migrateLegacyProfileDaemons(systemHomeDir: string): Promise<void> {
  const profiles = await listIdentityProfiles(systemHomeDir);
  const entries: Array<Record<string, unknown>> = [];

  for (const profile of profiles) {
    const paths = resolveMetabotPaths(profile.homeDir);
    const legacyStore = createRuntimeStateStore(paths);
    const daemonRecord = await legacyStore.readDaemon();
    const lock = await readDaemonLockInfo(paths.daemonLockPath);

    if (!daemonRecord) {
      if (lock.pid && isProcessAlive(lock.pid)) {
        throw new Error(
          `daemon_migration_blocked: legacy daemon lock for profile ${profile.slug} belongs to live process ${lock.pid}; ownership cannot be proven.`,
        );
      }
      if (lock.pid || lock.ownerId) {
        await quarantineLegacyDaemonPath(paths.daemonLockPath);
        entries.push({ profile: profile.slug, state: 'quarantined_lock_without_record' });
      }
      continue;
    }

    const ownership = await verifyDaemonProcessOwnership({
      daemonRecord,
      lockPath: paths.daemonLockPath,
    });
    if (ownership === 'unverified') {
      throw new Error(
        `daemon_migration_blocked: unable to verify legacy daemon ownership for profile ${profile.slug}, pid ${daemonRecord.pid}.`,
      );
    }
    if (ownership === 'verified') {
      await stopRunningDaemon({ daemonRecord, lockPath: paths.daemonLockPath });
    }

    await quarantineLegacyDaemonPath(paths.daemonStatePath);
    await quarantineLegacyDaemonPath(paths.daemonLockPath);
    entries.push({
      profile: profile.slug,
      state: ownership === 'verified' ? 'stopped_and_quarantined' : 'quarantined_stale_record',
      pid: daemonRecord.pid,
      port: daemonRecord.port,
    });
  }

  if (entries.length > 0) {
    await writeDaemonMigrationSnapshot({ systemHomeDir, entries });
  }
}

async function ensureDaemonBaseUrl(
  context: CliRuntimeContext,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): Promise<string> {
  const explicitBaseUrl = typeof context.env.METABOT_DAEMON_BASE_URL === 'string'
    ? context.env.METABOT_DAEMON_BASE_URL.trim()
    : '';
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl);
  }

  const daemonRecord = await resolveDaemonRecord(context);
  if (daemonRecord) {
    const daemonPaths = resolveMetabotDaemonPaths(normalizeSystemHomeDir(context.env, context.cwd));
    if (
      daemonRecord.baseUrl
      && await isDaemonReachable(daemonRecord.baseUrl, daemonRecord.ownerId)
    ) {
      if (daemonConfigMatchesContext(daemonRecord, context)) {
        return daemonRecord.baseUrl;
      }
    }
    await stopRunningDaemon({ daemonRecord, lockPath: daemonPaths.daemonLockPath });
    return startDetachedDaemon(context, options);
  }

  return startDetachedDaemon(context, options);
}

async function startDetachedDaemon(
  context: CliRuntimeContext,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): Promise<string> {
  const homeDir = normalizeHomeDir(context.env, context.cwd, options);
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const store = createDaemonStateStore(systemHomeDir);
  const expectedConfigHash = buildDaemonConfigHash(context.env);
  const persistedRecord = await store.readDaemon();
  if (!persistedRecord) {
    await migrateLegacyProfileDaemons(systemHomeDir);
  }
  const installation = await selectDaemonInstallation(context);
  const preferredPort = installation.port;
  if (persistedRecord) {
    const daemonPaths = resolveMetabotDaemonPaths(systemHomeDir);
    if (
      persistedRecord.baseUrl
      && await isDaemonReachable(persistedRecord.baseUrl, persistedRecord.ownerId)
    ) {
      if (daemonConfigMatchesContext(persistedRecord, context)) {
        return persistedRecord.baseUrl;
      }
    }
    await stopRunningDaemon({ daemonRecord: persistedRecord, lockPath: daemonPaths.daemonLockPath });
  }
  if (!persistedRecord && !await isPortBindable(installation.host, installation.port)) {
    throw new Error(
      `daemon_port_in_use: the configured daemon endpoint ${installation.host}:${installation.port} is occupied. Use an explicit port migration to change it.`,
    );
  }
  await store.clearDaemon();

  const child = spawn(
    process.execPath,
    [resolveCliEntrypoint(), 'daemon', 'serve'],
    {
      cwd: systemHomeDir,
      detached: true,
      stdio: 'ignore',
      env: {
        ...context.env,
        HOME: systemHomeDir,
        METABOT_HOME: homeDir,
        ...(options.allowUnindexedExplicitHome ? { [ALLOW_UNINDEXED_HOME_ENV]: '1' } : {}),
        [DAEMON_PREFERRED_PORT_ENV]: String(preferredPort),
      },
    }
  );
  child.unref();

  const startedAt = Date.now();
  while ((Date.now() - startedAt) < DEFAULT_DAEMON_START_TIMEOUT_MS) {
    const daemonRecord = await store.readDaemon();
    if (
      daemonRecord?.baseUrl
      && normalizeEnvText(daemonRecord.configHash) === expectedConfigHash
      && await isDaemonReachable(daemonRecord.baseUrl, daemonRecord.ownerId)
    ) {
      return daemonRecord.baseUrl;
    }
    await sleep(DAEMON_START_POLL_INTERVAL_MS);
  }

  const diagnostics = await collectDaemonStartupDiagnostics({
    systemHomeDir,
    preferredPort,
  });
  throw new Error(formatDaemonStartupTimeoutMessage(diagnostics));
}

async function requestJson<T>(
  context: CliRuntimeContext,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  routePath: string,
  body?: Record<string, unknown>,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): Promise<MetabotCommandResult<T>> {
  const baseUrl = await ensureDaemonBaseUrl(context, options);
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return response.json() as Promise<MetabotCommandResult<T>>;
}

async function requestText(
  context: CliRuntimeContext,
  method: 'GET',
  routePath: string,
): Promise<string> {
  const baseUrl = await ensureDaemonBaseUrl(context);
  const response = await fetch(`${baseUrl}${routePath}`, {
    method,
  });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}`);
  }
  return response.text();
}

async function readInjectedRemoteServicesPrompt(context: CliRuntimeContext): Promise<string | null> {
  try {
    const homeDir = normalizeHomeDir(context.env, context.cwd);
    const cache = await createOnlineServiceCacheStore(homeDir).read();
    const services = cache.services
      .filter((service) => service.available && service.online)
      .slice(0, 20);
    return buildRemoteServicesPrompt(services);
  } catch {
    return null;
  }
}

async function renderSkillContractWithOnlineServiceContext(input: {
  context: CliRuntimeContext;
  skill: string;
  host?: ConcreteSkillHost;
  format: SkillRenderFormat;
}) {
  const rendered = renderResolvedSkillContract({
    skillName: input.skill,
    host: input.host,
    format: input.format,
  });
  const remoteServicesPrompt = await readInjectedRemoteServicesPrompt(input.context);
  if (!remoteServicesPrompt) {
    return rendered;
  }
  if (rendered.format === 'markdown') {
    return {
      ...rendered,
      markdown: `${rendered.markdown}\n\n## Available Remote Services\n${remoteServicesPrompt}`,
    };
  }
  return {
    ...rendered,
    contract: {
      ...rendered.contract,
      instructions: `${rendered.contract.instructions}\n\n${remoteServicesPrompt}`,
    },
  };
}

function createTestChainWriteSigner(baseSigner: Signer): Signer {
  let writeCount = 0;

  return {
    getIdentity: () => baseSigner.getIdentity(),
    getPrivateChatIdentity: () => baseSigner.getPrivateChatIdentity(),
    writePin: async (rawInput) => {
      const request = normalizeChainWriteRequest(rawInput);
      const identity = await baseSigner.getIdentity();
      writeCount += 1;
      const isMetaAppWrite = request.path === '/protocols/metaapp'
        || request.path === '/protocols/paycomment'
        || request.path.startsWith('@');
      const pinDigest = createHash('sha256').update(JSON.stringify({
        writeCount,
        operation: request.operation,
        path: request.path,
        encryption: request.encryption,
        version: request.version,
        contentType: request.contentType,
        payload: request.payload,
        encoding: request.encoding,
        network: request.network,
        globalMetaId: identity.globalMetaId,
        mvcAddress: identity.mvcAddress,
      })).digest('hex');
      const legacyPinId = `${request.path || 'metaid'}-pin-${writeCount}`;
      const legacyTxid = `${request.path || 'metaid'}-tx-${writeCount}`;
      return {
        txids: [isMetaAppWrite ? pinDigest : legacyTxid],
        pinId: isMetaAppWrite ? `${pinDigest}i0` : legacyPinId,
        totalCost: 1,
        network: request.network,
        operation: request.operation,
        path: request.path,
        contentType: request.contentType,
        encoding: request.encoding,
        globalMetaId: identity.globalMetaId,
        mvcAddress: identity.mvcAddress,
      };
    },
  };
}

function createCliSigner(context: CliRuntimeContext, homeDir: string): Signer {
  const secretStore = createFileSecretStore(homeDir);
  const adapters = createDefaultChainAdapterRegistry();
  const baseSigner = createLocalMnemonicSigner({ secretStore, adapters });
  if (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1') {
    return createTestChainWriteSigner(baseSigner);
  }
  return baseSigner;
}

export interface PrivateChatAutoReplyProfileDispatcher {
  handleInboundMessage(
    profile: IdentityProfileRecord,
    message: PrivateChatInboundMessage,
  ): Promise<void>;
  retryOutboundMessage(
    profile: IdentityProfileRecord,
    peerGlobalMetaId: string,
    message: PrivateChatMessage,
  ): Promise<boolean>;
  retryPendingInboundMessage(
    profile: IdentityProfileRecord,
    peerGlobalMetaId: string,
  ): Promise<boolean>;
}

export interface PrivateChatAutoReplyProfileDispatcherOptions {
  autoReplyConfig: PrivateChatAutoReplyConfig;
  resolvePeerChatPublicKey: (globalMetaId: string) => Promise<string | null>;
  llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
  handleOrderProtocolMessageForProfile?: (
    profile: IdentityProfileRecord,
    message: A2ASimplemsgInboundDispatcherMessage
  ) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
  createSignerForHome?: (homeDir: string) => Signer;
  createReplyRunnerForProfile?: (input: {
    paths: MetabotPaths;
    metaBotSlug: string;
    runtimeResolver: ReturnType<typeof createLlmRuntimeResolver>;
    runtimeStore: ReturnType<typeof createLlmRuntimeStore>;
    bindingStore: ReturnType<typeof createLlmBindingStore>;
    llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
  }) => ChatReplyRunner;
  createOrchestrator?: (
    deps: PrivateChatAutoReplyDependencies,
    config: PrivateChatAutoReplyConfig,
  ) => PrivateChatAutoReplyOrchestrator;
  // Resolves the live auto-reply config for a given profile home dir. The
  // returned object must be the same reference that the daemon's setAutoReply
  // handler mutates, so that toggling auto-reply off at runtime actually gates
  // inbound-message handling for that profile. The daemon resolver loads a
  // profile's persisted value before returning it after a restart. When omitted,
  // the dispatcher falls back to the shared autoReplyConfig (tests/legacy).
  resolveAutoReplyConfigForHome?: (
    homeDir: string,
  ) => PrivateChatAutoReplyConfig | Promise<PrivateChatAutoReplyConfig>;
}

type A2ARecoveredOrderProtocolMessage = A2ASimplemsgInboundDispatcherMessage & {
  localProfileSlug?: string | null;
};

// Set while the daemon runtime is up (spec R5.3): chat turns that find no
// selectable runtime nudge this loop to re-probe their profile's store soon.
let activeLlmAvailabilityRecovery: Pick<LlmAvailabilityRecovery, 'requestSoon'> | null = null;

export function createPrivateChatReplyRunnerForProfile(input: {
  paths: MetabotPaths;
  metaBotSlug: string;
  runtimeResolver: ReturnType<typeof createLlmRuntimeResolver>;
  runtimeStore: ReturnType<typeof createLlmRuntimeStore>;
  bindingStore: ReturnType<typeof createLlmBindingStore>;
  llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession'>;
  env?: NodeJS.ProcessEnv;
  logWarning?: (scope: string, message: string) => void;
}): ChatReplyRunner {
  return createHostLlmChatReplyRunner({
    runtimeResolver: input.runtimeResolver,
    llmExecutor: input.llmExecutor,
    metaBotSlug: input.metaBotSlug,
    chatWorkspaceDir: path.join(input.paths.profileRoot, '.runtime', 'private-chat-work'),
    requestAvailabilityRecovery: () => {
      activeLlmAvailabilityRecovery?.requestSoon(input.paths.profileRoot);
    },
    allowedChatSkillsResolver: createPrivateChatAllowedSkillsResolver({
      paths: input.paths,
      metaBotSlug: input.metaBotSlug,
      runtimeStore: input.runtimeStore,
      bindingStore: input.bindingStore,
      env: input.env,
      logWarning: input.logWarning,
    }),
    logWarning: input.logWarning,
  });
}

export interface A2AUnhandledOrderReplayResult {
  profiles: number;
  conversations: number;
  scanned: number;
  replayed: number;
  skipped: number;
  failed: number;
}

export interface A2AUnhandledOrderReplayOptions {
  systemHomeDir: string;
  activeHomeDir?: string | null;
  handleOrderProtocolMessage?: (
    message: A2ARecoveredOrderProtocolMessage
  ) => Promise<MetabotCommandResult<unknown>> | MetabotCommandResult<unknown>;
  listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
  maxMessagesPerProfile?: number;
  logWarning?: (scope: string, error: unknown) => void;
}

function normalizeReplayText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReplayOrderTxid(value: unknown): string {
  const normalized = normalizeReplayText(value);
  const pinMatch = normalized.match(/^([0-9a-f]{64})i\d+$/iu);
  if (pinMatch) {
    return pinMatch[1].toLowerCase();
  }
  return /^[0-9a-f]{64}$/iu.test(normalized) ? normalized.toLowerCase() : '';
}

function messageOrderTxidForReplay(message: Record<string, unknown>): string {
  return normalizeReplayOrderTxid(message.orderTxid)
    || normalizeReplayOrderTxid(message.txid)
    || normalizeReplayOrderTxid(message.pinId)
    || normalizeReplayOrderTxid(message.messageId)
    || normalizeReplayOrderTxid(message.id);
}

function extractReplayOrderLineValue(content: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s*${escaped}\\s*:\\s*(.+?)\\s*$`, 'imu'));
  return normalizeReplayText(match?.[1]);
}

function conversationHasServiceOrderSession(
  conversation: Record<string, unknown>,
  input: { orderTxid: string; paymentTxid: string },
): boolean {
  const sessions = Array.isArray(conversation.sessions) ? conversation.sessions : [];
  const indexedOrderSession = conversation.indexes
    && typeof conversation.indexes === 'object'
    && !Array.isArray(conversation.indexes)
    ? (conversation.indexes as { orderTxidToSessionId?: unknown; paymentTxidToSessionId?: unknown })
    : null;
  const orderIndex = indexedOrderSession?.orderTxidToSessionId
    && typeof indexedOrderSession.orderTxidToSessionId === 'object'
    && !Array.isArray(indexedOrderSession.orderTxidToSessionId)
    ? indexedOrderSession.orderTxidToSessionId as Record<string, unknown>
    : {};
  const paymentIndex = indexedOrderSession?.paymentTxidToSessionId
    && typeof indexedOrderSession.paymentTxidToSessionId === 'object'
    && !Array.isArray(indexedOrderSession.paymentTxidToSessionId)
    ? indexedOrderSession.paymentTxidToSessionId as Record<string, unknown>
    : {};
  if (input.orderTxid && normalizeReplayText(orderIndex[input.orderTxid])) {
    return true;
  }
  if (input.paymentTxid && normalizeReplayText(paymentIndex[input.paymentTxid])) {
    return true;
  }

  return sessions.some((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      return false;
    }
    const session = entry as Record<string, unknown>;
    if (normalizeReplayText(session.type) !== 'service_order') {
      return false;
    }
    return Boolean(
      (input.orderTxid && normalizeReplayOrderTxid(session.orderTxid) === input.orderTxid)
      || (input.paymentTxid && normalizeReplayText(session.paymentTxid) === input.paymentTxid)
    );
  });
}

async function readA2AConversationStateForReplay(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filePath, 'utf8')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function buildReplayOrderMessage(input: {
  profile: IdentityProfileRecord;
  activeHomeDir: string;
  conversation: Record<string, unknown>;
  rawMessage: Record<string, unknown>;
}): A2ARecoveredOrderProtocolMessage | null {
  const content = String(input.rawMessage.content ?? '');
  const classification = classifySimplemsgContent(content);
  if (classification.kind !== 'order_protocol' || classification.tag !== 'ORDER') {
    return null;
  }
  if (normalizeReplayText(input.rawMessage.direction) !== 'incoming') {
    return null;
  }
  const sender = input.rawMessage.sender
    && typeof input.rawMessage.sender === 'object'
    && !Array.isArray(input.rawMessage.sender)
    ? input.rawMessage.sender as Record<string, unknown>
    : null;
  const peer = input.conversation.peer
    && typeof input.conversation.peer === 'object'
    && !Array.isArray(input.conversation.peer)
    ? input.conversation.peer as Record<string, unknown>
    : null;
  const fromGlobalMetaId = normalizeReplayText(sender?.globalMetaId) || normalizeReplayText(peer?.globalMetaId);
  if (!fromGlobalMetaId) {
    return null;
  }
  const activeHomeDir = normalizeReplayText(input.activeHomeDir);
  const profileHomeDir = normalizeReplayText(input.profile.homeDir);
  const localProfileSlug = activeHomeDir && profileHomeDir && path.resolve(profileHomeDir) === path.resolve(activeHomeDir)
    ? null
    : input.profile.slug;
  const raw = input.rawMessage.raw
    && typeof input.rawMessage.raw === 'object'
    && !Array.isArray(input.rawMessage.raw)
    ? input.rawMessage.raw as Record<string, unknown>
    : null;
  return {
    fromGlobalMetaId,
    content,
    messagePinId: normalizeReplayText(input.rawMessage.pinId)
      || normalizeReplayText(input.rawMessage.messageId)
      || null,
    fromChatPublicKey: normalizeReplayText(sender?.chatPublicKey)
      || normalizeReplayText(peer?.chatPublicKey)
      || null,
    timestamp: Number.isFinite(input.rawMessage.timestamp)
      ? Math.trunc(Number(input.rawMessage.timestamp))
      : Date.now(),
    rawMessage: raw,
    localProfileSlug,
  };
}

export async function replayUnhandledA2AOrderMessagesForProfiles(
  input: A2AUnhandledOrderReplayOptions,
): Promise<A2AUnhandledOrderReplayResult> {
  const result: A2AUnhandledOrderReplayResult = {
    profiles: 0,
    conversations: 0,
    scanned: 0,
    replayed: 0,
    skipped: 0,
    failed: 0,
  };
  const handler = input.handleOrderProtocolMessage;
  if (!handler) {
    return result;
  }

  const listProfilesForReplay = input.listProfiles ?? listIdentityProfiles;
  const profiles = await listProfilesForReplay(input.systemHomeDir).catch((error) => {
    input.logWarning?.('[A2A order replay profiles]', error);
    return [];
  });
  const maxMessagesPerProfile = Math.max(1, Math.floor(Number(input.maxMessagesPerProfile) || 200));
  const replayedOrderKeys = new Set<string>();

  for (const profile of profiles) {
    result.profiles += 1;
    const paths = resolveMetabotPaths(profile.homeDir);
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(paths.a2aRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        input.logWarning?.('[A2A order replay read]', error);
      }
      continue;
    }

    const candidates: Array<{
      conversation: Record<string, unknown>;
      message: Record<string, unknown>;
      orderTxid: string;
      paymentTxid: string;
    }> = [];
    for (const entry of entries) {
      if (!entry.startsWith('chat-') || !entry.endsWith('.json')) {
        continue;
      }
      const conversation = await readA2AConversationStateForReplay(path.join(paths.a2aRoot, entry));
      if (!conversation) {
        continue;
      }
      result.conversations += 1;
      const messages = Array.isArray(conversation.messages) ? conversation.messages : [];
      for (const rawMessage of messages.slice(-maxMessagesPerProfile)) {
        if (!rawMessage || typeof rawMessage !== 'object' || Array.isArray(rawMessage)) {
          continue;
        }
        const message = rawMessage as Record<string, unknown>;
        const content = String(message.content ?? '');
        const classification = classifySimplemsgContent(content);
        if (
          normalizeReplayText(message.direction) !== 'incoming'
          || classification.kind !== 'order_protocol'
          || classification.tag !== 'ORDER'
        ) {
          continue;
        }
        const orderTxid = messageOrderTxidForReplay(message);
        const paymentTxid = normalizeReplayText(message.paymentTxid)
          || extractReplayOrderLineValue(content, 'txid');
        const replayKey = orderTxid || paymentTxid || normalizeReplayText(message.messageId);
        if (!replayKey) {
          result.skipped += 1;
          continue;
        }
        result.scanned += 1;
        if (
          replayedOrderKeys.has(replayKey)
          || conversationHasServiceOrderSession(conversation, { orderTxid, paymentTxid })
        ) {
          result.skipped += 1;
          continue;
        }
        candidates.push({ conversation, message, orderTxid, paymentTxid });
        replayedOrderKeys.add(replayKey);
      }
    }

    candidates.sort((left, right) => {
      const leftTime = Number.isFinite(left.message.timestamp) ? Number(left.message.timestamp) : 0;
      const rightTime = Number.isFinite(right.message.timestamp) ? Number(right.message.timestamp) : 0;
      return leftTime - rightTime;
    });

    for (const candidate of candidates) {
      const replayMessage = buildReplayOrderMessage({
        profile,
        activeHomeDir: normalizeReplayText(input.activeHomeDir),
        conversation: candidate.conversation,
        rawMessage: candidate.message,
      });
      if (!replayMessage) {
        result.skipped += 1;
        continue;
      }
      try {
        const handled = await handler(replayMessage);
        if (!handled.ok) {
          result.failed += 1;
          input.logWarning?.(
            '[A2A order replay handler]',
            new Error(`${handled.code || handled.state}: ${handled.message || 'ORDER handler returned a non-success result.'}`),
          );
          continue;
        }
        result.replayed += 1;
      } catch (error) {
        result.failed += 1;
        input.logWarning?.('[A2A order replay handler]', error);
      }
    }
  }

  return result;
}

export interface A2ACallerReplyResumeResult {
  profiles: number;
  scanned: number;
  armed: number;
  timedOut: number;
  skipped: number;
  failed: number;
}

export interface A2ACallerReplyResumeOptions {
  systemHomeDir: string;
  activeHomeDir?: string | null;
  resumeCallerReplyWait?: (input: {
    localProfileSlug?: string | null;
  }) => Promise<A2ACallerReplyResumeReport | null | undefined> | A2ACallerReplyResumeReport | null | undefined;
  listProfiles?: (systemHomeDir: string) => Promise<IdentityProfileRecord[]>;
  logWarning?: (scope: string, error: unknown) => void;
}

// Buyer-side counterpart of replayUnhandledA2AOrderMessagesForProfiles: caller
// reply waits live in daemon memory, so a restart would otherwise strand paid
// orders in 'requesting_remote' with no timeout and no refund. Re-arm them (or
// settle already-expired waits straight into the timeout + refund path).
export async function resumePendingA2ACallerReplyWaitsForProfiles(
  input: A2ACallerReplyResumeOptions,
): Promise<A2ACallerReplyResumeResult> {
  const result: A2ACallerReplyResumeResult = {
    profiles: 0,
    scanned: 0,
    armed: 0,
    timedOut: 0,
    skipped: 0,
    failed: 0,
  };
  const resume = input.resumeCallerReplyWait;
  if (!resume) {
    return result;
  }
  const listProfilesForResume = input.listProfiles ?? listIdentityProfiles;
  const profiles = await listProfilesForResume(input.systemHomeDir).catch((error) => {
    input.logWarning?.('[A2A caller reply resume profiles]', error);
    return [];
  });
  const activeHomeDir = normalizeReplayText(input.activeHomeDir);

  for (const profile of profiles) {
    result.profiles += 1;
    const profileHomeDir = normalizeReplayText(profile.homeDir);
    const localProfileSlug = activeHomeDir && profileHomeDir && path.resolve(profileHomeDir) === path.resolve(activeHomeDir)
      ? null
      : profile.slug;
    try {
      const report = await resume({ localProfileSlug });
      result.scanned += Number(report?.scanned) || 0;
      result.armed += Number(report?.armed) || 0;
      result.timedOut += Number(report?.timedOut) || 0;
      result.skipped += Number(report?.skipped) || 0;
      result.failed += Number(report?.failed) || 0;
    } catch (error) {
      result.failed += 1;
      input.logWarning?.('[A2A caller reply resume]', error);
    }
  }

  return result;
}

export function createPrivateChatAutoReplyProfileDispatcher(
  input: PrivateChatAutoReplyProfileDispatcherOptions,
): PrivateChatAutoReplyProfileDispatcher {
  const orchestrators = new Map<string, PrivateChatAutoReplyOrchestrator>();
  const createOrchestrator = input.createOrchestrator ?? createPrivateChatAutoReplyOrchestrator;

  async function getOrCreateOrchestrator(
    profile: IdentityProfileRecord,
  ): Promise<PrivateChatAutoReplyOrchestrator | null> {
    const profileHomeDir = normalizeEnvText(profile.homeDir);
    if (!profileHomeDir) return null;
    const cacheKey = path.resolve(profileHomeDir);
    const existing = orchestrators.get(cacheKey);
    if (existing) return existing;

    const profilePaths = resolveMetabotPaths(profileHomeDir);
    const profileRuntimeStore = createRuntimeStateStore(profilePaths);
    const profileSigner = input.createSignerForHome
      ? input.createSignerForHome(profileHomeDir)
      : createLocalMnemonicSigner({
        secretStore: createFileSecretStore(profileHomeDir),
        adapters: createDefaultChainAdapterRegistry(),
      });
    const profileRuntimeStoreForLlm = createLlmRuntimeStore(profilePaths);
    const profileBindingStore = createLlmBindingStore(profilePaths);
    const profileRuntimeResolver = createLlmRuntimeResolver({
      runtimeStore: profileRuntimeStoreForLlm,
      bindingStore: profileBindingStore,
      getPreferredRuntimeId: async () => {
        try {
          const raw = await fs.promises.readFile(profilePaths.preferredLlmRuntimePath, 'utf8');
          const data = JSON.parse(raw) as { runtimeId?: string | null };
          return typeof data.runtimeId === 'string' ? data.runtimeId : null;
        } catch {
          return null;
        }
      },
    });
    const metaBotSlug = path.basename(profilePaths.profileRoot);
    const replyRunner = input.createReplyRunnerForProfile
      ? input.createReplyRunnerForProfile({
        paths: profilePaths,
        metaBotSlug,
        runtimeResolver: profileRuntimeResolver,
        runtimeStore: profileRuntimeStoreForLlm,
        bindingStore: profileBindingStore,
        llmExecutor: input.llmExecutor,
      })
      : createPrivateChatReplyRunnerForProfile({
        paths: profilePaths,
        metaBotSlug,
        runtimeResolver: profileRuntimeResolver,
        runtimeStore: profileRuntimeStoreForLlm,
        bindingStore: profileBindingStore,
        llmExecutor: input.llmExecutor,
        env: process.env,
        logWarning: (scope, message) => console.warn(scope, message),
      });
    const profileGlobalMetaId = normalizeEnvText(profile.globalMetaId);
    // Use the live per-home config (the same object setAutoReply mutates) so a
    // runtime toggle-off is observed by this orchestrator immediately. Fall
    // back to the shared config when no resolver is wired (tests/legacy).
    const profileAutoReplyConfig = input.resolveAutoReplyConfigForHome
      ? await input.resolveAutoReplyConfigForHome(profileHomeDir)
      : input.autoReplyConfig;
    const concurrentlyCreated = orchestrators.get(cacheKey);
    if (concurrentlyCreated) return concurrentlyCreated;
    const orchestrator = createOrchestrator({
      stateStore: createPrivateChatStateStore(profilePaths),
      strategyStore: createChatStrategyStore(profilePaths),
      paths: profilePaths,
      signer: profileSigner,
      selfGlobalMetaId: async () => {
        const state = await profileRuntimeStore.readState().catch(() => null);
        return (state?.identity?.globalMetaId ?? profileGlobalMetaId) || null;
      },
      resolvePeerChatPublicKey: input.resolvePeerChatPublicKey,
      replyRunner,
      logSendFailure: createPrivateChatSendFailureFileLogger(profilePaths),
      hasActiveOrderWithPeer: createHasActiveOrderWithPeer({
        runtimeStateStore: profileRuntimeStore,
        sessionStateStore: createSessionStateStore(profilePaths),
      }),
      chatSkillWaitNotice: createChatSkillWaitNoticeGenerator({
        runtimeResolver: profileRuntimeResolver,
        llmExecutor: input.llmExecutor,
        metaBotSlug,
      }),
    }, profileAutoReplyConfig);

    orchestrators.set(cacheKey, orchestrator);
    return orchestrator;
  }

  return {
    async retryPendingInboundMessage(profile, peerGlobalMetaId) {
      const orchestrator = await getOrCreateOrchestrator(profile);
      return orchestrator?.retryPendingInboundMessage(peerGlobalMetaId) ?? false;
    },
    async retryOutboundMessage(profile, peerGlobalMetaId, message) {
      const orchestrator = await getOrCreateOrchestrator(profile);
      return orchestrator?.retryOutboundMessage(peerGlobalMetaId, message) ?? false;
    },
    async handleInboundMessage(profile, message) {
      const orchestrator = await getOrCreateOrchestrator(profile);
      if (!orchestrator) return;
      if (!input.handleOrderProtocolMessageForProfile) {
        await orchestrator.handleInboundMessage(message);
        return;
      }

      const dispatcher = buildA2ASimplemsgInboundDispatcher({
        handleOrderProtocolMessage: async (orderMessage) => input.handleOrderProtocolMessageForProfile!(
          profile,
          orderMessage,
        ),
        handleGenericPrivateChatMessage: async (genericMessage) => {
          await orchestrator.handleInboundMessage(genericMessage);
        },
      });
      await dispatcher(message);
    },
  };
}

function createTestSubsidyRequester(): (
  options: RequestMvcGasSubsidyOptions
) => Promise<RequestMvcGasSubsidyResult> {
  return async (options) => ({
    success: true,
    step1: {
      address: options.mvcAddress,
      source: 'test-fake-subsidy',
    },
    step2: {
      address: options.mvcAddress,
      source: 'test-fake-subsidy',
      rewarded: true,
    },
  });
}

function createTestProviderChatPublicKeyFetcher(
  env: NodeJS.ProcessEnv,
): ((globalMetaId: string) => Promise<string | null>) | undefined {
  const publicKey = typeof env[TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV] === 'string'
    ? env[TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV]!.trim()
    : '';
  if (!publicKey) {
    return undefined;
  }

  return async () => publicKey;
}

export async function resolvePeerChatPublicKeyFromLocalProfiles(
  systemHomeDir: string,
  globalMetaId: string,
): Promise<string | null> {
  const normalizedGlobalMetaId = normalizeEnvText(globalMetaId);
  if (!normalizedGlobalMetaId) {
    return null;
  }

  const profiles = await listIdentityProfiles(systemHomeDir).catch(() => []);
  for (const profile of profiles) {
    const profileGlobalMetaId = normalizeEnvText(profile.globalMetaId);
    const profileMatches = profileGlobalMetaId === normalizedGlobalMetaId;

    const runtimeState = await createRuntimeStateStore(profile.homeDir).readState().catch(() => null);
    const runtimeIdentity = runtimeState?.identity ?? null;
    const runtimeIdentityMatches = normalizeEnvText(runtimeIdentity?.globalMetaId) === normalizedGlobalMetaId;
    if (profileMatches || runtimeIdentityMatches) {
      const runtimeChatPublicKey = normalizeEnvText(runtimeIdentity?.chatPublicKey);
      if (runtimeChatPublicKey) {
        return runtimeChatPublicKey;
      }
    }

    const secrets = await createFileSecretStore(profile.homeDir)
      .readIdentitySecrets<LocalIdentitySecrets>()
      .catch(() => null);
    const secretGlobalMetaId = normalizeEnvText(secrets?.globalMetaId);
    const secretsMatch = secretGlobalMetaId === normalizedGlobalMetaId || (!secretGlobalMetaId && profileMatches);
    if (secretsMatch) {
      const secretChatPublicKey = normalizeEnvText(secrets?.chatPublicKey);
      if (secretChatPublicKey) {
        return secretChatPublicKey;
      }
    }
  }

  return null;
}

export function createPeerChatPublicKeyResolver(input: {
  systemHomeDir: string;
  fetchPeerChatPublicKey?: (globalMetaId: string) => Promise<string | null>;
  chainApiBaseUrl?: string;
}): (globalMetaId: string) => Promise<string | null> {
  return async (globalMetaId: string) => {
    const normalizedGlobalMetaId = normalizeEnvText(globalMetaId);
    if (!normalizedGlobalMetaId) {
      return null;
    }

    const primary = input.fetchPeerChatPublicKey
      ? await input.fetchPeerChatPublicKey(normalizedGlobalMetaId)
      : await fetchPeerChatPublicKeyFromChain(normalizedGlobalMetaId, {
        chainApiBaseUrl: input.chainApiBaseUrl,
      });
    const primaryChatPublicKey = normalizeEnvText(primary);
    if (primaryChatPublicKey) {
      return primaryChatPublicKey;
    }

    return resolvePeerChatPublicKeyFromLocalProfiles(
      input.systemHomeDir,
      normalizedGlobalMetaId,
    );
  };
}

function createTestMetaWebReplyWaiter(env: NodeJS.ProcessEnv): MetaWebServiceReplyWaiter | undefined {
  const raw = typeof env[TEST_FAKE_METAWEB_REPLY_ENV] === 'string'
    ? env[TEST_FAKE_METAWEB_REPLY_ENV]!.trim()
    : '';
  if (!raw) {
    return undefined;
  }

  let parsed: {
    state?: unknown;
    responseText?: unknown;
    deliveryPinId?: unknown;
    ratingRequestText?: unknown;
    observedAt?: unknown;
    delayMs?: unknown;
    sequence?: Array<{
      state?: unknown;
      responseText?: unknown;
      deliveryPinId?: unknown;
      ratingRequestText?: unknown;
      observedAt?: unknown;
      delayMs?: unknown;
    }> | unknown;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch (error) {
    throw new Error(
      `Invalid ${TEST_FAKE_METAWEB_REPLY_ENV}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const sequence = Array.isArray(parsed.sequence) && parsed.sequence.length > 0
    ? parsed.sequence
    : [parsed];
  let replyIndex = 0;

  return {
    awaitServiceReply: async (input) => {
      const step = sequence[Math.min(replyIndex, sequence.length - 1)] ?? parsed;
      replyIndex += 1;

      const delayMs = Number.isFinite(step.delayMs)
        ? Math.max(0, Math.floor(Number(step.delayMs)))
        : 0;
      if (delayMs > 0) {
        await sleep(Math.min(delayMs, input.timeoutMs));
      }

      if (step.state === 'timeout') {
        return {
          state: 'timeout',
        };
      }

      return {
        state: 'completed',
        responseText: typeof step.responseText === 'string'
          ? step.responseText
          : 'Test fake remote reply.',
        deliveryPinId: typeof step.deliveryPinId === 'string' ? step.deliveryPinId : null,
        artifacts: [],
        ratingRequestText: typeof step.ratingRequestText === 'string' ? step.ratingRequestText : null,
        observedAt: Number.isFinite(step.observedAt)
          ? Number(step.observedAt)
          : Date.now(),
        rawMessage: {
          source: 'test-fake-metaweb-reply',
        },
      };
    },
  };
}

function createTestBuyerRatingReplyRunner(env: NodeJS.ProcessEnv): ChatReplyRunner | undefined {
  const raw = typeof env[TEST_FAKE_BUYER_RATING_REPLY_ENV] === 'string'
    ? env[TEST_FAKE_BUYER_RATING_REPLY_ENV]!.trim()
    : '';
  if (!raw) {
    return undefined;
  }
  return async () => ({
    state: 'reply',
    content: raw,
  });
}

async function runWalletTransferRuntime(
  context: CliRuntimeContext,
  input: { from?: string; toAddress: string; amountRaw: string; confirm: boolean },
): Promise<MetabotCommandResult<unknown>> {
  const actor = await resolveActorHomeDir(context, input.from);
  if (!('homeDir' in actor)) {
    return actor;
  }
  const homeDir = actor.homeDir;
  const runtimeStateStore = createRuntimeStateStore(homeDir);
  const state = await runtimeStateStore.readState();
  if (!state.identity) {
    return commandFailed('identity_missing', 'No local MetaBot identity is loaded for the current active home.');
  }

  const adapters = createDefaultChainAdapterRegistry();

  if (!input.confirm) {
    return previewWalletTransfer({
      identity: state.identity,
      adapters,
      toAddress: input.toAddress,
      amountRaw: input.amountRaw,
    });
  }

  return confirmWalletTransfer({
    identity: state.identity,
    adapters,
    toAddress: input.toAddress,
    amountRaw: input.amountRaw,
    secretStore: createFileSecretStore(homeDir),
  });
}

async function runHostPersonaProjection(
  operation: () => Promise<unknown>,
): Promise<MetabotCommandResult<unknown>> {
  try {
    return commandSuccess(await operation());
  } catch (error) {
    if (error instanceof HostPersonaProjectionError) {
      return {
        ok: false,
        state: 'failed',
        code: error.code,
        message: error.message,
        data: error.data,
      } as MetabotCommandResult<unknown>;
    }
    return commandFailed(
      'host_persona_projection_failed',
      error instanceof Error ? error.message : String(error),
    );
  }
}

async function runDaemonStartCommand(context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const baseUrl = await ensureDaemonBaseUrl(context);
  const daemonRecord = await resolveDaemonRecord(context);
  const parsed = new URL(baseUrl);
  return commandSuccess({
    host: parsed.hostname,
    port: Number(parsed.port || '80'),
    baseUrl,
    pid: daemonRecord?.pid ?? null,
  });
}

async function runDaemonStopCommand(context: CliRuntimeContext): Promise<MetabotCommandResult<unknown>> {
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const daemonStore = createDaemonStateStore(systemHomeDir);
  const daemonRecord = await daemonStore.readDaemon();
  if (!daemonRecord || !daemonRecord.pid) {
    return commandFailed('daemon_not_running', 'No local daemon process is currently tracked.');
  }
  const pid = daemonRecord.pid;
  try {
    const stopped = await stopRunningDaemon({
      daemonRecord,
      lockPath: resolveMetabotDaemonPaths(systemHomeDir).daemonLockPath,
    });
    await daemonStore.clearDaemon(pid);
    return commandSuccess({
      pid,
      stopped: stopped === 'stopped',
      alreadyStopped: stopped === 'already_stopped',
    });
  } catch (error) {
    if (error instanceof DaemonOwnershipVerificationError) {
      return commandFailed('daemon_ownership_unverified', error.message);
    }
    const code = (error as NodeJS.ErrnoException).code;
    return commandFailed('daemon_stop_failed', `Failed to stop daemon process ${pid}: ${code || error}`);
  }
}

export function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies {
  async function requestJsonForSelectedActor<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    routePath: string,
    from?: string,
    body?: Record<string, unknown>,
  ): Promise<MetabotCommandResult<T>> {
    const requestedFrom = normalizeEnvText(from);
    return requestJson(
      context,
      method,
      routePath,
      body && requestedFrom ? { ...body, from: requestedFrom } : body,
    );
  }

  async function requestTextForSelectedActor(
    method: 'GET',
    routePath: string,
    from?: string,
  ): Promise<string> {
    return requestText(context, method, routePath);
  }

  async function openLocalUiPage(input: {
    page: string;
    from?: string;
    traceId?: string;
    sessionId?: string;
    serviceId?: string;
    mode?: string;
    host?: string;
    pinId?: string;
    firstPinId?: string;
    mine?: boolean;
    local?: string;
    peer?: string;
  }): Promise<MetabotCommandResult<unknown>> {
    const baseUrl = await ensureDaemonBaseUrl(context);
    const query = new URLSearchParams();
    if (input.from) query.set('from', input.from);
    if (input.traceId) query.set('traceId', input.traceId);
    if (input.sessionId) query.set('sessionId', input.sessionId);
    if (input.serviceId) query.set('serviceId', input.serviceId);
    if (input.mode) query.set('mode', input.mode);
    if (input.host) query.set('host', input.host);
    if (input.pinId) query.set('pinId', input.pinId);
    if (input.firstPinId) query.set('firstPinId', input.firstPinId);
    if (input.mine) query.set('mine', 'true');
    if (input.local) query.set('local', input.local);
    if (input.peer) query.set('peer', input.peer);
    const suffix = query.size ? `?${query.toString()}` : '';
    return commandSuccess({
      page: input.page,
      localUiUrl: `${baseUrl}${resolveLocalUiPath(input.page)}${suffix}`,
    });
  }

  // Non-fatal resolve probe for metaapp:// opens. Broken app versions (for
  // example a pin whose MetaApp protocol lacks a content reference) otherwise
  // surface only as an error page inside the Browser; reporting the resolve
  // outcome in the envelope lets the agent skip to the next candidate. Other
  // schemes stay fire-and-forget so metaid/metafile/map opens are not slowed
  // by chain lookups.
  async function probeMetaAppResolve(uri: string): Promise<{
    ok: boolean;
    title?: string;
    code?: string;
    message?: string;
  } | null> {
    const trimmed = uri.trim();
    if (!/^metaapp:\/\//iu.test(trimmed)) {
      return null;
    }
    const response = await requestJson<{
      ok?: boolean;
      title?: string;
      code?: string;
      message?: string;
    }>(context, 'GET', `/api/browser/resolve?uri=${encodeURIComponent(trimmed)}`);
    if (!response.ok) {
      return {
        ok: false,
        code: response.code ?? 'browser_resolve_failed',
        message: response.message ?? 'MetaApp resolve failed.',
      };
    }
    const data = response.data ?? {};
    return {
      ok: true,
      ...(typeof data.title === 'string' && data.title ? { title: data.title } : {}),
    };
  }

  async function openLocalBrowserPage(input: {
    uri?: string;
  }): Promise<MetabotCommandResult<unknown>> {
    const baseUrl = await ensureDaemonBaseUrl(context);
    const browserPath = input.uri
      ? resolveLocalBrowserPath(input.uri)
      : '/browser';
    const resolve = input.uri ? await probeMetaAppResolve(input.uri) : null;
    return commandSuccess({
      ...(input.uri ? { uri: input.uri } : {}),
      localUiUrl: `${baseUrl}${browserPath}`,
      ...(resolve ? { resolve } : {}),
    });
  }

  // Ask every currently-open Browser page to open a URI in a new tab. The daemon
  // fans the request out via the Browser tab SSE transport; ABC's client-only
  // AgentBrowserTabs.openTab performs the actual open. No tab id is returned —
  // tab ids are client-only and never reach the daemon.
  async function openBrowserTab(input: {
    uri: string;
  }): Promise<MetabotCommandResult<unknown>> {
    const baseUrl = await readReachableDaemonBaseUrl(context);
    const resolve = await probeMetaAppResolve(input.uri);
    const response = await requestJson<{
      ok?: boolean;
      uri?: string;
      pagesReached?: number;
      note?: string;
    }>(context, 'POST', '/api/browser/tabs/open', { uri: input.uri });
    if (!response.ok) {
      return commandFailed(
        response.code ?? 'browser_tab_open_failed',
        response.message ?? 'Browser tab open failed.',
      );
    }
    const data = response.data ?? {};
    const resultUri = typeof data.uri === 'string' ? data.uri : input.uri;
    return commandSuccess({
      uri: resultUri,
      // Same clickable path-form link as `browser open`/`browser link`, so the
      // agent never has to hand-build a Browser URL (preview-metaapp included).
      ...(baseUrl ? { localUiUrl: `${baseUrl}${resolveLocalBrowserPath(resultUri)}` } : {}),
      pagesReached: typeof data.pagesReached === 'number' ? data.pagesReached : 0,
      ...(data.note ? { note: data.note } : {}),
      ...(resolve ? { resolve } : {}),
    });
  }

  // Pure URI -> localUiUrl resolver for agents that need to render a clickable
  // http link for a deep-link URI (metaapp://, metaid://, metafile://, pin://,
  // map://, ...) without opening anything. Never starts a daemon: when no
  // daemon base URL is reachable the URI itself is returned without a link.
  async function resolveBrowserDeepLink(input: {
    uri: string;
  }): Promise<MetabotCommandResult<unknown>> {
    const baseUrl = await readReachableDaemonBaseUrl(context);
    if (!baseUrl) {
      return commandSuccess({ uri: input.uri });
    }
    return commandSuccess({
      uri: input.uri,
      localUiUrl: `${baseUrl}${resolveLocalBrowserPath(input.uri)}`,
    });
  }

  // MetaApp aggregation search/forks run directly against the metaso-p2p API:
  // they are read-only and the only local state they need (the Bot registry
  // globalMetaIds behind `isOwn`) is readable from this process.
  async function listOwnGlobalMetaIds(): Promise<Set<string>> {
    // Same local Bot registry that backs `bot list` (the daemon's
    // /api/bot/profiles handler builds its full profiles on these records).
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const profiles = await listIdentityProfiles(systemHomeDir).catch(() => [] as IdentityProfileRecord[]);
    return new Set(
      profiles
        .map((profile) => normalizeEnvText(profile.globalMetaId))
        .filter(Boolean),
    );
  }

  function mapMetaAppSearchError(error: unknown): MetabotCommandResult<never> {
    if (error instanceof MetaAppSearchNotFoundError) {
      return commandFailed('metaapp_not_found', error.message);
    }
    if (error instanceof MetaAppSearchApiError && error.apiCode === 40000) {
      return commandFailed('invalid_argument', error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return commandFailed('metaapp_search_failed', message);
  }

  function readMetaAppSearchOptions(): { baseUrl?: string } {
    const baseUrl = normalizeEnvText(context.env.METASO_P2P_BASE_URL);
    return baseUrl ? { baseUrl } : {};
  }

  function readPositiveField(value: unknown): number | undefined {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
  }

  async function runMetaAppSearch(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const [page, ownGlobalMetaIds, daemonBaseUrl] = await Promise.all([
        searchMetaApps({
          keyword: normalizeEnvText(typeof input.query === 'string' ? input.query : undefined) || undefined,
          tag: normalizeEnvText(typeof input.tag === 'string' ? input.tag : undefined) || undefined,
          chainName: normalizeEnvText(typeof input.chain === 'string' ? input.chain : undefined) || undefined,
          runtime: normalizeEnvText(typeof input.runtime === 'string' ? input.runtime : undefined) || undefined,
          publisher: normalizeEnvText(typeof input.publisher === 'string' ? input.publisher : undefined) || undefined,
          since: readPositiveField(input.since),
          until: readPositiveField(input.until),
          size: readPositiveField(input.limit),
          cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
        }, readMetaAppSearchOptions()),
        listOwnGlobalMetaIds(),
        readReachableDaemonBaseUrl(context),
      ]);
      return commandSuccess({
        items: withMetaAppCandidateLinks(trimMetaAppSearchItems(page.items, ownGlobalMetaIds), daemonBaseUrl),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      return mapMetaAppSearchError(error);
    }
  }

  async function runMetaAppForks(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    const pinId = normalizeEnvText(typeof input.pinId === 'string' ? input.pinId : undefined);
    if (!pinId) {
      return commandFailed('invalid_argument', 'pinId is required to list MetaApp forks.');
    }
    try {
      const [page, ownGlobalMetaIds, daemonBaseUrl] = await Promise.all([
        listMetaAppForks({
          pinId,
          size: readPositiveField(input.limit),
          cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
        }, readMetaAppSearchOptions()),
        listOwnGlobalMetaIds(),
        readReachableDaemonBaseUrl(context),
      ]);
      return commandSuccess({
        items: withMetaAppCandidateLinks(trimMetaAppSearchItems(page.items, ownGlobalMetaIds), daemonBaseUrl),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      return mapMetaAppSearchError(error);
    }
  }

  // MetaID search/detail run directly against the metaso-p2p API, sharing the
  // MetaApp aggregation client conventions (same base URL env, same envelope)
  // and the same local Bot registry behind `isOwn`.
  function mapMetaIdSearchError(error: unknown): MetabotCommandResult<never> {
    if (error instanceof MetaIdSearchNotFoundError) {
      return commandFailed('metaid_not_found', error.message);
    }
    if (error instanceof MetaIdSearchApiError && error.apiCode === 40000) {
      return commandFailed('invalid_argument', error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return commandFailed('metaid_search_failed', message);
  }

  function metawebServiceOptions(): { baseUrl?: string } {
    const override = normalizeEnvText(context.env.METABOT_METAWEB_API_BASE_URL);
    return override ? { baseUrl: override } : {};
  }

  /**
   * `metabot metaweb search` — unified cross-protocol knowledge search. The
   * data envelope carries the trimmed rows plus a model-ready `formatted`
   * block (clickable MetaWeb URI bullets + guidance) so skill hosts can pipe
   * it straight into the model context.
   */
  async function runMetawebSearch(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const q = normalizeEnvText(typeof input.query === 'string' ? input.query : undefined);
      if (!q) return commandFailed('missing_query', '--query is required.');
      const protocolsRaw = normalizeEnvText(typeof input.protocols === 'string' ? input.protocols : undefined);
      const page = await searchMetaweb({
        q,
        ...(protocolsRaw
          ? { protocols: protocolsRaw.split(',').map((key) => key.trim()).filter(Boolean) as MetawebSearchProtocol[] }
          : {}),
        publisher: normalizeEnvText(typeof input.publisher === 'string' ? input.publisher : undefined) || undefined,
        since: readPositiveField(input.since),
        until: readPositiveField(input.until),
        sort: input.sort === 'newest' ? 'newest' : undefined,
        size: readPositiveField(input.size),
        cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
      }, metawebServiceOptions());
      const bullets = formatMetawebSearchBullets(page.items);
      const asciiOnly = /^[\x00-\x7F]*$/.test(q);
      const guidance = [
        'Open 1-3 of the most relevant pins with `metabot metaweb read --pin <pinId>` before answering; cite the pins you actually read.',
        'If the results look thin, retry with broader or synonym keywords — the corpus is Chinese-heavy, so also try Chinese terms.'
          + (asciiOnly ? ' (Your query was pure ASCII — a Chinese retry is especially likely to help.)' : ''),
        'Never invent pin ids or content.',
      ].join('\n');
      return commandSuccess({
        items: page.items.map((item) => ({
          protocol: item.protocol,
          pinId: item.pinId,
          currentPinId: item.currentPinId,
          title: item.title,
          summary: item.summary,
          tags: item.tags,
          publisher: item.publisher,
          createdAt: item.createdAt,
          score: item.score,
        })),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        formatted: bullets ? `${bullets}\n${guidance}` : `${guidance}\n(No results. ${asciiOnly ? 'Try Chinese keywords — ' : ''}try broader or synonym terms.)`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return commandFailed('metaweb_search_failed', message);
    }
  }

  /** `metabot metaweb read --pin <pinId>` — generic pin read with citation-shaped output. */
  async function runMetawebRead(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const pinId = normalizeEnvText(typeof input.pinId === 'string' ? input.pinId : undefined);
      if (!pinId) return commandFailed('missing_pin', '--pin is required.');
      const pin = await readMetawebPin(pinId, metawebServiceOptions());
      return commandSuccess({
        pin: {
          pinId: pin.pinId,
          currentPinId: pin.currentPinId,
          protocol: pin.protocol,
          path: pin.path,
          chainName: pin.chainName,
          operation: pin.operation,
          creator: pin.creator,
          createdAt: pin.createdAt,
          contentType: pin.contentType,
          meta: pin.meta,
          attachments: pin.attachments,
          source: pin.source,
          truncated: pin.truncated,
          totalLength: pin.totalLength,
          text: pin.text,
        },
        formatted: `${formatMetawebPinDetail(pin)}\n${METAWEB_CITATION_RULE}`,
      });
    } catch (error) {
      if (error instanceof MetawebPinNotFoundError) {
        return commandFailed('pin_not_found', error.message);
      }
      const message = error instanceof Error ? error.message : String(error);
      return commandFailed('metaweb_read_failed', message);
    }
  }

  function sharedSkillsRoot(): string {
    return path.join(normalizeSystemHomeDir(context.env, context.cwd), '.metabot', 'skills');
  }

  function mapSkillInstallError(error: unknown): MetabotCommandResult<never> {
    if (error instanceof SkillInstallError) {
      return commandFailed(error.code === 'name_conflict' ? 'skill_name_conflict' : 'skill_install_failed', error.message);
    }
    if (error instanceof MetawebPinNotFoundError) {
      return commandFailed('pin_not_found', error.message);
    }
    const message = error instanceof Error ? error.message : String(error);
    return commandFailed('skill_install_failed', message);
  }

  /** Best-effort rebind of every auto-bind host root after the skills root changed. */
  async function rebindHostSkillRoots(): Promise<unknown> {
    try {
      return await bindPlatformSkills({
        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
        env: context.env,
        mode: 'auto',
      });
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** Remove a skill's symlinks from every auto-bind host root (post-uninstall cleanup). */
  async function unbindSkillFromHostRoots(name: string): Promise<Array<{ hostSkillRoot: string; removed: boolean }>> {
    const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
    const results: Array<{ hostSkillRoot: string; removed: boolean }> = [];
    for (const root of getInstallSkillRoots()) {
      if (root.autoBind === 'manual') continue;
      let hostSkillRoot: string;
      try {
        hostSkillRoot = resolvePlatformSkillRootPath(root, systemHomeDir, context.env);
      } catch {
        continue;
      }
      const linkPath = path.join(hostSkillRoot, name);
      try {
        const stat = await fs.promises.lstat(linkPath);
        if (stat.isSymbolicLink()) {
          await fs.promises.unlink(linkPath);
          results.push({ hostSkillRoot, removed: true });
        }
      } catch {
        // Missing or not a symlink — nothing to clean.
      }
    }
    return results;
  }

  /**
   * `metabot skills install` — install an on-chain metabot-skill package.
   * `--pin` reads the protocol pin for the package URI and provenance; `--uri`
   * installs a package zip directly. The `--confirm` gate mirrors the other
   * local-write flows: without it the command previews the install plan.
   */
  async function runSkillsInstall(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const pinId = normalizeEnvText(typeof input.pin === 'string' ? input.pin : undefined);
      const directUri = normalizeEnvText(typeof input.uri === 'string' ? input.uri : undefined);
      if (!pinId && !directUri) {
        return commandFailed('invalid_argument', 'Pass --pin <skill pinId> or --uri <package metafile:// or https URI>.');
      }

      let descriptor: ReturnType<typeof extractSkillPinDescriptor> = null;
      let creator: { globalMetaId: string; name: string } | undefined;
      if (pinId) {
        const pin = await readMetawebPin(pinId, metawebServiceOptions());
        descriptor = extractSkillPinDescriptor(pin);
        if (!descriptor && !directUri) {
          return commandFailed(
            'invalid_skill_pin',
            `Pin ${pinId} (protocol ${pin.protocol || 'unknown'}) does not carry a skill package payload (needs \`name\` + \`skill-file\`). Read it with \`metabot metaweb read --pin ${pinId}\` first.`,
          );
        }
        creator = {
          globalMetaId: pin.creator.globalMetaId,
          name: pin.creator.name,
        };
      }

      const contentReference = directUri || descriptor!.skillFileUri;
      const payloadName = normalizeEnvText(typeof input.name === 'string' ? input.name : undefined) || descriptor?.name;
      const confirm = input.confirm === true;

      if (!confirm) {
        const plan = [
          `Skill install plan:`,
          `- skill: ${payloadName || '(name from package SKILL.md)'}`,
          descriptor ? `- version: ${descriptor.version}` : null,
          descriptor?.description ? `- description: ${descriptor.description}` : null,
          creator?.globalMetaId ? `- publisher: ${creator.name || creator.globalMetaId} (${creator.globalMetaId})` : null,
          pinId ? `- source pin: ${pinId}` : null,
          `- package: ${contentReference}`,
          `- target: ${sharedSkillsRoot()}/<name>/ (local disk only; rebinds installed hosts afterwards)`,
          '',
          'Re-run with --confirm to install.',
        ].filter((line): line is string => line !== null).join('\n');
        return commandFailed('confirm_required', plan);
      }

      const installed = await installSkillFromReference({
        skillsRoot: sharedSkillsRoot(),
        contentReference,
        fetchImpl: globalThis.fetch,
        force: input.force === true,
        source: {
          ...(creator ? { creatorMetaId: creator.globalMetaId, creatorName: creator.name } : {}),
          ...(pinId ? { sourcePinId: pinId } : {}),
          skillFileUri: contentReference,
          ...(payloadName ? { payloadName } : {}),
          ...(descriptor?.version ? { payloadVersion: descriptor.version } : {}),
          ...(descriptor?.description ? { payloadDescription: descriptor.description } : {}),
        },
      });

      const rebind = input.noRebind === true ? 'skipped (--no-rebind)' : await rebindHostSkillRoots();
      const boundRoots = Array.isArray((rebind as { boundRoots?: unknown })?.boundRoots)
        ? (rebind as { boundRoots: Array<{ platformId: string; hostSkillRoot: string }> }).boundRoots
          .map((entry) => `${entry.platformId}: ${entry.hostSkillRoot}`)
        : [];
      const formatted = [
        `Installed skill "${installed.name}"${installed.version ? ` (v${installed.version})` : ''} → ${installed.skillDir}`,
        installed.replaced ? `(replaced previous installation${installed.previousVersion ? ` v${installed.previousVersion}` : ''})` : null,
        '',
        'Next steps:',
        `- Read its instructions: metabot skills read --name ${installed.name}`,
        '- Apply the new capability to the task at hand; cite the source pin when you report what you learned.',
        boundRoots.length ? `- Rebound host skill roots: ${boundRoots.join(', ')}` : null,
      ].filter((line): line is string => line !== null).join('\n');
      return commandSuccess({ skill: installed, rebind, formatted });
    } catch (error) {
      return mapSkillInstallError(error);
    }
  }

  /** `metabot skills list` — chain-installed skills from the install registry. */
  async function runSkillsList(): Promise<MetabotCommandResult<unknown>> {
    try {
      const skills = await listInstalledSkills(sharedSkillsRoot());
      const formatted = skills.length
        ? skills.map((skill) => [
          `- **${skill.name}**${skill.version ? ` (${skill.version})` : ''}`,
          skill.description ? ` — ${skill.description}` : '',
          skill.creatorMetaId ? ` | by ${skill.creatorName || skill.creatorMetaId}` : '',
          skill.sourcePinId ? ` | pin: ${skill.sourcePinId}` : '',
          skill.present ? '' : ' | MISSING ON DISK',
        ].join('')).join('\n')
          + '\nRead one with `metabot skills read --name <name>`.'
        : 'No skills installed from MetaWeb yet. Find one with `metabot metaweb search --query <topic> --protocols metabot-skill`, then `metabot skills install --pin <pinId> --confirm`.';
      return commandSuccess({ skills, formatted });
    } catch (error) {
      return mapSkillInstallError(error);
    }
  }

  /** `metabot skills read --name` — load one installed skill's SKILL.md and file tree. */
  async function runSkillsRead(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const name = normalizeEnvText(typeof input.name === 'string' ? input.name : undefined);
      if (!name) return commandFailed('invalid_argument', '--name is required.');
      const skill = await readInstalledSkill({ skillsRoot: sharedSkillsRoot(), name });
      return commandSuccess({ ...skill, formatted: skill.skillMd });
    } catch (error) {
      return mapSkillInstallError(error);
    }
  }

  /** `metabot skills uninstall --name` — remove one chain-installed skill (local dirs only). */
  async function runSkillsUninstall(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const name = normalizeEnvText(typeof input.name === 'string' ? input.name : undefined);
      if (!name) return commandFailed('invalid_argument', '--name is required.');
      if (input.confirm !== true) {
        return commandFailed(
          'confirm_required',
          `Uninstalling skill "${name}" removes its directory under ${sharedSkillsRoot()} and its host symlinks. Re-run with --confirm to uninstall.`,
        );
      }
      const removed = await uninstallInstalledSkill({ skillsRoot: sharedSkillsRoot(), name });
      const unbound = await unbindSkillFromHostRoots(name);
      return commandSuccess({
        ...removed,
        unboundRoots: unbound,
        formatted: `Uninstalled skill "${name}" (directory removed: ${removed.removedDir}; host symlinks cleaned: ${unbound.length}).`,
      });
    } catch (error) {
      return mapSkillInstallError(error);
    }
  }

  /**
   * `metabot skills publish` — package a local skill directory as a
   * metabot-skill zip and publish it on-chain. The wallet lives in the daemon,
   * so both the preview and the confirmed publish ride
   * `POST /api/skills/publish` with the selected actor's `from` slug.
   */
  async function runSkillsPublish(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    const skillDir = normalizeEnvText(typeof input.skillDir === 'string' ? input.skillDir : undefined);
    if (!skillDir) {
      return commandFailed('invalid_argument', 'Pass --dir <skill directory> (its root, or its single subdirectory, must carry SKILL.md).');
    }
    return requestJsonForSelectedActor(
      'POST',
      '/api/skills/publish',
      typeof input.from === 'string' ? input.from : undefined,
      {
        ...input,
        skillDir: resolveRuntimeInputPath(context, skillDir),
      },
    );
  }

  async function runMetaIdSearch(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    try {
      const [page, ownGlobalMetaIds, daemonBaseUrl] = await Promise.all([
        searchMetaIds({
          keyword: normalizeEnvText(typeof input.query === 'string' ? input.query : undefined) || undefined,
          skill: normalizeEnvText(typeof input.skill === 'string' ? input.skill : undefined) || undefined,
          chainName: normalizeEnvText(typeof input.chain === 'string' ? input.chain : undefined) || undefined,
          hasChatPubkey: input.chatPubkey === true,
          hasHomepage: input.homepage === true,
          since: readPositiveField(input.since),
          until: readPositiveField(input.until),
          size: readPositiveField(input.limit),
          cursor: normalizeEnvText(typeof input.cursor === 'string' ? input.cursor : undefined) || undefined,
        }, readMetaAppSearchOptions()),
        listOwnGlobalMetaIds(),
        readReachableDaemonBaseUrl(context),
      ]);
      return commandSuccess({
        items: withMetaIdCandidateLinks(trimMetaIdSearchItems(page.items, ownGlobalMetaIds), daemonBaseUrl),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
    } catch (error) {
      return mapMetaIdSearchError(error);
    }
  }

  async function runMetaIdDetail(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    const identity = normalizeEnvText(typeof input.identity === 'string' ? input.identity : undefined);
    if (!identity) {
      return commandFailed('invalid_argument', 'identity is required to read a MetaID detail.');
    }
    try {
      const [detail, daemonBaseUrl] = await Promise.all([
        getMetaIdDetail(identity, readMetaAppSearchOptions()),
        readReachableDaemonBaseUrl(context),
      ]);
      return commandSuccess(withMetaIdDetailLinks(detail, daemonBaseUrl));
    } catch (error) {
      return mapMetaIdSearchError(error);
    }
  }

  // MetaApp source materialization runs in-process like search/forks: it is
  // read-only (download into the local artifact cache plus an optional
  // workspace copy) and shares the artifact cache with the daemon Browser
  // flow by using the same actor home directory.
  async function runMetaAppSource(input: Record<string, unknown>): Promise<MetabotCommandResult<unknown>> {
    const pinId = normalizeEnvText(typeof input.pinId === 'string' ? input.pinId : undefined);
    if (!pinId) {
      return commandFailed('invalid_argument', 'pinId is required to materialize MetaApp source.');
    }
    const actor = await resolveActorHomeDir(
      context,
      normalizeEnvText(typeof input.from === 'string' ? input.from : undefined) || undefined,
    );
    if (!('homeDir' in actor)) {
      return actor;
    }
    // The indexer endpoints the daemon Browser adapter resolves pins and
    // metafile content against; they live in the infrastructure config.
    const infrastructure = await createInfrastructureConfigStore(
      normalizeSystemHomeDir(context.env, context.cwd),
    ).read();
    return materializeMetaAppSource(
      {
        pinId,
        ...(typeof input.outDir === 'string' && input.outDir.trim()
          ? { outDir: resolveRuntimeInputPath(context, input.outDir) }
          : {}),
      },
      {
        homeDir: actor.homeDir,
        manApiBaseUrl: infrastructure.manApiBaseUrl,
        metafileContentBaseUrl: infrastructure.metafileContentBaseUrl,
      },
    ).catch((error) => commandFailed(
      'metaapp_source_failed',
      error instanceof Error ? error.message : String(error),
    ));
  }

  return {
    config: {
      get: async (input) => {
        if (!isSupportedConfigKey(input.key)) {
          return commandFailed(
            'unsupported_config_key',
            `Unsupported config key: ${input.key}`,
          );
        }
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        return commandSuccess({
          key: input.key,
          value: readConfigValue(config, input.key),
        });
      },
      set: async (input) => {
        if (!isSupportedConfigKey(input.key)) {
          return commandFailed(
            'unsupported_config_key',
            `Unsupported config key: ${input.key}`,
          );
        }
        const normalizedValue = normalizeConfigValueForKey({
          key: input.key,
          value: input.value,
        });
        if (!normalizedValue.ok) {
          return commandFailed(
            'invalid_argument',
            normalizedValue.message,
          );
        }
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        const nextConfig = writeConfigValue(config, input.key, normalizedValue.value);
        await configStore.set(nextConfig);
        return commandSuccess({
          key: input.key,
          value: readConfigValue(nextConfig, input.key),
        });
      },
    },
    metaapp: {
      preview: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/preview',
        typeof input.from === 'string' ? input.from : undefined,
        {
          ...input,
          projectDir: typeof input.projectDir === 'string' ? resolveRuntimeInputPath(context, input.projectDir) : input.projectDir,
          manifestFile: typeof input.manifestFile === 'string' ? resolveRuntimeInputPath(context, input.manifestFile) : input.manifestFile,
        },
      ),
      publish: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/publish',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      update: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/update',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      delete: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/delete',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      list: async (input) => {
        const query = new URLSearchParams();
        if (typeof input.from === 'string') {
          query.set('from', input.from);
        }
        if (typeof input.cursor === 'string') {
          query.set('cursor', input.cursor);
        }
        if (typeof input.size === 'number') {
          query.set('size', String(input.size));
        }
        if (input.refresh === true) {
          query.set('refresh', 'true');
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJsonForSelectedActor(
          'GET',
          `/api/metaapp/list${suffix}`,
          typeof input.from === 'string' ? input.from : undefined,
        );
      },
      publishProject: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/publish-project',
        typeof input.from === 'string' ? input.from : undefined,
        {
          ...input,
          projectDir: typeof input.projectDir === 'string' ? resolveRuntimeInputPath(context, input.projectDir) : input.projectDir,
          manifestFile: typeof input.manifestFile === 'string' ? resolveRuntimeInputPath(context, input.manifestFile) : input.manifestFile,
        },
      ),
      updateProject: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/update-project',
        typeof input.from === 'string' ? input.from : undefined,
        {
          ...input,
          projectDir: typeof input.projectDir === 'string' ? resolveRuntimeInputPath(context, input.projectDir) : input.projectDir,
          manifestFile: typeof input.manifestFile === 'string' ? resolveRuntimeInputPath(context, input.manifestFile) : input.manifestFile,
        },
      ),
      share: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/share',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      view: async (input) => openLocalUiPage({
        page: 'apps',
        ...(typeof input.from === 'string' ? { from: input.from } : {}),
        ...(typeof input.pinId === 'string' ? { pinId: input.pinId } : {}),
        ...(typeof input.firstPinId === 'string' ? { firstPinId: input.firstPinId } : {}),
        ...(input.mine === true ? { mine: true } : {}),
      }),
      comment: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/metaapp/comment',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      search: async (input) => runMetaAppSearch(input),
      forks: async (input) => runMetaAppForks(input),
      source: async (input) => runMetaAppSource(input),
    },
    metaid: {
      search: async (input) => runMetaIdSearch(input),
      detail: async (input) => runMetaIdDetail(input),
    },
    metaweb: {
      search: async (input) => runMetawebSearch(input),
      read: async (input) => runMetawebRead(input),
    },
    buzz: {
      post: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/buzz/post',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    simplenote: {
      post: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/simplenote/post',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    browser: {
      open: async (input) => openLocalBrowserPage(input),
      tabOpen: async (input) => openBrowserTab(input),
      link: async (input) => resolveBrowserDeepLink(input),
    },
    chain: {
      write: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/chain/write',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    // Traffic (流量) verbs are owner-scoped: no actor selection, every call is
    // a plain POST to the daemon's /api/traffic/* routes.
    traffic: {
      status: async () => requestJsonForSelectedActor('POST', '/api/traffic/status'),
      getMode: async () => requestJsonForSelectedActor('POST', '/api/traffic/mode', undefined, {}),
      setMode: async (input) => requestJsonForSelectedActor('POST', '/api/traffic/mode', undefined, { mode: input.mode }),
      balance: async () => requestJsonForSelectedActor('POST', '/api/traffic/balance'),
      ledger: async (input) => requestJsonForSelectedActor('POST', '/api/traffic/ledger', undefined, {
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.limit ? { limit: input.limit } : {}),
      }),
      usage: async () => requestJsonForSelectedActor('POST', '/api/traffic/usage'),
      claim: async () => requestJsonForSelectedActor('POST', '/api/traffic/claim'),
      redeem: async (input) => requestJsonForSelectedActor('POST', '/api/traffic/redeem', undefined, { code: input.code }),
      getApiBase: async () => requestJsonForSelectedActor('POST', '/api/traffic/api-base', undefined, { action: 'get' }),
      setApiBase: async (input) => requestJsonForSelectedActor('POST', '/api/traffic/api-base', undefined, {
        action: 'set',
        value: input.apiBase,
      }),
      resetApiBase: async () => requestJsonForSelectedActor('POST', '/api/traffic/api-base', undefined, { action: 'reset' }),
    },
    daemon: {
      start: () => runDaemonStartCommand(context),
      stop: () => runDaemonStopCommand(context),
      restart: async () => {
        const stopResult = await runDaemonStopCommand(context);
        // Restart tolerates "nothing was running"; any real stop failure
        // (stop failed, ownership unverified) propagates untouched.
        if (!stopResult.ok && stopResult.code !== 'daemon_not_running') {
          return stopResult;
        }
        const startResult = await runDaemonStartCommand(context);
        if (!startResult.ok || startResult.state !== 'success') {
          return startResult;
        }
        return commandSuccess({
          ...(startResult.data as Record<string, unknown>),
          restarted: true,
          wasRunning: stopResult.ok,
          previousPid: stopResult.ok
            ? ((stopResult.data as { pid?: number | null }).pid ?? null)
            : null,
        });
      },
    },
    doctor: {
      run: async () => requestJson(context, 'GET', '/api/doctor'),
    },
    identity: {
      create: async (input) => {
        const normalizedName = normalizeEnvText(input.name);
        if (!normalizedName) {
          return commandFailed('missing_name', 'MetaBot identity name is required.');
        }

        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const explicitHomeDir = normalizeEnvText(context.env.METABOT_HOME)
          ? tryNormalizeHomeDir(context.env, context.cwd, {
            allowUnindexedExplicitHome: true,
          })
          : null;
        const twinHomeDir = await resolveTwinHomeDir(systemHomeDir);
        let targetHomeDir: string | null = null;
        if (explicitHomeDir) {
          const explicitState = await createRuntimeStateStore(explicitHomeDir).readState();
          const explicitName = normalizeEnvText(explicitState.identity?.name);
          if (explicitName && explicitName !== normalizedName) {
            return commandFailed(
              'identity_name_conflict',
              `Current local identity is "${explicitName}". Update that profile or choose the same name.`,
            );
          }
          if (explicitState.identity || explicitHomeDir === twinHomeDir) {
            targetHomeDir = explicitHomeDir;
          }
        }

        if (!targetHomeDir) {
          const profiles = await listIdentityProfiles(systemHomeDir);
          const resolvedHome = resolveIdentityCreateProfileHome({
            systemHomeDir,
            requestedName: normalizedName,
            profiles,
          });
          if (resolvedHome.status === 'duplicate') {
            return commandFailed('identity_name_taken', resolvedHome.message);
          }
          targetHomeDir = resolvedHome.homeDir;
        }

        const createInput: Record<string, unknown> = { name: input.name };
        if (input.host) {
          createInput.host = input.host;
        }
        if (targetHomeDir) {
          const profiles = await listIdentityProfiles(systemHomeDir);
          const selectedProfile = profiles.find((profile) => (
            path.resolve(profile.homeDir) === path.resolve(targetHomeDir)
          ));
          if (selectedProfile) {
            createInput.profileSlug = selectedProfile.slug;
          }
        }
        return requestJson(
          cloneContextWithHomeDir(context, targetHomeDir),
          'POST',
          '/api/identity/create',
          createInput,
          {
            allowUnindexedExplicitHome: true,
          },
        );
      },
      who: async () => {
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const twinHomeDir = await resolveTwinHomeDir(systemHomeDir);
        if (!twinHomeDir) {
          return commandFailed(
            'identity_profile_not_initialized',
            'No Twin Bot initialized.'
          );
        }

        const profiles = await listIdentityProfiles(systemHomeDir);
        const twinProfile = profiles.find((profile) => profile.homeDir === twinHomeDir);
        if (!twinProfile) {
          return commandFailed(
            'identity_profile_not_initialized',
            'No Twin Bot initialized.'
          );
        }

        return commandSuccess({
          activeHomeDir: twinHomeDir,
          systemHomeDir,
          identity: {
            name: twinProfile.name,
            slug: twinProfile.slug,
            aliases: twinProfile.aliases,
            globalMetaId: twinProfile.globalMetaId,
            mvcAddress: twinProfile.mvcAddress,
          },
        });
      },
      list: async () => {
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const profiles = await listIdentityProfiles(systemHomeDir);
        const twinHomeDir = await resolveTwinHomeDir(systemHomeDir);
        return commandSuccess({
          systemHomeDir,
          activeHomeDir: twinHomeDir || null,
          profiles,
        });
      },
    },
    network: {
      listServices: async (input) => {
        const query = new URLSearchParams();
        if (input.online !== undefined) {
          query.set('online', input.online ? 'true' : 'false');
        }
        if (typeof input.query === 'string' && input.query.trim()) {
          query.set('query', input.query.trim());
        }
        if (input.cached === true) {
          query.set('cached', 'true');
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJson(context, 'GET', `/api/network/services${suffix}`);
      },
      listBots: async (input) => {
        const query = new URLSearchParams();
        if (input.online !== undefined) {
          query.set('online', input.online ? 'true' : 'false');
        }
        if (typeof input.limit === 'number' && Number.isFinite(input.limit)) {
          query.set('limit', String(Math.max(1, Math.floor(input.limit))));
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJson(context, 'GET', `/api/network/bots${suffix}`);
      },
      listSources: async () => requestJson(context, 'GET', '/api/network/sources'),
      addSource: async (input) => requestJson(context, 'POST', '/api/network/sources', input),
      removeSource: async (input) => requestJson(context, 'DELETE', '/api/network/sources', input),
    },
    services: {
      publish: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/publish',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      listPublishSkills: async (input = {}) => {
        let homeDir = normalizeHomeDir(context.env, context.cwd);
        const requestedFrom = normalizeEnvText(input.from);
        if (requestedFrom) {
          const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
          const profiles = await listIdentityProfiles(systemHomeDir).catch(() => []);
          const resolved = resolveProfileNameMatch(requestedFrom, profiles);
          if (resolved.status === 'not_found') {
            return commandFailed('profile_not_found', resolved.message);
          }
          if (resolved.status === 'ambiguous') {
            return commandFailed('identity_profile_ambiguous', resolved.message);
          }
          homeDir = resolved.match.homeDir;
        }
        const runtimeStateStore = createRuntimeStateStore(homeDir);
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed('identity_missing', 'Create a local MetaBot identity before listing publishable skills.');
        }

        const paths = resolveMetabotPaths(homeDir);
        const metaBotSlug = path.basename(paths.profileRoot);
        const catalog = createPlatformSkillCatalog({
          runtimeStore: createLlmRuntimeStore(paths),
          bindingStore: createLlmBindingStore(paths),
          systemHomeDir: paths.systemHomeDir,
          projectRoot: paths.profileRoot,
          env: context.env,
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
      call: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/call',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      rate: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/rate',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      listOwned: async (input) => {
        const query = new URLSearchParams({
          page: String(input.page),
          pageSize: String(input.pageSize),
          refresh: input.refresh ? 'true' : 'false',
          all: input.all ? 'true' : 'false',
        });
        if (input.from) {
          query.set('from', input.from);
        }
        return requestJsonForSelectedActor(
          'GET',
          `/api/services/owned?${query.toString()}`,
          input.from,
        );
      },
      listOwnedOrders: async (input) => {
        const query = new URLSearchParams({
          serviceId: input.serviceId,
          page: String(input.page),
          pageSize: String(input.pageSize),
          refresh: input.refresh ? 'true' : 'false',
          all: input.all ? 'true' : 'false',
        });
        if (input.from) {
          query.set('from', input.from);
        }
        return requestJsonForSelectedActor(
          'GET',
          `/api/services/owned/orders?${query.toString()}`,
          input.from,
        );
      },
      modifyOwned: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/owned/modify',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      revokeOwned: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/owned/revoke',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      listRefunds: async (input) => {
        const query = new URLSearchParams();
        if (input.from) {
          query.set('from', input.from);
        }
        query.set('all', input.all ? 'true' : 'false');
        query.set('kind', input.kind);
        return requestJsonForSelectedActor(
          'GET',
          `/api/services/refunds?${query.toString()}`,
          input.from,
        );
      },
      syncRefunds: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/refunds/sync',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      settleRefund: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/refunds/settle',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      inspectOrder: async (input) => {
        const query = new URLSearchParams();
        if (input.orderId) {
          query.set('orderId', input.orderId);
        }
        if (input.paymentTxid) {
          query.set('paymentTxid', input.paymentTxid);
        }
        if (input.from) {
          query.set('from', input.from);
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJsonForSelectedActor(
          'GET',
          `/api/services/orders/inspect${suffix}`,
          input.from,
        );
      },
    },
    provider: {
      inspectOrder: async (input) => {
        const query = new URLSearchParams();
        if (input.orderId) {
          query.set('orderId', input.orderId);
        }
        if (input.paymentTxid) {
          query.set('paymentTxid', input.paymentTxid);
        }
        if (input.from) {
          query.set('from', input.from);
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJsonForSelectedActor(
          'GET',
          `/api/services/orders/inspect${suffix}`,
          input.from,
        );
      },
      settleRefund: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/services/refunds/settle',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    chat: {
      private: async (input) => {
        if (context.env[PRIVATE_CHAT_REPLY_GENERATION_ENV] === '1') {
          return commandFailed(
            'private_chat_delivery_owned_by_orchestrator',
            'Private-chat reply generation cannot send messages directly; Open Agent Connect owns delivery.',
          );
        }
        return requestJsonForSelectedActor(
          'POST',
          '/api/chat/private',
          typeof input.from === 'string' ? input.from : undefined,
          input,
        );
      },
      conversations: async (input = {}) => {
        const params = new URLSearchParams();
        if (input.from) params.set('from', input.from);
        const suffix = params.size ? `?${params.toString()}` : '';
        return requestJsonForSelectedActor('GET', `/api/chat/private/conversations${suffix}`, input.from);
      },
      messages: async (input) => {
        const params = new URLSearchParams({ conversationId: input.conversationId });
        if (input.limit != null) params.set('limit', String(input.limit));
        if (input.from) params.set('from', input.from);
        return requestJsonForSelectedActor('GET', `/api/chat/private/messages?${params.toString()}`, input.from);
      },
      autoReplyStatus: async (input = {}) => {
        const params = new URLSearchParams();
        if (input.from) params.set('from', input.from);
        const suffix = params.size ? `?${params.toString()}` : '';
        return requestJsonForSelectedActor('GET', `/api/chat/auto-reply/status${suffix}`, input.from);
      },
      setAutoReply: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/chat/auto-reply/config',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    grouptask: (() => {
      const post = (routePath: string) => async (input: Record<string, unknown>) =>
        requestJsonForSelectedActor('POST', routePath, undefined, input);
      const get = (routePath: string) => async (input: Record<string, unknown>) => {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(input)) {
          if (value == null || value === '') continue;
          params.set(key, String(value));
        }
        const suffix = params.size ? `?${params.toString()}` : '';
        return requestJsonForSelectedActor('GET', `${routePath}${suffix}`, undefined);
      };
      return {
        create: post('/api/grouptask/create'),
        list: get('/api/grouptask/list'),
        detail: get('/api/grouptask/detail'),
        messages: get('/api/grouptask/messages'),
        postMessage: post('/api/grouptask/message'),
        supervise: post('/api/grouptask/supervise'),
        deleteDeliverable: post('/api/grouptask/deliverable/delete'),
        relayDrain: post('/api/grouptask/relay/drain'),
        close: post('/api/grouptask/close'),
        reopen: post('/api/grouptask/reopen'),
        kickMember: post('/api/grouptask/member/kick'),
        setMemberStatus: post('/api/grouptask/member/status'),
        rename: post('/api/grouptask/rename'),
        setPinned: post('/api/grouptask/pin'),
        setArchived: post('/api/grouptask/archive'),
        invite: post('/api/grouptask/invite'),
        invites: get('/api/grouptask/invites'),
        collabs: get('/api/grouptask/collabs'),
        collabMessages: get('/api/grouptask/collab-messages'),
        health: get('/api/grouptask/health'),
        staffingPropose: post('/api/grouptask/staffing/propose'),
        staffingList: get('/api/grouptask/staffing/list'),
        staffingDecide: post('/api/grouptask/staffing/decide'),
        staffingCreate: post('/api/grouptask/staffing/create'),
        staffingSearch: post('/api/grouptask/staffing/search'),
      };
    })(),
    conversations: {
      list: async (input) => {
        const params = new URLSearchParams();
        if (input.local) params.set('local', input.local);
        if (input.limit != null) params.set('limit', String(input.limit));
        const suffix = params.size ? `?${params.toString()}` : '';
        return requestJsonForSelectedActor('GET', `/api/conversations${suffix}`, input.local);
      },
      messages: async (input) => {
        const params = new URLSearchParams();
        if (input.local) params.set('local', input.local);
        if (input.peer) params.set('peer', input.peer);
        if (input.limit != null) params.set('limit', String(input.limit));
        if (input.before != null) params.set('before', String(input.before));
        if (input.after != null) params.set('after', String(input.after));
        const suffix = params.size ? `?${params.toString()}` : '';
        return requestJsonForSelectedActor('GET', `/api/conversations/messages${suffix}`, input.local);
      },
      guidance: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/conversations/guidance',
        input.local,
        { local: input.local, peer: input.peer, guidance: input.guidance },
      ),
    },
    memory: {
      list: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        const entries = await store.list({
          ...(input.scopeKind ? { scopeKind: input.scopeKind as never } : {}),
          ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
          ...(input.usageClass ? { usageClass: input.usageClass as never } : {}),
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.origin ? { origin: input.origin as never } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.includeDeleted ? { includeDeleted: true } : {}),
        });
        return commandSuccess({ entries });
      },
      add: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        const payload = input.payload;
        const memory = await store.create({
          text: String(payload.text ?? ''),
          ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind as never } : {}),
          ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
          ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass as never } : {}),
          ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility as never } : {}),
          ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
          ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
          ...(typeof payload.origin === 'string' ? { origin: payload.origin as never } : {}),
          ...(payload.source && typeof payload.source === 'object' && !Array.isArray(payload.source)
            ? { source: payload.source as MemoryCreateInput['source'] }
            : {}),
        });
        return commandSuccess({ memory });
      },
      update: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        const payload = input.payload;
        const memory = await store.update({
          id: String(payload.id ?? ''),
          ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
          ...(typeof payload.scopeKind === 'string' ? { scopeKind: payload.scopeKind as never } : {}),
          ...(typeof payload.scopeKey === 'string' ? { scopeKey: payload.scopeKey } : {}),
          ...(typeof payload.usageClass === 'string' ? { usageClass: payload.usageClass as never } : {}),
          ...(typeof payload.visibility === 'string' ? { visibility: payload.visibility as never } : {}),
          ...(typeof payload.confidence === 'number' ? { confidence: payload.confidence } : {}),
          ...(typeof payload.isExplicit === 'boolean' ? { isExplicit: payload.isExplicit } : {}),
          ...(typeof payload.status === 'string' ? { status: payload.status as MemoryUpdateInput['status'] } : {}),
        });
        if (!memory) {
          return commandFailed('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
        }
        return commandSuccess({ memory });
      },
      delete: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        const deleted = await store.remove({
          id: String(input.payload.id ?? ''),
          ...(typeof input.payload.scopeKind === 'string' ? { scopeKind: input.payload.scopeKind as never } : {}),
          ...(typeof input.payload.scopeKey === 'string' ? { scopeKey: input.payload.scopeKey } : {}),
        });
        if (!deleted) {
          return commandFailed('not_found', 'Memory entry not found in the resolved scope (or it is protected).');
        }
        return commandSuccess({ deleted: true });
      },
      blocks: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const result = await buildMemoryBlocksForRequest(resolveMetabotPaths(actor.homeDir), {
          channel: typeof input.payload.channel === 'string' ? input.payload.channel : undefined,
          peerGlobalMetaId: typeof input.payload.peerGlobalMetaId === 'string' ? input.payload.peerGlobalMetaId : undefined,
          externalConversationId: typeof input.payload.externalConversationId === 'string'
            ? input.payload.externalConversationId
            : undefined,
          userText: typeof input.payload.userText === 'string' ? input.payload.userText : undefined,
        });
        return commandSuccess({
          xml: result.xml,
          resolutionReason: result.resolution.resolutionReason,
          writeScope: result.resolution.writeScope,
          memoryEnabled: result.policy.memoryEnabled,
        });
      },
      extract: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const result = await applyTurnMemoryExtraction(resolveMetabotPaths(actor.homeDir), {
          userText: String(input.payload.userText ?? ''),
          assistantText: String(input.payload.assistantText ?? ''),
          sessionId: typeof input.payload.sessionId === 'string' ? input.payload.sessionId : undefined,
          channel: typeof input.payload.channel === 'string' ? input.payload.channel : undefined,
          peerGlobalMetaId: typeof input.payload.peerGlobalMetaId === 'string' ? input.payload.peerGlobalMetaId : undefined,
          externalConversationId: typeof input.payload.externalConversationId === 'string'
            ? input.payload.externalConversationId
            : undefined,
          userMessageId: typeof input.payload.userMessageId === 'string' ? input.payload.userMessageId : undefined,
          assistantMessageId: typeof input.payload.assistantMessageId === 'string' ? input.payload.assistantMessageId : undefined,
        });
        return commandSuccess(result as unknown as Record<string, unknown>);
      },
      policyGet: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryPolicyStore(resolveMetabotPaths(actor.homeDir));
        return commandSuccess({
          effective: await store.effectivePolicy(),
          override: await store.readOverride(),
        });
      },
      policySet: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryPolicyStore(resolveMetabotPaths(actor.homeDir));
        const allowed = [
          'memoryEnabled',
          'memoryImplicitUpdateEnabled',
          'memoryLlmJudgeEnabled',
          'memoryGuardLevel',
          'memoryUserMemoriesMaxItems',
          'memoryPromptMaxChars',
          'dreamEnabled',
          'hygieneEnabled',
          'hygiene',
        ] as const;
        const updates: Record<string, unknown> = {};
        for (const key of allowed) {
          if (input.payload[key] !== undefined) updates[key] = input.payload[key];
        }
        const policy = await store.setOverride(updates);
        return commandSuccess({ policy });
      },
      policyDelete: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryPolicyStore(resolveMetabotPaths(actor.homeDir));
        return commandSuccess({ deleted: await store.deleteOverride() });
      },
      scopes: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        return commandSuccess({ scopes: await store.listScopes() });
      },
      stats: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        const stats = await store.stats({
          ...(input.scopeKind ? { scopeKind: input.scopeKind as never } : {}),
          ...(input.scopeKey ? { scopeKey: input.scopeKey } : {}),
        });
        return commandSuccess({ stats });
      },
      transcriptAppend: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        await appendTranscriptTurn(resolveMetabotPaths(actor.homeDir), {
          sessionId: String(input.payload.sessionId ?? ''),
          role: input.payload.role === 'assistant' ? 'assistant' : 'user',
          text: String(input.payload.text ?? ''),
          ts: typeof input.payload.ts === 'number' && Number.isFinite(input.payload.ts)
            ? input.payload.ts
            : Date.now(),
          channel: typeof input.payload.channel === 'string' && input.payload.channel.trim()
            ? input.payload.channel.trim()
            : 'dsh',
          ...(typeof input.payload.turn === 'number' && Number.isFinite(input.payload.turn)
            ? { turn: input.payload.turn }
            : {}),
          ...(typeof input.payload.peerGlobalMetaId === 'string' && input.payload.peerGlobalMetaId.trim()
            ? { peerGlobalMetaId: input.payload.peerGlobalMetaId.trim() }
            : {}),
        });
        return commandSuccess({ appended: true });
      },
      chats: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const chats = await listRecentChats(resolveMetabotPaths(actor.homeDir), {
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.sortOrder ? { sortOrder: input.sortOrder } : {}),
        });
        return commandSuccess({ chats });
      },
      search: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const records = await searchConversations(resolveMetabotPaths(actor.homeDir), {
          query: String(input.payload.query ?? ''),
          ...(typeof input.payload.maxResults === 'number' ? { maxResults: input.payload.maxResults } : {}),
          ...(typeof input.payload.before === 'number' ? { before: input.payload.before } : {}),
          ...(typeof input.payload.after === 'number' ? { after: input.payload.after } : {}),
        });
        return commandSuccess({ records });
      },
      recall: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const dreamStore = createDreamStore(paths);
        const query = resolveExperienceRecallQuery({
          query: typeof input.payload.query === 'string' ? input.payload.query : undefined,
          date_from: typeof input.payload.dateFrom === 'string' ? input.payload.dateFrom : undefined,
          date_to: typeof input.payload.dateTo === 'string' ? input.payload.dateTo : undefined,
          granularity: typeof input.payload.granularity === 'string'
            ? input.payload.granularity as 'day' | 'week' | 'month'
            : undefined,
          ...(typeof input.payload.limit === 'number' ? { limit: input.payload.limit } : {}),
        });
        const summaries = await dreamStore.searchDailySummaries({
          query: query.query,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          limit: query.limit,
        });
        let text: string;
        if (summaries.length > 0) {
          text = formatExperienceRecallResults(summaries.map((summary) => ({
            summaryDate: summary.summaryDate,
            summaryText: summary.summaryText,
            sessionRefs: summary.sessionRefs,
          })), query.granularity);
        } else {
          // Raw-episode timeline fallback so un-dreamed days are never blind.
          const experienceStore = createExperienceStore(paths);
          const fromTime = query.dateFrom ? getDayBoundsMs(query.dateFrom).startMs : undefined;
          const toTime = query.dateTo ? getDayBoundsMs(query.dateTo).endMs : undefined;
          const episodes = await experienceStore.listEpisodes({
            ...(fromTime !== undefined ? { fromTime } : {}),
            ...(toTime !== undefined ? { toTime } : {}),
            limit: 30,
          });
          text = formatExperienceTimelineFallback({
            dateFrom: query.dateFrom,
            dateTo: query.dateTo,
            episodes: episodes.map((episode) => ({
              startedAt: episode.startedAt,
              sourceChannel: episode.sourceChannel,
              episodeType: episode.episodeType,
              title: typeof episode.metadata.title === 'string' ? episode.metadata.title : null,
            })),
          });
        }
        return commandSuccess({ text, summaries, query });
      },
      knowledgeList: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createKnowledgeStore(resolveMetabotPaths(actor.homeDir));
        const entries = await store.listKnowledge({
          ...(input.kind ? { kind: input.kind as never } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.query ? { query: input.query } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        return commandSuccess({ entries });
      },
      knowledgeUpsert: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createKnowledgeStore(resolveMetabotPaths(actor.homeDir));
        const result = await store.upsertKnowledge({
          topic: String(input.payload.topic ?? ''),
          summary: String(input.payload.summary ?? ''),
          ...(typeof input.payload.kind === 'string' ? { kind: input.payload.kind as never } : {}),
          ...(typeof input.payload.category === 'string' ? { category: input.payload.category } : {}),
          ...(Array.isArray(input.payload.tags)
            ? { tags: input.payload.tags.filter((tag): tag is string => typeof tag === 'string') }
            : {}),
          ...(typeof input.payload.origin === 'string' ? { origin: input.payload.origin as never } : {}),
          ...(Array.isArray(input.payload.sources)
            ? { sources: input.payload.sources as never }
            : {}),
        });
        return commandSuccess({
          entry: result.entry,
          created: result.created,
          revised: result.revised,
          text: formatKnowledgeUpsertResult({
            topic: result.entry.topic,
            created: result.created,
            revised: result.revised,
            version: result.entry.version,
            kind: result.entry.kind,
          }),
        });
      },
      knowledgeUpdate: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createKnowledgeStore(resolveMetabotPaths(actor.homeDir));
        const entry = await store.updateKnowledge({
          id: String(input.payload.id ?? ''),
          ...(typeof input.payload.topic === 'string' ? { topic: input.payload.topic } : {}),
          ...(typeof input.payload.summary === 'string' ? { summary: input.payload.summary } : {}),
          ...(typeof input.payload.kind === 'string' ? { kind: input.payload.kind as never } : {}),
        });
        if (!entry) return commandFailed('not_found', 'Knowledge entry not found.');
        return commandSuccess({ entry });
      },
      knowledgeArchive: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createKnowledgeStore(resolveMetabotPaths(actor.homeDir));
        const entry = await store.archiveKnowledge(String(input.payload.id ?? ''));
        if (!entry) return commandFailed('not_found', 'Knowledge entry not found.');
        return commandSuccess({ entry });
      },
      knowledgeDelete: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createKnowledgeStore(resolveMetabotPaths(actor.homeDir));
        const deleted = await store.deleteKnowledge(String(input.payload.id ?? ''));
        if (!deleted) return commandFailed('not_found', 'Knowledge entry not found.');
        return commandSuccess({ deleted: true });
      },
      impressionsList: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const persona = await loadChatPersona(paths);
        const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
        if (!observerGlobalMetaId) {
          return commandFailed('identity_missing', 'No local MetaBot identity is loaded for this profile.');
        }
        const store = createImpressionStore(paths);
        const snapshots = await store.listSnapshots(observerGlobalMetaId);
        const names = await resolveContactNames(paths, snapshots.map((s) => s.subjectGlobalMetaId));
        const rows = snapshots.map((s) => ({
          ...s,
          subjectName: names.get(s.subjectGlobalMetaId) ?? null,
        }));
        return commandSuccess({ observerGlobalMetaId, snapshots: rows });
      },
      impressionsShow: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const persona = await loadChatPersona(paths);
        const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
        if (!observerGlobalMetaId) {
          return commandFailed('identity_missing', 'No local MetaBot identity is loaded for this profile.');
        }
        const store = createImpressionStore(paths);
        const snapshot = await store.getSnapshot(observerGlobalMetaId, input.subject);
        const observations = await store.listObservations({
          observerGlobalMetaId,
          subjectGlobalMetaId: input.subject,
          includeSuperseded: true,
        });
        const names = await resolveContactNames(paths, [input.subject]);
        const namedSnapshot = snapshot
          ? { ...snapshot, subjectName: names.get(input.subject) ?? null }
          : snapshot;
        return commandSuccess({ observerGlobalMetaId, subject: input.subject, snapshot: namedSnapshot, observations });
      },
      hygieneStatus: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const policyStore = createMemoryPolicyStore(paths);
        const hygieneStore = createHygieneStore(paths);
        const [config, ledger, due] = await Promise.all([
          policyStore.getHygieneConfig(),
          hygieneStore.getLedger(),
          memoryHygieneDue(paths),
        ]);
        return commandSuccess({
          config,
          lastRun: ledger.lastRun,
          deepConsolidationLastRunAt: ledger.deepConsolidationLastRunAt,
          due,
        });
      },
      hygieneDue: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        return commandSuccess(await memoryHygieneDue(resolveMetabotPaths(actor.homeDir)));
      },
      hygieneRun: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const slug = path.basename(paths.profileRoot);
        const runtimeResolver = createCliLlmRuntimeResolver(paths);
        const executor = new LlmExecutor({
          sessionsRoot: paths.llmExecutorSessionsRoot,
          transcriptsRoot: paths.llmExecutorTranscriptsRoot,
          skillsRoot: paths.skillsRoot,
          systemHomeDir: paths.systemHomeDir,
          env: context.env,
          backends: createRegistryBackendFactories(),
        });
        // The deep-consolidation call: 180s attempt timeout, JSON-only prompt.
        // No healthy runtime binding = skip (null), never fail; a started run
        // that errors mid-call lands in the run's error list via a throw.
        const complete: MemoryHygieneLlmCompletion = async (request) => {
          const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug: slug });
          if (!resolved.runtime) return null;
          const outcome = await runLlmPromptWithRuntimeFallback({
            runtimeResolver,
            llmExecutor: executor,
            metaBotSlug: slug,
            prompt: request.user,
            systemPrompt: request.system,
            timeoutMs: 180_000,
            pollIntervalMs: 5_000,
          });
          if (outcome.status !== 'completed') {
            throw new Error(outcome.error || `Deep consolidation ended with status ${outcome.status}.`);
          }
          return outcome.output;
        };
        try {
          const stats = await runMemoryHygiene(paths, {
            trigger: 'manual',
            deep: input.noDeep ? false : undefined,
            complete,
          });
          return commandSuccess(stats as unknown as Record<string, unknown>);
        } catch (error) {
          return commandFailed('hygiene_run_failed', error instanceof Error ? error.message : String(error));
        }
      },
      hygieneConfigGet: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryPolicyStore(resolveMetabotPaths(actor.homeDir));
        return commandSuccess({ config: await store.getHygieneConfig() });
      },
      hygieneConfigSet: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createMemoryPolicyStore(resolveMetabotPaths(actor.homeDir));
        const config = await store.setHygieneConfig(input.payload);
        return commandSuccess({ config });
      },
    },
    chainhistory: {
      recordRead: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        await createChainHistoryStore(resolveMetabotPaths(actor.homeDir)).recordRead(input.input);
        return commandSuccess({ recorded: true });
      },
      recall: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createChainHistoryStore(resolveMetabotPaths(actor.homeDir));
        // No date flags: the store applies its 90-day default search window.
        const options: ChainHistorySearchOptions = {
          ...(input.query ? { query: input.query } : {}),
          ...(input.fromDate ? { fromMs: getDayBoundsMs(input.fromDate).startMs } : {}),
          ...(input.toDate ? { toMs: getDayBoundsMs(input.toDate).endMs } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        };
        const [writes, reads] = await Promise.all([
          input.kind === 'read' ? [] : store.searchWrites(options),
          input.kind === 'write' ? [] : store.searchReads(options),
        ]);
        return commandSuccess({
          writes: writes.map((record) => ({
            pinId: record.pinId,
            path: record.path,
            operation: record.operation,
            occurredAtMs: record.occurredAtMs,
            summary: record.summary,
            contentText: record.contentText,
          })),
          reads: reads.map((record) => ({
            pinId: record.pinId,
            path: record.path,
            protocol: record.protocol,
            title: record.title,
            authorGlobalMetaId: record.authorGlobalMetaId,
            savedToKb: record.savedToKb,
            readCount: record.readCount,
            lastReadAtMs: record.lastReadAtMs,
            summary: record.summary,
            contentExcerpt: record.contentExcerpt,
          })),
        });
      },
      summaryPending: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createChainHistoryStore(resolveMetabotPaths(actor.homeDir));
        const rawLimit = typeof input.limit === 'number' && Number.isFinite(input.limit) ? Math.floor(input.limit) : 50;
        const limit = Math.min(200, Math.max(1, rawLimit));
        const [writes, reads] = await Promise.all([
          store.listPendingSummaries('write', limit),
          store.listPendingSummaries('read', limit),
        ]);
        // Writes first, then reads; each kind arrives oldest-first from the store.
        const items = [
          ...writes.map(({ record }) => ({
            kind: 'write' as const,
            pinId: record.pinId,
            path: record.path,
            contentText: record.contentText,
            occurredAtMs: record.occurredAtMs,
          })),
          ...reads.map(({ record }) => ({
            kind: 'read' as const,
            pinId: record.pinId,
            path: record.path,
            protocol: record.protocol,
            title: record.title,
            contentText: record.contentExcerpt,
            occurredAtMs: record.firstReadAtMs,
          })),
        ].slice(0, limit);
        const now = new Date();
        const localMidnightMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const summarizedToday = await store.countSummariesSince(null, localMidnightMs);
        return commandSuccess({ items, summarizedToday });
      },
      summaryApply: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createChainHistoryStore(resolveMetabotPaths(actor.homeDir));
        const applied = await store.applySummaryOutcome(
          input.kind,
          input.pinId,
          input.outcome === 'done'
            ? { status: 'done', summary: input.summary ?? '' }
            : { status: 'failed' },
        );
        return commandSuccess({ applied });
      },
    },
    dream: {
      due: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const due = await dueDreamDates(resolveMetabotPaths(actor.homeDir));
        return commandSuccess(due as unknown as Record<string, unknown>);
      },
      status: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const status = await dreamStatus(resolveMetabotPaths(actor.homeDir));
        return commandSuccess(status as unknown as Record<string, unknown>);
      },
      plan: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        if (!input.date) {
          return commandFailed('missing_flag', '--date is required for dream plan.');
        }
        const limits = parseDreamLimits(input.payload);
        const plan = await planDream(resolveMetabotPaths(actor.homeDir), {
          date: input.date,
          llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
          limits,
        });
        return commandSuccess(plan as unknown as Record<string, unknown>);
      },
      synthesize: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const fragmentOutputs: Record<string, string> = {};
        for (const [key, value] of Object.entries(input.payload.fragmentOutputs as Record<string, unknown>)) {
          if (typeof value === 'string') fragmentOutputs[key] = value;
        }
        const prompt = await synthesizeDream(resolveMetabotPaths(actor.homeDir), {
          date: String(input.payload.date),
          llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
          limits: parseDreamLimits(input.payload),
          fragmentOutputs,
        });
        return commandSuccess(prompt as unknown as Record<string, unknown>);
      },
      commit: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const result = await commitDream(resolveMetabotPaths(actor.homeDir), {
          date: String(input.payload.date),
          outputText: String(input.payload.outputText ?? ''),
          llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
          isRepair: input.payload.isRepair === true,
        });
        if (!result.ok) {
          return commandFailed('dream_commit_failed', result.error ?? 'dream commit failed');
        }
        return commandSuccess(result as unknown as Record<string, unknown>);
      },
      fail: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const result = await failDream(resolveMetabotPaths(actor.homeDir), {
          date: String(input.payload.date),
          error: typeof input.payload.error === 'string' ? input.payload.error : null,
        });
        return commandSuccess(result as unknown as Record<string, unknown>);
      },
      run: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const slug = path.basename(paths.profileRoot);
        const now = new Date();
        const date = input.date ?? formatLocalDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
        const runtimeResolver = createCliLlmRuntimeResolver(paths);
        const executor = new LlmExecutor({
          sessionsRoot: paths.llmExecutorSessionsRoot,
          transcriptsRoot: paths.llmExecutorTranscriptsRoot,
          skillsRoot: paths.skillsRoot,
          systemHomeDir: paths.systemHomeDir,
          env: context.env,
          backends: createRegistryBackendFactories(),
        });
        const complete = async (request: { system: string; user: string; maxOutputTokens: number }): Promise<string> => {
          const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug: slug });
          if (!resolved.runtime) {
            throw new Error(
              'No LLM runtime binding available for this MetaBot. Bind one with "metabot llm" '
              + 'or drive dreams from the DSH plugin (dream plan/commit with ctx.llm).',
            );
          }
          return executor.execute({
            runtimeId: resolved.runtime.id,
            runtime: resolved.runtime,
            prompt: request.user,
            systemPrompt: request.system,
            metaBotSlug: slug,
            timeout: 180_000,
            outputMode: 'final',
          });
        };
        const result = await runDream(paths, {
          date,
          llm: typeof input.payload.llm === 'string' ? input.payload.llm : null,
          limits: parseDreamLimits(input.payload),
          isRepair: input.payload.isRepair === true,
        }, complete);
        if (result.kind === 'failed') {
          return commandFailed('dream_run_failed', result.error ?? 'dream run failed');
        }
        return commandSuccess(result as unknown as Record<string, unknown>);
      },
      summaries: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const dreamStore = createDreamStore(resolveMetabotPaths(actor.homeDir));
        const summaries = await dreamStore.listDailySummaries({
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
          ...(input.before ? { before: input.before } : {}),
        });
        return commandSuccess({ summaries });
      },
      selfIdentity: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const memoryStore = createMemoryStore(resolveMetabotPaths(actor.homeDir));
        const entries = await memoryStore.list({
          usageClass: 'self_identity',
          status: 'created',
          limit: 1,
        });
        return commandSuccess({
          text: entries[0]?.text ?? '',
          updatedAt: entries[0]?.updatedAt ?? null,
        });
      },
    },
    schedule: {
      create: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        try {
          const task = await store.createTask({
            name: input.name,
            prompt: input.prompt,
            schedule: input.schedule,
            ...(input.workingDirectory !== undefined ? { workingDirectory: input.workingDirectory } : {}),
            ...(input.channel !== undefined ? { channel: input.channel } : {}),
            ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
            ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
          });
          return commandSuccess({ task } as unknown as Record<string, unknown>);
        } catch (error) {
          return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
        }
      },
      list: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const tasks = await store.listTasks();
        return commandSuccess({ tasks } as unknown as Record<string, unknown>);
      },
      show: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const task = await store.getTask(input.id);
        if (!task) return commandFailed('task_not_found', `Scheduled task not found: ${input.id}`);
        return commandSuccess({ task } as unknown as Record<string, unknown>);
      },
      update: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        try {
          const result = await store.updateTask(input.id, input.payload);
          if ('notFound' in result) {
            return commandFailed('task_not_found', `Scheduled task not found: ${input.id}`);
          }
          return commandSuccess({ task: result.task, warnings: result.warnings } as unknown as Record<string, unknown>);
        } catch (error) {
          return commandFailed('invalid_argument', error instanceof Error ? error.message : String(error));
        }
      },
      delete: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const result = await store.deleteTask(input.id);
        if (!result.deleted) {
          return commandFailed('task_not_found', `Scheduled task not found: ${input.id}`);
        }
        return commandSuccess({ deleted: true } as unknown as Record<string, unknown>);
      },
      enable: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const result = await store.setEnabled(input.id, true);
        if ('notFound' in result) {
          return commandFailed('task_not_found', `Scheduled task not found: ${input.id}`);
        }
        return commandSuccess({ task: result.task, warnings: result.warnings } as unknown as Record<string, unknown>);
      },
      disable: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const result = await store.setEnabled(input.id, false);
        if ('notFound' in result) {
          return commandFailed('task_not_found', `Scheduled task not found: ${input.id}`);
        }
        return commandSuccess({ task: result.task, warnings: result.warnings } as unknown as Record<string, unknown>);
      },
      run: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const slug = path.basename(paths.profileRoot);
        const runtimeResolver = createCliLlmRuntimeResolver(paths);
        const executor = new LlmExecutor({
          sessionsRoot: paths.llmExecutorSessionsRoot,
          transcriptsRoot: paths.llmExecutorTranscriptsRoot,
          skillsRoot: paths.skillsRoot,
          systemHomeDir: paths.systemHomeDir,
          env: context.env,
          backends: createRegistryBackendFactories(),
        });
        const result = await runScheduledTask(paths, {
          taskId: input.id,
          trigger: 'manual',
          executor: 'cli',
        }, {
          runLlm: async (turn) => {
            const outcome = await runLlmPromptWithRuntimeFallback({
              runtimeResolver,
              llmExecutor: executor,
              metaBotSlug: slug,
              prompt: turn.prompt,
              systemPrompt: turn.systemPrompt,
              timeoutMs: 30 * 60_000,
              pollIntervalMs: 5_000,
            });
            if (outcome.status !== 'completed') {
              return {
                ok: false,
                error: outcome.error || `Scheduled task execution ended with status ${outcome.status}.`,
              };
            }
            return { ok: true, output: outcome.output };
          },
        });
        if (result.kind === 'already_running') {
          return commandFailed('already_running', `Scheduled task is already running: ${input.id}`);
        }
        if (result.kind === 'failed') {
          return commandFailed('schedule_run_failed', result.error);
        }
        return commandSuccess({ taskId: input.id, output: result.output } as unknown as Record<string, unknown>);
      },
      runs: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const runs = await store.listRuns({
          ...(input.id ? { taskId: input.id } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        return commandSuccess({ runs } as unknown as Record<string, unknown>);
      },
      due: async (input) => {
        if (input.all) {
          const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
          const profiles = await listMetabotProfiles(systemHomeDir).catch(() => []);
          const due = [];
          for (const profile of profiles) {
            const store = createScheduleStore(resolveMetabotPaths(profile.homeDir));
            const tasks = await store.listDue();
            if (tasks.length > 0) due.push({ slug: profile.slug, tasks });
          }
          return commandSuccess({ due } as unknown as Record<string, unknown>);
        }
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const tasks = await store.listDue();
        const slug = path.basename(resolveMetabotPaths(actor.homeDir).profileRoot);
        return commandSuccess({ due: [{ slug, tasks }] } as unknown as Record<string, unknown>);
      },
      claim: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const executor: ScheduleRunExecutor = input.executor ?? 'host';
        const result = await store.claim(input.id, { trigger: 'scheduled', executor });
        if (!result.ok) {
          if (result.code === 'task_not_found') {
            return commandFailed('task_not_found', `Scheduled task not found: ${input.id}`);
          }
          if (result.code === 'task_expired') {
            return commandFailed('task_expired', `Scheduled task has expired: ${input.id}`);
          }
          return commandFailed('already_running', `Scheduled task is already running: ${input.id}`);
        }
        return commandSuccess({ run: result.run, task: result.task } as unknown as Record<string, unknown>);
      },
      complete: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createScheduleStore(resolveMetabotPaths(actor.homeDir));
        const result = await store.complete(input.runId, {
          ...(input.error !== undefined ? { error: input.error } : {}),
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        });
        if ('notFound' in result) {
          return commandFailed('task_run_not_found', `Scheduled task run not found: ${input.runId}`);
        }
        return commandSuccess({ settled: result.settled, run: result.run, task: result.task } as unknown as Record<string, unknown>);
      },
    },
    file: {
      upload: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/file/upload',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
      uploadLarge: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/file/upload-large',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    wallet: {
      balance: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const runtimeStateStore = createRuntimeStateStore(homeDir);
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed(
            'identity_missing',
            'No local MetaBot identity is loaded for the current active home.'
          );
        }

        const adapters = createDefaultChainAdapterRegistry();
        return queryWalletBalances({
          identity: state.identity,
          adapters,
          chain: input.chain,
        });
      },
      transfer: async (input) => {
        return runWalletTransferRuntime(context, input);
      },
    },
    trace: {
      get: async (input) => {
        const query = new URLSearchParams();
        if (input.from) query.set('from', input.from);
        const suffix = query.size ? `?${query.toString()}` : '';
        return input.sessionId
          ? requestJsonForSelectedActor('GET', `/api/trace/sessions/${encodeURIComponent(input.sessionId)}${suffix}`, input.from)
          : requestJsonForSelectedActor('GET', `/api/trace/${encodeURIComponent(input.traceId || '')}${suffix}`, input.from);
      },
      watch: async (input) => {
        const query = new URLSearchParams();
        if (input.from) query.set('from', input.from);
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestTextForSelectedActor('GET', `/api/trace/${encodeURIComponent(input.traceId)}/watch${suffix}`, input.from);
      },
      listSessions: async (input) => {
        const query = new URLSearchParams({
          all: input.all ? 'true' : 'false',
          limit: String(input.limit),
        });
        if (input.from) query.set('from', input.from);
        return requestJsonForSelectedActor('GET', `/api/trace/sessions?${query.toString()}`, input.from);
      },
    },
    ui: {
      open: async (input) => openLocalUiPage(input),
    },
    skills: {
      resolve: async (input) => {
        let rendered: Awaited<ReturnType<typeof renderSkillContractWithOnlineServiceContext>>;
        try {
          rendered = await renderSkillContractWithOnlineServiceContext({
            context,
            skill: input.skill,
            host: input.host as ConcreteSkillHost | undefined,
            format: input.format as SkillRenderFormat,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/^Unknown base skill contract:/.test(message)) {
            return commandFailed('unknown_skill', message);
          }
          throw error;
        }
        if (rendered.format === 'markdown') {
          return commandSuccess(rendered.markdown);
        }
        return commandSuccess(rendered);
      },
      install: async (input) => runSkillsInstall(input),
      publish: async (input) => runSkillsPublish(input),
      list: async () => runSkillsList(),
      read: async (input) => runSkillsRead(input),
      uninstall: async (input) => runSkillsUninstall(input),
    },
    host: {
      bindSkills: async (input) => {
        try {
          const result = await bindHostSkills({
            systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
            host: input.host,
            env: context.env,
          });
          return commandSuccess(result);
        } catch (error) {
          if (error instanceof HostSkillBindingError) {
            return {
              ok: false,
              state: 'failed',
              code: error.code,
              message: error.message,
              data: error.data,
            } as MetabotCommandResult<unknown>;
          }
          return commandFailed(
            'host_skill_bind_failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      },
      bindPersona: async (input) => runHostPersonaProjection(() => bindHostPersonaProjection({
        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
        host: input.host,
        from: input.from,
        env: context.env,
      })),
      personaStatus: async (input) => runHostPersonaProjection(() => getHostPersonaProjectionStatus({
        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
        host: input.host,
        from: input.from,
        env: context.env,
      })),
      unbindPersona: async (input) => runHostPersonaProjection(() => unbindHostPersonaProjection({
        systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
        host: input.host,
        from: input.from,
        env: context.env,
      })),
    },
    system: {
      update: async (input) => {
        try {
          const result = await runSystemUpdate({
            systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
            host: input.host,
            version: input.version,
            dryRun: input.dryRun,
            env: context.env,
          });
          return commandSuccess(result);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error) {
            const coded = error as { code: string; message?: string; manualActionRequired?: boolean };
            if (coded.manualActionRequired) {
              return commandManualActionRequired(coded.code, coded.message || 'Manual action required.');
            }
            return commandFailed(coded.code, coded.message || 'System update failed.');
          }
          return commandFailed(
            'system_update_failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      },
      uninstall: async (input) => {
        try {
          const result = await runSystemUninstall({
            systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
            all: input.all,
            confirmToken: input.confirmToken,
            env: context.env,
          });
          return commandSuccess(result);
        } catch (error) {
          if (error && typeof error === 'object' && 'code' in error) {
            const coded = error as { code: string; message?: string; manualActionRequired?: boolean };
            if (coded.manualActionRequired) {
              return commandManualActionRequired(coded.code, coded.message || 'Manual action required.');
            }
            return commandFailed(coded.code, coded.message || 'System uninstall failed.');
          }
          return commandFailed(
            'system_uninstall_failed',
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    },
    llm: {
      listRuntimes: async () => requestJson(context, 'GET', '/api/llm/runtimes'),
      discoverRuntimes: async () => requestJson(context, 'POST', '/api/llm/runtimes/discover'),
      listBindings: async (input = {}) => {
        const actor = await resolveActorProfileSlug(context, input);
        if (!('slug' in actor)) return actor;
        return requestJsonForSelectedActor('GET', `/api/llm/bindings/${encodeURIComponent(actor.slug)}`, input.from);
      },
      upsertBindings: async (input) => {
        const actor = await resolveActorProfileSlug(context, input);
        if (!('slug' in actor)) return actor;
        const bindings = input.bindings.map((binding) => {
          const runtimeId = typeof binding.llmRuntimeId === 'string' ? normalizeEnvText(binding.llmRuntimeId) : '';
          const role = typeof binding.role === 'string' ? normalizeEnvText(binding.role) : '';
          const existingId = typeof binding.id === 'string' ? normalizeEnvText(binding.id) : '';
          const id = existingId || (runtimeId && role ? `lb_${actor.slug}_${runtimeId}_${role}` : '');
          return {
            ...binding,
            id,
            metaBotSlug: actor.slug,
          };
        });
        return requestJsonForSelectedActor(
          'PUT',
          `/api/llm/bindings/${encodeURIComponent(actor.slug)}`,
          input.from,
          { bindings },
        );
      },
      removeBinding: async (input) => {
        const actor = await resolveActorProfileSlug(context, { from: input.from });
        if (!('slug' in actor)) return actor;
        const query = new URLSearchParams({ from: actor.slug });
        return requestJsonForSelectedActor(
          'DELETE',
          `/api/llm/bindings/${encodeURIComponent(input.bindingId)}/delete?${query.toString()}`,
          input.from,
        );
      },
      getPreferredRuntime: async (input = {}) => {
        const actor = await resolveActorProfileSlug(context, input);
        if (!('slug' in actor)) return actor;
        return requestJsonForSelectedActor('GET', `/api/llm/preferred-runtime/${encodeURIComponent(actor.slug)}`, input.from);
      },
      setPreferredRuntime: async (input) => {
        const actor = await resolveActorProfileSlug(context, input);
        if (!('slug' in actor)) return actor;
        return requestJsonForSelectedActor(
          'PUT',
          `/api/llm/preferred-runtime/${encodeURIComponent(actor.slug)}`,
          input.from,
          { runtimeId: input.runtimeId },
        );
      },
    },
    bot: {
      listProfiles: async () => requestJson(context, 'GET', '/api/bot/profiles'),
      getProfile: async (input) =>
        requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}`),
      createProfile: async (input) => requestJson(context, 'POST', '/api/bot/profiles', input),
      updateProfile: async (input) => {
        const { slug, ...body } = input;
        return requestJson(context, 'PUT', `/api/bot/profiles/${encodeURIComponent(slug)}`, body);
      },
      deleteProfile: async (input) =>
        requestJson(context, 'DELETE', `/api/bot/profiles/${encodeURIComponent(input.slug)}`),
      getConfig: async (input) =>
        requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}/config`),
      setConfig: async (input) => {
        const { slug, ...body } = input;
        return requestJson(context, 'PUT', `/api/bot/profiles/${encodeURIComponent(slug)}/config`, body);
      },
      getWallet: async (input) =>
        requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}/wallet`),
      getBackup: async (input) =>
        requestJson(context, 'GET', `/api/bot/profiles/${encodeURIComponent(input.slug)}/backup`),
      listRuntimes: async (input = {}) => {
        const query = new URLSearchParams();
        if (input.from) query.set('from', input.from);
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJsonForSelectedActor('GET', `/api/bot/runtimes${suffix}`, input.from);
      },
      discoverRuntimes: async (input = {}) => {
        const query = new URLSearchParams();
        if (input.from) query.set('from', input.from);
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJsonForSelectedActor('POST', `/api/bot/runtimes/discover${suffix}`, input.from);
      },
      listSessions: async (input) => {
        const query = new URLSearchParams({ limit: String(input.limit) });
        if (input.slug) query.set('slug', input.slug);
        return requestJson(context, 'GET', `/api/bot/sessions?${query.toString()}`);
      },
      bindOwner: async (input) => {
        let ownerGlobalMetaId = typeof input.ownerGlobalMetaId === 'string' && input.ownerGlobalMetaId.trim()
          ? input.ownerGlobalMetaId.trim()
          : '';
        if (!input.unbind && !ownerGlobalMetaId) {
          // Default owner: the local human owner identity first, then the
          // Twin Bot identity as a fallback.
          const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
          const ownerIdentity = await readOwnerIdentity(systemHomeDir).catch(() => null);
          ownerGlobalMetaId = ownerIdentity?.globalMetaId?.trim() ?? '';
          if (!ownerGlobalMetaId) {
            const [profiles, twinHomeDir] = await Promise.all([
              listIdentityProfiles(systemHomeDir).catch(() => []),
              resolveTwinHomeDir(systemHomeDir),
            ]);
            const twin = profiles.find((profile) => profile.homeDir === twinHomeDir);
            ownerGlobalMetaId = twin?.globalMetaId?.trim() ?? '';
          }
          if (!ownerGlobalMetaId) {
            return commandFailed(
              'identity_unavailable',
              'No local owner identity or Twin Bot with a GlobalMetaID. Pass --owner <globalMetaId> explicitly.',
            );
          }
        }
        return requestJson(
          context,
          'PUT',
          `/api/bot/profiles/${encodeURIComponent(input.slug)}`,
          { ownerGlobalMetaId: input.unbind ? null : ownerGlobalMetaId },
        );
      },
    },
    knowledgeBase: {
      list: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const service = createKnowledgeBaseService(resolveMetabotPaths(actor.homeDir));
        const knowledgeBases = await service.store.listKnowledgeBases();
        return commandSuccess({ knowledgeBases });
      },
      create: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const service = createKnowledgeBaseService(paths);
        const knowledgeBase = await service.store.createKnowledgeBase({
          metabotSlug: path.basename(paths.profileRoot),
          name: input.name,
          ...(input.description ? { description: input.description } : {}),
          ...(input.rawDir ? { rawDir: input.rawDir } : {}),
          ...(input.autoLearn !== undefined ? { autoLearn: input.autoLearn } : {}),
        });
        return commandSuccess({ knowledgeBase });
      },
      update: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const service = createKnowledgeBaseService(paths);
        const slug = path.basename(paths.profileRoot);
        const existing = await service.store.getKnowledgeBase(input.id);
        if (!existing || existing.metabotSlug !== slug) {
          return commandFailed('kb_not_found', `Knowledge base ${input.id} not found for this Bot.`);
        }
        const knowledgeBase = await service.store.updateKnowledgeBase(input.id, {
          ...(input.name ? { name: input.name } : {}),
          ...(input.description ? { description: input.description } : {}),
          ...(input.autoLearn !== undefined ? { autoLearn: input.autoLearn } : {}),
        });
        return commandSuccess({ knowledgeBase });
      },
      remove: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const paths = resolveMetabotPaths(actor.homeDir);
        const service = createKnowledgeBaseService(paths);
        const slug = path.basename(paths.profileRoot);
        const existing = await service.store.getKnowledgeBase(input.id);
        if (!existing || existing.metabotSlug !== slug) {
          return commandFailed('kb_not_found', `Knowledge base ${input.id} not found for this Bot.`);
        }
        const removed = await service.store.removeKnowledgeBase(input.id);
        return commandSuccess({ removed, knowledgeBaseId: input.id });
      },
      query: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const service = createKnowledgeBaseService(resolveMetabotPaths(actor.homeDir));
        const results = await service.queryKnowledgeBase(
          path.basename(resolveMetabotPaths(actor.homeDir).profileRoot),
          input.text,
          {
            ...(input.id ? { knowledgeBaseId: input.id } : {}),
            ...(input.topK != null ? { topK: input.topK } : {}),
            ...(input.minScore != null ? { minScore: input.minScore } : {}),
          },
        );
        return commandSuccess({ results });
      },
      addDocument: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const service = createKnowledgeBaseService(resolveMetabotPaths(actor.homeDir));
        const saved = await service.addDocument(
          path.basename(resolveMetabotPaths(actor.homeDir).profileRoot),
          {
            title: input.title,
            content: input.content,
            ...(input.id ? { knowledgeBaseId: input.id } : {}),
            ...(input.sourceType ? { sourceType: input.sourceType as 'web' | 'metaweb' | 'manual' } : {}),
            ...(input.url ? { url: input.url } : {}),
            ...(input.pinId ? { pinId: input.pinId } : {}),
            ...(input.tags ? { tags: input.tags } : {}),
          },
        );
        return commandSuccess({ knowledgeBase: saved.knowledgeBase, relPath: saved.relPath });
      },
      learn: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const service = createKnowledgeBaseService(resolveMetabotPaths(actor.homeDir));
        const knowledgeBase = await service.learnKnowledgeBase(
          path.basename(resolveMetabotPaths(actor.homeDir).profileRoot),
          input.id,
          input.full === true,
        );
        return commandSuccess({ knowledgeBase });
      },
    },
    twin: {
      current: async () => {
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const twinSlug = await resolveCurrentTwinSlug(systemHomeDir);
        return commandSuccess({ twinSlug });
      },
      workers: async (input) => {
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        let twinSlug = input.from?.trim() ?? '';
        if (!twinSlug) {
          twinSlug = await resolveCurrentTwinSlug(systemHomeDir) ?? '';
        }
        if (!twinSlug) {
          return commandFailed('twin_not_found', 'No Twin Bot exists yet. Designate one with: metabot bot update --from <bot-slug> --payload-file <file> (payload: {"botType":"twin"}).');
        }
        const roster = await buildTwinWorkerRoster(systemHomeDir, twinSlug);
        return commandSuccess({
          twinSlug,
          workers: roster,
          rosterBlock: formatTwinWorkerRosterBlock(roster),
        });
      },
      tasksCreate: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createOrchestrationStore(resolveMetabotPaths(actor.homeDir));
        const payload = input.payload;
        const task = await store.createTask({
          title: String(payload.title ?? ''),
          goal: typeof payload.goal === 'string' ? payload.goal : '',
          ...(typeof payload.intent === 'string' ? { intent: payload.intent } : {}),
          ...(typeof payload.ownerGlobalMetaId === 'string' ? { ownerGlobalMetaId: payload.ownerGlobalMetaId } : {}),
          ...(Array.isArray(payload.steps)
            ? {
              steps: (payload.steps as Array<Record<string, unknown>>).map((step) => ({
                workerSlug: String(step.workerSlug ?? ''),
                objective: typeof step.objective === 'string' ? step.objective : '',
                ...(Array.isArray(step.acceptanceCriteria)
                  ? { acceptanceCriteria: step.acceptanceCriteria.filter((item): item is string => typeof item === 'string') }
                  : {}),
                ...(step.permissionScope && typeof step.permissionScope === 'object' && !Array.isArray(step.permissionScope)
                  ? { permissionScope: step.permissionScope as Record<string, unknown> }
                  : {}),
                ...(Array.isArray(step.dependsOn)
                  ? { dependsOn: step.dependsOn.filter((item): item is string => typeof item === 'string') }
                  : {}),
                ...(typeof step.idempotencyKey === 'string' ? { idempotencyKey: step.idempotencyKey } : {}),
              })),
            }
            : {}),
        });
        return commandSuccess({ task });
      },
      tasksList: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createOrchestrationStore(resolveMetabotPaths(actor.homeDir));
        const tasks = await store.listTasks({
          ...(input.status ? { status: input.status as never } : {}),
          ...(input.limit !== undefined ? { limit: input.limit } : {}),
        });
        return commandSuccess({ tasks });
      },
      tasksShow: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createOrchestrationStore(resolveMetabotPaths(actor.homeDir));
        const task = await store.getTask(input.taskId);
        if (!task) return commandFailed('not_found', `Orchestration task not found: ${input.taskId}`);
        return commandSuccess({ task });
      },
      tasksUpdate: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createOrchestrationStore(resolveMetabotPaths(actor.homeDir));
        const payload = input.payload;
        const taskId = String(payload.taskId ?? '');
        if (payload.taskStatus) {
          const task = await store.updateTaskStatus(taskId, payload.taskStatus as never);
          if (!task) return commandFailed('not_found', `Orchestration task not found: ${taskId}`);
          return commandSuccess({ task });
        }
        if (payload.markNotified === true && payload.stepId && payload.attemptId) {
          await store.markAttemptNotified(taskId, String(payload.stepId), String(payload.attemptId));
          return commandSuccess({ notified: true });
        }
        if (payload.newAttempt === true && payload.stepId) {
          const attempt = await store.addAttempt(taskId, String(payload.stepId), {
            ...(typeof payload.dshSessionId === 'string' ? { dshSessionId: payload.dshSessionId } : {}),
          });
          if (!attempt) return commandFailed('not_found', 'Orchestration step not found.');
          return commandSuccess({ attempt });
        }
        if (payload.stepId && payload.attemptId) {
          const attempt = await store.updateAttempt(taskId, String(payload.stepId), String(payload.attemptId), {
            ...(typeof payload.attemptStatus === 'string' ? { status: payload.attemptStatus as never } : {}),
            ...(typeof payload.dshSessionId === 'string' ? { dshSessionId: payload.dshSessionId } : {}),
            ...(typeof payload.handoff === 'string' ? { handoff: payload.handoff } : {}),
            ...(typeof payload.error === 'string' ? { error: payload.error } : {}),
          });
          if (!attempt) return commandFailed('not_found', 'Orchestration attempt not found.');
          return commandSuccess({ attempt });
        }
        if (payload.stepId) {
          const step = await store.updateStep(taskId, String(payload.stepId), {
            ...(typeof payload.stepStatus === 'string' ? { status: payload.stepStatus as never } : {}),
            ...(typeof payload.workerSlug === 'string' ? { workerSlug: payload.workerSlug } : {}),
          });
          if (!step) return commandFailed('not_found', 'Orchestration step not found.');
          return commandSuccess({ step });
        }
        return commandFailed('invalid_payload', 'payload must carry taskStatus, stepId(+attemptId), or markNotified.');
      },
      tasksPendingNotify: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const store = createOrchestrationStore(resolveMetabotPaths(actor.homeDir));
        const pending = await store.listUnnotifiedTerminalAttempts();
        return commandSuccess({
          pending: pending.map(({ task, step, attempt }) => ({
            taskId: task.id,
            taskTitle: task.title,
            taskStatus: task.status,
            stepId: step.id,
            workerSlug: step.workerSlug,
            attemptId: attempt.id,
            attemptStatus: attempt.status,
            handoff: attempt.handoff,
            error: attempt.error,
            endedAt: attempt.endedAt,
          })),
        });
      },
    },
  };
}

export function mergeCliDependencies(context: CliRuntimeContext): CliDependencies {
  const defaults = createDefaultCliDependencies(context);
  const provided = context.dependencies;
  return {
    config: { ...defaults.config, ...provided.config },
    buzz: { ...defaults.buzz, ...provided.buzz },
    browser: { ...defaults.browser, ...provided.browser },
    metaapp: { ...defaults.metaapp, ...provided.metaapp },
    metaid: { ...defaults.metaid, ...provided.metaid },
    metaweb: { ...defaults.metaweb, ...provided.metaweb },
    simplenote: { ...defaults.simplenote, ...provided.simplenote },
    chain: { ...defaults.chain, ...provided.chain },
    traffic: { ...defaults.traffic, ...provided.traffic },
    daemon: { ...defaults.daemon, ...provided.daemon },
    doctor: { ...defaults.doctor, ...provided.doctor },
    identity: { ...defaults.identity, ...provided.identity },
    network: { ...defaults.network, ...provided.network },
    services: { ...defaults.services, ...provided.services },
    provider: { ...defaults.provider, ...provided.provider },
    chat: { ...defaults.chat, ...provided.chat },
    grouptask: { ...defaults.grouptask, ...provided.grouptask },
    conversations: { ...defaults.conversations, ...provided.conversations },
    memory: { ...defaults.memory, ...provided.memory },
    chainhistory: { ...defaults.chainhistory, ...provided.chainhistory },
    dream: { ...defaults.dream, ...provided.dream },
    knowledgeBase: { ...defaults.knowledgeBase, ...provided.knowledgeBase },
    schedule: { ...defaults.schedule, ...provided.schedule },
    twin: { ...defaults.twin, ...provided.twin },
    file: { ...defaults.file, ...provided.file },
    wallet: { ...defaults.wallet, ...provided.wallet },
    trace: { ...defaults.trace, ...provided.trace },
    ui: { ...defaults.ui, ...provided.ui },
    skills: { ...defaults.skills, ...provided.skills },
    host: { ...defaults.host, ...provided.host },
    system: { ...defaults.system, ...provided.system },
    llm: { ...defaults.llm, ...provided.llm },
    bot: { ...defaults.bot, ...provided.bot },
  };
}

export async function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never> {
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const homeDir = normalizeHomeDir(context.env, context.cwd, {
    allowUnindexedExplicitHome: context.env[ALLOW_UNINDEXED_HOME_ENV] === '1',
  });
  const paths = resolveMetabotPaths(homeDir);
  const daemonPaths = resolveMetabotDaemonPaths(systemHomeDir);
  const infrastructureConfigStore = createInfrastructureConfigStore(daemonPaths);
  const daemonStore = createDaemonStateStore(daemonPaths);
  let daemonRecord: GlobalDaemonRecord | null = null;
  const secretStore = createFileSecretStore(homeDir);
  const adapters = createDefaultChainAdapterRegistry();
  // Traffic mode (代付): one account service per daemon process, shared by
  // every signer created here and by the daemon handlers' upload wiring.
  const trafficAccountService = createTrafficAccountService({ systemHomeDir });
  const resolveSponsorWritePin = createTrafficSponsorWritePinResolver({ trafficAccountService });
  const baseSigner = createLocalMnemonicSigner({ secretStore, adapters, resolveSponsorWritePin });
  const signer = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
    ? createTestChainWriteSigner(baseSigner)
    : baseSigner;
  const requestMvcGasSubsidy = context.env[TEST_FAKE_SUBSIDY_ENV] === '1'
    ? createTestSubsidyRequester()
    : undefined;
  const fetchPeerChatPublicKey = createTestProviderChatPublicKeyFetcher(context.env);
  const resolvePeerChatPublicKey = createPeerChatPublicKeyResolver({
    systemHomeDir: paths.systemHomeDir,
    fetchPeerChatPublicKey,
    chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
  });
  const callerReplyWaiter = createTestMetaWebReplyWaiter(context.env);
  const servicePaymentExecutor = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
    ? createTestServicePaymentExecutor()
    : undefined;
  const socketPresenceApiBaseUrl = context.env.METABOT_SOCKET_PRESENCE_API_BASE_URL
    || (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 'http://127.0.0.1:9' : undefined);

  const persistedAutoReplyConfig = await createConfigStore(paths).read().then(
    (config) => config.autoReply,
    () => null,
  );
  const sharedAutoReplyConfig = {
    enabled: persistedAutoReplyConfig ? persistedAutoReplyConfig.enabled : true,
    acceptPolicy: 'accept_all' as const,
    defaultStrategyId: null as string | null,
    maxTurns: persistedAutoReplyConfig ? persistedAutoReplyConfig.maxTurns : DEFAULT_AUTO_REPLY_MAX_TURNS,
    cooldownMs: persistedAutoReplyConfig ? persistedAutoReplyConfig.cooldownMs : DEFAULT_AUTO_REPLY_COOLDOWN_MS,
  };
  const providerLlmBackends = createRegistryBackendFactories();
  const fakeProviderLlmReply = normalizeEnvText(context.env[TEST_FAKE_PROVIDER_LLM_REPLY_ENV]);
  const useFakeProviderLlm = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' && Boolean(fakeProviderLlmReply);
  if (useFakeProviderLlm) {
    for (const provider of Object.keys(providerLlmBackends)) {
      providerLlmBackends[provider] = () => ({
        provider,
        async execute(request) {
          return {
            status: 'completed',
            output: fakeProviderLlmReply
              .replace(/\{\{prompt\}\}/g, request.prompt)
              .replace(/\{\{skill\}\}/g, request.skills?.[0] ?? ''),
            durationMs: 1,
          };
        },
      });
    }
  }

  const llmExecutor = new LlmExecutor({
    sessionsRoot: paths.llmExecutorSessionsRoot,
    transcriptsRoot: paths.llmExecutorTranscriptsRoot,
    skillsRoot: paths.skillsRoot,
    systemHomeDir: paths.systemHomeDir,
    env: context.env,
    backends: providerLlmBackends,
  });
  const daemonMetaBotSlug = path.basename(paths.profileRoot);
  const daemonRuntimeResolver = createLlmRuntimeResolver({
    runtimeStore: createLlmRuntimeStore(paths),
    bindingStore: createLlmBindingStore(paths),
    getPreferredRuntimeId: async () => {
      try {
        const raw = await fs.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
        const data = JSON.parse(raw) as { runtimeId?: string | null };
        return typeof data.runtimeId === 'string' ? data.runtimeId : null;
      } catch {
        return null;
      }
    },
  });
  const buyerRatingHostReplyRunner = createHostLlmChatReplyRunner({
    runtimeResolver: daemonRuntimeResolver,
    llmExecutor,
    metaBotSlug: daemonMetaBotSlug,
  });
  const buyerRatingReplyRunner = createTestBuyerRatingReplyRunner(context.env) ?? buyerRatingHostReplyRunner;
  const orderProtocolTextGenerator = createLlmOrderProtocolTextGenerator({
    llmExecutor,
    timeoutMs: 45_000,
  });
  let pendingA2ASimplemsgRefreshAfterIdentityRegistration = false;
  let refreshA2ASimplemsgListenerAfterIdentityRegistration: () => Promise<void> = async () => {
    pendingA2ASimplemsgRefreshAfterIdentityRegistration = true;
  };
  let refreshA2ASimplemsgListenerAfterInfrastructureChange: () => Promise<void> = async () => {};
  let onProviderPresenceChanged: (enabled: boolean) => Promise<void> = async () => {};

  // Scheduled-task host leases + per-profile store instances shared by the
  // daemon tick and the /api/schedule/* handlers: claim/complete mutate the
  // same store instance (serialized write queue) the tick uses, so a host
  // claim can never race the daemon's own tick.
  const scheduleStores = new Map<string, ReturnType<typeof createScheduleStore>>();
  const scheduleStoreFor = (profileHomeDir: string): ReturnType<typeof createScheduleStore> => {
    const resolvedHomeDir = path.resolve(profileHomeDir);
    let store = scheduleStores.get(resolvedHomeDir);
    if (!store) {
      store = createScheduleStore(resolveMetabotPaths(resolvedHomeDir));
      scheduleStores.set(resolvedHomeDir, store);
    }
    return store;
  };
  const scheduleHostLeases = new Map<string, { host: string; expiresAtMs: number }>();

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => daemonRecord,
    secretStore,
    signer,
    adapters,
    trafficAccountService,
    chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
    socketPresenceApiBaseUrl,
    socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
      ? 'assume_service_providers_online'
      : 'throw',
    identitySyncStepDelayMs: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 0 : undefined,
    fetchPeerChatPublicKey: resolvePeerChatPublicKey,
    callerReplyWaiter,
    buyerRatingReplyRunner,
    buyerRatingTextGenerator: orderProtocolTextGenerator.generateBuyerRatingText,
    callerOrderTextGenerator: orderProtocolTextGenerator.generateCallerOrderText,
    providerOrderTextGenerator: orderProtocolTextGenerator.generateProviderOrderText,
    servicePaymentExecutor,
    serviceOrderPaymentVerifier: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
      ? async (verificationInput) => ({
        verified: true,
        outcome: 'verified',
        paymentTxid: verificationInput.paymentTxid ?? null,
        paymentChain: verificationInput.paymentChain === 'btc'
          ? 'btc'
          : verificationInput.paymentChain === 'mvc'
            ? 'mvc'
            : null,
        settlementKind: verificationInput.settlementKind === 'free' ? 'free' : 'native',
        paymentAddress: verificationInput.paymentAddress ?? null,
        amount: verificationInput.amount,
        currency: verificationInput.currency,
        amountSatoshis: Math.round(Number(verificationInput.amount) * 100_000_000),
        matchedOutputIndex: verificationInput.paymentTxid ? 0 : null,
        failureKind: null,
      })
      : undefined,
    requestMvcGasSubsidy,
    createSignerForHome: (profileHomeDir) => {
      const profileBaseSigner = createLocalMnemonicSigner({
        secretStore: createFileSecretStore(profileHomeDir),
        adapters,
        resolveSponsorWritePin,
      });
      return context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? createTestChainWriteSigner(profileBaseSigner)
        : profileBaseSigner;
    },
    autoReplyConfig: sharedAutoReplyConfig,
    llmExecutor,
    providerRuntimeCanStart: useFakeProviderLlm ? async () => true : undefined,
    onProviderPresenceChanged: (enabled) => onProviderPresenceChanged(enabled),
    onIdentityProfileRegistered: () => refreshA2ASimplemsgListenerAfterIdentityRegistration(),
    onBrowserInfrastructureChanged: () => refreshA2ASimplemsgListenerAfterInfrastructureChange(),
    schedule: {
      createScheduleStore: scheduleStoreFor,
      hostLeases: scheduleHostLeases,
    },
  });

  const daemon = createMetabotDaemon({
    homeDirOrPaths: paths,
    daemonPaths,
    handlers,
  });

  const installation = await selectDaemonInstallation(context);
  const started = await daemon.start(installation.port, installation.host);

  const runtimeStore = createRuntimeStateStore(paths);
  const providerPresenceStore = createProviderPresenceStateStore(paths);
  daemonRecord = await daemonStore.writeDaemon({
    schemaVersion: 1,
    instanceId: 'default',
    ownerId: daemon.ownerId,
    pid: process.pid,
    host: started.host,
    port: started.port,
    baseUrl: started.baseUrl,
    oacVersion: CLI_VERSION,
    runtimeFingerprint: getDaemonRuntimeFingerprint(),
    supervisor: {
      kind: 'none',
      serviceId: null,
    },
    startedAt: Date.now(),
    configHash: buildDaemonConfigHash(context.env),
  });
  const onlineServiceCacheStore = createOnlineServiceCacheStore(paths);
  const ratingDetailStateStore = createRatingDetailStateStore(paths);
  const refreshOnlineServiceCache = async () => {
    const infrastructure = await infrastructureConfigStore.read();
    const configuredPresenceApiBaseUrl = socketPresenceApiBaseUrl
      || resolveMetasoInfrastructureEndpoints(infrastructure.metasoP2PBaseUrl).socketPresenceApiBaseUrl;
    await refreshOnlineServiceCacheFromChain({
      store: onlineServiceCacheStore,
      ratingDetailStateStore,
      chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
      socketPresenceApiBaseUrl: configuredPresenceApiBaseUrl,
      socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? 'assume_service_providers_online'
        : 'throw',
      resolvePeerChatPublicKey,
    });
  };
  void refreshOnlineServiceCache().catch((error) => {
    console.warn('[online service cache] initial refresh failed:', error instanceof Error ? error.message : String(error));
  });
  const onlineServiceCacheInterval = setInterval(() => {
    void refreshOnlineServiceCache().catch((error) => {
      console.warn('[online service cache] periodic refresh failed:', error instanceof Error ? error.message : String(error));
    });
  }, DEFAULT_ONLINE_SERVICE_CACHE_SYNC_INTERVAL_MS);
  onlineServiceCacheInterval.unref?.();
  // Reclaim abandoned provider run workspaces (crashed daemons never reach
  // the terminal cleanup); terminal orders remove their own workspace.
  const sweepProviderWorkspaces = () => sweepProviderRunWorkspaces({
    projectRoot: paths.profileRoot,
  }).catch((error) => {
    console.warn('[provider workspace sweep]', error instanceof Error ? error.message : String(error));
  });
  void sweepProviderWorkspaces();
  const providerWorkspaceSweepInterval = setInterval(() => {
    void sweepProviderWorkspaces();
  }, PROVIDER_RUN_WORKSPACE_SWEEP_INTERVAL_MS);
  providerWorkspaceSweepInterval.unref?.();
  const serviceRefundSyncLoop = createServiceRefundSyncLoop({
    syncRefunds: async () => {
      const result = await handlers.services?.syncRefunds?.({});
      if (result && !result.ok) {
        throw new Error(result.message ?? result.code ?? 'service_refund_sync_failed');
      }
    },
    logWarning: (message) => console.warn(message),
  });
  // Buyer-side order deadline enforcement (IDBots 60s scanTimedOutOrders
  // parity): the socket waiter settles deliveries fast, but only this cheap
  // local sweep fails orders that breach the first-response deadline. The
  // refund sync loop above also runs the same sweep inline.
  const buyerOrderDeadlineSweepInterval = setInterval(() => {
    void Promise.resolve(handlers.sweepBuyerOrderDeadlines?.()).catch((error) => {
      console.warn('[buyer order deadline sweep]', error instanceof Error ? error.message : String(error));
    });
  }, SERVICE_ORDER_DEADLINE_SWEEP_INTERVAL_MS);
  buyerOrderDeadlineSweepInterval.unref?.();

  // ---- LLM runtime discovery and resolver ----
  const llmRuntimeStore = createLlmRuntimeStore(paths);
  const llmBindingStore = createLlmBindingStore(paths);
  const llmResolver = createLlmRuntimeResolver({
    runtimeStore: llmRuntimeStore,
    bindingStore: llmBindingStore,
    getPreferredRuntimeId: async (_slug) => {
      try {
        const raw = await fs.promises.readFile(paths.preferredLlmRuntimePath, 'utf8');
        const data = JSON.parse(raw) as { runtimeId?: string | null };
        return typeof data.runtimeId === 'string' ? data.runtimeId : null;
      } catch {
        return null;
      }
    },
  });

  // Discover LLM runtimes in background (non-blocking).
  const metaBotSlug = path.basename(paths.profileRoot);
  if (context.env[TEST_SKIP_BACKGROUND_LLM_DISCOVERY_ENV] !== '1') {
    void (async () => {
      const previous = await llmRuntimeStore.read();
      const result = await discoverLlmRuntimes({ env: context.env, knownRuntimes: previous.runtimes });
      for (const runtime of result.runtimes) {
        await llmRuntimeStore
          .upsertRuntime(runtime, { preserveRecentHealthyOnDetected: true })
          .catch(() => { /* best effort */ });
      }
    })().catch(() => { /* best effort */ });
  }

  // Availability recovery loop (spec R4): trickle re-probes of
  // detected/degraded/cooldown-expired runtimes across the host store and
  // every indexed profile store, so a runtime that failed readiness once
  // becomes selectable again without waiting for a manual rediscovery.
  // Tests that skip background LLM discovery skip this loop as well.
  if (context.env[TEST_SKIP_BACKGROUND_LLM_DISCOVERY_ENV] !== '1') {
    const llmAvailabilityRecovery = createLlmAvailabilityRecovery({
      env: context.env,
      listTargetHomes: async () => {
        const homes = [path.resolve(homeDir)];
        const profiles = await listIdentityProfiles(systemHomeDir).catch(() => []);
        for (const profile of profiles) {
          const profileHome = typeof profile.homeDir === 'string' ? path.resolve(profile.homeDir) : '';
          if (profileHome && !homes.includes(profileHome)) {
            homes.push(profileHome);
          }
        }
        return homes;
      },
      isStoreBusy: (targetHomeDir) => llmDiscoverySweepRunningForHomeDir(targetHomeDir),
      logger: (message, error) => console.warn(message, error ?? ''),
    });
    activeLlmAvailabilityRecovery = llmAvailabilityRecovery;
    llmAvailabilityRecovery.start();
  }

  const chatStateStore = createPrivateChatStateStore(paths);
  const chatStrategyStore = createChatStrategyStore(paths);
  const chatAutoReplyOrchestrator = createPrivateChatAutoReplyOrchestrator({
    stateStore: chatStateStore,
    strategyStore: chatStrategyStore,
    paths,
    signer,
    logSendFailure: createPrivateChatSendFailureFileLogger(paths),
    selfGlobalMetaId: async () => {
      const state = await runtimeStore.readState();
      return state.identity?.globalMetaId ?? null;
    },
    resolvePeerChatPublicKey,
    replyRunner: createPrivateChatReplyRunnerForProfile({
      paths,
      metaBotSlug,
      runtimeResolver: llmResolver,
      runtimeStore: llmRuntimeStore,
      bindingStore: llmBindingStore,
      llmExecutor,
      env: process.env,
      logWarning: (scope, message) => console.warn(scope, message),
    }),
    hasActiveOrderWithPeer: createHasActiveOrderWithPeer({
      runtimeStateStore: runtimeStore,
      sessionStateStore: createSessionStateStore(paths),
    }),
    chatSkillWaitNotice: createChatSkillWaitNoticeGenerator({
      runtimeResolver: llmResolver,
      llmExecutor,
      metaBotSlug,
    }),
  }, sharedAutoReplyConfig);
  const profileAutoReplyDispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: sharedAutoReplyConfig,
    resolvePeerChatPublicKey,
    llmExecutor,
    // Wire the live per-home config resolver so each profile orchestrator reads
    // the same object that handlers.chat.setAutoReply mutates. Without this,
    // toggling Auto-Reply off in /ui/bot (or via the CLI) for a non-Twin Bot
    // would be ignored — the orchestrator would keep reading the daemon-default
    // shared config.
    resolveAutoReplyConfigForHome: (homeDir) => handlers.resolveAutoReplyConfigForHome(homeDir),
    handleOrderProtocolMessageForProfile: async (profile, message) => {
      const handler = handlers.services?.handleInboundOrderProtocolMessage;
      if (!handler) {
        return commandSuccess({ handled: false });
      }
      return handler({
        ...message,
        localProfileSlug: profile.slug,
      });
    },
  });
  type PeerDiscoverySnapshot = {
    expiresAt: number;
    knownPeers: Array<{ globalMetaId: string; chatPublicKey: string }>;
    localProjectedPeerIndex: Map<string, string[]>;
  };
  let peerDiscoverySnapshot: PeerDiscoverySnapshot | null = null;
  let peerDiscoverySnapshotPending: Promise<PeerDiscoverySnapshot> | null = null;
  const loadPeerDiscoverySnapshot = async (): Promise<PeerDiscoverySnapshot> => {
    if (peerDiscoverySnapshot && peerDiscoverySnapshot.expiresAt > Date.now()) {
      return peerDiscoverySnapshot;
    }
    if (peerDiscoverySnapshotPending) return peerDiscoverySnapshotPending;
    peerDiscoverySnapshotPending = (async () => {
      const profiles = await listIdentityProfiles(paths.systemHomeDir).catch(() => []);
      const [knownPeers, localProjectedPeerIndex] = await Promise.all([
        Promise.all(profiles.map(async (candidate) => {
          const runtimeState = await createRuntimeStateStore(candidate.homeDir)
            .readState()
            .catch(() => null);
          return {
            globalMetaId: normalizeEnvText(
              runtimeState?.identity?.globalMetaId || candidate.globalMetaId,
            ),
            chatPublicKey: normalizeEnvText(runtimeState?.identity?.chatPublicKey),
          };
        })),
        buildLocalA2AProjectedPeerIndex(profiles),
      ]);
      const snapshot = {
        expiresAt: Date.now() + 30_000,
        knownPeers: knownPeers.filter((candidate) => candidate.globalMetaId),
        localProjectedPeerIndex,
      };
      peerDiscoverySnapshot = snapshot;
      return snapshot;
    })();
    try {
      return await peerDiscoverySnapshotPending;
    } finally {
      peerDiscoverySnapshotPending = null;
    }
  };

  const peerDirectoryCache = new Map<string, { expiresAt: number; peers: string[] }>();
  const peerDirectoryPending = new Map<string, Promise<string[]>>();
  const peerDirectoryLanes: Array<Promise<void>> = Array.from(
    { length: 4 },
    () => Promise.resolve(),
  );
  let nextPeerDirectoryLane = 0;
  const readCachedPeerDirectory = (
    selfGlobalMetaId: string,
    knownPeers: Array<{ globalMetaId: string; chatPublicKey: string }>,
  ): string[] => {
    const key = normalizeEnvText(selfGlobalMetaId).toLowerCase();
    const cached = peerDirectoryCache.get(key);
    if (!key || (cached && cached.expiresAt > Date.now())) {
      return cached?.peers ?? [];
    }

    if (!peerDirectoryPending.has(key)) {
      const laneIndex = nextPeerDirectoryLane % peerDirectoryLanes.length;
      nextPeerDirectoryLane += 1;
      const request = peerDirectoryLanes[laneIndex].then(async () => {
        const infrastructure = await infrastructureConfigStore.read();
        const chatApiBaseUrl = resolveMetasoInfrastructureEndpoints(
          infrastructure.metasoP2PBaseUrl,
        ).chatApiBaseUrl;
        return fetchPrivateChatPeerGlobalMetaIds({
          selfGlobalMetaId,
          knownPeers,
          chatApiBaseUrl,
          timeoutMs: 10_000,
        });
      });
      peerDirectoryLanes[laneIndex] = request.then(() => undefined, () => undefined);
      peerDirectoryPending.set(key, request);
      void request.then((peers) => {
        peerDirectoryCache.set(key, { peers, expiresAt: Date.now() + 60_000 });
      }).catch((error) => {
        peerDirectoryCache.set(key, { peers: cached?.peers ?? [], expiresAt: Date.now() + 30_000 });
        console.warn(
          `[private chat peer directory:${key}]`,
          error instanceof Error ? error.message : String(error),
        );
      }).finally(() => {
        peerDirectoryPending.delete(key);
      });
    }

    return cached?.peers ?? [];
  };

  const chatAutoReplyBackfill = createPrivateChatAutoReplyBackfillProfileManager({
    systemHomeDir: paths.systemHomeDir,
    createLoop: (profile) => {
      const profilePaths = resolveMetabotPaths(profile.homeDir);
      const profileRuntimeStore = createRuntimeStateStore(profilePaths);
      const profileBaseSigner = createLocalMnemonicSigner({
        secretStore: createFileSecretStore(profile.homeDir),
        adapters,
        resolveSponsorWritePin,
      });
      const profileSigner = path.resolve(profile.homeDir) === path.resolve(homeDir)
        ? signer
        : context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
          ? createTestChainWriteSigner(profileBaseSigner)
          : profileBaseSigner;
      return createPrivateChatAutoReplyBackfillLoop({
        paths: profilePaths,
        stateStore: createPrivateChatStateStore(profilePaths),
        selfGlobalMetaId: async () => {
          const state = await profileRuntimeStore.readState().catch(() => null);
          return state?.identity?.globalMetaId || profile.globalMetaId || null;
        },
        getLocalPrivateChatIdentity: async () => profileSigner.getPrivateChatIdentity(),
        resolvePeerChatPublicKey,
        resolveChatApiBaseUrl: async () => {
          const infrastructure = await infrastructureConfigStore.read();
          return resolveMetasoInfrastructureEndpoints(infrastructure.metasoP2PBaseUrl).chatApiBaseUrl;
        },
        listPeerGlobalMetaIds: async (selfGlobalMetaId) => {
          const snapshot = await loadPeerDiscoverySnapshot();
          const localProjectedPeers = snapshot.localProjectedPeerIndex.get(
            normalizeEnvText(selfGlobalMetaId).toLowerCase(),
          ) ?? [];
          const directoryPeers = readCachedPeerDirectory(
            selfGlobalMetaId,
            snapshot.knownPeers,
          );
          return [...localProjectedPeers, ...directoryPeers];
        },
        handleInboundMessage: async (message) => {
          if (path.resolve(profile.homeDir) === path.resolve(homeDir)) {
            await chatAutoReplyOrchestrator.handleInboundMessage(message);
            return;
          }
          await profileAutoReplyDispatcher.handleInboundMessage(profile, message);
        },
        recoverOutboundMessage: async (peerGlobalMetaId, message) => {
          if (path.resolve(profile.homeDir) === path.resolve(homeDir)) {
            return chatAutoReplyOrchestrator.retryOutboundMessage(peerGlobalMetaId, message);
          }
          return profileAutoReplyDispatcher.retryOutboundMessage(
            profile,
            peerGlobalMetaId,
            message,
          );
        },
        recoverInboundReply: async (peerGlobalMetaId) => {
          if (path.resolve(profile.homeDir) === path.resolve(homeDir)) {
            return chatAutoReplyOrchestrator.retryPendingInboundMessage(peerGlobalMetaId);
          }
          return profileAutoReplyDispatcher.retryPendingInboundMessage(
            profile,
            peerGlobalMetaId,
          );
        },
        onError: (error) => {
          console.warn(`[private chat auto-reply backfill:${profile.slug}]`, error.message);
        },
      });
    },
  });

  const daemonConfig = await createConfigStore(paths).read();
  const simplemsgInboundDispatcher = buildA2ASimplemsgInboundDispatcher({
    handleOrderProtocolMessage: handlers.services?.handleInboundOrderProtocolMessage,
    handleGenericPrivateChatMessage: async (message) => {
      await chatAutoReplyOrchestrator.handleInboundMessage(message);
    },
    logWarning: (scope, error) => {
      console.warn(scope, error instanceof Error ? error.message : String(error));
    },
  });
  const simplemsgListener = createA2ASimplemsgListenerManager({
    systemHomeDir: paths.systemHomeDir,
    resolveSocketEndpoints: async () => [
      resolveMetasoInfrastructureEndpoints((await infrastructureConfigStore.read()).metasoP2PBaseUrl).socket,
    ],
    resolvePeerChatPublicKey,
    onMessage: (profile, message) => {
      if (path.resolve(profile.homeDir) === path.resolve(homeDir)) {
        void simplemsgInboundDispatcher(message).catch((error) => {
          console.warn('[private chat auto-reply]', error instanceof Error ? error.message : String(error));
        });
        return;
      }
      void profileAutoReplyDispatcher.handleInboundMessage(profile, message).catch((error) => {
        console.warn('[private chat auto-reply]', error instanceof Error ? error.message : String(error));
      });
    },
    onError: (error) => {
      console.warn('[A2A simplemsg listener]', error.message);
    },
  });
  const readConfiguredSocketPresence = async () => {
    const infrastructure = await infrastructureConfigStore.read();
    const apiBaseUrl = socketPresenceApiBaseUrl
      || resolveMetasoInfrastructureEndpoints(infrastructure.metasoP2PBaseUrl).socketPresenceApiBaseUrl;
    return readOnlineMetaBotsFromSocketPresence({ apiBaseUrl, limit: 100 });
  };
  const simplemsgPresenceWatchdog = createA2ASimplemsgPresenceWatchdog({
    manager: simplemsgListener,
    readOnlineMetaBots: readConfiguredSocketPresence,
    onRestart: (event) => {
      const missingNames = event.missing
        .map((profile) => `${profile.name || profile.slug} (${profile.globalMetaId})`)
        .join(', ');
      console.warn(`[A2A simplemsg listener] restarted after socket presence missed local profiles: ${missingNames}`);
    },
    onError: (error) => {
      console.warn('[A2A simplemsg listener watchdog]', error.message);
    },
  });
  refreshA2ASimplemsgListenerAfterIdentityRegistration = async () => {
    const currentConfig = await createConfigStore(paths).read().catch(() => daemonConfig);
    const providerPresence = await providerPresenceStore.read().catch(() => ({ enabled: true }));
    await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
      enabled: currentConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled,
      listener: simplemsgListener,
      backfill: chatAutoReplyBackfill,
      watchdog: simplemsgPresenceWatchdog,
    });
  };
  refreshA2ASimplemsgListenerAfterInfrastructureChange = async () => {
    const currentConfig = await createConfigStore(paths).read().catch(() => daemonConfig);
    const providerPresence = await providerPresenceStore.read().catch(() => ({ enabled: true }));
    await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
      enabled: currentConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled,
      listener: simplemsgListener,
      backfill: chatAutoReplyBackfill,
      watchdog: simplemsgPresenceWatchdog,
    });
    void refreshOnlineServiceCache().catch((error) => {
      console.warn('[online service cache] infrastructure refresh failed:', error instanceof Error ? error.message : String(error));
    });
  };
  onProviderPresenceChanged = async (enabled) => {
    const currentConfig = await createConfigStore(paths).read().catch(() => daemonConfig);
    await createConfigStore(paths).set({
      ...currentConfig,
      a2a: {
        ...currentConfig.a2a,
        simplemsgListenerEnabled: enabled,
      },
    });
    if (!enabled) {
      simplemsgPresenceWatchdog.stop();
      simplemsgListener.stop();
      chatAutoReplyBackfill.stop();
      return;
    }
    await refreshA2ASimplemsgListenerForIdentityProfileRegistration({
      enabled: true,
      listener: simplemsgListener,
      backfill: chatAutoReplyBackfill,
      watchdog: simplemsgPresenceWatchdog,
    });
  };
  const providerPresence = await providerPresenceStore.read();
  if (daemonConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled) {
    await simplemsgListener.start();
    simplemsgPresenceWatchdog.start();
    await chatAutoReplyBackfill.start();
    void replayUnhandledA2AOrderMessagesForProfiles({
      systemHomeDir: paths.systemHomeDir,
      activeHomeDir: homeDir,
      handleOrderProtocolMessage: handlers.services?.handleInboundOrderProtocolMessage,
      logWarning: (scope, error) => {
        console.warn(scope, error instanceof Error ? error.message : String(error));
      },
    }).catch((error) => {
      console.warn('[A2A order replay]', error instanceof Error ? error.message : String(error));
    });
  }
  // Resident App/Game Runtime (browser.app.session.*): restore persisted
  // sessions, re-validate grants, catch up history, acquire leases, and start
  // the group chat socket listener. Independent of the private chat listener
  // config; sessions must survive MetaApp page close and daemon restarts.
  try {
    const appSessionReport = await handlers.startAppSessionRuntime?.();
    if (appSessionReport) {
      console.log(
        `[app-session runtime] restored ${appSessionReport.restored} sessions: `
        + `${appSessionReport.running} running, ${appSessionReport.paused} paused, `
        + `${appSessionReport.stopped} stopped, ${appSessionReport.conflicts} lease conflicts`,
      );
    }
  } catch (error) {
    console.warn('[app-session runtime] start failed:', error instanceof Error ? error.message : String(error));
  }
  // Group Task engine: 5s ticker that drives every non-terminal group task
  // chaired by a local profile (message sync, tag side effects, chair/worker
  // LLM turns, stall heartbeat). Cheap when no tasks exist — the tick only
  // reads local profile state files. Engine failures land in the size-capped
  // engine log (the detached daemon's stdio is ignored, console.warn alone
  // would evaporate).
  const groupTaskEngineLog = createGroupTaskEngineLogWriter({
    logFile: resolveGroupTaskEngineLogPath(daemonPaths.logsRoot),
  });
  // Deliverable uploads are workspace-scoped and fail-closed: a local file
  // reaches the chain only from inside the acting Bot's profile home. Paths
  // injected into guest replies by remote members are refused here.
  const gatedDeliverableUpload = createProfileScopedUpload({
    profileHomeDir: async (slug) => {
      const profile = await getMetabotProfile(systemHomeDir, slug).catch(() => null);
      return profile?.homeDir ?? null;
    },
    signerForSlug: (slug) => (async () => {
      const profile = await getMetabotProfile(systemHomeDir, slug).catch(() => null);
      if (!profile) throw new Error(`MetaBot profile not found: ${slug}`);
      return profile.homeDir === homeDir
        ? signer
        : createLocalMnemonicSigner({ secretStore: createFileSecretStore(profile.homeDir), adapters, resolveSponsorWritePin });
    })(),
    log: (message) => {
      console.warn(message);
      groupTaskEngineLog(message);
    },
  });
  const groupTaskEngine = createGroupTaskEngine({
    verifyPin: createMetasoPinVerifier(),
    uploadDeliverableFile: gatedDeliverableUpload,
    ctx: createGroupTaskServiceContext({
      systemHomeDir,
      createSignerForProfileHome: (profileHomeDir) => (profileHomeDir === homeDir
        ? signer
        : createLocalMnemonicSigner({ secretStore: createFileSecretStore(profileHomeDir), adapters, resolveSponsorWritePin })),
      adapters,
      resolvePeerChatPublicKey,
      log: (message) => {
        console.warn(message);
        groupTaskEngineLog(message);
      },
    }),
    runLlmTurn: async (turn) => {
      const profilePaths = resolveMetabotPaths(turn.profile.homeDir);
      const runtimeResolver = createLlmRuntimeResolver({
        runtimeStore: createLlmRuntimeStore(profilePaths),
        bindingStore: createLlmBindingStore(profilePaths),
        getPreferredRuntimeId: async () => {
          try {
            const raw = await fs.promises.readFile(profilePaths.preferredLlmRuntimePath, 'utf8');
            const data = JSON.parse(raw) as { runtimeId?: string | null };
            return typeof data.runtimeId === 'string' ? data.runtimeId : null;
          } catch {
            return null;
          }
        },
      });
      const result = await runLlmPromptWithRuntimeFallback({
        runtimeResolver,
        llmExecutor,
        metaBotSlug: turn.profile.slug,
        prompt: turn.prompt,
        systemPrompt: turn.systemPrompt,
        timeoutMs: 120_000,
        pollIntervalMs: 500,
      });
      if (result.status !== 'completed') {
        throw new Error(result.error || `Group task LLM turn ended with status ${result.status}`);
      }
      return result.output;
    },
  });
  groupTaskEngine.start();

  // Study scheduler (IDBots M4 parity): drains owner-assigned MetaWeb study
  // jobs into knowledge bases during the nightly window. One job per tick,
  // 30-minute cadence; the study turn is a plain LLM turn whose prompt
  // carries the tool allowlist (the allowlisted tools run as DSH native
  // tools / skillpack CLIs on the caller side).
  const studyJobStores = new Map<string, ReturnType<typeof createStudyJobStore>>();
  const studyStoreFor = (homeDir: string): ReturnType<typeof createStudyJobStore> => {
    let store = studyJobStores.get(homeDir);
    if (!store) {
      store = createStudyJobStore(resolveMetabotPaths(homeDir));
      studyJobStores.set(homeDir, store);
    }
    return store;
  };
  // Overlap guard: one study tick (up to a 30-minute LLM turn) must finish
  // before the next interval fire starts — otherwise the next tick's crash
  // recovery flips the in-flight `running` row back to pending and the same
  // job runs twice (double pin budget, duplicate KB writes).
  let studyTickInFlight = false;
  const studyTimer = setInterval(() => {
    if (studyTickInFlight) {
      groupTaskEngineLog('[Study] tick skipped: previous tick still running');
      return;
    }
    studyTickInFlight = true;
    void (async () => {
      try {
        const profiles = await listMetabotProfiles(systemHomeDir).catch(() => []);
        for (const profile of profiles) {
          // Nightly KB auto-learn (imported/raw files indexed once per local
          // day in the window) rides the same tick as the study drain.
          try {
            const kbService = createKnowledgeBaseService(resolveMetabotPaths(profile.homeDir));
            for (const kb of await kbService.store.listDueForAutoLearn(new Date())) {
              await kbService.learnKnowledgeBase(profile.slug, kb.id).catch(() => undefined);
              await kbService.store.markAutoLearned(kb.id, new Date().toISOString().slice(0, 10));
            }
          } catch {
            // Auto-learn failures never block the study drain.
          }
          await runStudyTick(studyStoreFor(profile.homeDir), {
            runStudyTurn: async ({ slug, prompt, budgetPins }) => {
              const homeDir = (await getMetabotProfile(systemHomeDir, slug))?.homeDir ?? '';
              const profilePaths = resolveMetabotPaths(homeDir);
              const runtimeResolver = createLlmRuntimeResolver({
                runtimeStore: createLlmRuntimeStore(profilePaths),
                bindingStore: createLlmBindingStore(profilePaths),
                getPreferredRuntimeId: async () => {
                  try {
                    const raw = await fs.promises.readFile(profilePaths.preferredLlmRuntimePath, 'utf8');
                    const data = JSON.parse(raw) as { runtimeId?: string | null };
                    return typeof data.runtimeId === 'string' ? data.runtimeId : null;
                  } catch {
                    return null;
                  }
                },
              });
              const llm = async (history: Array<{ role: 'user' | 'assistant'; content: string }>) => {
                const result = await runLlmPromptWithRuntimeFallback({
                  runtimeResolver,
                  llmExecutor,
                  metaBotSlug: slug,
                  prompt: history
                    .map((entry) => `${entry.role === 'user' ? 'User' : 'Assistant'}:\n${entry.content}`)
                    .join('\n\n---\n\n'),
                  systemPrompt: 'You are a MetaBot running an unattended nightly study session. Reply with exactly one ```json fence per turn.',
                  timeoutMs: 30 * 60_000,
                  pollIntervalMs: 5_000,
                });
                if (result.status !== 'completed') {
                  throw new Error(result.error || `Study turn ended with status ${result.status}`);
                }
                return result.output;
              };
              // Real tools with the pin budget enforced at the executor seam.
              let savedDocs = 0;
              const kbService = createKnowledgeBaseService(profilePaths);
              const studyProcedures = createProcedureStore(profilePaths);
              const studyKnowledge = createKnowledgeStore(profilePaths);
              return await runStudyTurnWithTools(prompt, {
                runLlm: llm,
                tools: {
                  searchMetaweb: async ({ query }) => {
                    const baseUrl = normalizeEnvText(context.env.METABOT_METAWEB_API_BASE_URL) || undefined;
                    const page = await searchMetaweb({ q: query }, baseUrl ? { baseUrl } : undefined);
                    const { formatMetawebSearchBullets } = await import('../core/metaweb/format.js');
                    return formatMetawebSearchBullets(page.items)
                      || 'No results. Retry with other keywords (bilingual).';
                  },
                  readMetawebPin: async ({ pinId }) => {
                    const baseUrl = normalizeEnvText(context.env.METABOT_METAWEB_API_BASE_URL) || undefined;
                    const pin = await readMetawebPin(pinId, baseUrl ? { baseUrl } : undefined);
                    // Best-effort chain-history read record; never delays or
                    // fails the study turn (recordMetawebPinRead also swallows).
                    void recordMetawebPinRead(profilePaths, pin, 'study_job').catch(() => undefined);
                    const { formatMetawebPinDetail } = await import('../core/metaweb/format.js');
                    return formatMetawebPinDetail(pin);
                  },
                  addDocument: async ({ title, content, pinId }) => {
                    if (savedDocs >= budgetPins) {
                      return `Pin budget reached (${budgetPins}). Stop saving; emit the final report.`;
                    }
                    const saved = await kbService.addDocument(slug, {
                      title,
                      content,
                      sourceType: 'metaweb',
                      ...(pinId ? { pinId } : {}),
                    });
                    savedDocs += 1;
                    await kbService.learnKnowledgeBase(slug).catch(() => undefined);
                    return `Saved as ${saved.relPath} (budget ${savedDocs}/${budgetPins}).`;
                  },
                  learnKnowledgeBase: async () => {
                    const learned = await kbService.learnKnowledgeBase(slug);
                    return `Learned "${learned.name}": ${learned.docCount} docs, ${learned.chunkCount} chunks.`;
                  },
                  listKnowledgeBases: async () => {
                    const rows = (await kbService.store.listKnowledgeBases())
                      .filter((row) => row.metabotSlug === slug);
                    if (!rows.length) return 'No knowledge bases yet.';
                    return rows.map((row) => `- "${row.name}"${row.isDefault ? ' (default)' : ''} `
                      + `docs=${row.docCount} chunks=${row.chunkCount}`
                      + `${row.description ? ` — ${row.description}` : ''}`).join('\n');
                  },
                  queryKnowledgeBases: async ({ query, knowledgeBaseId }) => {
                    const results = await kbService.queryKnowledgeBase(slug, query, {
                      ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
                    });
                    if (!results.length) return 'No hits.';
                    return results.map((result) => result.hits.map((hit) =>
                      `- [${result.knowledgeBaseName}] ${hit.title}#${hit.ord} (score ${hit.score})\n  ${hit.snippet}`
                    ).join('\n')).join('\n');
                  },
                  saveProcedure: async (input) => {
                    const { procedure, created } = await studyProcedures.upsertProcedure({
                      title: input.title,
                      steps: input.steps,
                      ...(input.pitfalls?.length ? { pitfalls: input.pitfalls } : {}),
                      ...(input.triggerText ? { triggerText: input.triggerText } : {}),
                      ...(input.sourcePinIds?.length ? { sourcePinIds: input.sourcePinIds } : {}),
                      origin: 'agent',
                    });
                    return `${created ? 'Saved' : 'Updated'} procedure "${procedure.title}" `
                      + `v${procedure.version} (${procedure.steps.length} steps).`;
                  },
                  recallProcedures: async ({ query }) => {
                    const rows = await studyProcedures.listProcedures({ status: 'active' });
                    const scored = scoreProceduresForQuery(rows, query).slice(0, 5);
                    if (!scored.length) return 'No matching procedures.';
                    return scored.map(({ procedure, score }) =>
                      `- ${procedure.title} (${score})\n  ${procedure.steps.join(' → ')}`
                      + (procedure.pitfalls.length ? `\n  Pitfalls: ${procedure.pitfalls.join('; ')}` : '')
                    ).join('\n');
                  },
                  upsertKnowledge: async ({ topic, summary, kind }) => {
                    const validKind: KnowledgeKind | undefined = kind && (KNOWLEDGE_KINDS as readonly string[]).includes(kind)
                      ? kind as KnowledgeKind
                      : undefined;
                    const result = await studyKnowledge.upsertKnowledge({
                      topic,
                      summary,
                      ...(validKind ? { kind: validKind } : {}),
                      origin: 'agent',
                    });
                    return formatKnowledgeUpsertResult({
                      topic: result.entry.topic,
                      created: result.created,
                      revised: result.revised,
                      version: result.entry.version,
                      kind: result.entry.kind,
                    });
                  },
                  recallKnowledge: async (input) => {
                    const rows = await studyKnowledge.searchKnowledge({
                      ...(input.query ? { query: input.query } : {}),
                      ...(input.kind && (KNOWLEDGE_KINDS as readonly string[]).includes(input.kind)
                        ? { kind: input.kind as KnowledgeKind }
                        : {}),
                      limit: 5,
                      touchLastUsed: true,
                    });
                    if (!rows.length) return 'No matching knowledge.';
                    return rows.map((row) => `- [${row.kind}] ${row.topic}: ${row.summary}`).join('\n');
                  },
                },
              });
            },
            log: (message) => {
              console.warn(message);
              groupTaskEngineLog(message);
            },
          }).catch(() => undefined);
        }
      } catch {
        // Scheduler failures never take down the daemon.
      } finally {
        studyTickInFlight = false;
      }
    })();
  }, STUDY_TICK_INTERVAL_MINUTES * 60_000);
  studyTimer.unref?.();

  // Scheduled-task scheduler (IDBots scheduledTaskStore parity): a 30s tick
  // that iterates every indexed profile and runs due tasks headlessly through
  // the bot's LLM runtime. Profiles under a fresh host lease (DSH plugin
  // heartbeat) skip `auto`/`host` tasks — the host owns execution there —
  // while `daemon`-channel tasks always run here. Lease expiry hands execution
  // back to the daemon with the fire-once catch-up rule. The tick has an
  // in-flight guard and logs failures to the size-capped engine log; a
  // schedule failure must never take the daemon down.
  let scheduleTickInFlight = false;
  const scheduleTimer = setInterval(() => {
    if (scheduleTickInFlight) {
      groupTaskEngineLog('[Schedule] tick skipped: previous tick still running');
      return;
    }
    scheduleTickInFlight = true;
    void (async () => {
      try {
        const profiles = await listMetabotProfiles(systemHomeDir).catch(() => []);
        for (const profile of profiles) {
          const profileHomeDir = typeof profile.homeDir === 'string' ? path.resolve(profile.homeDir) : '';
          if (!profileHomeDir) continue;
          const profilePaths = resolveMetabotPaths(profileHomeDir);
          const runtimeResolver = createLlmRuntimeResolver({
            runtimeStore: createLlmRuntimeStore(profilePaths),
            bindingStore: createLlmBindingStore(profilePaths),
            getPreferredRuntimeId: async () => {
              try {
                const raw = await fs.promises.readFile(profilePaths.preferredLlmRuntimePath, 'utf8');
                const data = JSON.parse(raw) as { runtimeId?: string | null };
                return typeof data.runtimeId === 'string' ? data.runtimeId : null;
              } catch {
                return null;
              }
            },
          });
          const runLlm = async (turn: { prompt: string; systemPrompt: string }) => {
            const outcome = await runLlmPromptWithRuntimeFallback({
              runtimeResolver,
              llmExecutor,
              metaBotSlug: profile.slug,
              prompt: turn.prompt,
              systemPrompt: turn.systemPrompt,
              timeoutMs: 30 * 60_000,
              pollIntervalMs: 5_000,
            });
            if (outcome.status !== 'completed') {
              return {
                ok: false as const,
                error: outcome.error || `Scheduled task execution ended with status ${outcome.status}.`,
              };
            }
            return { ok: true as const, output: outcome.output };
          };
          try {
            const store = scheduleStoreFor(profileHomeDir);
            const due = await store.listDue();
            if (due.length === 0) continue;
            const lease = scheduleHostLeases.get(profile.slug);
            const leaseFresh = lease !== undefined && lease.expiresAtMs > Date.now();
            for (const task of due) {
              if (leaseFresh && task.channel !== 'daemon') continue;
              const result = await runScheduledTask(profilePaths, {
                taskId: task.id,
                trigger: 'scheduled',
                executor: 'daemon',
              }, { runLlm });
              if (result.kind === 'failed') {
                groupTaskEngineLog(`[Schedule:${profile.slug}] task ${task.id} failed: ${result.error}`);
              }
            }
          } catch (error) {
            groupTaskEngineLog(
              `[Schedule:${profile.slug}] ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch {
        // Scheduler failures never take down the daemon.
      } finally {
        scheduleTickInFlight = false;
      }
    })();
  }, SCHEDULE_TICK_INTERVAL_MS);
  scheduleTimer.unref?.();
  // Buyer-side boot recovery: caller reply waits are in-memory only, so re-arm
  // them (with their remaining budget) or settle expired waits into the
  // timeout + refund path. Runs even when the simplemsg listener is disabled —
  // the refund safety net must not depend on inbound listener config.
  void resumePendingA2ACallerReplyWaitsForProfiles({
    systemHomeDir: paths.systemHomeDir,
    activeHomeDir: homeDir,
    resumeCallerReplyWait: (input) => handlers.resumePendingCallerReplyContinuations(input),
    logWarning: (scope, error) => {
      console.warn(scope, error instanceof Error ? error.message : String(error));
    },
  }).catch((error) => {
    console.warn('[A2A caller reply resume]', error instanceof Error ? error.message : String(error));
  });
  if (pendingA2ASimplemsgRefreshAfterIdentityRegistration) {
    pendingA2ASimplemsgRefreshAfterIdentityRegistration = false;
    await refreshA2ASimplemsgListenerAfterIdentityRegistration();
  }

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    simplemsgPresenceWatchdog.stop();
    simplemsgListener.stop();
    chatAutoReplyBackfill.stop();
    groupTaskEngine.stop();
    try {
      await handlers.stopAppSessionRuntime?.();
    } catch (error) {
      console.warn('[app-session runtime] shutdown failed:', error instanceof Error ? error.message : String(error));
    }
    clearInterval(onlineServiceCacheInterval);
    clearInterval(providerWorkspaceSweepInterval);
    clearInterval(scheduleTimer);
    serviceRefundSyncLoop.stop();
    let shutdownFailure: unknown = null;
    try {
      await daemon.close();
    } catch (error) {
      shutdownFailure = error;
    }
    try {
      await daemonStore.clearDaemon(process.pid);
    } catch (error) {
      shutdownFailure ??= error;
    }
    if (shutdownFailure) {
      console.error(shutdownFailure);
      process.exit(1);
      return;
    }
    process.exit(exitCode);
  };

  process.on('SIGTERM', () => { void shutdown(0); });
  process.on('SIGINT', () => { void shutdown(0); });
  process.on('uncaughtException', (error) => {
    console.error(error);
    void shutdown(1);
  });
  process.on('unhandledRejection', (error) => {
    console.error(error);
    void shutdown(1);
  });

  return new Promise<never>(() => {});
}
