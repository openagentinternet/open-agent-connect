"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadChatPersona = loadChatPersona;
const node_fs_1 = require("node:fs");
const metabotPersona_1 = require("../bot/metabotPersona");
async function readMdFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return raw.trim();
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
        readMdFile(paths.soulMdPath),
        readMdFile(paths.goalMdPath),
        readMdFile(paths.roleMdPath),
        readRuntimeIdentity(paths.runtimeStatePath),
    ]);
    const persona = (0, metabotPersona_1.withRuntimeMetabotPersonaFallback)({ soul, goal, role });
    return {
        ...persona,
        ...(identity ? { identity } : {}),
    };
}
