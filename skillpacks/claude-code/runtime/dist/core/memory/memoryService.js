"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMemoryBlocksForRequest = buildMemoryBlocksForRequest;
exports.applyTurnMemoryExtraction = applyTurnMemoryExtraction;
const chatPersonaLoader_1 = require("../chat/chatPersonaLoader");
const cognitionContext_1 = require("./cognitionContext");
const dreamStore_1 = require("./dreamStore");
const experienceStore_1 = require("./experienceStore");
const experiencePromptBlocks_1 = require("./experiencePromptBlocks");
const impressionStore_1 = require("./impressionStore");
const knowledgePromptBlocks_1 = require("./knowledgePromptBlocks");
const knowledgeStore_1 = require("./knowledgeStore");
const memoryExtractor_1 = require("./memoryExtractor");
const memoryJudge_1 = require("./memoryJudge");
const memoryPromptBlocks_1 = require("./memoryPromptBlocks");
const memoryScopeResolver_1 = require("./memoryScopeResolver");
const memoryPolicy_1 = require("./memoryPolicy");
const memoryStore_1 = require("./memoryStore");
const memoryText_1 = require("./memoryText");
const OWNER_SCOPE_FETCH_MIN_ITEMS = 12;
const VALUE_BOUNDARIES_MAX_ITEMS = 5;
const WORK_REVIEWS_MAX_ITEMS = 5;
async function readSelfIdentityText(store) {
    const entries = await store.list({
        usageClass: 'self_identity',
        status: 'created',
        limit: 1,
    });
    return entries[0]?.text ?? '';
}
/**
 * Build the full memory injection for one turn: scoped fact blocks plus the
 * experience hot layer (self-identity, value boundaries, work reviews, recent
 * dream diaries). Knowledge blocks join in their own phase — the builders
 * already tolerate their absence.
 */
async function buildMemoryBlocksForRequest(paths, input, stores = {}) {
    const memory = stores.memory ?? (0, memoryStore_1.createMemoryStore)(paths);
    const policyStore = stores.policy ?? (0, memoryPolicy_1.createMemoryPolicyStore)(paths);
    const dream = stores.dream ?? (0, dreamStore_1.createDreamStore)(paths);
    const knowledge = stores.knowledge ?? (0, knowledgeStore_1.createKnowledgeStore)(paths);
    const policy = await policyStore.effectivePolicy();
    const resolution = (0, memoryScopeResolver_1.resolveMemoryScopes)({
        sourceChannel: input.channel,
        peerGlobalMetaId: input.peerGlobalMetaId,
        externalConversationId: input.externalConversationId,
    });
    if (!policy.memoryEnabled) {
        return { xml: '', policy, resolution };
    }
    const ownerEntries = await memory.list({
        scopeKind: 'owner',
        scopeKey: 'owner:self',
        status: 'created',
        limit: Math.max(policy.memoryUserMemoriesMaxItems, OWNER_SCOPE_FETCH_MIN_ITEMS),
        touchLastUsed: true,
    });
    let contactEntries = [];
    let conversationEntries = [];
    if (resolution.writeScope.kind === 'contact') {
        contactEntries = await memory.list({
            scope: resolution.writeScope,
            status: 'created',
            limit: policy.memoryUserMemoriesMaxItems,
            touchLastUsed: true,
        });
    }
    else if (resolution.writeScope.kind === 'conversation') {
        conversationEntries = await memory.list({
            scope: resolution.writeScope,
            status: 'created',
            limit: policy.memoryUserMemoriesMaxItems,
            touchLastUsed: true,
        });
    }
    const scopedXml = (0, memoryPromptBlocks_1.buildScopedMemoryPromptBlocks)({
        channel: input.channel,
        ownerEntries,
        contactEntries,
        conversationEntries,
        currentUserText: input.userText,
        maxScopedEntries: 12,
        maxOwnerOperationalPreferences: 3,
        maxTotalChars: policy.memoryPromptMaxChars,
    });
    // The experience hot layer describes the bot itself (self-identity, its
    // self-distilled conduct rules, its dream-written work reviews, its recent
    // dream diaries) — never owner facts — so it is injected for every channel,
    // matching the IDBots A2A path.
    const selfIdentityText = await readSelfIdentityText(memory);
    const valueBoundaries = await memory.list({
        usageClass: 'value_boundary',
        status: 'created',
        limit: VALUE_BOUNDARIES_MAX_ITEMS,
    });
    const workReviews = await memory.list({
        usageClass: 'work_review',
        status: 'created',
        limit: WORK_REVIEWS_MAX_ITEMS,
    });
    const recentSummaries = await dream.listDailySummaries({ limit: experiencePromptBlocks_1.RECENT_SUMMARIES_PROMPT_DAYS });
    const experienceXml = (0, experiencePromptBlocks_1.buildExperiencePromptBlocksXml)({
        identityText: selfIdentityText || null,
        summaries: recentSummaries.map((summary) => ({
            summaryDate: summary.summaryDate,
            summaryText: summary.summaryText,
            sessionRefs: summary.sessionRefs,
        })),
        valueBoundaries,
        workReviews,
    });
    // Knowledge hot layer: local (owner) sessions only, matching the IDBots
    // cowork channel — A2A replies do not get the knowledge block.
    let knowledgeXml = '';
    if (resolution.ownerReadPolicy === 'all') {
        const knowledgeEntries = await knowledge.listKnowledge({
            status: 'active',
            limit: knowledgePromptBlocks_1.KNOWLEDGE_PROMPT_MAX_ITEMS,
            touchLastUsed: true,
        });
        knowledgeXml = (0, knowledgePromptBlocks_1.buildKnowledgeBlock)(knowledgeEntries);
    }
    // Person-anchor cognition block for direct external (A2A 1:1) conversations.
    let cognitionXml = '';
    if (resolution.resolutionReason === 'contact_direct' && input.peerGlobalMetaId) {
        const experience = stores.experience ?? (0, experienceStore_1.createExperienceStore)(paths);
        const impressions = stores.impressions ?? (0, impressionStore_1.createImpressionStore)(paths, { experienceStore: experience });
        const persona = await (0, chatPersonaLoader_1.loadChatPersona)(paths);
        const observerGlobalMetaId = persona.identity?.globalMetaId ?? '';
        if (observerGlobalMetaId) {
            cognitionXml = await (0, cognitionContext_1.buildCognitionPromptBlock)({ experienceStore: experience, impressionStore: impressions }, { observerGlobalMetaId, subjectGlobalMetaId: input.peerGlobalMetaId });
        }
    }
    return {
        xml: [scopedXml, experienceXml, knowledgeXml, cognitionXml].filter(Boolean).join('\n\n'),
        policy,
        resolution,
    };
}
function emptyTurnResult() {
    return {
        totalChanges: 0,
        created: 0,
        updated: 0,
        deleted: 0,
        judgeRejected: 0,
        llmReviewed: 0,
        skipped: 0,
    };
}
/**
 * Post-turn memory write path: regex extraction (+ optional LLM judge for
 * borderline candidates), then create/revive or delete inside the resolved
 * write scope. Ported from CoworkStore.applyTurnMemoryUpdates.
 */
