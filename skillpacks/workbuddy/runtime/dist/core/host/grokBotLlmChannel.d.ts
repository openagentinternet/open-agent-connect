export declare const GROK_BOT_LLM_TASK_TIMEOUT_MS: number;
export declare const GROK_BOT_LLM_TASK_POLL_INTERVAL_MS = 5000;
export interface GrokBotLlmTaskResponse {
    taskId: string;
    status: 'ok' | 'failed';
    output?: string;
    error?: string;
}
/**
 * Passive-LLM channel for Grok Bot-bound profiles. Grok Bot exposes no local
 * LLM endpoint OAC can call, so a generation becomes a structured task: the
 * daemon POSTs an `llm-task` envelope to the assistant's routine webhook (the
 * same channel as private-chat delivery), and the assistant answers by
 * writing `<taskId>.response.json` next to the request file under
 * `.runtime/state/grok-bot-llm-tasks/`. One POST, bounded polling, no
 * retries; any failure returns null so the caller falls through its normal
 * chain unchanged.
 */
export declare function createGrokBotWebhookCompletion(options: {
    homeDir: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    pollIntervalMs?: number;
    createTaskId?: () => string;
    now?: () => Date;
    logWarning?: (scope: string, message: string) => void;
}): (request: {
    botSlug?: string;
    system: string;
    user: string;
    maxTokens?: number;
}) => Promise<string | null>;
