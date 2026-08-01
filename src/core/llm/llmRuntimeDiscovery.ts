import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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
import { resolveProviderProcessEnv } from './providerProcessEnv';

export interface DiscoveryInput {
  env?: NodeJS.ProcessEnv;
  providers?: LlmProvider[];
  createId?: () => string;
  now?: () => string;
  readinessProbe?: RuntimeReadinessProbe;
  readinessTimeoutMs?: number;
  providerConcurrency?: number;
  knownRuntimes?: LlmRuntime[];
  recentHealthyReadinessSkipMs?: number;
  cwd?: string;
  shellResolvedExecutables?: Record<string, string>;
  onRuntimeDiscovered?: (runtime: LlmRuntime) => void | Promise<void>;
  /** Presence-scan mode: stop after the version probe and report each found binary as `detected` without running readiness probes. */
  skipReadinessProbe?: boolean;
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
const DEFAULT_VERSION_PROBE_TIMEOUT_MS = 5_000;
const DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS = 15_000;
const WORKBUDDY_READINESS_ABORT_SETTLE_GRACE_MS = 1_000;
const DEFAULT_PROVIDER_DISCOVERY_CONCURRENCY = 8;
const DEFAULT_RECENT_HEALTHY_READINESS_SKIP_MS = 30 * 60 * 1000;
const READINESS_PROMPT = 'Reply exactly OK.';
const LOGIN_SHELL_RESOLVE_TIMEOUT_MS = 3_000;
const PROBE_KILL_GRACE_MS = 2_000;

function getPathEnv(env?: NodeJS.ProcessEnv): string {
  return (env ?? process.env).PATH ?? '';
}

function splitPath(pathEnv: string): string[] {
  const separator = process.platform === 'win32' ? ';' : ':';
  return pathEnv.split(separator).filter(Boolean);
}

function normalizeProviderDiscoveryConcurrency(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_PROVIDER_DISCOVERY_CONCURRENCY;
  }
  return Math.max(1, Math.floor(value));
}

function normalizeRecentHealthyReadinessSkipMs(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_RECENT_HEALTHY_READINESS_SKIP_MS;
  }
  return Math.max(0, Math.floor(value));
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function canSkipReadinessForKnownRuntime(
  knownRuntime: LlmRuntime | undefined,
  nowIso: string,
  windowMs: number,
): knownRuntime is LlmRuntime {
  if (!knownRuntime || knownRuntime.health !== 'healthy') return false;
  const checkedAt = parseIsoMs(knownRuntime.healthCheckedAt ?? knownRuntime.updatedAt);
  const nowMs = parseIsoMs(nowIso);
  if (checkedAt === null || nowMs === null || checkedAt > nowMs) return false;
  return nowMs - checkedAt <= windowMs;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, concurrency);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await task(items[index], index);
    }
  }));
  return results;
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

/**
 * Sends SIGTERM, then escalates to SIGKILL after a grace window and destroys
 * the child's stdio streams so a wedged child (or grandchildren holding its
 * pipes) cannot hold the `close` event open. Returns a cancel function for
 * the escalation timer; `onTerminated` runs when the grace window expires.
 */
