/**
 * Host LLM executor bridge.
 *
 * Lets a connected host process (the DSH plugin today) execute LLM
 * generations on behalf of the daemon. The daemon owns the reply
 * orchestration; only the model call is delegated. Transport is
 * daemon-pushed SSE requests plus host-posted results — the same shape as
 * the browser-command channel — so the host never needs a callable HTTP
 * origin (Electron hosts have none) and every connection is host-initiated
 * loopback.
 */
import { randomUUID } from 'node:crypto';
import { readDshLlmBinding } from '../bot/dshLlm';

export const DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS = 60_000;

/** Wire request pushed to every connected host executor over SSE. */
export interface HostLlmGenerateRequest {
  type: 'generate';
  requestId: string;
  botSlug?: string;
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  fallback?: HostLlmGenerateFallback | null;
  system: string;
  prompt: string;
  timeoutMs: number;
  skills?: HostLlmGenerateSkill[];
  cwd?: string;
}

export interface HostLlmGenerateFallback {
  provider: string;
  model: string;
  reasoningEffort?: string | null;
}

/**
 * One allowed private-chat skill traveling to the host executor. Present
 * skills switch the host side into agent mode: the generation runs as a real
 * DSH sub-session (which can read the SKILL.md at `location` and execute it)
 * instead of a plain completion.
 */
export interface HostLlmGenerateSkill {
  name: string;
  description?: string | null;
  location?: string | null;
}

export interface HostLlmGenerateOutcome {
  ok: boolean;
  output?: string;
  error?: string;
}

export interface HostLlmGenerateInput {
  botSlug?: string;
  provider: string;
  model: string;
  reasoningEffort?: string | null;
  fallback?: HostLlmGenerateFallback | null;
  system: string;
  prompt: string;
  timeoutMs?: number;
  skills?: HostLlmGenerateSkill[];
  cwd?: string;
}

export interface HostLlmExecutorStatus {
  connected: number;
  lastConnectedAt: string | null;
}

type RequestSink = (request: HostLlmGenerateRequest) => void;

interface PendingGeneration {
  resolve: (outcome: HostLlmGenerateOutcome) => void;
  timer: NodeJS.Timeout;
}

export interface HostLlmExecutorBridge {
  /** Register one connected executor stream; returns its detach function. */
  attach(sink: RequestSink): () => void;
  connectedExecutors(): number;
  status(): HostLlmExecutorStatus;
  /**
   * Push one generation to the connected executors. Resolves `null` when no
   * executor is connected (caller falls through to its normal chain);
   * otherwise resolves with the first posted result or a timeout error.
   */
  generate(input: HostLlmGenerateInput): Promise<HostLlmGenerateOutcome | null>;
  /** Accept one result posted back by a host executor. */
  submitResult(result: { requestId: string } & HostLlmGenerateOutcome): boolean;
}

export function createHostLlmExecutorBridge(options?: {
  createRequestId?: () => string;
  now?: () => string;
  generateTimeoutMs?: number;
}): HostLlmExecutorBridge {
  const createRequestId = options?.createRequestId ?? (() => randomUUID());
  const now = options?.now ?? (() => new Date().toISOString());
  const defaultTimeoutMs = options?.generateTimeoutMs ?? DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS;
  const sinks = new Set<RequestSink>();
  const pending = new Map<string, PendingGeneration>();
  let lastConnectedAt: string | null = null;

  return {
    attach(sink) {
      sinks.add(sink);
      lastConnectedAt = now();
      return () => {
        sinks.delete(sink);
      };
    },
    connectedExecutors() {
      return sinks.size;
    },
    status() {
      return { connected: sinks.size, lastConnectedAt };
    },
    generate(input) {
      if (sinks.size === 0) return Promise.resolve(null);
      const requestId = createRequestId();
      const request: HostLlmGenerateRequest = {
        type: 'generate',
        requestId,
        ...(input.botSlug ? { botSlug: input.botSlug } : {}),
        provider: input.provider,
        model: input.model,
        ...(input.reasoningEffort !== undefined && input.reasoningEffort !== null
          ? { reasoningEffort: input.reasoningEffort }
          : {}),
        ...(input.fallback ? { fallback: input.fallback } : {}),
        system: input.system,
        prompt: input.prompt,
        timeoutMs: input.timeoutMs ?? defaultTimeoutMs,
        ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
        ...(input.cwd ? { cwd: input.cwd } : {}),
      };
      return new Promise<HostLlmGenerateOutcome>((resolve) => {
        const timer = setTimeout(() => {
          if (pending.delete(requestId)) {
            resolve({ ok: false, error: `Host LLM executor timed out after ${request.timeoutMs}ms.` });
          }
        }, request.timeoutMs);
        pending.set(requestId, { resolve, timer });
        for (const sink of sinks) {
          try {
            sink(request);
          } catch {
            // One broken sink must not block the broadcast; its detach runs on
            // stream close.
          }
        }
      });
    },
    submitResult(result) {
      const entry = pending.get(result.requestId);
      if (!entry) return false;
      pending.delete(result.requestId);
      clearTimeout(entry.timer);
      entry.resolve({
        ok: result.ok === true,
        ...(typeof result.output === 'string' ? { output: result.output } : {}),
        ...(typeof result.error === 'string' ? { error: result.error } : {}),
      });
      return true;
    },
  };
}

