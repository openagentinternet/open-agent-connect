import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { createConfigStore, type ConfigStore } from '../core/config/configStore';
import type { AskMasterTriggerMode } from '../core/config/configTypes';
import { createNetworkDirectoryEvolutionService } from '../core/evolution/service';
import { createLocalEvolutionStore, parseSkillActiveVariantRef } from '../core/evolution/localEvolutionStore';
import { createRemoteEvolutionStore } from '../core/evolution/remoteEvolutionStore';
import { publishEvolutionArtifact } from '../core/evolution/publish/publishArtifact';
import { createChainEvolutionReader } from '../core/evolution/import/chainEvolutionReader';
import { importPublishedEvolutionArtifact } from '../core/evolution/import/importArtifact';
import { listImportedEvolutionArtifacts } from '../core/evolution/import/listImportedArtifacts';
import { deriveResolvedScopeHash, searchPublishedEvolutionArtifacts } from '../core/evolution/import/searchArtifacts';
import { adoptRemoteEvolutionArtifact } from '../core/evolution/remoteAdoption';
import { uploadLocalFileToChain } from '../core/files/uploadFile';
import {
  listIdentityProfiles,
  readActiveMetabotHome,
  setActiveMetabotHome,
  upsertIdentityProfile,
} from '../core/identity/identityProfiles';
import { resolveProfileNameMatch } from '../core/identity/profileNameResolution';
import { renderResolvedSkillContract } from '../core/skills/skillResolver';
import type { SkillHost, SkillRenderFormat, SkillVariantArtifact } from '../core/skills/skillContractTypes';
import type { SkillActiveVariantRef } from '../core/evolution/types';
import { resolveMetabotPaths } from '../core/state/paths';
import {
  normalizeSystemHomeDir as normalizeSelectedSystemHomeDir,
  resolveMetabotHomeSelectionSync,
} from '../core/state/homeSelection';
import {
  createRuntimeStateStore,
  type RuntimeDaemonRecord,
} from '../core/state/runtimeStateStore';
import { createProviderHeartbeatLoop } from '../core/provider/providerHeartbeatLoop';
import { createProviderPresenceStateStore } from '../core/provider/providerPresenceState';
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import { createLocalMnemonicSigner } from '../core/signing/localMnemonicSigner';
import { normalizeChainWriteRequest } from '../core/chain/writePin';
import type { Signer } from '../core/signing/signer';
import { createMetabotDaemon } from '../daemon';
import { createDefaultMetabotDaemonHandlers } from '../daemon/defaultHandlers';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import type { MetaWebServiceReplyWaiter } from '../core/a2a/metawebReplyWaiter';
import { createSocketIoMetaWebMasterReplyWaiter, type MetaWebMasterReplyWaiter } from '../core/master/metawebMasterReplyWaiter';
import { parseMasterResponse } from '../core/master/masterMessageSchema';
import type { CliDependencies, CliRuntimeContext } from './types';

const DEFAULT_DAEMON_BASE_URL = 'http://127.0.0.1:4827';
const DEFAULT_DAEMON_HOST = '127.0.0.1';
const DEFAULT_DAEMON_START_TIMEOUT_MS = 5_000;
const DAEMON_START_POLL_INTERVAL_MS = 100;
const DAEMON_PREFERRED_PORT_ENV = 'METABOT_DAEMON_PREFERRED_PORT';
const DEFAULT_DAEMON_PORT_BASE = 24_000;
const DEFAULT_DAEMON_PORT_SPAN = 20_000;
const TEST_FAKE_CHAIN_WRITE_ENV = 'METABOT_TEST_FAKE_CHAIN_WRITE';
const TEST_FAKE_SUBSIDY_ENV = 'METABOT_TEST_FAKE_SUBSIDY';
const TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV = 'METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY';
const TEST_FAKE_METAWEB_REPLY_ENV = 'METABOT_TEST_FAKE_METAWEB_REPLY';
const TEST_FAKE_MASTER_REPLY_ENV = 'METABOT_TEST_FAKE_MASTER_REPLY';
const ALLOW_UNINDEXED_HOME_ENV = 'METABOT_ALLOW_UNINDEXED_HOME';
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
const METALET_HOST = 'https://www.metalet.space';
const CHAIN_NET = 'livenet';
const MAX_MVC_BALANCE_QUERY_PAGES = 200;
let cachedDaemonRuntimeFingerprint: string | null = null;

type EvolutionPublishFailureCode =
  | 'evolution_variant_not_found'
  | 'evolution_variant_skill_mismatch'
  | 'evolution_variant_analysis_mismatch'
  | 'evolution_variant_scope_hash_missing'
  | 'evolution_variant_not_verified'
  | 'evolution_publish_not_supported';

type EvolutionRuntimeFailureCode =
  | 'evolution_search_not_supported'
  | 'evolution_scope_hash_missing'
  | 'evolution_chain_query_failed'
  | 'evolution_search_result_invalid'
  | 'evolution_search_index_failed'
  | 'evolution_import_metadata_invalid'
  | 'evolution_import_pin_not_found'
  | 'evolution_import_not_supported'
  | 'evolution_import_scope_mismatch'
  | 'evolution_import_variant_conflict'
  | 'evolution_import_artifact_fetch_failed'
  | 'evolution_import_artifact_invalid'
  | 'evolution_imported_not_supported'
  | 'evolution_imported_artifact_invalid'
  | 'evolution_remote_adopt_not_supported'
  | 'evolution_remote_variant_not_found'
  | 'evolution_remote_variant_skill_mismatch'
  | 'evolution_remote_variant_scope_mismatch'
  | 'evolution_remote_variant_invalid';

const EVOLUTION_IMPORT_SKILL_NAME = 'metabot-network-directory';

interface MetaletEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

interface MetaletMvcUtxoListItem {
  flag?: string;
  value?: number;
  height?: number;
}

