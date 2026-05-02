"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeA2ARawMetadata = sanitizeA2ARawMetadata;
exports.buildA2APeerSessionId = buildA2APeerSessionId;
exports.buildA2AOrderSessionId = buildA2AOrderSessionId;
exports.persistA2AConversationMessage = persistA2AConversationMessage;
exports.persistA2AConversationMessageBestEffort = persistA2AConversationMessageBestEffort;
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
const conversationStore_1 = require("./conversationStore");
const simplemsgClassifier_1 = require("./simplemsgClassifier");
const SENSITIVE_RAW_METADATA_KEYS = new Set([
    'content',
    'payload',
    'rawdata',
    'encryptedcontent',
    'encryptedpayload',
    'secret',
    'secretvariant',
    'privatekey',
    'privatekeyhex',
]);
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function normalizeGlobalMetaIdPrefix(value) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized.length < 8) {
        throw new Error('globalMetaId must be at least 8 characters for A2A conversation persistence.');
    }
    return normalized.slice(0, 8);
}
function normalizeTxids(value) {
    return Array.isArray(value)
        ? value.map((entry) => normalizeText(entry)).filter(Boolean)
        : [];
}
function isSensitiveRawMetadataKey(key) {
    return SENSITIVE_RAW_METADATA_KEYS.has(key.toLowerCase());
}
function sanitizeRawMetadataValue(value, seen, depth = 0) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (depth > 16 || seen.has(value)) {
        return null;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeRawMetadataValue(entry, seen, depth + 1));
    }
    const sanitized = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (isSensitiveRawMetadataKey(key)) {
            continue;
        }
        const nextValue = sanitizeRawMetadataValue(nestedValue, seen, depth + 1);
        if (nextValue !== undefined) {
            sanitized[key] = nextValue;
        }
    }
    return sanitized;
}
function sanitizeA2ARawMetadata(raw) {
    if (!raw) {
        return null;
    }
    const sanitized = sanitizeRawMetadataValue(raw, new WeakSet());
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
        ? sanitized
        : null;
}
function normalizeActor(actor) {
    return {
        ...actor,
        globalMetaId: normalizeText(actor.globalMetaId),
        name: normalizeText(actor.name) || null,
        avatar: normalizeText(actor.avatar) || null,
        chatPublicKey: normalizeText(actor.chatPublicKey) || null,
    };
}
function buildA2APeerSessionId(localGlobalMetaId, peerGlobalMetaId) {
    return `a2a-peer-${normalizeGlobalMetaIdPrefix(localGlobalMetaId)}-${normalizeGlobalMetaIdPrefix(peerGlobalMetaId)}`;
}
function buildA2AOrderSessionId(orderTxid) {
    const normalized = normalizeText(orderTxid);
    if (!normalized) {
        throw new Error('orderTxid is required to build an A2A order session id.');
    }
    return `a2a-order-${normalized}`;
}
function buildMessageId(input) {
    return normalizeText(input.explicit)
        || normalizeText(input.pinId)
        || normalizeText(input.txid)
        || normalizeText(input.txids[0])
        || `${input.sessionId}-${input.direction}-${input.timestamp}`;
}
function isFailureEndReason(reason) {
    const normalized = normalizeText(reason).toLowerCase();
    return Boolean(normalized.match(/\b(fail|failed|failure|error|declined|cancelled|canceled|timeout|expired)\b/u));
}
function deriveOrderSessionState(input) {
    const explicitState = normalizeText(input.explicitState);
    if (explicitState) {
        return explicitState;
    }
    const existingState = normalizeText(input.existingState);
    if (input.classification.kind === 'order_protocol') {
        if (input.classification.tag === 'DELIVERY' || input.classification.tag === 'NeedsRating') {
            return 'completed';
        }
        if (input.classification.tag === 'ORDER_END') {
            return isFailureEndReason(input.classification.reason) ? 'remote_failed' : 'completed';
        }
        if (input.classification.tag === 'ORDER_STATUS') {
            return existingState === 'completed' || existingState === 'remote_failed'
                ? existingState
                : 'remote_executing';
        }
    }
    return existingState || 'awaiting_delivery';
}
async function persistA2AConversationMessage(input) {
    const paths = input.paths ?? (input.homeDir ? (0, paths_1.resolveMetabotPaths)(input.homeDir) : null);
    if (!paths) {
        throw new Error('homeDir or paths is required for A2A conversation persistence.');
    }
    const local = {
        ...input.local,
        profileSlug: normalizeText(input.local.profileSlug) || node_path_1.default.basename(paths.profileRoot),
    };
    const peer = input.peer;
    const localGlobalMetaId = normalizeText(local.globalMetaId);
    const peerGlobalMetaId = normalizeText(peer.globalMetaId);
    const sessionId = buildA2APeerSessionId(localGlobalMetaId, peerGlobalMetaId);
    const txids = normalizeTxids(input.message.txids);
    const txid = normalizeText(input.message.txid) || txids[0] || null;
    const timestamp = Number.isFinite(input.message.timestamp)
        ? Math.trunc(Number(input.message.timestamp))
        : Date.now();
    const classification = (0, simplemsgClassifier_1.classifySimplemsgContent)(input.message.content);
    const classifiedOrderTxid = classification.kind === 'order_protocol'
        ? classification.orderTxid
        : null;
    const orderTxid = normalizeText(input.message.orderTxid) || classifiedOrderTxid || null;
    const orderSessionId = orderTxid ? buildA2AOrderSessionId(orderTxid) : null;
    const sender = normalizeActor(input.message.direction === 'outgoing' ? local : peer);
    const recipient = normalizeActor(input.message.direction === 'outgoing' ? peer : local);
    const message = {
        messageId: buildMessageId({
            explicit: input.message.messageId,
            pinId: input.message.pinId,
            txid,
            txids,
            sessionId,
            direction: input.message.direction,
            timestamp,
        }),
        sessionId,
        orderSessionId,
        direction: input.message.direction,
        kind: classification.kind,
        protocolTag: classification.kind === 'order_protocol' ? classification.tag : null,
        orderTxid,
        paymentTxid: normalizeText(input.message.paymentTxid) || null,
        content: String(input.message.content ?? ''),
        contentType: normalizeText(input.message.contentType) || 'text/plain',
        chain: normalizeText(input.message.chain) || null,
        pinId: normalizeText(input.message.pinId) || null,
        txid,
        txids,
        replyPinId: normalizeText(input.message.replyPinId) || null,
        timestamp,
        chainTimestamp: Number.isFinite(input.message.chainTimestamp)
            ? Math.trunc(Number(input.message.chainTimestamp))
            : null,
        sender,
        recipient,
        raw: sanitizeA2ARawMetadata(input.message.raw),
    };
    const store = (0, conversationStore_1.createA2AConversationStore)({ paths, local, peer });
    await store.appendMessages([message]);
    await store.upsertSession({
        sessionId,
        type: 'peer',
        state: 'active',
        createdAt: timestamp,
        updatedAt: timestamp,
        latestMessageId: message.messageId,
    });
    if (orderSessionId && orderTxid) {
        const existingSession = await store.findSessionById(orderSessionId);
        const existingOrderSession = existingSession?.type === 'service_order'
            ? existingSession
            : null;
        const deliveredAt = classification.kind === 'order_protocol' && classification.tag === 'DELIVERY'
            ? timestamp
            : null;
        const ratingRequestedAt = classification.kind === 'order_protocol' && classification.tag === 'NeedsRating'
            ? timestamp
            : null;
        const endedAt = classification.kind === 'order_protocol' && classification.tag === 'ORDER_END'
            ? timestamp
            : null;
        await store.upsertSession({
            sessionId: orderSessionId,
            type: 'service_order',
            role: input.orderSession?.role ?? existingOrderSession?.role ?? 'caller',
            state: deriveOrderSessionState({
                explicitState: input.orderSession?.state,
                existingState: existingOrderSession?.state,
                classification,
            }),
            orderTxid,
            paymentTxid: normalizeText(input.orderSession?.paymentTxid)
                || message.paymentTxid
                || normalizeText(existingOrderSession?.paymentTxid)
                || null,
            servicePinId: normalizeText(input.orderSession?.servicePinId)
                || normalizeText(existingOrderSession?.servicePinId)
                || null,
            serviceName: normalizeText(input.orderSession?.serviceName)
                || normalizeText(existingOrderSession?.serviceName)
                || null,
            outputType: normalizeText(input.orderSession?.outputType)
                || normalizeText(existingOrderSession?.outputType)
                || null,
            createdAt: Number.isFinite(input.orderSession?.createdAt)
                ? Math.trunc(Number(input.orderSession?.createdAt))
                : Number.isFinite(existingOrderSession?.createdAt)
                    ? Math.trunc(Number(existingOrderSession?.createdAt))
                    : timestamp,
            updatedAt: timestamp,
            firstResponseAt: input.orderSession?.firstResponseAt
                ?? existingOrderSession?.firstResponseAt
                ?? (message.direction === 'incoming' ? timestamp : null),
            deliveredAt: input.orderSession?.deliveredAt
                ?? existingOrderSession?.deliveredAt
                ?? deliveredAt,
            ratingRequestedAt: input.orderSession?.ratingRequestedAt
                ?? existingOrderSession?.ratingRequestedAt
                ?? ratingRequestedAt,
            endedAt: input.orderSession?.endedAt
                ?? existingOrderSession?.endedAt
                ?? endedAt,
            endReason: normalizeText(input.orderSession?.endReason)
                || normalizeText(existingOrderSession?.endReason)
                || (classification.kind === 'order_protocol' && classification.tag === 'ORDER_END'
                    ? normalizeText(classification.reason)
                    : null),
            failureReason: normalizeText(input.orderSession?.failureReason)
                || normalizeText(existingOrderSession?.failureReason)
                || null,
        });
    }
    return message;
}
async function persistA2AConversationMessageBestEffort(input, persister = persistA2AConversationMessage) {
    try {
        const message = await persister(input);
        return {
            persisted: true,
            message,
            errorMessage: null,
        };
    }
    catch (error) {
        return {
            persisted: false,
            message: null,
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
}
