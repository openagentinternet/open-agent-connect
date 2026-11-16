/**
 * Passive discovery for Codex sessions (local session adapters P1).
 *
 * Codex keeps `~/.codex/session_index.jsonl`, one JSON object per line:
 * `{"id","thread_name","updated_at"}` (verified against a live install —
 * the index carries no cwd and no pid). Entries give the directory a
 * session id and a what-it-is-doing title; presence freshness is the
 * updated_at timestamp, since there is no process to probe. P1 treats
 * these as presence-only (deliverable=false) until a P2+ registration
 * path claims them.
 */
import type { DiscoveredSession } from '../types';
export interface CodexIndexEntry {
    id: string;
    threadName?: string;
    /** ISO timestamp string, as written by Codex. */
    updatedAt?: string;
}
export declare function parseCodexSessionIndexLine(raw: string): CodexIndexEntry | null;
export declare function codexUpdatedAtMs(entry: CodexIndexEntry): number;
export interface ScanCodexSessionsOptions {
    /** Overrides `~/.codex` (tests). The scanner reads `<codexDir>/session_index.jsonl`. */
    codexDir?: string;
    /** Epoch ms "now"; defaults to Date.now() (tests). */
    now?: () => number;
    /** Entries older than this are skipped (default 24h — the registry's lapse TTL). */
    freshWindowMs?: number;
}
export declare function scanCodexSessions(options?: ScanCodexSessionsOptions): Promise<DiscoveredSession[]>;
