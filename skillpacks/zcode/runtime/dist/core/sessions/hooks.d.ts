/**
 * Host hook handler (local session adapters P4a).
 *
 * The turn tier: hosts whose hooks can only add context at a tool call or
 * turn end (Gemini, Cursor, Copilot, Grok CLI) get mail through a hook
 * handler — `metabot hook <event>` — that the wire step installs into each
 * host's hook config. The handler registers/refreshes the session, and on
 * mail-taking events fetches the session's inbox and prints the framed mail
 * as the host's additionalContext dialect.
 *
 * Gotcha confirmed by reason-network: Cursor, Copilot CLI and Devin load
 * CLAUDE CODE's hooks from ~/.claude/settings.json, so the agent argument
 * the settings file carries cannot be trusted — env detection wins.
 *
 * Pure logic + an injected backend; the CLI command only does stdin/stdout.
 */
export type HookEvent = 'session-start' | 'user-prompt-submit' | 'post-tool-use' | 'stop' | 'session-end' | 'status';
export type HookEventKind = 'start' | 'prompt' | 'tool' | 'stop' | 'end';
export declare function detectHookAgent(env: NodeJS.ProcessEnv, argAgent: string | undefined): string;
export declare function hookEventKind(event: string): HookEventKind | null;
/**
 * Which (agent, event) combinations can actually carry mail to the model:
 * prompt-submit hooks in Cursor/Copilot/Grok cannot add context, and Grok
 * drops what SessionStart prints.
 */
export declare function takesMail(agent: string, event: string): boolean;
/** Grok ignores subagent hook runs and shutdown Stops. */
export declare function grokIgnores(event: string, payload: Record<string, unknown> | null): boolean;
/**
 * The JSON each host expects on hook stdout to put `text` in front of the
 * model (reason-network's dialect table). Null = nothing to print.
 */
export declare function formatHookMail(agent: string, event: string, kind: HookEventKind, text: string): string | null;
export interface HookPayload {
    sessionId?: string;
    cwd?: string;
    peerName?: string;
}
export interface HookBackend {
    registerSession(input: {
        agent: string;
        sessionId?: string;
        pid?: number;
        cwd?: string;
        source: 'hook';
        deliverable: boolean;
        status?: 'busy' | 'idle';
    }): Promise<unknown>;
    inboxCheck(input: {
        sessionKey: string;
        waitSecs?: number;
    }): Promise<unknown>;
}
export interface RunHookInput {
    agent: string;
    event: HookEvent;
    payload: Record<string, unknown> | null;
    env: NodeJS.ProcessEnv;
    pid?: number;
    backend: HookBackend;
    now?: () => number;
}
export interface RunHookResult {
    sessionKey: string;
    output: string;
    mailIds: string[];
}
/**
 * Handle one hook invocation: register/refresh the session and, on a
 * mail-taking event, compose the framed inbox mail into the host's dialect.
 * Returns null when nothing should be printed (non-mail events, no session
 * id, empty inbox). Never throws.
 */
export declare function runHook(input: RunHookInput): Promise<RunHookResult | null>;
