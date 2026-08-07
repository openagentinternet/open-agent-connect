"use strict";
/**
 * Game package loading: resolve `manifestUri` (metafile://<pinId>.zip) to
 * `game-manifest.json` + `adapter.js`, verify `adapterHash`, and cache the
 * extracted package under the daemon runtime root. The adapter hash is fixed
 * at session start and never changes during a match (docs/09 6.6).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sha256Hex = sha256Hex;
exports.normalizeAdapterHash = normalizeAdapterHash;
exports.createGamePackageLoader = createGamePackageLoader;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const artifactDownload_1 = require("../metaapp/artifactDownload");
const zipArchive_1 = require("../metaapp/zipArchive");
const types_1 = require("./types");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function sha256Hex(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value).digest('hex');
}
/**
 * Normalize an adapter hash declaration: accepts `sha256:<hex>` or bare hex.
 * Returns the lowercase hex or null when malformed.
 */
function normalizeAdapterHash(value) {
    const text = normalizeText(value).toLowerCase();
    const hex = text.startsWith('sha256:') ? text.slice('sha256:'.length) : text;
    if (!/^[0-9a-f]{64}$/u.test(hex)) {
        return null;
    }
    return hex;
}
function safeJoinPackagePath(packageDir, relativePath) {
    const normalized = relativePath.replace(/\\/gu, '/').replace(/^\.\/+/u, '');
    if (!normalized || node_path_1.default.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
        throw new Error(`Invalid game package path: ${relativePath}`);
    }
    return node_path_1.default.join(packageDir, normalized);
}
async function readPackageFile(packageDir, relativePath, maxBytes) {
    const target = safeJoinPackagePath(packageDir, relativePath);
    const stats = await node_fs_1.promises.stat(target);
    if (!stats.isFile()) {
        throw new Error(`Game package entry is not a file: ${relativePath}`);
    }
    if (stats.size > maxBytes) {
        throw new Error(`Game package entry exceeds the size limit: ${relativePath}`);
    }
    return node_fs_1.promises.readFile(target, 'utf8');
}
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ADAPTER_BYTES = 2 * 1024 * 1024;
/**
 * Load a game package from a metafile:// zip URI, verify its manifest and
 * adapter hash, and return the frozen package. The extraction cache is keyed
 * by the manifest URI hash so restores re-use the downloaded package while the
 * hash verification still runs on every load.
 */
function createGamePackageLoader(input) {
    const cacheRoot = node_path_1.default.resolve(input.cacheRoot);
    async function extractPackage(manifestUri, uriKey) {
        const packageDir = node_path_1.default.join(cacheRoot, uriKey);
        const markerPath = node_path_1.default.join(packageDir, '.extracted');
        try {
            await node_fs_1.promises.access(markerPath);
            return { packageDir };
        }
        catch {
            // Fall through to download + extract.
        }
        await node_fs_1.promises.mkdir(packageDir, { recursive: true });
        const archive = await (0, artifactDownload_1.downloadMetaAppArchive)(input.fetchImpl, manifestUri);
        if (!archive) {
            throw new Error(`Game package could not be downloaded: ${manifestUri}`);
        }
        const tempDir = node_path_1.default.join(cacheRoot, `${uriKey}.tmp-${process.pid}-${Date.now()}`);
        await node_fs_1.promises.mkdir(tempDir, { recursive: true });
        try {
            await (0, zipArchive_1.extractMetaAppZipArchive)({
                archive,
                outDir: tempDir,
                maxEntries: 200,
                maxUncompressedBytes: 32 * 1024 * 1024,
            });
            await node_fs_1.promises.rm(packageDir, { recursive: true, force: true });
            await node_fs_1.promises.rename(tempDir, packageDir);
            await node_fs_1.promises.writeFile(markerPath, `${new Date().toISOString()}\n`, 'utf8');
        }
        catch (error) {
            await node_fs_1.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
            throw error;
        }
        return { packageDir };
    }
    return {
        async load(input) {
            const manifestUri = normalizeText(input.manifestUri);
            if (!manifestUri || !/^metafile:\/\//iu.test(manifestUri)) {
                throw (0, types_1.createAppSessionError)('adapter_invalid', `manifestUri must be a metafile:// URI: ${manifestUri || '(empty)'}`);
            }
            const uriKey = sha256Hex(manifestUri);
            const { packageDir } = await extractPackage(manifestUri, uriKey);
            let manifest;
            try {
                const rawManifest = await readPackageFile(packageDir, 'game-manifest.json', MAX_MANIFEST_BYTES);
                const parsed = JSON.parse(rawManifest);
                const protocol = normalizeText(parsed.protocol);
                const gameId = normalizeText(parsed.gameId);
                const adapter = normalizeText(parsed.adapter);
                const adapterHash = normalizeAdapterHash(parsed.adapterHash);
                if (protocol !== 'agent-game/1') {
                    throw new Error(`Unsupported game package protocol: ${protocol}`);
                }
                if (!gameId || !adapter || !adapterHash) {
                    throw new Error('game-manifest.json is missing gameId, adapter, or adapterHash.');
                }
                manifest = {
                    protocol,
                    gameId,
                    adapter,
                    adapterHash,
                    ...(normalizeText(parsed.appId) ? { appId: normalizeText(parsed.appId) } : {}),
                    ...(normalizeText(parsed.rulesVersion) ? { rulesVersion: normalizeText(parsed.rulesVersion) } : {}),
                    ...(normalizeText(parsed.turnModel) ? { turnModel: normalizeText(parsed.turnModel) } : {}),
                    ...(normalizeText(parsed.informationModel) ? { informationModel: normalizeText(parsed.informationModel) } : {}),
                    ...(Number.isInteger(parsed.maxPlayers) && Number(parsed.maxPlayers) > 0
                        ? { maxPlayers: Number(parsed.maxPlayers) }
                        : {}),
                };
            }
            catch (error) {
                if (error instanceof Error && error.code === 'adapter_invalid') {
                    throw error;
                }
                throw (0, types_1.createAppSessionError)('adapter_invalid', `Game manifest is invalid: ${error instanceof Error ? error.message : String(error)}`);
            }
            let adapterCode;
            try {
                adapterCode = await readPackageFile(packageDir, manifest.adapter, MAX_ADAPTER_BYTES);
            }
            catch (error) {
                throw (0, types_1.createAppSessionError)('adapter_invalid', `Game adapter is missing or invalid: ${error instanceof Error ? error.message : String(error)}`);
            }
            const computedHash = sha256Hex(adapterCode);
            if (computedHash !== manifest.adapterHash) {
                throw (0, types_1.createAppSessionError)('adapter_invalid', `adapterHash mismatch: manifest declares ${manifest.adapterHash}, computed ${computedHash}`);
            }
            return {
                manifestUri,
                manifest,
                adapterCode,
                adapterHash: `sha256:${computedHash}`,
            };
        },
    };
}
