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
export declare const OPENTEAM_INVITE_TAG = "[OPENTEAM_INVITE]";
export declare const OPENTEAM_KICK_TAG = "[OPENTEAM_KICK]";
export declare const OPENTEAM_ENVELOPE_PREFIX = "[OPENTEAM_";
/** Envelope TTL the inviter stamps into `expiresAt` (seconds). */
export declare const OPENTEAM_INVITE_TTL_SECONDS = 600;
/** Extra propagation margin the inviter waits beyond the TTL (ms). */
export declare const OPENTEAM_PENDING_MARGIN_MS: number;
/** After an ACCEPT, how long the inviter polls the indexer for the join. */
export declare const OPENTEAM_JOIN_CONFIRM_TIMEOUT_MS: number;
/** Guest-side clock-skew tolerance when checking envelope expiry (seconds). */
export declare const OPENTEAM_EXPIRY_SKEW_SECONDS = 60;
export interface OpenTeamInvitePayload {
    v: 1;
    /** Random pinId-shaped correlation id (NOT the simplemsg pin id). */
    inviteId: string;
    groupId: string;
    taskTitle: string;
    goalSummary: string;
    requiredSkills: string[];
    inviterGlobalMetaId: string;
    inviterName: string;
    chairGlobalMetaId: string;
    targetGlobalMetaId: string;
    /** Epoch seconds. */
    expiresAt: number;
}
export interface OpenTeamKickPayload {
    v: 1;
    groupId: string;
    taskTitle: string;
    reason: string;
}
export type OpenTeamEnvelope = {
    kind: 'invite';
    payload: OpenTeamInvitePayload;
} | {
    kind: 'accept';
    inviteId: string;
    joinedPinId: string | null;
} | {
    kind: 'decline';
    inviteId: string;
    reason: string;
} | {
    kind: 'kick';
    payload: OpenTeamKickPayload;
};
export declare function generateOpenTeamInviteId(): string;
export declare function isOpenTeamInviteId(value: string): boolean;
/** Any OpenTeam envelope (used to gate private-chat auto-replies). */
export declare function isOpenTeamEnvelopeText(content: string): boolean;
export declare function buildOpenTeamInviteMessage(payload: OpenTeamInvitePayload): string;
export declare function buildOpenTeamAcceptMessage(inviteId: string, joinedPinId: string): string;
export declare function buildOpenTeamDeclineMessage(inviteId: string, reason: string): string;
export declare function buildOpenTeamKickMessage(payload: OpenTeamKickPayload): string;
export declare function parseOpenTeamInvitePayload(text: string): OpenTeamInvitePayload | null;
/**
 * Parse any OpenTeam envelope from a private-chat plaintext. Accepts the raw
 * text or the `{content, extensions}` JSON wrapper the auto-reply path uses.
 */
export declare function parseOpenTeamEnvelope(content: string): OpenTeamEnvelope | null;
