import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
import { resolveMetabotPaths } from '../core/state/paths';
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
const DAEMON_CONFIG_RESTART_TIMEOUT_MS = 5_000;
let cachedDaemonRuntimeFingerprint: string | null = null;

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_DAEMON_BASE_URL;
}

function normalizeEnvText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
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
      await waitForPortRelease(daemonRecord.host || DEFAULT_DAEMON_HOST, daemonRecord.port, DAEMON_CONFIG_RESTART_TIMEOUT_MS)
        .catch(() => {});
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
    return startDetachedDaemon(context, daemonRecord);
  }

  return startDetachedDaemon(context);
}

async function startDetachedDaemon(
  context: CliRuntimeContext,
  preferredRecord?: RuntimeDaemonRecord | null,
): Promise<string> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
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
        HOME: homeDir,
        METABOT_HOME: homeDir,
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

export function createDefaultCliDependencies(context: CliRuntimeContext): CliDependencies {
  return {
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
      rate: async (input) => requestJson(context, 'POST', '/api/services/rate', input),
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
        const query = input.traceId
          ? `?traceId=${encodeURIComponent(input.traceId)}`
          : '';
        return commandSuccess({
          page: input.page,
          localUiUrl: `${baseUrl}/ui/${input.page}${query}`,
        });
      },
    },
  };
}

export function mergeCliDependencies(context: CliRuntimeContext): CliDependencies {
  const defaults = createDefaultCliDependencies(context);
  const provided = context.dependencies;
  return {
    buzz: { ...defaults.buzz, ...provided.buzz },
    chain: { ...defaults.chain, ...provided.chain },
    daemon: { ...defaults.daemon, ...provided.daemon },
    doctor: { ...defaults.doctor, ...provided.doctor },
    identity: { ...defaults.identity, ...provided.identity },
    network: { ...defaults.network, ...provided.network },
    services: { ...defaults.services, ...provided.services },
    chat: { ...defaults.chat, ...provided.chat },
    file: { ...defaults.file, ...provided.file },
    trace: { ...defaults.trace, ...provided.trace },
    ui: { ...defaults.ui, ...provided.ui },
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
