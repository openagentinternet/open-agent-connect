import { randomUUID, createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmBackendFactory } from './backends/backend';
import { stringifyError } from './backends/backend';
import { createFileSessionManager, type SessionManager } from './session-manager';
import { injectSkills } from './skill-injector';
import type { LlmExecutionEvent, LlmExecutionRequest, LlmExecutionResult, LlmSessionRecord } from './types';
import {
  getPlatformSkillRoots,
  isPlatformId,
  isRuntimePlatformId,
  resolvePlatformSkillRootPath,
  type PlatformSkillRoot,
} from '../../platform/platformRegistry';
import { resolveProviderProcessEnv } from '../providerProcessEnv';

interface LlmExecutorOptions {
  sessionsRoot: string;
  transcriptsRoot: string;
  skillsRoot: string;
  systemHomeDir?: string;
  env?: NodeJS.ProcessEnv;
  backends: Record<string, LlmBackendFactory>;
  sessionManager?: SessionManager;
}

interface EventStreamState {
  events: LlmExecutionEvent[];
  closed: boolean;
  waiters: Array<() => void>;
}

interface RunningSession {
  controller: AbortController;
}

interface StrictSkillIsolationScope {
  root: string;
  cwd: string;
  systemHomeDir: string;
  skillSystemHomeDir: string;
  env: Record<string, string>;
}

const STRICT_ISOLATION_PLATFORM_HOME_FILES: Partial<Record<string, string[]>> = {
  'claude-code': ['config.json', 'settings.json'],
  codex: ['auth.json', 'config.toml'],
};

const STRICT_ISOLATION_USER_HOME_FILES: Partial<Record<string, string[]>> = {
  'claude-code': ['.claude.json'],
};

const STRICT_ISOLATION_SOURCE_HOME_PROVIDERS = new Set<string>(['cursor', 'codebuddy', 'zcode', 'workbuddy']);

// Strict-isolation scope reuse (spec R7). Prepared HOME scopes are cached per
// (metaBotSlug, provider, skill allowlist, platform-home fingerprint) inside
// the profile's sessions root, so a chat turn no longer pays the platform-home
// copy cost every time. Trust boundary: a cached scope is only ever reused
// for the same profile + provider + allowlist domain; any fingerprint or
// allowlist change keys a fresh scope, and the LRU cap below bounds residue.
// The whole cache lives under the profile's sessions root, so deleting the
// profile removes it with the profile home.
const STRICT_ISOLATION_SCOPE_CACHE_DIR = '.skill-scope-cache';
const STRICT_ISOLATION_SCOPE_CACHE_LIMIT = 8;

