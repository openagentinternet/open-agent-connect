"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectLoomDashboardNextActions = projectLoomDashboardNextActions;
exports.selectLoomDashboardCardAction = selectLoomDashboardCardAction;
exports.buildLoomDashboardSummaryPreview = buildLoomDashboardSummaryPreview;
const mutatingActions = new Set([
    'postTask',
    'claimAndStart',
    'runDevRound',
    'deliver',
    'acceptAndPay',
    'requestRevision',
    'reject',
]);
function payloadObject(record) {
    return record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
        ? record.payload
        : {};
}
function objectValue(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function stringValue(value) {
    return typeof value === 'string' && value.trim() ? value : undefined;
}
function compareRecords(left, right) {
    return left.timestamp - right.timestamp || left.pinId.localeCompare(right.pinId);
}
function latestRecord(records) {
    return [...records].sort(compareRecords).at(-1);
}
function shellQuote(value) {
    if (value.length === 0) {
        return "''";
    }
    return `'${value.replaceAll("'", "'\\''")}'`;
}
function commandLine(command, args) {
    const renderedArgs = args.flatMap((arg) => ('flag' in arg
        ? [arg.flag, ...(arg.value === undefined ? [] : [shellQuote(arg.value)])]
        : [shellQuote(arg.value)]));
    return [...command, ...renderedArgs].join(' ');
}
function actorValue(actor) {
    return actor?.profileSlug ?? actor?.globalMetaId ?? actor?.address ?? '<actor>';
}
function activeClaim(detail) {
    const activeClaimIds = new Set(detail.claims.filter((claim) => claim.active).map((claim) => claim.pinId));
    return latestRecord(detail.validRecords.claims.filter((claim) => activeClaimIds.has(claim.pinId)))
        ?? latestRecord(detail.validRecords.claims);
}
function localWorkflowForClaim(localWorkflow, claimPinId) {
    if (!claimPinId) {
        return localWorkflow.at(-1);
    }
    return localWorkflow.filter((workflow) => workflow.claimPinId === claimPinId).at(-1)
        ?? localWorkflow.at(-1);
}
function latestDelivery(detail) {
    return latestRecord(detail.validRecords.deliveries);
}
function deliveryPrUrl(delivery) {
    return stringValue(objectValue(payloadObject(delivery).delivery).prUrl);
}
function deliverySummary(delivery) {
    return stringValue(payloadObject(delivery).deliverySummary);
}
function statusSummary(status) {
    return stringValue(payloadObject(status).progressSummary);
}
function acceptanceComment(acceptance) {
    return stringValue(payloadObject(acceptance).comment);
}
function amountIsPositive(amount) {
    if (!amount) {
        return false;
    }
    const numeric = Number(amount);
    return Number.isFinite(numeric) && numeric > 0;
}
function bountyDisabledReason(card) {
    if (!card.bounty || !amountIsPositive(card.bounty.amount) || !card.bounty.currency) {
        return 'Task is missing a valid bounty amount and currency.';
    }
    return undefined;
}
function payoutAddress(detail, claim) {
    const claimSummary = claim ? detail.claims.find((item) => item.pinId === claim.pinId) : undefined;
    return claimSummary?.payoutAddress ?? stringValue(payloadObject(claim).payoutAddress);
}
function requesterActorReason(input) {
    if (!input.actor) {
        return 'Select a requester actor before confirming this action.';
    }
    if (!input.card.actorContext.isRequester) {
        return 'The selected actor is not the requester actor for this task.';
    }
    return undefined;
}
function developerActorReason(input) {
    if (!input.actor) {
        return 'Select a developer actor before confirming this action.';
    }
    if (input.card.actorContext.isRequester) {
        return 'Select a developer actor before confirming this action.';
    }
    if (input.card.activeClaimCount > 0 && !input.card.actorContext.isDeveloper) {
        return 'The selected actor is not the active developer for this task.';
    }
    return undefined;
}
function withMutationDefaults(action) {
    if (!mutatingActions.has(action.id)) {
        return action;
    }
    return {
        ...action,
        requiresConfirmation: true,
    };
}
function makeAction(action) {
    return withMutationDefaults(action);
}
function claimCli(input) {
    return commandLine(['metabot', 'loom', 'claim-and-start'], [
        { flag: '--from', value: actorValue(input.actor) },
        { flag: '--task-pin-id', value: input.card.taskPinId },
        { flag: '--payout-address', value: '<payout-address>' },
    ]);
}
function runDevRoundCli(input, claimPinId) {
    return commandLine(['metabot', 'loom', 'run-dev-round'], [
        { flag: '--from', value: actorValue(input.actor) },
        { flag: '--task-pin-id', value: input.card.taskPinId },
        { flag: '--claim-pin-id', value: claimPinId ?? '<claim-pin-id>' },
    ]);
}
function deliverCli(input, claimPinId) {
    return commandLine(['metabot', 'loom', 'deliver'], [
        { flag: '--from', value: actorValue(input.actor) },
        { flag: '--task-pin-id', value: input.card.taskPinId },
        { flag: '--claim-pin-id', value: claimPinId ?? '<claim-pin-id>' },
    ]);
}
function acceptCli(input, deliveryPinId) {
    return commandLine(['metabot', 'loom', 'accept-and-pay'], [
        { flag: '--from', value: actorValue(input.actor) },
        { flag: '--task-pin-id', value: input.card.taskPinId },
        { flag: '--delivery-pin-id', value: deliveryPinId ?? '<delivery-pin-id>' },
        { flag: '--score', value: '5' },
        { flag: '--comment', value: 'Accepted.' },
        { flag: '--confirm-payment' },
    ]);
}
function reviewCli(input, deliveryPinId, verdict) {
    return commandLine(['metabot', 'loom', 'review-delivery'], [
        { flag: '--from', value: actorValue(input.actor) },
        { flag: '--task-pin-id', value: input.card.taskPinId },
        { flag: '--delivery-pin-id', value: deliveryPinId ?? '<delivery-pin-id>' },
        { flag: '--verdict', value: verdict },
        { flag: '--score', value: verdict === 'revision_needed' ? '2' : '1' },
        { flag: '--comment', value: verdict === 'revision_needed' ? 'Please revise this delivery.' : 'Rejected.' },
    ]);
}
function openPrCli(prUrl) {
    return commandLine(['open'], [{ value: prUrl }]);
}
function copyCliFallback(input) {
    return commandLine(['metabot', 'loom', 'state'], [{ value: input.card.taskPinId }]);
}
function paymentDisabledReason(input, claim, delivery) {
    if (input.card.state === 'accepted_paid') {
        return 'Task is already accepted and paid.';
    }
    if (!delivery) {
        return 'No delivery record is available for review.';
    }
    if (!payoutAddress(input.detail, claim)) {
        return 'Active claim is missing a payout address.';
    }
    return bountyDisabledReason(input.card) ?? requesterActorReason(input);
}
function reviewDisabledReason(input, delivery) {
    if (!delivery) {
        return 'No delivery record is available for review.';
    }
    return requesterActorReason(input);
}
function localWorkflowDisabledReason(input, workflow) {
    const actorReason = developerActorReason(input);
    if (actorReason) {
        return actorReason;
    }
    if (!workflow) {
        return 'No local workflow evidence is available for this claim.';
    }
    return undefined;
}
function claimAction(input) {
    const disabledReason = developerActorReason(input);
    const hasDeveloperActor = Boolean(input.actor && !input.card.actorContext.isRequester);
    return makeAction({
        id: 'claimAndStart',
        label: hasDeveloperActor && !disabledReason ? 'Claim and start' : 'Developer needed',
        tone: 'primary',
        actorRole: 'developer',
        requiresActor: Boolean(disabledReason),
        requiresConfirmation: true,
        ...(disabledReason ? { disabledReason } : {}),
        cliFallback: claimCli(input),
    });
}
function workActions(input, revision) {
    const claim = activeClaim(input.detail);
    const workflow = localWorkflowForClaim(input.detail.localWorkflow, claim?.pinId);
    const actorReason = developerActorReason(input);
    const disabledReason = localWorkflowDisabledReason(input, workflow);
    return [
        makeAction({
            id: 'runDevRound',
            label: revision ? 'Run revision round' : 'Run dev round',
            tone: 'primary',
            actorRole: 'developer',
            requiresActor: Boolean(actorReason),
            requiresConfirmation: true,
            ...(disabledReason ? { disabledReason } : {}),
            cliFallback: runDevRoundCli(input, claim?.pinId),
        }),
        makeAction({
            id: 'deliver',
            label: 'Deliver for review',
            tone: 'neutral',
            actorRole: 'developer',
            requiresActor: Boolean(actorReason),
            requiresConfirmation: true,
            ...(disabledReason ? { disabledReason } : {}),
            cliFallback: deliverCli(input, claim?.pinId),
        }),
    ];
}
function reviewActions(input) {
    const claim = activeClaim(input.detail);
    const delivery = latestDelivery(input.detail);
    const deliveryPinId = delivery?.pinId;
    const actorReason = requesterActorReason(input);
    const paymentReason = paymentDisabledReason(input, claim, delivery);
    const reviewReason = reviewDisabledReason(input, delivery);
    const prUrl = input.card.prUrl ?? deliveryPrUrl(delivery);
    return [
        makeAction({
            id: 'acceptAndPay',
            label: paymentReason && !input.card.actorContext.isRequester ? 'Review required' : 'Accept and pay',
            tone: 'primary',
            actorRole: 'requester',
            requiresActor: Boolean(actorReason),
            requiresConfirmation: true,
            ...(paymentReason ? { disabledReason: paymentReason } : {}),
            cliFallback: acceptCli(input, deliveryPinId),
        }),
        makeAction({
            id: 'requestRevision',
            label: reviewReason && !input.card.actorContext.isRequester ? 'Review required' : 'Request revision',
            tone: 'warning',
            actorRole: 'requester',
            requiresActor: Boolean(actorReason),
            requiresConfirmation: true,
            ...(reviewReason ? { disabledReason: reviewReason } : {}),
            cliFallback: reviewCli(input, deliveryPinId, 'revision_needed'),
        }),
        makeAction({
            id: 'reject',
            label: reviewReason && !input.card.actorContext.isRequester ? 'Review required' : 'Reject',
            tone: 'danger',
            actorRole: 'requester',
            requiresActor: Boolean(actorReason),
            requiresConfirmation: true,
            ...(reviewReason ? { disabledReason: reviewReason } : {}),
            cliFallback: reviewCli(input, deliveryPinId, 'rejected'),
        }),
        ...(prUrl ? [{
                id: 'openPr',
                label: 'Open PR',
                tone: 'neutral',
                actorRole: 'any',
                requiresActor: false,
                requiresConfirmation: false,
                cliFallback: openPrCli(prUrl),
            }] : []),
    ];
}
function acceptedPaidActions(input) {
    const delivery = latestDelivery(input.detail);
    const prUrl = input.card.prUrl ?? deliveryPrUrl(delivery);
    return [
        copyAction(input, 'Payment complete'),
        makeAction({
            id: 'acceptAndPay',
            label: 'Payment complete',
            tone: 'neutral',
            actorRole: 'requester',
            requiresActor: false,
            requiresConfirmation: true,
            disabledReason: 'Task is already accepted and paid.',
            cliFallback: acceptCli(input, delivery?.pinId),
        }),
        ...(prUrl ? [{
                id: 'openPr',
                label: 'Open PR',
                tone: 'neutral',
                actorRole: 'any',
                requiresActor: false,
                requiresConfirmation: false,
                cliFallback: openPrCli(prUrl),
            }] : []),
    ];
}
function copyAction(input, label) {
    return {
        id: 'copyCli',
        label,
        tone: 'neutral',
        actorRole: 'any',
        requiresActor: false,
        requiresConfirmation: false,
        cliFallback: copyCliFallback(input),
    };
}
function projectLoomDashboardNextActions(input) {
    switch (input.card.state) {
        case 'open':
            return [claimAction(input)];
        case 'claimed':
            return workActions(input, false);
        case 'in_progress':
            return workActions(input, false);
        case 'delivered':
            return reviewActions(input);
        case 'revision_needed':
            return workActions(input, true);
        case 'accepted_paid':
            return acceptedPaidActions(input);
        case 'rejected':
            return [copyAction(input, 'Review rejection')];
        case 'failed':
            return [copyAction(input, 'Review failure')];
    }
}
function selectLoomDashboardCardAction(actions) {
    return actions.find((action) => !action.disabledReason && action.tone === 'primary')
        ?? actions.find((action) => action.tone === 'primary')
        ?? actions.find((action) => !action.disabledReason)
        ?? actions[0];
}
function buildLoomDashboardSummaryPreview(input) {
    const latestDeliveryRecord = latestRecord(input.detail.validRecords.deliveries);
    const latestStatusRecord = latestRecord(input.detail.validRecords.statuses);
    const latestAcceptanceRecord = latestRecord(input.detail.validRecords.acceptances);
    const summary = deliverySummary(latestDeliveryRecord)
        ?? input.card.latestStatusSummary
        ?? statusSummary(latestStatusRecord)
        ?? acceptanceComment(latestAcceptanceRecord)
        ?? input.detail.requirement;
    if (!summary) {
        return undefined;
    }
    const compact = summary.replace(/\s+/g, ' ').trim();
    return compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
}
