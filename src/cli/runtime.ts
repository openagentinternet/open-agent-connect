import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { createConfigStore, type ConfigStore } from '../core/config/configStore';
import { createNetworkDirectoryEvolutionService } from '../core/evolution/service';
import { createLocalEvolutionStore } from '../core/evolution/localEvolutionStore';
import { createRemoteEvolutionStore } from '../core/evolution/remoteEvolutionStore';
import { publishEvolutionArtifact } from '../core/evolution/publish/publishArtifact';
import { createChainEvolutionReader } from '../core/evolution/import/chainEvolutionReader';
import { importPublishedEvolutionArtifact } from '../core/evolution/import/importArtifact';
import { deriveResolvedScopeHash, searchPublishedEvolutionArtifacts } from '../core/evolution/import/searchArtifacts';
import { uploadLocalFileToChain } from '../core/files/uploadFile';
import { renderResolvedSkillContract } from '../core/skills/skillResolver';
import type { SkillHost, SkillRenderFormat, SkillVariantArtifact } from '../core/skills/skillContractTypes';
import { resolveMetabotPaths } from '../core/state/paths';
import {
  createRuntimeStateStore,
  type RuntimeDaemonRecord,
} from '../core/state/runtimeStateStore';
import { createFileSecretStore } from '../core/secrets/fileSecretStore';
import { createLocalMnemonicSigner } from '../core/signing/localMnemonicSigner';
import { normalizeChainWriteRequest } from '../core/chain/writePin';
import type { Signer } from '../core/signing/signer';
import { createMetabotDaemon } from '../daemon';
import { createDefaultMetabotDaemonHandlers } from '../daemon/defaultHandlers';
import type { RequestMvcGasSubsidyOptions, RequestMvcGasSubsidyResult } from '../core/subsidy/requestMvcGasSubsidy';
import type { MetaWebServiceReplyWaiter } from '../core/a2a/metawebReplyWaiter';
import type { CliDependencies, CliRuntimeContext } from './types';

const DEFAULT_DAEMON_BASE_URL = 'http://127.0.0.1:4827';
const DEFAULT_DAEMON_HOST = '127.0.0.1';
const DEFAULT_DAEMON_START_TIMEOUT_MS = 5_000;
const DAEMON_START_POLL_INTERVAL_MS = 100;
const TEST_FAKE_CHAIN_WRITE_ENV = 'METABOT_TEST_FAKE_CHAIN_WRITE';
const TEST_FAKE_SUBSIDY_ENV = 'METABOT_TEST_FAKE_SUBSIDY';
const TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY_ENV = 'METABOT_TEST_FAKE_PROVIDER_CHAT_PUBLIC_KEY';
const TEST_FAKE_METAWEB_REPLY_ENV = 'METABOT_TEST_FAKE_METAWEB_REPLY';
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
let cachedDaemonRuntimeFingerprint: string | null = null;

type EvolutionPublishFailureCode =
  | 'evolution_variant_not_found'
  | 'evolution_variant_skill_mismatch'
  | 'evolution_variant_analysis_mismatch'
  | 'evolution_variant_scope_hash_missing'
  | 'evolution_variant_not_verified'
  | 'evolution_publish_not_supported';

type EvolutionImportFailureCode =
  | 'evolution_import_metadata_invalid'
  | 'evolution_import_pin_not_found'
  | 'evolution_import_not_supported'
  | 'evolution_import_scope_mismatch'
  | 'evolution_import_variant_conflict'
  | 'evolution_import_artifact_fetch_failed'
  | 'evolution_import_artifact_invalid';

const EVOLUTION_IMPORT_SKILL_NAME = 'metabot-network-directory';

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_DAEMON_BASE_URL;
}

function normalizeEnvText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

type SupportedConfigKey =
  | 'evolution_network.enabled'
  | 'evolution_network.autoAdoptSameSkillSameScope'
  | 'evolution_network.autoRecordExecutions';

const SUPPORTED_CONFIG_KEYS = new Set<SupportedConfigKey>([
  'evolution_network.enabled',
  'evolution_network.autoAdoptSameSkillSameScope',
  'evolution_network.autoRecordExecutions',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSupportedConfigKey(key: string): key is SupportedConfigKey {
  return SUPPORTED_CONFIG_KEYS.has(key as SupportedConfigKey);
}

function readConfigValue(
  config: Awaited<ReturnType<ConfigStore['read']>>,
  key: SupportedConfigKey,
): boolean {
  if (key === 'evolution_network.enabled') {
    return config.evolution_network.enabled;
  }
  if (key === 'evolution_network.autoAdoptSameSkillSameScope') {
    return config.evolution_network.autoAdoptSameSkillSameScope;
  }
  return config.evolution_network.autoRecordExecutions;
}

function writeConfigValue(
  config: Awaited<ReturnType<ConfigStore['read']>>,
  key: SupportedConfigKey,
  value: boolean,
): Awaited<ReturnType<ConfigStore['read']>> {
  if (key === 'evolution_network.enabled') {
    return {
      ...config,
      evolution_network: {
        ...config.evolution_network,
        enabled: value,
      },
    };
  }
  if (key === 'evolution_network.autoAdoptSameSkillSameScope') {
    return {
      ...config,
      evolution_network: {
        ...config.evolution_network,
        autoAdoptSameSkillSameScope: value,
      },
    };
  }
  return {
    ...config,
    evolution_network: {
      ...config.evolution_network,
      autoRecordExecutions: value,
    },
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
    }))
    .digest('hex');
}

