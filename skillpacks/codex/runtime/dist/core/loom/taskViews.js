"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listLoomTasksFromCache = listLoomTasksFromCache;
exports.showLoomTaskFromCache = showLoomTaskFromCache;
function payloadObject(record) {
    return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};
}
function getString(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function getTaskPinId(record) {
    return getString(payloadObject(record).taskPinId);
}
function getDeliveryPinId(record) {
    return getString(payloadObject(record).deliveryPinId);
}
function getClaimPinId(record) {
    return getString(payloadObject(record).claimPinId);
}
function pluralKey(protocol) {
    switch (protocol) {
        case 'claim':
            return 'claims';
        case 'status':
            return 'statuses';
        case 'delivery':
            return 'deliveries';
        case 'acceptance':
            return 'acceptances';
        case 'claim-reject':
            return 'claimRejects';
    }
}
function createRelatedGroups() {
    return {
        claims: [],
        statuses: [],
        deliveries: [],
        acceptances: [],
        claimRejects: [],
    };
}
function relatedRecordsForTask(state, taskPinId) {
    const related = createRelatedGroups();
    const claimToTask = new Map();
    const deliveryToTask = new Map();
    for (const claim of state.records.claim) {
        const claimTaskPinId = getTaskPinId(claim);
        if (claimTaskPinId === taskPinId) {
            related.claims.push(claim);
            claimToTask.set(claim.pinId, taskPinId);
        }
    }
    for (const status of state.records.status) {
        const directTaskPinId = getTaskPinId(status);
        const taskFromClaim = claimToTask.get(getClaimPinId(status) ?? '');
        if (directTaskPinId === taskPinId || taskFromClaim === taskPinId) {
            related.statuses.push(status);
        }
    }
    for (const delivery of state.records.delivery) {
        const directTaskPinId = getTaskPinId(delivery);
        const taskFromClaim = claimToTask.get(getClaimPinId(delivery) ?? '');
        if (directTaskPinId === taskPinId || taskFromClaim === taskPinId) {
            related.deliveries.push(delivery);
            deliveryToTask.set(delivery.pinId, taskPinId);
        }
    }
    for (const acceptance of state.records.acceptance) {
        const directTaskPinId = getTaskPinId(acceptance);
        const taskFromDelivery = deliveryToTask.get(getDeliveryPinId(acceptance) ?? '');
        if (directTaskPinId === taskPinId || taskFromDelivery === taskPinId) {
            related.acceptances.push(acceptance);
        }
    }
    for (const rejection of state.records['claim-reject']) {
        const directTaskPinId = getTaskPinId(rejection);
        const taskFromClaim = claimToTask.get(getClaimPinId(rejection) ?? '');
        if (directTaskPinId === taskPinId || taskFromClaim === taskPinId) {
            related.claimRejects.push(rejection);
        }
    }
    return related;
}
function recordMatchesFilters(record, filters) {
    const payload = payloadObject(record);
    if (filters.tag) {
        const tags = Array.isArray(payload.tags) ? payload.tags : [];
        if (!tags.includes(filters.tag)) {
            return false;
        }
    }
    if (filters.currency) {
        const bounty = payload.bounty && typeof payload.bounty === 'object' && !Array.isArray(payload.bounty)
            ? payload.bounty
            : {};
        if (bounty.currency !== filters.currency) {
            return false;
        }
    }
    return true;
}
function listLoomTasksFromCache(state, filters = {}) {
    const tasks = state.records.task
        .filter((record) => recordMatchesFilters(record, filters))
        .map((record) => {
        const payload = payloadObject(record);
        const related = relatedRecordsForTask(state, record.pinId);
        return {
            pinId: record.pinId,
            title: getString(payload.title) ?? '',
            bounty: payload.bounty ?? null,
            tags: Array.isArray(payload.tags) ? payload.tags : [],
            timestamp: record.timestamp,
            creatorAddress: record.creatorAddress,
            creatorMetaId: record.creatorMetaId,
            globalMetaId: record.globalMetaId,
            payloadValid: record.payloadValid,
            validationErrors: record.validationErrors,
            relatedCounts: {
                claims: related.claims.length,
                statuses: related.statuses.length,
                deliveries: related.deliveries.length,
                acceptances: related.acceptances.length,
                claimRejects: related.claimRejects.length,
            },
        };
    });
    return {
        tasks: typeof filters.limit === 'number' ? tasks.slice(0, filters.limit) : tasks,
    };
}
function showLoomTaskFromCache(state, taskPinId) {
    const task = state.records.task.find((record) => record.pinId === taskPinId);
    if (!task) {
        return {
            found: false,
            code: 'task_not_found',
            message: `Loom task not found in cache: ${taskPinId}`,
            taskPinId,
        };
    }
    return {
        found: true,
        task,
        related: relatedRecordsForTask(state, taskPinId),
    };
}
