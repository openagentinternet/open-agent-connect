"use strict";
/**
 * Staffing proposal store: file-backed CRUD for the wish→slate→owner-gate
 * pipeline (OAC port of the IDBots `group_task_staffing_proposals` table).
 *
 * Layout (storage layout v2, under the CHAIR profile's grouptask root):
 *   .runtime/grouptask/staffing.json — proposals + id sequence
 *
 * Writes are atomic (tmp + rename) and serialized through an in-process
 * queue; the daemon is the only writer (CLI verbs delegate over HTTP). The
 * claim/release pair is the CAS that keeps two concurrent create attempts
 * from double-opening an on-chain group: `claim` only succeeds while the
 * proposal sits in a creatable state, `release` restores that state when the
 * chain create failed so the slate is not burned.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffingStoreError = void 0;
exports.createStaffingStore = createStaffingStore;
exports.staffingProposalUsableAt = staffingProposalUsableAt;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const staffing_1 = require("./staffing");
function emptyState() {
    return { seq: 0, proposals: [] };
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
class StaffingStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'StaffingStoreError';
    }
}
exports.StaffingStoreError = StaffingStoreError;
/** Statuses from which a proposal may still be claimed for creation. */
const CREATABLE_STATUSES = [
    'pending',
    'confirmed',
    'skip_authorized',
];
function restoredStatus(record) {
    if (record.ownerDecision === 'confirm')
        return 'confirmed';
    if (record.ownerDecision === 'skip')
        return 'skip_authorized';
    return 'pending';
}
function createStaffingStore(paths) {
    const filePath = node_path_1.default.join(paths.runtimeRoot, 'grouptask', 'staffing.json');
    let queue = Promise.resolve();
    const enqueue = (work) => {
        const next = queue.then(work, work);
        queue = next.catch(() => undefined);
        return next;
    };
    async function readState() {
        const parsed = await readJsonFile(filePath);
        if (!parsed || typeof parsed !== 'object')
            return emptyState();
        const proposals = Array.isArray(parsed.proposals)
            ? parsed.proposals.map((row) => normalizeProposalRecord(row))
            : [];
        return {
            seq: Number.isInteger(parsed.seq) && parsed.seq >= 0 ? parsed.seq : 0,
            proposals,
        };
    }
    async function writeState(state) {
        await writeJsonFileAtomic(filePath, state);
    }
    function requireProposal(state, id) {
        const record = state.proposals.find((entry) => entry.id === id);
        if (!record) {
            throw new StaffingStoreError('proposal_not_found', `Staffing proposal ${id} not found`);
        }
        return record;
    }
    return {
        filePath,
        createProposal: (input) => enqueue(async () => {
            const state = await readState();
            const now = Date.now();
            const record = {
                id: state.seq + 1,
                chairSlug: input.chairSlug,
                sourceSessionId: input.sourceSessionId?.trim() || null,
                title: input.title,
                goal: input.goal,
                acceptanceCriteria: input.acceptanceCriteria ?? null,
                plan: (0, staffing_1.normalizeStaffingPlan)(input.plan),
                status: input.skipAuthorized ? 'skip_authorized' : 'pending',
                skipAuthorized: input.skipAuthorized,
                ownerDecision: null,
                createdTaskId: null,
                createdAt: now,
                confirmedAt: null,
                updatedAt: now,
            };
            state.seq = record.id;
            state.proposals.push(record);
            await writeState(state);
            return record;
        }),
        listProposals: (options) => enqueue(async () => {
            const state = await readState();
            const rows = [...state.proposals].sort((left, right) => right.createdAt - left.createdAt);
            return options?.status ? rows.filter((row) => row.status === options.status) : rows;
        }),
        getProposal: (id) => enqueue(async () => {
            const state = await readState();
            return state.proposals.find((entry) => entry.id === id) ?? null;
        }),
        claimProposal: (id) => enqueue(async () => {
            const state = await readState();
            const record = requireProposal(state, id);
            if (!CREATABLE_STATUSES.includes(record.status)) {
                throw new StaffingStoreError('proposal_not_claimable', `Staffing proposal ${id} is ${record.status} and cannot be claimed`);
            }
            record.status = 'consumed';
            record.updatedAt = Date.now();
            await writeState(state);
            return record;
        }),
        releaseProposal: (id) => enqueue(async () => {
            const state = await readState();
            const record = requireProposal(state, id);
            if (record.status === 'consumed' && record.createdTaskId === null) {
                record.status = restoredStatus(record);
                record.updatedAt = Date.now();
                await writeState(state);
            }
            return record;
        }),
        markProposalCreated: (id, taskId) => enqueue(async () => {
            const state = await readState();
            const record = requireProposal(state, id);
            record.createdTaskId = taskId;
            record.status = 'consumed';
            record.updatedAt = Date.now();
            await writeState(state);
            return record;
        }),
        setOwnerDecision: (id, decision) => enqueue(async () => {
            const state = await readState();
            const record = requireProposal(state, id);
            if (record.status === 'consumed' || record.status === 'cancelled') {
                throw new StaffingStoreError('proposal_not_decidable', `Staffing proposal ${id} is ${record.status} and can no longer be decided`);
            }
            record.ownerDecision = decision;
            const now = Date.now();
            if (decision === 'confirm') {
                record.status = 'confirmed';
                record.confirmedAt = now;
            }
            else if (decision === 'skip') {
                record.status = 'skip_authorized';
            }
            else {
                // 'revise' reopens the slate for a fresh proposal round.
                record.status = 'pending';
            }
            record.updatedAt = now;
            await writeState(state);
            return record;
        }),
        cancelProposal: (id) => enqueue(async () => {
            const state = await readState();
            const record = requireProposal(state, id);
            if (record.status === 'consumed') {
                throw new StaffingStoreError('proposal_not_cancellable', `Staffing proposal ${id} is consumed by task ${record.createdTaskId}`);
            }
            record.status = 'cancelled';
            record.updatedAt = Date.now();
            await writeState(state);
            return record;
        }),
    };
}
function normalizeProposalRecord(value) {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
    const status = record.status === 'confirmed'
        || record.status === 'skip_authorized'
        || record.status === 'consumed'
        || record.status === 'cancelled'
        ? record.status
        : 'pending';
    const ownerDecision = record.ownerDecision === 'confirm'
        || record.ownerDecision === 'revise'
        || record.ownerDecision === 'skip'
        ? record.ownerDecision
        : null;
    const toNumber = (input) => (typeof input === 'number' && Number.isFinite(input) ? input : null);
    return {
        id: toNumber(record.id) ?? 0,
        chairSlug: typeof record.chairSlug === 'string' ? record.chairSlug : '',
        sourceSessionId: typeof record.sourceSessionId === 'string' ? record.sourceSessionId : null,
        title: typeof record.title === 'string' ? record.title : '',
        goal: typeof record.goal === 'string' ? record.goal : '',
        acceptanceCriteria: typeof record.acceptanceCriteria === 'string' ? record.acceptanceCriteria : null,
        plan: (0, staffing_1.normalizeStaffingPlan)(record.plan),
        status,
        skipAuthorized: record.skipAuthorized === true,
        ownerDecision,
        createdTaskId: toNumber(record.createdTaskId),
        createdAt: toNumber(record.createdAt) ?? 0,
        confirmedAt: toNumber(record.confirmedAt),
        updatedAt: toNumber(record.updatedAt) ?? toNumber(record.createdAt) ?? 0,
    };
}
/** Read-time usability check shared by the service gate. */
function staffingProposalUsableAt(record, nowMs) {
    if (record.createdTaskId !== null)
        return { usable: false, reason: 'created' };
    if (record.status === 'consumed')
        return { usable: false, reason: 'consumed' };
    if (record.status === 'cancelled')
        return { usable: false, reason: 'cancelled' };
    if ((0, staffing_1.isStaffingProposalExpired)(record.createdAt, nowMs))
        return { usable: false, reason: 'expired' };
    return { usable: true, reason: 'ok' };
}