interface WalletMvcBalanceSnapshot {
  chain: 'mvc';
  address: string;
  totalSatoshis: number;
  confirmedSatoshis: number;
  unconfirmedSatoshis: number;
  utxoCount: number;
  totalMvc: number;
}

interface WalletBtcBalanceSnapshot {
  chain: 'btc';
  address: string;
  totalSatoshis: number;
  confirmedSatoshis: number;
  unconfirmedSatoshis: number;
  totalBtc: number;
  confirmedBtc: number;
  unconfirmedBtc: number;
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

async function fetchMvcBalanceSnapshot(address: string): Promise<WalletMvcBalanceSnapshot> {
  let flag = '';
  let totalSatoshis = 0;
  let confirmedSatoshis = 0;
  let unconfirmedSatoshis = 0;
  let utxoCount = 0;

  for (let page = 0; page < MAX_MVC_BALANCE_QUERY_PAGES; page += 1) {
    const params = new URLSearchParams({
      address,
      net: CHAIN_NET,
      ...(flag ? { flag } : {}),
    });
    const data = await fetchMetaletData<{ list?: MetaletMvcUtxoListItem[] }>(
      `${METALET_HOST}/wallet-api/v4/mvc/address/utxo-list?${params}`,
    );
    const list = Array.isArray(data?.list) ? data.list : [];
    if (!list.length) {
      break;
    }

    for (const utxo of list) {
      const satoshis = Math.max(0, Math.floor(toFiniteNumber(utxo.value)));
      totalSatoshis += satoshis;
      utxoCount += 1;
      if (toFiniteNumber(utxo.height) > 0) {
        confirmedSatoshis += satoshis;
      } else {
        unconfirmedSatoshis += satoshis;
      }
    }

    const nextFlag = normalizeEnvText(list[list.length - 1]?.flag);
    if (!nextFlag || nextFlag === flag) {
      break;
    }
    flag = nextFlag;
  }

  return {
    chain: 'mvc',
    address,
    totalSatoshis,
    confirmedSatoshis,
    unconfirmedSatoshis,
    utxoCount,
    totalMvc: totalSatoshis / 1e8,
  };
}

async function fetchBtcBalanceSnapshot(address: string): Promise<WalletBtcBalanceSnapshot> {
  const params = new URLSearchParams({
    address,
    net: CHAIN_NET,
  });
  const data = await fetchMetaletData<{
    balance?: number;
    safeBalance?: number;
    pendingBalance?: number;
  }>(`${METALET_HOST}/wallet-api/v3/address/btc-balance?${params}`);

  const totalBtc = Math.max(0, toFiniteNumber(data?.balance));
  const confirmedBtc = Math.max(0, toFiniteNumber(data?.safeBalance ?? data?.balance));
  const unconfirmedBtc = toFiniteNumber(data?.pendingBalance);

  return {
    chain: 'btc',
    address,
    totalSatoshis: Math.round(totalBtc * 1e8),
    confirmedSatoshis: Math.round(confirmedBtc * 1e8),
    unconfirmedSatoshis: Math.round(unconfirmedBtc * 1e8),
    totalBtc,
    confirmedBtc,
    unconfirmedBtc,
  };
}

function parseDaemonPort(value: string | undefined): number | null {
  const parsed = Number.parseInt(normalizeEnvText(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function getLegacyDefaultDaemonPort(): number {
  try {
    const parsed = new URL(DEFAULT_DAEMON_BASE_URL);
    const port = Number.parseInt(parsed.port, 10);
    if (Number.isInteger(port) && port > 0) {
      return port;
    }
  } catch {
    // Ignore malformed defaults and fall back below.
  }
  return 4827;
}

export function getDefaultDaemonPort(homeDir?: string): number {
  const normalizedHomeDir = typeof homeDir === 'string' ? homeDir.trim() : '';
  if (!normalizedHomeDir) {
    return getLegacyDefaultDaemonPort();
  }

  try {
    const digest = createHash('sha256')
      .update(path.resolve(normalizedHomeDir))
      .digest();
    const offset = digest.readUInt32BE(0) % DEFAULT_DAEMON_PORT_SPAN;
    return DEFAULT_DAEMON_PORT_BASE + offset;
  } catch {
    return getLegacyDefaultDaemonPort();
  }
}

function isAddressInUseError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EADDRINUSE'
  );
}

type SupportedBooleanConfigKey =
  | 'evolution_network.enabled'
  | 'evolution_network.autoAdoptSameSkillSameScope'
  | 'evolution_network.autoRecordExecutions'
  | 'askMaster.enabled';

type SupportedEnumConfigKey =
  | 'askMaster.triggerMode';

type SupportedConfigKey = SupportedBooleanConfigKey | SupportedEnumConfigKey;

type SupportedConfigValue = boolean | AskMasterTriggerMode;

const SUPPORTED_CONFIG_KEYS = new Set<SupportedConfigKey>([
  'evolution_network.enabled',
  'evolution_network.autoAdoptSameSkillSameScope',
  'evolution_network.autoRecordExecutions',
  'askMaster.enabled',
  'askMaster.triggerMode',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function compareCodePointStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function projectActiveVariantIds(activeVariants: Record<string, unknown>): Record<string, string> {
  const entries: Array<[string, string]> = [];
  for (const [skillName, rawRef] of Object.entries(activeVariants)) {
    const activeRef = parseSkillActiveVariantRef(rawRef);
    if (!activeRef) {
      continue;
    }
    entries.push([skillName, activeRef.variantId]);
  }
  entries.sort(([left], [right]) => compareCodePointStrings(left, right));
  return Object.fromEntries(entries);
}

function projectActiveVariantRefs(
  activeVariants: Record<string, unknown>,
): Record<string, SkillActiveVariantRef> {
  const entries: Array<[string, SkillActiveVariantRef]> = [];
  for (const [skillName, rawRef] of Object.entries(activeVariants)) {
    const activeRef = parseSkillActiveVariantRef(rawRef);
    if (!activeRef) {
      continue;
    }
    entries.push([skillName, activeRef]);
  }
  entries.sort(([left], [right]) => compareCodePointStrings(left, right));
  return Object.fromEntries(entries);
}

function isSupportedConfigKey(key: string): key is SupportedConfigKey {
  return SUPPORTED_CONFIG_KEYS.has(key as SupportedConfigKey);
}

function isSupportedBooleanConfigKey(key: SupportedConfigKey): key is SupportedBooleanConfigKey {
  return key === 'evolution_network.enabled'
    || key === 'evolution_network.autoAdoptSameSkillSameScope'
    || key === 'evolution_network.autoRecordExecutions'
    || key === 'askMaster.enabled';
}

function readConfigValue(
  config: Awaited<ReturnType<ConfigStore['read']>>,
  key: SupportedConfigKey,
): SupportedConfigValue {
  if (key === 'evolution_network.enabled') {
    return config.evolution_network.enabled;
  }
  if (key === 'evolution_network.autoAdoptSameSkillSameScope') {
    return config.evolution_network.autoAdoptSameSkillSameScope;
  }
  if (key === 'evolution_network.autoRecordExecutions') {
    return config.evolution_network.autoRecordExecutions;
  }
  if (key === 'askMaster.enabled') {
    return config.askMaster.enabled;
  }
  if (key === 'askMaster.triggerMode') {
    return config.askMaster.triggerMode;
  }
  return config.evolution_network.autoRecordExecutions;
}

function writeConfigValue(
  config: Awaited<ReturnType<ConfigStore['read']>>,
  key: SupportedConfigKey,
  value: SupportedConfigValue,
): Awaited<ReturnType<ConfigStore['read']>> {
  if (key === 'askMaster.enabled') {
    return {
      ...config,
      askMaster: {
        ...config.askMaster,
        enabled: value === true,
      },
    };
  }
  if (key === 'askMaster.triggerMode') {
    return {
      ...config,
      askMaster: {
        ...config.askMaster,
        triggerMode: value as AskMasterTriggerMode,
      },
    };
  }
  if (key === 'evolution_network.enabled') {
    return {
      ...config,
      evolution_network: {
        ...config.evolution_network,
        enabled: value === true,
      },
    };
  }
  if (key === 'evolution_network.autoAdoptSameSkillSameScope') {
    return {
      ...config,
      evolution_network: {
        ...config.evolution_network,
        autoAdoptSameSkillSameScope: value === true,
      },
    };
  }
  return {
    ...config,
    evolution_network: {
      ...config.evolution_network,
      autoRecordExecutions: value === true,
    },
  };
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

  if (input.key === 'askMaster.triggerMode') {
    if (input.value !== 'manual' && input.value !== 'suggest') {
      return {
        ok: false,
        message: 'Config value for askMaster.triggerMode must be one of `manual` or `suggest`.',
      };
    }
    return {
      ok: true,
      value: input.value,
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
      fakeMasterReply: normalizeEnvText(env[TEST_FAKE_MASTER_REPLY_ENV]),
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
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

async function waitForPortRelease(host: string, port: number, timeoutMs: number): Promise<void> {
  if (!Number.isInteger(port) || port <= 0) {
    return;
  }

  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    if (await isPortBindable(host, port)) {
      return;
    }
    await sleep(DAEMON_START_POLL_INTERVAL_MS);
  }
}

async function isDaemonReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/daemon/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveDaemonRecord(
  context: CliRuntimeContext,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): Promise<RuntimeDaemonRecord | null> {
  const homeDir = normalizeHomeDir(context.env, context.cwd, options);
  const store = createRuntimeStateStore(homeDir);
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

async function stopRunningDaemon(daemonRecord: RuntimeDaemonRecord): Promise<void> {
  if (!Number.isFinite(daemonRecord.pid) || daemonRecord.pid <= 0) {
    return;
  }

  try {
    process.kill(daemonRecord.pid, 'SIGTERM');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') {
      return;
    }
    throw error;
  }

  const startedAt = Date.now();
  while ((Date.now() - startedAt) < DAEMON_CONFIG_RESTART_TIMEOUT_MS) {
    if (!await isDaemonReachable(daemonRecord.baseUrl)) {
      await waitForPortRelease(daemonRecord.host || DEFAULT_DAEMON_HOST, daemonRecord.port, DAEMON_CONFIG_RESTART_TIMEOUT_MS)
        .catch(() => {});
      return;
    }
    await sleep(DAEMON_START_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out while restarting the local MetaBot daemon with updated configuration.');
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

  const daemonRecord = await resolveDaemonRecord(context, options);
  if (daemonRecord?.baseUrl && await isDaemonReachable(daemonRecord.baseUrl)) {
    if (daemonConfigMatchesContext(daemonRecord, context)) {
      return daemonRecord.baseUrl;
    }
    await stopRunningDaemon(daemonRecord);
    return startDetachedDaemon(context, daemonRecord, options);
  }

  return startDetachedDaemon(context, undefined, options);
}

async function startDetachedDaemon(
  context: CliRuntimeContext,
  preferredRecord?: RuntimeDaemonRecord | null,
  options: { allowUnindexedExplicitHome?: boolean } = {},
): Promise<string> {
  const homeDir = normalizeHomeDir(context.env, context.cwd, options);
  const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
  const store = createRuntimeStateStore(homeDir);
  const expectedConfigHash = buildDaemonConfigHash(context.env);
  const persistedRecord = await store.readDaemon();
  const staleRecord = persistedRecord ?? preferredRecord ?? null;
  if (persistedRecord?.baseUrl && await isDaemonReachable(persistedRecord.baseUrl)) {
    if (daemonConfigMatchesContext(persistedRecord, context)) {
      return persistedRecord.baseUrl;
    }
    await stopRunningDaemon(persistedRecord);
  }
  await store.clearDaemon();

  const child = spawn(
    process.execPath,
    [resolveCliEntrypoint(), 'daemon', 'serve'],
    {
      cwd: homeDir,
      detached: true,
      stdio: 'ignore',
      env: {
        ...context.env,
        HOME: systemHomeDir,
        METABOT_HOME: homeDir,
        ...(options.allowUnindexedExplicitHome ? { [ALLOW_UNINDEXED_HOME_ENV]: '1' } : {}),
        [DAEMON_PREFERRED_PORT_ENV]: String(
          parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV])
          ?? staleRecord?.port
          ?? getDefaultDaemonPort(homeDir)
        ),
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
      && await isDaemonReachable(daemonRecord.baseUrl)
    ) {
      return daemonRecord.baseUrl;
    }
    await sleep(DAEMON_START_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out while starting the local MetaBot daemon.');
}

async function requestJson<T>(
  context: CliRuntimeContext,
  method: 'GET' | 'POST' | 'DELETE',
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

async function observeNetworkDirectoryExecutionSafely(
  context: CliRuntimeContext,
  observation: Parameters<ReturnType<typeof createNetworkDirectoryEvolutionService>['observeNetworkDirectoryExecution']>[0],
): Promise<void> {
  try {
    const homeDir = normalizeHomeDir(context.env, context.cwd);
    const evolutionService = createNetworkDirectoryEvolutionService(homeDir);
    await evolutionService.observeNetworkDirectoryExecution(observation);
  } catch {
    // Evolution observation must never block normal CLI command execution.
  }
}

type NetworkListServicesHandler = NonNullable<NonNullable<CliDependencies['network']>['listServices']>;

function wrapNetworkListServicesDependency(
  context: CliRuntimeContext,
  listServices: NetworkListServicesHandler | undefined,
): NetworkListServicesHandler | undefined {
  if (!listServices) {
    return undefined;
  }

  return async (input: Parameters<NetworkListServicesHandler>[0]) => {
    if (input.online !== true) {
      return listServices(input);
    }

    const startedAt = Date.now();
    try {
      const result = await listServices(input);
      if (result.state === 'waiting' || result.state === 'manual_action_required') {
        return result;
      }
      const finishedAt = Date.now();
      await observeNetworkDirectoryExecutionSafely(context, {
        skillName: 'metabot-network-directory',
        commandTemplate: 'metabot network services --online',
        startedAt,
        finishedAt,
        envelope: result as Record<string, unknown>,
        stdout: '',
        stderr: result.ok ? '' : (result.message ?? ''),
        usedUiFallback: false,
        manualRecovery: false,
      });
      return result;
    } catch (error) {
      const finishedAt = Date.now();
      const message = error instanceof Error ? error.message : String(error);
      await observeNetworkDirectoryExecutionSafely(context, {
        skillName: 'metabot-network-directory',
        commandTemplate: 'metabot network services --online',
        startedAt,
        finishedAt,
        envelope: commandFailed('network_services_execution_failed', message) as Record<string, unknown>,
        stdout: '',
        stderr: message,
        usedUiFallback: false,
        manualRecovery: false,
      });
      throw error;
    }
  };
}

async function resolveActiveVariantForSkill(
  context: CliRuntimeContext,
  skillName: string,
): Promise<{
  activeVariant: SkillVariantArtifact | null;
  activeVariantSource: 'local' | 'remote' | null;
}> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
  const evolutionStore = createLocalEvolutionStore(homeDir);
  const index = await evolutionStore.readIndex();
  const activeVariantRef = parseSkillActiveVariantRef(index.activeVariants[skillName]);
  if (!activeVariantRef) {
    return {
      activeVariant: null,
      activeVariantSource: null,
    };
  }

  let artifact: SkillVariantArtifact | Record<string, unknown> | null;
  if (activeVariantRef.source === 'local') {
    const artifactPath = path.join(evolutionStore.paths.evolutionArtifactsRoot, `${activeVariantRef.variantId}.json`);
    artifact = await readArtifactFile(artifactPath);
  } else {
    try {
      const remoteStore = createRemoteEvolutionStore(homeDir);
      artifact = await remoteStore.readArtifact(activeVariantRef.variantId);
    } catch {
      artifact = null;
    }
  }
  if (!artifact || artifact.skillName !== skillName) {
    return {
      activeVariant: null,
      activeVariantSource: null,
    };
  }

  return {
    activeVariant: {
      ...(artifact as SkillVariantArtifact),
      // Active refs are the source of truth even for imported remote artifacts,
      // which remain stored as inactive bodies in the remote cache.
      status: 'active',
    },
    activeVariantSource: activeVariantRef.source,
  };
}

async function clearActiveVariantMapping(
  context: CliRuntimeContext,
  skillName: string,
): Promise<{ removed: boolean; previousVariantId: string | null }> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
  const evolutionStore = createLocalEvolutionStore(homeDir);
  const index = await evolutionStore.readIndex();
  const previousVariantRef = parseSkillActiveVariantRef(index.activeVariants[skillName]);
  if (!previousVariantRef) {
    return {
      removed: false,
      previousVariantId: null,
    };
  }

  await evolutionStore.clearActiveVariant(skillName);

  return {
    removed: true,
    previousVariantId: previousVariantRef.variantId,
  };
}

async function resolveEvolutionScopeHashForSkill(input: {
  context: CliRuntimeContext;
  skillName: string;
  evolutionNetworkEnabled: boolean;
}): Promise<string> {
  const resolvedActiveVariant = input.evolutionNetworkEnabled
    ? await resolveActiveVariantForSkill(input.context, input.skillName)
    : { activeVariant: null, activeVariantSource: null };
  const rendered = renderResolvedSkillContract({
    skillName: input.skillName,
    host: 'codex',
    format: 'json',
    evolutionNetworkEnabled: input.evolutionNetworkEnabled,
    activeVariant: resolvedActiveVariant.activeVariant,
    activeVariantSource: resolvedActiveVariant.activeVariantSource,
  });
  return deriveResolvedScopeHash(rendered.contract);
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
      return {
        txids: [`${request.path || 'metaid'}-tx-${writeCount}`],
        pinId: `${request.path || 'metaid'}-pin-${writeCount}`,
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

function isEvolutionPublishFailureCode(value: unknown): value is EvolutionPublishFailureCode {
  return value === 'evolution_variant_not_found'
    || value === 'evolution_variant_skill_mismatch'
    || value === 'evolution_variant_analysis_mismatch'
    || value === 'evolution_variant_scope_hash_missing'
    || value === 'evolution_variant_not_verified'
    || value === 'evolution_publish_not_supported';
}

function isEvolutionRuntimeFailureCode(value: unknown): value is EvolutionRuntimeFailureCode {
  return value === 'evolution_search_not_supported'
    || value === 'evolution_scope_hash_missing'
    || value === 'evolution_chain_query_failed'
    || value === 'evolution_search_result_invalid'
    || value === 'evolution_search_index_failed'
    || value === 'evolution_import_metadata_invalid'
    || value === 'evolution_import_pin_not_found'
    || value === 'evolution_import_not_supported'
    || value === 'evolution_import_scope_mismatch'
    || value === 'evolution_import_variant_conflict'
    || value === 'evolution_import_artifact_fetch_failed'
    || value === 'evolution_import_artifact_invalid'
    || value === 'evolution_imported_not_supported'
    || value === 'evolution_imported_artifact_invalid'
    || value === 'evolution_remote_adopt_not_supported'
    || value === 'evolution_remote_variant_not_found'
    || value === 'evolution_remote_variant_skill_mismatch'
    || value === 'evolution_remote_variant_scope_mismatch'
    || value === 'evolution_remote_variant_invalid';
}

function mapEvolutionRuntimeError(error: unknown): { code: EvolutionRuntimeFailureCode; message: string } | null {
  const message = error instanceof Error ? error.message : String(error);
  if (message === 'evolution_search_not_supported') {
    return { code: 'evolution_search_not_supported', message };
  }
  if (message === 'evolution_scope_hash_missing') {
    return { code: 'evolution_scope_hash_missing', message };
  }
  if (message.startsWith('evolution_chain_query_failed:')) {
    return { code: 'evolution_chain_query_failed', message };
  }
  if (message.startsWith('evolution_search_result_invalid:')) {
    return { code: 'evolution_search_result_invalid', message };
  }
  if (message.startsWith('evolution_search_index_failed:')) {
    return { code: 'evolution_search_index_failed', message };
  }
  const explicitCode = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  if (isEvolutionRuntimeFailureCode(explicitCode)) {
    return { code: explicitCode, message };
  }
  return null;
}

function createCliSigner(context: CliRuntimeContext, homeDir: string): Signer {
  const secretStore = createFileSecretStore(homeDir);
  const baseSigner = createLocalMnemonicSigner({ secretStore });
  if (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1') {
    return createTestChainWriteSigner(baseSigner);
  }
  return baseSigner;
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

function createTestMasterReplyWaiter(env: NodeJS.ProcessEnv): MetaWebMasterReplyWaiter | undefined {
  const raw = typeof env[TEST_FAKE_MASTER_REPLY_ENV] === 'string'
    ? env[TEST_FAKE_MASTER_REPLY_ENV]!.trim()
    : '';
  if (!raw) {
    return undefined;
  }

  let parsed: {
    state?: unknown;
    responseJson?: unknown;
    deliveryPinId?: unknown;
    observedAt?: unknown;
    delayMs?: unknown;
    sequence?: Array<{
      state?: unknown;
      responseJson?: unknown;
      deliveryPinId?: unknown;
      observedAt?: unknown;
      delayMs?: unknown;
    }> | unknown;
  };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch (error) {
    throw new Error(
      `Invalid ${TEST_FAKE_MASTER_REPLY_ENV}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  const sequence = Array.isArray(parsed.sequence) && parsed.sequence.length > 0
    ? parsed.sequence
    : [parsed];
  let replyIndex = 0;

  return {
    awaitMasterReply: async (input) => {
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

      const responseJson = typeof step.responseJson === 'string' ? step.responseJson.trim() : '';
      if (!responseJson) {
        throw new Error(`Invalid ${TEST_FAKE_MASTER_REPLY_ENV}: responseJson is required unless state=timeout.`);
      }

      const parsedResponse = parseMasterResponse(responseJson);
      if (!parsedResponse.ok) {
        throw new Error(`Invalid ${TEST_FAKE_MASTER_REPLY_ENV}: ${parsedResponse.message}`);
      }

      return {
        state: 'completed',
        response: parsedResponse.value,
        responseJson,
        deliveryPinId: typeof step.deliveryPinId === 'string' ? step.deliveryPinId : null,
        observedAt: Number.isFinite(step.observedAt)
          ? Number(step.observedAt)
          : Date.now(),
        rawMessage: {
          source: 'test-fake-master-reply',
        },
      };
    },
  };
}

export function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies {
  return {
    config: {
      get: async (input) => {
        if (!isSupportedConfigKey(input.key)) {
          return commandFailed(
            'unsupported_config_key',
            `Unsupported config key: ${input.key}`,
          );
        }
        const homeDir = normalizeHomeDir(context.env, context.cwd);
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
        const homeDir = normalizeHomeDir(context.env, context.cwd);
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
    buzz: {
      post: async (input) => requestJson(context, 'POST', '/api/buzz/post', input),
    },
    chain: {
      write: async (input) => requestJson(context, 'POST', '/api/chain/write', input),
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
    },
    doctor: {
      run: async () => requestJson(context, 'GET', '/api/doctor'),
    },
    identity: {
      create: async (input) => requestJson(context, 'POST', '/api/identity/create', input, {
        allowUnindexedExplicitHome: true,
      }),
      who: async () => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const runtimeStateStore = createRuntimeStateStore(homeDir);
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed(
            'identity_missing',
            'No local MetaBot identity is loaded for the current active home.'
          );
        }

        await upsertIdentityProfile({
          systemHomeDir,
          name: state.identity.name,
          homeDir,
          globalMetaId: state.identity.globalMetaId,
          mvcAddress: state.identity.mvcAddress,
        });
        await setActiveMetabotHome({
          systemHomeDir,
          homeDir,
        });

        return commandSuccess({
          activeHomeDir: homeDir,
          systemHomeDir,
          identity: state.identity,
        });
      },
      list: async () => {
        const systemHomeDir = normalizeSystemHomeDir(context.env, context.cwd);
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const runtimeStateStore = createRuntimeStateStore(homeDir);
        const state = await runtimeStateStore.readState();
        if (state.identity) {
          await upsertIdentityProfile({
            systemHomeDir,
            name: state.identity.name,
            homeDir,
            globalMetaId: state.identity.globalMetaId,
            mvcAddress: state.identity.mvcAddress,
          });
          await setActiveMetabotHome({
            systemHomeDir,
            homeDir,
          });
        }

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
    master: {
      publish: async (input) => requestJson(context, 'POST', '/api/master/publish', input),
      list: async (input) => {
        const query = new URLSearchParams();
        if (input.online !== undefined) {
          query.set('online', input.online ? 'true' : 'false');
        }
        if (typeof input.masterKind === 'string' && input.masterKind.trim()) {
          query.set('kind', input.masterKind.trim());
        }
        const suffix = query.size ? `?${query.toString()}` : '';
        return requestJson(context, 'GET', `/api/master/list${suffix}`);
      },
      ask: async (input) => requestJson(context, 'POST', '/api/master/ask', input),
      suggest: async (input) => requestJson(context, 'POST', '/api/master/suggest', input),
      hostAction: async (input) => requestJson(context, 'POST', '/api/master/host-action', input),
      trace: async (input) =>
        requestJson(context, 'GET', `/api/master/trace/${encodeURIComponent(input.traceId)}`),
    },
    network: {
      listServices: async (input) => {
        const query = input.online === undefined ? '' : `?online=${input.online ? 'true' : 'false'}`;
        return requestJson(context, 'GET', `/api/network/services${query}`);
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
      publish: async (input) => requestJson(context, 'POST', '/api/services/publish', input),
      call: async (input) => requestJson(context, 'POST', '/api/services/call', input),
      rate: async (input) => requestJson(context, 'POST', '/api/services/rate', input),
    },
    chat: {
      private: async (input) => requestJson(context, 'POST', '/api/chat/private', input),
    },
    file: {
      upload: async (input) => requestJson(context, 'POST', '/api/file/upload', input),
    },
    wallet: {
      balance: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const runtimeStateStore = createRuntimeStateStore(homeDir);
        const state = await runtimeStateStore.readState();
        if (!state.identity) {
          return commandFailed(
            'identity_missing',
            'No local MetaBot identity is loaded for the current active home.'
          );
        }

        const targetChains = input.chain === 'all'
          ? ['mvc', 'btc'] as const
          : [input.chain];

        try {
          const balances: {
            mvc?: WalletMvcBalanceSnapshot;
            btc?: WalletBtcBalanceSnapshot;
          } = {};
          for (const chain of targetChains) {
            if (chain === 'mvc') {
              const mvcAddress = normalizeEnvText(state.identity.mvcAddress);
              if (!mvcAddress) {
                return commandFailed('identity_address_missing', 'Current identity has no mvcAddress.');
              }
              balances.mvc = await fetchMvcBalanceSnapshot(mvcAddress);
              continue;
            }
            const btcAddress = normalizeEnvText(state.identity.btcAddress);
            if (!btcAddress) {
              return commandFailed('identity_address_missing', 'Current identity has no btcAddress.');
            }
            balances.btc = await fetchBtcBalanceSnapshot(btcAddress);
          }

          return commandSuccess({
            chain: input.chain,
            globalMetaId: state.identity.globalMetaId,
            balances,
          });
        } catch (error) {
          return commandFailed(
            'wallet_balance_query_failed',
            error instanceof Error ? error.message : String(error)
          );
        }
      },
    },
    trace: {
      get: async (input) => requestJson(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}`),
      watch: async (input) => requestText(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}/watch`),
    },
    ui: {
      open: async (input) => {
        const baseUrl = await ensureDaemonBaseUrl(context);
        const query = input.traceId
          ? `?traceId=${encodeURIComponent(input.traceId)}`
          : '';
        return commandSuccess({
          page: input.page,
          localUiUrl: `${baseUrl}${resolveLocalUiPath(input.page)}${query}`,
        });
      },
    },
    skills: {
      resolve: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        const resolvedActiveVariant = config.evolution_network.enabled
          ? await resolveActiveVariantForSkill(context, input.skill)
          : { activeVariant: null, activeVariantSource: null };
        const rendered = renderResolvedSkillContract({
          skillName: input.skill,
          host: input.host as SkillHost,
          format: input.format as SkillRenderFormat,
          evolutionNetworkEnabled: config.evolution_network.enabled,
          activeVariant: resolvedActiveVariant.activeVariant,
          activeVariantSource: resolvedActiveVariant.activeVariantSource,
        });
        if (rendered.format === 'markdown') {
          return commandSuccess(rendered.markdown);
        }
        return commandSuccess(rendered);
      },
    },
    evolution: {
      status: async () => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        const evolutionStore = createLocalEvolutionStore(homeDir);
        const index = await evolutionStore.readIndex();
        return commandSuccess({
          enabled: config.evolution_network.enabled,
          executions: index.executions.length,
          analyses: index.analyses.length,
          artifacts: index.artifacts.length,
          activeVariants: projectActiveVariantIds(index.activeVariants),
          activeVariantRefs: projectActiveVariantRefs(index.activeVariants),
        });
      },
      search: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        if (!config.evolution_network.enabled) {
          return commandFailed(
            'evolution_network_disabled',
            'Evolution network search is disabled.'
          );
        }
        if (input.skill !== EVOLUTION_IMPORT_SKILL_NAME) {
          return commandFailed(
            'evolution_search_not_supported',
            `Evolution search is currently supported only for "${EVOLUTION_IMPORT_SKILL_NAME}".`
          );
        }

        try {
          const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
            context,
            skillName: input.skill,
            evolutionNetworkEnabled: config.evolution_network.enabled,
          });
          const remoteStore = createRemoteEvolutionStore(homeDir);
          const chainReader = createChainEvolutionReader({
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
          });
          const results = await searchPublishedEvolutionArtifacts({
            skillName: input.skill,
            resolvedScopeHash,
            remoteStore,
            fetchMetadataRows: chainReader.fetchMetadataRows,
          });
          return commandSuccess(results);
        } catch (error) {
          const mapped = mapEvolutionRuntimeError(error);
          if (mapped) {
            return commandFailed(mapped.code, mapped.message);
          }
          throw error;
        }
      },
      publish: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        if (!config.evolution_network.enabled) {
          return commandFailed(
            'evolution_network_disabled',
            'Evolution network publishing is disabled.'
          );
        }

        const evolutionStore = createLocalEvolutionStore(homeDir);
        const signer = createCliSigner(context, homeDir);
        const identity = await signer.getIdentity();

        try {
          const published = await publishEvolutionArtifact({
            store: evolutionStore,
            skillName: input.skill,
            variantId: input.variantId,
            publisherGlobalMetaId: identity.globalMetaId,
            uploadArtifactBody: async (filePath) => {
              const uploaded = await uploadLocalFileToChain({
                filePath,
                signer,
              });
              return {
                artifactUri: uploaded.metafileUri,
              };
            },
            writeMetadataPin: async (request) => {
              const result = await signer.writePin(request);
              return {
                pinId: result.pinId,
                txids: result.txids,
              };
            },
          });

          return commandSuccess(published);
        } catch (error) {
          const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
          const message = error instanceof Error ? error.message : String(error);
          if (isEvolutionPublishFailureCode(code)) {
            return commandFailed(code, message);
          }
          throw error;
        }
      },
      import: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        if (!config.evolution_network.enabled) {
          return commandFailed(
            'evolution_network_disabled',
            'Evolution network import is disabled.'
          );
        }

        try {
          const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
            context,
            skillName: EVOLUTION_IMPORT_SKILL_NAME,
            evolutionNetworkEnabled: config.evolution_network.enabled,
          });
          const remoteStore = createRemoteEvolutionStore(homeDir);
          const chainReader = createChainEvolutionReader({
            chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
          });
          const imported = await importPublishedEvolutionArtifact({
            pinId: input.pinId,
            skillName: EVOLUTION_IMPORT_SKILL_NAME,
            resolvedScopeHash,
            remoteStore,
            readMetadataPinById: chainReader.readMetadataPinById,
            readArtifactBodyByUri: chainReader.readArtifactBodyByUri,
          });
          return commandSuccess(imported);
        } catch (error) {
          const mapped = mapEvolutionRuntimeError(error);
          if (mapped) {
            return commandFailed(mapped.code, mapped.message);
          }
          throw error;
        }
      },
      imported: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        if (!config.evolution_network.enabled) {
          return commandFailed(
            'evolution_network_disabled',
            'Evolution network imported listing is disabled.'
          );
        }

        try {
          const evolutionStore = createLocalEvolutionStore(homeDir);
          const index = await evolutionStore.readIndex();
          const activeRef = parseSkillActiveVariantRef(index.activeVariants[input.skill]);
          const remoteStore = createRemoteEvolutionStore(homeDir);
          const imported = await listImportedEvolutionArtifacts({
            skillName: input.skill,
            activeRef,
            remoteStore,
          });
          return commandSuccess(imported);
        } catch (error) {
          const mapped = mapEvolutionRuntimeError(error);
          if (mapped) {
            return commandFailed(mapped.code, mapped.message);
          }
          throw error;
        }
      },
      adopt: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        if (input.source === 'remote') {
          const configStore = createConfigStore(homeDir);
          const config = await configStore.read();
          if (!config.evolution_network.enabled) {
            return commandFailed(
              'evolution_network_disabled',
              'Evolution network remote adoption is disabled.'
            );
          }
          if (input.skill !== EVOLUTION_IMPORT_SKILL_NAME) {
            return commandFailed(
              'evolution_remote_adopt_not_supported',
              `Remote adoption is currently supported only for "${EVOLUTION_IMPORT_SKILL_NAME}".`
            );
          }

          try {
            const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
              context,
              skillName: input.skill,
              evolutionNetworkEnabled: config.evolution_network.enabled,
            });
            const evolutionStore = createLocalEvolutionStore(homeDir);
            const remoteStore = createRemoteEvolutionStore(homeDir);
            const adopted = await adoptRemoteEvolutionArtifact({
              skillName: input.skill,
              variantId: input.variantId,
              resolvedScopeHash,
              remoteStore,
              evolutionStore,
            });
            return commandSuccess(adopted);
          } catch (error) {
            const mapped = mapEvolutionRuntimeError(error);
            if (mapped) {
              return commandFailed(mapped.code, mapped.message);
            }
            throw error;
          }
        }

        const evolutionStore = createLocalEvolutionStore(homeDir);
        const artifactPath = path.join(evolutionStore.paths.evolutionArtifactsRoot, `${input.variantId}.json`);
        const artifact = await readArtifactFile(artifactPath);
        if (!artifact) {
          return commandFailed('evolution_variant_not_found', `Variant not found: ${input.variantId}`);
        }
        if (artifact.skillName !== input.skill) {
          return commandFailed(
            'evolution_variant_skill_mismatch',
            `Variant ${input.variantId} belongs to ${String(artifact.skillName)} and cannot be adopted for ${input.skill}.`,
          );
        }

        const updatedArtifact = {
          ...artifact,
          status: 'active',
          adoption: 'active',
          updatedAt: Date.now(),
        };
        await evolutionStore.writeArtifact(updatedArtifact as never);
        await evolutionStore.setActiveVariant(input.skill, input.variantId);
        return commandSuccess({
          skillName: input.skill,
          variantId: input.variantId,
          active: true,
        });
      },
      rollback: async (input) => {
        const rollback = await clearActiveVariantMapping(context, input.skill);
        return commandSuccess({
          skillName: input.skill,
          rolledBack: rollback.removed,
          previousVariantId: rollback.previousVariantId,
        });
      },
    },
  };
}

export function mergeCliDependencies(context: CliRuntimeContext): CliDependencies {
  const defaults = createDefaultCliDependencies(context);
  const provided = context.dependencies;
  const defaultNetwork = defaults.network ?? {};
  const networkListServices = wrapNetworkListServicesDependency(
    context,
    provided.network?.listServices ?? defaultNetwork.listServices,
  );
  return {
    config: { ...defaults.config, ...provided.config },
    buzz: { ...defaults.buzz, ...provided.buzz },
    chain: { ...defaults.chain, ...provided.chain },
    daemon: { ...defaults.daemon, ...provided.daemon },
    doctor: { ...defaults.doctor, ...provided.doctor },
    identity: { ...defaults.identity, ...provided.identity },
    master: { ...defaults.master, ...provided.master },
    network: {
      ...defaultNetwork,
      ...provided.network,
      listServices: networkListServices,
    },
    services: { ...defaults.services, ...provided.services },
    chat: { ...defaults.chat, ...provided.chat },
    file: { ...defaults.file, ...provided.file },
    wallet: { ...defaults.wallet, ...provided.wallet },
    trace: { ...defaults.trace, ...provided.trace },
    ui: { ...defaults.ui, ...provided.ui },
    skills: { ...defaults.skills, ...provided.skills },
    evolution: { ...defaults.evolution, ...provided.evolution },
  };
}

export async function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never> {
  const homeDir = normalizeHomeDir(context.env, context.cwd, {
    allowUnindexedExplicitHome: context.env[ALLOW_UNINDEXED_HOME_ENV] === '1',
  });
  const paths = resolveMetabotPaths(homeDir);
  let daemonRecord: RuntimeDaemonRecord | null = null;
  const secretStore = createFileSecretStore(homeDir);
  const baseSigner = createLocalMnemonicSigner({ secretStore });
  const signer = context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
    ? createTestChainWriteSigner(baseSigner)
    : baseSigner;
  const requestMvcGasSubsidy = context.env[TEST_FAKE_SUBSIDY_ENV] === '1'
    ? createTestSubsidyRequester()
    : undefined;
  const fetchPeerChatPublicKey = createTestProviderChatPublicKeyFetcher(context.env);
  const callerReplyWaiter = createTestMetaWebReplyWaiter(context.env);
  const masterReplyWaiter = createTestMasterReplyWaiter(context.env) ?? createSocketIoMetaWebMasterReplyWaiter();
  const socketPresenceApiBaseUrl = context.env.METABOT_SOCKET_PRESENCE_API_BASE_URL
    || (context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 'http://127.0.0.1:9' : undefined);

  const daemon = createMetabotDaemon({
    homeDirOrPaths: paths,
    handlers: createDefaultMetabotDaemonHandlers({
      homeDir,
      systemHomeDir: normalizeSystemHomeDir(context.env, context.cwd),
      getDaemonRecord: () => daemonRecord,
      secretStore,
      signer,
      chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
      socketPresenceApiBaseUrl,
      socketPresenceFailureMode: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1'
        ? 'assume_service_providers_online'
        : 'throw',
      identitySyncStepDelayMs: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 0 : undefined,
      fetchPeerChatPublicKey,
      callerReplyWaiter,
      masterReplyWaiter,
      requestMvcGasSubsidy,
    }),
  });

  const host = DEFAULT_DAEMON_HOST;
  const explicitPort = parseDaemonPort(context.env.METABOT_DAEMON_PORT);
  const preferredPort = explicitPort
    ?? parseDaemonPort(context.env[DAEMON_PREFERRED_PORT_ENV])
    ?? getDefaultDaemonPort(homeDir);
  let started;
  try {
    started = await daemon.start(preferredPort, host);
  } catch (error) {
    if (explicitPort != null || !isAddressInUseError(error)) {
      throw error;
    }
    started = await daemon.start(0, host);
  }

  const runtimeStore = createRuntimeStateStore(paths);
  const providerPresenceStore = createProviderPresenceStateStore(paths);
  const providerHeartbeatLoop = createProviderHeartbeatLoop({
    signer,
    presenceStore: providerPresenceStore,
    getIdentity: async () => {
      const state = await runtimeStore.readState();
      if (!state.identity) {
        return null;
      }

      return {
        globalMetaId: state.identity.globalMetaId,
        mvcAddress: state.identity.mvcAddress,
      };
    },
  });
  daemonRecord = await runtimeStore.writeDaemon({
    ownerId: daemon.ownerId,
    pid: process.pid,
    host: started.host,
    port: started.port,
    baseUrl: started.baseUrl,
    startedAt: Date.now(),
    configHash: buildDaemonConfigHash(context.env),
  });
  const providerPresence = await providerPresenceStore.read();
  if (providerPresence.enabled) {
    await providerHeartbeatLoop.start();
  }

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
    providerHeartbeatLoop.stop();
    await runtimeStore.clearDaemon(process.pid);
    await daemon.close();
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
