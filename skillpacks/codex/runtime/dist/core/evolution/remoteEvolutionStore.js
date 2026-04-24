"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRemoteEvolutionStore = createRemoteEvolutionStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const localEvolutionStore_1 = require("./localEvolutionStore");
const REMOTE_EVOLUTION_SCHEMA_VERSION = 1;
let atomicWriteSequence = 0;
const indexUpdateQueues = new Map();
function createEmptyRemoteEvolutionIndex() {
    return {
        schemaVersion: REMOTE_EVOLUTION_SCHEMA_VERSION,
        imports: [],
        byVariantId: {},
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function isValidIdentifier(identifier) {
    return (!!identifier
        && identifier !== '.'
        && identifier !== '..'
        && !node_path_1.default.isAbsolute(identifier)
        && localEvolutionStore_1.SAFE_IDENTIFIER_PATTERN.test(identifier));
}
function normalizeRemoteIndexRow(variantId, value) {
    if (!isValidIdentifier(variantId) || !isRecord(value) || typeof value.pinId !== 'string') {
        return null;
    }
    return {
        variantId,
        pinId: value.pinId,
    };
}
function normalizeRemoteIndex(value) {
    if (!isRecord(value)) {
        return {
            index: createEmptyRemoteEvolutionIndex(),
            repaired: true,
        };
    }
    const incomingByVariantId = isRecord(value.byVariantId) ? value.byVariantId : {};
    const byVariantId = {};
    let repaired = value.schemaVersion !== REMOTE_EVOLUTION_SCHEMA_VERSION || !isRecord(value.byVariantId);
    for (const [key, row] of Object.entries(incomingByVariantId)) {
        if (!isRecord(row)) {
            repaired = true;
            continue;
        }
        const rowVariantId = typeof row.variantId === 'string' ? row.variantId : key;
        const normalizedRow = normalizeRemoteIndexRow(rowVariantId, row);
        if (!normalizedRow) {
            repaired = true;
            continue;
        }
        if (rowVariantId !== key) {
            repaired = true;
        }
        if (Object.prototype.hasOwnProperty.call(byVariantId, normalizedRow.variantId)) {
            repaired = true;
        }
        byVariantId[normalizedRow.variantId] = normalizedRow;
    }
    const imports = Object.keys(byVariantId).sort();
    const incomingImports = Array.isArray(value.imports)
        ? value.imports.filter((entry) => typeof entry === 'string')
        : [];
    const incomingImportsNormalized = [...new Set(incomingImports)].sort();
    if (incomingImportsNormalized.length !== imports.length) {
        repaired = true;
    }
    else {
        for (let index = 0; index < imports.length; index += 1) {
            if (imports[index] !== incomingImportsNormalized[index]) {
                repaired = true;
                break;
            }
        }
    }
    return {
        index: {
            schemaVersion: REMOTE_EVOLUTION_SCHEMA_VERSION,
            imports,
            byVariantId,
        },
        repaired,
    };
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
async function readIndexFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT' || error instanceof SyntaxError) {
            return null;
        }
        throw error;
    }
}
function nextAtomicWriteSuffix() {
    atomicWriteSequence += 1;
    return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}
async function writeJsonAtomic(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
    await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await node_fs_1.promises.rename(tempPath, filePath);
    return filePath;
}
async function pathExists(filePath) {
    try {
        await node_fs_1.promises.access(filePath);
        return true;
    }
    catch (error) {
        const code = error.code;
        if (code === 'ENOENT') {
            return false;
        }
        throw error;
    }
}
async function ensureRemoteEvolutionLayout(paths) {
    await node_fs_1.promises.mkdir(paths.evolutionRemoteArtifactsRoot, { recursive: true });
}
function getIndexQueue(indexPath) {
    return indexUpdateQueues.get(indexPath) ?? Promise.resolve();
}
function queueIndexUpdate(indexPath, task) {
    const previous = getIndexQueue(indexPath);
    const run = previous.then(task, task);
    indexUpdateQueues.set(indexPath, run.then(() => undefined, () => undefined));
    return run;
}
function createRemoteEvolutionStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const indexQueueKey = node_path_1.default.resolve(paths.evolutionRemoteIndexPath);
    async function readIndexWithRepair() {
        await ensureRemoteEvolutionLayout(paths);
        const parsed = await readIndexFile(paths.evolutionRemoteIndexPath);
        const normalized = normalizeRemoteIndex(parsed);
        if (parsed === null || normalized.repaired) {
            await writeJsonAtomic(paths.evolutionRemoteIndexPath, normalized.index);
        }
        return normalized.index;
    }
    return {
        paths,
        async ensureLayout() {
            await ensureRemoteEvolutionLayout(paths);
            return paths;
        },
        async readIndex() {
            await getIndexQueue(indexQueueKey);
            return readIndexWithRepair();
        },
        async readArtifact(variantId) {
            await ensureRemoteEvolutionLayout(paths);
            const safeVariantId = (0, localEvolutionStore_1.validateSafeEvolutionIdentifier)(variantId, 'variantId');
            const artifactPath = node_path_1.default.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.json`);
            return readJsonFile(artifactPath);
        },
        async readSidecar(variantId) {
            await ensureRemoteEvolutionLayout(paths);
            const safeVariantId = (0, localEvolutionStore_1.validateSafeEvolutionIdentifier)(variantId, 'variantId');
            const metadataPath = node_path_1.default.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.meta.json`);
            return readJsonFile(metadataPath);
        },
        async writeImport({ artifact, sidecar }) {
            return queueIndexUpdate(indexQueueKey, async () => {
                await ensureRemoteEvolutionLayout(paths);
                const safeVariantId = (0, localEvolutionStore_1.validateSafeEvolutionIdentifier)(artifact.variantId, 'variantId');
                if (sidecar.variantId !== safeVariantId) {
                    throw new Error(`Artifact variantId (${safeVariantId}) does not match sidecar variantId (${sidecar.variantId})`);
                }
                if (sidecar.skillName !== artifact.skillName) {
                    throw new Error(`Artifact skillName (${artifact.skillName}) does not match sidecar skillName (${sidecar.skillName})`);
                }
                if (sidecar.scopeHash !== artifact.metadata.scopeHash) {
                    throw new Error(`Artifact scopeHash (${artifact.metadata.scopeHash}) does not match sidecar scopeHash (${sidecar.scopeHash})`);
                }
                const artifactPath = node_path_1.default.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.json`);
                const metadataPath = node_path_1.default.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.meta.json`);
                if (await pathExists(artifactPath) || await pathExists(metadataPath)) {
                    throw new Error(`Remote evolution artifact already imported for variantId: ${safeVariantId}`);
                }
                const currentIndex = await readIndexWithRepair();
                if (Object.prototype.hasOwnProperty.call(currentIndex.byVariantId, safeVariantId)) {
                    throw new Error(`Remote evolution artifact already imported for variantId: ${safeVariantId}`);
                }
                await writeJsonAtomic(artifactPath, artifact);
                await writeJsonAtomic(metadataPath, sidecar);
                const byVariantId = {
                    ...currentIndex.byVariantId,
                    [safeVariantId]: {
                        variantId: safeVariantId,
                        pinId: sidecar.pinId,
                    },
                };
                const nextIndex = {
                    schemaVersion: REMOTE_EVOLUTION_SCHEMA_VERSION,
                    imports: Object.keys(byVariantId).sort(),
                    byVariantId,
                };
                await writeJsonAtomic(paths.evolutionRemoteIndexPath, nextIndex);
                return {
                    artifactPath,
                    metadataPath,
                    index: nextIndex,
                };
            });
        },
    };
}
