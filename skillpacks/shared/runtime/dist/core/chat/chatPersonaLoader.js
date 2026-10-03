"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadChatPersona = loadChatPersona;
const node_fs_1 = require("node:fs");
const metabotPersona_1 = require("../bot/metabotPersona");
async function readMdFile(filePath, heading) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        const text = raw.trim();
        // A leading `# <Self-heading>` line (e.g. `# Role` in ROLE.md) is the
        // file's own label, not persona content — strip it so it never lands
        // inside prompt fields (mirrors hostPersonaProjection's handling).
        const lines = text.split('\n');
        if (new RegExp(`^#{1,6}\\s+${heading}\\s*$`, 'iu').test(lines[0]?.trim() ?? '')) {
            return lines.slice(1).join('\n').trim();
        }
        return text;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return '';
        }
        throw error;
    }
}
async function readRuntimeIdentity(filePath) {
    let raw;
    try {
        raw = await node_fs_1.promises.readFile(filePath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || Array.isArray(state))
        return null;
    const identity = state.identity;
    if (!identity || typeof identity !== 'object' || Array.isArray(identity))
        return null;
    const fields = identity;
    const name = typeof fields.name === 'string' ? fields.name.trim() : '';
    const globalMetaId = typeof fields.globalMetaId === 'string' ? fields.globalMetaId.trim() : '';
    return (name || globalMetaId) ? { name, globalMetaId } : null;
}
async function loadChatPersona(paths) {
    const [soul, goal, role, identity] = await Promise.all([
        readMdFile(paths.soulMdPath, 'Soul'),
        readMdFile(paths.goalMdPath, 'Goal'),
        readMdFile(paths.roleMdPath, 'Role'),
        readRuntimeIdentity(paths.runtimeStatePath),
    ]);
    const persona = (0, metabotPersona_1.withRuntimeMetabotPersonaFallback)({ soul, goal, role });
    return {
        ...persona,
        ...(identity ? { identity } : {}),
    };
}
