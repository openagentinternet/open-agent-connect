"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveLoomDashboardIndexPath = resolveLoomDashboardIndexPath;
exports.createLoomDashboardStore = createLoomDashboardStore;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../state/paths");
function resolvePaths(homeDirOrPaths) {
    return typeof homeDirOrPaths === 'string'
        ? (0, paths_1.resolveMetabotPaths)(homeDirOrPaths)
        : homeDirOrPaths;
}
function resolveLoomDashboardIndexPath(homeDirOrPaths) {
    const paths = resolvePaths(homeDirOrPaths);
    return node_path_1.default.join(paths.runtimeRoot, 'loom', 'dashboard', 'index.json');
}
function isRecord(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isBoolean(value) {
    return typeof value === 'boolean';
}
function isString(value) {
    return typeof value === 'string';
}
function isArrayIfPresent(value) {
    return value === undefined || Array.isArray(value);
}
function isStringIfPresent(value) {
    return value === undefined || isString(value);
}
function isStringOrNullIfPresent(value) {
    return value === undefined || isString(value) || value === null;
}
function isFiniteNumberIfPresent(value) {
    return value === undefined || isFiniteNumber(value);
}
function isRecordArray(value) {
    return Array.isArray(value) && value.every(isRecord);
}
function isStringArray(value) {
    return Array.isArray(value) && value.every(isString);
}
function isSerializable(value) {
    try {
        JSON.stringify(value);
        return true;
    }
    catch {
        return false;
    }
}
const requiredSummaryNumberFields = [
    'totalTasks',
    'open',
    'claimed',
    'inProgress',
    'delivered',
    'revisionNeeded',
    'rejected',
    'acceptedPaid',
    'failed',
    'invalidRecords',
    'needsMyAction',
];
const dashboardTaskStates = new Set([
    'open',
    'claimed',
    'in_progress',
    'delivered',
    'revision_needed',
    'rejected',
    'accepted_paid',
    'failed',
]);
const dashboardStateTones = new Set([
    'neutral',
    'info',
    'progress',
    'review',
    'warning',
    'success',
    'danger',
]);
const dashboardColumnIds = new Set([
    'open',
    'claimed',
    'working',
    'review',
    'revision',
    'closed',
]);
const actorContextRoles = new Set([
    'requester',
    'developer',
    'both',
    'none',
]);
function isSetValue(value, allowed) {
    return isString(value) && allowed.has(value);
}
function isValidSummary(value) {
    if (!isRecord(value)) {
        return false;
    }
    return requiredSummaryNumberFields.every((field) => isFiniteNumber(value[field]))
        && isFiniteNumberIfPresent(value.newestActivityAt);
}
function isValidRefresh(value) {
    return isRecord(value)
        && isBoolean(value.requested)
        && isBoolean(value.succeeded)
        && isFiniteNumberIfPresent(value.updatedAt)
        && isStringOrNullIfPresent(value.warning);
}
function isValidFilters(value) {
    return isRecord(value)
        && isStringIfPresent(value.state)
        && isStringIfPresent(value.role)
        && isStringIfPresent(value.query)
        && isFiniteNumberIfPresent(value.limit);
}
function isValidBotIdentity(value) {
    return isRecord(value)
        && isString(value.role)
        && isString(value.displayName)
        && isString(value.fallbackLabel)
        && isString(value.initials)
        && isStringIfPresent(value.globalMetaId)
        && isStringIfPresent(value.address)
        && isStringIfPresent(value.avatarUri);
}
function isValidOptionalBotIdentity(value) {
    return value === undefined || isValidBotIdentity(value);
}
function isValidActorContext(value) {
    return isRecord(value)
        && isBoolean(value.isRequester)
        && isBoolean(value.isDeveloper)
        && isBoolean(value.needsMyAction)
        && isSetValue(value.role, actorContextRoles);
}
function isValidBounty(value) {
    return value === undefined
        || (isRecord(value)
            && isStringIfPresent(value.amount)
            && isStringIfPresent(value.currency));
}
function isValidRepo(value) {
    return value === undefined
        || (isRecord(value)
            && isStringIfPresent(value.repoUri)
            && isStringIfPresent(value.baseBranch));
}
function isValidWarning(value) {
    return isRecord(value)
        && isString(value.taskPinId)
        && isString(value.recordPinId)
        && isString(value.protocol)
        && isString(value.code)
        && isString(value.message)
        && isFiniteNumber(value.timestamp);
}
function isValidTaskCard(value) {
    return isRecord(value)
        && isString(value.taskPinId)
        && isSetValue(value.state, dashboardTaskStates)
        && isSetValue(value.stateTone, dashboardStateTones)
        && isSetValue(value.columnId, dashboardColumnIds)
        && isString(value.title)
        && isValidBotIdentity(value.requester)
        && isValidOptionalBotIdentity(value.developer)
        && isValidBounty(value.bounty)
        && isValidRepo(value.repo)
        && isStringArray(value.tags)
        && isFiniteNumber(value.createdAt)
        && isFiniteNumber(value.updatedAt)
        && isFiniteNumber(value.activeClaimCount)
        && isFiniteNumber(value.warningCount)
        && isValidActorContext(value.actorContext)
        && isStringIfPresent(value.latestStatusSummary)
        && isStringIfPresent(value.prUrl)
        && isStringIfPresent(value.paymentTxId)
        && (value.local === undefined || isValidLocalWorkflow(value.local));
}
function isValidColumn(value) {
    return isRecord(value)
        && isSetValue(value.id, dashboardColumnIds)
        && isString(value.title)
        && isStringArray(value.states)
        && value.states.every((state) => dashboardTaskStates.has(state))
        && Array.isArray(value.cards)
        && value.cards.every(isValidTaskCard);
}
function isValidTimelineEvent(value) {
    return isRecord(value)
        && isString(value.id)
        && isString(value.kind)
        && isString(value.taskPinId)
        && isFiniteNumber(value.timestamp)
        && isString(value.title);
}
function isValidClaimSummary(value) {
    return isRecord(value)
        && isString(value.pinId)
        && isString(value.taskPinId)
        && isFiniteNumber(value.timestamp)
        && isBoolean(value.active)
        && isValidBotIdentity(value.developer);
}
function isValidLocalWorkflow(value) {
    return isRecord(value)
        && isString(value.claimPinId)
        && isString(value.developerMetaBotSlug)
        && isString(value.branchName)
        && isString(value.workspacePath)
        && isString(value.updatedAt)
        && isStringArray(value.llmSessionIds)
        && isStringArray(value.processLogPaths)
        && isStringArray(value.processLogUris)
        && isRecordArray(value.commits);
}
function isValidRecordsBucket(value) {
    return isRecord(value)
        && isRecordArray(value.claims)
        && isRecordArray(value.statuses)
        && isRecordArray(value.deliveries)
        && isRecordArray(value.acceptances)
        && isRecordArray(value.claimRejects);
}
function isValidTaskDetail(value) {
    return isRecord(value)
        && isString(value.taskPinId)
        && isSetValue(value.state, dashboardTaskStates)
        && isSetValue(value.columnId, dashboardColumnIds)
        && isString(value.title)
        && isValidBotIdentity(value.requester)
        && Array.isArray(value.claims)
        && value.claims.every(isValidClaimSummary)
        && Array.isArray(value.warnings)
        && value.warnings.every(isValidWarning)
        && Array.isArray(value.timeline)
        && value.timeline.every(isValidTimelineEvent)
        && Array.isArray(value.localWorkflow)
        && value.localWorkflow.every(isValidLocalWorkflow)
        && isRecord(value.task)
        && isValidRecordsBucket(value.validRecords);
}
function isValidDashboardArrays(state) {
    const columns = Array.isArray(state.columns) ? state.columns : [];
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    const details = Array.isArray(state.details) ? state.details : [];
    const warnings = Array.isArray(state.warnings) ? state.warnings : [];
    return columns.every(isValidColumn)
        && tasks.every(isValidTaskCard)
        && details.every(isValidTaskDetail)
        && warnings.every(isValidWarning);
}
function normalizeDashboardState(state) {
    if (!isRecord(state)) {
        return null;
    }
    if (!isFiniteNumber(state.rawCacheUpdatedAt)
        || !isValidSummary(state.summary)
        || !isValidFilters(state.filters)
        || !isValidRefresh(state.refresh)
        || !isArrayIfPresent(state.columns)
        || !isArrayIfPresent(state.tasks)
        || !isArrayIfPresent(state.details)
        || !isArrayIfPresent(state.warnings)
        || !isValidDashboardArrays(state)) {
        return null;
    }
    const updatedAt = isFiniteNumber(state.updatedAt) ? state.updatedAt : Date.now();
    const normalized = {
        ...state,
        version: 1,
        updatedAt,
        columns: Array.isArray(state.columns) ? state.columns : [],
        tasks: Array.isArray(state.tasks) ? state.tasks : [],
        details: Array.isArray(state.details) ? state.details : [],
        warnings: Array.isArray(state.warnings) ? state.warnings : [],
    };
    return isSerializable(normalized) ? normalized : null;
}
function normalizeDashboardStateForRead(value) {
    if (!isRecord(value)) {
        return null;
    }
    if (value.version !== 1 || !isFiniteNumber(value.updatedAt)) {
        return null;
    }
    return normalizeDashboardState(value);
}
async function writeJsonFileAtomically(filePath, payload) {
    const directory = node_path_1.default.dirname(filePath);
    const basename = node_path_1.default.basename(filePath);
    const tmpPath = node_path_1.default.join(directory, `${basename}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    try {
        await node_fs_1.promises.writeFile(tmpPath, payload, 'utf8');
        await node_fs_1.promises.rename(tmpPath, filePath);
    }
    catch (error) {
        try {
            await node_fs_1.promises.unlink(tmpPath);
        }
        catch {
            // Best-effort cleanup after a failed atomic write attempt.
        }
        throw error;
    }
}
function createLoomDashboardStore(homeDirOrPaths) {
    const indexPath = resolveLoomDashboardIndexPath(homeDirOrPaths);
    return {
        indexPath,
        async read() {
            let raw;
            try {
                raw = await node_fs_1.promises.readFile(indexPath, 'utf8');
            }
            catch (error) {
                if (error.code === 'ENOENT') {
                    return null;
                }
                throw error;
            }
            try {
                return normalizeDashboardStateForRead(JSON.parse(raw));
            }
            catch {
                return null;
            }
        },
        async write(state) {
            const normalized = normalizeDashboardState(state);
            if (!normalized) {
                throw new Error('Cannot write an invalid Loom dashboard index state.');
            }
            await node_fs_1.promises.mkdir(node_path_1.default.dirname(indexPath), { recursive: true });
            await writeJsonFileAtomically(indexPath, `${JSON.stringify(normalized, null, 2)}\n`);
            return normalized;
        },
    };
}
