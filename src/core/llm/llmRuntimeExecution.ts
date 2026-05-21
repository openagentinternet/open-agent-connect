import type { LlmRuntimeResolver } from './llmRuntimeResolver';
import type {
  LlmExecutionRequest,
  LlmExecutionResult,
  LlmSessionRecord,
} from './executor';

export interface LlmRuntimeExecutionRunner {
  execute(input: LlmExecutionRequest): Promise<string>;
  getSession(sessionId: string): Promise<LlmSessionRecord | null>;
}

export interface RunLlmPromptWithRuntimeFallbackInput {
  runtimeResolver: Pick<LlmRuntimeResolver, 'resolveRuntime' | 'markBindingUsed' | 'markRuntimeUnavailable'>;
  llmExecutor: LlmRuntimeExecutionRunner;
  metaBotSlug: string;
  prompt: string;
  systemPrompt?: string;
  timeoutMs: number;
  pollIntervalMs: number;
  cwd?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  markRuntimeUnavailableOnFailure?: boolean;
}

export type LlmRuntimeFallbackResult = Pick<LlmExecutionResult, 'status' | 'output' | 'error'> & {
  sessionId?: string;
};

function resultError(result: LlmExecutionResult): string {
  return result.error || `LLM runtime ended with status ${result.status}.`;
}

function completedResultHasOutput(result: LlmExecutionResult): boolean {
  return result.output.trim().length > 0;
}

export async function runLlmPromptWithRuntimeFallback(
  input: RunLlmPromptWithRuntimeFallbackInput,
): Promise<LlmRuntimeFallbackResult> {
  const now = input.now ?? (() => Date.now());
  const sleep = input.sleep ?? ((ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  }));
  const excludedRuntimeIds = new Set<string>();
  let lastSessionId: string | undefined;
  let lastError = `No healthy LLM runtime is available for MetaBot ${input.metaBotSlug}.`;
  const shouldMarkRuntimeUnavailable = input.markRuntimeUnavailableOnFailure !== false;
  const markUnavailable = async (runtimeId: string): Promise<void> => {
    if (shouldMarkRuntimeUnavailable) {
      await input.runtimeResolver.markRuntimeUnavailable(runtimeId).catch(() => {});
    }
  };

  while (true) {
    const resolved = await input.runtimeResolver.resolveRuntime({
      metaBotSlug: input.metaBotSlug,
      excludeRuntimeIds: Array.from(excludedRuntimeIds),
    });
    const runtime = resolved.runtime;
    if (!runtime || runtime.health !== 'healthy') {
      return {
        ...(lastSessionId ? { sessionId: lastSessionId } : {}),
        status: 'failed',
        output: '',
        error: lastError,
      };
    }

    if (excludedRuntimeIds.has(runtime.id)) {
      return {
        ...(lastSessionId ? { sessionId: lastSessionId } : {}),
        status: 'failed',
        output: '',
        error: lastError,
      };
    }

    let sessionId: string | undefined;
    try {
      sessionId = await input.llmExecutor.execute({
        runtimeId: runtime.id,
        runtime,
        prompt: input.prompt,
        ...(input.systemPrompt ? { systemPrompt: input.systemPrompt } : {}),
        timeout: input.timeoutMs,
        cwd: input.cwd,
        metaBotSlug: input.metaBotSlug,
      });
      lastSessionId = sessionId;
      const deadline = now() + input.timeoutMs;
      while (now() <= deadline) {
        const session = await input.llmExecutor.getSession(sessionId);
        if (session?.result) {
          if (session.result.status === 'completed') {
            if (completedResultHasOutput(session.result)) {
              if (resolved.bindingId) {
                await input.runtimeResolver.markBindingUsed(resolved.bindingId).catch(() => {});
              }
              return {
                sessionId,
                status: session.result.status,
                output: session.result.output,
                error: session.result.error,
              };
            }
            await markUnavailable(runtime.id);
            excludedRuntimeIds.add(runtime.id);
            lastError = 'LLM runtime completed without returning output.';
            break;
          }
          await markUnavailable(runtime.id);
          excludedRuntimeIds.add(runtime.id);
          lastError = resultError(session.result);
          break;
        }
        await sleep(input.pollIntervalMs);
      }
      if (!excludedRuntimeIds.has(runtime.id)) {
        await markUnavailable(runtime.id);
        excludedRuntimeIds.add(runtime.id);
        lastError = 'LLM runtime timed out while running prompt.';
      }
    } catch (error) {
      await markUnavailable(runtime.id);
      excludedRuntimeIds.add(runtime.id);
      lastError = error instanceof Error ? error.message : 'LLM runtime is unavailable.';
    }
  }
}
