import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import net from 'node:net';
import { collectDaemonStartupDiagnostics, formatDaemonStartupTimeoutMessage } from './daemonStartupDiagnostics';
import { CLI_VERSION } from './version';
import { commandAwaitingConfirmation, commandFailed, commandManualActionRequired, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { createConfigStore, type ConfigStore } from '../core/config/configStore';
import {
  DEFAULT_WRITE_NETWORKS,
  type DefaultWriteNetwork,
} from '../core/config/configTypes';
import { bindHostSkills, HostSkillBindingError } from '../core/host/hostSkillBinding';
import {
  bindHostPersonaProjection,
  getHostPersonaProjectionStatus,
  HostPersonaProjectionError,
  unbindHostPersonaProjection,
} from '../core/host/hostPersonaProjection';
import { uploadLocalFileToChain } from '../core/files/uploadFile';
import {
  listIdentityProfiles,
  readActiveMetabotHome,
  setActiveMetabotHome,
  type IdentityProfileRecord,
} from '../core/identity/identityProfiles';
import { resolveIdentityCreateProfileHome } from '../core/identity/profileWorkspace';
import { resolveProfileNameMatch } from '../core/identity/profileNameResolution';
import { renderResolvedSkillContract } from '../core/skills/skillResolver';
import type { ConcreteSkillHost, SkillRenderFormat } from '../core/skills/skillContractTypes';
import {
  resolveMetabotDaemonPaths,
  resolveMetabotPaths,
  type MetabotPaths,
} from '../core/state/paths';
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
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import type { LocalIdentitySecrets } from '../core/secrets/secretStore';
import {
  createLocalMnemonicSigner,
  executeTransfer,
} from '../core/signing/localMnemonicSigner';
import { normalizeChainWriteRequest, type ChainWriteNetwork } from '../core/chain/writePin';
import { createDefaultChainAdapterRegistry } from '../core/chain/adapters/registry';
import {
  confirmWalletTransfer,
  previewWalletTransfer,
  queryWalletBalances,
} from '../core/wallet/nativeWallet';
import type { Signer } from '../core/signing/signer';
import {
  draftLoomTask,
  assertGitHubToolsReady,
  buildLoomWorkflowTaskState,
  createLoomDashboardService,
  createLoomDashboardStore,
  createLoomWorkflowStore,
  createLoomRawCacheStore,
  createNodeLoomCommandRunner,
  listLoomTasksFromCache,
  prepareGitHubForkWorkspace,
  pushLoomBranch,
  readLoomRawChainRecords,
  createLoomPullRequest,
  runLoomClaimAndStartWorkflow,
  runLoomDevRoundWorkflow,
  runLoomDeliverWorkflow,
  runLoomAcceptAndPayWorkflow,
  runLoomPostTaskWorkflow,
  runLoomReviewDeliveryWorkflow,
  showLoomTaskFromCache,
  writeLoomProcessLogFile,
  type LoomRawCacheState,
  type LoomRawCacheStore,
  type LoomWorkflowState,
} from '../core/loom';
import { createMetabotDaemon } from '../daemon';
import { createDefaultMetabotDaemonHandlers, fetchPeerChatPublicKey as fetchPeerChatPublicKeyFromChain } from '../daemon/defaultHandlers';
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
import {
  createPrivateChatAutoReplyOrchestrator,
  type PrivateChatAutoReplyDependencies,
  type PrivateChatAutoReplyOrchestrator,
} from '../core/chat/privateChatAutoReply';
import { createPrivateChatSendFailureFileLogger } from '../core/chat/privateChatSendFailureLog';
import { createPrivateChatAutoReplyBackfillLoop } from '../core/chat/privateChatAutoReplyBackfill';
import { createPrivateChatStateStore } from '../core/chat/privateChatStateStore';
import { createChatStrategyStore } from '../core/chat/chatStrategyStore';
import { createHostLlmChatReplyRunner } from '../core/chat/hostLlmChatReplyRunner';
import { createPrivateChatAllowedSkillsResolver } from '../core/chat/privateChatAllowedSkills';
import { createLlmOrderProtocolTextGenerator } from '../core/a2a/orderProtocolTextGenerator';
import type {
  ChatReplyRunner,
  PrivateChatAutoReplyConfig,
  PrivateChatInboundMessage,
} from '../core/chat/privateChatTypes';
import { createTestServicePaymentExecutor } from '../core/payments/servicePayment';
import { createLlmRuntimeStore } from '../core/llm/llmRuntimeStore';
import { createLlmBindingStore } from '../core/llm/llmBindingStore';
import {
  createLlmRuntimeResolver,
  summarizeResolvedLlmRuntime,
} from '../core/llm/llmRuntimeResolver';
import { discoverLlmRuntimes } from '../core/llm/llmRuntimeDiscovery';
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
export const LOOM_DRAFT_LLM_TIMEOUT_MS = 120_000;
export const LOOM_DEV_ROUND_LLM_TIMEOUT_MS = 900_000;
const LOOM_DRAFT_LLM_POLL_INTERVAL_MS = 500;
const DEFAULT_SERVICE_REFUND_SYNC_INTERVAL_MS = 10 * 60 * 1000;
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
  const report = await input.listener.start();
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

async function listLocalLoomWorkflowsForTask(
  paths: MetabotPaths,
  taskPinId: string,
) {
  const workflowStore = createLoomWorkflowStore(paths);
  const taskWorkflowDir = path.dirname(workflowStore.resolve(taskPinId, 'claim').workflowPath);
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(taskWorkflowDir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const workflows = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }
    const claimPinId = path.basename(entry.name, '.json');
    const workflow = await workflowStore.read(taskPinId, claimPinId);
    if (workflow) {
      workflows.push(workflow);
    }
  }
  return workflows.sort((left, right) => left.claimPinId.localeCompare(right.claimPinId));
}