function terminateChildWithKillGrace(
  child: ChildProcess,
  onTerminated: () => void,
): () => void {
  try { child.kill('SIGTERM'); } catch { /* best effort */ }
  const graceTimer = setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* best effort */ }
    child.stdout?.destroy();
    child.stderr?.destroy();
    onTerminated();
  }, PROBE_KILL_GRACE_MS);
  return () => clearTimeout(graceTimer);
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
    let cancelKillEscalation: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      if (cancelKillEscalation) cancelKillEscalation();
      const resolved: Record<string, string> = {};
      for (const line of output.trim().split('\n')) {
        const [name, candidate] = line.split('\t', 2);
        if (!name || !candidate || !path.isAbsolute(candidate)) continue;
        resolved[name] = candidate;
      }
      resolve(resolved);
    };
    const timeoutTimer = setTimeout(() => {
      cancelKillEscalation = terminateChildWithKillGrace(child, finish);
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

function providerEnvAliases(provider: LlmProvider, platform: RuntimePlatformDefinition): string[] {
  const aliases = new Set<string>();
  aliases.add(normalizeEnvKey(provider));
  for (const binaryName of platform.runtime.envAliases ?? platform.runtime.binaryNames) {
    aliases.add(normalizeEnvKey(binaryName));
  }
  if (provider === 'claude-code') aliases.add('CLAUDE');
  return [...aliases];
}

function providerPathEnvNames(provider: LlmProvider, platform: RuntimePlatformDefinition): string[] {
  return providerEnvAliases(provider, platform).flatMap((alias) => [
    `OAC_${alias}_PATH`,
    `METABOT_${alias}_PATH`,
    `OPEN_AGENT_CONNECT_${alias}_PATH`,
  ]);
}

function providerModelEnvNames(provider: LlmProvider, platform: RuntimePlatformDefinition): string[] {
  return providerEnvAliases(provider, platform).flatMap((alias) => [
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

function providerPathSearchBinaryNames(platform: RuntimePlatformDefinition): string[] {
  return platform.runtime.pathSearchBinaryNames ?? platform.runtime.binaryNames;
}

async function executableCandidatesForProvider(
  provider: LlmProvider,
  platform: RuntimePlatformDefinition,
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
  for (const binaryName of providerPathSearchBinaryNames(platform)) {
    for (const candidate of await findExecutablesInPath(binaryName, pathDirs)) {
      add(candidate);
    }
    add(shellResolvedExecutables?.[binaryName]);
  }
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
    let timedOut = false;
    let cancelKillEscalation: (() => void) | undefined;
    const timeoutMessage = `Version probe timed out after ${timeoutMs}ms.`;
    const finish = (probe: ExecutableVersionProbe): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (cancelKillEscalation) cancelKillEscalation();
      resolve(probe);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      // TERM -> grace -> KILL + stream destroy, so a wedged shim (or one whose
      // grandchildren hold its pipes) cannot leak past the probe window.
      cancelKillEscalation = terminateChildWithKillGrace(child, () => {
        finish({ ok: false, message: timeoutMessage });
      });
    }, timeoutMs);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');

    child.stdout?.on('data', (chunk: string) => { output += chunk; });
    child.stderr?.on('data', (chunk: string) => { output += chunk; });

    child.on('close', (code) => {
      if (timedOut) {
        finish({ ok: false, message: timeoutMessage });
        return;
      }
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

function readinessTimeoutMessage(
  provider: LlmProvider,
  timeoutMs: number,
  backendMessage?: string,
): string {
  const timeoutMessage = `Readiness probe timed out after ${timeoutMs}ms.`;
  if (provider !== 'workbuddy' || !backendMessage) return timeoutMessage;

  const addressInUse = backendMessage.match(
    /\bEADDRINUSE\b[^\r\n]*?\b((?:127\.0\.0\.1|localhost):(\d{1,5}))\b/i,
  );
  if (!addressInUse) return timeoutMessage;

  const port = Number(addressInUse[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return timeoutMessage;
  return `${timeoutMessage} WorkBuddy CLI reported that ${addressInUse[1]} is already in use (EADDRINUSE).`;
}

function probeHintsForProvider(provider: LlmProvider) {
  if (!isRuntimePlatformId(provider)) return undefined;
  return getRuntimePlatformDefinition(provider).runtime.probeHints;
}

function readinessTimeoutForProvider(provider: LlmProvider, override?: number): number {
  if (override !== undefined) return override;
  return probeHintsForProvider(provider)?.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
}

function versionProbeTimeoutForProvider(provider: LlmProvider): number {
  return probeHintsForProvider(provider)?.versionProbeTimeoutMs ?? DEFAULT_VERSION_PROBE_TIMEOUT_MS;
}

export function readinessSemanticInactivityTimeoutForProvider(
  provider: LlmProvider,
  readinessTimeoutMs: number,
): number {
  const hint = probeHintsForProvider(provider)?.semanticInactivityTimeoutMs;
  if (hint !== undefined) return hint;
  return Math.min(readinessTimeoutMs, DEFAULT_READINESS_SEMANTIC_INACTIVITY_TIMEOUT_MS);
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
  let fallbackTimer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const timeout = new Promise<RuntimeReadinessProbeResult>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      if (input.runtime.provider !== 'workbuddy') {
        resolve({ ok: false, message: readinessTimeoutMessage(input.runtime.provider, input.timeoutMs) });
        return;
      }
      // Give the backend time to terminate its child and attach bounded stderr
      // diagnostics before falling back to the generic timeout message.
      fallbackTimer = setTimeout(() => {
        resolve({
          ok: false,
          message: readinessTimeoutMessage(input.runtime.provider, input.timeoutMs),
        });
      }, WORKBUDDY_READINESS_ABORT_SETTLE_GRACE_MS);
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
      const backendMessage = result.error || `Readiness probe ended with status ${result.status}.`;
      return {
        ok: false,
        output,
        message: timedOut
          ? readinessTimeoutMessage(input.runtime.provider, input.timeoutMs, backendMessage)
          : backendMessage,
      };
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
    if (fallbackTimer) clearTimeout(fallbackTimer);
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
    knownRuntimesById?: ReadonlyMap<string, LlmRuntime>;
    recentHealthyReadinessSkipMs?: number;
    cwd?: string;
    shellResolvedExecutables?: Record<string, string>;
    skipReadinessProbe?: boolean;
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
  const binaryPaths = await executableCandidatesForProvider(
    provider,
    platform,
    pathDirs,
    env,
    options?.shellResolvedExecutables,
  );
  for (const binaryPath of binaryPaths) {
    const processEnv = await resolveProviderProcessEnv(provider, binaryPath, env);
    if (processEnv.error) {
      firstUnavailableCandidate ??= {
        binaryPath,
        versionProbe: { ok: false, message: processEnv.error },
      };
      continue;
    }
    const versionProbe = await probeExecutableVersion(
      binaryPath,
      platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'],
      versionProbeTimeoutForProvider(provider),
      processEnv.env,
    );
    if (versionProbe.ok) {
      const runtime = buildDiscoveredRuntime(provider, platform, binaryPath, versionProbe, options);
      const knownRuntime = options?.knownRuntimesById?.get(runtime.id);
      if (canSkipReadinessForKnownRuntime(
        knownRuntime,
        runtime.updatedAt,
        normalizeRecentHealthyReadinessSkipMs(options?.recentHealthyReadinessSkipMs),
      )) {
        return {
          ...runtime,
          health: 'healthy',
          healthReason: undefined,
          unavailableUntil: undefined,
          healthCheckedAt: knownRuntime.healthCheckedAt ?? knownRuntime.updatedAt,
        };
      }
      // Presence-scan mode (spec R2): the binary exists and answers --version;
      // report it as detected without paying the readiness-probe latency.
      if (options?.skipReadinessProbe) {
        return {
          ...runtime,
          health: 'detected',
          healthReason: 'Readiness probe skipped during presence scan.',
        };
      }
      const readiness = await readinessProbe({
        runtime,
        env: processEnv.env,
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
  const processEnv = await resolveProviderProcessEnv(runtime.provider, runtime.binaryPath, env);
  if (processEnv.error) {
    return {
      ...base,
      health: 'unavailable',
      healthReason: processEnv.error,
    };
  }
  const versionProbe = await probeExecutableVersion(
    runtime.binaryPath,
    platform.runtime.versionArgs.length ? platform.runtime.versionArgs : ['--version'],
    versionProbeTimeoutForProvider(runtime.provider),
    processEnv.env,
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
    env: processEnv.env,
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

/**
 * Lazily resolves executables through a login shell, but only for providers
 * that found no candidate through the cheap sources (env overrides, PATH,
 * default executable paths). Shell-returned paths are re-verified before use
 * because fnm/nvm multishell dirs can vanish between resolution and use.
 */
async function resolveMissedExecutablesViaLoginShell(
  platforms: RuntimePlatformDefinition[],
  pathDirs: string[],
  env: NodeJS.ProcessEnv,
): Promise<Record<string, string>> {
  const missedBinaryNames: string[] = [];
  for (const platform of platforms) {
    const candidates = await executableCandidatesForProvider(platform.id, platform, pathDirs, env, undefined);
    if (candidates.length === 0) {
      missedBinaryNames.push(...providerPathSearchBinaryNames(platform));
    }
  }
  if (missedBinaryNames.length === 0) return {};
  const shellResolved = await resolveExecutablesViaLoginShell(missedBinaryNames, env);
  const verified: Record<string, string> = {};
  for (const [name, candidate] of Object.entries(shellResolved)) {
    try {
      await fs.access(candidate, fs.constants.X_OK);
      verified[name] = candidate;
    } catch {
      // Shell-resolved path vanished before it could be probed; skip it.
    }
  }
  return verified;
}

/**
 * Orders platforms so likely-present providers are probed first: providers
 * with known runtimes, then providers whose default executable paths exist
 * on disk, then everything else. Relative order within a tier follows
 * registry order.
 */
async function orderPlatformsForDiscovery(
  platforms: RuntimePlatformDefinition[],
  knownRuntimes: LlmRuntime[],
): Promise<RuntimePlatformDefinition[]> {
  const knownProviders = new Set(knownRuntimes.map((runtime) => runtime.provider));
  const providersWithExistingDefaults = new Set<string>();
  for (const platform of platforms) {
    if (knownProviders.has(platform.id)) continue;
    for (const candidate of platform.runtime.defaultExecutablePaths ?? []) {
      try {
        await fs.access(candidate);
        providersWithExistingDefaults.add(platform.id);
        break;
      } catch {
        // Best effort: a missing default path just keeps the provider in the last tier.
      }
    }
  }
  const tierOf = (platform: RuntimePlatformDefinition): number => {
    if (knownProviders.has(platform.id)) return 0;
    if (providersWithExistingDefaults.has(platform.id)) return 1;
    return 2;
  };
  return [...platforms].sort((a, b) => tierOf(a) - tierOf(b));
}

export async function discoverLlmRuntimes(input?: DiscoveryInput): Promise<DiscoveryResult> {
  const env = input?.env ?? process.env;
  const pathDirs = splitPath(getPathEnv(env));
  const runtimes: LlmRuntime[] = [];
  const errors: Array<{ provider: string; message: string }> = [];
  const requestedProviders = new Set(
    (input?.providers ?? []).filter((provider) => isRuntimePlatformId(provider)),
  );
  const platforms = requestedProviders.size > 0
    ? getRuntimePlatforms().filter((platform) => requestedProviders.has(platform.id))
    : getRuntimePlatforms();
  const shellResolvedExecutables = input?.shellResolvedExecutables
    ?? await resolveMissedExecutablesViaLoginShell(platforms, pathDirs, env);
  const knownRuntimes = input?.knownRuntimes ?? [];
  const knownRuntimesById = new Map(knownRuntimes.map((runtime) => [runtime.id, runtime]));
  const orderedPlatforms = await orderPlatformsForDiscovery(platforms, knownRuntimes);

  const discoveryResults = await mapWithConcurrency(
    orderedPlatforms,
    normalizeProviderDiscoveryConcurrency(input?.providerConcurrency),
    async (platform) => {
      let runtime: LlmRuntime | null = null;
      try {
        runtime = await discoverProvider(platform.id, pathDirs, {
          createId: input?.createId,
          now: input?.now,
          env,
          readinessProbe: input?.readinessProbe,
          readinessTimeoutMs: input?.readinessTimeoutMs,
          knownRuntimesById,
          recentHealthyReadinessSkipMs: input?.recentHealthyReadinessSkipMs,
          cwd: input?.cwd,
          shellResolvedExecutables,
          skipReadinessProbe: input?.skipReadinessProbe,
        });
      } catch (err) {
        return {
          runtime: null,
          error: {
            provider: platform.id,
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
      if (runtime && input?.onRuntimeDiscovered) {
        try {
          await input.onRuntimeDiscovered(runtime);
        } catch (err) {
          return {
            runtime,
            error: {
              provider: platform.id,
              message: err instanceof Error ? err.message : String(err),
            },
          };
        }
      }
      return { runtime, error: null };
    },
  );

  for (const result of discoveryResults) {
    if (result.runtime) {
      runtimes.push(result.runtime);
    }
    if (result.error) {
      errors.push(result.error);
    }
  }

  return { runtimes, errors };
}
