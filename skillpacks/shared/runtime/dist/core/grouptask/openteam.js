"use strict";
/**
 * OpenTeam protocol — wire-compatible port of IDBots openTeamProtocols.
 * OpenTeam is the remote-member recruitment handshake for Group Tasks: the
 * chair sends an `[OPENTEAM_INVITE]` envelope over /protocols/simplemsg
 * (ECDH-encrypted private chat); the invitee verifies the group + inviter,
 * signs /protocols/simplegroupjoin ITSELF, then replies
 * `[OPENTEAM_ACCEPT:<inviteId>]` echoing the join pin. Declines carry a
 * reason; kicks are one-way `[OPENTEAM_KICK]` notices.
 *
 * Wire compatibility rules (IDBots interop):
 * - envelope = TAG + single space + payload (JSON or free text), plaintext
 *   BEFORE private-chat encryption;
 * - `inviteId` is a random pinId-SHAPED string (64 hex + 'i' + digits), NOT
 *   the simplemsg pin id (content cannot embed its own pin id);
 * - `expiresAt` is epoch SECONDS.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OPENTEAM_EXPIRY_SKEW_SECONDS = exports.OPENTEAM_JOIN_CONFIRM_TIMEOUT_MS = exports.OPENTEAM_PENDING_MARGIN_MS = exports.OPENTEAM_INVITE_TTL_SECONDS = exports.OPENTEAM_ENVELOPE_PREFIX = exports.OPENTEAM_KICK_TAG = exports.OPENTEAM_INVITE_TAG = void 0;
exports.generateOpenTeamInviteId = generateOpenTeamInviteId;
exports.isOpenTeamInviteId = isOpenTeamInviteId;
exports.isOpenTeamEnvelopeText = isOpenTeamEnvelopeText;
exports.buildOpenTeamInviteMessage = buildOpenTeamInviteMessage;
exports.buildOpenTeamAcceptMessage = buildOpenTeamAcceptMessage;
exports.buildOpenTeamDeclineMessage = buildOpenTeamDeclineMessage;
exports.buildOpenTeamKickMessage = buildOpenTeamKickMessage;
exports.parseOpenTeamInvitePayload = parseOpenTeamInvitePayload;
exports.parseOpenTeamEnvelope = parseOpenTeamEnvelope;
const node_crypto_1 = require("node:crypto");
exports.OPENTEAM_INVITE_TAG = '[OPENTEAM_INVITE]';
exports.OPENTEAM_KICK_TAG = '[OPENTEAM_KICK]';
exports.OPENTEAM_ENVELOPE_PREFIX = '[OPENTEAM_';
/** Envelope TTL the inviter stamps into `expiresAt` (seconds). */
exports.OPENTEAM_INVITE_TTL_SECONDS = 600;
/** Extra propagation margin the inviter waits beyond the TTL (ms). */
exports.OPENTEAM_PENDING_MARGIN_MS = 5 * 60_000;
/** After an ACCEPT, how long the inviter polls the indexer for the join. */
exports.OPENTEAM_JOIN_CONFIRM_TIMEOUT_MS = 10 * 60_000;
/** Guest-side clock-skew tolerance when checking envelope expiry (seconds). */
exports.OPENTEAM_EXPIRY_SKEW_SECONDS = 60;
const INVITE_ID_RE = /^[0-9a-f]{64}i\d+$/u;
const ACCEPT_RE = /^\[OPENTEAM_ACCEPT:([0-9a-f]{64}i\d+)\]\s*(\{[\s\S]*\})?\s*$/u;
const DECLINE_RE = /^\[OPENTEAM_DECLINE:([0-9a-f]{64}i\d+)\]\s*([\s\S]*)$/u;
function generateOpenTeamInviteId() {
    return `${(0, node_crypto_1.randomBytes)(32).toString('hex')}i0`;
}
function isOpenTeamInviteId(value) {
    return INVITE_ID_RE.test(value);
}
/** Any OpenTeam envelope (used to gate private-chat auto-replies). */
function isOpenTeamEnvelopeText(content) {
    return content.trimStart().startsWith(exports.OPENTEAM_ENVELOPE_PREFIX);
}
// ---------------------------------------------------------------------------
// Builders (exact IDBots wire shapes)
// ---------------------------------------------------------------------------
function buildOpenTeamInviteMessage(payload) {
    return `${exports.OPENTEAM_INVITE_TAG} ${JSON.stringify(payload)}`;
}
function buildOpenTeamAcceptMessage(inviteId, joinedPinId) {
    return `[OPENTEAM_ACCEPT:${inviteId}] ${JSON.stringify({ joinedPinId })}`;
}
function buildOpenTeamDeclineMessage(inviteId, reason) {
    return `[OPENTEAM_DECLINE:${inviteId}] ${reason}`.trimEnd();
}
function buildOpenTeamKickMessage(payload) {
    return `${exports.OPENTEAM_KICK_TAG} ${JSON.stringify(payload)}`;
}
// ---------------------------------------------------------------------------
// Parsers (tolerant: never throw; null for non-envelopes / malformed bodies)
// ---------------------------------------------------------------------------
function toStringField(record, key) {
    const value = record[key];
    return typeof value === 'string' ? value.trim() : '';
}
function parseJsonObject(text) {
    try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
        return null;
    }
    catch {
        return null;
    }
}
function parseOpenTeamInvitePayload(text) {
    const record = parseJsonObject(text);
    if (!record)
        return null;
    const inviteId = toStringField(record, 'inviteId');
    const groupId = toStringField(record, 'groupId');
    const inviterGlobalMetaId = toStringField(record, 'inviterGlobalMetaId');
    const targetGlobalMetaId = toStringField(record, 'targetGlobalMetaId');
    const expiresAt = Number(record.expiresAt);
    if (!isOpenTeamInviteId(inviteId) || !groupId || !inviterGlobalMetaId
        || !targetGlobalMetaId || !Number.isFinite(expiresAt)) {
        return null;
    }
    return {
        v: 1,
        inviteId,
        groupId,
        taskTitle: toStringField(record, 'taskTitle'),
        goalSummary: toStringField(record, 'goalSummary'),
        requiredSkills: Array.isArray(record.requiredSkills)
            ? record.requiredSkills.filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
            : [],
        inviterGlobalMetaId,
        inviterName: toStringField(record, 'inviterName'),
        chairGlobalMetaId: toStringField(record, 'chairGlobalMetaId') || inviterGlobalMetaId,
        targetGlobalMetaId,
        expiresAt: Math.trunc(expiresAt),
    };
}
/**
 * Parse any OpenTeam envelope from a private-chat plaintext. Accepts the raw
 * text or the `{content, extensions}` JSON wrapper the auto-reply path uses.
 */