async function listLocalLoomWorkflowsForRawCache(
  paths: MetabotPaths,
  rawState: LoomRawCacheState,
): Promise<LoomWorkflowState[]> {
  const taskPinIds = Array.from(new Set(rawState.records.task.map((record) => record.pinId)));
  const workflows: LoomWorkflowState[] = [];
  for (const taskPinId of taskPinIds) {
    workflows.push(...(await listLocalLoomWorkflowsForTask(paths, taskPinId)));
  }
  return workflows.sort((left, right) => {
    const taskOrder = left.taskPinId.localeCompare(right.taskPinId);
    return taskOrder || left.claimPinId.localeCompare(right.claimPinId);
  });
}

async function refreshLoomRawState(
  context: CliRuntimeContext,
  cacheStore: LoomRawCacheStore,
): Promise<LoomRawCacheState> {
  const syncResult = await readLoomRawChainRecords({
    chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
  });
  return cacheStore.update(syncResult.records);
}

function loomRefreshFailure(error: unknown): MetabotCommandResult<never> {
  const cause = error instanceof Error ? error.message : String(error);
  return commandFailed(
    'loom_refresh_failed',
    'Loom chain data could not be refreshed before a confirmed payment. Run metabot loom sync and retry after the chain index is reachable.',
    {
      data: {
        syncCommand: 'metabot loom sync',
        cause,
      },
    },
  );
}

async function readFreshLoomRawState(
  context: CliRuntimeContext,
  cacheStore: LoomRawCacheStore,
): Promise<LoomRawCacheState> {
  try {
    return await refreshLoomRawState(context, cacheStore);
  } catch {
    return cacheStore.read();
  }
}

