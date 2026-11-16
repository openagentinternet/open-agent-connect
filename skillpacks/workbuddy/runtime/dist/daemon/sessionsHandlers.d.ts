/**
 * Daemon-side sessions handler group: the /api/sessions/* verbs backing the
 * `metabot sessions *` CLI surface and the `metabot mcp` server (local
 * session adapters P1/P2a/P2b). `list` runs the passive discovery scans
 * (Claude Code registry files, Codex session index), merges presence into
 * the machine-wide registry, and returns the directory. The P2a verbs add
 * session registration and the per-session mail queue. P2b adds the
 * conversation binding (bind/unbind), the inbound routing layer shared with
 * the private-chat orchestrators (createSessionLayer), and the session
 * reply path (sendMessage anchors to the binding's observed peer and sends
 * as the bound Bot profile through the normal chat.private pipeline).
 */
import type { LocalSessionRegistry } from '../core/sessions/registry';
import type { SessionMailQueue } from '../core/sessions/mailQueue';
import type { LocalSessionRouter } from '../core/sessions/router';
import type { MetabotDaemonHttpHandlers } from './routes/types';
export interface SessionLayer {
    registry: LocalSessionRegistry;
    mailQueue: SessionMailQueue;
    router: LocalSessionRouter;
}
/**
 * The machine-wide session layer (registry + mail queue + router), built
 once per daemon so the sessions handlers and every profile's private-chat
 orchestrator share the same single-writer instances.
 */
export declare function createSessionLayer(systemHomeDir: string): SessionLayer;
export interface SessionsDaemonHandlersInput {
    /** The machine-wide system home that owns `~/.metabot/sessions/`. */
    systemHomeDir: string;
    /** Shared session layer (the daemon passes one so instances stay single-writer). */
    sessionLayer?: SessionLayer;
    /** Overrides for tests: discovery roots (`<dir>/sessions`, `<dir>/session_index.jsonl`). */
    claudeDir?: string;
    codexDir?: string;
    now?: () => number;
    /**
     * Late-bound chat.private send (resolved after the handlers object is
     * assembled — the reply path for bound sessions, P2b). The returned
     * value is awaited, so handler results may be Awaitable. Absent (unit
     * tests) = sendMessage fails with chat_send_unavailable.
     */
    getChatPrivateSend?: () => ((rawInput: Record<string, unknown>) => unknown) | null;
}
export declare function createSessionsDaemonHandlers(input: SessionsDaemonHandlersInput): NonNullable<MetabotDaemonHttpHandlers['sessions']>;