async function applyTurnMemoryExtraction(paths, options, stores = {}) {
    const memory = stores.memory ?? (0, memoryStore_1.createMemoryStore)(paths);
    const policyStore = stores.policy ?? (0, memoryPolicy_1.createMemoryPolicyStore)(paths);
    const policy = await policyStore.effectivePolicy();
    const result = emptyTurnResult();
    if (!policy.memoryEnabled) {
        return result;
    }
    const resolved = (0, memoryScopeResolver_1.resolveMemoryScopes)({
        sourceChannel: options.channel,
        peerGlobalMetaId: options.peerGlobalMetaId,
        externalConversationId: options.externalConversationId,
    });
    const extracted = (0, memoryExtractor_1.extractTurnMemoryChanges)({
        userText: options.userText,
        assistantText: options.assistantText,
        guardLevel: policy.memoryGuardLevel,
        maxImplicitAdds: policy.memoryImplicitUpdateEnabled ? 2 : 0,
    });
    result.totalChanges = extracted.length;
    for (const change of extracted) {
        if (change.action === 'add') {
            if (!policy.memoryImplicitUpdateEnabled && !change.isExplicit) {
                result.skipped += 1;
                continue;
            }
            const judge = await (0, memoryJudge_1.judgeMemoryCandidate)({
                text: change.text,
                isExplicit: change.isExplicit,
                guardLevel: policy.memoryGuardLevel,
                ...(policy.memoryLlmJudgeEnabled && options.judgeComplete
                    ? { judgeComplete: options.judgeComplete }
                    : {}),
            });
            if (judge.source === 'llm') {
                result.llmReviewed += 1;
            }
            if (!judge.accepted) {
                result.judgeRejected += 1;
                result.skipped += 1;
                continue;
            }
            const write = await memory.createOrRevive({
                text: change.text,
                confidence: change.confidence,
                isExplicit: change.isExplicit,
                scope: resolved.writeScope,
                source: {
                    role: 'user',
                    sessionId: options.sessionId,
                    messageId: options.userMessageId,
                    sourceChannel: options.channel,
                    sourceType: change.isExplicit ? 'turn_explicit' : 'turn_implicit',
                    sourceId: options.userMessageId,
                },
            });
            if (!change.isExplicit && options.assistantMessageId) {
                // The assistant half of the turn rides on the same entry as a source.
                await memory.addSource(write.memory.id, resolved.writeScope, {
                    role: 'assistant',
                    sessionId: options.sessionId,
                    messageId: options.assistantMessageId,
                    sourceChannel: options.channel,
                    sourceType: 'turn_assistant',
                    sourceId: options.assistantMessageId,
                });
            }
            if (write.created)
                result.created += 1;
            else if (write.updated)
                result.updated += 1;
            else
                result.skipped += 1;
            continue;
        }
        const key = (0, memoryText_1.normalizeMemoryMatchKey)(change.text);
        if (!key) {
            result.skipped += 1;
            continue;
        }
        const candidates = await memory.list({
            scope: resolved.writeScope,
            status: 'all',
            includeDeleted: false,
            limit: 100,
        });
        let target = null;
        let bestScore = 0;
        for (const entry of candidates) {
            const currentKey = (0, memoryText_1.normalizeMemoryMatchKey)(entry.text);
            if (!currentKey)
                continue;
            const score = (0, memoryText_1.scoreDeleteMatch)(currentKey, key);
            if (score <= bestScore)
                continue;
            bestScore = score;
            target = entry;
        }
        if (!target) {
            result.skipped += 1;
            continue;
        }
        const deleted = await memory.remove({
            id: target.id,
            scope: resolved.writeScope,
        });
        if (deleted)
            result.deleted += 1;
        else
            result.skipped += 1;
    }
    await memory.markOrphanImplicitMemoriesStale({ scope: resolved.writeScope });
    return result;
}
