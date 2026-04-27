"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadChatPersona = loadChatPersona;
const node_fs_1 = require("node:fs");
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
async function loadChatPersona(paths) {
    const [soul, goal, role] = await Promise.all([
        readMdFile(paths.soulMdPath),
        readMdFile(paths.goalMdPath),
        readMdFile(paths.roleMdPath),
    ]);
    return { soul, goal, role };
}
