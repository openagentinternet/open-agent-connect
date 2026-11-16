/**
 * Passive discovery for Claude Code sessions (local session adapters P1).
 *
 * Claude Code keeps one `~/.claude/sessions/<pid>.json` per live session
 * (camelCase fields: pid, sessionId, cwd, name, nameSource, status,
 * statusUpdatedAt, startedAt, messagingSocketPath — the same registry
 * reason-network reads). Reading it lists every Claude session on this
 * machine, including ones without any OAC wiring. P1 treats these as
 * presence-only: they appear in the directory but cannot receive mail
 * (deliverable=false) until a P2+ registration path claims them.
 */
import type { DiscoveredSession } from '../types';
export interface ClaudeRegistrySession {
    pid: number;
    sessionId?: string;
    cwd?: string;
    name?: string;
    /** `user` after a /rename; `derived`/`auto` for host-made names. */
    nameSource?: string;
    status?: string;
    statusUpdatedAt?: number;
    startedAt?: number;
    /** Where the session takes peer messages (P3's push adapter; unused in P1). */
    messagingSocketPath?: string;
}
/** Default liveness probe: signal 0 (no-op) — false when the pid is gone. */
export declare function defaultPidAlive(pid: number): boolean;
export declare function parseClaudeSessionFile(raw: string): ClaudeRegistrySession | null;
/** Epoch values may arrive in seconds or ms; normalize to ms heuristically. */
export declare function epochToMs(value: number | undefined): number;
export interface ScanClaudeSessionsOptions {
    /** Overrides `~/.claude` (tests). The scanner reads `<claudeDir>/sessions`. */
    claudeDir?: string;
    pidAlive?: (pid: number) => boolean;
    /** Epoch ms "now"; defaults to Date.now() (tests). */
    now?: () => number;
}
export declare function scanClaudeSessions(options?: ScanClaudeSessionsOptions): Promise<DiscoveredSession[]>;
