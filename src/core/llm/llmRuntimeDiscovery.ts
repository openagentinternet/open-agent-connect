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
  shellResolvedExecutables?: Record<string, string>;
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

const DEFAULT_READINESS_TIMEOUT_MS = 30_000;
const SLOW_START_READINESS_TIMEOUT_MS = 45_000;
const DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS = 15_000;
const READINESS_PROMPT = 'Reply exactly OK.';
const LOGIN_SHELL_RESOLVE_TIMEOUT_MS = 3_000;
const LOGIN_SHELL_RESOLVE_KILL_GRACE_MS = 2_000;

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

function safeAgentName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function buildLoginShellResolveScript(names: string[]): string {
  return [
    `for n in ${names.join(' ')}; do`,
    '  unalias "$n" 2>/dev/null',
    '  unset -f "$n" 2>/dev/null',
    '  p=$(command -v "$n" 2>/dev/null) || continue',
    '  [ -n "$p" ] || continue',
    '  case "$p" in /*) ;; *) continue ;; esac',
    '  d=$(dirname "$p") && f=$(basename "$p") && c=$(cd "$d" 2>/dev/null && pwd -P) || continue',
    '  printf \'%s\\t%s\\n\' "$n" "$c/$f"',
    'done',
  ].join('\n');
}

async function resolveExecutablesViaLoginShell(
  names: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, string>> {
  const safeNames = [...new Set(names)].filter(safeAgentName);
  if (!safeNames.length) return {};

  const shell = (env.SHELL ?? '').trim();
  const shellName = path.basename(shell);
  if (!shell || !['bash', 'zsh', 'sh', 'dash', 'ksh'].includes(shellName)) return {};

  return new Promise((resolve) => {
    const child = spawn(shell, ['-ilc', buildLoginShellResolveScript(safeNames)], {
      stdio: ['ignore', 'pipe', 'ignore'],
      env,
      shell: false,
    });
    let output = '';
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (graceTimer) clearTimeout(graceTimer);
      const resolved: Record<string, string> = {};
      for (const line of output.trim().split('\n')) {
        const [name, candidate] = line.split('\t', 2);
        if (!name || !candidate || !path.isAbsolute(candidate)) continue;
        resolved[name] = candidate;
      }
      resolve(resolved);
    };
    const timeoutTimer = setTimeout(() => {
      try { child.kill('SIGTERM'); } catch { /* best effort */ }
      graceTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* best effort */ }
        finish();
      }, LOGIN_SHELL_RESOLVE_KILL_GRACE_MS);
    }, LOGIN_SHELL_RESOLVE_TIMEOUT_MS);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { output += chunk; });
    child.on('close', finish);
    child.on('error', finish);
  });
}

function normalizeEnvKey(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
}

function providerPathEnvNames(provider: LlmProvider, platform: RuntimePlatformDefinition): string[] {
  const aliases = new Set<string>();
  aliases.add(normalizeEnvKey(provider));
  for (const binaryName of platform.runtime.binaryNames) {
    aliases.add(normalizeEnvKey(binaryName));
  }
  if (provider === 'claude-code') aliases.add('CLAUDE');
  return [...aliases].flatMap((alias) => [
    `OAC_${alias}_PATH`,
    `METABOT_${alias}_PATH`,
    `OPEN_AGENT_CONNECT_${alias}_PATH`,
  ]);
}

function providerModelEnvNames(provider: LlmProvider, platform: RuntimePlatformDefinition): string[] {
  const aliases = new Set<string>();
  aliases.add(normalizeEnvKey(provider));
  for (const binaryName of platform.runtime.binaryNames) {
    aliases.add(normalizeEnvKey(binaryName));
  }
  if (provider === 'claude-code') aliases.add('CLAUDE');
  return [...aliases].flatMap((alias) => [
    `OAC_${alias}_MODEL`,
    `METABOT_${alias}_MODEL`,
    `OPEN_AGENT_CONNECT_${alias}_MODEL`,
  ]);
}

function providerModelFromEnv(provider: LlmProvider, platform: RuntimePlatformDefinition, env: NodeJS.ProcessEnv): string | undefined {
  for (const envName of providerModelEnvNames(provider, platform)) {
    const model = env[envName]?.trim();
    if (model) return model;
  }
  return undefined;
}

async function executableCandidatesForProvider(
  provider: LlmProvider,
  platform: RuntimePlatformDefinition,
  binaryName: string,
  pathDirs: string[],
  env: NodeJS.ProcessEnv,
  shellResolvedExecutables?: Record<string, string>,
): Promise<string[]> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: string | undefined) => {
    const trimmed = candidate?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    candidates.push(trimmed);
  };
  const addExecutableIfPresent = async (candidate: string | undefined) => {
    const trimmed = candidate?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    try {
      await fs.access(trimmed, fs.constants.X_OK);
      add(trimmed);
    } catch {
      // App-bundled defaults are optional and should not create unavailable runtimes when absent.
    }
  };
  for (const envName of providerPathEnvNames(provider, platform)) {
    add(env[envName]);
  }
  for (const candidate of await findExecutablesInPath(binaryName, pathDirs)) {
    add(candidate);
  }
  add(shellResolvedExecutables?.[binaryName]);
  for (const candidate of platform.runtime.defaultExecutablePaths ?? []) {
    await addExecutableIfPresent(candidate);
  }
  return candidates;
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
    model: providerModelFromEnv(provider, platform, env),
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

