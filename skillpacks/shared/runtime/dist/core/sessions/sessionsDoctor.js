"use strict";
/**
 * Doctor check for the local session layer (local session adapters P5a).
 *
 * Read-only: reports the registry state (readable? how many live sessions?
 * how many deliverable/bound?) and which host wiring files exist (ZCode MCP,
 * Cursor, Gemini). Never throws — doctor must degrade to an informative
 * check when nothing is set up yet.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSessionsDoctorCheck = buildSessionsDoctorCheck;
const node_fs_1 = require("node:fs");
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
async function pathExists(file) {
    try {
        await node_fs_1.promises.access(file);
        return true;
    }
    catch {
        return false;
    }
}
async function firstExistingWiringFile(homes) {
    const wiring = {};
    const zcodeDir = homes.zcodeDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.zcode');
    const cursorDir = homes.cursorDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.cursor');
    const geminiDir = homes.geminiDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.gemini');
    const kimiDir = homes.kimiDir ?? node_path_1.default.join(node_os_1.default.homedir(), '.kimi-code');
    const candidates = [
        ['zcode', [node_path_1.default.join(zcodeDir, 'cli', 'config.json'), node_path_1.default.join(node_os_1.default.homedir(), '.agents', 'mcp.json')]],
        ['kimi', [node_path_1.default.join(kimiDir, 'mcp.json')]],
        ['cursor', [node_path_1.default.join(cursorDir, 'mcp.json'), node_path_1.default.join(cursorDir, 'hooks.json')]],
        ['gemini', [node_path_1.default.join(geminiDir, 'settings.json')]],
    ];
    for (const [host, files] of candidates) {
        wiring[host] = 'not-wired';
        for (const file of files) {
            if (await pathExists(file)) {
                wiring[host] = 'wired';
                break;
            }
        }
    }
    return wiring;
}
async function buildSessionsDoctorCheck(systemHomeDir, homes = {}) {
    const sessionPaths = (0, paths_1.resolveMetabotSessionPaths)(systemHomeDir);
    const registryReadable = await pathExists(sessionPaths.localSessionsPath);
    let liveSessions = 0;
    let deliverableSessions = 0;
    let boundConversations = 0;
    let note;
    if (registryReadable) {
        try {
            const raw = await node_fs_1.promises.readFile(sessionPaths.localSessionsPath, 'utf8');
            const parsed = JSON.parse(raw);
            const sessions = Array.isArray(parsed.sessions) ? parsed.sessions : [];
            const cutoff = Date.now() - 10 * 60_000;
            for (const session of sessions) {
                const lastSeenAt = typeof session.lastSeenAt === 'number' ? session.lastSeenAt : 0;
                if (lastSeenAt >= cutoff) {
                    liveSessions += 1;
                }
                if (session.deliverable === true) {
                    deliverableSessions += 1;
                }
                const bindings = Array.isArray(session.boundConversations) ? session.boundConversations : [];
                boundConversations += bindings.length;
            }
        }
        catch (error) {
            note = `Registry file exists but could not be read: ${error instanceof Error ? error.message : String(error)}`;
        }
    }
    else {
        note = 'No sessions registered yet — sessions appear here after a host is wired (metabot sessions wire --host …) and a session registers via MCP or hooks.';
    }
    return {
        code: 'local_sessions_layer',
        ok: true,
        registryPath: sessionPaths.localSessionsPath,
        registryReadable,
        liveSessions,
        deliverableSessions,
        boundConversations,
        wiring: await firstExistingWiringFile(homes),
        ...(note ? { note } : {}),
    };
}
