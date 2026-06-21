"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomDashboard = buildLoomDashboard;
exports.findLoomDashboardTaskDetail = findLoomDashboardTaskDetail;
const workflowState_1 = require("./workflowState");
const dashboardIdentity_1 = require("./dashboardIdentity");
const dashboardActions_1 = require("./dashboardActions");
const BOARD_COLUMNS = [
    { id: 'open', title: 'Open', states: ['open'] },
    { id: 'claimed', title: 'Claimed', states: ['claimed'] },
    { id: 'working', title: 'Working', states: ['in_progress'] },
    { id: 'review', title: 'Review', states: ['delivered'] },
    { id: 'revision', title: 'Revision', states: ['revision_needed'] },
    { id: 'closed', title: 'Closed', states: ['accepted_paid', 'rejected', 'failed'] },
];
const TIMELINE_PRIORITY = {
    task: 0,
    claim: 1,
    status: 2,
    delivery: 3,
    acceptance: 4,
    claim_reject: 5,
    local_workflow: 6,
    invalid_record: 7,
};
function payloadObject(record) {
    return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function stringField(record, key) {
    return stringValue(payloadObject(record)[key]);
}
function stringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function compareRecords(left, right) {
    return left.timestamp - right.timestamp || left.pinId.localeCompare(right.pinId);
}
function sortRecords(records) {
    return [...records].sort(compareRecords);
}
function latestRecord(records) {
    return sortRecords(records).at(-1);
}
function isAfter(left, right) {
    return Boolean(left && right && compareRecords(left, right) > 0);
}
function paymentTxId(record) {
    return record ? stringValue(payloadObject(record).paymentTxId) : undefined;
}
function columnIdForState(state) {
    return BOARD_COLUMNS.find((column) => column.states.includes(state))?.id ?? 'open';
}
function toneForState(state) {
    switch (state) {
        case 'open':
            return 'neutral';
        case 'claimed':
            return 'info';
        case 'in_progress':
            return 'progress';
        case 'delivered':
            return 'review';
        case 'revision_needed':
            return 'warning';
        case 'accepted_paid':
            return 'success';
        case 'rejected':
        case 'failed':
            return 'danger';
    }
}
function activeBuckets(valid) {
    const rejectedClaimIds = new Set(valid.claimRejects
        .map((claimReject) => stringField(claimReject, 'claimPinId'))
        .filter((claimPinId) => Boolean(claimPinId)));
    const claims = valid.claims.filter((claim) => !rejectedClaimIds.has(claim.pinId));
    const claimIds = new Set(claims.map((claim) => claim.pinId));
    const deliveries = valid.deliveries.filter((delivery) => claimIds.has(stringField(delivery, 'claimPinId') ?? ''));
    const deliveryIds = new Set(deliveries.map((delivery) => delivery.pinId));
    return {
        claims,
        statuses: valid.statuses.filter((status) => claimIds.has(stringField(status, 'claimPinId') ?? '')),
        deliveries,
        acceptances: valid.acceptances.filter((acceptance) => deliveryIds.has(stringField(acceptance, 'deliveryPinId') ?? '')),
        claimRejects: valid.claimRejects,
    };
}
function deriveDashboardState(valid) {
    const active = activeBuckets(valid);
    const latestStatus = latestRecord(active.statuses);
    const latestDelivery = latestRecord(active.deliveries);
    const latestAcceptance = latestRecord(active.acceptances);
    if (latestAcceptance
        && (!latestDelivery || !isAfter(latestDelivery, latestAcceptance))
        && (!latestStatus || !isAfter(latestStatus, latestAcceptance))) {
        const payload = payloadObject(latestAcceptance);
        if (payload.verdict === 'revision_needed') {
            return 'revision_needed';
        }
        if (payload.verdict === 'rejected') {
            return 'rejected';
        }
        if (payload.verdict === 'passed' && payload.releasePayment === true && paymentTxId(latestAcceptance)) {
            return 'accepted_paid';
        }
    }
    if (latestStatus && payloadObject(latestStatus).status === 'failed') {
        return 'failed';
    }
    if (latestDelivery) {
        return 'delivered';
    }
    if (latestStatus) {
        const status = payloadObject(latestStatus).status;
        if (status === 'started' || status === 'in_progress') {
            return 'in_progress';
        }
    }
    if (active.claims.length > 0) {
        return 'claimed';
    }
    return active.claimRejects.length > 0 ? 'rejected' : 'open';
}
function localEvidenceFromWorkflow(state) {
    const llmSessionIds = state.statuses
        .map((status) => status.llmSessionId)
        .filter((id) => Boolean(id));
    return {
        claimPinId: state.claimPinId,
        developerMetaBotSlug: state.developerMetaBotSlug,
        branchName: state.branchName,
        workspacePath: state.workspacePath,
        updatedAt: state.updatedAt,
        llmSessionIds: [...new Set(llmSessionIds)],
        processLogPaths: state.statuses
            .map((status) => status.processLogPath)
            .filter((logPath) => Boolean(logPath)),
        processLogUris: state.statuses
            .map((status) => status.processLogUri)
            .filter((logUri) => Boolean(logUri)),
        commits: state.statuses.flatMap((status) => status.commits),
    };
}
function warningFromInvalid(taskPinId, invalid) {
    return {
        taskPinId,
        recordPinId: invalid.record.pinId,
        protocol: invalid.record.protocol,
        code: invalid.reason.code,
        message: invalid.reason.message,
        timestamp: invalid.record.timestamp,
    };
}
function flattenWarnings(taskPinId, invalid) {
    return [
        ...invalid.tasks,
        ...invalid.claims,
        ...invalid.statuses,
        ...invalid.deliveries,
        ...invalid.acceptances,
        ...invalid.claimRejects,
    ].map((entry) => warningFromInvalid(taskPinId, entry));
}
function missingPaymentWarning(taskPinId, acceptance) {
    if (!acceptance) {
        return undefined;
    }
    const payload = payloadObject(acceptance);
    if (payload.verdict === 'passed' && payload.releasePayment === true && !paymentTxId(acceptance)) {
        return {
            taskPinId,
            recordPinId: acceptance.pinId,
            protocol: 'acceptance',
            code: 'missing_payment_txid',
            message: 'Passed loom-acceptance with releasePayment true must include paymentTxId to close as accepted_paid.',
            timestamp: acceptance.timestamp,
        };
    }
    return undefined;
}
function eventForRecord(taskPinId, kind, record) {
    const payload = payloadObject(record);
    const summary = stringValue(payload.progressSummary)
        ?? stringValue(payload.deliverySummary)
        ?? stringValue(payload.comment)
        ?? stringValue(payload.message)
        ?? stringValue(payload.reason);
    return {
        id: `${kind}:${record.pinId}`,
        kind,
        taskPinId,
        timestamp: record.timestamp,
        title: record.protocol,
        ...(summary ? { summary } : {}),
        pinId: record.pinId,
        protocol: record.protocol,
    };
}
function eventForWarning(warning) {
    return {
        id: `invalid:${warning.recordPinId}:${warning.code}`,
        kind: 'invalid_record',
        taskPinId: warning.taskPinId,
        timestamp: warning.timestamp,
        title: 'Invalid record',
        summary: warning.message,
        pinId: warning.recordPinId,
        protocol: warning.protocol,
        warningCode: warning.code,
    };
}
function eventForLocalWorkflow(taskPinId, local) {
    const timestamp = localWorkflowTimestamp(local);
    return {
        id: `local_workflow:${taskPinId}:${local.claimPinId}:${local.updatedAt}`,
        kind: 'local_workflow',
        taskPinId,
        timestamp,
        title: 'Local workflow evidence',
        summary: local.branchName,
    };
}
function localWorkflowTimestamp(local) {
    const timestamp = Date.parse(local.updatedAt);
    return Number.isFinite(timestamp) ? timestamp : 0;
}
function sortTimeline(events) {
    return [...events].sort((left, right) => (left.timestamp - right.timestamp
        || TIMELINE_PRIORITY[left.kind] - TIMELINE_PRIORITY[right.kind]
        || left.id.localeCompare(right.id)));
}
function actorContextForTask(actor, requesterGlobalMetaId, requesterAddress, activeClaims, state) {
    const actorGlobalMetaId = actor?.globalMetaId;
    const actorAddress = actor?.address;
    const isRequester = Boolean((actorGlobalMetaId && requesterGlobalMetaId && actorGlobalMetaId === requesterGlobalMetaId)
        || (actorAddress && requesterAddress && actorAddress === requesterAddress));
    const isDeveloper = activeClaims.some((claim) => Boolean((actorGlobalMetaId && claim.globalMetaId === actorGlobalMetaId)
        || (actorAddress && claim.creatorAddress === actorAddress)));
    const requesterNeedsAction = isRequester && state === 'delivered';
    const developerNeedsAction = isDeveloper && ['claimed', 'in_progress', 'revision_needed'].includes(state);
    return {
        isRequester,
        isDeveloper,
        needsMyAction: requesterNeedsAction || developerNeedsAction,
        role: isRequester && isDeveloper ? 'both' : isRequester ? 'requester' : isDeveloper ? 'developer' : 'none',
    };
}
function claimSummary(claim, active, options) {
    const payload = payloadObject(claim);
    return {
        pinId: claim.pinId,
        taskPinId: stringField(claim, 'taskPinId') ?? '',
        timestamp: claim.timestamp,
        active,
        payoutAddress: stringValue(payload.payoutAddress),
        message: stringValue(payload.message),
        developer: (0, dashboardIdentity_1.projectLoomDashboardBotIdentity)({
            role: 'developer',
            author: claim,
            identityMap: options.identityMap,
        }),
    };
}
function bountyFromTask(task) {
    const bounty = objectValue(payloadObject(task).bounty);
    const amount = stringValue(bounty.amount);
    const currency = stringValue(bounty.currency);
    return amount || currency ? { ...(amount ? { amount } : {}), ...(currency ? { currency } : {}) } : undefined;
}
function repoFromTask(task) {
    const project = objectValue(payloadObject(task).project);
    const repoUri = stringValue(project.repoUri);
    const baseBranch = stringValue(project.baseBranch);
    return repoUri || baseBranch ? { ...(repoUri ? { repoUri } : {}), ...(baseBranch ? { baseBranch } : {}) } : undefined;
}
function deliveryPrUrl(delivery) {
    return delivery ? stringValue(objectValue(payloadObject(delivery).delivery).prUrl) : undefined;
}
function latestActivity(task, timeline) {
    return Math.max(task.timestamp, ...timeline.map((event) => event.timestamp));
}
function makeColumns(tasks) {
    return BOARD_COLUMNS.map((column) => ({
        ...column,
        states: [...column.states],
        cards: tasks.filter((task) => task.columnId === column.id),
    }));
}
function matchesFilters(card, detail, filters) {
    if (filters.state) {
        const stateOrColumn = filters.state;
        if (card.state !== stateOrColumn && card.columnId !== stateOrColumn) {
            return false;
        }
    }
    if (filters.role === 'requester' && !card.actorContext.isRequester) {
        return false;
    }
    if (filters.role === 'developer' && !card.actorContext.isDeveloper) {
        return false;
    }
    if (filters.role === 'needs_action' && !card.actorContext.needsMyAction) {
        return false;
    }
    if (filters.query) {
        const query = filters.query.toLowerCase();
        const haystack = [
            card.title,
            card.taskPinId,
            card.repo?.repoUri,
            card.prUrl,
            card.paymentTxId,
            ...card.tags,
            ...detail.claims.map((claim) => claim.pinId),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(query)) {
            return false;
        }
    }
    return true;
}
function summarize(tasks, warnings) {
    return {
        totalTasks: tasks.length,
        open: tasks.filter((task) => task.state === 'open').length,
        claimed: tasks.filter((task) => task.state === 'claimed').length,
        inProgress: tasks.filter((task) => task.state === 'in_progress').length,
        delivered: tasks.filter((task) => task.state === 'delivered').length,
        revisionNeeded: tasks.filter((task) => task.state === 'revision_needed').length,
        rejected: tasks.filter((task) => task.state === 'rejected').length,
        acceptedPaid: tasks.filter((task) => task.state === 'accepted_paid').length,
        failed: tasks.filter((task) => task.state === 'failed').length,
        invalidRecords: warnings.length,
        needsMyAction: tasks.filter((task) => task.actorContext.needsMyAction).length,
        newestActivityAt: tasks.length ? Math.max(...tasks.map((task) => task.updatedAt)) : undefined,
    };
}
function buildLoomDashboard(rawState, options = {}) {
    const workflowStates = options.workflowStates ?? [];
    const cards = [];
    const details = [];
    for (const task of sortRecords(rawState.records.task)) {
        const workflowState = (0, workflowState_1.buildLoomWorkflowTaskState)(rawState, task.pinId);
        if (!workflowState.found) {
            continue;
        }
        const taskPayload = payloadObject(task);
        const valid = workflowState.valid;
        const active = activeBuckets(valid);
        const activeClaimIds = new Set(active.claims.map((claim) => claim.pinId));
        const latestActiveClaim = latestRecord(active.claims);
        const latestStatus = latestRecord(active.statuses);
        const latestDelivery = latestRecord(active.deliveries);
        const latestAcceptance = latestRecord(active.acceptances);
        const state = deriveDashboardState(valid);
        const columnId = columnIdForState(state);
        const localWorkflow = workflowStates
            .filter((localState) => localState.taskPinId === task.pinId)
            .map(localEvidenceFromWorkflow)
            .sort((left, right) => localWorkflowTimestamp(left) - localWorkflowTimestamp(right)
            || left.claimPinId.localeCompare(right.claimPinId));
        const warnings = flattenWarnings(task.pinId, workflowState.invalid);
        const paymentWarning = missingPaymentWarning(task.pinId, latestAcceptance);
        if (paymentWarning) {
            warnings.push(paymentWarning);
        }
        const claimSummaries = sortRecords(valid.claims).map((claim) => claimSummary(claim, activeClaimIds.has(claim.pinId), options));
        const requester = (0, dashboardIdentity_1.projectLoomDashboardBotIdentity)({
            role: 'requester',
            author: task,
            identityMap: options.identityMap,
        });
        const developer = latestActiveClaim
            ? (0, dashboardIdentity_1.projectLoomDashboardBotIdentity)({
                role: 'developer',
                author: latestActiveClaim,
                identityMap: options.identityMap,
            })
            : undefined;
        const timeline = sortTimeline([
            eventForRecord(task.pinId, 'task', task),
            ...valid.claims.map((record) => eventForRecord(task.pinId, 'claim', record)),
            ...valid.statuses.map((record) => eventForRecord(task.pinId, 'status', record)),
            ...valid.deliveries.map((record) => eventForRecord(task.pinId, 'delivery', record)),
            ...valid.acceptances.map((record) => eventForRecord(task.pinId, 'acceptance', record)),
            ...valid.claimRejects.map((record) => eventForRecord(task.pinId, 'claim_reject', record)),
            ...warnings.map(eventForWarning),
            ...localWorkflow.map((local) => eventForLocalWorkflow(task.pinId, local)),
        ]);
        const updatedAt = latestActivity(task, timeline);
        const actorContext = actorContextForTask(options.actorContext, task.globalMetaId, task.creatorAddress, active.claims, state);
        const local = localWorkflow.at(-1);
        const card = {
            taskPinId: task.pinId,
            state,
            stateTone: toneForState(state),
            columnId,
            title: stringValue(taskPayload.title) ?? task.pinId,
            requester,
            ...(developer ? { developer } : {}),
            ...(bountyFromTask(task) ? { bounty: bountyFromTask(task) } : {}),
            ...(repoFromTask(task) ? { repo: repoFromTask(task) } : {}),
            tags: stringArray(taskPayload.tags),
            createdAt: task.timestamp,
            updatedAt,
            activeClaimCount: active.claims.length,
            latestStatusSummary: latestStatus ? stringValue(payloadObject(latestStatus).progressSummary) : undefined,
            prUrl: deliveryPrUrl(latestDelivery),
            paymentTxId: state === 'accepted_paid' ? paymentTxId(latestAcceptance) : undefined,
            warningCount: warnings.length,
            actorContext,
            ...(local ? { local } : {}),
        };
        const detail = {
            taskPinId: task.pinId,
            state,
            columnId,
            title: card.title,
            requirement: stringValue(taskPayload.requirement),
            criteria: stringValue(taskPayload.criteria),
            requester,
            claims: claimSummaries,
            warnings,
            timeline,
            localWorkflow,
            nextActions: [],
            task,
            validRecords: {
                claims: valid.claims,
                statuses: valid.statuses,
                deliveries: valid.deliveries,
                acceptances: valid.acceptances,
                claimRejects: valid.claimRejects,
            },
        };
        card.summaryPreview = (0, dashboardActions_1.buildLoomDashboardSummaryPreview)({ card, detail });
        detail.nextActions = (0, dashboardActions_1.projectLoomDashboardNextActions)({
            card,
            detail,
            actor: options.actorContext,
        });
        card.nextAction = (0, dashboardActions_1.selectLoomDashboardCardAction)(detail.nextActions);
        cards.push(card);
        details.push(detail);
    }
    const sortedPairs = cards
        .map((card, index) => ({ card, detail: details[index] }))
        .sort((left, right) => right.card.updatedAt - left.card.updatedAt || left.card.taskPinId.localeCompare(right.card.taskPinId));
    const filters = options.filters ?? {};
    const filteredPairs = sortedPairs.filter(({ card, detail }) => matchesFilters(card, detail, filters));
    const limitedPairs = typeof filters.limit === 'number' && filters.limit >= 0
        ? filteredPairs.slice(0, filters.limit)
        : filteredPairs;
    const tasks = limitedPairs.map(({ card }) => card);
    const filteredDetails = limitedPairs.map(({ detail }) => detail);
    const warnings = filteredDetails.flatMap((detail) => detail.warnings);
    return {
        version: 1,
        updatedAt: options.now ?? Date.now(),
        rawCacheUpdatedAt: rawState.updatedAt,
        ...(options.actorContext ? { actor: options.actorContext } : {}),
        summary: summarize(tasks, warnings),
        filters,
        columns: makeColumns(tasks),
        tasks,
        details: filteredDetails,
        warnings,
        refresh: {
            requested: options.refresh?.requested ?? false,
            succeeded: options.refresh?.succeeded ?? true,
            updatedAt: options.refresh?.updatedAt ?? rawState.updatedAt,
            warning: options.refresh?.warning ?? null,
        },
    };
}
function findLoomDashboardTaskDetail(dashboard, taskPinId) {
    return dashboard.details.find((detail) => detail.taskPinId === taskPinId);
}
