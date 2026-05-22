import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  getRuntimePlatformDefinition,
  getRuntimePlatforms,
  isRuntimePlatformId,
} from '../platform/platformRegistry';
import type { RuntimePlatformDefinition } from '../platform/platformRegistry';
import type { LlmRuntime, LlmProvider, LlmAuthState } from './llmTypes';
import { createRegistryBackendFactories } from './executor/backends/registry';
import type { LlmExecutionEvent } from './executor/types';

export interface DiscoveryInput {
  env?: NodeJS.ProcessEnv;
  createId?: () => string;
  now?: () => string;
  readinessProbe?: RuntimeReadinessProbe;
  readinessTimeoutMs?: number;
  cwd?: string;
}

export interface DiscoveryResult {
  runtimes: LlmRuntime[];
  errors: Array<{ provider: string; message: string }>;
}

export interface ExecutableVersionProbe {
  ok: boolean;
  version?: string;
  exitCode?: number | null;
  message?: string;
}

export interface RuntimeReadinessProbeResult {
  ok: boolean;
  output?: string;
  message?: string;
}

export type RuntimeReadinessProbe = (input: {
  runtime: LlmRuntime;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  cwd?: string;
}) => Promise<RuntimeReadinessProbeResult>;

const DEFAULT_READINESS_TIMEOUT_MS = 20_000;
const READINESS_PROMPT = 'Reply exactly OK.';

function getPathEnv(env?: NodeJS.ProcessEnv): string {
  return (env ?? process.env).PATH ?? '';
}

function splitPath(pathEnv: string): string[] {
  const separator = process.platform === 'win32' ? ';' : ':';
  return pathEnv.split(separator).filter(Boolean);
}

export async function findExecutableInPath(name: string, pathDirs?: string[]): Promise<string | null> {
  const matches = await findExecutablesInPath(name, pathDirs);
  return matches[0] ?? null;
}

export async function findExecutablesInPath(name: string, pathDirs?: string[]): Promise<string[]> {
  const dirs = pathDirs ?? splitPath(getPathEnv());
  const matches: string[] = [];
  const seen = new Set<string>();
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    try {
      await fs.access(candidate, fs.constants.X_OK);
      matches.push(candidate);
    } catch {
      // Not found / not executable.
    }
  }
  return matches;
}

export async function readExecutableVersion(
  binaryPath: string,
  versionArgs: string[] = ['--version'],
  timeoutMs = 5_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const probe = await probeExecutableVersion(binaryPath, versionArgs, timeoutMs, env);
  return probe.ok ? probe.version : undefined;
}

export async function probeExecutableVersion(
  binaryPath: string,
  versionArgs: string[] = ['--version'],
  timeoutMs = 5_000,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ExecutableVersionProbe> {
  return new Promise((resolve) => {
    const child = spawn(binaryPath, versionArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
      shell: false,
    });

    let output = '';
    let settled = false;
    const finish = (probe: ExecutableVersionProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(probe);
    };
    const timer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
      finish({ ok: false, message: `Version probe timed out after ${timeoutMs}ms.` });
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => { output += chunk; });
    child.stderr?.on('data', (chunk: string) => { output += chunk; });

    child.on('close', (code) => {
      const trimmed = output.trim();
      if (code !== 0) {
        finish({
          ok: false,
          exitCode: code,
          message: trimmed || `Version probe exited with code ${code ?? 'unknown'}.`,
        });
        return;
      }
      if (!trimmed) {
        finish({ ok: true, exitCode: code });
        return;
      }
      const match = trimmed.match(/(\d+\.\d+\.\d+(?:[-+][^\s]+)?)/);
      finish({
        ok: true,
        exitCode: code,
        version: match ? match[1] : trimmed.split(/\s+/).pop() ?? undefined,
      });
    });

    child.on('error', (error) => {
      finish({ ok: false, message: error.message });
    });
  });
}

function detectAuthState(authEnv: string[], env: NodeJS.ProcessEnv): LlmAuthState {
  if (authEnv.some((envVar) => Boolean(env[envVar]))) {
    return 'authenticated';
  }
  return 'unknown';
}

function compactEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function buildDiscoveredRuntime(
  provider: LlmProvider,
  platform: RuntimePlatformDefinition,
  binaryPath: string,
  versionProbe: ExecutableVersionProbe,
  options?: { createId?: () => string; now?: () => string; env?: NodeJS.ProcessEnv },
): LlmRuntime {
  const env = options?.env ?? process.env;
  const now = (options?.now ?? (() => new Date().toISOString()))();
  // Stable ID: same binary always gets same id, so rediscovery upserts instead of duplicating.
  const defaultId = `llm_${provider.replace(/-/g, '_')}_${binaryPath}`;
  const createId = options?.createId ?? (() => defaultId);
  const authState = detectAuthState(platform.runtime.authEnv, env);

  return {
    id: createId(),
    provider,
    displayName: platform.displayName,
    binaryPath,
    version: versionProbe.version,
    logoPath: platform.logoPath,
    authState,
    health: versionProbe.ok ? 'detected' : 'unavailable',
    ...(versionProbe.ok
      ? {}
      : {
        healthReason: versionProbe.message ?? 'Version probe failed.',
        healthCheckedAt: now,
      }),
    capabilities: [...platform.runtime.capabilities],
    lastSeenAt: now,
    createdAt: now,
    updatedAt: now,
  };
}