function normalizeHomeDir(env: NodeJS.ProcessEnv, cwd: string): string {
  const explicit = typeof env.METABOT_HOME === 'string' ? env.METABOT_HOME.trim() : '';
  if (explicit) return explicit;
  const home = typeof env.HOME === 'string' ? env.HOME.trim() : '';
  return home || cwd;
}

function resolveCliEntrypoint(): string {
  return path.join(__dirname, 'main.js');
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function isDaemonReachable(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}/api/daemon/status`);
    return response.ok;
  } catch {
    return false;
  }
}

async function resolveDaemonRecord(context: CliRuntimeContext): Promise<RuntimeDaemonRecord | null> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
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
      return;
    }
    await sleep(DAEMON_START_POLL_INTERVAL_MS);
  }

  throw new Error('Timed out while restarting the local MetaBot daemon with updated configuration.');
}

async function ensureDaemonBaseUrl(context: CliRuntimeContext): Promise<string> {
  const explicitBaseUrl = typeof context.env.METABOT_DAEMON_BASE_URL === 'string'
    ? context.env.METABOT_DAEMON_BASE_URL.trim()
    : '';
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl);
  }

  const daemonRecord = await resolveDaemonRecord(context);
  if (daemonRecord?.baseUrl && await isDaemonReachable(daemonRecord.baseUrl)) {
    if (daemonConfigMatchesContext(daemonRecord, context)) {
      return daemonRecord.baseUrl;
    }
    await stopRunningDaemon(daemonRecord);
  }

  return startDetachedDaemon(context);
}

async function startDetachedDaemon(context: CliRuntimeContext): Promise<string> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
  const store = createRuntimeStateStore(homeDir);
  const expectedConfigHash = buildDaemonConfigHash(context.env);
  const staleRecord = await store.readDaemon();
  if (staleRecord?.baseUrl && await isDaemonReachable(staleRecord.baseUrl)) {
    if (daemonConfigMatchesContext(staleRecord, context)) {
      return staleRecord.baseUrl;
    }
    await stopRunningDaemon(staleRecord);
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
        HOME: homeDir,
        METABOT_HOME: homeDir,
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
  body?: Record<string, unknown>
): Promise<MetabotCommandResult<T>> {
  const baseUrl = await ensureDaemonBaseUrl(context);
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
): Promise<SkillVariantArtifact | null> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
  const evolutionStore = createLocalEvolutionStore(homeDir);
  const index = await evolutionStore.readIndex();
  const activeVariantId = index.activeVariants[skillName];
  if (!activeVariantId) {
    return null;
  }

  const artifactPath = path.join(evolutionStore.paths.evolutionArtifactsRoot, `${activeVariantId}.json`);
  const artifact = await readArtifactFile(artifactPath);
  if (!artifact || artifact.skillName !== skillName) {
    return null;
  }

  return artifact as unknown as SkillVariantArtifact;
}

async function clearActiveVariantMapping(
  context: CliRuntimeContext,
  skillName: string,
): Promise<{ removed: boolean; previousVariantId: string | null }> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
  const evolutionStore = createLocalEvolutionStore(homeDir);
  const index = await evolutionStore.readIndex();
  const previousVariantId = index.activeVariants[skillName] ?? null;
  if (!previousVariantId) {
    return {
      removed: false,
      previousVariantId: null,
    };
  }

  await evolutionStore.clearActiveVariant(skillName);

  return {
    removed: true,
    previousVariantId,
  };
}

async function resolveEvolutionScopeHashForSkill(input: {
  context: CliRuntimeContext;
  skillName: string;
  evolutionNetworkEnabled: boolean;
}): Promise<string> {
  const activeVariant = input.evolutionNetworkEnabled
    ? await resolveActiveVariantForSkill(input.context, input.skillName)
    : null;
  const rendered = renderResolvedSkillContract({
    skillName: input.skillName,
    host: 'codex',
    format: 'json',
    evolutionNetworkEnabled: input.evolutionNetworkEnabled,
    activeVariant,
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

function isEvolutionImportFailureCode(value: unknown): value is EvolutionImportFailureCode {
  return value === 'evolution_import_metadata_invalid'
    || value === 'evolution_import_pin_not_found'
    || value === 'evolution_import_not_supported'
    || value === 'evolution_import_scope_mismatch'
    || value === 'evolution_import_variant_conflict'
    || value === 'evolution_import_artifact_fetch_failed'
    || value === 'evolution_import_artifact_invalid';
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
    observedAt?: unknown;
    delayMs?: unknown;
    sequence?: Array<{
      state?: unknown;
      responseText?: unknown;
      deliveryPinId?: unknown;
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
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        const nextConfig = writeConfigValue(config, input.key, input.value);
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
      create: async (input) => requestJson(context, 'POST', '/api/identity/create', input),
    },
    network: {
      listServices: async (input) => {
        const query = input.online === undefined ? '' : `?online=${input.online ? 'true' : 'false'}`;
        return requestJson(context, 'GET', `/api/network/services${query}`);
      },
      listSources: async () => requestJson(context, 'GET', '/api/network/sources'),
      addSource: async (input) => requestJson(context, 'POST', '/api/network/sources', input),
      removeSource: async (input) => requestJson(context, 'DELETE', '/api/network/sources', input),
    },
    services: {
      publish: async (input) => requestJson(context, 'POST', '/api/services/publish', input),
      call: async (input) => requestJson(context, 'POST', '/api/services/call', input),
    },
    chat: {
      private: async (input) => requestJson(context, 'POST', '/api/chat/private', input),
    },
    file: {
      upload: async (input) => requestJson(context, 'POST', '/api/file/upload', input),
    },
    trace: {
      get: async (input) => requestJson(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}`),
      watch: async (input) => requestText(context, 'GET', `/api/trace/${encodeURIComponent(input.traceId)}/watch`),
    },
    ui: {
      open: async (input) => {
        const baseUrl = await ensureDaemonBaseUrl(context);
        return commandSuccess({
          page: input.page,
          localUiUrl: `${baseUrl}/ui/${input.page}`,
        });
      },
    },
    skills: {
      resolve: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
        const configStore = createConfigStore(homeDir);
        const config = await configStore.read();
        const activeVariant = config.evolution_network.enabled
          ? await resolveActiveVariantForSkill(context, input.skill)
          : null;
        const rendered = renderResolvedSkillContract({
          skillName: input.skill,
          host: input.host as SkillHost,
          format: input.format as SkillRenderFormat,
          evolutionNetworkEnabled: config.evolution_network.enabled,
          activeVariant,
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
          activeVariants: index.activeVariants,
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

        const resolvedScopeHash = await resolveEvolutionScopeHashForSkill({
          context,
          skillName: EVOLUTION_IMPORT_SKILL_NAME,
          evolutionNetworkEnabled: config.evolution_network.enabled,
        });
        const remoteStore = createRemoteEvolutionStore(homeDir);
        const chainReader = createChainEvolutionReader({
          chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
        });

        try {
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
          const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
          const message = error instanceof Error ? error.message : String(error);
          if (isEvolutionImportFailureCode(code)) {
            return commandFailed(code, message);
          }
          throw error;
        }
      },
      adopt: async (input) => {
        const homeDir = normalizeHomeDir(context.env, context.cwd);
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
    network: {
      ...defaultNetwork,
      ...provided.network,
      listServices: networkListServices,
    },
    services: { ...defaults.services, ...provided.services },
    chat: { ...defaults.chat, ...provided.chat },
    file: { ...defaults.file, ...provided.file },
    trace: { ...defaults.trace, ...provided.trace },
    ui: { ...defaults.ui, ...provided.ui },
    skills: { ...defaults.skills, ...provided.skills },
    evolution: { ...defaults.evolution, ...provided.evolution },
  };
}

export async function serveCliDaemonProcess(context: Pick<CliRuntimeContext, 'env' | 'cwd'>): Promise<never> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
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

  const daemon = createMetabotDaemon({
    homeDirOrPaths: paths,
    handlers: createDefaultMetabotDaemonHandlers({
      homeDir,
      getDaemonRecord: () => daemonRecord,
      secretStore,
      signer,
      chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
      identitySyncStepDelayMs: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 0 : undefined,
      fetchPeerChatPublicKey,
      callerReplyWaiter,
      requestMvcGasSubsidy,
    }),
  });

  const host = DEFAULT_DAEMON_HOST;
  const port = Number.parseInt(context.env.METABOT_DAEMON_PORT || '', 10) || 0;
  const started = await daemon.start(port, host);

  const runtimeStore = createRuntimeStateStore(paths);
  daemonRecord = await runtimeStore.writeDaemon({
    ownerId: daemon.ownerId,
    pid: process.pid,
    host: started.host,
    port: started.port,
    baseUrl: started.baseUrl,
    startedAt: Date.now(),
    configHash: buildDaemonConfigHash(context.env),
  });

  let shuttingDown = false;
  const shutdown = async (exitCode: number) => {
    if (shuttingDown) return;
    shuttingDown = true;
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