function createSessionId(): string {
  return `llm_${randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function isTerminalStatus(status: string): boolean {
  return ['completed', 'failed', 'timeout', 'cancelled'].includes(status);
}

function mergeStringEnvValues(
  ...sources: Array<Record<string, string | undefined> | undefined>
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      if (typeof value === 'string') {
        merged[key] = value;
      }
    }
  }
  return merged;
}

function platformHomeEnvParent(root: PlatformSkillRoot, isolatedHome: string): string {
  if (!root.path.startsWith('~/')) {
    return isolatedHome;
  }

  const relativePath = root.path.slice(2);
  const segments = relativePath.split('/').filter(Boolean);
  if (segments[segments.length - 1] === 'skills') {
    segments.pop();
  }
  return segments.length > 0 ? path.resolve(isolatedHome, ...segments) : isolatedHome;
}

function skillRootParent(rootPath: string): string {
  return path.basename(rootPath) === 'skills' ? path.dirname(rootPath) : rootPath;
}

function resolveStrictIsolationSourceHome(input: {
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
  fallbackHome: string;
}): string {
  const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
  return sourceEnv.HOME || process.env.HOME || input.fallbackHome;
}

function shouldUseSourceHomeForStrictIsolation(provider: string): boolean {
  return STRICT_ISOLATION_SOURCE_HOME_PROVIDERS.has(provider);
}

async function copyFileIfPresent(sourcePath: string, destinationPath: string): Promise<void> {
  let stat;
  try {
    stat = await fs.stat(sourcePath);
  } catch {
    return;
  }
  if (!stat.isFile()) return;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  await fs.copyFile(sourcePath, destinationPath);
}

async function copyStrictIsolationUserHomeFiles(input: {
  provider: string;
  sourceHome: string;
  isolatedHome: string;
}): Promise<void> {
  const supportFiles = STRICT_ISOLATION_USER_HOME_FILES[input.provider] ?? [];
  for (const fileName of supportFiles) {
    await copyFileIfPresent(
      path.join(input.sourceHome, fileName),
      path.join(input.isolatedHome, fileName),
    );
  }
}

function applyOpenClawStrictIsolationEnv(env: Record<string, string>, sourceHome: string): void {
  const stateDir = path.join(sourceHome, '.openclaw');
  if (!env.OPENCLAW_STATE_DIR) {
    env.OPENCLAW_STATE_DIR = stateDir;
  }
  if (!env.OPENCLAW_CONFIG_PATH) {
    env.OPENCLAW_CONFIG_PATH = path.join(stateDir, 'openclaw.json');
  }
}

function buildStrictSkillIsolationEnv(input: {
  provider: string;
  sourceHome: string;
  isolatedHome: string;
  isolatedCwd: string;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
}): Record<string, string> {
  const env = mergeStringEnvValues(input.baseEnv, input.requestEnv);
  const useSourceHome = shouldUseSourceHomeForStrictIsolation(input.provider);
  env.HOME = useSourceHome ? input.sourceHome : input.isolatedHome;
  env.PWD = input.isolatedCwd;
  env.XDG_CONFIG_HOME = useSourceHome
    ? (env.XDG_CONFIG_HOME || path.join(input.sourceHome, '.config'))
    : path.join(input.isolatedHome, '.config');
  if (isPlatformId(input.provider)) {
    for (const root of getPlatformSkillRoots(input.provider)) {
      if (root.homeEnv) {
        env[root.homeEnv] = platformHomeEnvParent(root, input.isolatedHome);
      }
    }
  }
  if (input.provider === 'openclaw') {
    applyOpenClawStrictIsolationEnv(env, input.sourceHome);
  }
  return env;
}

async function prepareStrictSkillIsolationPlatformHome(input: {
  provider: string;
  sourceHome: string;
  isolatedHome: string;
  env: Record<string, string>;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
}): Promise<void> {
  if (!isPlatformId(input.provider)) return;

  await copyStrictIsolationUserHomeFiles({
    provider: input.provider,
    sourceHome: input.sourceHome,
    isolatedHome: input.isolatedHome,
  });

  const supportFiles = STRICT_ISOLATION_PLATFORM_HOME_FILES[input.provider] ?? [];
  const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
  const preparedParents = new Set<string>();

  for (const root of getPlatformSkillRoots(input.provider)) {
    if (root.kind !== 'global') continue;

    const isolatedSkillRoot = resolvePlatformSkillRootPath(root, input.isolatedHome, input.env);
    const isolatedParent = skillRootParent(isolatedSkillRoot);
    await fs.mkdir(isolatedParent, { recursive: true });

    if (supportFiles.length === 0 || preparedParents.has(isolatedParent)) continue;
    preparedParents.add(isolatedParent);

    const sourceSkillRoot = resolvePlatformSkillRootPath(root, input.sourceHome, sourceEnv);
    const sourceParent = skillRootParent(sourceSkillRoot);
    for (const fileName of supportFiles) {
      await copyFileIfPresent(
        path.join(sourceParent, fileName),
        path.join(isolatedParent, fileName),
      );
    }
  }
}

async function createStrictSkillIsolationScope(input: {
  sessionsRoot: string;
  provider: string;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
}): Promise<StrictSkillIsolationScope> {
  await fs.mkdir(input.sessionsRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(input.sessionsRoot, 'skill-scope-'));
  const cwd = path.join(root, 'work');
  const systemHomeDir = path.join(root, 'home');
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(systemHomeDir, { recursive: true });
  await fs.mkdir(path.join(systemHomeDir, '.config'), { recursive: true });
  const sourceHome = resolveStrictIsolationSourceHome({
    baseEnv: input.baseEnv,
    requestEnv: input.requestEnv,
    fallbackHome: systemHomeDir,
  });
  const env = buildStrictSkillIsolationEnv({
    provider: input.provider,
    sourceHome,
    isolatedHome: systemHomeDir,
    isolatedCwd: cwd,
    baseEnv: input.baseEnv,
    requestEnv: input.requestEnv,
  });
  await prepareStrictSkillIsolationPlatformHome({
    provider: input.provider,
    sourceHome,
    isolatedHome: systemHomeDir,
    env,
    baseEnv: input.baseEnv,
    requestEnv: input.requestEnv,
  });
  return {
    root,
    cwd,
    systemHomeDir,
    skillSystemHomeDir: shouldUseSourceHomeForStrictIsolation(input.provider) ? sourceHome : systemHomeDir,
    env,
  };
}

async function removeStrictSkillIsolationScope(scope: StrictSkillIsolationScope | null): Promise<void> {
  if (!scope) return;
  await fs.rm(scope.root, { recursive: true, force: true });
}

interface StrictIsolationScopeAcquisition {
  scope: StrictSkillIsolationScope;
  /** Reusable scopes persist across turns and must NOT be removed after a turn. */
  reusable: boolean;
}

async function fingerprintStrictIsolationSourceFiles(input: {
  provider: string;
  sourceHome: string;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
}): Promise<Array<{ path: string; size?: number; mtimeMs?: number; missing?: true }>> {
  const filePaths: string[] = [];
  for (const fileName of STRICT_ISOLATION_USER_HOME_FILES[input.provider] ?? []) {
    filePaths.push(path.join(input.sourceHome, fileName));
  }
  const supportFiles = STRICT_ISOLATION_PLATFORM_HOME_FILES[input.provider] ?? [];
  if (supportFiles.length > 0 && isPlatformId(input.provider)) {
    const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
    const seenParents = new Set<string>();
    for (const root of getPlatformSkillRoots(input.provider)) {
      if (root.kind !== 'global') continue;
      const sourceParent = skillRootParent(resolvePlatformSkillRootPath(root, input.sourceHome, sourceEnv));
      if (seenParents.has(sourceParent)) continue;
      seenParents.add(sourceParent);
      for (const fileName of supportFiles) {
        filePaths.push(path.join(sourceParent, fileName));
      }
    }
  }
  const fingerprint: Array<{ path: string; size?: number; mtimeMs?: number; missing?: true }> = [];
  for (const filePath of filePaths.sort()) {
    try {
      const stat = await fs.stat(filePath);
      fingerprint.push({ path: filePath, size: stat.size, mtimeMs: Math.round(stat.mtimeMs) });
    } catch {
      fingerprint.push({ path: filePath, missing: true });
    }
  }
  return fingerprint;
}

function hashStrictIsolationScopeKey(parts: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
}

async function pruneStrictIsolationScopeCache(cacheRoot: string): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const scopeDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('scope-'))
    .map((entry) => path.join(cacheRoot, entry.name));
  if (scopeDirs.length <= STRICT_ISOLATION_SCOPE_CACHE_LIMIT) return;
  const withUsage = await Promise.all(scopeDirs.map(async (dir) => {
    try {
      const stat = await fs.stat(path.join(dir, '.last-used'));
      return { dir, usedAt: stat.mtimeMs };
    } catch {
      return { dir, usedAt: 0 };
    }
  }));
  withUsage.sort((left, right) => right.usedAt - left.usedAt);
  for (const stale of withUsage.slice(STRICT_ISOLATION_SCOPE_CACHE_LIMIT)) {
    await fs.rm(stale.dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Acquires a strict-isolation scope for one turn (spec R7): providers whose
// platform home needs file copies reuse a cached prepared HOME keyed by
// (metaBotSlug, provider, skill allowlist, platform-home fingerprint);
// source-home providers keep per-turn scopes, so their behavior is unchanged.
async function acquireStrictSkillIsolationScope(input: {
  sessionsRoot: string;
  provider: string;
  metaBotSlug?: string;
  skills?: string[];
  skillSourcePaths?: Record<string, string>;
  baseEnv?: NodeJS.ProcessEnv;
  requestEnv?: Record<string, string>;
}): Promise<StrictIsolationScopeAcquisition> {
  if (shouldUseSourceHomeForStrictIsolation(input.provider)) {
    return { scope: await createStrictSkillIsolationScope(input), reusable: false };
  }

  const sourceEnv = mergeStringEnvValues(input.baseEnv, input.requestEnv);
  const keySourceHome = sourceEnv.HOME || process.env.HOME || '<isolated>';
  const fingerprint = await fingerprintStrictIsolationSourceFiles({
    provider: input.provider,
    sourceHome: keySourceHome,
    baseEnv: input.baseEnv,
    requestEnv: input.requestEnv,
  });
  const key = hashStrictIsolationScopeKey({
    metaBotSlug: input.metaBotSlug ?? '',
    provider: input.provider,
    skills: [...(input.skills ?? [])].sort(),
    skillSourcePaths: Object.entries(input.skillSourcePaths ?? {}).sort(([left], [right]) => left.localeCompare(right)),
    fingerprint,
  });

  const cacheRoot = path.join(input.sessionsRoot, STRICT_ISOLATION_SCOPE_CACHE_DIR);
  const root = path.join(cacheRoot, `scope-${key}`);
  const cwd = path.join(root, 'work');
  const systemHomeDir = path.join(root, 'home');
  let reused = true;
  try {
    await fs.access(root);
  } catch {
    reused = false;
  }
  await fs.mkdir(cwd, { recursive: true });
  await fs.mkdir(path.join(systemHomeDir, '.config'), { recursive: true });

  const sourceHome = keySourceHome === '<isolated>' ? systemHomeDir : keySourceHome;
  const env = buildStrictSkillIsolationEnv({
    provider: input.provider,
    sourceHome,
    isolatedHome: systemHomeDir,
    isolatedCwd: cwd,
    baseEnv: input.baseEnv,
    requestEnv: input.requestEnv,
  });
  if (!reused) {
    await prepareStrictSkillIsolationPlatformHome({
      provider: input.provider,
      sourceHome,
      isolatedHome: systemHomeDir,
      env,
      baseEnv: input.baseEnv,
      requestEnv: input.requestEnv,
    });
  }
  await fs.writeFile(path.join(root, '.last-used'), new Date().toISOString(), 'utf8').catch(() => undefined);
  await pruneStrictIsolationScopeCache(cacheRoot).catch(() => undefined);

  return {
    scope: {
      root,
      cwd,
      systemHomeDir,
      skillSystemHomeDir: systemHomeDir,
      env,
    },
    reusable: true,
  };
}

async function releaseStrictSkillIsolationScope(acquisition: StrictIsolationScopeAcquisition | null): Promise<void> {
  if (!acquisition || acquisition.reusable) return;
  await removeStrictSkillIsolationScope(acquisition.scope);
}

export class LlmExecutor {
  private readonly sessionsRoot: string;
  private readonly transcriptsRoot: string;
  private readonly skillsRoot: string;
  private readonly systemHomeDir?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly backends: Record<string, LlmBackendFactory>;
  private readonly sessionManager: SessionManager;
  private readonly streams = new Map<string, EventStreamState>();
  private readonly running = new Map<string, RunningSession>();

  constructor(options: LlmExecutorOptions) {
    this.sessionsRoot = options.sessionsRoot;
    this.transcriptsRoot = options.transcriptsRoot;
    this.skillsRoot = options.skillsRoot;
    this.systemHomeDir = options.systemHomeDir;
    this.env = options.env;
    this.backends = options.backends;
    this.sessionManager = options.sessionManager ?? createFileSessionManager(options.sessionsRoot);
  }

  async execute(request: LlmExecutionRequest): Promise<string> {
    if (!request.runtimeId || !request.runtime) {
      throw new Error('runtimeId and runtime are required.');
    }
    const effectiveRequest: LlmExecutionRequest = {
      ...request,
      model: request.model ?? request.runtime.model,
    };

    const provider = effectiveRequest.runtime.provider;
    const factory = this.backends[provider];
    if (!factory) {
      throw new Error(`No LLM backend registered for provider: ${provider}`);
    }

    const binaryPath = effectiveRequest.runtime.binaryPath;
    if (!binaryPath) {
      throw new Error(`Runtime ${request.runtimeId} has no binaryPath.`);
    }

    const sessionId = createSessionId();
    const record: LlmSessionRecord = {
      sessionId,
      status: 'starting',
      runtimeId: effectiveRequest.runtimeId,
      provider,
      metaBotSlug: effectiveRequest.metaBotSlug,
      prompt: effectiveRequest.prompt,
      systemPrompt: effectiveRequest.systemPrompt,
      skills: effectiveRequest.skills,
      skillSourcePaths: effectiveRequest.skillSourcePaths,
      model: effectiveRequest.model,
      cwd: effectiveRequest.cwd,
      resumeSessionId: effectiveRequest.resumeSessionId,
      createdAt: nowIso(),
    };
    await this.sessionManager.create(record);
    this.streams.set(sessionId, { events: [], closed: false, waiters: [] });

    const controller = new AbortController();
    this.running.set(sessionId, { controller });

    void this.runSession(sessionId, effectiveRequest, factory, binaryPath, controller).catch((error) => {
      void this.failSession(sessionId, stringifyError(error));
    });

    return sessionId;
  }

  async cancel(sessionId: string): Promise<void> {
    const session = await this.sessionManager.get(sessionId);
    if (!session) {
      throw new Error(`LLM session not found: ${sessionId}`);
    }
    if (isTerminalStatus(session.status) || session.result) {
      return;
    }

    const running = this.running.get(sessionId);
    if (running) running.controller.abort();
    await this.sessionManager.update(sessionId, {
      status: 'cancelled',
      completedAt: nowIso(),
      result: {
        status: 'cancelled',
        output: '',
        error: 'execution cancelled',
        durationMs: 0,
      },
    });
    this.pushEvent(sessionId, {
      type: 'result',
      result: {
        status: 'cancelled',
        output: '',
        error: 'execution cancelled',
        durationMs: 0,
      },
    });
    this.closeStream(sessionId);
  }

  async getSession(sessionId: string): Promise<LlmSessionRecord | null> {
    return this.sessionManager.get(sessionId);
  }

  async listSessions(limit?: number, options?: { metaBotSlug?: string }): Promise<LlmSessionRecord[]> {
    return this.sessionManager.list(limit, options);
  }

  async *streamEvents(sessionId: string): AsyncIterable<LlmExecutionEvent> {
    let stream = this.streams.get(sessionId);
    if (!stream) {
      const session = await this.sessionManager.get(sessionId);
      if (!session) return;
      stream = { events: [], closed: Boolean(session.result), waiters: [] };
      if (session.result) {
        stream.events.push({ type: 'result', result: session.result });
      }
      this.streams.set(sessionId, stream);
    }

    let index = 0;
    while (true) {
      while (index < stream.events.length) {
        yield stream.events[index];
        index += 1;
      }
      if (stream.closed) return;
      await new Promise<void>((resolve) => {
        stream.waiters.push(resolve);
      });
    }
  }

  private async runSession(
    sessionId: string,
    request: LlmExecutionRequest,
    factory: LlmBackendFactory,
    binaryPath: string,
    controller: AbortController,
  ): Promise<void> {
    let isolation: StrictIsolationScopeAcquisition | null = null;
    try {
      const startedAt = nowIso();
      const strictSkillIsolation = request.skillIsolation === 'strict';
      isolation = strictSkillIsolation
        ? await acquireStrictSkillIsolationScope({
          sessionsRoot: this.sessionsRoot,
          provider: request.runtime.provider,
          metaBotSlug: request.metaBotSlug,
          skills: request.skills,
          skillSourcePaths: request.skillSourcePaths,
          baseEnv: this.env,
          requestEnv: request.env,
        })
        : null;
      const isolationScope = isolation?.scope ?? null;
      const cwd = isolationScope?.cwd ?? request.cwd ?? process.cwd();
      const requestEnv = isolationScope?.env ?? request.env;
      const baseProcessEnv = mergeStringEnvValues(process.env, this.env, requestEnv);
      const processEnv = isRuntimePlatformId(request.runtime.provider)
        ? await resolveProviderProcessEnv(request.runtime.provider, binaryPath, baseProcessEnv)
        : { env: baseProcessEnv };
      if (processEnv.error) throw new Error(processEnv.error);
      const backendEnv = mergeStringEnvValues(processEnv.env);
      const backendRequest: LlmExecutionRequest = { ...request, cwd, env: backendEnv };
      await this.sessionManager.update(sessionId, { status: 'running', startedAt, cwd });

      if (request.skills && request.skills.length > 0) {
        const injection = await injectSkills({
          skills: request.skills,
          skillsRoot: this.skillsRoot,
          skillSourcePaths: request.skillSourcePaths,
          provider: request.runtime.provider,
          cwd,
          systemHomeDir: isolationScope?.skillSystemHomeDir ?? this.systemHomeDir,
          env: requestEnv ?? this.env,
        });
        for (const error of injection.errors) {
          this.pushEvent(sessionId, {
            type: 'log',
            level: 'warning',
            message: `Skill injection failed for ${error.skill}: ${error.error}`,
          });
        }
      }

      const backend = factory(binaryPath, backendEnv);
      let accumulatedOutput = '';
      const emitter = {
        emit: (event: LlmExecutionEvent) => {
          if (event.type === 'text') {
            accumulatedOutput += event.content;
          }
          if (event.type === 'status' && event.sessionId) {
            void this.sessionManager.update(sessionId, { providerSessionId: event.sessionId }).catch(() => undefined);
          }
          this.pushEvent(sessionId, event);
        },
      };

      let result: LlmExecutionResult;
      try {
        result = await backend.execute(backendRequest, emitter, controller.signal);
        if (!result.output && accumulatedOutput) {
          result = { ...result, output: accumulatedOutput };
        }
      } catch (error) {
        result = {
          status: controller.signal.aborted ? 'cancelled' : 'failed',
          output: accumulatedOutput,
          error: stringifyError(error),
          durationMs: Date.now() - Date.parse(startedAt),
        };
      }

      await this.sessionManager.update(sessionId, {
        status: result.status,
        providerSessionId: result.providerSessionId,
        result,
        completedAt: nowIso(),
      });
      this.running.delete(sessionId);
      await releaseStrictSkillIsolationScope(isolation).catch((error) => {
        this.pushEvent(sessionId, {
          type: 'log',
          level: 'warning',
          message: `Strict skill isolation cleanup failed: ${stringifyError(error)}`,
        });
      });
      this.pushEvent(sessionId, { type: 'result', result });
      this.closeStream(sessionId);
    } finally {
      await releaseStrictSkillIsolationScope(isolation).catch(() => undefined);
    }
  }

  private async failSession(sessionId: string, message: string): Promise<void> {
    const result: LlmExecutionResult = {
      status: 'failed',
      output: '',
      error: message,
      durationMs: 0,
    };
    await this.sessionManager.update(sessionId, {
      status: 'failed',
      completedAt: nowIso(),
      result,
    });
    this.running.delete(sessionId);
    this.pushEvent(sessionId, { type: 'error', message });
    this.pushEvent(sessionId, { type: 'result', result });
    this.closeStream(sessionId);
  }

  private pushEvent(sessionId: string, event: LlmExecutionEvent): void {
    let stream = this.streams.get(sessionId);
    if (!stream) {
      stream = { events: [], closed: false, waiters: [] };
      this.streams.set(sessionId, stream);
    }
    stream.events.push(event);
    void this.appendTranscript(sessionId, event);
    const waiters = stream.waiters.splice(0);
    for (const waiter of waiters) waiter();
    if (event.type === 'result' || (event.type === 'status' && isTerminalStatus(event.status))) {
      this.closeStream(sessionId);
    }
  }

  private closeStream(sessionId: string): void {
    const stream = this.streams.get(sessionId);
    if (!stream) return;
    stream.closed = true;
    const waiters = stream.waiters.splice(0);
    for (const waiter of waiters) waiter();
  }

  private async appendTranscript(sessionId: string, event: LlmExecutionEvent): Promise<void> {
    await fs.mkdir(this.transcriptsRoot, { recursive: true });
    await fs.appendFile(
      path.join(this.transcriptsRoot, `${sessionId}.log`),
      `${JSON.stringify({ at: nowIso(), event })}\n`,
      'utf8',
    );
  }
}
