"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SAFE_IDENTIFIER_PATTERN = void 0;
exports.parseSkillActiveVariantRef = parseSkillActiveVariantRef;
exports.validateSafeEvolutionIdentifier = validateSafeEvolutionIdentifier;
exports.createLocalEvolutionStore = createLocalEvolutionStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const EVOLUTION_SCHEMA_VERSION = 1;
exports.SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const KNOWN_INDEX_KEYS = new Set([
    'schemaVersion',
    'executions',
    'analyses',
    'artifacts',
    'activeVariants',
]);
let atomicWriteSequence = 0;
const indexUpdateQueues = new Map();
function createEmptyIndex() {
    return {
        schemaVersion: EVOLUTION_SCHEMA_VERSION,
        executions: [],
        analyses: [],
        artifacts: [],
        activeVariants: {},
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function normalizeStringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return [...new Set(value.filter((item) => typeof item === 'string'))].sort();
}
function compareCodePointStrings(left, right) {
    if (left < right) {
        return -1;
    }
    if (left > right) {
        return 1;
    }
    return 0;
}
function normalizeSafeIdentifier(identifier, fieldName) {
    if (typeof identifier !== 'string') {
        return null;
    }
    try {
        return validateSafeEvolutionIdentifier(identifier, fieldName);
    }
    catch {
        return null;
    }
}
function normalizeActiveVariantSource(value) {
    if (value === 'local' || value === 'remote') {
        return value;
    }
    return null;
}
function parseSkillActiveVariantRef(value) {
    if (typeof value === 'string') {
        const safeVariantId = normalizeSafeIdentifier(value, 'variantId');
        if (!safeVariantId) {
            return null;
        }
        return {
            source: 'local',
            variantId: safeVariantId,
        };
    }
    if (!isRecord(value)) {
        return null;
    }
    const source = normalizeActiveVariantSource(value.source);
    const safeVariantId = normalizeSafeIdentifier(value.variantId, 'variantId');
    if (!source || !safeVariantId) {
        return null;
    }
    return {
        source,
        variantId: safeVariantId,
    };
}
function normalizeActiveVariants(value) {
    if (!isRecord(value)) {
        return {};
    }
    const entries = [];
    for (const [skillName, refValue] of Object.entries(value)) {
        const safeSkillName = normalizeSafeIdentifier(skillName, 'skillName');
        const normalizedRef = parseSkillActiveVariantRef(refValue);
        if (safeSkillName && normalizedRef) {
            entries.push([safeSkillName, normalizedRef]);
        }
    }
    return Object.fromEntries(entries.sort(([left], [right]) => compareCodePointStrings(left, right)));
}
function normalizeIndex(value) {
    if (!isRecord(value)) {
        return createEmptyIndex();
    }
    const preservedUnknownFields = {};
    for (const [key, fieldValue] of Object.entries(value)) {
        if (!KNOWN_INDEX_KEYS.has(key)) {
            preservedUnknownFields[key] = fieldValue;
        }
    }
    return {
        ...preservedUnknownFields,
        schemaVersion: EVOLUTION_SCHEMA_VERSION,
        executions: normalizeStringList(value.executions),
        analyses: normalizeStringList(value.analyses),
        artifacts: normalizeStringList(value.artifacts),
        activeVariants: normalizeActiveVariants(value.activeVariants),
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
function addIdentifier(values, identifier) {
    return normalizeStringList([...values, identifier]);
}
async function ensureEvolutionLayout(paths) {
    await node_fs_1.promises.mkdir(paths.evolutionExecutionsRoot, { recursive: true });
    await node_fs_1.promises.mkdir(paths.evolutionAnalysesRoot, { recursive: true });
    await node_fs_1.promises.mkdir(paths.evolutionArtifactsRoot, { recursive: true });
}
function validateSafeEvolutionIdentifier(identifier, fieldName) {
    if (!identifier
        || identifier === '.'
        || identifier === '..'
        || node_path_1.default.isAbsolute(identifier)
        || !exports.SAFE_IDENTIFIER_PATTERN.test(identifier)) {
        throw new Error(`Invalid ${fieldName}: ${identifier}`);
    }
    return identifier;
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
function createLocalEvolutionStore(homeDirOrPaths) {
    const paths = typeof homeDirOrPaths === 'string' ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths) : homeDirOrPaths;
    const indexQueueKey = node_path_1.default.resolve(paths.evolutionIndexPath);
    async function updateIndex(updater) {
        return queueIndexUpdate(indexQueueKey, async () => {
            await ensureEvolutionLayout(paths);
            const current = normalizeIndex(await readIndexFile(paths.evolutionIndexPath));
            const next = normalizeIndex(updater(current));
            await writeJsonAtomic(paths.evolutionIndexPath, next);
            return next;
        });
    }
    return {
        paths,
        async ensureLayout() {
            await ensureEvolutionLayout(paths);
            return paths;
        },
        async readIndex() {
            await getIndexQueue(indexQueueKey);
            await ensureEvolutionLayout(paths);
            return normalizeIndex(await readIndexFile(paths.evolutionIndexPath));
        },
        async readArtifact(variantId) {
            await ensureEvolutionLayout(paths);
            const safeVariantId = validateSafeEvolutionIdentifier(variantId, 'variantId');
            const filePath = node_path_1.default.join(paths.evolutionArtifactsRoot, `${safeVariantId}.json`);
            return readJsonFile(filePath);
        },
        async readAnalysis(analysisId) {
            await ensureEvolutionLayout(paths);
            const safeAnalysisId = validateSafeEvolutionIdentifier(analysisId, 'analysisId');
            const filePath = node_path_1.default.join(paths.evolutionAnalysesRoot, `${safeAnalysisId}.json`);
            return readJsonFile(filePath);
        },
        async writeExecution(record) {
            await ensureEvolutionLayout(paths);
            const executionId = validateSafeEvolutionIdentifier(record.executionId, 'executionId');
            const filePath = node_path_1.default.join(paths.evolutionExecutionsRoot, `${executionId}.json`);
            await writeJsonAtomic(filePath, record);
            await updateIndex((current) => ({
                ...current,
                executions: addIdentifier(current.executions, executionId),
            }));
            return filePath;
        },
        async writeAnalysis(record) {
            await ensureEvolutionLayout(paths);
            const analysisId = validateSafeEvolutionIdentifier(record.analysisId, 'analysisId');
            const filePath = node_path_1.default.join(paths.evolutionAnalysesRoot, `${analysisId}.json`);
            await writeJsonAtomic(filePath, record);
            await updateIndex((current) => ({
                ...current,
                analyses: addIdentifier(current.analyses, analysisId),
            }));
            return filePath;
        },
        async writeArtifact(record) {
            await ensureEvolutionLayout(paths);
            const variantId = validateSafeEvolutionIdentifier(record.variantId, 'variantId');
            const filePath = node_path_1.default.join(paths.evolutionArtifactsRoot, `${variantId}.json`);
            await writeJsonAtomic(filePath, record);
            await updateIndex((current) => ({
                ...current,
                artifacts: addIdentifier(current.artifacts, variantId),
            }));
            return filePath;
        },
        async setActiveVariantRef(skillName, ref) {
            const safeSkillName = validateSafeEvolutionIdentifier(skillName, 'skillName');
            const safeVariantId = validateSafeEvolutionIdentifier(ref.variantId, 'variantId');
            const safeSource = normalizeActiveVariantSource(ref.source);
            if (!safeSource) {
                throw new Error(`Invalid source: ${String(ref.source)}`);
            }
            return updateIndex((current) => ({
                ...current,
                activeVariants: normalizeActiveVariants({
                    ...current.activeVariants,
                    [safeSkillName]: {
                        source: safeSource,
                        variantId: safeVariantId,
                    },
                }),
            }));
        },
        async setActiveVariant(skillName, variantId) {
            return this.setActiveVariantRef(skillName, {
                source: 'local',
                variantId,
            });
        },
        async clearActiveVariant(skillName) {
            const safeSkillName = validateSafeEvolutionIdentifier(skillName, 'skillName');
            return updateIndex((current) => {
                const activeVariants = { ...current.activeVariants };
                delete activeVariants[safeSkillName];
                return {
                    ...current,
                    activeVariants: normalizeActiveVariants(activeVariants),
                };
            });
        },
    };
}
