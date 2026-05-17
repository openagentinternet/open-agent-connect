import type { LoomCachedRecord } from './rawCache';
import type {
  LoomDashboardActorContext,
  LoomDashboardActionId,
  LoomDashboardLocalEvidence,
  LoomDashboardNextAction,
  LoomDashboardTaskCard,
  LoomDashboardTaskDetail,
} from './dashboardTypes';

type Payload = Record<string, unknown>;

const mutatingActions = new Set<LoomDashboardActionId>([
  'postTask',
  'claimAndStart',
  'runDevRound',
  'deliver',
  'acceptAndPay',
  'requestRevision',
  'reject',
]);

export interface ProjectLoomDashboardActionsInput {
  card: LoomDashboardTaskCard;
  detail: LoomDashboardTaskDetail;
  actor?: LoomDashboardActorContext;
}

function payloadObject(record: LoomCachedRecord | undefined): Payload {
  return record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Payload
    : {};
}

function objectValue(value: unknown): Payload {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Payload
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function compareRecords(left: LoomCachedRecord, right: LoomCachedRecord): number {
  return left.timestamp - right.timestamp || left.pinId.localeCompare(right.pinId);
}

function latestRecord(records: LoomCachedRecord[]): LoomCachedRecord | undefined {
  return [...records].sort(compareRecords).at(-1);
}

function shellQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function commandLine(command: string[], args: Array<{ flag: string; value?: string } | { value: string }>): string {
  const renderedArgs = args.flatMap((arg) => (
    'flag' in arg
      ? [arg.flag, ...(arg.value === undefined ? [] : [shellQuote(arg.value)])]
      : [shellQuote(arg.value)]
  ));
  return [...command, ...renderedArgs].join(' ');
}

function actorValue(actor: LoomDashboardActorContext | undefined): string {
  return actor?.profileSlug ?? actor?.globalMetaId ?? actor?.address ?? '<actor>';
}

function activeClaim(detail: LoomDashboardTaskDetail): LoomCachedRecord | undefined {
  const activeClaimIds = new Set(detail.claims.filter((claim) => claim.active).map((claim) => claim.pinId));
  return latestRecord(detail.validRecords.claims.filter((claim) => activeClaimIds.has(claim.pinId)))
    ?? latestRecord(detail.validRecords.claims);
}

function localWorkflowForClaim(
  localWorkflow: LoomDashboardLocalEvidence[],
  claimPinId: string | undefined,
): LoomDashboardLocalEvidence | undefined {
  if (!claimPinId) {
    return localWorkflow.at(-1);
  }
  return localWorkflow.filter((workflow) => workflow.claimPinId === claimPinId).at(-1)
    ?? localWorkflow.at(-1);
}

function latestDelivery(detail: LoomDashboardTaskDetail): LoomCachedRecord | undefined {
  return latestRecord(detail.validRecords.deliveries);
}

function deliveryPrUrl(delivery: LoomCachedRecord | undefined): string | undefined {
  return stringValue(objectValue(payloadObject(delivery).delivery).prUrl);
}

function deliverySummary(delivery: LoomCachedRecord | undefined): string | undefined {
  return stringValue(payloadObject(delivery).deliverySummary);
}

function statusSummary(status: LoomCachedRecord | undefined): string | undefined {
  return stringValue(payloadObject(status).progressSummary);
}

function acceptanceComment(acceptance: LoomCachedRecord | undefined): string | undefined {
  return stringValue(payloadObject(acceptance).comment);
}

function amountIsPositive(amount: string | undefined): boolean {
  if (!amount) {
    return false;
  }
  const numeric = Number(amount);
  return Number.isFinite(numeric) && numeric > 0;
}

function bountyDisabledReason(card: LoomDashboardTaskCard): string | undefined {
  if (!card.bounty || !amountIsPositive(card.bounty.amount) || !card.bounty.currency) {
    return 'Task is missing a valid bounty amount and currency.';
  }
  return undefined;
}

function payoutAddress(detail: LoomDashboardTaskDetail, claim: LoomCachedRecord | undefined): string | undefined {
  const claimSummary = claim ? detail.claims.find((item) => item.pinId === claim.pinId) : undefined;
  return claimSummary?.payoutAddress ?? stringValue(payloadObject(claim).payoutAddress);
}

function requesterActorReason(input: ProjectLoomDashboardActionsInput): string | undefined {
  if (!input.actor) {
    return 'Select a requester actor before confirming this action.';
  }
  if (!input.card.actorContext.isRequester) {
    return 'The selected actor is not the requester actor for this task.';
  }
  return undefined;
}

function developerActorReason(input: ProjectLoomDashboardActionsInput): string | undefined {
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

function withMutationDefaults(action: LoomDashboardNextAction): LoomDashboardNextAction {
  if (!mutatingActions.has(action.id)) {
    return action;
  }
  return {
    ...action,
    requiresConfirmation: true,
  };
}

function makeAction(action: LoomDashboardNextAction): LoomDashboardNextAction {
  return withMutationDefaults(action);
}

function claimCli(input: ProjectLoomDashboardActionsInput): string {
  return commandLine(['metabot', 'loom', 'claim-and-start'], [
    { flag: '--from', value: actorValue(input.actor) },
    { flag: '--task-pin-id', value: input.card.taskPinId },
    { flag: '--payout-address', value: '<payout-address>' },
  ]);
}

function runDevRoundCli(input: ProjectLoomDashboardActionsInput, claimPinId: string | undefined): string {
  return commandLine(['metabot', 'loom', 'run-dev-round'], [
    { flag: '--from', value: actorValue(input.actor) },
    { flag: '--task-pin-id', value: input.card.taskPinId },
    { flag: '--claim-pin-id', value: claimPinId ?? '<claim-pin-id>' },
  ]);
}

function deliverCli(input: ProjectLoomDashboardActionsInput, claimPinId: string | undefined): string {
  return commandLine(['metabot', 'loom', 'deliver'], [
    { flag: '--from', value: actorValue(input.actor) },
    { flag: '--task-pin-id', value: input.card.taskPinId },
    { flag: '--claim-pin-id', value: claimPinId ?? '<claim-pin-id>' },
  ]);
}

function acceptCli(input: ProjectLoomDashboardActionsInput, deliveryPinId: string | undefined): string {
  return commandLine(['metabot', 'loom', 'accept-and-pay'], [
    { flag: '--from', value: actorValue(input.actor) },
    { flag: '--task-pin-id', value: input.card.taskPinId },
    { flag: '--delivery-pin-id', value: deliveryPinId ?? '<delivery-pin-id>' },
    { flag: '--score', value: '5' },
    { flag: '--comment', value: 'Accepted.' },
    { flag: '--confirm-payment' },
  ]);
}

function reviewCli(
  input: ProjectLoomDashboardActionsInput,
  deliveryPinId: string | undefined,
  verdict: 'revision_needed' | 'rejected',
): string {
  return commandLine(['metabot', 'loom', 'review-delivery'], [
    { flag: '--from', value: actorValue(input.actor) },
    { flag: '--task-pin-id', value: input.card.taskPinId },
    { flag: '--delivery-pin-id', value: deliveryPinId ?? '<delivery-pin-id>' },
    { flag: '--verdict', value: verdict },
    { flag: '--score', value: verdict === 'revision_needed' ? '2' : '1' },
    { flag: '--comment', value: verdict === 'revision_needed' ? 'Please revise this delivery.' : 'Rejected.' },
  ]);
}

function openPrCli(prUrl: string): string {
  return commandLine(['open'], [{ value: prUrl }]);
}

function copyCliFallback(input: ProjectLoomDashboardActionsInput): string {
  return commandLine(['metabot', 'loom', 'state'], [{ value: input.card.taskPinId }]);
}

function paymentDisabledReason(
  input: ProjectLoomDashboardActionsInput,
  claim: LoomCachedRecord | undefined,
  delivery: LoomCachedRecord | undefined,
): string | undefined {
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

function reviewDisabledReason(
  input: ProjectLoomDashboardActionsInput,
  delivery: LoomCachedRecord | undefined,
): string | undefined {
  if (!delivery) {
    return 'No delivery record is available for review.';
  }
  return requesterActorReason(input);
}

function localWorkflowDisabledReason(
  input: ProjectLoomDashboardActionsInput,
  workflow: LoomDashboardLocalEvidence | undefined,
): string | undefined {
  const actorReason = developerActorReason(input);
  if (actorReason) {
    return actorReason;
  }
  if (!workflow) {
    return 'No local workflow evidence is available for this claim.';
  }
  return undefined;
}

function claimAction(input: ProjectLoomDashboardActionsInput): LoomDashboardNextAction {
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

function workActions(input: ProjectLoomDashboardActionsInput, revision: boolean): LoomDashboardNextAction[] {
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

function reviewActions(input: ProjectLoomDashboardActionsInput): LoomDashboardNextAction[] {
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
      id: 'openPr' as const,
      label: 'Open PR',
      tone: 'neutral' as const,
      actorRole: 'any' as const,
      requiresActor: false,
      requiresConfirmation: false,
      cliFallback: openPrCli(prUrl),
    }] : []),
  ];
}

function acceptedPaidActions(input: ProjectLoomDashboardActionsInput): LoomDashboardNextAction[] {
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
      id: 'openPr' as const,
      label: 'Open PR',
      tone: 'neutral' as const,
      actorRole: 'any' as const,
      requiresActor: false,
      requiresConfirmation: false,
      cliFallback: openPrCli(prUrl),
    }] : []),
  ];
}

function copyAction(input: ProjectLoomDashboardActionsInput, label: string): LoomDashboardNextAction {
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

export function projectLoomDashboardNextActions(input: ProjectLoomDashboardActionsInput): LoomDashboardNextAction[] {
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

export function selectLoomDashboardCardAction(actions: LoomDashboardNextAction[]): LoomDashboardNextAction | undefined {
  return actions.find((action) => !action.disabledReason && action.tone === 'primary')
    ?? actions.find((action) => action.tone === 'primary')
    ?? actions.find((action) => !action.disabledReason)
    ?? actions[0];
}

export function buildLoomDashboardSummaryPreview(input: {
  card: Pick<LoomDashboardTaskCard, 'latestStatusSummary'>;
  detail: Pick<LoomDashboardTaskDetail, 'requirement' | 'validRecords'>;
}): string | undefined {
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
