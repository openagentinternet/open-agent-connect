"use strict";
/**
 * Group Task domain types — the OAC port of the IDBots Group Task feature
 * ("one on-chain SimpleGroupChat room = one task"). Tasks are chaired by a
 * local Bot (twin preferred); local workers and optional remote OpenTeam
 * members coordinate through tagged AES group messages; the daemon engine
 * drives the lifecycle; the owner accepts/cancels from the UI.
 *
 * Timestamps are epoch milliseconds unless a field name says otherwise.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GROUP_TASK_LEGAL_TRANSITIONS = exports.GROUP_TASK_TERMINAL_STATUSES = void 0;
exports.isGroupTaskStatus = isGroupTaskStatus;
exports.isGroupTaskMemberStatus = isGroupTaskMemberStatus;
exports.filterGroupTasksByTab = filterGroupTasksByTab;
exports.GROUP_TASK_TERMINAL_STATUSES = new Set(['done', 'cancelled']);
/**
 * Legal transitions: planning→executing→review→done, →cancelled from any
 * non-terminal state, and review→executing as the rework hatch. The owner's
 * accept/close action may shortcut to 'done' from any non-terminal state.
 */
exports.GROUP_TASK_LEGAL_TRANSITIONS = {
    planning: ['executing', 'done', 'cancelled'],
    executing: ['review', 'done', 'cancelled'],
    review: ['done', 'executing', 'cancelled'],
    done: [],
    cancelled: [],
};
function isGroupTaskStatus(value) {
    return value === 'planning' || value === 'executing' || value === 'review'
        || value === 'done' || value === 'cancelled';
}
function isGroupTaskMemberStatus(value) {
    return value === 'assigned' || value === 'working' || value === 'standby'
        || value === 'done' || value === 'unreachable';
}
function filterGroupTasksByTab(tasks, tab) {
    if (tab === 'all')
        return tasks;
    if (tab === 'done')
        return tasks.filter((task) => task.status === 'done');
    if (tab === 'cancelled')
        return tasks.filter((task) => task.status === 'cancelled');
    return tasks.filter((task) => !exports.GROUP_TASK_TERMINAL_STATUSES.has(task.status));
}
