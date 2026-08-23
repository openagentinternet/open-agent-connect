"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OwnerIdentityError = exports.DEFAULT_OWNER_NAME = void 0;
exports.resolveOwnerIdfilePath = resolveOwnerIdfilePath;
exports.toOwnerIdentityPublic = toOwnerIdentityPublic;
exports.readOwnerIdentity = readOwnerIdentity;
exports.createOwnerIdentity = createOwnerIdentity;
exports.importOwnerIdentity = importOwnerIdentity;
exports.ensureOwnerIdentity = ensureOwnerIdentity;
exports.renameOwnerIdentity = renameOwnerIdentity;
exports.revealOwnerMnemonic = revealOwnerMnemonic;
exports.deleteOwnerIdentity = deleteOwnerIdentity;
// The local human "owner" identity: the person who talks to the Bots. This is
// deliberately NOT a MetaBot Bot profile — it is a single machine-wide MetaID
// wallet (mnemonic -> globalMetaId) stored under `~/.metabot/owner/`, mirroring
// IDBots' single-row `user_identity`. Bots reference it through their
// `ownerGlobalMetaId` binding. The mnemonic is secret material, so the file is
// written 0600 and lives outside `manager/` (the storage-layout spec forbids
// mnemonics there).
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const bip39 = __importStar(require("@scure/bip39"));
const english_1 = require("@scure/bip39/wordlists/english");
const deriveIdentity_1 = require("../identity/deriveIdentity");
const OWNER_FILE_MODE = 0o600;
exports.DEFAULT_OWNER_NAME = 'User';
class OwnerIdentityError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'OwnerIdentityError';
    }
}
exports.OwnerIdentityError = OwnerIdentityError;
function resolveOwnerIdfilePath(systemHomeDir) {
    return node_path_1.default.join(systemHomeDir, '.metabot', 'owner', 'identity.json');
}
function toOwnerIdentityPublic(record) {
    return {
        version: record.version,
        name: record.name,
        path: record.path,
        publicKey: record.publicKey,
        chatPublicKey: record.chatPublicKey,
        mvcAddress: record.mvcAddress,
        metaId: record.metaId,
        globalMetaId: record.globalMetaId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function readString(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value : '';
}
function normalizeOwnerIdentityRecord(value) {
    if (!isRecord(value))
        return null;
    const mnemonic = readString(value, 'mnemonic');
    const globalMetaId = readString(value, 'globalMetaId');
    const mvcAddress = readString(value, 'mvcAddress');
    if (!mnemonic || !globalMetaId || !mvcAddress)
        return null;
    return {
        version: 1,
        name: readString(value, 'name') || exports.DEFAULT_OWNER_NAME,
        mnemonic,
        path: readString(value, 'path') || deriveIdentity_1.DEFAULT_DERIVATION_PATH,
        publicKey: readString(value, 'publicKey'),
        chatPublicKey: readString(value, 'chatPublicKey'),
        mvcAddress,
        metaId: readString(value, 'metaId'),
        globalMetaId,
        createdAt: readString(value, 'createdAt'),
        updatedAt: readString(value, 'updatedAt'),
    };
}
async function readOwnerIdentity(systemHomeDir) {
    try {
        const raw = await node_fs_1.promises.readFile(resolveOwnerIdfilePath(systemHomeDir), 'utf8');
        return normalizeOwnerIdentityRecord(JSON.parse(raw));
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        throw error;
    }
}
async function applyOwnerFileMode(filePath) {
    if (process.platform === 'win32')
        return;
    try {
        await node_fs_1.promises.chmod(filePath, OWNER_FILE_MODE);
    }
    catch (error) {
        const code = error.code;
        if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL')
            return;
        throw error;
    }
}
async function writeOwnerIdentityFile(systemHomeDir, record) {
    const filePath = resolveOwnerIdfilePath(systemHomeDir);
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        mode: OWNER_FILE_MODE,
    });
    await applyOwnerFileMode(filePath);
}
function cleanName(name) {
    return name.trim();
}
function persistDerived(systemHomeDir, name, derived) {
    const now = new Date().toISOString();
    return {
        version: 1,
        name: cleanName(name) || exports.DEFAULT_OWNER_NAME,
        mnemonic: derived.mnemonic,
        path: derived.path,
        publicKey: derived.publicKey,
        chatPublicKey: derived.chatPublicKey,
        mvcAddress: derived.mvcAddress,
        metaId: derived.metaId,
        globalMetaId: derived.globalMetaId,
        createdAt: now,
        updatedAt: now,
    };
}
/** Create a brand-new owner identity (fresh mnemonic). Fails if one exists. */
async function createOwnerIdentity(systemHomeDir, input) {
    const existing = await readOwnerIdentity(systemHomeDir);
    if (existing) {
        throw new OwnerIdentityError('owner_exists', 'An owner identity already exists on this machine.');
    }
    const derived = await (0, deriveIdentity_1.deriveIdentity)({});
    const record = persistDerived(systemHomeDir, input.name, derived);
    await writeOwnerIdentityFile(systemHomeDir, record);
    return record;
}
/** Import an owner identity from an existing mnemonic. Fails if one exists. */
async function importOwnerIdentity(systemHomeDir, input) {
    const existing = await readOwnerIdentity(systemHomeDir);
    if (existing) {
        throw new OwnerIdentityError('owner_exists', 'An owner identity already exists on this machine.');
    }
    const mnemonic = input.mnemonic.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!bip39.validateMnemonic(mnemonic, english_1.wordlist)) {
        throw new OwnerIdentityError('invalid_mnemonic', 'The mnemonic is not a valid BIP39 phrase.');
    }
    const derived = await (0, deriveIdentity_1.deriveIdentity)({ mnemonic, path: input.path?.trim() || deriveIdentity_1.DEFAULT_DERIVATION_PATH });
    const record = persistDerived(systemHomeDir, input.name, derived);
    await writeOwnerIdentityFile(systemHomeDir, record);
    return record;
}
/** Return the existing identity, creating one with a default name when absent. */
async function ensureOwnerIdentity(systemHomeDir, input = {}) {
    const existing = await readOwnerIdentity(systemHomeDir);
    if (existing)
        return existing;
    return createOwnerIdentity(systemHomeDir, { name: input.name ?? exports.DEFAULT_OWNER_NAME });
}
/** Rename the existing owner identity. */
async function renameOwnerIdentity(systemHomeDir, name) {
    const current = await readOwnerIdentity(systemHomeDir);
    if (!current) {
        throw new OwnerIdentityError('owner_missing', 'No owner identity exists on this machine.');
    }
    const nextName = cleanName(name);
    if (!nextName) {
        throw new OwnerIdentityError('invalid_name', 'Name must not be empty.');
    }
    const record = { ...current, name: nextName, updatedAt: new Date().toISOString() };
    await writeOwnerIdentityFile(systemHomeDir, record);
    return record;
}
/** Reveal the stored mnemonic (for the backup view). */
async function revealOwnerMnemonic(systemHomeDir) {
    const current = await readOwnerIdentity(systemHomeDir);
    if (!current) {
        throw new OwnerIdentityError('owner_missing', 'No owner identity exists on this machine.');
    }
    return current.mnemonic;
}
/** Delete the owner identity (logout). */
async function deleteOwnerIdentity(systemHomeDir) {
    try {
        await node_fs_1.promises.unlink(resolveOwnerIdfilePath(systemHomeDir));
    }
    catch (error) {
        if (error.code !== 'ENOENT')
            throw error;
    }
}
