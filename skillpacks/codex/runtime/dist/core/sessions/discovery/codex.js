"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCodexSessionIndexLine = parseCodexSessionIndexLine;
exports.codexUpdatedAtMs = codexUpdatedAtMs;
exports.scanCodexSessions = scanCodexSessions;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
function parseCodexSessionIndexLine(raw) {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed;
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null;
    if (!id) {
        return null;
    }
    return {
        id,
        threadName: typeof record.thread_name === 'string' && record.thread_name.trim()
            ? record.thread_name.trim()
            : undefined,
        updatedAt: typeof record.updated_at === 'string' && record.updated_at.trim()
            ? record.updated_at.trim()
            : undefined,
    };
}
function codexUpdatedAtMs(entry) {
    if (!entry.updatedAt) {
        return 0;
    }
    const parsed = Date.parse(entry.updatedAt);
    return Number.isFinite(parsed) ? parsed : 0;
}
async function scanCodexSessions(options = {}) {
    const codexDir = options.codexDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.codex');
    const indexPath = node_path_1.default.join(codexDir, 'session_index.jsonl');
    const now = options.now ?? Date.now;
    const freshWindowMs = options.freshWindowMs ?? 24 * 60 * 60_000;
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(indexPath, 'utf8');
    }
    catch {
        return [];
    }
    const discovered = new Map();
    for (const line of raw.split('\n')) {
        const entry = parseCodexSessionIndexLine(line);
        if (!entry) {
            continue;
        }
        const updatedAtMs = codexUpdatedAtMs(entry);
        // Later lines win for the same id in Codex's append order: refresh the
        // title and observation time instead of skipping.
        const existing = discovered.get(entry.id);
        if (existing) {
            existing.doing = entry.threadName ?? existing.doing;
            existing.observedAt = updatedAtMs || existing.observedAt;
            continue;
        }
        if (updatedAtMs > 0 && now() - updatedAtMs > freshWindowMs) {
            continue;
        }
        discovered.set(entry.id, {
            agent: 'codex',
            sessionId: entry.id,
            doing: entry.threadName,
            status: 'unknown',
            startedAt: 0,
            observedAt: updatedAtMs || undefined,
        });
    }
    return [...discovered.values()];
}
