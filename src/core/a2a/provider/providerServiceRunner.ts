import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmExecutor, LlmSessionRecord } from '../../llm/executor';
import type { LlmBindingStore } from '../../llm/llmBindingStore';
import type { LlmRuntimeStore } from '../../llm/llmRuntimeStore';
import type { LlmBinding, LlmRuntime } from '../../llm/llmTypes';
import { isSafeProviderSkillName, type PlatformSkillCatalogEntry, type PlatformSkillRootDiagnostic } from '../../services/platformSkillCatalog';
import { createServiceRunnerFailedResult, type ProviderServiceRunnerResult } from './serviceRunnerContracts';
import { getPlatformDefinition, getPlatformSkillRoots, isPlatformId, resolvePlatformSkillRootPath } from '../../platform/platformRegistry';

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
  if (!isPlatformId(runtime.provider) || !normalizeText(runtime.binaryPath) || runtime.health === 'unavailable') {
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
    const absolutePath = root.kind === 'project'
      ? path.resolve(deps.projectRoot, root.path)
      : resolvePlatformSkillRootPath(root, deps.systemHomeDir, deps.env);
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
    async execute(order: ProviderServiceOrderInput): Promise<ProviderServiceRunnerResult & { runtimeId?: string; sessionId?: string; selection?: ProviderServiceRunnerSelection | null }> {
      if (!isSafeProviderSkillName(order.providerSkill)) {
        return createServiceRunnerFailedResult('invalid_provider_skill', 'Provider skill name is unsafe.');
      }

      const resolutionState = await readRuntimeResolutionState(input);
      const primaryRuntime = resolutionState.primaryRuntime;
      const primarySelection = primaryRuntime ? await readRuntimeSelection(input, primaryRuntime, order.providerSkill, false) : null;
      let runtime = primaryRuntime;
      let selection = primarySelection;
      if (!runtime || !selection) {
        runtime = await resolveFallbackRuntime(input, primaryRuntime, resolutionState.fallbackRuntime);
        if (!runtime) {
          return createServiceRunnerFailedResult('provider_runtime_unavailable', 'No primary or fallback runtime was available before provider execution started.');
        }
        selection = await readRuntimeSelection(input, runtime, order.providerSkill, true);
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

      const executeWithRuntime = async (selectedRuntime: LlmRuntime): Promise<string> => input.llmExecutor.execute({
        runtimeId: selectedRuntime.id,
        runtime: selectedRuntime,
        prompt: buildPaidOrderUserPrompt(order),
        systemPrompt,
        skills: [order.providerSkill],
        metaBotSlug: input.metaBotSlug,
        timeout: sessionTimeoutMs,
      });

      let sessionId: string;
      try {
        sessionId = await executeWithRuntime(runtime);
      } catch (error) {
        if (!selection.fallbackSelected) {
          const fallbackRuntime = await resolveFallbackRuntime(input, primaryRuntime, resolutionState.fallbackRuntime);
          const fallbackSelection = fallbackRuntime
            ? await readRuntimeSelection(input, fallbackRuntime, order.providerSkill, true)
            : null;
          if (fallbackRuntime && fallbackSelection) {
            try {
              runtime = fallbackRuntime;
              selection = fallbackSelection;
              sessionId = await executeWithRuntime(fallbackRuntime);
            } catch (fallbackError) {
              return createServiceRunnerFailedResult('provider_execution_failed', fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
            }
          } else {
            return createServiceRunnerFailedResult('provider_execution_failed', error instanceof Error ? error.message : String(error));
          }
        } else {
          return createServiceRunnerFailedResult('provider_execution_failed', error instanceof Error ? error.message : String(error));
        }
      }

      const session = await waitForSession(input.llmExecutor, sessionId, sessionTimeoutMs, pollIntervalMs);
      if (!session?.result) {
        return createServiceRunnerFailedResult('provider_execution_timeout', 'The provider runtime did not produce a terminal session result before timeout.');
      }
      if (session.result.status !== 'completed') {
        return createServiceRunnerFailedResult(
          session.result.status === 'timeout'
            ? 'provider_execution_timeout'
            : session.result.status === 'cancelled'
              ? 'provider_execution_cancelled'
              : 'provider_execution_failed',
          session.result.error || 'Provider execution did not complete successfully.',
        );
      }

      const responseText = normalizeText(session.result.output);
      if (!responseText) {
        return createServiceRunnerFailedResult('provider_execution_empty', 'The provider runtime returned an empty result.');
      }
      if (!isTextOutputType(order.outputType)) {
        return createServiceRunnerFailedResult(
          'provider_deliverable_invalid',
          'Non-text provider deliverables require validation and upload support before delivery.',
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
