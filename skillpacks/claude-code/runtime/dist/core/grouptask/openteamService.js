"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.inviteRemoteMember = inviteRemoteMember;
exports.listOpenTeamInvites = listOpenTeamInvites;
exports.listOpenTeamCollabs = listOpenTeamCollabs;
exports.listOpenTeamCollabMessages = listOpenTeamCollabMessages;
const service_1 = require("./service");
const store_1 = require("./store");
const paths_1 = require("../state/paths");
const openteam_1 = require("./openteam");
const transport_1 = require("./transport");
const backfill_1 = require("./backfill");
const GOAL_SUMMARY_MAX_CHARS = 200;
function storeForProfile(ctx, profile) {
    if (ctx.storeForProfile)
        return ctx.storeForProfile(profile);
    return (0, store_1.createGroupTaskStore)((0, paths_1.resolveMetabotPaths)(profile.homeDir));
}
async function requireProfile(ctx, slug) {
    const profile = await ctx.getProfile(slug.trim());
    if (!profile) {
        throw new service_1.GroupTaskServiceError('profile_not_found', `MetaBot profile not found: ${slug}`);
    }
    return profile;
}
async function inviteRemoteMember(ctx, chairSlug, taskId, input) {
    if (!ctx.sendPrivateMessage) {
        throw new service_1.GroupTaskServiceError('openteam_unavailable', 'Private-message sending is not wired in this context; OpenTeam invites are unavailable');
    }
    const invitee = input.globalMetaId.trim();
    if (!invitee) {
        throw new service_1.GroupTaskServiceError('invitee_required', 'Invitee GlobalMetaID is required');
    }
    const chair = await requireProfile(ctx, chairSlug);
    const store = storeForProfile(ctx, chair);
    const task = await store.getTaskById(taskId);
    if (!task) {
        throw new service_1.GroupTaskServiceError('task_not_found', `Group task ${taskId} not found`);
    }
    if (task.status === 'done' || task.status === 'cancelled') {
        throw new service_1.GroupTaskServiceError('task_terminal', `Group task ${taskId} is ${task.status}`);
    }
    if (!task.groupId) {
        throw new service_1.GroupTaskServiceError('group_missing', `Group task ${taskId} has no on-chain group id`);
    }
    const chairGmid = (chair.globalMetaId ?? '').trim();
    if (!chairGmid) {
        throw new service_1.GroupTaskServiceError('chair_identity_missing', `Chair ${chair.slug} has no GlobalMetaID`);
    }
    if (invitee.toLowerCase() === chairGmid.toLowerCase()) {
        throw new service_1.GroupTaskServiceError('cannot_invite_self', 'The chair cannot invite itself');
    }
    const members = await store.listMembers(taskId);
    const alreadyMember = members.some((member) => (member.globalMetaId ?? '').trim().toLowerCase() === invitee.toLowerCase());
    if (alreadyMember) {
        throw new service_1.GroupTaskServiceError('already_member', `${invitee} is already a member of task ${taskId}`);
    }
    const openteam = (0, service_1.openteamStoreFor)(ctx, chair);
    const existing = await openteam.listInvites(taskId);
    const duplicate = existing.find((invite) => invite.inviteeGlobalMetaId.toLowerCase() === invitee.toLowerCase()
        && (invite.status === 'pending' || !input.allowReinvite));
    if (duplicate) {
        throw new service_1.GroupTaskServiceError(duplicate.status === 'pending' ? 'invite_pending' : 'already_invited', `${invitee} already has a ${duplicate.status} invite for task ${taskId}`
            + (duplicate.status === 'pending' ? '' : ' (pass allowReinvite to send another)'));
    }
    const inviteId = (0, openteam_1.generateOpenTeamInviteId)();
    const goalSummary = task.goal.trim().slice(0, GOAL_SUMMARY_MAX_CHARS);
    const requiredSkills = (input.requiredSkills ?? []).map((skill) => skill.trim()).filter(Boolean);
    const expiresAt = Math.floor(Date.now() / 1000) + openteam_1.OPENTEAM_INVITE_TTL_SECONDS;
    const plaintext = (0, openteam_1.buildOpenTeamInviteMessage)({
        v: 1,
        inviteId,
        groupId: task.groupId,
        taskTitle: task.title,
        goalSummary,
        requiredSkills,
        inviterGlobalMetaId: chairGmid,
        inviterName: chair.name.trim() || chair.slug,
        chairGlobalMetaId: chairGmid,
        targetGlobalMetaId: invitee,
        expiresAt,
    });
    const sent = await ctx.sendPrivateMessage({
        fromSlug: chair.slug,
        toGlobalMetaId: invitee,
        content: plaintext,
    });
    return openteam.createInvite({
        taskId,
        groupId: task.groupId,
        inviteId,
        inviteeGlobalMetaId: invitee,
        inviteeName: input.name?.trim() || null,
        requiredSkills,
        sentPinId: sent.pinId,
        expiresAt,
    });
}
async function listOpenTeamInvites(ctx, chairSlug, taskId) {
    const chair = await requireProfile(ctx, chairSlug);
    return (0, service_1.openteamStoreFor)(ctx, chair).listInvites(taskId);
}
/** Guest-side external collaborations across every local profile. */
async function listOpenTeamCollabs(ctx) {
    const profiles = await ctx.listProfiles();
    const view = { memberships: [], guestInvites: [] };
    for (const profile of profiles) {
        const store = (0, service_1.openteamStoreFor)(ctx, profile);
        let memberships;
        let guestInvites;
        try {
            memberships = await store.listMemberships();
            guestInvites = await store.listGuestInvites();
        }
        catch {
            continue;
        }
        for (const membership of memberships) {
            view.memberships.push({ ...membership, botName: profile.name });
        }
        for (const invite of guestInvites) {
            view.guestInvites.push({ ...invite, slug: profile.slug, botName: profile.name });
        }
    }
    view.memberships.sort((left, right) => (right.activatedAt ?? 0) - (left.activatedAt ?? 0));
    view.guestInvites.sort((left, right) => right.createdAt - left.createdAt);
    return view;
}
/**
 * Read-only transcript for a group this profile joined as a guest. Syncs the
 * guest-side cache from the indexer first (best effort); trust set comes from
 * the live indexer member list.
 */
async function listOpenTeamCollabMessages(ctx, slug, groupId, options) {
    const profile = await requireProfile(ctx, slug);
    const openteam = (0, service_1.openteamStoreFor)(ctx, profile);
    const membership = await openteam.getMembership(groupId, profile.slug);
    if (!membership) {
        throw new service_1.GroupTaskServiceError('membership_not_found', `Bot ${slug} has no OpenTeam membership for group ${groupId}`);
    }
    const store = storeForProfile(ctx, profile);
    try {
        const memberIds = await (0, transport_1.fetchGroupMembers)(groupId, ctx.transport);
        await (0, backfill_1.syncGroupMessages)({
            store,
            groupId,
            trustedGlobalMetaIds: new Set((memberIds ?? []).map((id) => id.trim().toLowerCase())),
            transport: ctx.transport,
        });
    }
    catch (error) {
        ctx.log?.(`[OpenTeam] Guest transcript sync failed for group ${groupId}: `
            + `${error instanceof Error ? error.message : String(error)}`);
    }
    const page = await store.listMessages(groupId, { limit: options?.limit ?? 100 });
    return { membership, messages: page.messages, total: page.total };
}
