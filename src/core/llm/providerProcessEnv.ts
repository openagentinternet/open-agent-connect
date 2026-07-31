import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { isIP, Socket } from 'node:net';
import path from 'node:path';
import {
  getRuntimePlatformDefinition,
  type RuntimePlatformId,
} from '../platform/platformRegistry';

const NODE_VERSION_PROBE_TIMEOUT_MS = 2_000;
const LOOPBACK_PROXY_PROBE_TIMEOUT_MS = 250;
const PROXY_ENV_NAMES = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
] as const;

export interface ProviderProcessEnvResolution {
  env: NodeJS.ProcessEnv;
  nodePath?: string;
  error?: string;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function versionAtLeast(value: string, minimum: string): boolean {
  const actual = parseVersion(value);
  const required = parseVersion(minimum);
  if (!actual || !required) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== required[index]) return actual[index] > required[index];
  }
  return true;
}

async function isNodeShebangExecutable(binaryPath: string): Promise<boolean> {
  try {
    const file = await fs.open(binaryPath, 'r');
    try {
      const buffer = Buffer.alloc(160);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      return /^#![^\r\n]*\bnode\b/.test(buffer.subarray(0, bytesRead).toString('utf8'));
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
}

async function readNodeVersion(nodePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(nodePath, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });
    let output = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* best effort */ }
      finish(null);
    }, NODE_VERSION_PROBE_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { output += chunk; });
    child.stderr?.on('data', (chunk: string) => { output += chunk; });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? output.trim() : null));
  });
}

function pathDirectories(env: NodeJS.ProcessEnv): string[] {
  return (env.PATH ?? '').split(path.delimiter).filter(Boolean);
}

function providerNodePathEnvNames(provider: RuntimePlatformId): string[] {
  const alias = provider.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return [
    `OAC_${alias}_NODE_PATH`,
    `METABOT_${alias}_NODE_PATH`,
    `OPEN_AGENT_CONNECT_${alias}_NODE_PATH`,
    'OAC_NODE_PATH',
  ];
}

function nodeCandidates(
  provider: RuntimePlatformId,
  binaryPath: string,
  env: NodeJS.ProcessEnv,
): string[] {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined) => {
    const value = candidate?.trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    candidates.push(value);
  };
  for (const envName of providerNodePathEnvNames(provider)) add(env[envName]);
  const executableName = process.platform === 'win32' ? 'node.exe' : 'node';
  add(path.join(path.dirname(binaryPath), executableName));
  for (const directory of pathDirectories(env)) add(path.join(directory, executableName));
  add(process.execPath);
  return candidates;
}

function withNodeDirectoryFirst(env: NodeJS.ProcessEnv, nodePath: string): NodeJS.ProcessEnv {
  const nodeDirectory = path.dirname(nodePath);
  const directories = pathDirectories(env)
    .filter((directory) => path.resolve(directory) !== path.resolve(nodeDirectory));
  return {
    ...env,
    PATH: [nodeDirectory, ...directories].join(path.delimiter),
  };
}

interface LoopbackProxyEndpoint {
  host: string;
  port: number;
}

function parseNumericLoopbackProxy(value: string | undefined): LoopbackProxyEndpoint | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (!parsed.port) return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    const ipVersion = isIP(host);
    const isLoopback = ipVersion === 4
      ? host.split('.')[0] === '127'
      : ipVersion === 6 && host === '::1';
    if (!isLoopback) return null;
    const port = Number(parsed.port);
    return Number.isInteger(port) && port >= 1 && port <= 65_535
      ? { host, port }
      : null;
  } catch {
    return null;
  }
}

async function isLoopbackProxyConnectionRefused(endpoint: LoopbackProxyEndpoint): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;
    const finish = (refused: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(refused);
    };
    socket.setTimeout(LOOPBACK_PROXY_PROBE_TIMEOUT_MS);
    socket.once('connect', () => finish(false));
    socket.once('timeout', () => finish(false));
    socket.once('error', (error: NodeJS.ErrnoException) => finish(error.code === 'ECONNREFUSED'));
    try {
      socket.connect(endpoint.port, endpoint.host);
    } catch {
      finish(false);
    }
  });
}

async function neutralizeRefusedLoopbackProxies(env: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
  const endpoints = new Map<string, { endpoint: LoopbackProxyEndpoint; envNames: string[] }>();
  for (const envName of PROXY_ENV_NAMES) {
    const endpoint = parseNumericLoopbackProxy(env[envName]);
    if (!endpoint) continue;
    const key = `${endpoint.host}:${endpoint.port}`;
    const existing = endpoints.get(key);
    if (existing) {
      existing.envNames.push(envName);
    } else {
      endpoints.set(key, { endpoint, envNames: [envName] });
    }
  }

  await Promise.all([...endpoints.values()].map(async ({ endpoint, envNames }) => {
    if (!await isLoopbackProxyConnectionRefused(endpoint)) return;
    for (const envName of envNames) {
      // Empty values override the daemon's process.env when backends assemble
      // their final child environment, while proxy-aware CLIs treat them as disabled.
      env[envName] = '';
    }
  }));
  return env;
}

export async function resolveProviderProcessEnv(
  provider: RuntimePlatformId,
  binaryPath: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<ProviderProcessEnvResolution> {
  const platform = getRuntimePlatformDefinition(provider);
  const minimumVersion = platform.runtime.nodeRuntime?.minimumVersion;
  const env = await neutralizeRefusedLoopbackProxies({ ...baseEnv });
  if (!minimumVersion || !(await isNodeShebangExecutable(binaryPath))) return { env };

  const checked: string[] = [];
  for (const candidate of nodeCandidates(provider, binaryPath, env)) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
    } catch {
      continue;
    }
    const version = await readNodeVersion(candidate);
    if (!version) continue;
    checked.push(`${candidate} (${version})`);
    if (versionAtLeast(version, minimumVersion)) {
      return {
        env: withNodeDirectoryFirst(env, candidate),
        nodePath: candidate,
      };
    }
  }

  const found = checked.length ? ` Found: ${checked.join(', ')}.` : '';
  return {
    env,
    error: `${platform.displayName} requires Node.js >=${minimumVersion}, but no compatible Node.js executable was found.${found}`,
  };
}
