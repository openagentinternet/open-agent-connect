"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unwrapPrivateChatContent = unwrapPrivateChatContent;
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
// Outbound-message extension markers for the chat-skill wait notice: they let
// retries dedupe against conversation history and let the staleness guard
// skip notices when checking whether a newer peer message has arrived.
const CHAT_SKILL_WAIT_NOTICE_EXTENSION = 'chatSkillWaitNotice';
const CHAT_SKILL_WAIT_NOTICE_FOR_EXTENSION = 'chatSkillWaitNoticeForMessageId';
function hasSentChatSkillWaitNotice(messages, forMessageId) {
    return messages.some((message) => (message.direction === 'outbound'
        && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_EXTENSION] === true
        && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_FOR_EXTENSION] === forMessageId));
}
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
// The simplemsg wire format wraps extension-carrying messages as
// {"content": "...", "extensions": {...}}. Inbound records must store the
// unwrapped text (like outbound records do), otherwise raw JSON leaks into
// the LLM prompt history. Exported so prompt builders can also unwrap
// legacy records that were stored with the wrapper still on.
function unwrapPrivateChatContent(raw) {
    try {
        const parsed = JSON.parse(raw);
        if (parsed
            && typeof parsed === 'object'
            && !Array.isArray(parsed)
            && typeof parsed.content === 'string'
            && Object.hasOwn(parsed, 'extensions')) {
            return {
                content: parsed.content,
                extensions: parsed.extensions ?? null,
            };
        }
    }
    catch {
        // Not a wrapper payload.
    }
    return { content: raw, extensions: null };
}
// Prompt-context helper: unwrap legacy inbound records whose stored content
// still carries the {"content","extensions"} wire wrapper, so every consumer
// downstream (history rendering, notice dedupe, moved-past checks) sees plain
// text. New records are already stored unwrapped; this is idempotent.
function unwrapLegacyInboundContents(messages) {
    return messages.map((message) => (message.direction === 'inbound'
        ? { ...message, content: unwrapPrivateChatContent(message.content).content }
        : message));
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
    // Scan a small tail instead of only the very last record: our own interim
    // chat-skill wait notices are appended to the store while the turn is still
    // being composed, and must not count as "a newer message arrived".
    const latestMessages = await input.stateStore.getRecentMessages(input.conversationId, 5);
    const latestSignificantMessage = [...latestMessages].reverse().find((message) => !(message.direction === 'outbound'
        && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_EXTENSION] === true));
    return Boolean(latestSignificantMessage && latestSignificantMessage.messageId === input.expectedMessageId);
}
function checkRateLimit(rateLimiter, now) {
    const oneMinuteAgo = now - 60_000;
    const oneHourAgo = now - 3_600_000;
    rateLimiter.replyTimestamps = rateLimiter.replyTimestamps.filter(t => t > oneHourAgo);
    const repliesLastMinute = rateLimiter.replyTimestamps.filter(t => t > oneMinuteAgo).length;
    const repliesLastHour = rateLimiter.replyTimestamps.length;
    return repliesLastMinute < MAX_REPLIES_PER_MINUTE && repliesLastHour < MAX_REPLIES_PER_HOUR;
}
// True when the conversation has moved past the given message: either a
// newer inbound arrived (only the latest message of a burst should be
// answered, IDBots-style) or a non-notice outbound already answered it. Used
// both to skip queued reply turns BEFORE paying for an LLM call and as the
// commit-time staleness guard before sending.
async function conversationMovedPastMessage(input) {
    const recentMessages = await input.stateStore.getRecentMessages(input.conversationId, 20);
    const triggerIndex = recentMessages.findIndex((message) => message.messageId === input.messageId);
    if (triggerIndex < 0) {
        return false;
    }
    return recentMessages.slice(triggerIndex + 1).some((message) => (message.direction === 'inbound'
        || (message.direction === 'outbound'
            && message.extensions?.[CHAT_SKILL_WAIT_NOTICE_EXTENSION] !== true)));
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
    // Reply turns are serialized per conversation: back-to-back inbound messages
    // must not spawn concurrent LLM turns (lost turnCount increments, replies
    // discarded only after the LLM call was paid for). Different conversations
    // still run concurrently. The chain never wedges on a rejected promise and
    // entries are removed once drained.
    const conversationTurnChains = new Map();
    async function runSerializedConversationTurn(conversationId, turn) {
        const previous = conversationTurnChains.get(conversationId) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(turn);
        conversationTurnChains.set(conversationId, current);
        try {
            return await current;
        }
        finally {
            if (conversationTurnChains.get(conversationId) === current) {
                conversationTurnChains.delete(conversationId);
            }
        }
    }
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
    // Sends the interim "please wait" notice for a chat-skill execution and
    // records it like a normal outbound message, so conversation history (and
    // later retry dedupe) reflects what the peer actually saw.
    async function sendChatSkillWaitNotice(input) {
        if (!deps.chatSkillWaitNotice)
            return;
        try {
            const text = normalizeText(await deps.chatSkillWaitNotice({
                conversation: input.conversation,
                inboundMessage: input.inboundMessage,
                persona: input.persona,
            }));
            if (!text)
                return;
            const extensions = {
                [CHAT_SKILL_WAIT_NOTICE_EXTENSION]: true,
                [CHAT_SKILL_WAIT_NOTICE_FOR_EXTENSION]: input.inboundMessage.messageId,
            };
            const sent = await sendReplyMessage(input.selfGlobalMetaId, input.peerGlobalMetaId, text, extensions);
            if (!sent)
                return;
            const timestamp = getNow();
            const outboundRecord = {
                conversationId: input.conversation.conversationId,
                messageId: sent.pinId || buildMessageId(timestamp),
                direction: 'outbound',
                senderGlobalMetaId: input.selfGlobalMetaId,
                content: text,
                messagePinId: sent.pinId,
                extensions,
                timestamp,
            };
            await deps.stateStore.appendMessages([outboundRecord]).catch(() => undefined);
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
                    txid: sent.txids[0] ?? null,
                    txids: sent.txids,
                    chain: sent.network ?? 'mvc',
                    timestamp: outboundRecord.timestamp,
                },
            }, deps.a2aConversationPersister);
        }
        catch {
            // The wait notice is strictly best-effort; skill execution continues.
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
                onSkillExecutionStart: input.onSkillExecutionStart,
            });
        }
        catch (error) {
            // Never let a throwing runner crash the daemon loop, but never leave the
            // peer's silence unexplained either.
            deps.logSendFailure?.({
                kind: 'reply_runner_failed',
                peerGlobalMetaId: input.conversation.peerGlobalMetaId,
                error: (0, privateChatSendFailureLog_1.describePrivateChatSendFailureError)(error),
            });
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
                && await conversationMovedPastMessage({
                    stateStore: deps.stateStore,
                    conversationId: input.conversation.conversationId,
                    messageId: input.triggerMessageId,
                })) {
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
        catch (error) {
            deps.logSendFailure?.({
                kind: 'reply_commit_failed',
                peerGlobalMetaId: input.peerGlobalMetaId,
                error: (0, privateChatSendFailureLog_1.describePrivateChatSendFailureError)(error),
            });
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
        if (!checkRateLimit(rateLimiter, getNow())) {
            // A dropped reply is peer-visible silence; make it diagnosable. The
            // backfill may retry this message later.
            deps.logSendFailure?.({
                kind: 'rate_limited',
                peerGlobalMetaId: input.peerGlobalMetaId,
                error: `reply rate limit exceeded (max ${MAX_REPLIES_PER_MINUTE}/min, ${MAX_REPLIES_PER_HOUR}/h)`,
            });
            return false;
        }
        // This turn may have waited in the per-conversation queue while the
        // conversation moved on (a newer inbound arrived, or an earlier turn
        // already answered this message). Skip it BEFORE paying for an LLM call;
        // the commit-time guard applies the same moved-past check before sending.
        if (await conversationMovedPastMessage({
            stateStore: deps.stateStore,
            conversationId: input.conversation.conversationId,
            messageId: input.inboundMessage.messageId,
        })) {
            return false;
        }
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
            const recentMessages = unwrapLegacyInboundContents(filterChatPromptMessages(await deps.stateStore.getRecentMessages(input.conversation.conversationId, DEFAULT_RECENT_MESSAGES_LIMIT)));
            // Interim "please wait" notice (IDBots-style): fired by the reply runner
            // when an allowed chat skill actually starts executing. Sent at most once
            // per inbound message, deduped against history so a later retry of the
            // same message does not re-notify the peer.
            const waitNoticeState = {
                sent: false,
                promise: null,
            };
            const onSkillExecutionStart = deps.chatSkillWaitNotice
                ? () => {
                    if (waitNoticeState.sent)
                        return;
                    waitNoticeState.sent = true;
                    if (hasSentChatSkillWaitNotice(recentMessages, input.inboundMessage.messageId))
                        return;
                    waitNoticeState.promise = sendChatSkillWaitNotice({
                        selfGlobalMetaId: input.selfGlobalMetaId,
                        peerGlobalMetaId: input.peerGlobalMetaId,
                        conversation: input.conversation,
                        inboundMessage: input.inboundMessage,
                        persona,
                    });
                }
                : undefined;
            const preparedTurn = await prepareOutboundTurn({
                conversation: input.conversation,
                recentMessages,
                persona,
                strategy: input.strategy,
                inboundMessage: input.inboundMessage,
                operatorGuidanceText: guidanceToConsume?.guidanceText ?? null,
                onSkillExecutionStart,
            });
            if (!preparedTurn) {
                if (guidanceToConsume) {
                    await deps.stateStore.releasePendingGuidanceClaimIfMatches(input.conversation.conversationId, guidanceToConsume);
                }
                return false;
            }
            // Keep wire order for the peer: the wait notice (if one went out during
            // the LLM turn) must settle before the final reply is sent.
            await waitNoticeState.promise;
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
            // Active-order suppression gates the recovery path too: a message that
            // arrived mid-order must not get a late free-chat reply while the order
            // is still open.
            if (await deps.hasActiveOrderWithPeer?.(normalizedPeerGlobalMetaId))
                return false;
            const conversation = await deps.stateStore.getConversationByPeer(normalizedPeerGlobalMetaId);
            if (!conversation || conversation.state !== 'active' || conversation.lastDirection !== 'inbound') {
                return false;
            }
            // A live or queued reply turn for this conversation already covers the
            // pending message; recovery must not line up behind it.
            if (conversationTurnChains.has(conversation.conversationId)) {
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
            return runSerializedConversationTurn(conversation.conversationId, () => replyToInboundMessage({
                selfGlobalMetaId,
                peerGlobalMetaId: normalizedPeerGlobalMetaId,
                conversation,
                inboundMessage: latestMessage,
                strategy,
            }));
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
            // Unwrap the {"content","extensions"} wire envelope up front so
            // classification, the Bye check, the stored record, and the LLM prompt
            // all see plain text instead of raw JSON.
            const inboundWireContent = unwrapPrivateChatContent(message.content);
            const simplemsgClassification = (0, simplemsgClassifier_1.classifySimplemsgContent)(inboundWireContent.content);
            const inboundMessageRecord = {
                conversationId: conversation.conversationId,
                messageId: message.messagePinId || buildMessageId(now),
                direction: 'inbound',
                senderGlobalMetaId: peerGlobalMetaId,
                content: inboundWireContent.content,
                messagePinId: message.messagePinId,
                extensions: inboundWireContent.extensions,
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
            // ---- Active-order suppression: record-only, no turn counting, no reply ----
            // While an order with this peer is open, free-chat auto-replies stay
            // silent (IDBots hasActiveOrderForPrivateChatSuppression parity). The
            // message is already persisted; like the order-protocol path above it
            // does not count turns. Suppression lifts automatically once the order
            // reaches a terminal state.
            if (await deps.hasActiveOrderWithPeer?.(peerGlobalMetaId)) {
                await deps.stateStore.upsertConversation(conversation);
                return;
            }
            // ---- Private-chat path: turn counting, cooldown, reply runner ----
            await runSerializedConversationTurn(conversation.conversationId, async () => {
                // Re-read inside the per-conversation mutex so back-to-back inbound
                // messages cannot lose turnCount increments to a read-modify-write
                // race, then re-apply the reopen/idle-reset decisions made above.
                const storedConversation = await deps.stateStore.getConversationByPeer(peerGlobalMetaId)
                    ?? conversation;
                const turnCountWasReset = conversation.turnCount === 0 && storedConversation.turnCount > 0;
                conversation = {
                    ...storedConversation,
                    state: conversation.state,
                    lastDirection: 'inbound',
                    updatedAt: now,
                    turnCount: (turnCountWasReset ? 0 : storedConversation.turnCount) + 1,
                };
                await deps.stateStore.upsertConversation(conversation);
                // Check for the natural-language closing signal from peer.
                if (hasFinalByeLine(inboundWireContent.content)) {
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
            const recentMessages = unwrapLegacyInboundContents(filterChatPromptMessages(await deps.stateStore.getRecentMessages(conversation.conversationId, DEFAULT_RECENT_MESSAGES_LIMIT)));
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
