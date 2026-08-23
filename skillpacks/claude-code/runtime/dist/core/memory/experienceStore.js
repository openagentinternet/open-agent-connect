"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXPERIENCE_EPISODE_TYPES = void 0;
exports.hashExperienceContent = hashExperienceContent;
exports.createExperienceStore = createExperienceStore;
// Time-anchored experience ledger, ported from IDBots
// src/main/metaidExperienceStore.ts onto `.runtime/memory/experience.json`.
// Episodes are the shared fact source: daily summaries, person-anchored
// impressions, and knowledge points all index into this ledger. Evidence
// rows store hashes/references, never raw private text.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.EXPERIENCE_EPISODE_TYPES = [
    'direct_interaction',
    'task_participation',
    'service_order',
    'scheduled_task',
    'public_pin_observation',
    'third_party_reference',
];
const MAX_METADATA_CHARS = 8_000;
let atomicWriteSequence = 0;
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function num(value, fallback = 0) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function normalizeMetadata(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    try {
        const serialized = JSON.stringify(value);
        if (serialized.length > MAX_METADATA_CHARS)
            return {};
    }
    catch {
        return {};
    }
    return value;
}
function normalizeEpisodeType(value) {
    return exports.EXPERIENCE_EPISODE_TYPES.includes(String(value))
        ? value
        : 'direct_interaction';
}
function normalizeEpisodeStatus(value) {
    return value === 'open' || value === 'failed' || value === 'abandoned' ? value : 'completed';
}
function normalizeParticipant(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const globalMetaId = text(record.globalMetaId) || null;
    const unresolvedActorKey = text(record.unresolvedActorKey) || null;
    if (!globalMetaId && !unresolvedActorKey)
        return null;
    return {
        episodeId: text(record.episodeId),
        globalMetaId,
        unresolvedActorKey,
        identityState: globalMetaId ? 'known' : 'unknown',
        role: text(record.role) || 'peer',
        displayName: text(record.displayName) || null,
        source: text(record.source) || 'observed',
        createdAt: num(record.createdAt),
    };
}
function normalizeEvidence(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = text(record.id);
    const episodeId = text(record.episodeId);
    const evidenceType = text(record.evidenceType);
    const sourceKey = text(record.sourceKey);
    if (!id || !episodeId || !evidenceType || !sourceKey)
        return null;
    return {
        id,
        episodeId,
        evidenceType,
        sourceKey,
        pinId: text(record.pinId) || null,
        publisherGlobalMetaId: text(record.publisherGlobalMetaId) || null,
        messageId: text(record.messageId) || null,
        contentHash: text(record.contentHash),
        occurredAt: num(record.occurredAt),
        retrievedAt: record.retrievedAt === null ? null : num(record.retrievedAt) || null,
        metadata: normalizeMetadata(record.metadata),
        createdAt: num(record.createdAt),
    };
}
function normalizeEpisode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = text(record.id);
    const ownerGlobalMetaId = text(record.ownerGlobalMetaId);
    const sourceChannel = text(record.sourceChannel);
    const sourceKey = text(record.sourceKey);
    if (!id || !ownerGlobalMetaId || !sourceChannel || !sourceKey)
        return null;
    return {
        id,
        ownerGlobalMetaId,
        episodeType: normalizeEpisodeType(record.episodeType),
        sourceChannel,
        sourceKey,
        sessionId: text(record.sessionId) || null,
        externalConversationId: text(record.externalConversationId) || null,
        taskId: text(record.taskId) || null,
        orderId: text(record.orderId) || null,
        status: normalizeEpisodeStatus(record.status),
        startedAt: num(record.startedAt),
        endedAt: record.endedAt === null ? null : num(record.endedAt) || null,
        metadata: normalizeMetadata(record.metadata),
        createdAt: num(record.createdAt),
        updatedAt: num(record.updatedAt),
        participants: Array.isArray(record.participants)
            ? record.participants.map(normalizeParticipant).filter((p) => p !== null)
            : [],
        evidence: Array.isArray(record.evidence)
            ? record.evidence.map(normalizeEvidence).filter((e) => e !== null)
            : [],
    };
}
/** sha1 content hash for evidence rows — evidence stores hashes, not raw text. */
function hashExperienceContent(content) {
    return node_crypto_1.default.createHash('sha1').update(content, 'utf8').digest('hex');
}
function createExperienceStore(paths) {
    const filePath = paths.memoryExperiencePath;
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
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { version: 1, episodes: [] };
            }
            const episodes = Array.isArray(parsed.episodes)
                ? parsed.episodes
                    .map(normalizeEpisode)
                    .filter((episode) => episode !== null)
                : [];
            return { version: 1, episodes };
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return { version: 1, episodes: [] };
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
    function strip(episode) {
        const { participants: _participants, evidence: _evidence, ...rest } = episode;
        return rest;
    }
    return {
        async createEpisode(input) {
            return enqueue(async () => {
                const file = await readFile();
                const owner = text(input.ownerGlobalMetaId);
                const sourceChannel = text(input.sourceChannel);
                const sourceKey = text(input.sourceKey);
                if (!owner)
                    throw new Error('ownerGlobalMetaId is required');
                if (!sourceChannel || !sourceKey)
                    throw new Error('sourceChannel and sourceKey are required');
                const existing = file.episodes.find((episode) => (episode.ownerGlobalMetaId === owner
                    && episode.sourceChannel === sourceChannel
                    && episode.sourceKey === sourceKey));
                if (existing)
                    return strip(existing);
                const now = Date.now();
                const episode = {
                    id: `ep_${node_crypto_1.default.randomUUID()}`,
                    ownerGlobalMetaId: owner,
                    episodeType: normalizeEpisodeType(input.episodeType),
                    sourceChannel,
                    sourceKey,
                    sessionId: text(input.sessionId) || null,
                    externalConversationId: text(input.externalConversationId) || null,
                    taskId: text(input.taskId) || null,
                    orderId: text(input.orderId) || null,
                    status: input.status ?? 'open',
                    startedAt: num(input.startedAt, now),
                    endedAt: input.endedAt === undefined ? null : input.endedAt,
                    metadata: normalizeMetadata(input.metadata),
                    createdAt: now,
                    updatedAt: now,
                    participants: [],
                    evidence: [],
                };
                file.episodes.push(episode);
                await writeFile(file);
                return strip(episode);
            });
        },
        async getEpisode(id) {
            const file = await readFile();
            const episode = file.episodes.find((entry) => entry.id === text(id));
            return episode ? strip(episode) : null;
        },
        async updateEpisodeStatus(id, status, endedAt) {
            await enqueue(async () => {
                const file = await readFile();
                const episode = file.episodes.find((entry) => entry.id === text(id));
                if (!episode)
                    return;
                episode.status = status;
                if (endedAt !== undefined)
                    episode.endedAt = endedAt;
                episode.updatedAt = Date.now();
                await writeFile(file);
            });
        },
        async addParticipant(input) {
            return enqueue(async () => {
                const file = await readFile();
                const episode = file.episodes.find((entry) => entry.id === text(input.episodeId));
                if (!episode)
                    return null;
                const globalMetaId = text(input.globalMetaId) || null;
                const unresolvedActorKey = text(input.unresolvedActorKey) || null;
                if (!globalMetaId && !unresolvedActorKey)
                    return null;
                const existing = episode.participants.find((participant) => ((globalMetaId && participant.globalMetaId === globalMetaId)
                    || (unresolvedActorKey && participant.unresolvedActorKey === unresolvedActorKey)));
                if (existing)
                    return existing;
                const participant = {
                    episodeId: episode.id,
                    globalMetaId,
                    unresolvedActorKey,
                    identityState: globalMetaId ? 'known' : 'unknown',
                    role: text(input.role) || 'peer',
                    displayName: text(input.displayName) || null,
                    source: text(input.source) || 'observed',
                    createdAt: Date.now(),
                };
                episode.participants.push(participant);
                episode.updatedAt = Date.now();
                await writeFile(file);
                return participant;
            });
        },
        async addEvidence(input) {
            return enqueue(async () => {
                const file = await readFile();
                const episode = file.episodes.find((entry) => entry.id === text(input.episodeId));
                if (!episode)
                    return null;
                const evidenceType = text(input.evidenceType);
                const sourceKey = text(input.sourceKey);
                if (!evidenceType || !sourceKey)
                    return null;
                const existing = episode.evidence.find((entry) => (entry.evidenceType === evidenceType && entry.sourceKey === sourceKey));
                if (existing)
                    return existing;
                const now = Date.now();
                const evidence = {
                    id: `ev_${node_crypto_1.default.randomUUID()}`,
                    episodeId: episode.id,
                    evidenceType,
                    sourceKey,
                    pinId: text(input.pinId) || null,
                    publisherGlobalMetaId: text(input.publisherGlobalMetaId) || null,
                    messageId: text(input.messageId) || null,
                    contentHash: text(input.contentHash),
                    occurredAt: num(input.occurredAt, now),
                    retrievedAt: input.retrievedAt === undefined ? null : input.retrievedAt,
                    metadata: normalizeMetadata(input.metadata),
                    createdAt: now,
                };
                episode.evidence.push(evidence);
                episode.updatedAt = now;
                await writeFile(file);
                return evidence;
            });
        },
        async listEpisodes(options) {
            const file = await readFile();
            const owner = text(options.ownerGlobalMetaId);
            const subject = text(options.subjectGlobalMetaId);
            const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
            const filtered = file.episodes.filter((episode) => {
                if (owner && episode.ownerGlobalMetaId !== owner)
                    return false;
                if (options.fromTime !== undefined && episode.startedAt < options.fromTime)
                    return false;
                if (options.toTime !== undefined && episode.startedAt >= options.toTime)
                    return false;
                if (subject && !episode.participants.some((participant) => participant.globalMetaId === subject))
                    return false;
                return true;
            });
            filtered.sort((left, right) => right.startedAt - left.startedAt || left.id.localeCompare(right.id));
            return filtered.slice(0, limit).map(strip);
        },
        async listParticipants(episodeId) {
            const file = await readFile();
            const episode = file.episodes.find((entry) => entry.id === text(episodeId));
            return episode ? [...episode.participants] : [];
        },
        async listEvidence(episodeId, options = {}) {
            const file = await readFile();
            const episode = file.episodes.find((entry) => entry.id === text(episodeId));
            if (!episode)
                return [];
            const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)));
            const filtered = episode.evidence.filter((entry) => {
                if (options.fromTime !== undefined && entry.occurredAt < options.fromTime)
                    return false;
                if (options.toTime !== undefined && entry.occurredAt >= options.toTime)
                    return false;
                return true;
            });
            filtered.sort((left, right) => right.occurredAt - left.occurredAt || left.id.localeCompare(right.id));
            return filtered.slice(0, limit);
        },
    };
}
