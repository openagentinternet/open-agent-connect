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
import { createMetabotDaemon } from '../daemon';
import { createDefaultMetabotDaemonHandlers, fetchPeerChatPublicKey as fetchPeerChatPublicKeyFromChain, llmDiscoverySweepRunningForHomeDir, type A2ACallerReplyResumeReport } from '../daemon/defaultHandlers';
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
    return commandSuccess({
      uri: typeof data.uri === 'string' ? data.uri : input.uri,
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
    );
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
    metaid: { ...defaults.metaid, ...provided.metaid },
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
    onBrowserInfrastructureChanged: () => refreshA2ASimplemsgListenerAfterInfrastructureChange(),
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
    clearInterval(onlineServiceCacheInterval);
    clearInterval(providerWorkspaceSweepInterval);
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