function readinessTimeoutForProvider(provider: LlmProvider, override?: number): number {
  if (override !== undefined) return override;
  return ['codex', 'cursor', 'claude-code', 'zcode'].includes(provider)
    ? SLOW_START_READINESS_TIMEOUT_MS
    : DEFAULT_READINESS_TIMEOUT_MS;
}

export function readinessSemanticInactivityTimeoutForProvider(
  provider: LlmProvider,
  readinessTimeoutMs: number,
): number {
  return ['codex', 'cursor', 'claude-code', 'zcode'].includes(provider)
    ? readinessTimeoutMs
    : Math.min(readinessTimeoutMs, DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS);
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
    semanticInactivityTimeout: readinessSemanticInactivityTimeoutForProvider(
      input.runtime.provider,
      input.timeoutMs,
    ),
    cwd: input.cwd ?? process.cwd(),
    model: input.runtime.model,
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
    shellResolvedExecutables?: Record<string, string>;
  },
): Promise<LlmRuntime | null> {
  if (provider === 'custom') return null; // Custom runtimes are registered manually.
  if (!isRuntimePlatformId(provider)) return null;

  const platform = getRuntimePlatformDefinition(provider);
  let firstUnavailableCandidate: { binaryPath: string; versionProbe: ExecutableVersionProbe } | null = null;
  let firstDetectedRuntime: LlmRuntime | null = null;
  const env = options?.env ?? process.env;
  const readinessProbe = options?.readinessProbe ?? defaultRuntimeReadinessProbe;
  const readinessTimeoutMs = readinessTimeoutForProvider(provider, options?.readinessTimeoutMs);
  for (const binaryName of platform.runtime.binaryNames) {
    const binaryPaths = await executableCandidatesForProvider(
      provider,
      platform,
      binaryName,
      pathDirs,
      env,
      options?.shellResolvedExecutables,
    );
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

export async function testLlmRuntimeReadiness(
  runtime: LlmRuntime,
  options?: {
    env?: NodeJS.ProcessEnv;
    readinessProbe?: RuntimeReadinessProbe;
    readinessTimeoutMs?: number;
    cwd?: string;
    now?: () => string;
  },
): Promise<LlmRuntime> {
  const env = options?.env ?? process.env;
  const now = (options?.now ?? (() => new Date().toISOString()))();
  const base = {
    ...runtime,
    lastSeenAt: now,
    healthCheckedAt: now,
    updatedAt: now,
  };

  if (!runtime.binaryPath) {
    return {
      ...base,
      health: 'unavailable',
      healthReason: 'Runtime has no binary path.',
    };
  }
  if (runtime.provider === 'custom' || !isRuntimePlatformId(runtime.provider)) {
    return {
      ...base,
      health: 'unavailable',
      healthReason: `No runtime platform is registered for provider: ${runtime.provider}`,
    };
  }

  const platform = getRuntimePlatformDefinition(runtime.provider);
  const versionProbe = await probeExecutableVersion(
    runtime.binaryPath,
    platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'],
    5_000,
    env,
  );
  const probedRuntime: LlmRuntime = {
    ...buildDiscoveredRuntime(runtime.provider, platform, runtime.binaryPath, versionProbe, {
      env,
      now: () => now,
      createId: () => runtime.id,
    }),
    displayName: runtime.displayName || platform.displayName,
    logoPath: runtime.logoPath || platform.logoPath,
    model: runtime.model ?? providerModelFromEnv(runtime.provider, platform, env),
    capabilities: runtime.capabilities?.length ? [...runtime.capabilities] : [...platform.runtime.capabilities],
    createdAt: runtime.createdAt ?? now,
    lastSeenAt: now,
    healthCheckedAt: now,
    updatedAt: now,
  };

  if (!versionProbe.ok) {
    return {
      ...probedRuntime,
      health: 'unavailable',
      healthReason: versionProbe.message ?? 'Version probe failed.',
    };
  }

  const readinessProbe = options?.readinessProbe ?? defaultRuntimeReadinessProbe;
  const readiness = await readinessProbe({
    runtime: {
      ...probedRuntime,
      health: 'detected',
      healthReason: undefined,
    },
    env,
    timeoutMs: readinessTimeoutForProvider(runtime.provider, options?.readinessTimeoutMs),
    cwd: options?.cwd,
  });

  if (readinessSucceeded(readiness)) {
    return {
      ...probedRuntime,
      health: 'healthy',
      healthReason: undefined,
    };
  }

  return {
    ...probedRuntime,
    health: 'detected',
    healthReason: readiness.message
      ?? (typeof readiness.output === 'string' && !readiness.output.trim()
        ? 'Readiness probe completed without returning output.'
        : 'Readiness probe did not return a usable response.'),
  };
}

export async function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult> {
  const env = input?.env ?? process.env;
  const pathDirs = splitPath(getPathEnv(env));
  const runtimes: LlmRuntime[] = [];
  const errors: Array<{ provider: string; message: string }> = [];
  const shellResolvedExecutables = input?.shellResolvedExecutables ?? await resolveExecutablesViaLoginShell(
    getRuntimePlatforms().flatMap((platform) => platform.runtime.binaryNames),
    env,
  );

  // Discover each supported provider. Run in sequence to keep it simple;
  // the binary spawns are the slow part, and they're already async.
  for (const platform of getRuntimePlatforms()) {
    try {
      const runtime = await discoverProvider(platform.id, pathDirs, {
        createId: input?.createId,
        now: input?.now,
        env,
        readinessProbe: input?.readinessProbe,
        readinessTimeoutMs: input?.readinessTimeoutMs,
        cwd: input?.cwd,
        shellResolvedExecutables,
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
