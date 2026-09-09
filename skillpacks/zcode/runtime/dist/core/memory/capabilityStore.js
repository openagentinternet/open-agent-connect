"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCapabilityStore = createCapabilityStore;
// L3b capability drafts (`.runtime/memory/capability-drafts.json`) — the
// file-port counterpart of IDBots' `capability_drafts` table (SDD §4.1).
// Every dream may distill up to MAX_CAPABILITY_LEARNINGS reusable
// skill/workflow/tool-pattern candidates; each lands here as an append-only
// status 'draft' row. Promotion into real skills is a later phase and nothing
// in this store ever touches the skill tables. Re-dreams append rather than
// replace (IDBots semantics — drafts carry no per-date batch contract).
// Writes follow the store conventions: atomic write-then-rename, serialized
// through the per-store write queue.
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
let atomicWriteSequence = 0;
function normalizeDraft(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    if (typeof record.title !== 'string' || !record.title.trim())
        return null;
    if (typeof record.description !== 'string' || !record.description.trim())
        return null;
    const rawType = typeof record.capabilityType === 'string' ? record.capabilityType.trim() : '';
    const capabilityType = rawType === 'workflow'
        ? 'workflow'
        : rawType === 'tool_pattern'
            ? 'tool_pattern'
            : 'skill';
    return {
        id: typeof record.id === 'string' && record.id ? record.id : `cap_${(0, node_crypto_1.randomUUID)()}`,
        dreamDate: typeof record.dreamDate === 'string' && record.dreamDate ? record.dreamDate : '',
        title: record.title.trim(),
        description: record.description.trim(),
        capabilityType,
        sourceSessionIds: Array.isArray(record.sourceSessionIds)
            ? [...new Set(record.sourceSessionIds
                    .filter((id) => typeof id === 'string')
                    .map((id) => id.trim())
                    .filter(Boolean))]
            : [],
        status: 'draft',
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
            ? record.createdAt
            : 0,
    };
}
function normalizeFile(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return { version: 1, drafts: [] };
    }
    const record = value;
    const drafts = Array.isArray(record.drafts)
        ? record.drafts
            .map((entry) => normalizeDraft(entry))
            .filter((entry) => entry !== null)
        : [];
    return { version: 1, drafts };
}
function createCapabilityStore(paths) {
    const filePath = paths.memoryCapabilityDraftsPath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function readFile() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            return normalizeFile(JSON.parse(raw));
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return { version: 1, drafts: [] };
            }
            throw error;
        }
    }
    async function writeFile(next) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        atomicWriteSequence += 1;
        const tempPath = `${filePath}.${process.pid}.${Date.now()}.${atomicWriteSequence}.tmp`;
        try {
            await node_fs_1.promises.writeFile(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
            await node_fs_1.promises.rename(tempPath, filePath);
        }
        catch (error) {
            await node_fs_1.promises.rm(tempPath, { force: true }).catch(() => undefined);
            throw error;
        }
    }
    return {
        async insertDrafts(date, learnings) {
            const now = Date.now();
            const additions = [];
            for (const learning of Array.isArray(learnings) ? learnings : []) {
                const draft = normalizeDraft({
                    title: learning?.title,
                    description: learning?.description,
                    capabilityType: learning?.capabilityType,
                    sourceSessionIds: learning?.sourceSessionIds,
                });
                if (!draft)
                    continue;
                additions.push({ ...draft, dreamDate: date, status: 'draft', createdAt: now });
            }
            if (additions.length > 0) {
                await enqueue(async () => {
                    const file = await readFile();
                    file.drafts.push(...additions);
                    await writeFile(file);
                });
            }
            return additions.length;
        },
        async listDrafts(options = {}) {
            const limit = typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
                ? Math.floor(options.limit)
                : null;
            const drafts = (await readFile()).drafts
                .sort((left, right) => right.createdAt - left.createdAt);
            return limit !== null ? drafts.slice(0, limit) : drafts;
        },
    };
}
