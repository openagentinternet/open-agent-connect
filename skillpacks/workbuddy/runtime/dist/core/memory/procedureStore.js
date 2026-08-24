"use strict";
/**
 * Procedure memory (IDBots M3 parity) — repeatable workflows living between
 * knowledge points (single facts) and skills (code). A procedure is a titled,
 * fingerprint-deduped list of steps + pitfalls with use tracking; recall
 * scores by tokenized term coverage (multi-keyword and colloquial CJK
 * bigram matching). OAC port onto a file-backed store in the workspace
 * memory layer, sibling to the knowledge points store.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProcedureStoreError = void 0;
exports.procedureTitleFingerprint = procedureTitleFingerprint;
exports.scoreProceduresForQuery = scoreProceduresForQuery;
exports.createProcedureStore = createProcedureStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
class ProcedureStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'ProcedureStoreError';
    }
}
exports.ProcedureStoreError = ProcedureStoreError;
/** sha256 of the normalized title — the same-title rewrite key. */
function procedureTitleFingerprint(title) {
    return (0, node_crypto_1.createHash)('sha256')
        .update(String(title ?? '').toLowerCase().replace(/\s+/gu, ' ').trim(), 'utf8')
        .digest('hex');
}
function cjkBigramsOf(text) {
    const out = [];
    const runs = String(text || '').toLowerCase().match(/[一-鿿]+/g) || [];
    for (const run of runs) {
        const chars = Array.from(run);
        for (let idx = 0; idx < chars.length - 1; idx += 1) {
            out.push(`${chars[idx]}${chars[idx + 1]}`);
        }
    }
    return out;
}
function latinTokensOf(text) {
    return String(text || '').toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}
/**
 * Tokenized term-coverage matching: a procedure scores when the query terms
 * appear in its title/trigger/tags/steps. CJK bigrams give colloquial
 * multi-keyword matching; isolated single CJK chars match titles only.
 */
