"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrivateChatAutoReplyOrchestrator = createPrivateChatAutoReplyOrchestrator;
const privateChat_1 = require("./privateChat");
const chatPersonaLoader_1 = require("./chatPersonaLoader");
const conversationPersistence_1 = require("../a2a/conversationPersistence");
const simplemsgClassifier_1 = require("../a2a/simplemsgClassifier");
const privateChatSendFailureLog_1 = require("./privateChatSendFailureLog");
const DEFAULT_MAX_TURNS = 30;
const DEFAULT_MAX_IDLE_MS = 300_000;
const DEFAULT_RECENT_MESSAGES_LIMIT = 60;
const CLOSE_CONVERSATION_SIGNAL = 'Bye';
const CLOSE_CONVERSATION_FINAL_LINE_PATTERN = /^(?:bye|goodbye)[.!。！]?$/iu;
const MAX_REPLIES_PER_MINUTE = 10;
const MAX_REPLIES_PER_HOUR = 100;
// Order-protocol records (ORDER/ORDER_STATUS/DELIVERY/NeedsRating/ORDER_END)
// are service traffic, not conversation. Keep them out of the LLM chat
// context so a completed service exchange does not read as a finished
// conversation and nudge the model into closing the chat early.
function filterChatPromptMessages(messages) {
    return messages.filter((message) => (0, simplemsgClassifier_1.classifySimplemsgContent)(message.content).kind !== 'order_protocol');
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeTimestampMs(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric < 1_000_000_000_000 ? Math.floor(numeric * 1000) : Math.floor(numeric);
}
function buildConversationId(selfGlobalMetaId, peerGlobalMetaId) {
    return `pc-${selfGlobalMetaId}-${peerGlobalMetaId}`;
}
function buildMessageId(timestamp) {
    const random = Math.random().toString(36).slice(2, 10);
    return `msg-${timestamp}-${random}`;
}
function parseExtensions(content) {
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed.extensions ?? null;
        }
    }
    catch {
        // Not JSON, no extensions.
    }
    return null;
}
async function pendingGuidanceClaimStillMatchesState(stateStore, conversationId, claim) {
    const state = await stateStore.readState();
    const conversation = state.conversations.find(entry => entry.conversationId === conversationId) ?? null;
    return Boolean(conversation
        && normalizeText(conversation.pendingGuidanceText) === claim.guidanceText
        && conversation.pendingGuidanceCreatedAt === claim.createdAt
        && conversation.pendingGuidanceLeaseId === claim.leaseId
        && conversation.pendingGuidanceLeaseExpiresAt === claim.leaseExpiresAt);
}
function findFinalNonEmptyLineIndex(lines) {
    for (let index = lines.length - 1; index >= 0; index -= 1) {
        if (lines[index].trim()) {
            return index;
        }
    }
    return -1;
}
function hasFinalByeLine(value) {
    const lines = value.split(/\r?\n/u);
    const finalIndex = findFinalNonEmptyLineIndex(lines);
    return finalIndex >= 0 && CLOSE_CONVERSATION_FINAL_LINE_PATTERN.test(lines[finalIndex].trim());
}
function ensureFinalByeLine(value) {
    const content = normalizeText(value);
    if (!content) {
        return CLOSE_CONVERSATION_SIGNAL;
    }
    const lines = content.split(/\r?\n/u);
    const finalIndex = findFinalNonEmptyLineIndex(lines);
    if (finalIndex >= 0 && lines[finalIndex].trim().toLowerCase() === CLOSE_CONVERSATION_SIGNAL.toLowerCase()) {
        lines[finalIndex] = CLOSE_CONVERSATION_SIGNAL;
        return lines.join('\n').trim();
    }
    return `${content}\n${CLOSE_CONVERSATION_SIGNAL}`;
}
// Drop a trailing close marker from an outbound turn that must not close the
// conversation (session-opening guided turns); the farewell text above it
// stays, only the marker line is removed.
function stripFinalByeLine(value) {
    const lines = value.split(/\r?\n/u);
    const finalIndex = findFinalNonEmptyLineIndex(lines);
    if (finalIndex >= 0 && CLOSE_CONVERSATION_FINAL_LINE_PATTERN.test(lines[finalIndex].trim())) {
        lines.splice(finalIndex, 1);
    }
    return lines.join('\n').trim();
}
async function shouldResetIdleTurnCount(input) {
    const [latestMessage] = await input.stateStore.getRecentMessages(input.conversationId, 1);
    if (!latestMessage || !Number.isFinite(latestMessage.timestamp)) {
        return false;
    }
    return normalizeTimestampMs(input.inboundTimestamp) - normalizeTimestampMs(latestMessage.timestamp) > input.maxIdleMs;
}
async function conversationHasOutboundSince(input) {
    const sinceTimestamp = normalizeTimestampMs(input.sinceTimestamp);
    if (!sinceTimestamp) {
        return false;
    }
    const state = await input.stateStore.readState();
    return state.messages.some((message) => message.conversationId === input.conversationId
        && message.direction === 'outbound'
        && normalizeTimestampMs(message.timestamp) > sinceTimestamp);
}
async function latestConversationMessageMatches(input) {
    const latestMessages = await input.stateStore.getRecentMessages(input.conversationId, 1);
    const latestMessage = latestMessages.at(-1) ?? null;
    return Boolean(latestMessage && latestMessage.messageId === input.expectedMessageId);
}
function checkRateLimit(rateLimiter, now) {
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;
    rateLimiter.replyTimestamps = rateLimiter.replyTimestamps.filter(t => t > oneHourAgo);
    const repliesLastMinute = rateLimiter.replyTimestamps.filter(t => t > oneMinuteAgo).length;
    const repliesLastHour = rateLimiter.replyTimestamps.length;
    return repliesLastMinute < MAX_REPLIES_PER_MINUTE && repliesLastHour < MAX_REPLIES_PER_HOUR;
}
// Per-bot config values win over strategy values; the defaults are the last
// resort for runtime configs constructed without the new fields.
function resolveEffectiveStrategy(strategy, config) {
    return {
        id: strategy?.id ?? 'default',
        maxTurns: config.maxTurns ?? strategy?.maxTurns ?? DEFAULT_MAX_TURNS,
        maxIdleMs: config.cooldownMs ?? strategy?.maxIdleMs ?? DEFAULT_MAX_IDLE_MS,
        exitCriteria: strategy?.exitCriteria ?? '',
    };
}
function createPrivateChatAutoReplyOrchestrator(deps, config) {
    const rateLimiter = { replyTimestamps: [] };
    const activeInboundReplies = new Set();
    const getNow = deps.now ?? (() => Date.now());
    async function sendReplyMessage(selfGlobalMetaId, peerGlobalMetaId, content, extensions) {
        let privateChatIdentity;
        try {
            privateChatIdentity = await deps.signer.getPrivateChatIdentity();
        }
        catch (error) {
            deps.logSendFailure?.({
                kind: 'identity_unavailable',
                peerGlobalMetaId,
                error: (0, privateChatSendFailureLog_1.describePrivateChatSendFailureError)(error),
            });
            return null;
        }
        let peerChatPublicKey = null;
        try {
            peerChatPublicKey = await deps.resolvePeerChatPublicKey(peerGlobalMetaId);
        }
        catch (error) {
            deps.logSendFailure?.({
                kind: 'peer_chat_key_unavailable',
                peerGlobalMetaId,
                error: (0, privateChatSendFailureLog_1.describePrivateChatSendFailureError)(error),
            });
            return null;
        }
        if (!peerChatPublicKey) {
            deps.logSendFailure?.({
                kind: 'peer_chat_key_unavailable',
                peerGlobalMetaId,
                error: null,
            });
            return null;
        }
        const messageContent = extensions
            ? JSON.stringify({ content, extensions })
            : content;
        const sent = (0, privateChat_1.sendPrivateChat)({
            fromIdentity: {
                globalMetaId: privateChatIdentity.globalMetaId,
                privateKeyHex: privateChatIdentity.privateKeyHex,
            },
            toGlobalMetaId: peerGlobalMetaId,
            peerChatPublicKey,
            content: messageContent,
        });
        try {
            const chatWrite = await deps.signer.writePin({
                operation: 'create',
                path: sent.path,
                encryption: sent.encryption,
                version: sent.version,
                contentType: sent.contentType,
                payload: sent.payload,
                encoding: 'utf-8',
                network: 'mvc',
            });
            return {
                pinId: normalizeText(chatWrite.pinId) || null,
                txids: Array.isArray(chatWrite.txids)
                    ? chatWrite.txids.map((entry) => normalizeText(entry)).filter(Boolean)
                    : [],
                network: normalizeText(chatWrite.network) || null,
            };
        }
        catch (error) {
            deps.logSendFailure?.({
                kind: 'pin_write_failed',
                peerGlobalMetaId,
                error: (0, privateChatSendFailureLog_1.describePrivateChatSendFailureError)(error),
            });
            return null;
        }
    }
    async function prepareOutboundTurn(input) {
        const conversationCloseAllowed = input.conversationCloseAllowed !== false;
        let runnerResult;
        try {
            runnerResult = await deps.replyRunner({
                conversation: input.conversation,
                recentMessages: input.recentMessages,
                persona: input.persona,
                strategy: input.strategy,
                inboundMessage: input.inboundMessage,
                operatorGuidanceText: input.operatorGuidanceText ?? null,
                conversationCloseAllowed,
            });
        }
        catch {
            return null;
        }
        if (runnerResult.state === 'skip') {
            return null;
        }
        let content = normalizeText(runnerResult.content);
        let shouldClose = runnerResult.state === 'end_conversation' || hasFinalByeLine(content);
        if (shouldClose && !conversationCloseAllowed) {
            content = normalizeText(stripFinalByeLine(content));
            shouldClose = false;
        }
        if (shouldClose) {
            content = ensureFinalByeLine(content);
        }
        if (!content) {
            return null;
        }
        return {
            content,
            extensions: shouldClose ? null : runnerResult.extensions ?? null,
            shouldClose,
        };
    }
    async function commitOutboundTurn(input) {
        let outboundReply = null;
        try {
            if (input.guidanceToConsume
                && await conversationHasOutboundSince({
                    stateStore: deps.stateStore,
                    conversationId: input.conversation.conversationId,
                    sinceTimestamp: input.guidanceToConsume.createdAt,
                })) {
                await deps.stateStore.clearPendingGuidanceIfMatches(input.conversation.conversationId, input.guidanceToConsume.guidanceText, input.guidanceToConsume.createdAt, input.guidanceToConsume.leaseId).catch(() => null);
                return null;
            }
            if (input.guidanceToConsume
                && !(await pendingGuidanceClaimStillMatchesState(deps.stateStore, input.conversation.conversationId, input.guidanceToConsume))) {
                await deps.stateStore.releasePendingGuidanceClaimIfMatches(input.conversation.conversationId, input.guidanceToConsume).catch(() => null);
                return null;
            }
            if (input.triggerMessageId
                && !(await latestConversationMessageMatches({
                    stateStore: deps.stateStore,
                    conversationId: input.conversation.conversationId,
                    expectedMessageId: input.triggerMessageId,
                }))) {
                if (input.guidanceToConsume) {
                    await deps.stateStore.releasePendingGuidanceClaimIfMatches(input.conversation.conversationId, input.guidanceToConsume).catch(() => null);
                }
                return null;
            }
            outboundReply = await sendReplyMessage(input.selfGlobalMetaId, input.peerGlobalMetaId, input.content, input.extensions);
            if (!outboundReply) {
                if (input.guidanceToConsume) {
                    await deps.stateStore.releasePendingGuidanceClaimIfMatches(input.conversation.conversationId, input.guidanceToConsume);
                }
                return null;
            }
            const timestamp = getNow();
            const outboundRecord = {
                conversationId: input.conversation.conversationId,
                messageId: outboundReply.pinId || buildMessageId(timestamp),
                direction: 'outbound',
                senderGlobalMetaId: input.selfGlobalMetaId,
                content: input.content,
                messagePinId: outboundReply.pinId,
                extensions: input.extensions,
                timestamp,
            };
            await deps.stateStore.appendMessages([outboundRecord]);
            await (0, conversationPersistence_1.persistA2AConversationMessageBestEffort)({
                paths: deps.paths,
                local: {
                    globalMetaId: input.selfGlobalMetaId,
                },
                peer: {
                    globalMetaId: input.peerGlobalMetaId,
                },
                message: {
                    messageId: outboundRecord.messageId,
                    direction: 'outgoing',
                    content: outboundRecord.content,
                    pinId: outboundRecord.messagePinId,
                    txid: outboundReply.txids[0] ?? null,
                    txids: outboundReply.txids,
                    chain: outboundReply.network ?? 'mvc',
                    timestamp: outboundRecord.timestamp,
                },
            }, deps.a2aConversationPersister);
            const latestConversation = await deps.stateStore.getConversationByPeer(input.peerGlobalMetaId);
            let updatedConversation = {
                ...input.conversation,
                state: input.shouldClose ? 'closed' : 'active',
                lastDirection: 'outbound',
                updatedAt: timestamp,
                pendingGuidanceText: latestConversation?.pendingGuidanceText ?? input.conversation.pendingGuidanceText,
                pendingGuidanceCreatedAt: latestConversation?.pendingGuidanceCreatedAt ?? input.conversation.pendingGuidanceCreatedAt,
                pendingGuidanceLeaseId: latestConversation?.pendingGuidanceLeaseId ?? input.conversation.pendingGuidanceLeaseId ?? null,
                pendingGuidanceLeaseExpiresAt: latestConversation?.pendingGuidanceLeaseExpiresAt ?? input.conversation.pendingGuidanceLeaseExpiresAt ?? null,
            };
            await deps.stateStore.upsertConversation(updatedConversation);
            if (input.guidanceToConsume) {
                updatedConversation = await deps.stateStore.clearPendingGuidanceIfMatches(input.conversation.conversationId, input.guidanceToConsume.guidanceText, input.guidanceToConsume.createdAt, input.guidanceToConsume.leaseId) ?? updatedConversation;
            }
            return updatedConversation;
        }
        catch {
            if (input.guidanceToConsume) {
                if (outboundReply) {
                    await deps.stateStore.clearPendingGuidanceIfMatches(input.conversation.conversationId, input.guidanceToConsume.guidanceText, input.guidanceToConsume.createdAt, input.guidanceToConsume.leaseId).catch(() => null);
                }
                else {
                    await deps.stateStore.releasePendingGuidanceClaimIfMatches(input.conversation.conversationId, input.guidanceToConsume).catch(() => null);
                }
            }
            return null;
        }
    }
    async function replyToInboundMessage(input) {
        const replyKey = `${input.conversation.conversationId}:${input.inboundMessage.messageId}`;
        if (activeInboundReplies.has(replyKey))
            return false;
        if (!checkRateLimit(rateLimiter, getNow()))
            return false;
        activeInboundReplies.add(replyKey);
        try {
            const guidanceWasPending = Boolean(normalizeText(input.conversation.pendingGuidanceText)
                && typeof input.conversation.pendingGuidanceCreatedAt === 'number');
            const guidanceToConsume = guidanceWasPending
                ? await deps.stateStore.claimPendingGuidance(input.conversation.conversationId, { now: getNow() })
                : null;
            if (guidanceWasPending && !guidanceToConsume)
                return false;
            const maxTurns = input.strategy?.maxTurns ?? DEFAULT_MAX_TURNS;
            if (input.conversation.turnCount >= maxTurns && !guidanceToConsume) {
                const committedConversation = await commitOutboundTurn({
                    selfGlobalMetaId: input.selfGlobalMetaId,
                    peerGlobalMetaId: input.peerGlobalMetaId,
                    conversation: input.conversation,
                    content: ensureFinalByeLine('It was great chatting with you. Let us continue another time.'),
                    extensions: null,
                    shouldClose: true,
                    triggerMessageId: input.inboundMessage.messageId,
                });
                if (!committedConversation)
                    return false;
                rateLimiter.replyTimestamps.push(getNow());
                return true;
            }
            const persona = await (0, chatPersonaLoader_1.loadChatPersona)(deps.paths);
            const recentMessages = filterChatPromptMessages(await deps.stateStore.getRecentMessages(input.conversation.conversationId, DEFAULT_RECENT_MESSAGES_LIMIT));
            const preparedTurn = await prepareOutboundTurn({
                conversation: input.conversation,
                recentMessages,
                persona,
                strategy: input.strategy,
                inboundMessage: input.inboundMessage,
                operatorGuidanceText: guidanceToConsume?.guidanceText ?? null,
            });
            if (!preparedTurn) {
                if (guidanceToConsume) {
                    await deps.stateStore.releasePendingGuidanceClaimIfMatches(input.conversation.conversationId, guidanceToConsume);
                }
                return false;
            }
            const committedConversation = await commitOutboundTurn({
                selfGlobalMetaId: input.selfGlobalMetaId,
                peerGlobalMetaId: input.peerGlobalMetaId,
                conversation: input.conversation,
                content: preparedTurn.content,
                extensions: preparedTurn.extensions,
                shouldClose: preparedTurn.shouldClose,
                triggerMessageId: input.inboundMessage.messageId,
                guidanceToConsume,
            });
            if (!committedConversation)
                return false;
            rateLimiter.replyTimestamps.push(getNow());
            return true;
        }
        finally {
            activeInboundReplies.delete(replyKey);
        }
    }
    return {
        async retryPendingInboundMessage(peerGlobalMetaId) {
            if (!config.enabled)
                return false;
            const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
            const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
            if (!selfGlobalMetaId || !normalizedPeerGlobalMetaId)
                return false;
            const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
            if (!conversation || conversation.state !== 'active' || conversation.lastDirection !== 'inbound') {
                return false;
            }
            const [latestMessage] = await deps.stateStore.getRecentMessages(conversation.conversationId, 1);
            if (!latestMessage
                || latestMessage.direction !== 'inbound'
                || hasFinalByeLine(latestMessage.content)
                || (0, simplemsgClassifier_1.classifySimplemsgContent)(latestMessage.content).kind !== 'private_chat') {
                return false;
            }
            const strategy = resolveEffectiveStrategy(conversation.strategyId
                ? await deps.strategyStore.getStrategy(conversation.strategyId)
                : null, config);
            return replyToInboundMessage({
                selfGlobalMetaId,
                peerGlobalMetaId: normalizedPeerGlobalMetaId,
                conversation,
                inboundMessage: latestMessage,
                strategy,
            });
        },
        async retryOutboundMessage(peerGlobalMetaId, message) {
            if (message.direction !== 'outbound')
                return false;
            const selfGlobalMetaId = normalizeText(await deps.selfGlobalMetaId());
            const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
            if (!selfGlobalMetaId || !normalizedPeerGlobalMetaId)
                return false;
            if (!(await latestConversationMessageMatches({
                stateStore: deps.stateStore,
                conversationId: message.conversationId,
                expectedMessageId: message.messageId,
            }))) {
                return false;
            }
            const outboundReply = await sendReplyMessage(selfGlobalMetaId, normalizedPeerGlobalMetaId, message.content, message.extensions);
            if (!outboundReply)
                return false;
            const timestamp = getNow();
            const failedPinIds = Array.from(new Set([
                ...(message.deliveryRecovery?.failedPinIds ?? []),
                normalizeText(message.messagePinId),
            ].filter(Boolean)));
            const deliveryRecovery = {
                failedPinIds,
                retryCount: (message.deliveryRecovery?.retryCount ?? 0) + 1,
            };
            const replacement = {
                ...message,
                senderGlobalMetaId: selfGlobalMetaId,
                messagePinId: outboundReply.pinId,
                timestamp,
                deliveryRecovery,
            };
            const replaced = await deps.stateStore.replaceMessage(message.messageId, replacement);
            if (!replaced)
                return false;
            await (0, conversationPersistence_1.persistA2AConversationMessageBestEffort)({
                paths: deps.paths,
                local: {
                    globalMetaId: selfGlobalMetaId,
                },
                peer: {
                    globalMetaId: normalizedPeerGlobalMetaId,
                },
                message: {
                    messageId: message.messageId,
                    direction: 'outgoing',
                    content: message.content,
                    pinId: outboundReply.pinId,
                    txid: outboundReply.txids[0] ?? null,
                    txids: outboundReply.txids,
                    chain: outboundReply.network ?? 'mvc',
                    timestamp,
                    raw: { deliveryRecovery },
                },
                replaceExistingMessage: true,
            }, deps.a2aConversationPersister);
            const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
            if (conversation) {
                await deps.stateStore.upsertConversation({
                    ...conversation,
                    lastDirection: 'outbound',
                    updatedAt: timestamp,
                });
            }
            return true;
        },
        async handleInboundMessage(message) {
            const selfGlobalMetaId = await deps.selfGlobalMetaId();
            if (!selfGlobalMetaId)
                return;
            const now = getNow();
            const peerGlobalMetaId = normalizeText(message.fromGlobalMetaId);
            if (!peerGlobalMetaId)
                return;
            const conversationId = buildConversationId(selfGlobalMetaId, peerGlobalMetaId);
            const inboundTimestamp = normalizeTimestampMs(message.timestamp) || now;
            // ---- Shared: conversation lifecycle & message storage ----
            let conversation = await deps.stateStore.getConversationByPeer(peerGlobalMetaId) ?? {
                conversationId,
                peerGlobalMetaId,
                peerName: null,
                topic: null,
                strategyId: config.defaultStrategyId,
                state: 'active',
                turnCount: 0,
                lastDirection: 'inbound',
                createdAt: now,
                updatedAt: now,
                pendingGuidanceText: null,
                pendingGuidanceCreatedAt: null,
                pendingGuidanceLeaseId: null,
                pendingGuidanceLeaseExpiresAt: null,
            };
            const strategy = resolveEffectiveStrategy(conversation.strategyId
                ? await deps.strategyStore.getStrategy(conversation.strategyId)
                : null, config);
            const maxIdleMs = strategy.maxIdleMs;
            const shouldReopenClosedConversation = conversation.state === 'closed'
                && now - conversation.updatedAt > maxIdleMs;
            if (shouldReopenClosedConversation) {
                conversation = {
                    ...conversation,
                    state: 'active',
                    turnCount: 0,
                };
            }
            if (conversation.state !== 'closed' && await shouldResetIdleTurnCount({
                stateStore: deps.stateStore,
                conversationId: conversation.conversationId,
                inboundTimestamp,
                maxIdleMs,
            })) {
                conversation = {
                    ...conversation,
                    turnCount: 0,
                };
            }
            const simplemsgClassification = (0, simplemsgClassifier_1.classifySimplemsgContent)(message.content);
            const inboundMessageRecord = {
                conversationId: conversation.conversationId,
                messageId: message.messagePinId || buildMessageId(now),
                direction: 'inbound',
                senderGlobalMetaId: peerGlobalMetaId,
                content: message.content,
                messagePinId: message.messagePinId,
                extensions: parseExtensions(message.content),
                timestamp: inboundTimestamp,
            };
            const appendedInboundMessages = await deps.stateStore.appendMessages([inboundMessageRecord]);
            if (appendedInboundMessages.length === 0) {
                return;
            }
            conversation = {
                ...conversation,
                lastDirection: 'inbound',
                updatedAt: now,
            };
            await (0, conversationPersistence_1.persistA2AConversationMessageBestEffort)({
                paths: deps.paths,
                local: {
                    globalMetaId: selfGlobalMetaId,
                },
                peer: {
                    globalMetaId: peerGlobalMetaId,
                    chatPublicKey: message.fromChatPublicKey,
                },
                message: {
                    messageId: inboundMessageRecord.messageId,
                    direction: 'incoming',
                    content: inboundMessageRecord.content,
                    contentType: message.contentType,
                    pinId: inboundMessageRecord.messagePinId,
                    timestamp: inboundMessageRecord.timestamp,
                    raw: message.rawMessage,
                },
            }, deps.a2aConversationPersister);
            if (conversation.state === 'closed') {
                await deps.stateStore.upsertConversation(conversation);
                return;
            }
            // ---- Order-protocol path: record-only, no turn counting, no reply ----
            if (simplemsgClassification.kind === 'order_protocol') {
                await deps.stateStore.upsertConversation(conversation);
                return;
            }
            // Inbound messages are always persisted above so they stay visible and
            // recoverable; only the automated reply is gated by the enabled flag.
            if (!config.enabled)
                return;
            // ---- Private-chat path: turn counting, cooldown, reply runner ----
            conversation = {
                ...conversation,
                turnCount: conversation.turnCount + 1,
            };
            await deps.stateStore.upsertConversation(conversation);
            // Check for the natural-language closing signal from peer.
            if (hasFinalByeLine(message.content)) {
                conversation = { ...conversation, state: 'closed', updatedAt: now };
                await deps.stateStore.upsertConversation(conversation);
                return;
            }
            if (conversation.state !== 'active')
                return;
            await replyToInboundMessage({
                selfGlobalMetaId,
                peerGlobalMetaId,
                conversation,
                strategy,
                inboundMessage: inboundMessageRecord,
            });
        },
        async handleLocalGuidedTurn(peerGlobalMetaId, options = {}) {
            const selfGlobalMetaId = await deps.selfGlobalMetaId();
            if (!selfGlobalMetaId)
                return;
            const normalizedPeerGlobalMetaId = normalizeText(peerGlobalMetaId);
            if (!normalizedPeerGlobalMetaId)
                return;
            const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
            if (!conversation)
                return;
            if (conversation.state !== 'active' && conversation.state !== 'closed')
                return;
            const strategy = resolveEffectiveStrategy(conversation.strategyId
                ? await deps.strategyStore.getStrategy(conversation.strategyId)
                : null, config);
            const guidanceToConsume = options.guidanceToConsume
                ?? await deps.stateStore.claimPendingGuidance(conversation.conversationId, { now: getNow() });
            if (!guidanceToConsume)
                return;
            const runnerConversation = conversation.state === 'closed'
                ? {
                    ...conversation,
                    state: 'active',
                    turnCount: 1,
                }
                : {
                    ...conversation,
                    turnCount: conversation.turnCount + 1,
                };
            const persona = await (0, chatPersonaLoader_1.loadChatPersona)(deps.paths);
            const recentMessages = filterChatPromptMessages(await deps.stateStore.getRecentMessages(conversation.conversationId, DEFAULT_RECENT_MESSAGES_LIMIT));
            const preparedTurn = await prepareOutboundTurn({
                conversation: runnerConversation,
                recentMessages,
                persona,
                strategy,
                inboundMessage: null,
                operatorGuidanceText: guidanceToConsume.guidanceText,
                // A guided turn that opens a new session (turnCount 1, fresh or
                // reopened) is the operator reaching out — it must not carry a close
                // marker, or the peer side would instantly re-close the conversation.
                conversationCloseAllowed: runnerConversation.turnCount > 1,
            });
            if (!preparedTurn) {
                await deps.stateStore.releasePendingGuidanceClaimIfMatches(conversation.conversationId, guidanceToConsume);
                return;
            }
            const committedConversation = await commitOutboundTurn({
                selfGlobalMetaId,
                peerGlobalMetaId: normalizedPeerGlobalMetaId,
                conversation: runnerConversation,
                content: preparedTurn.content,
                extensions: preparedTurn.extensions,
                shouldClose: preparedTurn.shouldClose,
                guidanceToConsume,
            });
            if (!committedConversation)
                return;
            rateLimiter.replyTimestamps.push(getNow());
        },
    };
}
