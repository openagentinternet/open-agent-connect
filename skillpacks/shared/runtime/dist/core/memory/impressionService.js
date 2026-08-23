"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDreamImpressionSubjects = buildDreamImpressionSubjects;
exports.applyDreamImpressionUpdates = applyDreamImpressionUpdates;
// Dream-time impression consolidation, ported from IDBots
// src/main/services/metaidDreamImpressionService.ts: builds the bounded
// per-subject candidate context for the dream prompt, then validates and
// persists the LLM's impression updates (only listed subject/episode/evidence
// IDs are accepted) and rebuilds the affected snapshots.
const node_crypto_1 = __importDefault(require("node:crypto"));
const MAX_SUBJECTS = 24;
const MAX_EVIDENCE_PER_SUBJECT = 32;
const text = (value) => (typeof value === 'string' ? value.trim() : '');
function sha256(value) {
    return node_crypto_1.default.createHash('sha256').update(value, 'utf8').digest('hex');
}
function addUnique(list, value) {
    if (value && !list.includes(value))
        list.push(value);
}
/** Select bounded, owner-relative evidence for the day's dream prompt. */
async function buildDreamImpressionSubjects(input) {
    const observer = text(input.observerGlobalMetaId);
    if (!observer)
        return [];
    const accumulators = new Map();
    const episodes = await input.experienceStore.listEpisodes({
        ownerGlobalMetaId: observer,
        fromTime: input.fromTime,
        toTime: input.toTime,
        limit: 500,
    });
    for (const episode of episodes) {
        const participants = await input.experienceStore.listParticipants(episode.id);
        const subjects = [...new Set(participants
                .map((participant) => text(participant.globalMetaId))
                .filter((subject) => Boolean(subject && subject !== observer)))];
        if (subjects.length === 0)
            continue;
        const evidence = await input.experienceStore.listEvidence(episode.id, {
            fromTime: input.fromTime,
            toTime: input.toTime,
            limit: MAX_EVIDENCE_PER_SUBJECT,
        });
        for (const subject of subjects) {
            const accumulator = accumulators.get(subject) ?? {
                subjectGlobalMetaId: subject,
                episodeIds: [],
                evidence: [],
                interactionCount: 0,
                directInteractionCount: 0,
                lastSeenAt: 0,
            };
            addUnique(accumulator.episodeIds, episode.id);
            accumulator.interactionCount += 1;
            if (episode.episodeType === 'direct_interaction')
                accumulator.directInteractionCount += 1;
            for (const item of evidence) {
                accumulator.lastSeenAt = Math.max(accumulator.lastSeenAt, item.occurredAt);
                if (accumulator.evidence.length >= MAX_EVIDENCE_PER_SUBJECT)
                    continue;
                if (accumulator.evidence.some((existing) => existing.id === item.id))
                    continue;
                accumulator.evidence.push({
                    id: item.id,
                    evidenceType: item.evidenceType,
                    pinId: item.pinId,
                    publisherGlobalMetaID: item.publisherGlobalMetaId,
                    occurredAt: item.occurredAt,
                });
            }
            accumulators.set(subject, accumulator);
        }
    }
    const limit = Math.min(MAX_SUBJECTS, Math.max(1, Math.floor(input.maxSubjects ?? MAX_SUBJECTS)));
    const selected = [...accumulators.values()]
        .filter((subject) => subject.evidence.length > 0)
        .sort((left, right) => right.lastSeenAt - left.lastSeenAt || left.subjectGlobalMetaId.localeCompare(right.subjectGlobalMetaId))
        .slice(0, limit);
    const result = [];
    for (const subject of selected) {
        const previous = await input.impressionStore.getSnapshot(observer, subject.subjectGlobalMetaId);
        result.push({
            subjectGlobalMetaID: subject.subjectGlobalMetaId,
            episodeIds: [...subject.episodeIds].sort(),
            evidenceIds: subject.evidence.map((evidence) => evidence.id).sort(),
            interactionCount: subject.interactionCount,
            directInteractionCount: subject.directInteractionCount,
            evidence: [...subject.evidence].sort((left, right) => right.occurredAt - left.occurredAt || left.id.localeCompare(right.id)),
            previousSnapshot: previous
                ? {
                    summaryText: previous.summaryText,
                    styleDescriptors: previous.styleDescriptors,
                    cooperationContext: previous.cooperationContext,
                    relationshipTemperature: previous.relationshipTemperature,
                    communicationGuidance: previous.communicationGuidance,
                    uncertaintyText: previous.uncertaintyText,
                }
                : null,
        });
    }
    return result;
}
function sourceHashForSubject(subject, dreamDate, dreamVersion) {
    return sha256(JSON.stringify({
        dreamDate,
        dreamVersion,
        subjectGlobalMetaID: subject.subjectGlobalMetaID,
        episodeIds: [...subject.episodeIds].sort(),
        evidenceIds: [...subject.evidenceIds].sort(),
        previousSnapshotSourceHash: subject.previousSnapshot?.summaryText ?? null,
    }));
}
/** Validate and persist LLM-produced subject updates without changing hard relationships. */
async function applyDreamImpressionUpdates(input) {
    const observer = text(input.observerGlobalMetaId);
    if (!observer)
        return { accepted: 0, created: 0, rejected: input.updates.length, rebuilt: 0 };
    const subjectMap = new Map(input.subjects.map((subject) => [subject.subjectGlobalMetaID, subject]));
    const result = { accepted: 0, created: 0, rejected: 0, rebuilt: 0 };
    const rebuiltSubjects = new Set();
    for (const update of input.updates) {
        const subjectGlobalMetaId = text(update.subjectGlobalMetaId);
        const subject = subjectGlobalMetaId ? subjectMap.get(subjectGlobalMetaId) : undefined;
        const episodeIds = [...new Set(update.episodeIds.map(text).filter(Boolean))];
        const evidenceIds = [...new Set(update.evidenceIds.map(text).filter(Boolean))];
        if (!subject
            || episodeIds.length === 0
            || evidenceIds.length === 0
            || episodeIds.some((id) => !subject.episodeIds.includes(id))
            || evidenceIds.some((id) => !subject.evidenceIds.includes(id))) {
            result.rejected += 1;
            continue;
        }
        try {
            const appended = await input.impressionStore.appendObservation({
                observerGlobalMetaId: observer,
                subjectGlobalMetaId,
                episodeId: episodeIds[0],
                evidenceIds,
                observationText: update.observation,
                interpretationText: update.interpretation,
                dimensions: update.dimensions,
                communicationGuidance: update.communicationGuidance,
                confidence: update.confidence,
                dreamDate: input.dreamDate,
                dreamVersion: input.dreamVersion,
                modelId: input.modelId,
                sourceHash: sourceHashForSubject(subject, input.dreamDate, input.dreamVersion),
            });
            result.accepted += 1;
            if (appended.created)
                result.created += 1;
            rebuiltSubjects.add(subjectGlobalMetaId);
        }
        catch {
            // A malformed subject must not prevent other subjects from being
            // consolidated, and the prior snapshot remains intact.
            result.rejected += 1;
        }
    }
    for (const subject of rebuiltSubjects) {
        try {
            if (await input.impressionStore.rebuildSnapshot(observer, subject))
                result.rebuilt += 1;
        }
        catch {
            // Observations remain durable and can be repaired on a later run.
        }
    }
    return result;
}
