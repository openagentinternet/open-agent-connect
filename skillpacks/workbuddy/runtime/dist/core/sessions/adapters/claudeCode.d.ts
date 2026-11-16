/**
 * Claude Code push adapter (local session adapters P3).
 *
 * Posts the framed message into a live Claude Code session's inbox socket
 * (`messagingSocketPath` from the `~/.claude/sessions/<pid>.json` registry,
 * recorded on the session record by discovery). Frame = newline-delimited
 * JSON, exactly what Claude Code's inbox expects: an optional
 * `{"type":"auth",…}` line (Windows peer tokens only) and the
 * `{"type":"user","message":{"role":"user","content":…}}` line. Delivered
 * between tool calls; wakes an idle session (which is why push is gated by
 * the wake policy upstream). A missing/stale socket throws — the router
 * treats that as "session not reachable" and leaves the mail queued.
 */
import { type Socket } from 'node:net';
export interface ClaudeInboxPushInput {
    socketPath: string;
    /** The full framed text (framing.ts), sent as one user message. */
    framedText: string;
    /** Windows peer token (`<pid>.<hash>.key` → peerToken); unused on unix. */
    token?: string;
    /** Injectable connect for tests. */
    connect?: (socketPath: string) => Promise<Socket>;
}
export declare function pushToClaudeInbox(input: ClaudeInboxPushInput): Promise<void>;
