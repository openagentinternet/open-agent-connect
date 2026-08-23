"use strict";
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveOpenTeamStatePath = resolveOpenTeamStatePath;
exports.createOpenTeamStore = createOpenTeamStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
function emptyState() {
    return { seq: 0, invites: [], guestInvites: [], memberships: [], kv: {} };
}
function resolveOpenTeamStatePath(paths) {
    return node_path_1.default.join(paths.runtimeRoot, 'grouptask', 'openteam.json');
}
async function readJsonFile(filePath) {
    try {
        const raw = await node_fs_1.promises.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeJsonFileAtomic(filePath, value) {
    await node_fs_1.promises.mkdir(node_path_1.default.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await node_fs_1.promises.writeFile(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await node_fs_1.promises.rename(tmpPath, filePath);
}
function createOpenTeamStore(paths) {
    const statePath = resolveOpenTeamStatePath(paths);
    let queue = Promise.resolve();
    function enqueue(work) {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    }
    async function readState() {
        const state = await readJsonFile(statePath);
        if (!state)
            return emptyState();
        return {
            seq: Number(state.seq) || 0,
            invites: Array.isArray(state.invites) ? state.invites : [],
            guestInvites: Array.isArray(state.guestInvites) ? state.guestInvites : [],
            memberships: Array.isArray(state.memberships) ? state.memberships : [],
            kv: state.kv && typeof state.kv === 'object' ? state.kv : {},
        };
    }
    async function mutate(work) {
        return enqueue(async () => {
            const state = await readState();
            const result = work(state);
            await writeJsonFileAtomic(statePath, state);
            return result;
        });
    }
    return {
        root: node_path_1.default.dirname(statePath),
        createInvite: (input) => mutate((state) => {
            state.seq += 1;
            const record = {
                id: state.seq,
                taskId: input.taskId,
                groupId: input.groupId,
                inviteId: input.inviteId,
                inviteeGlobalMetaId: input.inviteeGlobalMetaId,
                inviteeName: input.inviteeName ?? null,
                requiredSkills: input.requiredSkills ?? [],
                status: 'pending',
                declineReason: null,
                joinedPinId: null,
                sentPinId: input.sentPinId ?? null,
                expiresAt: input.expiresAt,
                createdAt: Date.now(),
                respondedAt: null,
                memberAddedAt: null,
            };
            state.invites.push(record);
            return record;
        }),
        getInviteByInviteId: async (inviteId) => {
            const state = await readState();
            return state.invites.find((entry) => entry.inviteId === inviteId) ?? null;
        },
        listInvites: async (taskId) => {
            const state = await readState();
            return taskId == null
                ? [...state.invites]
                : state.invites.filter((entry) => entry.taskId === taskId);
        },
        updateInvite: (inviteId, patch) => mutate((state) => {
            const record = state.invites.find((entry) => entry.inviteId === inviteId);
            if (!record)
                return null;
            Object.assign(record, patch);
            return { ...record };
        }),
        createGuestInvite: (input) => mutate((state) => {
            state.seq += 1;
            const record = {
                id: state.seq,
                groupId: input.groupId,
                inviteId: input.inviteId,
                inviterGlobalMetaId: input.inviterGlobalMetaId,
                inviterName: input.inviterName ?? null,
                taskTitle: input.taskTitle,
                goalSummary: input.goalSummary ?? null,
                requiredSkills: input.requiredSkills ?? [],
                targetGlobalMetaId: input.targetGlobalMetaId,
                expiresAt: input.expiresAt,
                status: input.status,
                declineReason: input.declineReason ?? null,
                joinedPinId: input.joinedPinId ?? null,
                createdAt: Date.now(),
                respondedAt: input.status === 'invited' ? null : Date.now(),
            };
            state.guestInvites.push(record);
            return record;
        }),
        getGuestInviteByInviteId: async (inviteId) => {
            const state = await readState();
            return state.guestInvites.find((entry) => entry.inviteId === inviteId) ?? null;
        },
        listGuestInvites: async () => {
            const state = await readState();
            return [...state.guestInvites];
        },
        updateGuestInvite: (inviteId, patch) => mutate((state) => {
            const record = state.guestInvites.find((entry) => entry.inviteId === inviteId);
            if (!record)
                return null;
            Object.assign(record, patch, { respondedAt: patch.status ? Date.now() : record.respondedAt });
            return { ...record };
        }),
        createMembership: (input) => mutate((state) => {
            state.seq += 1;
            const record = {
                id: state.seq,
                groupId: input.groupId,
                slug: input.slug,
                inviterGlobalMetaId: input.inviterGlobalMetaId,
                inviterName: input.inviterName ?? null,
                taskTitle: input.taskTitle,
                goalSummary: input.goalSummary ?? null,
                inviteId: input.inviteId,
                joinedPinId: input.joinedPinId ?? null,
                status: 'active',
                createdAt: Date.now(),
                activatedAt: Date.now(),
                lastProcessedIndex: -1,
                leftAt: null,
                leftCause: null,
                leftReason: null,
            };
            // Unique (groupId, slug): re-inviting a left member reactivates the row.
            const existing = state.memberships.find((entry) => entry.groupId === input.groupId && entry.slug === input.slug);
            if (existing) {
                Object.assign(existing, {
                    inviterGlobalMetaId: record.inviterGlobalMetaId,
                    inviterName: record.inviterName,
                    taskTitle: record.taskTitle,
                    goalSummary: record.goalSummary,
                    inviteId: record.inviteId,
                    joinedPinId: record.joinedPinId,
                    status: 'active',
                    activatedAt: record.activatedAt,
                    leftAt: null,
                    leftCause: null,
                    leftReason: null,
                });
                return { ...existing };
            }
            state.memberships.push(record);
            return record;
        }),
        getMembership: async (groupId, slug) => {
            const state = await readState();
            return state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug) ?? null;
        },
        listMemberships: async (options) => {
            const state = await readState();
            return options?.activeOnly
                ? state.memberships.filter((entry) => entry.status === 'active')
                : [...state.memberships];
        },
        activateMembership: (groupId, slug, joinedPinId) => mutate((state) => {
            const record = state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug);
            if (!record)
                return;
            record.status = 'active';
            record.activatedAt = Date.now();
            record.joinedPinId = joinedPinId ?? record.joinedPinId;
            record.leftAt = null;
            record.leftCause = null;
            record.leftReason = null;
        }),
        updateMembershipCursor: (groupId, slug, lastProcessedIndex) => mutate((state) => {
            const record = state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug);
            if (record)
                record.lastProcessedIndex = lastProcessedIndex;
        }),
        leaveMembership: (groupId, slug, cause, reason) => mutate((state) => {
            const record = state.memberships.find((entry) => entry.groupId === groupId && entry.slug === slug);
            if (!record || record.status === 'left')
                return;
            record.status = 'left';
            record.leftAt = Date.now();
            record.leftCause = cause;
            record.leftReason = reason ?? null;
        }),
        kvGet: async (key) => {
            const state = await readState();
            return state.kv[key];
        },
        kvSet: (key, value) => mutate((state) => {
            state.kv[key] = value;
        }),
        kvDelete: (key) => mutate((state) => {
            delete state.kv[key];
        }),
    };
}