function scoreProceduresForQuery(procedures, query) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q)
        return [];
    const latin = [...new Set(latinTokensOf(q))];
    const bigrams = [...new Set(cjkBigramsOf(q))];
    const singles = [...new Set((q.match(/[一-鿿]/gu) ?? []).filter((ch) => !bigrams.some((bg) => bg.includes(ch))))];
    const scored = [];
    for (const procedure of procedures) {
        if (procedure.status !== 'active')
            continue;
        const titleText = `${procedure.title} ${procedure.triggerText} ${procedure.tags.join(' ')} ${procedure.steps.join(' ')}`.toLowerCase();
        let coverage = 0;
        let total = 0;
        for (const token of latin) {
            total += 1;
            if (titleText.includes(token))
                coverage += 1;
        }
        for (const bg of bigrams) {
            total += 1;
            if (titleText.includes(bg))
                coverage += 1;
        }
        for (const ch of singles) {
            total += 1;
            if (procedure.title.toLowerCase().includes(ch))
                coverage += 1;
        }
        if (total > 0 && coverage > 0) {
            scored.push({ procedure, score: Number((coverage / total).toFixed(4)) });
        }
    }
    return scored.sort((left, right) => right.score - left.score
        || (right.procedure.useCount || 0) - (left.procedure.useCount || 0));
}
function normalizeProcedure(value) {
    if (!value || typeof value !== 'object')
        return null;
    const row = value;
    if (typeof row.title !== 'string' || !row.title.trim())
        return null;
    const toList = (input, cap = 40) => (Array.isArray(input)
        ? input.map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, cap)
        : []);
    const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : `proc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    return {
        id,
        title: row.title.trim().slice(0, 200),
        titleFingerprint: typeof row.titleFingerprint === 'string' && row.titleFingerprint
            ? row.titleFingerprint
            : procedureTitleFingerprint(row.title),
        steps: toList(row.steps),
        pitfalls: toList(row.pitfalls),
        triggerText: typeof row.triggerText === 'string' ? row.triggerText.slice(0, 400) : '',
        sourcePinIds: toList(row.sourcePinIds, 20),
        category: typeof row.category === 'string' && row.category.trim() ? row.category.trim() : null,
        tags: toList(row.tags, 20),
        confidence: Number.isFinite(Number(row.confidence)) ? Math.max(0, Math.min(1, Number(row.confidence))) : 0.5,
        status: row.status === 'archived' ? 'archived' : 'active',
        origin: row.origin === 'dream' || row.origin === 'owner' ? row.origin : 'agent',
        useCount: Math.max(0, Math.trunc(Number(row.useCount)) || 0),
        lastUsedAt: Number.isFinite(Number(row.lastUsedAt)) ? Number(row.lastUsedAt) : null,
        version: Math.max(1, Math.trunc(Number(row.version)) || 1),
        createdAt: Number.isFinite(Number(row.createdAt)) ? Number(row.createdAt) : now,
        updatedAt: Number.isFinite(Number(row.updatedAt)) ? Number(row.updatedAt) : now,
    };
}
function createProcedureStore(paths) {
    const filePath = node_path_1.default.join(paths.workspaceRoot, 'memory', 'procedures.json');
    let queue = Promise.resolve();
    const enqueue = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    };
    async function readFile() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return {
                seq: Number.isInteger(parsed?.seq) ? parsed.seq : 0,
                procedures: Array.isArray(parsed?.procedures)
                    ? parsed.procedures.map(normalizeProcedure).filter((row) => row !== null)
                    : [],
            };
        }
        catch {
            return { seq: 0, procedures: [] };
        }
    }
    async function writeFile(state) {
        await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
        const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
        await node_fs_1.promises.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf8');
        await node_fs_1.promises.rename(tmpPath, filePath);
    }
    return {
        upsertProcedure: (input) => enqueue(async () => {
            const title = input.title.trim();
            if (!title)
                throw new ProcedureStoreError('title_required', 'Procedure title is required.');
            const steps = (input.steps ?? []).map((step) => String(step ?? '').trim().slice(0, 500)).filter(Boolean);
            if (!steps.length)
                throw new ProcedureStoreError('steps_required', 'At least one step is required.');
            const state = await readFile();
            const fingerprint = procedureTitleFingerprint(title);
            const existing = state.procedures.find((row) => row.titleFingerprint === fingerprint);
            const now = Date.now();
            if (existing) {
                // Same title rewrites with a version bump (IDBots semantics).
                existing.title = title;
                existing.steps = steps.slice(0, 40).map((step) => step.slice(0, 500));
                existing.pitfalls = (input.pitfalls ?? []).map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 40);
                existing.triggerText = (input.triggerText ?? existing.triggerText).slice(0, 400);
                existing.sourcePinIds = (input.sourcePinIds ?? existing.sourcePinIds).slice(0, 20);
                existing.category = input.category?.trim() || existing.category;
                existing.tags = (input.tags ?? existing.tags).slice(0, 20);
                if (input.confidence != null)
                    existing.confidence = Math.max(0, Math.min(1, input.confidence));
                existing.origin = input.origin ?? existing.origin;
                existing.status = 'active';
                existing.version += 1;
                existing.updatedAt = now;
                await writeFile(state);
                return { procedure: existing, created: false };
            }
            const record = {
                id: `proc-${state.seq + 1}-${Math.random().toString(36).slice(2, 8)}`,
                title,
                titleFingerprint: fingerprint,
                steps: steps.slice(0, 40).map((step) => step.slice(0, 500)),
                pitfalls: (input.pitfalls ?? []).map((item) => String(item ?? '').trim()).filter(Boolean).slice(0, 40),
                triggerText: (input.triggerText ?? '').slice(0, 400),
                sourcePinIds: (input.sourcePinIds ?? []).slice(0, 20),
                category: input.category?.trim() || null,
                tags: (input.tags ?? []).slice(0, 20),
                confidence: input.confidence != null ? Math.max(0, Math.min(1, input.confidence)) : 0.5,
                status: 'active',
                origin: input.origin ?? 'agent',
                useCount: 0,
                lastUsedAt: null,
                version: 1,
                createdAt: now,
                updatedAt: now,
            };
            state.seq += 1;
            state.procedures.push(record);
            await writeFile(state);
            return { procedure: record, created: true };
        }),
        listProcedures: async (options) => {
            const state = await readFile();
            const rows = [...state.procedures].sort((left, right) => right.updatedAt - left.updatedAt);
            return options?.status ? rows.filter((row) => row.status === options.status) : rows;
        },
        archiveProcedureByTitle: (title) => enqueue(async () => {
            const state = await readFile();
            const fingerprint = procedureTitleFingerprint(title);
            const row = state.procedures.find((entry) => entry.titleFingerprint === fingerprint);
            if (!row)
                return null;
            row.status = 'archived';
            row.updatedAt = Date.now();
            await writeFile(state);
            return row;
        }),
        touchUsed: (id) => enqueue(async () => {
            const state = await readFile();
            const row = state.procedures.find((entry) => entry.id === id);
            if (!row)
                return;
            row.useCount += 1;
            row.lastUsedAt = Date.now();
            await writeFile(state);
        }),
    };
}