let activeHostLlmExecutorBridge: HostLlmExecutorBridge | null = null;

export function getActiveHostLlmExecutorBridge(): HostLlmExecutorBridge | null {
  return activeHostLlmExecutorBridge;
}

export function setActiveHostLlmExecutorBridge(bridge: HostLlmExecutorBridge | null): void {
  activeHostLlmExecutorBridge = bridge;
}

/**
 * Runner-facing host generation hook: usable only while a host executor is
 * connected AND the profile carries a DSH LLM pair. Reads the pair per call
 * so runtime edits in the Bots editor apply on the next turn without
 * re-wiring the (cached) reply runner.
 */
export type HostLlmGenerateForRunner = (input: {
  metaBotSlug?: string;
  prompt: string;
  systemPrompt: string;
  skills?: HostLlmGenerateSkill[];
  cwd?: string;
}) => Promise<HostLlmGenerateOutcome | null>;

export function createDshPairHostLlmGenerate(options: {
  dshLlmPath: string;
  resolveBridge?: () => HostLlmExecutorBridge | null;
  timeoutMs?: number;
}): HostLlmGenerateForRunner {
  const resolveBridge = options.resolveBridge ?? getActiveHostLlmExecutorBridge;
  return async (input) => {
    const bridge = resolveBridge();
    if (!bridge || bridge.connectedExecutors() === 0) return null;
    let binding;
    try {
      binding = await readDshLlmBinding(options.dshLlmPath);
    } catch {
      return null;
    }
    const provider = binding.dshLlmProvider?.trim() ?? '';
    const model = binding.dshLlmModel?.trim() ?? '';
    if (!provider || !model) return null;
    const fallbackProvider = binding.dshLlmFallbackProvider?.trim() ?? '';
    const fallbackModel = binding.dshLlmFallbackModel?.trim() ?? '';
    return bridge.generate({
      ...(input.metaBotSlug ? { botSlug: input.metaBotSlug } : {}),
      provider,
      model,
      reasoningEffort: binding.dshLlmReasoningEffort,
      ...(fallbackProvider && fallbackModel
        ? {
          fallback: {
            provider: fallbackProvider,
            model: fallbackModel,
            reasoningEffort: binding.dshLlmFallbackReasoningEffort,
          },
        }
        : {}),
      system: input.systemPrompt,
      prompt: input.prompt,
      ...(input.skills && input.skills.length > 0 ? { skills: input.skills } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
    });
  };
}

/**
 * Host-first completion for daemon-side passive turns (group-task chair
 * turns, study drains, memory deep consolidation, headless scheduled tasks):
 * one plain completion through the connected host executor with the Bot's DSH
 * pair. Returns the model text, or null when the host path is unusable (no
 * executor connected, no pair, or a failed generation) so the caller falls
 * through to its local-runtime chain unchanged.
 */
export function createHostFirstCompletion(options: {
  dshLlmPath: string;
  resolveBridge?: () => HostLlmExecutorBridge | null;
  timeoutMs?: number;
  logWarning?: (scope: string, message: string) => void;
}): (request: { botSlug?: string; system: string; user: string; maxTokens?: number }) => Promise<string | null> {
  const generate = createDshPairHostLlmGenerate({
    dshLlmPath: options.dshLlmPath,
    ...(options.resolveBridge ? { resolveBridge: options.resolveBridge } : {}),
    ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
  });
  return async (request) => {
    try {
      const outcome = await generate({
        ...(request.botSlug ? { metaBotSlug: request.botSlug } : {}),
        prompt: request.user,
        systemPrompt: request.system,
        ...(request.maxTokens !== undefined ? { maxTokens: request.maxTokens } : {}),
      });
      if (outcome && outcome.ok && typeof outcome.output === 'string' && outcome.output.trim()) {
        return outcome.output;
      }
      if (outcome && !outcome.ok) {
        options.logWarning?.('[host llm completion]', outcome.error ?? 'Host LLM generation failed.');
      }
    } catch (error) {
      options.logWarning?.(
        '[host llm completion]',
        error instanceof Error ? error.message : String(error),
      );
    }
    return null;
  };
}
