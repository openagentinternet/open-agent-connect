import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmExecutor, LlmSessionRecord } from '../../llm/executor';
import type { LlmBindingStore } from '../../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../../llm/llmRuntimeStore';
import type { LlmBinding, LlmRuntime } from '../../llm/llmTypes';
import { isSafeProviderSkillName, type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from '../../services/platformSkillCatalog';
import { createServiceRunnerFailedResult, type ProviderServiceRunnerResult } from './serviceRunnerContracts';
import {
  classifyProviderOutputType,
  findProviderWorkspaceArtifactCandidate,
} from './providerDeliveryArtifacts';
import {
  getPlatformDefinition,
  getPlatformSkillRoots,
  getRuntimePortableSkillRoots,
  isPlatformId,
  resolvePlatformSkillRootPath,
  type PlatformId,
  type PlatformSkillRoot,
} from '../../platform/platformRegistry';

export interface ProviderServiceOrderInput {
  servicePinId: string;
  providerSkill: string;
  providerSkills?: string[] | null;
  providerGlobalMetaId: string;
  userTask: string;
  taskContext: string;
  serviceName?: string | null;
  displayName?: string | null;
  outputType?: string | null;
  executionReminder?: string | null;
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
  skills: PlatformSkillCatalogEntry[];
  rootDiagnostics: PlatformSkillRootDiagnostic[];
  fallbackSelected: boolean;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProviderSkillNames(order: Pick<ProviderServiceOrderInput, 'providerSkill' | 'providerSkills'>): {
  skills: string[];
  invalidSkill: string | null;
} {
  const rawSkills = Array.isArray(order.providerSkills) && order.providerSkills.length > 0
    ? order.providerSkills
    : [order.providerSkill];
  const seen = new Set<string>();
  const skills: string[] = [];
  for (const rawSkill of rawSkills) {
    const skill = normalizeText(rawSkill);
    if (!skill) {
      continue;
    }
    if (!isSafeProviderSkillName(skill)) {
      return { skills: [], invalidSkill: skill };
    }
    if (!seen.has(skill)) {
      seen.add(skill);
      skills.push(skill);
    }
  }
  return { skills, invalidSkill: null };
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
  providerSkills?: string[] | null;
  outputType: string;
  userTask: string;
  taskContext: string;
  executionReminder?: string | null;
}): string {
  const normalizedProviderSkills = normalizeProviderSkillNames(input).skills;
  const providerSkill = normalizedProviderSkills[0] ?? normalizeText(input.providerSkill);
  const skillInstructions = normalizedProviderSkills.length > 1
    ? [
      `Allowed provider skills: ${normalizedProviderSkills.join(', ')}.`,
      'Choose the allowed skills needed for the buyer request; not every allowed skill is required.',
      'Do not use skills outside this injected provider skill list.',
    ]
    : [
      `Required provider skill: ${providerSkill}.`,
      `You must use only the injected local skill "${providerSkill}" to complete this paid order.`,
    ];
  const executionReminder = normalizeText(input.executionReminder);
  return [
    'You are the provider-side service executor for this paid service order, already paid and inbound.',
    `Service: ${normalizeText(input.serviceName) || normalizeText(input.displayName) || 'Service Order'}.`,
    ...skillInstructions,
    'Treat the selected skill as the local service implementation, even when the runtime and skill source came from different platforms.',
    executionReminder ? `Execution reminder from service publisher: ${executionReminder}` : '',
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

// IDBots buildMissingArtifactContinuationPrompt parity: after a completed run
// left no deliverable artifact, the provider gets one forced continuation run
// that must produce the expected file in the same workspace.
function buildMissingArtifactContinuationPrompt(order: ProviderServiceOrderInput): string {
  const outputType = classifyProviderOutputType(order.outputType);
  const orderTxid = normalizeText(order.metadata?.orderTxid);
  return [
    `The paid service order is not complete yet because no ${outputType} file exists for delivery.`,
    orderTxid ? `Order txid: ${orderTxid}.` : '',
    `Original buyer request: ${normalizeText(order.userTask) || 'No buyer request was recorded.'}`,
    `Continue executing the required skill now. You MUST generate a real ${outputType} file in the current workspace before giving the final answer.`,
    'Do not answer with only progress, intent, acknowledgement, or "started generating".',
    'Use the service skill/tool/command now. After the file exists, the final answer must include the local file path.',
    `If you truly cannot generate a valid ${outputType} file, state the concrete failure reason instead of claiming success.`,
  ].filter(Boolean).join('\n');
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
  attemptWorkspaceCwd: string;
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
    providerSkills?: string[] | null;
    sessionId?: string | null;
    selection?: ProviderServiceRunnerSelection | null;
    attemptWorkspaceCwd?: string | null;
  },
): T & {
  runtimeId: string;
  sessionId?: string;
  selection: ProviderServiceRunnerSelection | null;
} {
  const selection = input.selection ?? null;
  const sessionId = normalizeText(input.sessionId);
  const attemptWorkspaceCwd = normalizeText(input.attemptWorkspaceCwd);
  const enriched = {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      runtimeId: input.runtime.id,
      runtimeProvider: input.runtime.provider,
      sessionId: sessionId || null,
      providerSkill: input.providerSkill,
      providerSkills: Array.isArray(input.providerSkills) && input.providerSkills.length > 0
        ? input.providerSkills
        : [input.providerSkill],
      fallbackSelected: selection?.fallbackSelected ?? null,
      selection,
      // Kept on every post-workspace result (including failures) so the
      // daemon can remove the run workspace once the order is terminal.
      ...(attemptWorkspaceCwd ? { attemptWorkspaceCwd } : {}),
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
    providerSkills?: string[] | null;
    sessionId?: string | null;
    selection?: ProviderServiceRunnerSelection | null;
    attemptWorkspaceCwd?: string | null;
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
  providerSkills: string[],
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
          providerSkills,
          sessionId,
          selection,
          attemptWorkspaceCwd: run.attemptWorkspaceCwd,
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
          providerSkills,
          sessionId,
          selection,
          attemptWorkspaceCwd: run.attemptWorkspaceCwd,
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
          providerSkills,
          sessionId,
          selection,
          attemptWorkspaceCwd: run.attemptWorkspaceCwd,
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

      const skill = {
        skillName: providerSkill,
        platformId: runtime.provider,
        platformDisplayName: platform.displayName,
        rootId: root.id,
        rootKind: root.kind,
        absolutePath: path.join(absolutePath, skillDir.name),
        skillDocumentPath,
      };
      return {
        runtime,
        skill,
        skills: [skill],
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
  for (const root of getRuntimePortableSkillRoots()) {
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
      const skill = {
        skillName: providerSkill,
        platformId: sourcePlatformId,
        platformDisplayName,
        rootId: root.id,
        rootKind: root.kind,
        absolutePath: path.join(absolutePath, providerSkill),
        skillDocumentPath,
      };
      return {
        runtime,
        skill,
        skills: [skill],
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

async function readProviderSkillsSelection(
  deps: ProviderServiceRunnerDependencies,
  runtime: LlmRuntime,
  providerSkills: string[],
  fallbackSelected: boolean,
): Promise<ProviderServiceRunnerSelection | null> {
  if (providerSkills.length === 0) {
    return null;
  }
  const skills: PlatformSkillCatalogEntry[] = [];
  const rootDiagnostics: PlatformSkillRootDiagnostic[] = [];
  for (const providerSkill of providerSkills) {
    const selection = await readRuntimeSelection(deps, runtime, providerSkill, fallbackSelected)
      ?? await readPortableSkillSelection(deps, runtime, providerSkill, fallbackSelected);
    if (!selection) {
      return null;
    }
    skills.push(selection.skill);
    rootDiagnostics.push(...selection.rootDiagnostics);
  }
  return {
    runtime,
    skill: skills[0],
    skills,
    rootDiagnostics,
    fallbackSelected,
  };
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
  providerSkills: string[],
  sourceSelection: ProviderServiceRunnerSelection,
): Promise<ProviderServiceRunnerSelection | null> {
  const fallbackSelection = await readProviderSkillsSelection(deps, fallbackRuntime, providerSkills, true);
  if (fallbackSelection) {
    return fallbackSelection;
  }
  if (!await canRunInjectedSkillRuntime(deps, fallbackRuntime)) {
    return null;
  }
  return {
    runtime: fallbackRuntime,
    skill: sourceSelection.skill,
    skills: sourceSelection.skills,
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
  providerSkills: string[],
  sourceSelection: ProviderServiceRunnerSelection | null,
): Promise<ProviderServiceRunnerSelection | null> {
  for (const candidate of candidates) {
    const selection = sourceSelection
      ? await readFallbackSelection(deps, candidate, providerSkills, sourceSelection)
      : await readProviderSkillsSelection(deps, candidate, providerSkills, true);
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
  providerSkills?: string[] | null;
  outputType?: string | null;
  userTask: string;
  taskContext: string;
  executionReminder?: string | null;
}): string {
  return buildPaidOrderSystemPrompt({
    serviceName: input.serviceName ?? '',
    displayName: input.displayName ?? '',
    providerSkill: input.providerSkill,
    providerSkills: input.providerSkills,
    outputType: input.outputType ?? '',
    userTask: input.userTask,
    taskContext: input.taskContext,
    executionReminder: input.executionReminder,
  });
}

export const DEFAULT_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS = 5 * 60_000;
export const VIDEO_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS = 20 * 60_000;
export const MIN_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS = 30_000;
export const MAX_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS = 30 * 60_000;

/**
 * Execution timeout for one provider service order. The published service
 * schema carries no timeout field and none is added; a service record that
 * nevertheless has a positive `executionTimeoutMs` is honored as an override,
 * clamped to [30s, 30min]. Otherwise video output gets 20 minutes and every
 * other output type gets 5 minutes (mirrors the IDBots reference behavior).
 */
export function resolveProviderOrderExecutionTimeoutMs(service: {
  outputType?: string | null;
  executionTimeoutMs?: number | null;
}): number {
  const override = Number(service.executionTimeoutMs);
  if (Number.isFinite(override) && override > 0) {
    return Math.min(
      MAX_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS,
      Math.max(MIN_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS, Math.trunc(override)),
    );
  }
  return classifyProviderOutputType(service.outputType) === 'video'
    ? VIDEO_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS
    : DEFAULT_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS;
}

export function createProviderServiceRunner(input: ProviderServiceRunnerDependencies) {
  const sessionTimeoutMs = input.sessionTimeoutMs ?? DEFAULT_PROVIDER_ORDER_EXECUTION_TIMEOUT_MS;
  const pollIntervalMs = input.pollIntervalMs ?? 500;

  return {
    async execute(order: ProviderServiceOrderInput): Promise<ProviderServiceRunnerResultWithRuntime> {
      const normalizedProviderSkillNames = normalizeProviderSkillNames(order);
      if (normalizedProviderSkillNames.invalidSkill) {
        return createServiceRunnerFailedResult('invalid_provider_skill', `Provider skill name is unsafe: ${normalizedProviderSkillNames.invalidSkill}`);
      }
      const providerSkills = normalizedProviderSkillNames.skills;
      if (providerSkills.length === 0) {
        return createServiceRunnerFailedResult('invalid_provider_skill', 'Provider skill name is required.');
      }
      const providerSkill = providerSkills[0];

      const resolutionState = await readRuntimeResolutionState(input);
      const primaryRuntime = resolutionState.primaryRuntime;
      const primarySelection = primaryRuntime ? await readProviderSkillsSelection(input, primaryRuntime, providerSkills, false) : null;
      let runtime = primaryRuntime;
      let selection = primarySelection;
      if (!runtime || !selection) {
        const fallbackCandidates = await resolveFallbackRuntimeCandidates(
          input,
          primaryRuntime,
          resolutionState.fallbackRuntime,
          resolutionState.runtimes,
        );
        selection = await readFallbackSelectionCandidates(input, fallbackCandidates, providerSkills, null);
        runtime = selection?.runtime ?? null;
        if (!runtime && fallbackCandidates.length === 0) {
          return createServiceRunnerFailedResult('provider_runtime_unavailable', 'No primary or fallback runtime was available before provider execution started.');
        }
        if (!selection) {
          return createServiceRunnerFailedResult('provider_skill_missing', `providerSkills are not installed in any selected runtime skill root: ${providerSkills.join(', ')}`);
        }
      }
      const initialRuntime = selection.runtime;

      const systemPrompt = buildPaidOrderSystemPrompt({
        serviceName: order.serviceName ?? '',
        displayName: order.displayName ?? '',
        providerSkill,
        providerSkills,
        outputType: order.outputType ?? 'text',
        userTask: order.userTask,
        taskContext: order.taskContext,
        executionReminder: order.executionReminder,
      });

      const runNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      let attemptIndex = 0;
      const executeWithSelection = async (selectedSelection: ProviderServiceRunnerSelection): Promise<ProviderRuntimeRun> => {
        const selectedRuntime = selectedSelection.runtime;
        attemptIndex += 1;
        const executionCwd = await createProviderExecutionWorkspace(input, order, selectedRuntime, runNonce, attemptIndex);
        const attemptWorkspaceCwd = await fs.realpath(executionCwd);
        const selectedSkills = selectedSelection.skills.length > 0 ? selectedSelection.skills : [selectedSelection.skill];
        const skillSourcePaths = Object.fromEntries(
          selectedSkills.map((skill) => [skill.skillName, skill.absolutePath]),
        );
        const sessionId = await input.llmExecutor.execute({
          runtimeId: selectedRuntime.id,
          runtime: selectedRuntime,
          prompt: buildPaidOrderUserPrompt(order),
          systemPrompt,
          cwd: executionCwd,
          skills: providerSkills,
          skillSourcePaths,
          metaBotSlug: input.metaBotSlug,
          timeout: sessionTimeoutMs,
        });
        return {
          runtime: selectedRuntime,
          selection: selectedSelection,
          sessionId,
          executionCwd,
          attemptWorkspaceCwd,
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
        return readFallbackSelectionCandidates(input, fallbackCandidates, providerSkills, failedSelection);
      };

      const executionFailure = (error: unknown, failedRuntime: LlmRuntime, failedSelection: ProviderServiceRunnerSelection) =>
        createRuntimeFailedResult(
          'provider_execution_failed',
          error instanceof Error ? error.message : String(error),
          {
            runtime: failedRuntime,
            providerSkill,
            providerSkills,
            selection: failedSelection,
          },
        );

      // IDBots resolveTimeoutFallback parity: when the runtime session times
      // out but a deliverable artifact already exists in the attempt
      // workspace, deliver that artifact as a partial success with an explicit
      // timeout note instead of failing the order.
      const tryResolveTimeoutPartialResult = async (
        timedOutRun: ProviderRuntimeRun,
      ): Promise<ProviderServiceRunnerResultWithRuntime | null> => {
        const artifactPath = await findProviderWorkspaceArtifactCandidate({
          workspaceCwd: timedOutRun.attemptWorkspaceCwd,
          outputType: order.outputType,
        });
        if (!artifactPath) {
          return null;
        }
        const relativeArtifactPath = path.relative(timedOutRun.executionCwd, artifactPath);
        if (!relativeArtifactPath || relativeArtifactPath.startsWith('..') || path.isAbsolute(relativeArtifactPath)) {
          return null;
        }
        return withRuntimeMetadata({
          state: 'completed',
          responseText: [
            'Execution timed out before the provider finished.',
            'The attached artifact was produced before the timeout and the result may be incomplete.',
            `artifactPath: ${relativeArtifactPath.split(path.sep).join('/')}`,
          ].join('\n'),
          metadata: {
            outputType: normalizeText(order.outputType) || 'text',
            sessionCwd: timedOutRun.executionCwd,
            attemptWorkspaceCwd: timedOutRun.attemptWorkspaceCwd,
            executionTimedOut: true,
          },
        }, {
          runtime: timedOutRun.runtime,
          providerSkill,
          providerSkills,
          sessionId: timedOutRun.sessionId,
          selection: timedOutRun.selection,
        });
      };

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

      let failure = buildSessionFailure(run, providerSkill, providerSkills);
      if (failure?.result.state === 'failed' && failure.result.code === 'provider_execution_timeout') {
        const partialResult = await tryResolveTimeoutPartialResult(run);
        if (partialResult) {
          return partialResult;
        }
      }
      if (failure?.retryable) {
        const fallbackSelection = await resolveFallbackSelection(run.runtime, run.selection);
        if (fallbackSelection) {
          try {
            const fallbackRun = await executeWithSelection(fallbackSelection);
            const fallbackFailure = buildSessionFailure(fallbackRun, providerSkill, providerSkills);
            if (fallbackFailure) {
              if (fallbackFailure.result.state === 'failed' && fallbackFailure.result.code === 'provider_execution_timeout') {
                const partialResult = await tryResolveTimeoutPartialResult(fallbackRun);
                if (partialResult) {
                  return partialResult;
                }
              }
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

      let responseText = sanitizeProviderDeliverableText(session?.result?.output ?? '', providerSkill);
      if (!responseText) {
        const fallbackSelection = await resolveFallbackSelection(runtime, selection);
        if (fallbackSelection) {
          try {
            const fallbackRun = await executeWithSelection(fallbackSelection);
            const fallbackFailure = buildSessionFailure(fallbackRun, providerSkill, providerSkills);
            if (fallbackFailure) {
              return fallbackFailure.result;
            }
            run = fallbackRun;
            runtime = run.runtime;
            selection = run.selection;
            sessionId = run.sessionId;
            session = run.session;
            responseText = sanitizeProviderDeliverableText(session?.result?.output ?? '', providerSkill);
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
            providerSkill,
            providerSkills,
            sessionId,
            selection,
            attemptWorkspaceCwd: run.attemptWorkspaceCwd,
          },
        );
      }
      return {
        state: 'completed',
        responseText,
        metadata: {
          runtimeId: runtime.id,
          sessionId,
          providerSkill,
          providerSkills,
          outputType: normalizeText(order.outputType) || 'text',
          sessionCwd: await resolveCompletedSessionCwd(session?.cwd, run.executionCwd),
          attemptWorkspaceCwd: run.attemptWorkspaceCwd,
          fallbackSelected: selection.fallbackSelected,
          selection,
        },
        runtimeId: runtime.id,
        sessionId,
        selection,
      };
    },

    /**
     * IDBots MAX_MISSING_ARTIFACT_CONTINUATION_ATTEMPTS parity: one forced
     * continuation run after a completed non-text execution left no
     * deliverable artifact. The continuation reuses the previous run's
     * selection and attempt workspace (no new workspace, no fallback retry)
     * and prompts the runtime that it MUST generate the expected file.
     */
    async executeContinuation(
      order: ProviderServiceOrderInput,
      previousResult: ProviderServiceRunnerResult,
    ): Promise<ProviderServiceRunnerResultWithRuntime> {
      const normalizedProviderSkillNames = normalizeProviderSkillNames(order);
      if (normalizedProviderSkillNames.invalidSkill) {
        return createServiceRunnerFailedResult('invalid_provider_skill', `Provider skill name is unsafe: ${normalizedProviderSkillNames.invalidSkill}`);
      }
      const providerSkills = normalizedProviderSkillNames.skills;
      if (providerSkills.length === 0) {
        return createServiceRunnerFailedResult('invalid_provider_skill', 'Provider skill name is required.');
      }
      const providerSkill = providerSkills[0];

      const previousRecord = previousResult as ProviderServiceRunnerResult & {
        selection?: ProviderServiceRunnerSelection | null;
      };
      const selection = previousRecord.selection
        ?? (previousRecord.metadata?.selection as ProviderServiceRunnerSelection | null | undefined)
        ?? null;
      const previousWorkspaceCwd = normalizeText(previousRecord.metadata?.attemptWorkspaceCwd);
      if (!selection || !previousWorkspaceCwd) {
        return createServiceRunnerFailedResult(
          'provider_artifact_continuation_unavailable',
          'Provider continuation requires the previous run selection and attempt workspace.',
        );
      }
      const runtime = selection.runtime;
      let attemptWorkspaceCwd: string;
      try {
        attemptWorkspaceCwd = await fs.realpath(previousWorkspaceCwd);
      } catch {
        return createRuntimeFailedResult(
          'provider_artifact_continuation_unavailable',
          'Provider continuation attempt workspace is no longer readable.',
          {
            runtime,
            providerSkill,
            providerSkills,
            selection,
          },
        );
      }

      const systemPrompt = buildPaidOrderSystemPrompt({
        serviceName: order.serviceName ?? '',
        displayName: order.displayName ?? '',
        providerSkill,
        providerSkills,
        outputType: order.outputType ?? 'text',
        userTask: order.userTask,
        taskContext: order.taskContext,
        executionReminder: order.executionReminder,
      });
      const selectedSkills = selection.skills.length > 0 ? selection.skills : [selection.skill];
      const skillSourcePaths = Object.fromEntries(
        selectedSkills.map((skill) => [skill.skillName, skill.absolutePath]),
      );

      let sessionId: string;
      let session: LlmSessionRecord | null;
      try {
        sessionId = await input.llmExecutor.execute({
          runtimeId: runtime.id,
          runtime,
          prompt: buildMissingArtifactContinuationPrompt(order),
          systemPrompt,
          cwd: attemptWorkspaceCwd,
          skills: providerSkills,
          skillSourcePaths,
          metaBotSlug: input.metaBotSlug,
          timeout: sessionTimeoutMs,
        });
        session = await waitForSession(input.llmExecutor, sessionId, sessionTimeoutMs, pollIntervalMs);
      } catch (error) {
        return createRuntimeFailedResult(
          'provider_execution_failed',
          error instanceof Error ? error.message : String(error),
          {
            runtime,
            providerSkill,
            providerSkills,
            selection,
            attemptWorkspaceCwd,
          },
        );
      }

      const run: ProviderRuntimeRun = {
        runtime,
        selection,
        sessionId,
        session,
        executionCwd: attemptWorkspaceCwd,
        attemptWorkspaceCwd,
      };
      const failure = buildSessionFailure(run, providerSkill, providerSkills);
      if (failure) {
        return failure.result;
      }
      const responseText = sanitizeProviderDeliverableText(session?.result?.output ?? '', providerSkill);
      if (!responseText) {
        return createRuntimeFailedResult(
          'provider_execution_empty',
          'The provider runtime returned an empty result.',
          {
            runtime,
            providerSkill,
            providerSkills,
            sessionId,
            selection,
            attemptWorkspaceCwd,
          },
        );
      }
      return withRuntimeMetadata({
        state: 'completed',
        responseText,
        metadata: {
          outputType: normalizeText(order.outputType) || 'text',
          sessionCwd: await resolveCompletedSessionCwd(session?.cwd, attemptWorkspaceCwd),
          attemptWorkspaceCwd,
          missingArtifactContinuation: true,
        },
      }, {
        runtime,
        providerSkill,
        providerSkills,
        sessionId,
        selection,
      });
    },
  };
}
