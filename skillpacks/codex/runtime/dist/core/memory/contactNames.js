"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveContactNames = resolveContactNames;
// Contact display-name resolution for the impression/contact surfaces
// (IDBots metaidContactViewService.resolveContactName parity): a contact's
// identity is always its GlobalMetaID; names are display-only and may change.
// Resolution order: local Bot profile name > A2A conversation peer name.
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const identityProfiles_1 = require("../identity/identityProfiles");
/** Map each known subject GlobalMetaID to a display name; unknown ids are absent. */
async function resolveContactNames(paths, subjectGlobalMetaIds) {
    const wanted = new Set(subjectGlobalMetaIds.map((id) => id.trim()).filter(Boolean));
    const resolved = new Map();
    if (wanted.size === 0)
        return resolved;
    try {
        for (const profile of await (0, identityProfiles_1.listIdentityProfiles)(paths.systemHomeDir)) {
            const id = typeof profile.globalMetaId === 'string' ? profile.globalMetaId.trim() : '';
            const name = typeof profile.name === 'string' ? profile.name.trim() : '';
            if (id && name && wanted.has(id) && !resolved.has(id))
                resolved.set(id, name);
        }
    }
    catch {
        // Profile enumeration is best effort; A2A names below still apply.
    }
    let a2aFiles = [];
    try {
        a2aFiles = (await node_fs_1.promises.readdir(paths.a2aRoot))
            .filter((entry) => entry.startsWith('chat-') && entry.endsWith('.json'));
    }
    catch {
        a2aFiles = [];
    }
    for (const fileName of a2aFiles) {
        let conversation = null;
        try {
            conversation = JSON.parse(await node_fs_1.promises.readFile(node_path_1.default.join(paths.a2aRoot, fileName), 'utf8'));
        }
        catch {
            continue;
        }
        const peer = conversation && typeof conversation === 'object' ? conversation.peer : null;
        const id = typeof peer?.globalMetaId === 'string' ? peer.globalMetaId.trim() : '';
        const name = typeof peer?.name === 'string' ? peer.name.trim() : '';
        if (id && name && wanted.has(id) && !resolved.has(id))
            resolved.set(id, name);
    }
    return resolved;
}
