"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.IMPRESSION_SNAPSHOT_VERSION = void 0;
exports.createImpressionStore = createImpressionStore;
// Person-anchored (GlobalMetaID) impressions, ported from IDBots
// src/main/metaidImpressionStore.ts onto `.runtime/memory/impressions.json`.
// Dream-written observations are append-only with supersede chains; one
// snapshot per (observer, subject) pair is rebuilt from the active
// observations plus interaction stats from the experience ledger.
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
exports.IMPRESSION_SNAPSHOT_VERSION = 1;
const MAX_OBSERVATION_TEXT = 4_000;
const MAX_INTERPRETATION_TEXT = 4_000;
const MAX_GUIDANCE_TEXT = 2_000;
const MAX_STYLE_DESCRIPTORS = 16;
const MAX_EVIDENCE_REFS = 100;
let atomicWriteSequence = 0;
const asText = (value) => (typeof value === 'string' ? value.trim() : '');
function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
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
function normalizeEvidenceIds(value) {
    if (!Array.isArray(value))
        return [];
    return [...new Set(value.map(asText).filter(Boolean))].slice(0, MAX_EVIDENCE_REFS);
}
function sha256(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
function deriveIdempotencyKey(input) {
    return sha256([
        input.observerGlobalMetaId,
        input.subjectGlobalMetaId,
        input.dreamDate,
        String(input.dreamVersion),
        input.sourceHash,
    ].join('|'));
}
function normalizeObservation(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const id = asText(record.id);
    const observer = asText(record.observerGlobalMetaId);
    const subject = asText(record.subjectGlobalMetaId);
    if (!id || !observer || !subject)
        return null;
    const status = record.status;
    return {
        id,
        observerGlobalMetaId: observer,
        subjectGlobalMetaId: subject,
        episodeId: asText(record.episodeId) || null,
        observationText: typeof record.observationText === 'string' ? record.observationText : '',
        interpretationText: typeof record.interpretationText === 'string' ? record.interpretationText : '',
        dimensions: asRecord(record.dimensions),
        communicationGuidance: asText(record.communicationGuidance) || null,
        confidence: asRecord(record.confidence),
        dreamDate: asText(record.dreamDate),
        dreamVersion: Math.max(1, Math.floor(Number(record.dreamVersion) || 1)),
        modelId: asText(record.modelId) || null,
        sourceHash: asText(record.sourceHash),
        idempotencyKey: asText(record.idempotencyKey),
        supersedesObservationId: asText(record.supersedesObservationId) || null,
        evidenceIds: normalizeEvidenceIds(record.evidenceIds),
        status: status === 'superseded' || status === 'rejected' ? status : 'active',
        createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : 0,
    };
}
function normalizeCollaborationFact(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const observer = asText(record.observerGlobalMetaId);
    const subject = asText(record.subjectGlobalMetaId);
    const id = asText(record.id);
    if (!observer || !subject || !id)
        return null;
    const seatRole = asText(record.seatRole);
    return {
        id,
        observerGlobalMetaId: observer,
        subjectGlobalMetaId: subject,
        taskId: Number(record.taskId) || 0,
        title: asText(record.title).slice(0, 200),
        outcome: asText(record.outcome) || 'unknown',
        ...(seatRole ? { seatRole } : {}),
        evidencePinIds: Array.isArray(record.evidencePinIds)
            ? record.evidencePinIds.map((pin) => asText(pin)).filter(Boolean).slice(0, 20)
            : [],
        recordedAt: Number(record.recordedAt) || 0,
    };
}
/** Snapshot view of the facts ledger for one observer→subject pair (last 10). */
function factsForSnapshot(facts, observerGlobalMetaId, subjectGlobalMetaId) {
    return facts
        .filter((fact) => fact.observerGlobalMetaId === observerGlobalMetaId
        && fact.subjectGlobalMetaId === subjectGlobalMetaId)
        .sort((left, right) => left.recordedAt - right.recordedAt)
        .slice(-10)
        .map((fact) => ({
        taskId: fact.taskId,
        title: fact.title,
        outcome: fact.outcome,
        ...(fact.seatRole ? { seatRole: fact.seatRole } : {}),
        evidencePinIds: fact.evidencePinIds,
        recordedAt: fact.recordedAt,
    }));
}
function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return null;
    const record = value;
    const observer = asText(record.observerGlobalMetaId);
    const subject = asText(record.subjectGlobalMetaId);
    if (!observer || !subject)
        return null;
    return {
        observerGlobalMetaId: observer,
        subjectGlobalMetaId: subject,
        capabilityTags: Array.isArray(record.capabilityTags)
            ? record.capabilityTags.map((tag) => asText(tag)).filter(Boolean).slice(0, 20)
            : [],
        collaborationFacts: Array.isArray(record.collaborationFacts)
            ? record.collaborationFacts
                .map((fact) => {
                // Embedded views carry no id/observer/subject — map them directly.
                const row = (fact && typeof fact === 'object' ? fact : {});
                const seatRole = asText(row.seatRole);
                return {
                    taskId: Number(row.taskId) || 0,
                    title: asText(row.title).slice(0, 200),
                    outcome: asText(row.outcome) || 'unknown',
                    ...(seatRole ? { seatRole } : {}),
                    evidencePinIds: Array.isArray(row.evidencePinIds)
                        ? row.evidencePinIds.map((pin) => asText(pin)).filter(Boolean).slice(0, 20)
                        : [],
                    recordedAt: Number(row.recordedAt) || 0,
                };
            })
                .slice(-10)
            : [],
        firstSeenAt: Number(record.firstSeenAt) || 0,
        lastSeenAt: Number(record.lastSeenAt) || 0,
        interactionCount: Math.max(0, Math.floor(Number(record.interactionCount) || 0)),
        directInteractionCount: Math.max(0, Math.floor(Number(record.directInteractionCount) || 0)),
        summaryText: typeof record.summaryText === 'string' ? record.summaryText : '',
        styleDescriptors: Array.isArray(record.styleDescriptors)
            ? record.styleDescriptors.map(asText).filter(Boolean)
            : [],
        cooperationContext: asText(record.cooperationContext) || null,
        relationshipTemperature: asText(record.relationshipTemperature) || null,
        communicationGuidance: asText(record.communicationGuidance) || null,
        uncertaintyText: asText(record.uncertaintyText) || null,
        latestObservationId: asText(record.latestObservationId),
        snapshotVersion: Math.max(1, Math.floor(Number(record.snapshotVersion) || 1)),
        sourceHash: asText(record.sourceHash),
        createdAt: Number(record.createdAt) || 0,
        updatedAt: Number(record.updatedAt) || 0,
    };
}
function extractStringList(value) {
    if (Array.isArray(value))
        return value.map(asText).filter(Boolean);
    if (typeof value === 'string') {
        return value.split(/[,,、|/]/g).map(asText).filter(Boolean);
    }
    return [];
}
function latestDimensionText(dimensions, keys) {
    for (const key of keys) {
        const value = dimensions.get(key);
        const normalized = asText(value);
        if (normalized)
            return normalized;
    }
    return null;
}
function createImpressionStore(paths, deps = {}) {
    const filePath = paths.memoryImpressionsPath;
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
                return { version: 1, observations: [], snapshots: [], collaborationFacts: [] };
            }
            const record = parsed;
            return {
                version: 1,
                observations: Array.isArray(record.observations)
                    ? record.observations.map(normalizeObservation).filter((o) => o !== null)
                    : [],
                snapshots: Array.isArray(record.snapshots)
                    ? record.snapshots.map(normalizeSnapshot).filter((s) => s !== null)
                    : [],
                collaborationFacts: Array.isArray(record.collaborationFacts)
                    ? record.collaborationFacts.map(normalizeCollaborationFact).filter((f) => f !== null)
                    : [],
            };
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                return { version: 1, observations: [], snapshots: [], collaborationFacts: [] };
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
    async function requireOwnedSubjectEpisode(file, episodeId, observerGlobalMetaId, subjectGlobalMetaId) {
        if (!deps.experienceStore)
            return;
        const episode = await deps.experienceStore.getEpisode(episodeId);
        if (!episode || episode.ownerGlobalMetaId !== observerGlobalMetaId) {
            throw new Error(`Episode is not accessible for this observer and subject: ${episodeId}`);
        }
        const participants = await deps.experienceStore.listParticipants(episodeId);
        if (!participants.some((participant) => participant.globalMetaId === subjectGlobalMetaId)) {
            throw new Error(`Episode is not accessible for this observer and subject: ${episodeId}`);
        }
        void file;
    }
    async function requireOwnedSubjectEvidence(evidenceId, observerGlobalMetaId, subjectGlobalMetaId) {
        if (!deps.experienceStore)
            return;
        // Evidence is accessible when its episode belongs to the observer and the
        // subject published the evidence or participated in its episode.
        const episodes = await deps.experienceStore.listEpisodes({ ownerGlobalMetaId: observerGlobalMetaId, limit: 500 });
        for (const episode of episodes) {
            const evidence = await deps.experienceStore.listEvidence(episode.id, { limit: 500 });
            const match = evidence.find((entry) => entry.id === evidenceId);
            if (!match)
                continue;
            if (match.publisherGlobalMetaId === subjectGlobalMetaId)
                return;
            const participants = await deps.experienceStore.listParticipants(episode.id);
            if (participants.some((participant) => participant.globalMetaId === subjectGlobalMetaId))
                return;
            throw new Error(`Evidence is not accessible for this observer and subject: ${evidenceId}`);
        }
        throw new Error(`Evidence is not accessible for this observer and subject: ${evidenceId}`);
    }
    return {
        async listObservations(input) {
            const file = await readFile();
            const limit = Math.min(500, Math.max(1, Math.floor(input.limit ?? 100)));
            return file.observations
                .filter((observation) => (observation.observerGlobalMetaId === input.observerGlobalMetaId
                && observation.subjectGlobalMetaId === input.subjectGlobalMetaId
                && (input.includeSuperseded || observation.status === 'active')))
                .sort((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
                .slice(0, limit);
        },
        async appendObservation(input) {
            return enqueue(async () => {
                const observer = asText(input.observerGlobalMetaId);
                const subject = asText(input.subjectGlobalMetaId);
                if (!observer || !subject)
                    throw new Error('observerGlobalMetaId and subjectGlobalMetaId are required');
                if (observer === subject)
                    throw new Error('Self-impressions are not accepted');
                const episodeId = asText(input.episodeId) || null;
                const evidenceIds = normalizeEvidenceIds(input.evidenceIds);
                const observationText = boundedRequiredText(input.observationText, 'observationText', MAX_OBSERVATION_TEXT);
                const interpretationText = boundedRequiredText(input.interpretationText, 'interpretationText', MAX_INTERPRETATION_TEXT);
                const dimensions = asRecord(input.dimensions);
                const communicationGuidance = boundedOptionalText(input.communicationGuidance, 'communicationGuidance', MAX_GUIDANCE_TEXT);
                const confidence = asRecord(input.confidence);
                const dreamDate = asText(input.dreamDate);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(dreamDate))
                    throw new Error('dreamDate must be YYYY-MM-DD');
                const dreamVersion = Math.max(1, Math.floor(Number(input.dreamVersion) || 1));
                const sourceHash = asText(input.sourceHash);
                if (!sourceHash)
                    throw new Error('sourceHash is required');
                const idempotencyKey = asText(input.idempotencyKey) || deriveIdempotencyKey({
                    observerGlobalMetaId: observer,
                    subjectGlobalMetaId: subject,
                    dreamDate,
                    dreamVersion,
                    sourceHash,
                });
                if (idempotencyKey.length > 500)
                    throw new Error('idempotencyKey exceeds 500 characters');
                const file = await readFile();
                const existing = file.observations.find((observation) => observation.idempotencyKey === idempotencyKey);
                if (existing) {
                    if (existing.observerGlobalMetaId !== observer || existing.subjectGlobalMetaId !== subject) {
                        throw new Error('idempotencyKey is already owned by another observer/subject pair');
                    }
                    return { observation: existing, created: false };
                }
                if (episodeId)
                    await requireOwnedSubjectEpisode(file, episodeId, observer, subject);
                for (const evidenceId of evidenceIds) {
                    await requireOwnedSubjectEvidence(evidenceId, observer, subject);
                }
                const supersedesObservationId = asText(input.supersedesObservationId) || null;
                if (supersedesObservationId) {
                    const superseded = file.observations.find((observation) => observation.id === supersedesObservationId);
                    if (!superseded
                        || superseded.observerGlobalMetaId !== observer
                        || superseded.subjectGlobalMetaId !== subject
                        || superseded.status !== 'active') {
                        throw new Error('supersedesObservationId must identify an active observation for the same pair');
                    }
                }
                const now = Date.now();
                const observation = {
                    id: asText(input.id) || `obs_${node_crypto_1.default.randomUUID()}`,
                    observerGlobalMetaId: observer,
                    subjectGlobalMetaId: subject,
                    episodeId,
                    observationText,
                    interpretationText,
                    dimensions,
                    communicationGuidance,
                    confidence,
                    dreamDate,
                    dreamVersion,
                    modelId: boundedOptionalText(input.modelId, 'modelId', 300),
                    sourceHash,
                    idempotencyKey,
                    supersedesObservationId,
                    evidenceIds,
                    status: 'active',
                    createdAt: now,
                };
                file.observations.push(observation);
                if (supersedesObservationId) {
                    const superseded = file.observations.find((entry) => entry.id === supersedesObservationId);
                    if (superseded && superseded.status === 'active') {
                        superseded.status = 'superseded';
                    }
                }
                await writeFile(file);
                return { observation, created: true };
            });
        },
        async getSnapshot(observerGlobalMetaId, subjectGlobalMetaId) {
            const file = await readFile();
            return file.snapshots.find((snapshot) => (snapshot.observerGlobalMetaId === observerGlobalMetaId
                && snapshot.subjectGlobalMetaId === subjectGlobalMetaId)) ?? null;
        },
        async listSnapshots(observerGlobalMetaId, limit = 100) {
            const file = await readFile();
            return file.snapshots
                .filter((snapshot) => snapshot.observerGlobalMetaId === observerGlobalMetaId)
                .sort((left, right) => right.updatedAt - left.updatedAt
                || left.subjectGlobalMetaId.localeCompare(right.subjectGlobalMetaId))
                .slice(0, Math.min(500, Math.max(1, Math.floor(limit))));
        },
        async appendCollaborationFact(input) {
            return enqueue(async () => {
                const file = await readFile();
                const fact = {
                    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
                    observerGlobalMetaId: input.observerGlobalMetaId.trim().toLowerCase(),
                    subjectGlobalMetaId: input.subjectGlobalMetaId.trim().toLowerCase(),
                    taskId: input.taskId,
                    title: input.title.slice(0, 200),
                    outcome: input.outcome,
                    ...(input.seatRole ? { seatRole: input.seatRole } : {}),
                    evidencePinIds: (input.evidencePinIds ?? []).slice(0, 20),
                    recordedAt: Date.now(),
                };
                file.collaborationFacts.push(fact);
                // Refresh the snapshot view in the same write so readers (staffing
                // search) see the fact without waiting for a dream rebuild.
                const snapshotIndex = file.snapshots.findIndex((snapshot) => (snapshot.observerGlobalMetaId === fact.observerGlobalMetaId
                    && snapshot.subjectGlobalMetaId === fact.subjectGlobalMetaId));
                const pairFacts = factsForSnapshot(file.collaborationFacts, fact.observerGlobalMetaId, fact.subjectGlobalMetaId);
                const now = Date.now();
                if (snapshotIndex >= 0) {
                    file.snapshots[snapshotIndex].collaborationFacts = pairFacts;
                    file.snapshots[snapshotIndex].updatedAt = now;
                }
                else if (pairFacts.length > 0) {
                    file.snapshots.push({
                        observerGlobalMetaId: fact.observerGlobalMetaId,
                        subjectGlobalMetaId: fact.subjectGlobalMetaId,
                        firstSeenAt: pairFacts[0].recordedAt,
                        lastSeenAt: pairFacts[pairFacts.length - 1].recordedAt,
                        capabilityTags: [],
                        collaborationFacts: pairFacts,
                        interactionCount: 0,
                        directInteractionCount: 0,
                        summaryText: '',
                        styleDescriptors: [],
                        cooperationContext: null,
                        relationshipTemperature: null,
                        communicationGuidance: null,
                        uncertaintyText: null,
                        latestObservationId: '',
                        snapshotVersion: exports.IMPRESSION_SNAPSHOT_VERSION,
                        sourceHash: sha256(JSON.stringify({
                            factsOnly: true,
                            observer: fact.observerGlobalMetaId,
                            subject: fact.subjectGlobalMetaId,
                            facts: pairFacts.map((entry) => [entry.taskId, entry.outcome, entry.recordedAt]),
                        })),
                        createdAt: now,
                        updatedAt: now,
                    });
                }
                await writeFile(file);
                return fact;
            });
        },
        async rebuildSnapshot(observerGlobalMetaId, subjectGlobalMetaId) {
            return enqueue(async () => {
                const file = await readFile();
                const observations = file.observations
                    .filter((observation) => (observation.observerGlobalMetaId === observerGlobalMetaId
                    && observation.subjectGlobalMetaId === subjectGlobalMetaId
                    && observation.status === 'active'))
                    .sort((left, right) => left.dreamDate.localeCompare(right.dreamDate)
                    || left.dreamVersion - right.dreamVersion
                    || left.createdAt - right.createdAt
                    || left.id.localeCompare(right.id));
                const snapshotIndex = file.snapshots.findIndex((snapshot) => (snapshot.observerGlobalMetaId === observerGlobalMetaId
                    && snapshot.subjectGlobalMetaId === subjectGlobalMetaId));
                const pairFacts = factsForSnapshot(file.collaborationFacts, observerGlobalMetaId, subjectGlobalMetaId);
                if (observations.length === 0) {
                    if (pairFacts.length === 0) {
                        if (snapshotIndex >= 0) {
                            file.snapshots.splice(snapshotIndex, 1);
                            await writeFile(file);
                        }
                        return null;
                    }
                    // Facts alone still carry a snapshot (staffing searches read them).
                    const now = Date.now();
                    const factsOnly = {
                        observerGlobalMetaId,
                        subjectGlobalMetaId,
                        firstSeenAt: pairFacts[0].recordedAt,
                        lastSeenAt: pairFacts[pairFacts.length - 1].recordedAt,
                        capabilityTags: [],
                        collaborationFacts: pairFacts,
                        interactionCount: 0,
                        directInteractionCount: 0,
                        summaryText: '',
                        styleDescriptors: [],
                        cooperationContext: null,
                        relationshipTemperature: null,
                        communicationGuidance: null,
                        uncertaintyText: null,
                        latestObservationId: '',
                        snapshotVersion: exports.IMPRESSION_SNAPSHOT_VERSION,
                        sourceHash: sha256(JSON.stringify({
                            factsOnly: true,
                            observer: observerGlobalMetaId,
                            subject: subjectGlobalMetaId,
                            facts: pairFacts.map((fact) => [fact.taskId, fact.outcome, fact.recordedAt]),
                        })),
                        createdAt: now,
                        updatedAt: now,
                    };
                    if (snapshotIndex >= 0) {
                        file.snapshots[snapshotIndex] = factsOnly;
                    }
                    else {
                        file.snapshots.push(factsOnly);
                    }
                    await writeFile(file);
                    return factsOnly;
                }
                // Interaction stats come from the experience ledger when available.
                let firstSeenAt = 0;
                let lastSeenAt = 0;
                let interactionCount = 0;
                let directInteractionCount = 0;
                if (deps.experienceStore) {
                    const episodes = await deps.experienceStore.listEpisodes({
                        ownerGlobalMetaId: observerGlobalMetaId,
                        subjectGlobalMetaId,
                        limit: 500,
                    });
                    interactionCount = episodes.length;
                    directInteractionCount = episodes.filter((episode) => episode.episodeType === 'direct_interaction').length;
                    for (const episode of episodes) {
                        firstSeenAt = firstSeenAt === 0 ? episode.startedAt : Math.min(firstSeenAt, episode.startedAt);
                        lastSeenAt = Math.max(lastSeenAt, episode.startedAt);
                    }
                }
                const latest = observations[observations.length - 1];
                const latestDimensions = new Map();
                const descriptorCandidates = new Set();
                let communicationGuidance = null;
                let uncertaintyText = null;
                const dreamCapabilityTags = new Set();
                const dreamFacts = [];
                for (const observation of observations) {
                    for (const [key, value] of Object.entries(observation.dimensions)) {
                        latestDimensions.set(key, value);
                        if (['styleDescriptors', 'style_descriptors', 'communicationStyle', 'communication_style', 'style'].includes(key)) {
                            for (const descriptor of extractStringList(value))
                                descriptorCandidates.add(descriptor);
                        }
                        if (key === 'capabilityTags' && Array.isArray(value)) {
                            for (const tag of value) {
                                const text = asText(tag);
                                if (text)
                                    dreamCapabilityTags.add(text.slice(0, 60));
                            }
                        }
                        if (key === 'collaborationFacts' && Array.isArray(value)) {
                            for (const fact of value) {
                                const row = (fact && typeof fact === 'object' ? fact : {});
                                const outcome = asText(row.outcome);
                                if (!outcome)
                                    continue;
                                const seatRole = asText(row.seatRole);
                                dreamFacts.push({
                                    taskId: Number(row.taskId) || 0,
                                    title: asText(row.title).slice(0, 200),
                                    outcome,
                                    ...(seatRole ? { seatRole } : {}),
                                    evidencePinIds: Array.isArray(row.pinIds)
                                        ? row.pinIds.map((pin) => asText(pin)).filter(Boolean).slice(0, 20)
                                        : [],
                                    recordedAt: observation.createdAt,
                                });
                            }
                        }
                    }
                    if (observation.communicationGuidance)
                        communicationGuidance = observation.communicationGuidance;
                    const uncertainty = asText(observation.confidence.uncertainty);
                    if (uncertainty)
                        uncertaintyText = uncertainty;
                }
                const descriptors = new Set();
                for (const descriptor of descriptorCandidates) {
                    if (descriptors.size >= MAX_STYLE_DESCRIPTORS)
                        break;
                    descriptors.add(descriptor.slice(0, 200));
                }
                const now = Date.now();
                const prior = snapshotIndex >= 0 ? file.snapshots[snapshotIndex] : null;
                const sourceHash = sha256(JSON.stringify({
                    snapshotVersion: exports.IMPRESSION_SNAPSHOT_VERSION,
                    observer: observerGlobalMetaId,
                    subject: subjectGlobalMetaId,
                    observations: observations.map((observation) => ({
                        id: observation.id,
                        sourceHash: observation.sourceHash,
                        dreamVersion: observation.dreamVersion,
                    })),
                    firstSeenAt,
                    lastSeenAt,
                    interactionCount,
                    directInteractionCount,
                }));
                const snapshot = {
                    observerGlobalMetaId,
                    subjectGlobalMetaId,
                    firstSeenAt: firstSeenAt || latest.createdAt,
                    lastSeenAt: lastSeenAt || firstSeenAt || latest.createdAt,
                    interactionCount,
                    directInteractionCount,
                    summaryText: latest.interpretationText || latest.observationText,
                    styleDescriptors: [...descriptors],
                    cooperationContext: latestDimensionText(latestDimensions, ['cooperationContext', 'cooperation_context', 'cooperation', 'cooperationPattern']),
                    relationshipTemperature: latestDimensionText(latestDimensions, ['relationshipTemperature', 'relationship_temperature', 'temperature']),
                    communicationGuidance,
                    uncertaintyText,
                    latestObservationId: latest.id,
                    snapshotVersion: exports.IMPRESSION_SNAPSHOT_VERSION,
                    capabilityTags: [...dreamCapabilityTags].slice(0, 20),
                    collaborationFacts: [...dreamFacts, ...pairFacts]
                        .filter((fact, index, all) => all.findIndex((other) => other.taskId === fact.taskId
                        && other.outcome === fact.outcome
                        && other.title === fact.title) === index)
                        .slice(-10),
                    sourceHash,
                    createdAt: prior?.createdAt ?? now,
                    updatedAt: now,
                };
                if (snapshotIndex >= 0) {
                    file.snapshots[snapshotIndex] = snapshot;
                }
                else {
                    file.snapshots.push(snapshot);
                }
                await writeFile(file);
                return snapshot;
            });
        },
    };
}
