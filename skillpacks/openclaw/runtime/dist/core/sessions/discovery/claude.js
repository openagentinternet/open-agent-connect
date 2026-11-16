"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.defaultPidAlive = defaultPidAlive;
exports.parseClaudeSessionFile = parseClaudeSessionFile;
exports.epochToMs = epochToMs;
exports.scanClaudeSessions = scanClaudeSessions;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/** Default liveness probe: signal 0 (no-op) — false when the pid is gone. */
function defaultPidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function parseClaudeSessionFile(raw) {
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return null;
    }
    const record = parsed;
    const pid = typeof record.pid === 'number' && Number.isInteger(record.pid) && record.pid > 0
        ? record.pid
        : null;
    if (pid === null) {
        return null;
    }
    const text = (value) => typeof value === 'string' && value.trim() ? value.trim() : undefined;
    return {
        pid,
        sessionId: text(record.sessionId),
        cwd: text(record.cwd),
        name: text(record.name),
        nameSource: text(record.nameSource),
        status: text(record.status),
        startedAt: typeof record.startedAt === 'number' ? record.startedAt : undefined,
        messagingSocketPath: text(record.messagingSocketPath),
    };
}
function normalizeActivityStatus(raw) {
    return raw === 'busy' || raw === 'idle' ? raw : 'unknown';
}
/** Epoch values may arrive in seconds or ms; normalize to ms heuristically. */
function epochToMs(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        return 0;
    }
    return value < 10_000_000_000 ? value * 1_000 : value;
}
/** Claude Code's own names can be sentences; slug them down (3 words when auto-derived). */
function displayName(session) {
    const name = session.name?.trim();
    if (!name) {
        return undefined;
    }
    const shortened = session.nameSource === 'auto'
        ? name.split(/\s+/).slice(0, 3).join(' ')
        : name;
    return shortened || undefined;
}
async function scanClaudeSessions(options = {}) {
    const claudeDir = options.claudeDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.claude');
    const sessionsDir = node_path_1.default.join(claudeDir, 'sessions');
    const pidAlive = options.pidAlive ?? defaultPidAlive;
    const now = options.now ?? Date.now;
    let fileNames;
    try {
        fileNames = await node_fs_1.promises.readdir(sessionsDir);
    }
    catch {
        return [];
    }
    const seenPids = new Set();
    const discovered = [];
    for (const fileName of fileNames) {
        if (!fileName.endsWith('.json')) {
            continue;
        }
        let raw;
        try {
            raw = await node_fs_1.promises.readFile(node_path_1.default.join(sessionsDir, fileName), 'utf8');
        }
        catch {
            continue;
        }
        const session = parseClaudeSessionFile(raw);
        if (!session || seenPids.has(session.pid) || !pidAlive(session.pid)) {
            continue;
        }
        seenPids.add(session.pid);
        let lastSeenAt = now();
        try {
            const stats = await node_fs_1.promises.stat(node_path_1.default.join(sessionsDir, fileName));
            lastSeenAt = Math.max(stats.mtimeMs, 0) || lastSeenAt;
        }
        catch {
            // mtime is an optimization; fall back to scan time.
        }
        discovered.push({
            agent: 'claude-code',
            sessionId: session.sessionId,
            pid: session.pid,
            cwd: session.cwd,
            name: displayName(session),
            doing: session.nameSource === 'auto' ? session.name : undefined,
            status: normalizeActivityStatus(session.status),
            startedAt: epochToMs(session.startedAt),
            inboxSocketPath: session.messagingSocketPath,
        });
    }
    return discovered;
}
