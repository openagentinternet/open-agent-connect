"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeBotType = normalizeBotType;
exports.normalizeOptionalGlobalMetaId = normalizeOptionalGlobalMetaId;
exports.normalizeBotRoleInfo = normalizeBotRoleInfo;
exports.botRolePatchFromInput = botRolePatchFromInput;
exports.hasBotRolePatch = hasBotRolePatch;
exports.mergeBotRoleInfo = mergeBotRoleInfo;
exports.readBotRoleInfo = readBotRoleInfo;
exports.readBotRoleInfoSync = readBotRoleInfoSync;
exports.writeBotRoleInfo = writeBotRoleInfo;
// Per-Bot role + owner binding state, stored at
// `.runtime/state/bot-role.json` following the dshLlm.ts precedent.
// `botType` implements the IDBots twin/worker split (at most one twin per
// machine, enforced by twinRole.ts); `ownerGlobalMetaId` binds the Bot to its
// owner's GlobalMetaID (local binding; the signed on-chain /info/owner pin is
// a later round).
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
function normalizeBotType(value) {
    return value === 'twin' || value === 'worker' ? value : null;
}
function normalizeOptionalGlobalMetaId(value) {
    if (value === null)
        return null;
    return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function normalizeBotRoleInfo(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    return {
        botType: normalizeBotType(record.botType),
        ownerGlobalMetaId: normalizeOptionalGlobalMetaId(record.ownerGlobalMetaId),
    };
}
function hasAnyBotRoleValue(info) {
    return Boolean(info.botType || info.ownerGlobalMetaId);
}
/** Field patch view: only keys present on the input are patched (null clears). */
function botRolePatchFromInput(input) {
    const patch = {};
    if (input.botType !== undefined)
        patch.botType = input.botType;
    if (input.ownerGlobalMetaId !== undefined)
        patch.ownerGlobalMetaId = input.ownerGlobalMetaId;
    return patch;
}
function hasBotRolePatch(patch) {
    return patch.botType !== undefined || patch.ownerGlobalMetaId !== undefined;
}
function mergeBotRoleInfo(current, patch) {
    return {
        botType: patch.botType !== undefined ? patch.botType : (current.botType ?? null),
        ownerGlobalMetaId: patch.ownerGlobalMetaId !== undefined
            ? patch.ownerGlobalMetaId
            : (current.ownerGlobalMetaId ?? null),
    };
}
async function readBotRoleInfo(filePath) {
    try {
        return normalizeBotRoleInfo(JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8')));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { botType: null, ownerGlobalMetaId: null };
        }
        throw error;
    }
}
/** Sync variant of readBotRoleInfo for the sync home-selection path. */
function readBotRoleInfoSync(filePath) {
    try {
        return normalizeBotRoleInfo(JSON.parse((0, node_fs_1.readFileSync)(filePath, 'utf8')));
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return { botType: null, ownerGlobalMetaId: null };
        }
        throw error;
    }
}
async function writeBotRoleInfo(filePath, info) {
    const next = normalizeBotRoleInfo(info);
    if (!hasAnyBotRoleValue(next)) {
        try {
            await node_fs_1.promises.unlink(filePath);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
        return;
    }
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify({
        ...next,
        updatedAt: new Date().toISOString(),
    }, null, 2)}\n`, 'utf8');
}
