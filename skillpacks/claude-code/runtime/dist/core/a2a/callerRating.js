"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractBuyerRatingScore = extractBuyerRatingScore;
exports.generateBuyerServiceRating = generateBuyerServiceRating;
const orderMessage_1 = require("../orders/orderMessage");
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeTimestamp(value, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    const normalized = Math.trunc(value);
    return normalized >= 1_000_000_000 && normalized < 1_000_000_000_000
        ? normalized * 1000
        : normalized;
}
function truncateForPrompt(value, maxChars) {
    const text = normalizeText(value);
    if (text.length <= maxChars) {
        return text;
    }
    const tailLength = Math.min(600, Math.floor(maxChars / 3));
    const headLength = Math.max(0, maxChars - tailLength - 80);
    return [
        text.slice(0, headLength).trimEnd(),
        '[Prompt excerpt: middle content omitted.]',
        text.slice(-tailLength).trimStart(),
    ].filter(Boolean).join('\n\n');
}
function findLatestOrderText(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        const type = normalizeText(item.type).toLowerCase();
        const sender = normalizeText(item.sender).toLowerCase();
        const content = normalizeText(item.content);
        if (sender !== 'caller' || !content) {
            continue;
        }
        if (type === 'order' || /^\[ORDER\]/iu.test(content)) {
            return (0, orderMessage_1.extractOrderRawRequest)(content) || content;
        }
    }
    return '';
}
function findLatestDeliveryText(items) {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        const item = items[index];
        const type = normalizeText(item.type).toLowerCase();
        const sender = normalizeText(item.sender).toLowerCase();
        const content = normalizeText(item.content);
        if (sender !== 'provider' || !content) {
            continue;
        }
        if (type === 'delivery' || type === 'assistant') {
            return content;
        }
    }
    return '';
}
function extractBuyerRatingScore(value) {
    const text = normalizeText(value);
    const match = text.match(/[1-5]\s*分|评分[：:]\s*([1-5])|([1-5])\s*(?:out of|\/)\s*5|([1-5])\s*星/i)
        ?? text.match(/([1-5])/);
    const raw = match
        ? (match[1] ?? match[2] ?? match[3] ?? match[0])
        : '';
    const digit = normalizeText(raw).replace(/[^1-5]/g, '').slice(0, 1);
    const parsed = Number.parseInt(digit, 10);
    return Number.isFinite(parsed) && parsed >= 1 && parsed <= 5 ? parsed : 3;
}
async function generateBuyerServiceRating(input) {
    const now = typeof input.now === 'number' && Number.isFinite(input.now)
        ? Math.trunc(input.now)
        : Date.now();
    const originalRequest = normalizeText(input.originalRequest) || findLatestOrderText(input.transcriptItems);
    const serviceResult = normalizeText(input.serviceResult) || findLatestDeliveryText(input.transcriptItems);
    const expectedOutputType = normalizeText(input.expectedOutputType) || 'text';
    const ratingRequestText = normalizeText(input.ratingRequestText) || 'The provider is asking for a buyer rating.';
    const providerName = normalizeText(input.providerName) || 'Remote MetaBot';
    const instruction = [
        'The remote MetaBot provider has delivered a paid service and is asking for final buyer feedback.',
        `Provider: ${providerName}`,
        `Expected output type: ${expectedOutputType}`,
        `Original request:\n${truncateForPrompt(originalRequest || 'No original request was recorded.', 1200)}`,
        `Delivered result:\n${truncateForPrompt(serviceResult || 'No delivery text was recorded.', 1600)}`,
        `Provider rating request:\n${truncateForPrompt(ratingRequestText, 600)}`,
        'Write the buyer-side rating in the buyer MetaBot voice.',
        'You MUST include one clear numeric score from 1 to 5, where 5 is best.',
        'After the rating comment, add a short farewell to the provider.',
        'Keep the complete message under 500 characters.',
    ].join('\n\n');
    const conversation = {
        conversationId: `service-rating-${normalizeText(input.traceId) || now}`,
        peerGlobalMetaId: normalizeText(input.providerGlobalMetaId),
        peerName: providerName,
        topic: 'service_rating',
        strategyId: 'service-rating',
        state: 'active',
        turnCount: 2,
        lastDirection: 'inbound',
        createdAt: now,
        updatedAt: now,
    };
    const recentMessages = [
        {
            conversationId: conversation.conversationId,
            messageId: `${conversation.conversationId}-order`,
            direction: 'outbound',
            senderGlobalMetaId: 'buyer',
            content: `Original request: ${truncateForPrompt(originalRequest, 1200)}`,
            messagePinId: null,
            extensions: null,
            timestamp: now - 3,
        },
        {
            conversationId: conversation.conversationId,
            messageId: `${conversation.conversationId}-delivery`,
            direction: 'inbound',
            senderGlobalMetaId: conversation.peerGlobalMetaId,
            content: `Delivered result: ${truncateForPrompt(serviceResult, 1600)}`,
            messagePinId: null,
            extensions: null,
            timestamp: now - 2,
        },
    ];
    const inboundMessage = {
        conversationId: conversation.conversationId,
        messageId: `${conversation.conversationId}-needs-rating`,
        direction: 'inbound',
        senderGlobalMetaId: conversation.peerGlobalMetaId,
        content: instruction,
        messagePinId: null,
        extensions: null,
        timestamp: now - 1,
    };
    const runnerResult = await input.replyRunner({
        conversation,
        recentMessages,
        persona: input.persona,
        strategy: {
            id: 'service-rating',
            maxTurns: 3,
            maxIdleMs: 0,
            exitCriteria: 'Evaluate the paid service, include a numeric 1-5 score, and close the order politely.',
        },
        inboundMessage,
    });
    const generated = normalizeText(runnerResult.content);
    const comment = generated || '评分：3分。服务已完成，感谢交付。';
    return {
        rate: extractBuyerRatingScore(comment),
        comment: comment.slice(0, 500),
    };
}
