export declare const DEFAULT_HOST_LLM_GENERATE_TIMEOUT_MS = 60000;
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
    submitResult(result: {
        requestId: string;
    } & HostLlmGenerateOutcome): boolean;
}
export declare function createHostLlmExecutorBridge(options?: {
    createRequestId?: () => string;
    now?: () => string;
    generateTimeoutMs?: number;
}): HostLlmExecutorBridge;
export declare function getActiveHostLlmExecutorBridge(): HostLlmExecutorBridge | null;
export declare function setActiveHostLlmExecutorBridge(bridge: HostLlmExecutorBridge | null): void;
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
export declare function createDshPairHostLlmGenerate(options: {
    dshLlmPath: string;
    resolveBridge?: () => HostLlmExecutorBridge | null;
    timeoutMs?: number;
}): HostLlmGenerateForRunner;
/**
 * Host-first completion for daemon-side passive turns (group-task chair
 * turns, study drains, memory deep consolidation, headless scheduled tasks):
 * one plain completion through the connected host executor with the Bot's DSH
 * pair. Returns the model text, or null when the host path is unusable (no
 * executor connected, no pair, or a failed generation) so the caller falls
 * through to its local-runtime chain unchanged.
 */
export declare function createHostFirstCompletion(options: {
    dshLlmPath: string;
    resolveBridge?: () => HostLlmExecutorBridge | null;
    timeoutMs?: number;
    logWarning?: (scope: string, message: string) => void;
}): (request: {
    botSlug?: string;
    system: string;
    user: string;
    maxTokens?: number;
}) => Promise<string | null>;
export {};
