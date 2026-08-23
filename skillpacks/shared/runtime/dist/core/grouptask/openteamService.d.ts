/**
 * OpenTeam service verbs — the user/CLI-facing half of the remote-member
 * handshake (the engine owns the asynchronous half: envelope scan, guest
 * auto-accept, join confirmation, guest replies).
 *
 * - inviteRemoteMember: chair sends the [OPENTEAM_INVITE] simplemsg and
 *   records a pending invite row;
 * - listOpenTeamInvites: inviter-side invite rows for one task;
 * - listOpenTeamCollabs: guest-side view — memberships + received invites
 *   across every local profile (IDBots OpenTeamCollabsSection parity);
 * - listOpenTeamCollabMessages: read-only guest transcript for one group.
 */
import { type GroupTaskServiceContext } from './service';
import type { OpenTeamGuestInviteRecord, OpenTeamInviteRecord, OpenTeamMembershipRecord } from './openteamStore';
import type { GroupTaskMessage } from './types';
export interface InviteRemoteMemberInput {
    globalMetaId: string;
    name?: string | null;
    requiredSkills?: string[];
    /** Allow re-inviting a GlobalMetaID that already has a non-pending invite. */
    allowReinvite?: boolean;
}
export declare function inviteRemoteMember(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number, input: InviteRemoteMemberInput): Promise<OpenTeamInviteRecord>;
export declare function listOpenTeamInvites(ctx: GroupTaskServiceContext, chairSlug: string, taskId: number): Promise<OpenTeamInviteRecord[]>;
export interface OpenTeamCollabSummary extends OpenTeamMembershipRecord {
    /** Display name of the local profile that joined. */
    botName: string;
}
export interface OpenTeamCollabsView {
    memberships: OpenTeamCollabSummary[];
    guestInvites: Array<OpenTeamGuestInviteRecord & {
        slug: string;
        botName: string;
    }>;
}
/** Guest-side external collaborations across every local profile. */
export declare function listOpenTeamCollabs(ctx: GroupTaskServiceContext): Promise<OpenTeamCollabsView>;
export interface OpenTeamCollabMessagesResult {
    membership: OpenTeamMembershipRecord;
    messages: GroupTaskMessage[];
    total: number;
}
/**
 * Read-only transcript for a group this profile joined as a guest. Syncs the
 * guest-side cache from the indexer first (best effort); trust set comes from
 * the live indexer member list.
 */
export declare function listOpenTeamCollabMessages(ctx: GroupTaskServiceContext, slug: string, groupId: string, options?: {
    limit?: number;
}): Promise<OpenTeamCollabMessagesResult>;
