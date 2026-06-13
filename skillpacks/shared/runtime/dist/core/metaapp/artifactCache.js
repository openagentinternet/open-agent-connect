"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMetaAppModifyHistory = normalizeMetaAppModifyHistory;
exports.buildMetaAppArtifactCacheKey = buildMetaAppArtifactCacheKey;
exports.createMetaAppArtifactCacheStore = createMetaAppArtifactCacheStore;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const zipArchive_1 = require("./zipArchive");
const MANIFEST_VERSION = 1;
function resolvePaths(pathsOrHomeDir) {
    return typeof pathsOrHomeDir === 'string' ? (0, paths_1.resolveMetabotPaths)(pathsOrHomeDir) : pathsOrHomeDir;
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeMetaAppModifyHistory(value) {
    if (!Array.isArray(value)) {
        return null;
    }
    const entries = value.map((item) => normalizeText(item)).filter(Boolean);
    return entries.length > 0 ? entries : null;
}
function latestModifyPinId(modifyHistory) {
    return modifyHistory && modifyHistory.length > 0 ? modifyHistory[modifyHistory.length - 1] : null;
}
function normalizeDescriptor(input) {
    return {
        metaAppPinId: normalizeText(input.metaAppPinId),
        contentReference: normalizeText(input.contentReference),
        contentType: normalizeText(input.contentType),
        indexFile: normalizeText(input.indexFile) || 'index.html',
        modifyHistory: normalizeMetaAppModifyHistory(input.modifyHistory),
    };
}
function buildMetaAppArtifactCacheKey(input) {
    const descriptor = {
        contentReference: normalizeText(input.contentReference),
        contentType: normalizeText(input.contentType),
        indexFile: normalizeText(input.indexFile) || 'index.html',
    };
    return (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(descriptor)).digest('hex');
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
async function readJsonFile(filePath) {
    try {
        return JSON.parse(await node_fs_1.promises.readFile(filePath, 'utf8'));
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}
async function writeJsonFile(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    await node_fs_1.promises.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function normalizeManifest(value) {
    const raw = readObject(value);
    if (!raw || raw.version !== MANIFEST_VERSION) {
        return null;
    }
    const cacheKey = normalizeText(raw.cacheKey);
    const metaAppPinId = normalizeText(raw.metaAppPinId);
    const contentReference = normalizeText(raw.contentReference);
    const contentType = normalizeText(raw.contentType);
    const indexFile = normalizeText(raw.indexFile);
    const artifactPath = normalizeText(raw.artifactPath);
    const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : null;
    const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : null;
    const lastUsedAt = typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt) ? raw.lastUsedAt : null;
    if (!cacheKey || !metaAppPinId || !contentReference || !contentType || !indexFile || !artifactPath || createdAt === null || updatedAt === null || lastUsedAt === null) {
        return null;
    }
    return {
        version: MANIFEST_VERSION,
        cacheKey,
        metaAppPinId,
        contentReference,
        contentType,
        indexFile,
        modifyHistory: normalizeMetaAppModifyHistory(raw.modifyHistory),
        latestModifyPinId: normalizeText(raw.latestModifyPinId) || null,
        artifactPath,
        createdAt,
        updatedAt,
        lastUsedAt,
    };
}
async function assertFileExists(filePath) {
    try {
        const stat = await node_fs_1.promises.stat(filePath);
        return stat.isFile();
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return false;
        }
        throw error;
    }
}
async function findArtifactRootForIndexFile(rootDir, indexFile) {
    if (await assertFileExists(node_path_1.default.join(rootDir, indexFile))) {
        return rootDir;
    }
    const entries = await node_fs_1.promises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
    const directories = entries.filter((entry) => (entry.isDirectory()
        && entry.name !== '__MACOSX'
        && !entry.name.startsWith('.')));
    if (directories.length !== 1) {
        return rootDir;
    }
    const nestedRoot = node_path_1.default.join(rootDir, directories[0].name);
    return await assertFileExists(node_path_1.default.join(nestedRoot, indexFile)) ? nestedRoot : rootDir;
}
function relativeArtifactPath(rootDir, artifactDir) {
    const relative = node_path_1.default.relative(rootDir, artifactDir);
    if (!relative || relative.startsWith('..') || node_path_1.default.isAbsolute(relative)) {
        throw new Error('MetaApp artifact directory escaped the cache root.');
    }
    return relative;
}
function toEntry(input) {
    const artifactRoot = node_path_1.default.join(input.artifactsRoot, input.cacheKey);
    return {
        cacheKey: input.cacheKey,
        artifactRoot,
        artifactDir: node_path_1.default.join(artifactRoot, input.manifest.artifactPath),
        indexFile: input.manifest.indexFile,
        manifestPath: node_path_1.default.join(artifactRoot, 'manifest.json'),
    };
}
function pinCacheFilePath(pinsRoot, metaAppPinId) {
    return node_path_1.default.join(pinsRoot, `${metaAppPinId}.json`);
}
function safeCacheKey(value) {
    const text = normalizeText(value);
    if (!/^[a-f0-9]{64}$/i.test(text)) {
        throw new Error('Invalid MetaApp artifact cache key.');
    }
    return text.toLowerCase();
}
function safePinId(value) {
    const text = normalizeText(value);
    if (!/^[A-Za-z0-9_.:-]+$/.test(text)) {
        throw new Error('Invalid MetaApp pin id.');
    }
    return text;
}
async function pathExists(targetPath) {
    try {
        await node_fs_1.promises.access(targetPath);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
            return false;
        }
        throw error;
    }
}
async function listFilesRecursive(rootDir) {
    const entries = await node_fs_1.promises.readdir(rootDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
        const entryPath = node_path_1.default.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listFilesRecursive(entryPath));
        }
        else if (entry.isFile()) {
            files.push(entryPath);
        }
    }
    return files;
}
async function directorySize(rootDir) {
    const files = await listFilesRecursive(rootDir);
    let total = 0;
    for (const file of files) {
        const stat = await node_fs_1.promises.stat(file).catch(() => null);
        if (stat?.isFile()) {
            total += stat.size;
        }
    }
    return total;
}
async function listPinRecordFiles(pinsRoot) {
    const entries = await node_fs_1.promises.readdir(pinsRoot, { withFileTypes: true }).catch(() => []);
    return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => node_path_1.default.join(pinsRoot, entry.name));
}
function cacheKeyFromPinRecord(value) {
    const raw = readObject(value);
    return raw ? normalizeText(raw.cacheKey) : '';
}
function createMetaAppArtifactCacheStore(pathsOrHomeDir, options = {}) {
    const paths = resolvePaths(pathsOrHomeDir);
    const cacheRoot = node_path_1.default.join(paths.metabotRoot, 'cache', 'metaapps');
    const artifactsRoot = node_path_1.default.join(cacheRoot, 'artifacts');
    const pinsRoot = node_path_1.default.join(cacheRoot, 'pins');
    const now = options.now ?? Date.now;
    async function writePinRecord(input) {
        const descriptor = normalizeDescriptor(input);
        if (!descriptor.metaAppPinId) {
            return;
        }
        await writeJsonFile(pinCacheFilePath(pinsRoot, descriptor.metaAppPinId), {
            version: MANIFEST_VERSION,
            metaAppPinId: descriptor.metaAppPinId,
            contentReference: descriptor.contentReference,
            contentType: descriptor.contentType,
            indexFile: descriptor.indexFile,
            modifyHistory: descriptor.modifyHistory ?? null,
            latestModifyPinId: latestModifyPinId(descriptor.modifyHistory),
            cacheKey: input.cacheKey,
            artifactDir: input.artifactDir,
            lastCheckedAt: now(),
            lastUsedAt: now(),
        });
    }
    return {
        cacheRoot,
        artifactsRoot,
        pinsRoot,
        async getArtifact(input) {
            const descriptor = normalizeDescriptor(input);
            const cacheKey = buildMetaAppArtifactCacheKey(descriptor);
            const artifactRoot = node_path_1.default.join(artifactsRoot, cacheKey);
            const manifestPath = node_path_1.default.join(artifactRoot, 'manifest.json');
            const manifest = normalizeManifest(await readJsonFile(manifestPath));
            if (!manifest
                || manifest.cacheKey !== cacheKey
                || manifest.contentReference !== descriptor.contentReference
                || manifest.contentType !== descriptor.contentType
                || manifest.indexFile !== descriptor.indexFile) {
                return null;
            }
            const entry = toEntry({ artifactsRoot, cacheKey, manifest });
            if (!await assertFileExists(node_path_1.default.join(entry.artifactDir, descriptor.indexFile))) {
                return null;
            }
            const touched = {
                ...manifest,
                metaAppPinId: descriptor.metaAppPinId || manifest.metaAppPinId,
                modifyHistory: descriptor.modifyHistory ?? null,
                latestModifyPinId: latestModifyPinId(descriptor.modifyHistory),
                lastUsedAt: now(),
            };
            await writeJsonFile(manifestPath, touched);
            await writePinRecord({ ...descriptor, cacheKey, artifactDir: entry.artifactDir });
            return entry;
        },
        async writeArtifact(input) {
            const descriptor = normalizeDescriptor(input);
            const cacheKey = buildMetaAppArtifactCacheKey(descriptor);
            const artifactRoot = node_path_1.default.join(artifactsRoot, cacheKey);
            const stagingRoot = node_path_1.default.join(artifactsRoot, `.staging-${cacheKey}-${(0, node_crypto_1.randomUUID)()}`);
            const payloadRoot = node_path_1.default.join(stagingRoot, 'payload');
            const createdAt = now();
            await node_fs_1.promises.mkdir(artifactsRoot, { recursive: true });
            try {
                await (0, zipArchive_1.extractMetaAppZipArchive)({ archive: input.archive, outDir: payloadRoot });
                const artifactDir = await findArtifactRootForIndexFile(payloadRoot, descriptor.indexFile);
                if (!await assertFileExists(node_path_1.default.join(artifactDir, descriptor.indexFile))) {
                    throw new Error('MetaApp artifact indexFile was not found after extraction.');
                }
                const artifactPath = relativeArtifactPath(stagingRoot, artifactDir);
                const manifest = {
                    version: MANIFEST_VERSION,
                    cacheKey,
                    metaAppPinId: descriptor.metaAppPinId,
                    contentReference: descriptor.contentReference,
                    contentType: descriptor.contentType,
                    indexFile: descriptor.indexFile,
                    modifyHistory: descriptor.modifyHistory ?? null,
                    latestModifyPinId: latestModifyPinId(descriptor.modifyHistory),
                    artifactPath,
                    createdAt,
                    updatedAt: createdAt,
                    lastUsedAt: createdAt,
                };
                await writeJsonFile(node_path_1.default.join(stagingRoot, 'manifest.json'), manifest);
                await node_fs_1.promises.rm(artifactRoot, { recursive: true, force: true });
                await node_fs_1.promises.rename(stagingRoot, artifactRoot);
                const entry = toEntry({ artifactsRoot, cacheKey, manifest });
                await writePinRecord({ ...descriptor, cacheKey, artifactDir: entry.artifactDir });
                return entry;
            }
            catch (error) {
                await node_fs_1.promises.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
                throw error;
            }
        },
        async getStats() {
            const artifactEntries = await node_fs_1.promises.readdir(artifactsRoot, { withFileTypes: true }).catch(() => []);
            const artifacts = [];
            for (const entry of artifactEntries) {
                if (!entry.isDirectory() || entry.name.startsWith('.staging-')) {
                    continue;
                }
                const manifest = normalizeManifest(await readJsonFile(node_path_1.default.join(artifactsRoot, entry.name, 'manifest.json')));
                if (!manifest) {
                    continue;
                }
                const artifactRoot = node_path_1.default.join(artifactsRoot, manifest.cacheKey);
                artifacts.push({
                    cacheKey: manifest.cacheKey,
                    metaAppPinId: manifest.metaAppPinId,
                    contentReference: manifest.contentReference,
                    contentType: manifest.contentType,
                    indexFile: manifest.indexFile,
                    modifyHistory: manifest.modifyHistory,
                    latestModifyPinId: manifest.latestModifyPinId,
                    artifactDir: node_path_1.default.join(artifactRoot, manifest.artifactPath),
                    createdAt: manifest.createdAt,
                    updatedAt: manifest.updatedAt,
                    lastUsedAt: manifest.lastUsedAt,
                    sizeBytes: await directorySize(artifactRoot),
                });
            }
            const pinRecordFiles = await listPinRecordFiles(pinsRoot);
            return {
                cacheRoot,
                artifactsRoot,
                pinsRoot,
                artifactCount: artifacts.length,
                pinRecordCount: pinRecordFiles.length,
                totalBytes: await directorySize(cacheRoot),
                artifacts,
            };
        },
        async clear(input = { scope: 'all' }) {
            const scope = input.scope ?? 'all';
            if (scope === 'all') {
                const stats = await this.getStats();
                await node_fs_1.promises.rm(cacheRoot, { recursive: true, force: true });
                return {
                    clearedArtifacts: stats.artifactCount,
                    clearedPinRecords: stats.pinRecordCount,
                };
            }
            let cacheKey = '';
            let extraPinFile = null;
            if (scope === 'pin') {
                const pinId = safePinId(input.pinId);
                extraPinFile = pinCacheFilePath(pinsRoot, pinId);
                cacheKey = cacheKeyFromPinRecord(await readJsonFile(extraPinFile));
                if (!cacheKey) {
                    await node_fs_1.promises.rm(extraPinFile, { force: true }).catch(() => undefined);
                    return { clearedArtifacts: 0, clearedPinRecords: 0 };
                }
            }
            else if (scope === 'artifact') {
                cacheKey = safeCacheKey(input.cacheKey);
            }
            else {
                throw new Error('Unsupported MetaApp artifact cache clear scope.');
            }
            cacheKey = safeCacheKey(cacheKey);
            const pinRecordFiles = await listPinRecordFiles(pinsRoot);
            let clearedPinRecords = 0;
            for (const file of pinRecordFiles) {
                if (cacheKeyFromPinRecord(await readJsonFile(file)) === cacheKey) {
                    await node_fs_1.promises.rm(file, { force: true });
                    clearedPinRecords += 1;
                }
            }
            if (extraPinFile && !pinRecordFiles.includes(extraPinFile) && await pathExists(extraPinFile)) {
                await node_fs_1.promises.rm(extraPinFile, { force: true });
                clearedPinRecords += 1;
            }
            const artifactRoot = node_path_1.default.join(artifactsRoot, cacheKey);
            const hadArtifact = await pathExists(artifactRoot);
            await node_fs_1.promises.rm(artifactRoot, { recursive: true, force: true });
            return {
                clearedArtifacts: hadArtifact ? 1 : 0,
                clearedPinRecords,
            };
        },
    };
}
