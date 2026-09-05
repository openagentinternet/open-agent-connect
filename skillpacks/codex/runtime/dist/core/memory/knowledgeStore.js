"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KNOWLEDGE_ORIGINS = exports.KNOWLEDGE_KINDS = void 0;
exports.topicFingerprintOf = topicFingerprintOf;
exports.createKnowledgeStore = createKnowledgeStore;
// Knowledge-point anchored memory ("经验/知识点"), ported from IDBots
// src/main/metaidKnowledgeStore.ts onto `.runtime/memory/knowledge.json`.
// Entries are upserted by topic fingerprint: rewriting an existing topic
// bumps its version and records the prior text as a revision. Writes come
// from the nightly dream consolidation (origin='dream') and from the bot at
// runtime via the knowledge_upsert tool (origin='agent').
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.KNOWLEDGE_KINDS = ['know_how', 'pitfall', 'principle'];
exports.KNOWLEDGE_ORIGINS = ['agent', 'dream', 'user'];
const MAX_TOPIC = 300;
const MAX_SUMMARY = 4_000;
const MAX_CATEGORY = 120;
const MAX_RELEVANCE = 500;
const MAX_TAGS = 12;
const MAX_TAG_LEN = 80;
const MAX_SOURCES = 50;
let atomicWriteSequence = 0;
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
function boundedRequiredText(value, label, maxLength) {
    const result = asText(value);
    if (!result)
        throw new Error(`${label} is required`);
    if (result.length > maxLength)
        throw new Error(`${label} exceeds ${maxLength} characters`);
    return result;
}
function boundedOptionalText(value, label, maxLength) {
    const result = asText(value);
    if (!result)
        return null;
    if (result.length > maxLength)
        throw new Error(`${label} exceeds ${maxLength} characters`);
    return result;
}
function normalizeKind(value) {
    return exports.KNOWLEDGE_KINDS.includes(String(value)) ? value : 'know_how';
}
function normalizeOrigin(value) {
    return exports.KNOWLEDGE_ORIGINS.includes(String(value)) ? value : 'agent';
}
function normalizeStatus(value) {
    return value === 'superseded' || value === 'archived' ? value : 'active';
}
function normalizeConfidence(value) {
    const parsed = Number(value);
    return Math.min(1, Math.max(0, Number.isFinite(parsed) ? parsed : 0.75));
}
function normalizeTags(value) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const result = [];
    for (const raw of value) {
        const tag = asText(raw).slice(0, MAX_TAG_LEN);
        if (!tag || seen.has(tag.toLowerCase()))
            continue;
        seen.add(tag.toLowerCase());
        result.push(tag);
        if (result.length >= MAX_TAGS)
            break;
    }
    return result;
}
function normalizeTopicKey(topic) {
    return topic.trim().replace(/\s+/g, ' ').toLowerCase();
}
function topicFingerprintOf(topic) {
    return node_crypto_1.default.createHash('sha256').update(normalizeTopicKey(topic), 'utf8').digest('hex');
}
function normalizeDreamDate(value) {
    const date = asText(value);
    if (!date)
        return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error('sourceDreamDate must be a valid YYYY-MM-DD date');
    }
    return date;
}
function normalizeSources(value) {
    if (!Array.isArray(value))
        return [];
    const result = [];
    for (const raw of value) {
        if (!raw || typeof raw !== 'object')
            continue;
        const source = raw;
        const episodeId = asText(source.episodeId) || null;
        const evidenceId = asText(source.evidenceId) || null;
        const sessionId = asText(source.sessionId) || null;
        if (!episodeId && !evidenceId && !sessionId)
            continue;
        result.push({
            episodeId,
            evidenceId,
            sessionId,
            sourceChannel: boundedOptionalText(source.sourceChannel, 'sourceChannel', 120),
            relevance: boundedOptionalText(source.relevance, 'relevance', MAX_RELEVANCE),
        });
        if (result.length >= MAX_SOURCES)
            break;
    }
    return result;
}
function normalizeSourceRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = asText(record.id);
    if (!id)
        return null;
    return {
        id,
        episodeId: asText(record.episodeId) || null,
        evidenceId: asText(record.evidenceId) || null,
        sessionId: asText(record.sessionId) || null,
        sourceChannel: asText(record.sourceChannel) || null,
        relevance: asText(record.relevance) || null,
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    };
}
function normalizeRevisionRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = asText(record.id);
    if (!id)
        return null;
    return {
        id,
        version: Math.max(1, Math.floor(Number(record.version) || 1)),
        summary: typeof record.summary === 'string' ? record.summary : '',
        kind: normalizeKind(record.kind),
        origin: normalizeOrigin(record.origin),
        sourceDreamDate: asText(record.sourceDreamDate) || null,
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    };
}
function normalizeEntry(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = asText(record.id);
    const topic = typeof record.topic === 'string' ? record.topic : '';
    if (!id || !topic.trim())
        return null;
    return {
        id,
        topic,
        topicFingerprint: asText(record.topicFingerprint) || topicFingerprintOf(topic),
        summary: typeof record.summary === 'string' ? record.summary : '',
        kind: normalizeKind(record.kind),
        category: asText(record.category) || null,
        tags: normalizeTags(record.tags),
        confidence: normalizeConfidence(record.confidence),
        status: normalizeStatus(record.status),
        origin: normalizeOrigin(record.origin),
        sourceDreamDate: asText(record.sourceDreamDate) || null,
        version: Math.max(1, Math.floor(Number(record.version) || 1)),
        sources: Array.isArray(record.sources)
            ? record.sources.map(normalizeSourceRecord).filter((source) => source !== null)
            : [],
        revisions: Array.isArray(record.revisions)
            ? record.revisions.map(normalizeRevisionRecord).filter((revision) => revision !== null)
            : [],
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
        updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt) ? record.updatedAt : 0,
        lastUsedAt: typeof record.lastUsedAt === 'number' && Number.isFinite(record.lastUsedAt) ? record.lastUsedAt : null,
    };
}
function createKnowledgeStore(paths) {
    const filePath = paths.memoryKnowledgePath;
    let writeQueue = Promise.resolve();
    function enqueue(task) {
        const run = writeQueue.then(task, task);
        writeQueue = run.catch(() => undefined);
        return run;
    }
    async function readFile() {
        try {
            const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return { version: 1, entries: [] };
            const entries = Array.isArray(parsed.entries)
                ? parsed.entries
                    .map(normalizeEntry)
                    .filter((entry) => entry !== null)
                : [];
            return { version: 1, entries };
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { version: 1, entries: [] };
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
    function toSources(inputs, now) {
        return inputs.map((input) => ({
            id: `ks_${node_crypto_1.default.randomUUID()}`,
            episodeId: input.episodeId ?? null,
            evidenceId: input.evidenceId ?? null,
            sessionId: input.sessionId ?? null,
            sourceChannel: input.sourceChannel ?? null,
            relevance: input.relevance ?? null,
            createdAt: now,
        }));
    }
    function archiveRevision(entry, now) {
        entry.revisions.push({
            id: `kr_${node_crypto_1.default.randomUUID()}`,
            version: entry.version,
            summary: entry.summary,
            kind: entry.kind,
            origin: entry.origin,
            sourceDreamDate: entry.sourceDreamDate,
            createdAt: entry.updatedAt || now,
        });
    }
    return {
        async getKnowledge(id) {
            const file = await readFile();
            return file.entries.find((entry) => entry.id === asText(id)) ?? null;
        },
        async upsertKnowledge(input) {
            return enqueue(async () => {
                const topic = boundedRequiredText(input.topic, 'topic', MAX_TOPIC);
                const summary = boundedRequiredText(input.summary, 'summary', MAX_SUMMARY);
                const kind = normalizeKind(input.kind);
                const category = boundedOptionalText(input.category, 'category', MAX_CATEGORY);
                const tags = normalizeTags(input.tags);
                const confidence = normalizeConfidence(input.confidence);
                const origin = normalizeOrigin(input.origin);
                const sourceDreamDate = normalizeDreamDate(input.sourceDreamDate);
                const sources = normalizeSources(input.sources);
                const topicFingerprint = asText(input.topicFingerprint) || topicFingerprintOf(topic);
                const now = Date.now();
                const file = await readFile();
                const existing = file.entries.find((entry) => entry.topicFingerprint === topicFingerprint);
                if (!existing) {
                    const entry = {
                        id: asText(input.id) || `kn_${node_crypto_1.default.randomUUID()}`,
                        topic,
                        topicFingerprint,
                        summary,
                        kind,
                        category,
                        tags,
                        confidence,
                        status: 'active',
                        origin,
                        sourceDreamDate,
                        version: 1,
                        sources: toSources(sources, now),
                        revisions: [],
                        createdAt: now,
                        updatedAt: now,
                        lastUsedAt: null,
                    };
                    file.entries.push(entry);
                    await writeFile(file);
                    return { entry, created: true, revised: false };
                }
                // No-op rewrite (same topic, same summary, same kind) avoids fake revisions.
                const sameContent = existing.summary === summary
                    && existing.kind === kind
                    && (existing.category ?? null) === (category ?? null);
                if (sameContent) {
                    return { entry: existing, created: false, revised: false };
                }
                archiveRevision(existing, now);
                existing.topic = topic;
                existing.summary = summary;
                existing.kind = kind;
                existing.category = category;
                existing.tags = tags;
                existing.confidence = confidence;
                existing.status = 'active';
                existing.origin = origin;
                existing.sourceDreamDate = sourceDreamDate;
                existing.version += 1;
                existing.updatedAt = now;
                // Dream and agent rewrites restate the point's sources from their own
                // evidence view; replace the prior pointer set rather than stacking.
                existing.sources = toSources(sources, now);
                await writeFile(file);
                return { entry: existing, created: false, revised: true };
            });
        },
        async updateKnowledge(input) {
            return enqueue(async () => {
                const file = await readFile();
                const existing = file.entries.find((entry) => entry.id === asText(input.id));
                if (!existing)
                    return null;
                const nextTopic = input.topic !== undefined ? boundedRequiredText(input.topic, 'topic', MAX_TOPIC) : existing.topic;
                const nextSummary = input.summary !== undefined ? boundedRequiredText(input.summary, 'summary', MAX_SUMMARY) : existing.summary;
                const nextKind = input.kind !== undefined ? normalizeKind(input.kind) : existing.kind;
                if (nextTopic === existing.topic && nextSummary === existing.summary && nextKind === existing.kind) {
                    return existing;
                }
                const now = Date.now();
                archiveRevision(existing, now);
                existing.topic = nextTopic;
                existing.topicFingerprint = topicFingerprintOf(nextTopic);
                existing.summary = nextSummary;
                existing.kind = nextKind;
                existing.status = 'active';
                existing.version += 1;
                existing.updatedAt = now;
                await writeFile(file);
                return existing;
            });
        },
        async archiveKnowledge(id) {
            return enqueue(async () => {
                const file = await readFile();
                const existing = file.entries.find((entry) => entry.id === asText(id));
                if (!existing)
                    return null;
                existing.status = 'archived';
                existing.updatedAt = Date.now();
                await writeFile(file);
                return existing;
            });
        },
        async deleteKnowledge(id) {
            return enqueue(async () => {
                const file = await readFile();
                const index = file.entries.findIndex((entry) => entry.id === asText(id));
                if (index < 0)
                    return false;
                file.entries.splice(index, 1);
                await writeFile(file);
                return true;
            });
        },
        async listKnowledge(options = {}) {
            const touch = options.touchLastUsed === true;
            const query = asText(options.query).toLowerCase();
            const statusFilter = options.status === 'all' ? null : normalizeStatus(options.status ?? 'active');
            const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
            const offset = Math.max(0, Math.floor(options.offset ?? 0));
            const select = (file) => file.entries
                .filter((entry) => {
                if (statusFilter && entry.status !== statusFilter)
                    return false;
                if (options.kind && entry.kind !== normalizeKind(options.kind))
                    return false;
                if (options.category && entry.category !== boundedOptionalText(options.category, 'category', MAX_CATEGORY))
                    return false;
                if (query && !entry.topic.toLowerCase().includes(query) && !entry.summary.toLowerCase().includes(query))
                    return false;
                return true;
            })
                .sort((left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id))
                .slice(offset, offset + limit);
            if (!touch) {
                return select(await readFile());
            }
            return enqueue(async () => {
                const file = await readFile();
                const rows = select(file);
                const now = Date.now();
                const ids = new Set(rows.map((row) => row.id));
                for (const entry of file.entries) {
                    if (ids.has(entry.id))
                        entry.lastUsedAt = now;
                }
                if (rows.length > 0)
                    await writeFile(file);
                return rows.map((row) => ({ ...row, lastUsedAt: now }));
            });
        },
        async searchKnowledge(input) {
            return this.listKnowledge({
                query: input.query,
                kind: input.kind,
                status: 'active',
                limit: input.limit,
                touchLastUsed: input.touchLastUsed,
            });
        },
        async listKnowledgeForDream(limit = 60) {
            const rows = await this.listKnowledge({
                status: 'active',
                limit: Math.min(200, Math.max(1, Math.floor(limit))),
            });
            return rows.map((row) => ({
                id: row.id,
                topic: row.topic,
                summary: row.summary,
                kind: row.kind,
                category: row.category,
                version: row.version,
            }));
        },
        async countActive() {
            const file = await readFile();
            return file.entries.filter((entry) => entry.status === 'active').length;
        },
        async pruneKnowledgeRevisions(input) {
            const keep = Math.max(1, Math.min(50, Math.floor(input.keepPerEntry)));
            return enqueue(async () => {
                const file = await readFile();
                let entriesPruned = 0;
                let revisionsDeleted = 0;
                for (const entry of file.entries) {
                    if (entry.revisions.length <= keep)
                        continue;
                    const keepIds = new Set([...entry.revisions]
                        .sort((left, right) => (right.version - left.version
                        || right.createdAt - left.createdAt
                        || left.id.localeCompare(right.id)))
                        .slice(0, keep)
                        .map((revision) => revision.id));
                    const before = entry.revisions.length;
                    entry.revisions = entry.revisions.filter((revision) => keepIds.has(revision.id));
                    const removed = before - entry.revisions.length;
                    if (removed > 0) {
                        entriesPruned += 1;
                        revisionsDeleted += removed;
                    }
                }
                if (revisionsDeleted > 0)
                    await writeFile(file);
                return { entriesPruned, revisionsDeleted };
            });
        },
    };
}
