import path from 'node:path';
import { spawn } from 'node:child_process';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../core/contracts/commandResult';
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
import type { CliDependencies, CliRuntimeContext } from './types';

const DEFAULT_DAEMON_BASE_URL = 'http://127.0.0.1:4827';
const DEFAULT_DAEMON_HOST = '127.0.0.1';
const DEFAULT_DAEMON_START_TIMEOUT_MS = 5_000;
const DAEMON_START_POLL_INTERVAL_MS = 100;
const TEST_FAKE_CHAIN_WRITE_ENV = 'METABOT_TEST_FAKE_CHAIN_WRITE';
const TEST_FAKE_SUBSIDY_ENV = 'METABOT_TEST_FAKE_SUBSIDY';

function normalizeBaseUrl(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || DEFAULT_DAEMON_BASE_URL;
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

async function ensureDaemonBaseUrl(context: CliRuntimeContext): Promise<string> {
  const explicitBaseUrl = typeof context.env.METABOT_DAEMON_BASE_URL === 'string'
    ? context.env.METABOT_DAEMON_BASE_URL.trim()
    : '';
  if (explicitBaseUrl) {
    return normalizeBaseUrl(explicitBaseUrl);
  }

  const daemonRecord = await resolveDaemonRecord(context);
  if (daemonRecord?.baseUrl && await isDaemonReachable(daemonRecord.baseUrl)) {
    return daemonRecord.baseUrl;
  }

  return startDetachedDaemon(context);
}

async function startDetachedDaemon(context: CliRuntimeContext): Promise<string> {
  const homeDir = normalizeHomeDir(context.env, context.cwd);
  const store = createRuntimeStateStore(homeDir);
  const staleRecord = await store.readDaemon();
  if (staleRecord?.baseUrl && await isDaemonReachable(staleRecord.baseUrl)) {
    return staleRecord.baseUrl;
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
    if (daemonRecord?.baseUrl && await isDaemonReachable(daemonRecord.baseUrl)) {
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

  const daemon = createMetabotDaemon({
    homeDirOrPaths: paths,
    handlers: createDefaultMetabotDaemonHandlers({
      homeDir,
      getDaemonRecord: () => daemonRecord,
      secretStore,
      signer,
      chainApiBaseUrl: context.env.METABOT_CHAIN_API_BASE_URL,
      identitySyncStepDelayMs: context.env[TEST_FAKE_CHAIN_WRITE_ENV] === '1' ? 0 : undefined,
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
