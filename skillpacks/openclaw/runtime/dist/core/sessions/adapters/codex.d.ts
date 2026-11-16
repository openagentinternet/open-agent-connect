/**
 * Codex push adapter (local session adapters P3).
 *
 * Hands the framed message to the official `codex queue --thread <id>
 * --message <text>` — the delivery path that works for live and offline
 * threads alike: on a resumed thread the queued message starts the turn.
 * A missing binary or a rejected queue is a failed push; the router falls
 * back to the mail queue (the session sees the message at its next
 * check_inbox). Runs with the session's CODEX_HOME when one is known.
 */
export interface CodexQueuePushInput {
    threadId: string;
    framedText: string;
    /** Injectable binary (tests); default `codex` on PATH. */
    codexBin?: string;
    /** CODEX_HOME the thread lives in, when known. */
    codexHome?: string;
    /** Injectable exec (tests). */
    run?: (file: string, args: string[], options: {
        timeout: number;
        env: NodeJS.ProcessEnv;
    }) => Promise<void>;
}
export declare function pushToCodexQueue(input: CodexQueuePushInput): Promise<void>;