function parseOpenTeamEnvelope(content) {
    let text = (content ?? '').trim();
    if (!text)
        return null;
    if (text.startsWith('{')) {
        const wrapped = parseJsonObject(text);
        const inner = wrapped ? toStringField(wrapped, 'content') : '';
        if (inner)
            text = inner.trim();
    }
    if (!text.startsWith(exports.OPENTEAM_ENVELOPE_PREFIX))
        return null;
    if (text.startsWith(exports.OPENTEAM_INVITE_TAG)) {
        const payload = parseOpenTeamInvitePayload(text.slice(exports.OPENTEAM_INVITE_TAG.length).trim());
        return payload ? { kind: 'invite', payload } : null;
    }
    const accept = text.match(ACCEPT_RE);
    if (accept) {
        const body = accept[2] ? parseJsonObject(accept[2]) : null;
        const joinedPinId = body ? toStringField(body, 'joinedPinId') : '';
        return { kind: 'accept', inviteId: accept[1], joinedPinId: joinedPinId || null };
    }
    const decline = text.match(DECLINE_RE);
    if (decline) {
        return { kind: 'decline', inviteId: decline[1], reason: decline[2].trim() };
    }
    if (text.startsWith(exports.OPENTEAM_KICK_TAG)) {
        const record = parseJsonObject(text.slice(exports.OPENTEAM_KICK_TAG.length).trim());
        if (!record)
            return null;
        const groupId = toStringField(record, 'groupId');
        if (!groupId)
            return null;
        return {
            kind: 'kick',
            payload: {
                v: 1,
                groupId,
                taskTitle: toStringField(record, 'taskTitle'),
                reason: toStringField(record, 'reason'),
            },
        };
    }
    return null;
}
