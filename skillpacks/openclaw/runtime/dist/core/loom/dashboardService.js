"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createLoomDashboardService = createLoomDashboardService;
const commandResult_1 = require("../contracts/commandResult");
const dashboardAggregation_1 = require("./dashboardAggregation");
const allowedStates = new Set([
    'open',
    'claimed',
    'in_progress',
    'delivered',
    'revision_needed',
    'rejected',
    'accepted_paid',
    'failed',
    'working',
    'review',
    'revision',
    'closed',
]);
const allowedRoles = new Set([
    'all',
    'requester',
    'developer',
    'needs_action',
]);
const staleBoardColumns = [
    { id: 'open', title: 'Open', states: ['open'] },
    { id: 'claimed', title: 'Claimed', states: ['claimed'] },
    { id: 'working', title: 'Working', states: ['in_progress'] },
    { id: 'review', title: 'Review', states: ['delivered'] },
    { id: 'revision', title: 'Revision', states: ['revision_needed'] },
    { id: 'closed', title: 'Closed', states: ['accepted_paid', 'rejected', 'failed'] },
];
function errorMessage(error) {
    return error instanceof Error && error.message ? error.message : String(error);
}
function rawStateHasTasks(rawState) {
    return rawState.records.task.length > 0;
}
function unavailableAfterRefreshFailure(warning, fallbackWarnings = {}) {
    return (0, commandResult_1.commandFailed)('loom_dashboard_unavailable', `Loom dashboard refresh failed and no cached dashboard is available: ${warning}`, {
        data: {
            warning,
            ...(fallbackWarnings.cacheWarning ? { cacheWarning: fallbackWarnings.cacheWarning } : {}),
            ...(fallbackWarnings.indexWarning ? { indexWarning: fallbackWarnings.indexWarning } : {}),
        },
    });
}
function activeClaimRecords(detail) {
    const activeClaimIds = new Set(detail.claims.filter((claim) => claim.active).map((claim) => claim.pinId));
    return detail.validRecords.claims.filter((claim) => activeClaimIds.has(claim.pinId));
}
function actorContextForStaleTask(actor, task, activeClaims, state) {
    const actorGlobalMetaId = actor?.globalMetaId;
    const actorAddress = actor?.address;
    const isRequester = Boolean((actorGlobalMetaId && task.globalMetaId && actorGlobalMetaId === task.globalMetaId)
        || (actorAddress && task.creatorAddress && actorAddress === task.creatorAddress));
    const isDeveloper = activeClaims.some((claim) => Boolean((actorGlobalMetaId && claim.globalMetaId && actorGlobalMetaId === claim.globalMetaId)
        || (actorAddress && claim.creatorAddress && actorAddress === claim.creatorAddress)));
    const requesterNeedsAction = isRequester && (state === 'delivered' || state === 'revision_needed');
    const developerNeedsAction = isDeveloper && ['claimed', 'in_progress', 'revision_needed'].includes(state);
    return {
        isRequester,
        isDeveloper,
        needsMyAction: requesterNeedsAction || developerNeedsAction,
        role: isRequester && isDeveloper ? 'both' : isRequester ? 'requester' : isDeveloper ? 'developer' : 'none',
    };
}
function matchesStaleFilters(card, detail, filters) {
    if (filters.state && card.state !== filters.state && card.columnId !== filters.state) {
        return false;
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
function makeStaleColumns(tasks) {
    return staleBoardColumns.map((column) => ({
        ...column,
        states: [...column.states],
        cards: tasks.filter((task) => task.columnId === column.id),
    }));
}
function summarizeStale(tasks, details) {
    const warnings = details.flatMap((detail) => detail.warnings);
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
function validateFilters(input) {
    const filters = {};
    if ('state' in input && input.state !== undefined) {
        if (typeof input.state !== 'string' || !allowedStates.has(input.state)) {
            return null;
        }
        filters.state = input.state;
    }
    if ('role' in input && input.role !== undefined) {
        if (typeof input.role !== 'string' || !allowedRoles.has(input.role)) {
            return null;
        }
        if (input.role !== 'all') {
            filters.role = input.role;
        }
    }
    if ('query' in input && input.query !== undefined) {
        if (typeof input.query !== 'string') {
            return null;
        }
        filters.query = input.query;
    }
    if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || input.limit < 0) {
            return null;
        }
        filters.limit = input.limit;
    }
    return filters;
}
function createLoomDashboardService(input) {
    async function readActorContext(from) {
        return input.resolveActorContext ? (await input.resolveActorContext({ from })) ?? undefined : undefined;
    }
    async function readContext(from) {
        const [workflowStates, actorContext] = await Promise.all([
            input.readWorkflowStates ? input.readWorkflowStates() : Promise.resolve([]),
            readActorContext(from),
        ]);
        return {
            workflowStates,
            actorContext,
        };
    }
    async function projectStaleDashboard(staleDashboard, request, warning) {
        const filters = validateFilters(request);
        if (!filters) {
            throw new Error('loom_dashboard_invalid_filter');
        }
        const actorContext = await readActorContext(request.from);
        const existingCards = new Map(staleDashboard.tasks.map((card) => [card.taskPinId, card]));
        const pairs = staleDashboard.details
            .map((detail) => {
            const card = existingCards.get(detail.taskPinId);
            if (!card) {
                return null;
            }
            const nextCard = {
                ...card,
                actorContext: actorContextForStaleTask(actorContext, detail.task, activeClaimRecords(detail), card.state),
            };
            return { card: nextCard, detail };
        })
            .filter((pair) => Boolean(pair))
            .filter(({ card, detail }) => matchesStaleFilters(card, detail, filters));
        const limitedPairs = typeof filters.limit === 'number' ? pairs.slice(0, filters.limit) : pairs;
        const tasks = limitedPairs.map(({ card }) => card);
        const details = limitedPairs.map(({ detail }) => detail);
        const { actor: _previousActor, ...staleWithoutActor } = staleDashboard;
        return {
            ...staleWithoutActor,
            updatedAt: input.now?.() ?? staleDashboard.updatedAt,
            ...(actorContext ? { actor: actorContext } : {}),
            summary: summarizeStale(tasks, details),
            filters,
            columns: makeStaleColumns(tasks),
            tasks,
            details,
            warnings: details.flatMap((detail) => detail.warnings),
            refresh: {
                requested: true,
                succeeded: false,
                updatedAt: staleDashboard.rawCacheUpdatedAt,
                warning,
            },
        };
    }
    async function buildFromRaw(rawState, request, refreshed, refreshWarning) {
        const filters = validateFilters(request);
        if (!filters) {
            throw new Error('loom_dashboard_invalid_filter');
        }
        const context = await readContext(request.from);
        const dashboard = (0, dashboardAggregation_1.buildLoomDashboard)(rawState, {
            workflowStates: context.workflowStates,
            actorContext: context.actorContext,
            filters,
            now: input.now?.(),
            refresh: {
                requested: request.refresh === true || refreshed,
                succeeded: !refreshWarning,
                updatedAt: rawState.updatedAt,
                warning: refreshWarning ?? null,
            },
        });
        return {
            dashboard,
            indexPath: input.dashboardStore.indexPath,
            cache: {
                updatedAt: rawState.updatedAt,
                refreshed,
            },
            ...(request.refresh || refreshed || refreshWarning ? {
                refresh: {
                    requested: request.refresh === true || refreshed,
                    succeeded: !refreshWarning,
                    ...(refreshWarning ? { warning: refreshWarning } : {}),
                },
            } : {}),
        };
    }
    async function dashboardFromStaleIndex(request, warning) {
        const staleDashboard = await input.dashboardStore.read();
        if (!staleDashboard) {
            return null;
        }
        const dashboard = await projectStaleDashboard(staleDashboard, request, warning);
        return {
            ...(0, commandResult_1.commandSuccess)({
                dashboard,
                indexPath: input.dashboardStore.indexPath,
                cache: {
                    updatedAt: dashboard.rawCacheUpdatedAt,
                    refreshed: false,
                },
                refresh: {
                    requested: true,
                    succeeded: false,
                    warning,
                },
            }),
            code: 'loom_dashboard_stale',
            message: 'Returning stale loom dashboard index because refresh failed.',
        };
    }
    async function getDashboard(request = {}) {
        const filters = validateFilters(request);
        if (!filters) {
            return (0, commandResult_1.commandFailed)('loom_dashboard_invalid_filter', 'Unsupported loom dashboard filter.');
        }
        if (request.refresh === true) {
            if (!input.refreshRawCache) {
                return (0, commandResult_1.commandFailed)('loom_dashboard_unavailable', 'Loom dashboard refresh is unavailable.');
            }
            let rawState;
            try {
                rawState = await input.refreshRawCache({ limit: request.limit });
            }
            catch (error) {
                const warning = errorMessage(error);
                let cacheWarning;
                let indexWarning;
                try {
                    const cached = await input.rawCacheStore.read();
                    if (rawStateHasTasks(cached)) {
                        try {
                            return (0, commandResult_1.commandSuccess)(await buildFromRaw(cached, request, false, warning));
                        }
                        catch (cacheBuildError) {
                            cacheWarning = errorMessage(cacheBuildError);
                        }
                    }
                }
                catch (cacheReadError) {
                    cacheWarning = errorMessage(cacheReadError);
                }
                try {
                    const stale = await dashboardFromStaleIndex(request, warning);
                    if (stale) {
                        return stale;
                    }
                }
                catch (indexReadError) {
                    indexWarning = errorMessage(indexReadError);
                }
                return unavailableAfterRefreshFailure(warning, { cacheWarning, indexWarning });
            }
            let result;
            let indexResult;
            try {
                result = await buildFromRaw(rawState, request, true);
                indexResult = await buildFromRaw(rawState, { from: request.from, refresh: true }, true);
            }
            catch (error) {
                const warning = errorMessage(error);
                return (0, commandResult_1.commandFailed)('loom_dashboard_build_failed', `Unable to build refreshed loom dashboard: ${warning}`, {
                    data: { warning },
                });
            }
            try {
                await input.dashboardStore.write(indexResult.dashboard);
            }
            catch (error) {
                const warning = errorMessage(error);
                return (0, commandResult_1.commandFailed)('loom_dashboard_index_write_failed', `Unable to write refreshed loom dashboard index: ${warning}`, {
                    data: {
                        indexPath: input.dashboardStore.indexPath,
                        warning,
                    },
                });
            }
            return (0, commandResult_1.commandSuccess)(result);
        }
        try {
            return (0, commandResult_1.commandSuccess)(await buildFromRaw(await input.rawCacheStore.read(), request, false));
        }
        catch (error) {
            if (errorMessage(error) === 'loom_dashboard_invalid_filter') {
                return (0, commandResult_1.commandFailed)('loom_dashboard_invalid_filter', 'Unsupported loom dashboard filter.');
            }
            return (0, commandResult_1.commandFailed)('loom_dashboard_unavailable', 'Unable to build loom dashboard.', {
                data: { warning: errorMessage(error) },
            });
        }
    }
    return {
        getDashboard,
        async getTaskDetail(request) {
            const dashboardResult = await getDashboard({
                from: request.from,
                refresh: request.refresh,
            });
            if (!dashboardResult.ok) {
                return dashboardResult;
            }
            const detail = (0, dashboardAggregation_1.findLoomDashboardTaskDetail)(dashboardResult.data.dashboard, request.taskPinId);
            if (!detail) {
                return (0, commandResult_1.commandFailed)('loom_dashboard_task_not_found', 'Loom dashboard task was not found.', {
                    data: { taskPinId: request.taskPinId },
                });
            }
            return (0, commandResult_1.commandSuccess)({
                ...dashboardResult.data,
                detail,
            });
        },
        async refresh(request = {}) {
            return getDashboard({
                from: request.from,
                limit: request.limit,
                refresh: true,
            });
        },
    };
}
