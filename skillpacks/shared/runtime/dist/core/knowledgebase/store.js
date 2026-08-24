"use strict";
/**
 * Knowledge base registry — per-bot document corpora. OAC port of the IDBots
 * knowledgeBaseStore, adapted to the storage layout v2 file conventions:
 *   registry:  <workspace>/memory/knowledge-bases.json
 *   raw docs:  <workspace>/memory/knowledge-bases/<kbId>/raw/**
 *   derived:   <runtime>/knowledge-bases/<kbId>/index.json
 * Derived data is rebuildable from the raw corpus at any time (learn --full).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KnowledgeBaseStoreError = void 0;
exports.createKnowledgeBaseStore = createKnowledgeBaseStore;
exports.knowledgeBaseIndexPath = knowledgeBaseIndexPath;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
class KnowledgeBaseStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'KnowledgeBaseStoreError';
    }
}
exports.KnowledgeBaseStoreError = KnowledgeBaseStoreError;
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch (error) {
        if (error.code === 'ENOENT')
            return null;
        if (error instanceof SyntaxError)
            return null;
        throw error;
    }
}
async function writeJsonFileAtomic(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await node_fs_1.promises.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await node_fs_1.promises.rename(tmpPath, filePath);
}
function kbIdFor(name) {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
    return slug || 'default';
}
function createKnowledgeBaseStore(paths) {
    const registryPath = node_path_1.default.join(paths.workspaceRoot, 'memory', 'knowledge-bases.json');
    const rootDir = node_path_1.default.join(paths.workspaceRoot, 'memory', 'knowledge-bases');
    let queue = Promise.resolve();
    const enqueue = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    };
    async function readRegistry() {
        const parsed = await readJsonFile(registryPath);
        if (!parsed || typeof parsed !== 'object')
            return { seq: 0, bases: [] };
        return {
            seq: Number.isInteger(parsed.seq) && parsed.seq >= 0 ? parsed.seq : 0,
            bases: Array.isArray(parsed.bases)
                ? parsed.bases.filter((row) => row && typeof row === 'object' && typeof row.id === 'string')
                : [],
        };
    }
    async function writeRegistry(state) {
        await writeJsonFileAtomic(registryPath, state);
    }
    function normalizeRecord(row) {
        return {
            id: String(row.id ?? ''),
            metabotSlug: String(row.metabotSlug ?? ''),
            name: String(row.name ?? ''),
            description: String(row.description ?? ''),
            rawDir: String(row.rawDir ?? ''),
            isDefault: row.isDefault === true,
            autoLearn: row.autoLearn !== false,
            docCount: Number(row.docCount) || 0,
            chunkCount: Number(row.chunkCount) || 0,
            lastLearnedAt: typeof row.lastLearnedAt === 'number' ? row.lastLearnedAt : null,
            lastAutoLearnDate: typeof row.lastAutoLearnDate === 'string' ? row.lastAutoLearnDate : null,
            createdAt: Number(row.createdAt) || Date.now(),
            updatedAt: Number(row.updatedAt) || Date.now(),
        };
    }
    return {
        registryPath,
        listKnowledgeBases: async () => {
            const state = await readRegistry();
            return state.bases.map(normalizeRecord).sort((left, right) => right.updatedAt - left.updatedAt);
        },
        getKnowledgeBase: async (id) => {
            const state = await readRegistry();
            const row = state.bases.find((entry) => entry.id === id);
            return row ? normalizeRecord(row) : null;
        },
        getDefaultKnowledgeBase: async (metabotSlug) => {
            const state = await readRegistry();
            const row = state.bases.find((entry) => entry.metabotSlug === metabotSlug && entry.isDefault)
                ?? state.bases.find((entry) => entry.metabotSlug === metabotSlug);
            return row ? normalizeRecord(row) : null;
        },
        createKnowledgeBase: (input) => enqueue(async () => {
            const state = await readRegistry();
            const name = input.name.trim();
            if (!name)
                throw new KnowledgeBaseStoreError('name_required', 'Knowledge base name is required.');
            let id = kbIdFor(name);
            if (state.bases.some((entry) => entry.id === id && entry.metabotSlug === input.metabotSlug)) {
                id = `${id}-${Date.now().toString(36).slice(-4)}`;
            }
            // First KB of a bot becomes its default automatically.
            const isDefault = input.isDefault
                || !state.bases.some((entry) => entry.metabotSlug === input.metabotSlug);
            const now = Date.now();
            const record = {
                id,
                metabotSlug: input.metabotSlug,
                name,
                description: (input.description ?? '').trim(),
                rawDir: input.rawDir?.trim() || node_path_1.default.join(rootDir, id, 'raw'),
                isDefault,
                autoLearn: input.autoLearn ?? true,
                docCount: 0,
                chunkCount: 0,
                lastLearnedAt: null,
                lastAutoLearnDate: null,
                createdAt: now,
                updatedAt: now,
            };
            await node_fs_1.promises.mkdir(record.rawDir, { recursive: true });
            state.seq += 1;
            state.bases.push(record);
            await writeRegistry(state);
            return record;
        }),
        updateKnowledgeBase: (id, patch) => enqueue(async () => {
            const state = await readRegistry();
            const row = state.bases.find((entry) => entry.id === id);
            if (!row)
                throw new KnowledgeBaseStoreError('not_found', `Knowledge base ${id} not found.`);
            if (patch.name != null && patch.name.trim())
                row.name = patch.name.trim();
            if (patch.description != null)
                row.description = patch.description.trim();
            if (patch.autoLearn != null)
                row.autoLearn = patch.autoLearn;
            row.updatedAt = Date.now();
            await writeRegistry(state);
            return normalizeRecord(row);
        }),
        removeKnowledgeBase: (id) => enqueue(async () => {
            const state = await readRegistry();
            const before = state.bases.length;
            state.bases = state.bases.filter((entry) => entry.id !== id);
            if (state.bases.length === before)
                return false;
            await writeRegistry(state);
            return true;
        }),
        setCounts: (id, docCount, chunkCount, learnedAt) => enqueue(async () => {
            const state = await readRegistry();
            const row = state.bases.find((entry) => entry.id === id);
            if (!row)
                return;
            row.docCount = docCount;
            row.chunkCount = chunkCount;
            row.lastLearnedAt = learnedAt;
            row.updatedAt = Date.now();
            await writeRegistry(state);
        }),
        markAutoLearned: (id, dateIso) => enqueue(async () => {
            const state = await readRegistry();
            const row = state.bases.find((entry) => entry.id === id);
            if (!row)
                return;
            row.lastAutoLearnDate = dateIso;
            row.updatedAt = Date.now();
            await writeRegistry(state);
        }),
        listDueForAutoLearn: async (now) => {
            const state = await readRegistry();
            const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            const hour = now.getHours();
            return state.bases
                .map(normalizeRecord)
                .filter((row) => row.autoLearn
                && row.lastAutoLearnDate !== today
                && hour >= 0 && hour < 6);
        },
    };
}
/** Resolve the derived index path for one KB (runtime layer, rebuildable). */
function knowledgeBaseIndexPath(paths, kbId) {
    return node_path_1.default.join(paths.runtimeRoot, 'knowledge-bases', kbId, 'index.json');
}
