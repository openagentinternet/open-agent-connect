import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmExecutor, LlmSessionRecord } from '../../llm/executor';
import type { LlmBindingStore } from '../../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../../llm/llmRuntimeStore';
import type { LlmBinding, LlmRuntime } from '../../llm/llmTypes';
import { isSafeProviderSkillName, type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from '../../services/platformSkillCatalog';
import { createServiceRunnerFailedResult, type ProviderServiceRunnerResult } from './serviceRunnerContracts';
import {
  getInstallSkillRoots,
  getPlatformDefinition,
  getPlatformSkillRoots,
  isPlatformId,
  resolvePlatformSkillRootPath,
  type PlatformId,
  type PlatformSkillRoot,
} from '../../platform/platformRegistry';

export interface ProviderServiceOrderInput {
  servicePinId: string;
  providerSkill: string;
  providerGlobalMetaId: string;
  userTask: string;
  taskContext: string;
  serviceName?: string | null;
  displayName?: string | null;
  outputType?: string | null;
  rawRequest?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProviderServiceRunnerDependencies {
  metaBotSlug: string;
  systemHomeDir: string;
  projectRoot: string;
  runtimeStore: LlmRuntimeStore;
  bindingStore: LlmBindingStore;
  llmExecutor: Pick<LlmExecutor, 'execute' | 'getSession' | 'cancel'>;
  sessionTimeoutMs?: number;
  pollIntervalMs?: number;
  env?: NodeJS.ProcessEnv;
  getFallbackRuntime?: (primaryRuntime: LlmRuntime | null) => Promise<LlmRuntime | null> | LlmRuntime | null;
  canStartRuntime?: (runtime: LlmRuntime) => Promise<boolean> | boolean;
}

export interface ProviderServiceRunnerSelection {
  runtime: LlmRuntime;
  skill: PlatformSkillCatalogEntry;
  rootDiagnostics: PlatformSkillRootDiagnostic[];
  fallbackSelected: boolean;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeWorkspaceSegment(value: unknown, fallback: string): string {
  const normalized = normalizeText(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return normalized || fallback;
}

function readOrderWorkspaceIdentifier(order: ProviderServiceOrderInput): string {
  const metadata = order.metadata ?? {};
  return normalizeText(metadata.traceId)
    || normalizeText(metadata.orderTxid)
    || normalizeText(metadata.servicePinId)
    || normalizeText(order.servicePinId)
    || 'order';
}

function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveCompletedSessionCwd(sessionCwd: unknown, executionCwd: string): Promise<string> {
  const normalizedSessionCwd = normalizeText(sessionCwd);
  if (!normalizedSessionCwd) {
    return executionCwd;
  }
  const resolvedSessionCwd = path.resolve(executionCwd, normalizedSessionCwd);
  if (!isPathInsideOrEqual(executionCwd, resolvedSessionCwd)) {
    return executionCwd;
  }
  try {
    const [realExecutionCwd, realSessionCwd, sessionStat] = await Promise.all([
      fs.realpath(executionCwd),
      fs.realpath(resolvedSessionCwd),
      fs.stat(resolvedSessionCwd),
    ]);
    if (!sessionStat.isDirectory()) {
      return executionCwd;
    }
    return isPathInsideOrEqual(realExecutionCwd, realSessionCwd) ? resolvedSessionCwd : executionCwd;
  } catch {
    return executionCwd;
  }
}

async function createProviderExecutionWorkspace(
  deps: ProviderServiceRunnerDependencies,
  order: ProviderServiceOrderInput,
  runtime: LlmRuntime,
  runNonce: string,
  attemptIndex: number,
): Promise<string> {
  const runId = [
    sanitizeWorkspaceSegment(readOrderWorkspaceIdentifier(order), 'order'),
    sanitizeWorkspaceSegment(runNonce, 'run'),
  ].join('-');
  const attemptId = [
    `attempt-${attemptIndex}`,
    sanitizeWorkspaceSegment(runtime.id, 'runtime'),
  ].join('-');
  const workspace = path.join(deps.projectRoot, '.runtime', 'a2a-provider-runs', runId, attemptId);
  await fs.mkdir(workspace, { recursive: true });
  return workspace;
}

function isLeadingProcessNarration(value: string, providerSkill: string): boolean {
  const text = normalizeText(value);
  if (!text || text.length > 320) {
    return false;
  }
  const lower = text.toLowerCase();
  const skillName = normalizeText(providerSkill).toLowerCase();
  const startsWithProcessVerb = /^(reading|fetching|checking|searching|loading|using|running|calling|starting|inspecting|looking up)\b/.test(lower);
  const referencesInternalExecution = /\b(skill|metabot|daemon|trace|payment|txid|order|provider|remote service|services call|cli)\b/.test(lower)
    || (Boolean(skillName) && lower.includes(skillName));
  return startsWithProcessVerb && referencesInternalExecution;
}

function sanitizeProviderDeliverableText(value: string, providerSkill: string): string {
  const normalized = normalizeText(value);
  if (!normalized) {
    return '';
  }
  const paragraphs = normalized.split(/\n{2,}/);
  while (paragraphs.length > 1 && isLeadingProcessNarration(paragraphs[0], providerSkill)) {
    paragraphs.shift();
  }
  return paragraphs.join('\n\n').trim();
}

async function defaultCanStartRuntime(runtime: LlmRuntime): Promise<boolean> {
  const binaryPath = normalizeText(runtime.binaryPath);
  if (!binaryPath) {
    return false;
  }
  if (!path.isAbsolute(binaryPath)) {
    return true;
  }
  try {
    await fs.access(binaryPath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildPaidOrderSystemPrompt(input: {
  serviceName: string;
  displayName: string;
  providerSkill: string;
  outputType: string;
  userTask: string;
  taskContext: string;
}): string {
  const providerSkill = normalizeText(input.providerSkill);
  return [
    'You are the provider-side service executor for this paid service order, already paid and inbound.',
    `Service: ${normalizeText(input.serviceName) || normalizeText(input.displayName) || 'Service Order'}.`,
    `Required provider skill: ${providerSkill}.`,
    `You must use only the injected local skill "${providerSkill}" to complete this paid order.`,
    'Treat the selected skill as the local service implementation, even when the runtime and skill source came from different platforms.',
    `Expected output type: ${normalizeText(input.outputType) || 'text'}.`,
    'The buyer has already selected and paid for this service. Do not call any remote service, run metabot services call, act as a buyer, or discover services.',
    'The final answer must contain only the deliverable the buyer requested.',
    'Start directly with the result title or data; never start with status narration such as "Reading the skill" or "Fetching data".',
    'Do not repeat payment metadata or include process narration, greetings, rating boilerplate, service ids, chain txids, trace ids, skill paths, or instructions for the user to run commands.',
    'Do not include daemon diagnostics, CLI startup logs, trace-watch output, or internal troubleshooting notes.',
    `Client request: ${normalizeText(input.userTask)}`,
    input.taskContext ? `Task context: ${normalizeText(input.taskContext)}` : '',
  ].filter(Boolean).join('\n');
}

function isTextOutputType(value: unknown): boolean {
  const outputType = normalizeText(value).toLowerCase();
  return !outputType || outputType === 'text' || outputType === 'markdown';
}

function resolveSkillRootAbsolutePath(
  deps: ProviderServiceRunnerDependencies,
  root: PlatformSkillRoot,
): string {
  return root.kind === 'project'
    ? path.resolve(deps.projectRoot, root.path)
    : resolvePlatformSkillRootPath(root, deps.systemHomeDir, deps.env);
}

function buildPaidOrderUserPrompt(input: ProviderServiceOrderInput): string {
  const lines = [
    'Provider execution mode: fulfill this inbound order locally with the selected skill. Do not delegate it.',
    `Service order for ${normalizeText(input.serviceName) || normalizeText(input.displayName) || 'Service Order'}.`,
    `User task: ${normalizeText(input.userTask)}`,
  ];
  if (normalizeText(input.taskContext)) {
    lines.push(`Task context: ${normalizeText(input.taskContext)}`);
  }
  return lines.join('\n');
}

type ProviderServiceRunnerResultWithRuntime = ProviderServiceRunnerResult & {
  runtimeId?: string;
  sessionId?: string;
  selection?: ProviderServiceRunnerSelection | null;
};

interface ProviderRuntimeRun {
  runtime: LlmRuntime;
  selection: ProviderServiceRunnerSelection;
  sessionId: string;
  session: LlmSessionRecord | null;
  executionCwd: string;
}

interface ProviderRuntimeFailure {
  result: ProviderServiceRunnerResultWithRuntime;
  retryable: boolean;
}

type InjectableSkillRuntime = LlmRuntime & { provider: PlatformId };

function withRuntimeMetadata<T extends ProviderServiceRunnerResult>(
  result: T,
  input: {
    runtime: LlmRuntime;
    providerSkill: string;
    sessionId?: string | null;
    selection?: ProviderServiceRunnerSelection | null;
  },
): T & {
  runtimeId: string;
  sessionId?: string;
  selection: ProviderServiceRunnerSelection | null;
} {
  const selection = input.selection ?? null;
  const sessionId = normalizeText(input.sessionId);
  const enriched = {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      runtimeId: input.runtime.id,
      runtimeProvider: input.runtime.provider,
      sessionId: sessionId || null,
      providerSkill: input.providerSkill,
      fallbackSelected: selection?.fallbackSelected ?? null,
      selection,
    },
    runtimeId: input.runtime.id,
    ...(sessionId ? { sessionId } : {}),
    selection,
  };
  return enriched as T & {
    runtimeId: string;
    sessionId?: string;
    selection: ProviderServiceRunnerSelection | null;
  };
}

function createRuntimeFailedResult(
  code: string,
  message: string,
  input: {
    runtime: LlmRuntime;
    providerSkill: string;
    sessionId?: string | null;
    selection?: ProviderServiceRunnerSelection | null;
  },
): ProviderServiceRunnerResultWithRuntime {
  return withRuntimeMetadata(createServiceRunnerFailedResult(code, message), input);
}

function isRetryableProviderRuntimeFailure(code: string): boolean {
  return code === 'provider_execution_failed'
    || code === 'provider_execution_timeout'
    || code === 'provider_execution_cancelled';
}

function buildSessionFailure(
  run: ProviderRuntimeRun,
  providerSkill: string,
): ProviderRuntimeFailure | null {
  const { session, sessionId, runtime, selection } = run;
  if (session?.status === 'failed' || session?.status === 'cancelled' || session?.status === 'timeout') {
    const sessionError = (session as unknown as { error?: unknown }).error;
    const code = session.status === 'timeout'
      ? 'provider_execution_timeout'
      : session.status === 'cancelled'
        ? 'provider_execution_cancelled'
        : 'provider_execution_failed';
    return {
      result: createRuntimeFailedResult(
        code,
        normalizeText(sessionError) || 'Provider execution did not complete successfully.',
        {
          runtime,
          providerSkill,
          sessionId,
          selection,
        },
      ),
      retryable: isRetryableProviderRuntimeFailure(code),
    };
  }
  if (!session?.result) {
    const code = 'provider_execution_timeout';
    return {
      result: createRuntimeFailedResult(
        code,
        'The provider runtime did not produce a terminal session result before timeout.',
        {
          runtime,
          providerSkill,
          sessionId,
          selection,
        },
      ),
      retryable: true,
    };
  }
  if (session.result.status !== 'completed') {
    const code = session.result.status === 'timeout'
      ? 'provider_execution_timeout'
      : session.result.status === 'cancelled'
        ? 'provider_execution_cancelled'
        : 'provider_execution_failed';
    return {
      result: createRuntimeFailedResult(
        code,
        session.result.error || 'Provider execution did not complete successfully.',
        {
          runtime,
          providerSkill,
          sessionId,
          selection,
        },
      ),
      retryable: isRetryableProviderRuntimeFailure(code),
    };
  }

  return null;
}

async function waitForSession(
  llmExecutor: Pick<LlmExecutor, 'getSession'>,
  sessionId: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<LlmSessionRecord | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const session = await llmExecutor.getSession(sessionId);
    if (session?.result || session?.status === 'failed' || session?.status === 'timeout' || session?.status === 'cancelled') {
      return session;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  return llmExecutor.getSession(sessionId);
}

async function readRuntimeSelection(
  deps: ProviderServiceRunnerDependencies,
  runtime: LlmRuntime,
  providerSkill: string,
  fallbackSelected: boolean,
): Promise<ProviderServiceRunnerSelection | null> {
  if (!isInjectableSkillRuntime(runtime)) {
    return null;
  }
  const canStartRuntime = deps.canStartRuntime ?? defaultCanStartRuntime;
  if (!await canStartRuntime(runtime)) {
    return null;
  }

  const platform = getPlatformDefinition(runtime.provider);
  const roots = getPlatformSkillRoots(platform.id);
  const rootDiagnostics: PlatformSkillRootDiagnostic[] = [];

  for (const root of roots) {
    const absolutePath = resolveSkillRootAbsolutePath(deps, root);
    try {
      const entries = await fs.readdir(absolutePath, { withFileTypes: true });
      rootDiagnostics.push({
        rootId: root.id,
        kind: root.kind,
        absolutePath,
        status: 'readable',
      });

      const skillDir = entries.find((entry) => entry.isDirectory() && entry.name === providerSkill);
      if (!skillDir) {
        continue;
      }

      const skillDocumentPath = path.join(absolutePath, skillDir.name, 'SKILL.md');
      try {
        const stat = await fs.stat(skillDocumentPath);
        if (!stat.isFile()) {
          continue;
        }
      } catch {
        continue;
      }

      return {
        runtime,
        skill: {
          skillName: providerSkill,
          platformId: runtime.provider,
          platformDisplayName: platform.displayName,
          rootId: root.id,
          rootKind: root.kind,
          absolutePath: path.join(absolutePath, skillDir.name),
          skillDocumentPath,
        },
        rootDiagnostics,
        fallbackSelected,
      };
    } catch (error) {
      rootDiagnostics.push({
        rootId: root.id,
        kind: root.kind,
        absolutePath,
        status: 'unreadable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

async function readPortableSkillSelection(
  deps: ProviderServiceRunnerDependencies,
  runtime: LlmRuntime,
  providerSkill: string,
  fallbackSelected: boolean,
): Promise<ProviderServiceRunnerSelection | null> {
  if (!isInjectableSkillRuntime(runtime)) {
    return null;
  }
  const canStartRuntime = deps.canStartRuntime ?? defaultCanStartRuntime;
  if (!await canStartRuntime(runtime)) {
    return null;
  }

  const rootDiagnostics: PlatformSkillRootDiagnostic[] = [];
  const seenRoots = new Set<string>();
  for (const root of getInstallSkillRoots()) {
    const absolutePath = resolveSkillRootAbsolutePath(deps, root);
    const rootKey = path.resolve(absolutePath);
    if (seenRoots.has(rootKey)) {
      continue;
    }
    seenRoots.add(rootKey);

    try {
      await fs.access(absolutePath);
      rootDiagnostics.push({
        rootId: root.id,
        kind: root.kind,
        absolutePath,
        status: 'readable',
      });

      const skillDocumentPath = path.join(absolutePath, providerSkill, 'SKILL.md');
      const stat = await fs.stat(skillDocumentPath).catch(() => null);
      if (!stat?.isFile()) {
        continue;
      }

      const sourcePlatformId = isPlatformId(root.platformId) ? root.platformId : runtime.provider;
      const platformDisplayName = isPlatformId(root.platformId)
        ? getPlatformDefinition(root.platformId).displayName
        : 'Shared Agents';
      return {
        runtime,
        skill: {
          skillName: providerSkill,
          platformId: sourcePlatformId,
          platformDisplayName,
          rootId: root.id,
          rootKind: root.kind,
          absolutePath: path.join(absolutePath, providerSkill),
          skillDocumentPath,
        },
        rootDiagnostics,
        fallbackSelected,
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      rootDiagnostics.push({
        rootId: root.id,
        kind: root.kind,
        absolutePath,
        status: code === 'ENOENT' ? 'missing' : 'unreadable',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return null;
}

function isInjectableSkillRuntime(runtime: LlmRuntime): runtime is InjectableSkillRuntime {
  return isPlatformId(runtime.provider) && Boolean(normalizeText(runtime.binaryPath)) && runtime.health !== 'unavailable';
}

async function canRunInjectedSkillRuntime(
  deps: ProviderServiceRunnerDependencies,
  runtime: LlmRuntime,
): Promise<boolean> {
  if (!isInjectableSkillRuntime(runtime)) {
    return false;
  }
  const canStartRuntime = deps.canStartRuntime ?? defaultCanStartRuntime;
  return canStartRuntime(runtime);
}

async function readFallbackSelection(
  deps: ProviderServiceRunnerDependencies,
  fallbackRuntime: LlmRuntime,
  providerSkill: string,
  sourceSelection: ProviderServiceRunnerSelection,
): Promise<ProviderServiceRunnerSelection | null> {
  const fallbackSelection = await readRuntimeSelection(deps, fallbackRuntime, providerSkill, true);
  if (fallbackSelection) {
    return fallbackSelection;
  }
  const portableFallbackSelection = await readPortableSkillSelection(deps, fallbackRuntime, providerSkill, true);
  if (portableFallbackSelection) {
    return portableFallbackSelection;
  }
  if (!await canRunInjectedSkillRuntime(deps, fallbackRuntime)) {
    return null;
  }
  return {
    runtime: fallbackRuntime,
    skill: sourceSelection.skill,
    rootDiagnostics: sourceSelection.rootDiagnostics,
    fallbackSelected: true,
  };
}

function selectBinding(bindings: LlmBinding[], metaBotSlug: string, role: LlmBinding['role']): LlmBinding | null {
  return bindings
    .filter((entry) => entry.metaBotSlug === metaBotSlug && entry.role === role && entry.enabled)
    .sort((left, right) => left.priority - right.priority || right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id))[0] ?? null;
}

async function readRuntimeResolutionState(input: ProviderServiceRunnerDependencies): Promise<{
  runtimes: LlmRuntime[];
  primaryRuntime: LlmRuntime | null;
  fallbackRuntime: LlmRuntime | null;
}> {
  const [runtimeState, bindingState] = await Promise.all([
    input.runtimeStore.read(),
    input.bindingStore.read(),
  ]);
  const primaryBinding = selectBinding(bindingState.bindings, input.metaBotSlug, 'primary');
  const fallbackBinding = selectBinding(bindingState.bindings, input.metaBotSlug, 'fallback');
  return {
    runtimes: runtimeState.runtimes,
    primaryRuntime: primaryBinding
      ? runtimeState.runtimes.find((entry) => entry.id === primaryBinding.llmRuntimeId) ?? null
      : null,
    fallbackRuntime: fallbackBinding
      ? runtimeState.runtimes.find((entry) => entry.id === fallbackBinding.llmRuntimeId) ?? null
      : null,
  };
}

async function resolveFallbackRuntimeCandidates(
  deps: ProviderServiceRunnerDependencies,
  primaryRuntime: LlmRuntime | null,
  configuredFallbackRuntime: LlmRuntime | null,
  knownRuntimes: LlmRuntime[],
): Promise<LlmRuntime[]> {
  const candidates: LlmRuntime[] = [];
  const seenRuntimeIds = new Set<string>();
  const addCandidate = (candidate: LlmRuntime | null | undefined) => {
    if (!candidate || candidate.id === primaryRuntime?.id || seenRuntimeIds.has(candidate.id)) {
      return;
    }
    seenRuntimeIds.add(candidate.id);
    candidates.push(candidate);
  };

  addCandidate(await deps.getFallbackRuntime?.(primaryRuntime) ?? null);
  addCandidate(configuredFallbackRuntime);

  for (const runtime of knownRuntimes) {
    if (runtime.health === 'healthy') {
      addCandidate(runtime);
    }
  }

  return candidates;
}

async function readFallbackSelectionCandidates(
  deps: ProviderServiceRunnerDependencies,
  candidates: LlmRuntime[],
  providerSkill: string,
  sourceSelection: ProviderServiceRunnerSelection | null,
): Promise<ProviderServiceRunnerSelection | null> {
  for (const candidate of candidates) {
    const selection = sourceSelection
      ? await readFallbackSelection(deps, candidate, providerSkill, sourceSelection)
      : await readRuntimeSelection(deps, candidate, providerSkill, true)
        ?? await readPortableSkillSelection(deps, candidate, providerSkill, true);
    if (selection) {
      return selection;
    }
  }
  return null;
}

export function buildProviderServiceOrderPrompt(input: {
  serviceName?: string | null;
  displayName?: string | null;
  providerSkill: string;
  outputType?: string | null;
  userTask: string;
  taskContext: string;
}): string {
  return buildPaidOrderSystemPrompt({
    serviceName: input.serviceName ?? '',
    displayName: input.displayName ?? '',
    providerSkill: input.providerSkill,
    outputType: input.outputType ?? '',
    userTask: input.userTask,
    taskContext: input.taskContext,
  });
}

export function createProviderServiceRunner(input: ProviderServiceRunnerDependencies) {
  const sessionTimeoutMs = input.sessionTimeoutMs ?? 120_000;
  const pollIntervalMs = input.pollIntervalMs ?? 500;

  return {
    async execute(order: ProviderServiceOrderInput): Promise<ProviderServiceRunnerResultWithRuntime> {
      if (!isSafeProviderSkillName(order.providerSkill)) {
        return createServiceRunnerFailedResult('invalid_provider_skill', 'Provider skill name is unsafe.');
      }

      const resolutionState = await readRuntimeResolutionState(input);
      const primaryRuntime = resolutionState.primaryRuntime;
      const primarySelection = primaryRuntime ? await readRuntimeSelection(input, primaryRuntime, order.providerSkill, false) : null;
      let runtime = primaryRuntime;
      let selection = primarySelection
        ?? (primaryRuntime ? await readPortableSkillSelection(input, primaryRuntime, order.providerSkill, false) : null);
      if (!runtime || !selection) {
        const fallbackCandidates = await resolveFallbackRuntimeCandidates(
          input,
          primaryRuntime,
          resolutionState.fallbackRuntime,
          resolutionState.runtimes,
        );
        selection = await readFallbackSelectionCandidates(input, fallbackCandidates, order.providerSkill, null);
        runtime = selection?.runtime ?? null;
        if (!runtime && fallbackCandidates.length === 0) {
          return createServiceRunnerFailedResult('provider_runtime_unavailable', 'No primary or fallback runtime was available before provider execution started.');
        }
        if (!selection) {
          return createServiceRunnerFailedResult('provider_skill_missing', `providerSkill is not installed in any selected runtime skill root: ${order.providerSkill}`);
        }
      }
      const initialRuntime = selection.runtime;

      const systemPrompt = buildPaidOrderSystemPrompt({
        serviceName: order.serviceName ?? '',
        displayName: order.displayName ?? '',
        providerSkill: order.providerSkill,
        outputType: order.outputType ?? 'text',
        userTask: order.userTask,
        taskContext: order.taskContext,
      });

      const runNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      let attemptIndex = 0;
      const executeWithSelection = async (selectedSelection: ProviderServiceRunnerSelection): Promise<ProviderRuntimeRun> => {
        const selectedRuntime = selectedSelection.runtime;
        attemptIndex += 1;
        const executionCwd = await createProviderExecutionWorkspace(input, order, selectedRuntime, runNonce, attemptIndex);
        const sessionId = await input.llmExecutor.execute({
          runtimeId: selectedRuntime.id,
          runtime: selectedRuntime,
          prompt: buildPaidOrderUserPrompt(order),
          systemPrompt,
          cwd: executionCwd,
          skills: [order.providerSkill],
          skillSourcePaths: {
            [order.providerSkill]: selectedSelection.skill.absolutePath,
          },
          metaBotSlug: input.metaBotSlug,
          timeout: sessionTimeoutMs,
        });
        return {
          runtime: selectedRuntime,
          selection: selectedSelection,
          sessionId,
          executionCwd,
          session: await waitForSession(input.llmExecutor, sessionId, sessionTimeoutMs, pollIntervalMs),
        };
      };

      const resolveFallbackSelection = async (
        failedRuntime: LlmRuntime,
        failedSelection: ProviderServiceRunnerSelection,
      ): Promise<ProviderServiceRunnerSelection | null> => {
        if (failedSelection.fallbackSelected) {
          return null;
        }
        const fallbackCandidates = (await resolveFallbackRuntimeCandidates(
          input,
          primaryRuntime,
          resolutionState.fallbackRuntime,
          resolutionState.runtimes,
        )).filter((candidate) => candidate.id !== failedRuntime.id);
        return readFallbackSelectionCandidates(input, fallbackCandidates, order.providerSkill, failedSelection);
      };

      const executionFailure = (error: unknown, failedRuntime: LlmRuntime, failedSelection: ProviderServiceRunnerSelection) =>
        createRuntimeFailedResult(
          'provider_execution_failed',
          error instanceof Error ? error.message : String(error),
          {
            runtime: failedRuntime,
            providerSkill: order.providerSkill,
            selection: failedSelection,
          },
        );

      let run: ProviderRuntimeRun;
      try {
        run = await executeWithSelection(selection);
      } catch (error) {
        const fallbackSelection = await resolveFallbackSelection(initialRuntime, selection);
        if (!fallbackSelection) {
          return executionFailure(error, initialRuntime, selection);
        }
        try {
          run = await executeWithSelection(fallbackSelection);
        } catch (fallbackError) {
          return executionFailure(fallbackError, fallbackSelection.runtime, fallbackSelection);
        }
      }

      let failure = buildSessionFailure(run, order.providerSkill);
      if (failure?.retryable) {
        const fallbackSelection = await resolveFallbackSelection(run.runtime, run.selection);
        if (fallbackSelection) {
          try {
            const fallbackRun = await executeWithSelection(fallbackSelection);
            const fallbackFailure = buildSessionFailure(fallbackRun, order.providerSkill);
            if (fallbackFailure) {
              return fallbackFailure.result;
            }
            run = fallbackRun;
            failure = null;
          } catch (fallbackError) {
            return executionFailure(fallbackError, fallbackSelection.runtime, fallbackSelection);
          }
        }
      }
      if (failure) {
        return failure.result;
      }

      runtime = run.runtime;
      selection = run.selection;
      let sessionId = run.sessionId;
      let session = run.session;

      let responseText = sanitizeProviderDeliverableText(session?.result?.output ?? '', order.providerSkill);
      if (!responseText) {
        const fallbackSelection = await resolveFallbackSelection(runtime, selection);
        if (fallbackSelection) {
          try {
            const fallbackRun = await executeWithSelection(fallbackSelection);
            const fallbackFailure = buildSessionFailure(fallbackRun, order.providerSkill);
            if (fallbackFailure) {
              return fallbackFailure.result;
            }
            run = fallbackRun;
            runtime = run.runtime;
            selection = run.selection;
            sessionId = run.sessionId;
            session = run.session;
            responseText = sanitizeProviderDeliverableText(session?.result?.output ?? '', order.providerSkill);
          } catch (fallbackError) {
            return executionFailure(fallbackError, fallbackSelection.runtime, fallbackSelection);
          }
        }
      }
      if (!responseText) {
        return createRuntimeFailedResult(
          'provider_execution_empty',
          'The provider runtime returned an empty result.',
          {
            runtime,
            providerSkill: order.providerSkill,
            sessionId,
            selection,
          },
        );
      }
      return {
        state: 'completed',
        responseText,
        metadata: {
          runtimeId: runtime.id,
          sessionId,
          providerSkill: order.providerSkill,
          outputType: normalizeText(order.outputType) || 'text',
          sessionCwd: await resolveCompletedSessionCwd(session?.cwd, run.executionCwd),
          fallbackSelected: selection.fallbackSelected,
          selection,
        },
        runtimeId: runtime.id,
        sessionId,
        selection,
      };
    },
  };
}
