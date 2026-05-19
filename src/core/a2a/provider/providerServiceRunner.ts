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
  return [
    'You are handling a paid service order.',
    `Service: ${normalizeText(input.serviceName) || normalizeText(input.displayName) || 'Service Order'}.`,
    `Required provider skill: ${normalizeText(input.providerSkill)}.`,
    `You must use the selected provider skill "${normalizeText(input.providerSkill)}" to complete this paid order.`,
    `Expected output type: ${normalizeText(input.outputType) || 'text'}.`,
    'Do not repeat payment metadata, service ids, greetings, or rating boilerplate in the final answer.',
    `Client request: ${normalizeText(input.userTask)}`,
    input.taskContext ? `Task context: ${normalizeText(input.taskContext)}` : '',
  ].filter(Boolean).join('\n');
}

function isTextOutputType(value: unknown): boolean {
  const outputType = normalizeText(value).toLowerCase();
  return !outputType || outputType === 'text';
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
    primaryRuntime: primaryBinding
      ? runtimeState.runtimes.find((entry) => entry.id === primaryBinding.llmRuntimeId) ?? null
      : null,
    fallbackRuntime: fallbackBinding
      ? runtimeState.runtimes.find((entry) => entry.id === fallbackBinding.llmRuntimeId) ?? null
      : null,
  };
}

async function resolveFallbackRuntime(
  deps: ProviderServiceRunnerDependencies,
  primaryRuntime: LlmRuntime | null,
  configuredFallbackRuntime: LlmRuntime | null,
): Promise<LlmRuntime | null> {
  const explicitFallbackRuntime = await deps.getFallbackRuntime?.(primaryRuntime) ?? null;
  return explicitFallbackRuntime ?? configuredFallbackRuntime;
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
        runtime = await resolveFallbackRuntime(input, primaryRuntime, resolutionState.fallbackRuntime);
        if (!runtime) {
          return createServiceRunnerFailedResult('provider_runtime_unavailable', 'No primary or fallback runtime was available before provider execution started.');
        }
        selection = await readRuntimeSelection(input, runtime, order.providerSkill, true)
          ?? await readPortableSkillSelection(input, runtime, order.providerSkill, true);
        if (!selection) {
          return createServiceRunnerFailedResult('provider_skill_missing', `providerSkill is not installed in the selected MetaBot primary runtime skill roots: ${order.providerSkill}`);
        }
      }

      const systemPrompt = buildPaidOrderSystemPrompt({
        serviceName: order.serviceName ?? '',
        displayName: order.displayName ?? '',
        providerSkill: order.providerSkill,
        outputType: order.outputType ?? 'text',
        userTask: order.userTask,
        taskContext: order.taskContext,
      });

      const executeWithSelection = async (selectedSelection: ProviderServiceRunnerSelection): Promise<ProviderRuntimeRun> => {
        const selectedRuntime = selectedSelection.runtime;
        const sessionId = await input.llmExecutor.execute({
          runtimeId: selectedRuntime.id,
          runtime: selectedRuntime,
          prompt: buildPaidOrderUserPrompt(order),
          systemPrompt,
          cwd: input.projectRoot,
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
        const fallbackRuntime = await resolveFallbackRuntime(input, primaryRuntime, resolutionState.fallbackRuntime);
        if (!fallbackRuntime || fallbackRuntime.id === failedRuntime.id) {
          return null;
        }
        return readFallbackSelection(input, fallbackRuntime, order.providerSkill, failedSelection);
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
        const fallbackSelection = await resolveFallbackSelection(runtime, selection);
        if (!fallbackSelection) {
          return executionFailure(error, runtime, selection);
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
      const sessionId = run.sessionId;
      const session = run.session;

      const responseText = normalizeText(session?.result?.output);
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
      if (!isTextOutputType(order.outputType)) {
        return createRuntimeFailedResult(
          'provider_deliverable_invalid',
          'Non-text provider deliverables require validation and upload support before delivery.',
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