function readinessSucceeded(result: RuntimeReadinessProbeResult): boolean {
  return result.ok && typeof result.output === 'string' && result.output.trim().length > 0;
}

async function defaultRuntimeReadinessProbe(input: {
  runtime: LlmRuntime;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  cwd?: string;
}): Promise<RuntimeReadinessProbeResult> {
  const binaryPath = input.runtime.binaryPath;
  if (!binaryPath) {
    return { ok: false, message: 'Runtime has no binary path.' };
  }
  const factory = createRegistryBackendFactories()[input.runtime.provider];
  if (!factory) {
    return { ok: false, message: `No readiness backend is registered for provider: ${input.runtime.provider}` };
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<RuntimeReadinessProbeResult>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve({ ok: false, message: `Readiness probe timed out after ${input.timeoutMs}ms.` });
    }, input.timeoutMs);
  });

  const backend = factory(binaryPath, compactEnv(input.env));
  const outputParts: string[] = [];
  const probe = backend.execute({
    runtimeId: input.runtime.id,
    runtime: input.runtime,
    prompt: READINESS_PROMPT,
    timeout: input.timeoutMs,
    semanticInactivityTimeout: Math.min(input.timeoutMs, 5_000),
    cwd: input.cwd ?? process.cwd(),
  }, {
    emit(event: LlmExecutionEvent) {
      if (event.type === 'text') {
        outputParts.push(event.content);
      }
    },
  }, controller.signal).then((result) => {
    const output = result.output || outputParts.join('');
    if (result.status !== 'completed') {
      return { ok: false, output, message: result.error || `Readiness probe ended with status ${result.status}.` };
    }
    if (!output.trim()) {
      return { ok: false, output, message: 'Readiness probe completed without returning output.' };
    }
    return { ok: true, output };
  }).catch((error) => ({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  }));

  try {
    return await Promise.race([probe, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function discoverProvider(
  provider: LlmProvider,
  pathDirs: string[],
  options?: {
    createId?: () => string;
    now?: () => string;
    env?: NodeJS.ProcessEnv;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    cwd?: string;
  },
): Promise<LlmRuntime | null> {
  if (provider === 'custom') return null; // Custom runtimes are registered manually.
  if (!isRuntimePlatformId(provider)) return null;

  const platform = getRuntimePlatformDefinition(provider);
  let firstUnavailableCandidate: { binaryPath: string; versionProbe: ExecutableVersionProbe } | null = null;
  let firstDetectedRuntime: LlmRuntime | null = null;
  const env = options?.env ?? process.env;
  const readinessProbe = options?.readinessProbe ?? defaultRuntimeReadinessProbe;
  const readinessTimeoutMs = options?.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  for (const binaryName of platform.runtime.binaryNames) {
    const binaryPaths = await findExecutablesInPath(binaryName, pathDirs);
    for (const binaryPath of binaryPaths) {
      const versionProbe = await probeExecutableVersion(
        binaryPath,
        platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'],
        5_000,
        env,
      );
      if (versionProbe.ok) {
        const runtime = buildDiscoveredRuntime(provider, platform, binaryPath, versionProbe, options);
        const readiness = await readinessProbe({
          runtime,
          env,
          timeoutMs: readinessTimeoutMs,
          cwd: options?.cwd,
        });
        const checkedAt = (options?.now ?? (() => new Date().toISOString()))();
        if (readinessSucceeded(readiness)) {
          return {
            ...runtime,
            health: 'healthy',
            healthReason: undefined,
            healthCheckedAt: checkedAt,
            updatedAt: checkedAt,
          };
        }
        firstDetectedRuntime ??= {
          ...runtime,
          health: 'detected',
          healthReason: readiness.message ?? 'Readiness probe did not return a usable response.',
          healthCheckedAt: checkedAt,
          updatedAt: checkedAt,
        };
        continue;
      }
      if (!firstUnavailableCandidate) {
        firstUnavailableCandidate = { binaryPath, versionProbe };
      }
    }
  }

  if (firstDetectedRuntime) return firstDetectedRuntime;

  if (!firstUnavailableCandidate) return null;
  return buildDiscoveredRuntime(
    provider,
    platform,
    firstUnavailableCandidate.binaryPath,
    firstUnavailableCandidate.versionProbe,
    options,
  );
}

export async function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult> {
  const pathDirs = splitPath(getPathEnv(input?.env));
  const runtimes: LlmRuntime[] = [];
  const errors: Array<{ provider: string; message: string }> = [];

  // Discover each supported provider. Run in sequence to keep it simple;
  // the binary spawns are the slow part, and they're already async.
  for (const platform of getRuntimePlatforms()) {
    try {
      const runtime = await discoverProvider(platform.id, pathDirs, {
        createId: input?.createId,
        now: input?.now,
        env: input?.env ?? process.env,
        readinessProbe: input?.readinessProbe,
        readinessTimeoutMs: input?.readinessTimeoutMs,
        cwd: input?.cwd,
      });
      if (runtime) {
        runtimes.push(runtime);
      }
    } catch (err) {
      errors.push({
        provider: platform.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { runtimes, errors };
}
