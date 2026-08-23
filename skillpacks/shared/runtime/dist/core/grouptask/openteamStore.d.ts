/**
 * OpenTeam store: file-backed state for the remote-member handshake, one file
 * per profile at `.runtime/grouptask/openteam.json` (storage layout v2).
 *
 * Two sides live in the same file because a profile can play both roles:
 * - `invites`      — rows this profile SENT as a task chair (IDBots
 *                    `openteam_invites` parity: pending→accepted|declined|expired);
 * - `guestInvites` — rows this profile RECEIVED (IDBots `openteam_guest_invites`:
 *                    invited→accepted|declined|skipped|expired);
 * - `memberships`  — groups this profile joined as a guest worker (IDBots
 *                    `openteam_memberships`: active→left, with the guest reply
 *                    cursor `lastProcessedIndex`);
 * - `kv`           — engine scan cursors and dedupe guards.
 *
 * Same write discipline as the grouptask store: atomic tmp+rename writes,
 * serialized through an in-process queue.
 */
import type { MetabotPaths } from '../state/paths';
export type OpenTeamInviteStatus = 'pending' | 'accepted' | 'declined' | 'expired';
export type OpenTeamGuestInviteStatus = 'invited' | 'accepted' | 'declined' | 'skipped' | 'expired';
export type OpenTeamMembershipStatus = 'active' | 'left';
export type OpenTeamLeftCause = 'kick' | 'self_check' | 'opt_out';
export interface OpenTeamInviteRecord {
    id: number;
    taskId: number;
    groupId: string;
    /** Random pinId-shaped correlation id carried in the envelope. */
    inviteId: string;
    inviteeGlobalMetaId: string;
    inviteeName: string | null;
    requiredSkills: string[];
    status: OpenTeamInviteStatus;
    declineReason: string | null;
    /** Join pin echoed by the ACCEPT reply. */
    joinedPinId: string | null;
    /** simplemsg pin id of the invite send (null when the send failed). */
    sentPinId: string | null;
    /** Epoch seconds (wire parity with the envelope field). */
    expiresAt: number;
    createdAt: number;
    respondedAt: number | null;
    /** Set once the remote member row was added to the task (join confirmed). */
    memberAddedAt: number | null;
}
export interface OpenTeamGuestInviteRecord {
    id: number;
    groupId: string;
    inviteId: string;
    inviterGlobalMetaId: string;
    inviterName: string | null;
    taskTitle: string;
    goalSummary: string | null;
    requiredSkills: string[];
    targetGlobalMetaId: string;
    /** Epoch seconds. */
    expiresAt: number;
    status: OpenTeamGuestInviteStatus;
    declineReason: string | null;
    joinedPinId: string | null;
    createdAt: number;
    respondedAt: number | null;
}
export interface OpenTeamMembershipRecord {
    id: number;
    groupId: string;
    /** Local profile slug that joined the group as a guest. */
    slug: string;
    inviterGlobalMetaId: string;
    inviterName: string | null;
    taskTitle: string;
    goalSummary: string | null;
    inviteId: string;
    joinedPinId: string | null;
    status: OpenTeamMembershipStatus;
    createdAt: number;
    activatedAt: number | null;
    /** Guest reply cursor over the group's chain message index. */
    lastProcessedIndex: number;
    leftAt: number | null;
    leftCause: OpenTeamLeftCause | null;
    leftReason: string | null;
}
export interface OpenTeamStateFile {
    seq: number;
    invites: OpenTeamInviteRecord[];
    guestInvites: OpenTeamGuestInviteRecord[];
    memberships: OpenTeamMembershipRecord[];
    kv: Record<string, string>;
}
export interface CreateOpenTeamInviteInput {
    taskId: number;
    groupId: string;
    inviteId: string;
    inviteeGlobalMetaId: string;
    inviteeName?: string | null;
    requiredSkills?: string[];
    sentPinId?: string | null;
    expiresAt: number;
}
export interface CreateOpenTeamGuestInviteInput {
    groupId: string;
    inviteId: string;
    inviterGlobalMetaId: string;
    inviterName?: string | null;
    taskTitle: string;
    goalSummary?: string | null;
    requiredSkills?: string[];
    targetGlobalMetaId: string;
    expiresAt: number;
    status: OpenTeamGuestInviteStatus;
    declineReason?: string | null;
    joinedPinId?: string | null;
}
export interface CreateOpenTeamMembershipInput {
    groupId: string;
    slug: string;
    inviterGlobalMetaId: string;
    inviterName?: string | null;
    taskTitle: string;
    goalSummary?: string | null;
    inviteId: string;
    joinedPinId?: string | null;
}
export interface OpenTeamStore {
    readonly root: string;
    createInvite(input: CreateOpenTeamInviteInput): Promise<OpenTeamInviteRecord>;
    getInviteByInviteId(inviteId: string): Promise<OpenTeamInviteRecord | null>;
    listInvites(taskId?: number): Promise<OpenTeamInviteRecord[]>;
    updateInvite(inviteId: string, patch: Partial<Pick<OpenTeamInviteRecord, 'status' | 'declineReason' | 'joinedPinId' | 'sentPinId' | 'respondedAt' | 'memberAddedAt'>>): Promise<OpenTeamInviteRecord | null>;
    createGuestInvite(input: CreateOpenTeamGuestInviteInput): Promise<OpenTeamGuestInviteRecord>;
    getGuestInviteByInviteId(inviteId: string): Promise<OpenTeamGuestInviteRecord | null>;
    listGuestInvites(): Promise<OpenTeamGuestInviteRecord[]>;
    updateGuestInvite(inviteId: string, patch: Partial<Pick<OpenTeamGuestInviteRecord, 'status' | 'declineReason' | 'joinedPinId' | 'respondedAt'>>): Promise<OpenTeamGuestInviteRecord | null>;
    createMembership(input: CreateOpenTeamMembershipInput): Promise<OpenTeamMembershipRecord>;
    getMembership(groupId: string, slug: string): Promise<OpenTeamMembershipRecord | null>;
    listMemberships(options?: {
        activeOnly?: boolean;
    }): Promise<OpenTeamMembershipRecord[]>;
    activateMembership(groupId: string, slug: string, joinedPinId: string | null): Promise<void>;
    updateMembershipCursor(groupId: string, slug: string, lastProcessedIndex: number): Promise<void>;
    leaveMembership(groupId: string, slug: string, cause: OpenTeamLeftCause, reason?: string | null): Promise<void>;
    kvGet(key: string): Promise<string | undefined>;
    kvSet(key: string, value: string): Promise<void>;
    kvDelete(key: string): Promise<void>;
}
export declare function resolveOpenTeamStatePath(paths: MetabotPaths): string;
export declare function createOpenTeamStore(paths: MetabotPaths): OpenTeamStore;