async function requireFreshLoomRawState(
  context: CliRuntimeContext,
  cacheStore: LoomRawCacheStore,
): Promise<MetabotCommandResult<LoomRawCacheState>> {
  try {
    return commandSuccess(await refreshLoomRawState(context, cacheStore));
  } catch (error) {
    return loomRefreshFailure(error);
  }
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

async function readActiveHomeReadonly(systemHomeDir: string): Promise<string | null> {
  const layout = resolveMetabotManagerLayout(systemHomeDir);
  let raw: string;
  try {
    raw = await fs.promises.readFile(layout.activeHomePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  try {
    const parsed = JSON.parse(raw) as { homeDir?: unknown };
    const homeDir = typeof parsed.homeDir === 'string' ? normalizeEnvText(parsed.homeDir) : '';
    return homeDir ? path.resolve(homeDir) : null;
  } catch {
    return null;
  }
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
    const selectedHome = explicitHome ? path.resolve(explicitHome) : await readActiveHomeReadonly(systemHomeDir);
    if (!selectedHome) {
      return commandFailed('profile_not_found', 'No active MetaBot profile found for dry-run delivery.');
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
  const activeHomeDir = path.resolve(normalizeHomeDir(context.env, context.cwd));
  const activeProfile = profiles.find((profile) => path.resolve(profile.homeDir) === activeHomeDir);
  if (!activeProfile?.slug) {
    return commandFailed(
      'profile_not_found',
      `Active MetaBot profile not found in the manager index for home: ${activeHomeDir}`,
    );
  }
  return { slug: activeProfile.slug };
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

async function draftLoomTaskFromWish(
  context: CliRuntimeContext,
  input: { wish: string; from?: string; allowInvalid: boolean },
): Promise<MetabotCommandResult<unknown>> {
  const actor = await resolveActorHomeDir(context, input.from);
  if (!('homeDir' in actor)) return actor;
  const paths = resolveMetabotPaths(actor.homeDir);
  const metaBotSlug = path.basename(paths.profileRoot);
  const runtimeStore = createLlmRuntimeStore(paths);
  await refreshLlmRuntimeStoreFromDiscovery(runtimeStore, context.env);
  const runtimeResolver = createCliLlmRuntimeResolver(paths);
  const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug });
  if (!resolved.runtime || resolved.runtime.health !== 'healthy') {
    return commandFailed(
      'llm_runtime_unavailable',
      `No healthy LLM runtime is available for MetaBot ${metaBotSlug}.`,
    );
  }
  const llmExecutor = new LlmExecutor({
    sessionsRoot: paths.llmExecutorSessionsRoot,
    transcriptsRoot: paths.llmExecutorTranscriptsRoot,
    skillsRoot: paths.skillsRoot,
    systemHomeDir: paths.systemHomeDir,
    env: context.env,
    backends: createRegistryBackendFactories(),
  });

  try {
    return await draftLoomTask({
      wish: input.wish,
      allowInvalid: input.allowInvalid,
      executePrompt: async ({ prompt, systemPrompt }) => {
        const sessionId = await llmExecutor.execute({
          runtimeId: resolved.runtime!.id,
          runtime: resolved.runtime!,
          prompt,
          systemPrompt,
          timeout: LOOM_DRAFT_LLM_TIMEOUT_MS,
          cwd: context.cwd,
          metaBotSlug,
        });
        const deadline = Date.now() + LOOM_DRAFT_LLM_TIMEOUT_MS;
        while (Date.now() <= deadline) {
          const session = await llmExecutor.getSession(sessionId);
          if (session?.result) {
            if (session.result.status === 'completed') {
              if (resolved.bindingId) {
                runtimeResolver.markBindingUsed(resolved.bindingId).catch(() => { /* best effort */ });
              }
              return session.result.output;
            }
            throw new Error(session.result.error || `LLM runtime ended with status ${session.result.status}.`);
          }
          await sleep(LOOM_DRAFT_LLM_POLL_INTERVAL_MS);
        }
        throw new Error('LLM runtime timed out while drafting Loom task payload.');
      },
    });
  } catch (error) {
    await runtimeResolver.markRuntimeUnavailable(resolved.runtime.id).catch(() => {});
    return commandFailed(
      'llm_runtime_unavailable',
      error instanceof Error ? error.message : 'LLM runtime is unavailable.',
    );
  }
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
  // inbound-message handling for that profile. When omitted, the dispatcher
  // falls back to the shared autoReplyConfig (kept for tests/legacy callers).
  resolveAutoReplyConfigForHome?: (homeDir: string) => PrivateChatAutoReplyConfig;
}

type A2ARecoveredOrderProtocolMessage = A2ASimplemsgInboundDispatcherMessage & {
  localProfileSlug?: string | null;
};

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

export function createPrivateChatAutoReplyProfileDispatcher(
  input: PrivateChatAutoReplyProfileDispatcherOptions,
): PrivateChatAutoReplyProfileDispatcher {
  const orchestrators = new Map<string, PrivateChatAutoReplyOrchestrator>();
  const createOrchestrator = input.createOrchestrator ?? createPrivateChatAutoReplyOrchestrator;

  function getOrCreateOrchestrator(profile: IdentityProfileRecord): PrivateChatAutoReplyOrchestrator | null {
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
      ? input.resolveAutoReplyConfigForHome(profileHomeDir)
      : input.autoReplyConfig;
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
    }, profileAutoReplyConfig);

    orchestrators.set(cacheKey, orchestrator);
    return orchestrator;
  }

  return {
    async handleInboundMessage(profile, message) {
      const orchestrator = getOrCreateOrchestrator(profile);
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

  async function openLocalBrowserPage(input: {
    uri?: string;
  }): Promise<MetabotCommandResult<unknown>> {
    const baseUrl = await ensureDaemonBaseUrl(context);
    const browserPath = input.uri
      ? resolveLocalBrowserPath(input.uri)
      : '/browser';
    return commandSuccess({
      ...(input.uri ? { uri: input.uri } : {}),
      localUiUrl: `${baseUrl}${browserPath}`,
    });
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
    },
    buzz: {
      post: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/buzz/post',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    browser: {
      open: async (input) => openLocalBrowserPage(input),
    },
    chain: {
      write: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/chain/write',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
    },
    daemon: {
      start: async () => {
        const baseUrl = await ensureDaemonBaseUrl(context);
        const daemonRecord = await resolveDaemonRecord(context);
        const parsed = new URL(baseUrl);
        return commandSuccess({
          host: parsed.hostname,
          port: Number(parsed.port || '80'),
          baseUrl,
          pid: daemonRecord?.pid ?? null,
        });
      },
      stop: async () => {
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
        const activeHomeDir = await readActiveMetabotHome(systemHomeDir);
        let targetHomeDir: string | null = null;
        if (explicitHomeDir) {
          const explicitState = await createRuntimeStateStore(explicitHomeDir).readState();
          const explicitName = normalizeEnvText(explicitState.identity?.name);
          if (explicitName && explicitName !== normalizedName) {
            return commandFailed(
              'identity_name_conflict',
              `Current local identity is "${explicitName}". Switch profile first or choose the same name.`,
            );
          }
          if (explicitState.identity || explicitHomeDir === activeHomeDir) {
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
        const activeHomeDir = await readActiveMetabotHome(systemHomeDir);
        if (!activeHomeDir) {
          return commandFailed(
            'identity_profile_not_initialized',
            'No active profile initialized.'
          );
        }

        const profiles = await listIdentityProfiles(systemHomeDir);
        const activeProfile = profiles.find((profile) => profile.homeDir === activeHomeDir);
        if (!activeProfile) {
          return commandFailed(
            'identity_profile_not_initialized',
            'No active profile initialized.'
          );
        }

        return commandSuccess({
          activeHomeDir,
          systemHomeDir,
          identity: {
            name: activeProfile.name,
            slug: activeProfile.slug,
            aliases: activeProfile.aliases,
            globalMetaId: activeProfile.globalMetaId,
            mvcAddress: activeProfile.mvcAddress,
          },
        });
      },
      list: async () => {
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const profiles = await listIdentityProfiles(systemHomeDir);
        const activeHomeDir = await readActiveMetabotHome(systemHomeDir);
        return commandSuccess({
          systemHomeDir,
          activeHomeDir: activeHomeDir || null,
          profiles,
        });
      },
      assign: async (input) => {
        const targetName = normalizeEnvText(input.name);
        if (!targetName) {
          return commandFailed('missing_name', 'MetaBot identity name is required for identity assign.');
        }

        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const profiles = await listIdentityProfiles(systemHomeDir);
        const resolved = resolveProfileNameMatch(targetName, profiles);

        if (resolved.status === 'not_found') {
          return commandFailed(
            'identity_profile_not_found',
            resolved.message
          );
        }
        if (resolved.status === 'ambiguous') {
          return commandFailed(
            'identity_profile_ambiguous',
            resolved.message
          );
        }

        const selected = resolved.match;
        await setActiveMetabotHome({
          systemHomeDir,
          homeDir: selected.homeDir,
        });

        return commandSuccess({
          activeHomeDir: selected.homeDir,
          assignedProfile: selected,
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
      private: async (input) => requestJsonForSelectedActor(
        'POST',
        '/api/chat/private',
        typeof input.from === 'string' ? input.from : undefined,
        input,
      ),
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
    loom: {
      sync: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const paths = resolveMetabotPaths(homeDir);
        const cacheStore = createLoomRawCacheStore(paths);
        const pageSize = input.limit ? Math.max(1, Math.floor(input.limit)) : undefined;
        const maxPages = input.limit ? 1 : undefined;
        const syncResult = await readLoomRawChainRecords({
          chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
          pageSize,
          maxPages,
        });
        const state = await cacheStore.update(syncResult.records);
        const cachedRecords = Object.values(state.records).reduce(
          (total, records) => total + records.length,
          0,
        );
        return commandSuccess({
          fetchedRecords: syncResult.records.length,
          fetchedByProtocol: syncResult.byProtocol,
          cachedRecords,
          cachePath: cacheStore.cachePath,
          updatedAt: state.updatedAt,
        });
      },
      list: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const paths = resolveMetabotPaths(homeDir);
        const cacheStore = createLoomRawCacheStore(paths);
        let refreshed = false;
        if (input.refresh) {
          const syncResult = await readLoomRawChainRecords({
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
          });
          await cacheStore.update(syncResult.records);
          refreshed = true;
        }
        const state = await cacheStore.read();
        return commandSuccess({
          ...listLoomTasksFromCache(state, {
            limit: input.limit,
            tag: input.tag,
            currency: input.currency,
          }),
          cache: {
            path: cacheStore.cachePath,
            updatedAt: state.updatedAt,
            refreshed,
          },
        });
      },
      show: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const paths = resolveMetabotPaths(homeDir);
        const cacheStore = createLoomRawCacheStore(paths);
        let refreshed = false;
        if (input.refresh) {
          const syncResult = await readLoomRawChainRecords({
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
          });
          await cacheStore.update(syncResult.records);
          refreshed = true;
        }
        const state = await cacheStore.read();
        const projection = showLoomTaskFromCache(state, input.taskPinId);
        if (!projection.found) {
          return {
            ...commandFailed('task_not_found', `Loom task not found in cache: ${input.taskPinId}`),
            data: projection,
          };
        }
        return commandSuccess({
          ...projection,
          cache: {
            path: cacheStore.cachePath,
            updatedAt: state.updatedAt,
            refreshed,
          },
        });
      },
      dashboard: async (input) => {
        const actor = await resolveActorProfileReadonly(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const paths = resolveMetabotPaths(actor.homeDir);
        const rawCacheStore = createLoomRawCacheStore(paths);
        const dashboardStore = createLoomDashboardStore(paths);
        const service = createLoomDashboardService({
          rawCacheStore,
          dashboardStore,
          refreshRawCache: async (refreshInput) => {
            const pageSize = refreshInput.limit ? Math.max(1, Math.floor(refreshInput.limit)) : undefined;
            const maxPages = refreshInput.limit ? 1 : undefined;
            const syncResult = await readLoomRawChainRecords({
              chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
              pageSize,
              maxPages,
            });
            return rawCacheStore.update(syncResult.records);
          },
          readWorkflowStates: async () => {
            const rawState = await rawCacheStore.read();
            return listLocalLoomWorkflowsForRawCache(paths, rawState);
          },
          resolveActorContext: async () => ({
            globalMetaId: actor.profile.globalMetaId,
            address: actor.profile.mvcAddress,
            profileSlug: actor.profile.slug,
          }),
        });

        return service.getDashboard(input);
      },
      state: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const paths = resolveMetabotPaths(homeDir);
        const cacheStore = createLoomRawCacheStore(paths);
        let refreshed = false;
        if (input.refresh) {
          const syncResult = await readLoomRawChainRecords({
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
          });
          await cacheStore.update(syncResult.records);
          refreshed = true;
        }
        const rawState = await cacheStore.read();
        const projection = buildLoomWorkflowTaskState(rawState, input.taskPinId);
        const localWorkflows = await listLocalLoomWorkflowsForTask(paths, input.taskPinId);
        const cache = {
          path: cacheStore.cachePath,
          updatedAt: rawState.updatedAt,
          refreshed,
        };
        const data = {
          ...projection,
          cache,
          localWorkflows,
        };
        if (!projection.found) {
          return {
            ...commandFailed('task_not_found', projection.message),
            data,
          };
        }
        return commandSuccess(data);
      },
      draftTask: async (input) => {
        return draftLoomTaskFromWish(context, input);
      },
      postTask: async (input) => {
        if (input.from) {
          const actor = await resolveActorHomeDir(context, input.from);
          if (!('homeDir' in actor)) return actor;
        }
        return runLoomPostTaskWorkflow({
          from: input.from,
          payloadFile: input.payloadFile,
          wish: input.wish,
          chain: input.chain,
          dryRun: input.dryRun,
          readPayloadFile: (payloadFile) => readJsonObjectFile(context, payloadFile),
          draftTask: (wish) => draftLoomTaskFromWish(context, {
            wish,
            from: input.from,
            allowInvalid: false,
          }),
          writeChain: async (request) => context.dependencies.chain?.write?.(request)
            ?? commandFailed('dependency_unavailable', 'Chain write dependency is unavailable.'),
        });
      },
      claimAndStart: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const homeDir = actor.homeDir;
        const paths = resolveMetabotPaths(homeDir);
        const rawCacheStore = createLoomRawCacheStore(paths);
        const workflowStore = createLoomWorkflowStore(paths);
        const rawState = await readFreshLoomRawState(context, rawCacheStore);
        const taskState = buildLoomWorkflowTaskState(rawState, input.taskPinId);
        const signer = createCliSigner(context, homeDir);
        const identity = await signer.getIdentity();
        const runner = createNodeLoomCommandRunner();
        const developerMetaBotSlug = path.basename(paths.profileRoot);
        const runtimeStore = createLlmRuntimeStore(paths);
        await refreshLlmRuntimeStoreFromDiscovery(runtimeStore, context.env);
        const runtimeResolver = createCliLlmRuntimeResolver(paths);
        const resolvedRuntime = await runtimeResolver.resolveRuntime({ metaBotSlug: developerMetaBotSlug });
        if (!resolvedRuntime.runtime) {
          return commandFailed(
            'llm_runtime_unavailable',
            `No healthy LLM runtime is available for MetaBot ${developerMetaBotSlug}.`,
          );
        }
        const developerRuntime = summarizeResolvedLlmRuntime(resolvedRuntime);

        return runLoomClaimAndStartWorkflow({
          from: input.from,
          taskPinId: input.taskPinId,
          payoutAddress: input.payoutAddress,
          claimPinId: input.claimPinId,
          chain: input.chain,
          fileChain: input.fileChain,
          message: input.message,
          developerRuntime,
          dryRun: input.dryRun,
          resetWorkspace: input.resetWorkspace,
          developerMetaBotSlug,
          developerGlobalMetaId: identity.globalMetaId,
          state: taskState,
          workflowStore,
          runner,
          github: {
            assertToolsReady: assertGitHubToolsReady,
            prepareForkWorkspace: prepareGitHubForkWorkspace,
          },
          writeChain: async (request) => {
            const result = await signer.writePin(request);
            return commandSuccess({
              pinId: result.pinId,
              txids: result.txids,
              network: result.network,
              globalMetaId: result.globalMetaId,
              mvcAddress: result.mvcAddress,
            });
          },
          uploadFile: async (uploadInput) => uploadLocalFileToChain({
            filePath: uploadInput.filePath,
            contentType: uploadInput.contentType,
            network: uploadInput.network,
            signer,
          }),
          writeLogFile: writeLoomProcessLogFile,
          removePath: async (targetPath) => {
            await fs.promises.rm(targetPath, { recursive: true, force: true });
          },
          renamePath: async (from, to) => {
            await fs.promises.mkdir(path.dirname(to), { recursive: true });
            await fs.promises.rename(from, to);
          },
          pathExists: async (targetPath) => {
            try {
              await fs.promises.access(targetPath);
              return true;
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return false;
              }
              throw error;
            }
          },
        });
      },
      runDevRound: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) return actor;
        const homeDir = actor.homeDir;
        const paths = resolveMetabotPaths(homeDir);
        const rawCacheStore = createLoomRawCacheStore(paths);
        const workflowStore = createLoomWorkflowStore(paths);
        const rawState = await readFreshLoomRawState(context, rawCacheStore);
        const taskState = buildLoomWorkflowTaskState(rawState, input.taskPinId);
        const signer = createCliSigner(context, homeDir);
        const identity = await signer.getIdentity();
        const runner = createNodeLoomCommandRunner();
        const developerMetaBotSlug = path.basename(paths.profileRoot);
        const workflow = await workflowStore.read(input.taskPinId, input.claimPinId);
        if (!workflow) {
          return commandFailed('claim_not_found', `Local Loom workflow state was not found for claim ${input.claimPinId}.`);
        }
        if (workflow.developerGlobalMetaId && workflow.developerGlobalMetaId !== identity.globalMetaId) {
          return commandFailed('permission_denied', `Loom claim ${input.claimPinId} belongs to another developer.`);
        }

        const runtimeStore = createLlmRuntimeStore(paths);
        await refreshLlmRuntimeStoreFromDiscovery(runtimeStore, context.env);
        const runtimeResolver = createCliLlmRuntimeResolver(paths);
        const resolved = await runtimeResolver.resolveRuntime({ metaBotSlug: developerMetaBotSlug });
        if (!resolved.runtime || resolved.runtime.health !== 'healthy') {
          return commandFailed(
            'llm_runtime_unavailable',
            `No healthy LLM runtime is available for MetaBot ${developerMetaBotSlug}.`,
          );
        }
        const llmExecutor = new LlmExecutor({
          sessionsRoot: paths.llmExecutorSessionsRoot,
          transcriptsRoot: paths.llmExecutorTranscriptsRoot,
          skillsRoot: paths.skillsRoot,
          systemHomeDir: paths.systemHomeDir,
          env: context.env,
          backends: createRegistryBackendFactories(),
        });

        return runLoomDevRoundWorkflow({
          from: input.from,
          taskPinId: input.taskPinId,
          claimPinId: input.claimPinId,
          chain: input.chain,
          fileChain: input.fileChain,
          checks: input.checks,
          roundNote: input.roundNote,
          developerMetaBotSlug,
          developerGlobalMetaId: identity.globalMetaId,
          state: taskState,
          workflowStore,
          runner,
          executeLlmRound: async (prompt, cwd) => runLlmPromptWithRuntimeFallback({
            runtimeResolver,
            llmExecutor,
            metaBotSlug: developerMetaBotSlug,
            prompt,
            timeoutMs: LOOM_DEV_ROUND_LLM_TIMEOUT_MS,
            pollIntervalMs: LOOM_DRAFT_LLM_POLL_INTERVAL_MS,
            cwd,
          }),
          writeChain: async (request) => {
            const result = await signer.writePin(request);
            return commandSuccess({
              pinId: result.pinId,
              txids: result.txids,
              network: result.network,
              globalMetaId: result.globalMetaId,
              mvcAddress: result.mvcAddress,
            });
          },
          uploadFile: async (uploadInput) => uploadLocalFileToChain({
            filePath: uploadInput.filePath,
            contentType: uploadInput.contentType,
            network: uploadInput.network,
            signer,
          }),
          writeLogFile: writeLoomProcessLogFile,
        });
      },
      deliver: async (input) => {
        const actor = input.dryRun
          ? await resolveActorProfileReadonly(context, input.from)
          : await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const paths = resolveMetabotPaths(homeDir);
        const rawCacheStore = createLoomRawCacheStore(paths);
        const workflowStore = createLoomWorkflowStore(paths);
        const rawState = await readFreshLoomRawState(context, rawCacheStore);
        const taskState = buildLoomWorkflowTaskState(rawState, input.taskPinId);
        const runner = createNodeLoomCommandRunner();
        const developerMetaBotSlug = path.basename(paths.profileRoot);
        const signer = input.dryRun ? null : createCliSigner(context, homeDir);
        const dryRunProfile = (actor as { profile?: IdentityProfileRecord }).profile;
        const developerGlobalMetaId = dryRunProfile
          ? dryRunProfile.globalMetaId
          : (await (signer as Signer).getIdentity()).globalMetaId;

        return runLoomDeliverWorkflow({
          from: input.from,
          taskPinId: input.taskPinId,
          claimPinId: input.claimPinId,
          chain: input.chain,
          prTitle: input.prTitle,
          deliverySummary: input.deliverySummary,
          dryRun: input.dryRun,
          developerMetaBotSlug,
          developerGlobalMetaId,
          state: taskState,
          workflowStore,
          runner,
          github: {
            assertToolsReady: assertGitHubToolsReady,
            pushLoomBranch,
            createLoomPullRequest,
          },
          writeChain: async (request) => {
            if (!signer) {
              return commandFailed('chain_write_unavailable', 'Dry-run delivery must not write chain data.');
            }
            const result = await signer.writePin(request);
            return commandSuccess({
              pinId: result.pinId,
              txids: result.txids,
              network: result.network,
              globalMetaId: result.globalMetaId,
              mvcAddress: result.mvcAddress,
            });
          },
        });
      },
      acceptAndPay: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const paths = resolveMetabotPaths(homeDir);
        const rawCacheStore = createLoomRawCacheStore(paths);
        const workflowStore = createLoomWorkflowStore(paths);
        const rawStateResult = input.confirmPayment
          ? await requireFreshLoomRawState(context, rawCacheStore)
          : commandSuccess(await readFreshLoomRawState(context, rawCacheStore));
        if (!rawStateResult.ok) {
          return rawStateResult;
        }
        const rawState = rawStateResult.data;
        const taskState = buildLoomWorkflowTaskState(rawState, input.taskPinId);
        const signer = createCliSigner(context, homeDir);
        const identity = await signer.getIdentity();

        return runLoomAcceptAndPayWorkflow({
          from: input.from,
          taskPinId: input.taskPinId,
          deliveryPinId: input.deliveryPinId,
          score: input.score,
          comment: input.comment,
          chain: input.chain,
          confirmPayment: input.confirmPayment,
          requesterGlobalMetaId: identity.globalMetaId,
          state: taskState,
          workflowStore,
          walletTransfer: async (transferInput) => runWalletTransferRuntime(context, transferInput),
          writeChain: async (request) => {
            const result = await signer.writePin(request);
            return commandSuccess({
              pinId: result.pinId,
              txids: result.txids,
              network: result.network,
              globalMetaId: result.globalMetaId,
              mvcAddress: result.mvcAddress,
            });
          },
        });
      },
      reviewDelivery: async (input) => {
        const actor = await resolveActorHomeDir(context, input.from);
        if (!('homeDir' in actor)) {
          return actor;
        }
        const homeDir = actor.homeDir;
        const paths = resolveMetabotPaths(homeDir);
        const rawCacheStore = createLoomRawCacheStore(paths);
        const workflowStore = createLoomWorkflowStore(paths);
        const rawState = await readFreshLoomRawState(context, rawCacheStore);
        const taskState = buildLoomWorkflowTaskState(rawState, input.taskPinId);
        const signer = createCliSigner(context, homeDir);
        const identity = await signer.getIdentity();

        return runLoomReviewDeliveryWorkflow({
          from: input.from,
          taskPinId: input.taskPinId,
          deliveryPinId: input.deliveryPinId,
          verdict: input.verdict,
          score: input.score,
          comment: input.comment,
          chain: input.chain,
          attachments: input.attachments,
          requesterGlobalMetaId: identity.globalMetaId,
          state: taskState,
          workflowStore,
          writeChain: async (request) => {
            const result = await signer.writePin(request);
            return commandSuccess({
              pinId: result.pinId,
              txids: result.txids,
              network: result.network,
              globalMetaId: result.globalMetaId,
              mvcAddress: result.mvcAddress,
            });
          },
        });
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
    chain: { ...defaults.chain, ...provided.chain },
    daemon: { ...defaults.daemon, ...provided.daemon },
    doctor: { ...defaults.doctor, ...provided.doctor },
    identity: { ...defaults.identity, ...provided.identity },
    network: { ...defaults.network, ...provided.network },
    services: { ...defaults.services, ...provided.services },
    provider: { ...defaults.provider, ...provided.provider },
    chat: { ...defaults.chat, ...provided.chat },
    file: { ...defaults.file, ...provided.file },
    wallet: { ...defaults.wallet, ...provided.wallet },
    trace: { ...defaults.trace, ...provided.trace },
    ui: { ...defaults.ui, ...provided.ui },
    skills: { ...defaults.skills, ...provided.skills },
    host: { ...defaults.host, ...provided.host },
    system: { ...defaults.system, ...provided.system },
    llm: { ...defaults.llm, ...provided.llm },
    loom: { ...defaults.loom, ...provided.loom },
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
  const daemonStore = createDaemonStateStore(daemonPaths);
  let daemonRecord: GlobalDaemonRecord | null = null;
  const secretStore = createFileSecretStore(homeDir);
  const adapters = createDefaultChainAdapterRegistry();
  const baseSigner = createLocalMnemonicSigner({ secretStore, adapters });
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
  let onProviderPresenceChanged: (enabled: boolean) => Promise<void> = async () => {};

  const handlers = createDefaultMetabotDaemonHandlers({
    homeDir,
    systemHomeDir,
    getDaemonRecord: () => daemonRecord,
    secretStore,
    signer,
    adapters,
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
    requestMvcGasSubsidy,
    createSignerForHome: (profileHomeDir) => {
      const profileBaseSigner = createLocalMnemonicSigner({
        secretStore: createFileSecretStore(profileHomeDir),
        adapters,
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
    await refreshOnlineServiceCacheFromChain({
      store: onlineServiceCacheStore,
      ratingDetailStateStore,
      chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
      socketPresenceApiBaseUrl,
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
  const serviceRefundSyncLoop = createServiceRefundSyncLoop({
    syncRefunds: async () => {
      const result = await handlers.services?.syncRefunds?.({});
      if (result && !result.ok) {
        throw new Error(result.message ?? result.code ?? 'service_refund_sync_failed');
      }
    },
    logWarning: (message) => console.warn(message),
  });

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
  }, sharedAutoReplyConfig);
  const chatAutoReplyBackfill = createPrivateChatAutoReplyBackfillLoop({
    paths,
    stateStore: chatStateStore,
    selfGlobalMetaId: async () => {
      const state = await runtimeStore.readState();
      return state.identity?.globalMetaId ?? null;
    },
    getLocalPrivateChatIdentity: async () => signer.getPrivateChatIdentity(),
    resolvePeerChatPublicKey,
    handleInboundMessage: async (message) => chatAutoReplyOrchestrator.handleInboundMessage(message),
    onError: (error) => {
      console.warn('[private chat auto-reply backfill]', error.message);
    },
  });
  const profileAutoReplyDispatcher = createPrivateChatAutoReplyProfileDispatcher({
    autoReplyConfig: sharedAutoReplyConfig,
    resolvePeerChatPublicKey,
    llmExecutor,
    // Wire the live per-home config resolver so each profile orchestrator reads
    // the same object that handlers.chat.setAutoReply mutates. Without this,
    // toggling Auto-Reply off in /ui/bot (or via the CLI) for a non-default bot
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
  const simplemsgPresenceWatchdog = createA2ASimplemsgPresenceWatchdog({
    manager: simplemsgListener,
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
      watchdog: simplemsgPresenceWatchdog,
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
      watchdog: simplemsgPresenceWatchdog,
    });
    chatAutoReplyBackfill.start();
  };
  const providerPresence = await providerPresenceStore.read();
  if (daemonConfig.a2a.simplemsgListenerEnabled && providerPresence.enabled) {
    await simplemsgListener.start();
    simplemsgPresenceWatchdog.start();
    chatAutoReplyBackfill.start();
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
    clearInterval(onlineServiceCacheInterval);
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
