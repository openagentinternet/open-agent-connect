"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildLoomWorkflowTaskState = buildLoomWorkflowTaskState;
exports.findLatestValidDelivery = findLatestValidDelivery;
exports.findValidClaimForDelivery = findValidClaimForDelivery;
function payloadObject(record) {
    return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};
}
function stringField(record, key) {
    const value = payloadObject(record)[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function createValidBuckets() {
    return {
        claims: [],
        statuses: [],
        deliveries: [],
        acceptances: [],
        claimRejects: [],
    };
}
function createInvalidBuckets() {
    return {
        tasks: [],
        claims: [],
        statuses: [],
        deliveries: [],
        acceptances: [],
        claimRejects: [],
    };
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
function sortLatestFirst(records) {
    return sortRecords(records).reverse();
}
function isAfter(left, right) {
    return Boolean(left && right && compareRecords(left, right) > 0);
}
function invalid(record, code, message) {
    return {
        record,
        reason: { code, message },
    };
}
function rejectInvalidPayload(record) {
    if (record.payloadValid !== false) {
        return undefined;
    }
    return invalid(record, 'invalid_payload', `${record.protocol} payload is invalid and cannot affect workflow state.`);
}
function findTask(rawState, taskPinId, invalidBuckets) {
    const tasks = sortLatestFirst(rawState.records.task.filter((record) => record.pinId === taskPinId));
    for (const task of tasks) {
        const payloadInvalid = rejectInvalidPayload(task);
        if (payloadInvalid) {
            invalidBuckets.tasks.push(payloadInvalid);
            continue;
        }
        return task;
    }
    return undefined;
}
function referencesTask(record, taskPinId) {
    return stringField(record, 'taskPinId') === taskPinId;
}
function claimMismatch(record, claim) {
    const claimPinId = stringField(record, 'claimPinId');
    if (!claimPinId) {
        return invalid(record, 'missing_claim', `${record.protocol} must reference a claim.`);
    }
    if (!claim || claim.pinId !== claimPinId) {
        return invalid(record, 'missing_claim', `${record.protocol} references an unknown claim ${claimPinId}.`);
    }
    return undefined;
}
function paymentTxId(record) {
    if (!record) {
        return undefined;
    }
    const value = payloadObject(record).paymentTxId;
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function claimHasPayoutAddress(record) {
    return Boolean(stringField(record, 'payoutAddress'));
}
function invalidTaskReference(record, taskPinId) {
    return invalid(record, 'invalid_reference', `${record.protocol} must reference task ${taskPinId}.`);
}
function buildActiveStateBuckets(valid) {
    const rejectedClaimIds = new Set(valid.claimRejects
        .map((claimReject) => stringField(claimReject, 'claimPinId'))
        .filter((claimPinId) => Boolean(claimPinId)));
    const activeClaims = valid.claims.filter((claim) => !rejectedClaimIds.has(claim.pinId));
    const activeClaimIds = new Set(activeClaims.map((claim) => claim.pinId));
    const activeDeliveries = valid.deliveries.filter((delivery) => activeClaimIds.has(stringField(delivery, 'claimPinId') ?? ''));
    const activeDeliveryIds = new Set(activeDeliveries.map((delivery) => delivery.pinId));
    return {
        claims: activeClaims,
        statuses: valid.statuses.filter((status) => activeClaimIds.has(stringField(status, 'claimPinId') ?? '')),
        deliveries: activeDeliveries,
        acceptances: valid.acceptances.filter((acceptance) => activeDeliveryIds.has(stringField(acceptance, 'deliveryPinId') ?? '')),
        claimRejects: valid.claimRejects,
    };
}
function stateFromRecords(active, latestStatus, latestDelivery, latestAcceptance) {
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
    if (latestStatus) {
        const status = payloadObject(latestStatus).status;
        if (status === 'failed') {
            return 'failed';
        }
    }
    if (latestDelivery && (!latestAcceptance || isAfter(latestDelivery, latestAcceptance))) {
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
function buildLoomWorkflowTaskState(rawState, taskPinId, _options = {}) {
    const valid = createValidBuckets();
    const invalidBuckets = createInvalidBuckets();
    const task = findTask(rawState, taskPinId, invalidBuckets);
    if (!task) {
        return {
            found: false,
            code: 'task_not_found',
            message: `Loom task not found in cache: ${taskPinId}`,
            taskPinId,
            valid,
            invalid: invalidBuckets,
        };
    }
    const claimsByPinId = new Map();
    for (const claim of sortRecords(rawState.records.claim)) {
        if (!referencesTask(claim, taskPinId)) {
            continue;
        }
        const payloadInvalid = rejectInvalidPayload(claim);
        if (payloadInvalid) {
            invalidBuckets.claims.push(payloadInvalid);
            continue;
        }
        if (!claimHasPayoutAddress(claim)) {
            invalidBuckets.claims.push(invalid(claim, 'missing_payout_address', 'loom-claim must include payoutAddress for workflow use.'));
            continue;
        }
        valid.claims.push(claim);
        claimsByPinId.set(claim.pinId, claim);
    }
    for (const status of sortRecords(rawState.records.status)) {
        const hasTaskReference = referencesTask(status, taskPinId);
        const claim = claimsByPinId.get(stringField(status, 'claimPinId') ?? '');
        if (!hasTaskReference && !claim) {
            continue;
        }
        const payloadInvalid = rejectInvalidPayload(status);
        if (payloadInvalid) {
            invalidBuckets.statuses.push(payloadInvalid);
            continue;
        }
        if (!hasTaskReference) {
            invalidBuckets.statuses.push(invalidTaskReference(status, taskPinId));
            continue;
        }
        const missingClaim = claimMismatch(status, claim);
        if (missingClaim) {
            invalidBuckets.statuses.push(missingClaim);
            continue;
        }
        const validClaim = claim;
        if (status.globalMetaId !== validClaim.globalMetaId) {
            invalidBuckets.statuses.push(invalid(status, 'permission_denied', 'loom-status author must match the referenced claim author.'));
            continue;
        }
        valid.statuses.push(status);
    }
    const deliveriesByPinId = new Map();
    for (const delivery of sortRecords(rawState.records.delivery)) {
        const hasTaskReference = referencesTask(delivery, taskPinId);
        const claim = claimsByPinId.get(stringField(delivery, 'claimPinId') ?? '');
        if (!hasTaskReference && !claim) {
            continue;
        }
        const payloadInvalid = rejectInvalidPayload(delivery);
        if (payloadInvalid) {
            invalidBuckets.deliveries.push(payloadInvalid);
            continue;
        }
        if (!hasTaskReference) {
            invalidBuckets.deliveries.push(invalidTaskReference(delivery, taskPinId));
            continue;
        }
        const missingClaim = claimMismatch(delivery, claim);
        if (missingClaim) {
            invalidBuckets.deliveries.push(missingClaim);
            continue;
        }
        const validClaim = claim;
        if (delivery.globalMetaId !== validClaim.globalMetaId) {
            invalidBuckets.deliveries.push(invalid(delivery, 'permission_denied', 'loom-delivery author must match the referenced claim author.'));
            continue;
        }
        valid.deliveries.push(delivery);
        deliveriesByPinId.set(delivery.pinId, delivery);
    }
    for (const acceptance of sortRecords(rawState.records.acceptance)) {
        const hasTaskReference = referencesTask(acceptance, taskPinId);
        const deliveryPinId = stringField(acceptance, 'deliveryPinId');
        const delivery = deliveryPinId ? deliveriesByPinId.get(deliveryPinId) : undefined;
        if (!hasTaskReference && !delivery) {
            continue;
        }
        const payloadInvalid = rejectInvalidPayload(acceptance);
        if (payloadInvalid) {
            invalidBuckets.acceptances.push(payloadInvalid);
            continue;
        }
        if (!hasTaskReference) {
            invalidBuckets.acceptances.push(invalidTaskReference(acceptance, taskPinId));
            continue;
        }
        if (!deliveryPinId || !delivery) {
            invalidBuckets.acceptances.push(invalid(acceptance, 'missing_delivery', `loom-acceptance references an unknown delivery ${deliveryPinId ?? ''}.`));
            continue;
        }
        if (acceptance.globalMetaId !== task.globalMetaId) {
            invalidBuckets.acceptances.push(invalid(acceptance, 'permission_denied', 'loom-acceptance author must match the task author.'));
            continue;
        }
        valid.acceptances.push(acceptance);
    }
    for (const claimReject of sortRecords(rawState.records['claim-reject'])) {
        const hasTaskReference = referencesTask(claimReject, taskPinId);
        const claim = claimsByPinId.get(stringField(claimReject, 'claimPinId') ?? '');
        if (!hasTaskReference && !claim) {
            continue;
        }
        const payloadInvalid = rejectInvalidPayload(claimReject);
        if (payloadInvalid) {
            invalidBuckets.claimRejects.push(payloadInvalid);
            continue;
        }
        if (!hasTaskReference) {
            invalidBuckets.claimRejects.push(invalidTaskReference(claimReject, taskPinId));
            continue;
        }
        const missingClaim = claimMismatch(claimReject, claim);
        if (missingClaim) {
            invalidBuckets.claimRejects.push(missingClaim);
            continue;
        }
        if (claimReject.globalMetaId !== task.globalMetaId) {
            invalidBuckets.claimRejects.push(invalid(claimReject, 'permission_denied', 'loom-claim-reject author must match the task author.'));
            continue;
        }
        valid.claimRejects.push(claimReject);
    }
    const active = buildActiveStateBuckets(valid);
    const latestStatus = latestRecord(active.statuses);
    const latestDelivery = latestRecord(active.deliveries);
    const latestAcceptance = latestRecord(active.acceptances);
    return {
        found: true,
        taskPinId,
        state: stateFromRecords(active, latestStatus, latestDelivery, latestAcceptance),
        task,
        valid,
        invalid: invalidBuckets,
        latestStatus,
        latestDelivery,
        latestAcceptance,
        paymentTxId: paymentTxId(latestAcceptance),
    };
}
function findLatestValidDelivery(state, deliveryPinId) {
    if (!state.found) {
        return undefined;
    }
    if (deliveryPinId) {
        return state.valid.deliveries.find((delivery) => delivery.pinId === deliveryPinId);
    }
    return latestRecord(state.valid.deliveries);
}
function findValidClaimForDelivery(state, deliveryPinId) {
    if (!state.found) {
        return undefined;
    }
    const delivery = findLatestValidDelivery(state, deliveryPinId);
    if (!delivery) {
        return undefined;
    }
    const claimPinId = stringField(delivery, 'claimPinId');
    return state.valid.claims.find((claim) => claim.pinId === claimPinId);
}
