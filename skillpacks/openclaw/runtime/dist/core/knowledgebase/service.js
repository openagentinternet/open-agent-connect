"use strict";
/**
 * Knowledge base service — learn (full/incremental rebuild), query (one KB or
 * merged across a bot's KBs), addDocument (SimpleNote-JSON wrapper with
 * provenance), importFiles. OAC port of the IDBots knowledgeBaseService on
 * the portable index store. Every learn is serialized per-KB and yields the
 * event loop between documents so the daemon never blocks.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractKbDocTitle = exports.KnowledgeBaseServiceError = void 0;
exports.slugifyKbFileName = slugifyKbFileName;
exports.buildKbDocumentJson = buildKbDocumentJson;
exports.createKnowledgeBaseService = createKnowledgeBaseService;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const store_1 = require("./store");
const indexStore_1 = require("./indexStore");
const text_1 = require("./text");
Object.defineProperty(exports, "extractKbDocTitle", { enumerable: true, get: function () { return text_1.extractKbDocTitle; } });
class KnowledgeBaseServiceError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'KnowledgeBaseServiceError';
    }
}
exports.KnowledgeBaseServiceError = KnowledgeBaseServiceError;
function slugifyKbFileName(title, content) {
    const base = title.trim().toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'document';
    return `${base}-${(0, text_1.sha256Text)(content).slice(0, 8)}.json`;
}
function buildKbDocumentJson(input) {
    const record = {
        title: input.title.trim(),
        contentType: 'text/markdown',
        content: input.content,
        // Machine provenance block; bounded and string-typed by construction.
        'x-kb-source': {
            type: input.sourceType ?? 'manual',
            ...(input.url ? { url: input.url.slice(0, 500) } : {}),
            ...(input.pinId ? { pinId: input.pinId.slice(0, 100) } : {}),
            ...(Array.isArray(input.tags) && input.tags.length
                ? { tags: input.tags.slice(0, 10).map((tag) => String(tag).slice(0, 40)) }
                : {}),
        },
    };
    return JSON.stringify(record, null, 2);
}
function createKnowledgeBaseService(paths) {
    const store = (0, store_1.createKnowledgeBaseStore)(paths);
    const learnQueues = new Map();
    // Index stores memoized per KB: the per-instance query cache (keyed by the
    // index file's mtime:size generation) then survives across calls and
    // self-invalidates when the file is rebuilt or deleted.
    const indexStores = new Map();
    const indexFor = (kbId) => {
        let index = indexStores.get(kbId);
        if (!index) {
            index = (0, indexStore_1.createKnowledgeBaseIndexStore)((0, store_1.knowledgeBaseIndexPath)(paths, kbId));
            indexStores.set(kbId, index);
        }
        return index;
    };
    function enqueueLearn(kbId, work) {
        const next = (learnQueues.get(kbId) ?? Promise.resolve()).then(work, work);
        learnQueues.set(kbId, next.catch(() => undefined));
        return next;
    }
    async function requireKb(metabotSlug, id) {
        if (id) {
            const kb = await store.getKnowledgeBase(id);
            if (!kb || kb.metabotSlug !== metabotSlug) {
                throw new KnowledgeBaseServiceError('kb_not_found', `Knowledge base ${id} not found for ${metabotSlug}.`);
            }
            return kb;
        }
        return ensureDefaultKnowledgeBase(metabotSlug);
    }
    async function ensureDefaultKnowledgeBase(metabotSlug) {
        const existing = await store.getDefaultKnowledgeBase(metabotSlug);
        if (existing)
            return existing;
        return store.createKnowledgeBase({ metabotSlug, name: 'Default' });
    }
    return {
        store,
        ensureDefaultKnowledgeBase,
        learnKnowledgeBase: async (metabotSlug, knowledgeBaseId, full) => {
            const kb = await requireKb(metabotSlug, knowledgeBaseId);
            await enqueueLearn(kb.id, async () => {
                const index = indexFor(kb.id);
                // OAC index: incremental-by-file-mtime/hash would need a merge path;
                // the corpus is local and modest, so a full rebuild per learn keeps
                // semantics identical to learn(full) — stale docs always drop.
                void full;
                await node_fs_1.promises.mkdir(kb.rawDir, { recursive: true });
                const stats = await index.rebuild(kb.rawDir, () => Date.now());
                await store.setCounts(kb.id, stats.docCount, stats.chunkCount, Date.now());
            });
            const updated = await store.getKnowledgeBase(kb.id);
            if (!updated)
                throw new KnowledgeBaseServiceError('kb_not_found', `Knowledge base ${kb.id} disappeared mid-learn.`);
            return updated;
        },
        queryKnowledgeBase: async (metabotSlug, query, options) => {
            const all = await store.listKnowledgeBases();
            const mine = all.filter((row) => row.metabotSlug === metabotSlug);
            const targets = options?.knowledgeBaseId
                ? mine.filter((row) => row.id === options.knowledgeBaseId)
                : mine;
            const results = [];
            for (const kb of targets) {
                const index = indexFor(kb.id);
                const hits = await index.query(query, {
                    ...(options?.topK != null ? { topK: options.topK } : {}),
                    ...(options?.minScore != null ? { minScore: options.minScore } : {}),
                });
                if (hits.length > 0) {
                    results.push({ knowledgeBaseId: kb.id, knowledgeBaseName: kb.name, hits });
                }
            }
            return results;
        },
        addDocument: async (metabotSlug, input) => {
            const title = input.title.trim().slice(0, 200);
            const content = (0, text_1.cleanKnowledgeBaseText)(input.content).slice(0, 2_000_000);
            if (!title || !content) {
                throw new KnowledgeBaseServiceError('fields_required', 'title and content are required.');
            }
            const kb = await requireKb(metabotSlug, input.knowledgeBaseId);
            const fileName = slugifyKbFileName(title, content);
            const relPath = node_path_1.default.join('metabot-inbox', fileName);
            await node_fs_1.promises.mkdir(node_path_1.default.join(kb.rawDir, 'metabot-inbox'), { recursive: true });
            await node_fs_1.promises.writeFile(node_path_1.default.join(kb.rawDir, relPath), buildKbDocumentJson({ ...input, title, content }), 'utf8');
            return { knowledgeBase: kb, relPath };
        },
        importFiles: async (metabotSlug, knowledgeBaseId, filePaths) => {
            const kb = await requireKb(metabotSlug, knowledgeBaseId);
            let imported = 0;
            for (const filePath of filePaths) {
                const ext = node_path_1.default.extname(filePath).toLowerCase();
                if (!text_1.SUPPORTED_KB_EXTENSIONS.has(ext))
                    continue;
                const target = node_path_1.default.join(kb.rawDir, node_path_1.default.basename(filePath));
                try {
                    await node_fs_1.promises.copyFile(filePath, target);
                    imported += 1;
                }
                catch {
                    // Individual import failures never abort the batch.
                }
            }
            return imported;
        },
    };
}
