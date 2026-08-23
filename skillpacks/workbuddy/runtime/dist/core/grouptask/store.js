"use strict";
/**
 * Group Task store: file-backed CRUD for tasks / members / deliverables /
 * transitions / status events / checkpoints / integrity events / plan changes
 * / acceptance summaries, plus the task status state machine and an engine kv.
 *
 * Layout (storage layout v2, all under the CHAIR profile's runtime root):
 *   .runtime/grouptask/state.json            — entities + kv + id sequence
 *   .runtime/grouptask/messages/<groupId>.json — decrypted transcript cache
 *
 * Writes are atomic (tmp file + rename) and serialized through an in-process
 * queue; the daemon is the only writer (CLI verbs delegate over HTTP).
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GroupTaskStoreError = void 0;
exports.resolveGroupTaskRoot = resolveGroupTaskRoot;
exports.createGroupTaskStore = createGroupTaskStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const types_1 = require("./types");
function emptyState() {
    return {
        seq: 0,
        tasks: [],
        members: [],
        deliverables: [],
        transitions: [],
        statusEvents: [],
        checkpoints: [],
        integrityEvents: [],
        planChanges: [],
        acceptanceSummaries: [],
        kv: {},
    };
}
function normalizeGlobalMetaId(value) {
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
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
class GroupTaskStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'GroupTaskStoreError';
    }
}
exports.GroupTaskStoreError = GroupTaskStoreError;
const WORKING_TAG = /\[WORKING\]/i;
function resolveGroupTaskRoot(paths) {
    return node_path_1.default.join(paths.runtimeRoot, 'grouptask');
}
function createGroupTaskStore(paths) {
    const root = resolveGroupTaskRoot(paths);
    const statePath = node_path_1.default.join(root, 'state.json');
    const messagesRoot = node_path_1.default.join(root, 'messages');
    let queue = Promise.resolve();
    const enqueue = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    };
    async function readState() {
        const parsed = await readJsonFile(statePath);
        if (!parsed || typeof parsed !== 'object')
            return emptyState();
        const base = emptyState();
        return {
            seq: Number.isInteger(parsed.seq) && parsed.seq >= 0 ? parsed.seq : 0,
            tasks: Array.isArray(parsed.tasks) ? parsed.tasks : base.tasks,
            members: Array.isArray(parsed.members) ? parsed.members : base.members,
            deliverables: Array.isArray(parsed.deliverables) ? parsed.deliverables : base.deliverables,
            transitions: Array.isArray(parsed.transitions) ? parsed.transitions : base.transitions,
            statusEvents: Array.isArray(parsed.statusEvents) ? parsed.statusEvents : base.statusEvents,
            checkpoints: Array.isArray(parsed.checkpoints) ? parsed.checkpoints : base.checkpoints,
            integrityEvents: Array.isArray(parsed.integrityEvents) ? parsed.integrityEvents : base.integrityEvents,
            planChanges: Array.isArray(parsed.planChanges) ? parsed.planChanges : base.planChanges,
            acceptanceSummaries: Array.isArray(parsed.acceptanceSummaries)
                ? parsed.acceptanceSummaries
                : base.acceptanceSummaries,
            kv: parsed.kv && typeof parsed.kv === 'object' && !Array.isArray(parsed.kv)
                ? parsed.kv
                : {},
        };
    }
    async function writeState(state) {
        await writeJsonFileAtomic(statePath, state);
    }
    function nextId(state) {
        state.seq += 1;
        return state.seq;
    }
    function requireTask(state, taskId) {
        const task = state.tasks.find((entry) => entry.id === taskId);
        if (!task) {
            throw new GroupTaskStoreError('task_not_found', `Group task ${taskId} not found`);
        }
        return task;
    }
    function messagesPath(groupId) {
        const safe = groupId.replace(/[^0-9a-zA-Z_-]/gu, '_');
        return node_path_1.default.join(messagesRoot, `${safe}.json`);
    }
    async function readMessages(groupId) {
        const parsed = await readJsonFile(messagesPath(groupId));
        return Array.isArray(parsed?.messages) ? parsed.messages : [];
    }
    return {
        root,
        createTask: (input) => enqueue(async () => {
            const state = await readState();
            const now = Date.now();
            const task = {
                id: nextId(state),
                groupId: input.groupId,
                title: input.title,
                goal: input.goal,
                acceptanceCriteria: input.acceptanceCriteria?.trim() || null,
                status: 'planning',
                chairSlug: input.chairSlug,
                chairGlobalMetaId: input.chairGlobalMetaId?.trim() || null,
                createdBy: input.createdBy,
                lastProcessedIndex: -1,
                lastDrivenAt: null,
                createPinId: input.createPinId ?? null,
                createdAt: now,
                updatedAt: now,
                closedAt: null,
                rating: null,
                ratingComment: null,
                ratedAt: null,
                displayName: null,
                pinned: false,
                archivedAt: null,
            };
            state.tasks.push(task);
            await writeState(state);
            return task;
        }),
        getTaskById: async (taskId) => {
            const state = await readState();
            return state.tasks.find((task) => task.id === taskId) ?? null;
        },
        getTaskByGroupId: async (groupId) => {
            const state = await readState();
            const target = groupId.trim();
            return state.tasks.find((task) => task.groupId === target) ?? null;
        },
        listTasks: async (filter) => {
            const state = await readState();
            let tasks = [...state.tasks];
            if (filter?.status) {
                tasks = tasks.filter((task) => task.status === filter.status);
            }
            if (!filter?.includeArchived) {
                tasks = tasks.filter((task) => task.archivedAt == null);
            }
            // Pinned first, then newest update first (IDBots list ordering).
            return tasks.sort((left, right) => {
                if (left.pinned !== right.pinned)
                    return left.pinned ? -1 : 1;
                return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
            });
        },
        listArchivedTasks: async () => {
            const state = await readState();
            return state.tasks
                .filter((task) => task.archivedAt != null)
                .sort((left, right) => (right.archivedAt ?? 0) - (left.archivedAt ?? 0));
        },
        updateTaskStatus: (taskId, next, opts) => enqueue(async () => {
            if (!(0, types_1.isGroupTaskStatus)(next)) {
                throw new GroupTaskStoreError('invalid_status', `Invalid group task status: ${String(next)}`);
            }
            const state = await readState();
            const task = requireTask(state, taskId);
            if (task.status === next)
                return task;
            const allowed = types_1.GROUP_TASK_LEGAL_TRANSITIONS[task.status] ?? [];
            if (!allowed.includes(next)) {
                throw new GroupTaskStoreError('illegal_transition', `Illegal group task transition ${task.status} -> ${next} for task ${taskId}`);
            }
            const now = Date.now();
            const from = task.status;
            task.status = next;
            task.updatedAt = now;
            if (types_1.GROUP_TASK_TERMINAL_STATUSES.has(next)) {
                task.closedAt = now;
            }
            const actor = opts?.actor ?? { kind: 'system' };
            state.statusEvents.push({
                id: nextId(state),
                taskId,
                fromStatus: from,
                toStatus: next,
                actorKind: actor.kind,
                actorGlobalMetaId: actor.globalMetaId ?? null,
                actorName: actor.name ?? null,
                createdAt: now,
            });
            state.transitions.push({
                id: nextId(state),
                taskId,
                fromStatus: from,
                toStatus: next,
                actor: actor.name ?? actor.kind,
                reason: opts?.reason ?? null,
                createdAt: now,
            });
            await writeState(state);
            return task;
        }),
        updateTaskRating: (taskId, rating, ratingComment) => enqueue(async () => {
            const normalized = Math.trunc(Number(rating));
            if (!Number.isInteger(normalized) || normalized < 1 || normalized > 5) {
                throw new GroupTaskStoreError('invalid_rating', 'rating must be an integer between 1 and 5');
            }
            const state = await readState();
            const task = requireTask(state, taskId);
            const now = Date.now();
            task.rating = normalized;
            task.ratingComment = ratingComment?.trim() || null;
            task.ratedAt = now;
            task.updatedAt = now;
            await writeState(state);
            return task;
        }),
        updateTaskCursor: (taskId, lastProcessedIndex) => enqueue(async () => {
            const state = await readState();
            const task = requireTask(state, taskId);
            task.lastProcessedIndex = Math.max(task.lastProcessedIndex, Math.trunc(lastProcessedIndex));
            task.updatedAt = Date.now();
            await writeState(state);
        }),
        touchTaskDriven: (taskId, atMs) => enqueue(async () => {
            const state = await readState();
            const task = requireTask(state, taskId);
            task.lastDrivenAt = atMs ?? Date.now();
            await writeState(state);
        }),
        renameTask: (taskId, displayName) => enqueue(async () => {
            const state = await readState();
            const task = requireTask(state, taskId);
            task.displayName = displayName.trim() || null;
            task.updatedAt = Date.now();
            await writeState(state);
            return task;
        }),
        setTaskPinned: (taskId, pinned) => enqueue(async () => {
            const state = await readState();
            const task = requireTask(state, taskId);
            task.pinned = Boolean(pinned);
            task.updatedAt = Date.now();
            await writeState(state);
            return task;
        }),
        archiveTask: (taskId) => enqueue(async () => {
            const state = await readState();
            const task = requireTask(state, taskId);
            if (task.archivedAt == null) {
                task.archivedAt = Date.now();
            }
            await writeState(state);
            return task;
        }),
        unarchiveTask: (taskId) => enqueue(async () => {
            const state = await readState();
            const task = requireTask(state, taskId);
            task.archivedAt = null;
            await writeState(state);
            return task;
        }),
        addMember: (input) => enqueue(async () => {
            const state = await readState();
            requireTask(state, input.taskId);
            const member = {
                id: nextId(state),
                taskId: input.taskId,
                slug: input.slug,
                globalMetaId: input.globalMetaId?.trim() || null,
                role: input.role,
                joinedPinId: input.joinedPinId ?? null,
                createdAt: Date.now(),
                displayName: input.displayName?.trim() || null,
                removedAt: null,
                removePinId: null,
                status: 'assigned',
                statusChangedAt: null,
            };
            state.members.push(member);
            await writeState(state);
            return member;
        }),
        listMembers: async (taskId, opts) => {
            const state = await readState();
            const members = state.members.filter((member) => member.taskId === taskId);
            if (opts?.includeRemoved)
                return members;
            return members.filter((member) => member.removedAt == null);
        },
        updateMemberJoinedPinId: (taskId, slug, joinedPinId) => enqueue(async () => {
            const state = await readState();
            const member = state.members.find((entry) => entry.taskId === taskId && entry.slug === slug && entry.removedAt == null);
            if (member) {
                member.joinedPinId = joinedPinId;
                await writeState(state);
            }
        }),
        updateRemoteMemberJoinedPinId: (taskId, globalMetaId, joinedPinId) => enqueue(async () => {
            const state = await readState();
            const target = normalizeGlobalMetaId(globalMetaId);
            const candidates = state.members.filter((entry) => entry.taskId === taskId
                && entry.slug == null
                && normalizeGlobalMetaId(entry.globalMetaId) === target
                && entry.removedAt == null);
            const member = candidates[candidates.length - 1];
            if (member) {
                member.joinedPinId = joinedPinId;
                await writeState(state);
            }
        }),
        markMemberRemoved: (input) => enqueue(async () => {
            const state = await readState();
            requireTask(state, input.taskId);
            const target = input.slug != null
                ? state.members.find((entry) => entry.taskId === input.taskId && entry.slug === input.slug && entry.removedAt == null)
                : [...state.members].reverse().find((entry) => entry.taskId === input.taskId
                    && entry.slug == null
                    && normalizeGlobalMetaId(entry.globalMetaId) === normalizeGlobalMetaId(input.globalMetaId)
                    && entry.removedAt == null);
            if (!target) {
                throw new GroupTaskStoreError('member_not_found', `Member not found in group task ${input.taskId}`);
            }
            target.removedAt = Date.now();
            target.removePinId = input.removePinId ?? null;
            await writeState(state);
            return target;
        }),
        setMemberStatus: (taskId, slug, status, globalMetaId) => enqueue(async () => {
            if (!(0, types_1.isGroupTaskMemberStatus)(status)) {
                throw new GroupTaskStoreError('invalid_member_status', `Invalid member status: ${String(status)}`);
            }
            const state = await readState();
            const member = slug != null
                ? state.members.find((entry) => entry.taskId === taskId && entry.slug === slug && entry.removedAt == null)
                : state.members.find((entry) => entry.taskId === taskId
                    && normalizeGlobalMetaId(entry.globalMetaId) === normalizeGlobalMetaId(globalMetaId)
                    && entry.removedAt == null);
            if (!member)
                return null;
            member.status = status;
            member.statusChangedAt = Date.now();
            await writeState(state);
            return member;
        }),
        addDeliverable: (input) => enqueue(async () => {
            const state = await readState();
            requireTask(state, input.taskId);
            const deliverable = {
                id: nextId(state),
                taskId: input.taskId,
                msgPinId: input.msgPinId?.trim() || null,
                authorGlobalMetaId: input.authorGlobalMetaId?.trim() || null,
                kind: input.kind?.trim() || null,
                uri: input.uri?.trim() || null,
                status: 'pending',
                createdAt: Date.now(),
                verification: null,
                confirmation: 'unconfirmed',
            };
            state.deliverables.push(deliverable);
            await writeState(state);
            return deliverable;
        }),
        listDeliverables: async (taskId) => {
            const state = await readState();
            return state.deliverables.filter((entry) => entry.taskId === taskId);
        },
        hasDeliverableWithMsgPin: async (taskId, msgPinId) => {
            const state = await readState();
            return state.deliverables.some((entry) => entry.taskId === taskId && entry.msgPinId === msgPinId);
        },
        deleteDeliverable: (deliverableId) => enqueue(async () => {
            const state = await readState();
            const before = state.deliverables.length;
            state.deliverables = state.deliverables.filter((entry) => entry.id !== deliverableId);
            if (state.deliverables.length === before)
                return false;
            await writeState(state);
            return true;
        }),
        updateDeliverableVerification: (deliverableId, verification, confirmation, status) => enqueue(async () => {
            const state = await readState();
            const deliverable = state.deliverables.find((entry) => entry.id === deliverableId);
            if (!deliverable)
                return;
            deliverable.verification = verification;
            deliverable.confirmation = confirmation;
            if (status)
                deliverable.status = status;
            await writeState(state);
        }),
        updateDeliverablesStatusByTask: (taskId, fromStatus, toStatus) => enqueue(async () => {
            const state = await readState();
            let changed = 0;
            for (const deliverable of state.deliverables) {
                if (deliverable.taskId === taskId && deliverable.status === fromStatus) {
                    deliverable.status = toStatus;
                    changed += 1;
                }
            }
            if (changed > 0)
                await writeState(state);
            return changed;
        }),
        addTransition: (input) => enqueue(async () => {
            const state = await readState();
            const transition = {
                id: nextId(state),
                taskId: input.taskId,
                fromStatus: input.fromStatus,
                toStatus: input.toStatus,
                actor: input.actor ?? null,
                reason: input.reason ?? null,
                createdAt: Date.now(),
            };
            state.transitions.push(transition);
            await writeState(state);
            return transition;
        }),
        listTransitions: async (taskId) => {
            const state = await readState();
            return state.transitions.filter((entry) => entry.taskId === taskId);
        },
        listStatusEvents: async (taskId) => {
            const state = await readState();
            return state.statusEvents
                .filter((entry) => entry.taskId === taskId)
                .sort((left, right) => right.createdAt - left.createdAt);
        },
        openCheckpoint: (taskId, topic, openedMsgPinId) => enqueue(async () => {
            const state = await readState();
            requireTask(state, taskId);
            const existing = state.checkpoints.find((entry) => entry.taskId === taskId && entry.status === 'open');
            if (existing)
                return existing;
            const checkpoint = {
                id: nextId(state),
                taskId,
                topic: topic?.trim() || null,
                openedMsgPinId: openedMsgPinId?.trim() || null,
                status: 'open',
                resolution: null,
                resolvedMsgPinId: null,
                createdAt: Date.now(),
                resolvedAt: null,
            };
            state.checkpoints.push(checkpoint);
            await writeState(state);
            return checkpoint;
        }),
        resolveCheckpoint: (taskId, resolution, resolvedMsgPinId) => enqueue(async () => {
            const state = await readState();
            const checkpoint = state.checkpoints.find((entry) => entry.taskId === taskId && entry.status === 'open');
            if (!checkpoint)
                return null;
            checkpoint.status = 'resolved';
            checkpoint.resolution = resolution?.trim() || null;
            checkpoint.resolvedMsgPinId = resolvedMsgPinId?.trim() || null;
            checkpoint.resolvedAt = Date.now();
            await writeState(state);
            return checkpoint;
        }),
        closeOpenCheckpoints: (taskId, status, resolution) => enqueue(async () => {
            const state = await readState();
            let closed = 0;
            for (const checkpoint of state.checkpoints) {
                if (checkpoint.taskId === taskId && checkpoint.status === 'open') {
                    checkpoint.status = status;
                    checkpoint.resolution = resolution;
                    checkpoint.resolvedAt = Date.now();
                    closed += 1;
                }
            }
            if (closed > 0)
                await writeState(state);
            return closed;
        }),
        listCheckpoints: async (taskId) => {
            const state = await readState();
            return state.checkpoints
                .filter((entry) => entry.taskId === taskId)
                .sort((left, right) => left.createdAt - right.createdAt);
        },
        addIntegrityEvent: (input) => enqueue(async () => {
            const state = await readState();
            const event = {
                id: nextId(state),
                taskId: input.taskId,
                msgPinId: input.msgPinId?.trim() || null,
                authorGlobalMetaId: input.authorGlobalMetaId?.trim() || null,
                eventType: input.eventType,
                detail: input.detail?.trim().slice(0, 500) || null,
                createdAt: Date.now(),
            };
            state.integrityEvents.push(event);
            await writeState(state);
            return event;
        }),
        listIntegrityEvents: async (taskId) => {
            const state = await readState();
            return state.integrityEvents.filter((entry) => entry.taskId === taskId);
        },
        hasIntegrityEventWithMsgPin: async (taskId, msgPinId) => {
            const state = await readState();
            return state.integrityEvents.some((entry) => entry.taskId === taskId && entry.msgPinId === msgPinId);
        },
        addPlanChange: (input) => enqueue(async () => {
            const state = await readState();
            const planChange = {
                id: nextId(state),
                taskId: input.taskId,
                msgPinId: input.msgPinId?.trim() || null,
                authorGlobalMetaId: input.authorGlobalMetaId?.trim() || null,
                summary: input.summary.trim().slice(0, 240),
                createdAt: Date.now(),
            };
            state.planChanges.push(planChange);
            await writeState(state);
            return planChange;
        }),
        listPlanChanges: async (taskId) => {
            const state = await readState();
            return state.planChanges.filter((entry) => entry.taskId === taskId);
        },
        addAcceptanceSummary: (input) => enqueue(async () => {
            const state = await readState();
            const previous = state.acceptanceSummaries
                .filter((entry) => entry.taskId === input.taskId)
                .sort((left, right) => right.version - left.version)[0];
            const summary = {
                ...input,
                id: nextId(state),
                version: (previous?.version ?? 0) + 1,
                generatedAt: input.generatedAt ?? Date.now(),
            };
            state.acceptanceSummaries.push(summary);
            await writeState(state);
            return summary;
        }),
        getLatestAcceptanceSummary: async (taskId) => {
            const state = await readState();
            const summaries = state.acceptanceSummaries
                .filter((entry) => entry.taskId === taskId)
                .sort((left, right) => right.version - left.version);
            return summaries[0] ?? null;
        },
        finalizeAcceptanceSummary: (taskId, input) => enqueue(async () => {
            const state = await readState();
            const summary = state.acceptanceSummaries
                .filter((entry) => entry.taskId === taskId)
                .sort((left, right) => right.version - left.version)[0];
            if (!summary)
                return;
            summary.outcome = input.outcome;
            summary.rating = input.rating;
            summary.ratingComment = input.ratingComment;
            await writeState(state);
        }),
        updateAcceptanceSummaryPublishedPin: (taskId, pinId) => enqueue(async () => {
            const state = await readState();
            const summary = state.acceptanceSummaries
                .filter((entry) => entry.taskId === taskId)
                .sort((left, right) => right.version - left.version)[0];
            if (!summary)
                return;
            summary.publishedGroupPinId = pinId;
            await writeState(state);
        }),
        appendMessages: (groupId, incoming) => enqueue(async () => {
            if (incoming.length === 0)
                return 0;
            const existing = await readMessages(groupId);
            const byKey = new Map();
            for (const message of existing) {
                byKey.set(message.pinId ?? `idx:${message.index}`, message);
            }
            let inserted = 0;
            for (const message of incoming) {
                const key = message.pinId ?? `idx:${message.index}`;
                if (!byKey.has(key)) {
                    byKey.set(key, message);
                    inserted += 1;
                }
            }
            if (inserted === 0)
                return 0;
            const merged = [...byKey.values()].sort((left, right) => left.index - right.index);
            await writeJsonFileAtomic(messagesPath(groupId), { messages: merged, updatedAt: Date.now() });
            return inserted;
        }),
        listMessages: async (groupId, opts) => {
            const messages = await readMessages(groupId);
            const beforeIndex = opts?.beforeIndex;
            const filtered = beforeIndex != null
                ? messages.filter((message) => message.index < beforeIndex)
                : messages;
            const limit = Math.max(1, Math.min(500, Math.trunc(opts?.limit ?? 50)));
            return {
                messages: filtered.slice(-limit),
                total: messages.length,
            };
        },
        getMessageByPinId: async (groupId, pinId) => {
            const messages = await readMessages(groupId);
            return messages.find((message) => message.pinId === pinId) ?? null;
        },
        getMessageCursor: async (groupId) => {
            const messages = await readMessages(groupId);
            if (messages.length === 0)
                return -1;
            return messages[messages.length - 1].index;
        },
        getMembersLastSpeakAt: async (groupId, globalMetaIds) => {
            const wanted = new Set(globalMetaIds.map(normalizeGlobalMetaId).filter(Boolean));
            const result = new Map();
            if (wanted.size === 0)
                return result;
            const messages = await readMessages(groupId);
            for (const message of messages) {
                const gmid = normalizeGlobalMetaId(message.senderGlobalMetaId);
                if (!gmid || !wanted.has(gmid) || message.chainTimestamp == null)
                    continue;
                const previous = result.get(gmid) ?? 0;
                if (message.chainTimestamp > previous)
                    result.set(gmid, message.chainTimestamp);
            }
            return result;
        },
        getMembersWorkingAt: async (groupId, globalMetaIds) => {
            const wanted = new Set(globalMetaIds.map(normalizeGlobalMetaId).filter(Boolean));
            const result = new Map();
            if (wanted.size === 0)
                return result;
            const messages = await readMessages(groupId);
            for (const message of messages) {
                if (!WORKING_TAG.test(message.content))
                    continue;
                const gmid = normalizeGlobalMetaId(message.senderGlobalMetaId);
                if (!gmid || !wanted.has(gmid) || message.chainTimestamp == null)
                    continue;
                const previous = result.get(gmid) ?? 0;
                if (message.chainTimestamp > previous)
                    result.set(gmid, message.chainTimestamp);
            }
            return result;
        },
        kvGet: async (key) => {
            const state = await readState();
            return state.kv[key];
        },
        kvSet: (key, value) => enqueue(async () => {
            const state = await readState();
            state.kv[key] = value;
            await writeState(state);
        }),
        kvDelete: (key) => enqueue(async () => {
            const state = await readState();
            if (key in state.kv) {
                delete state.kv[key];
                await writeState(state);
            }
        }),
    };
}
