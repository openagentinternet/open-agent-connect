import type { LoomCachedRecord, LoomRawCacheState } from './rawCache';
import type { LoomDerivedTaskState } from './workflowTypes';

export interface LoomWorkflowStateInvalidReason {
  code: string;
  message: string;
}

export interface LoomWorkflowStateInvalidRecord {
  record: LoomCachedRecord;
  reason: LoomWorkflowStateInvalidReason;
}

export interface LoomWorkflowTaskStateBuckets {
  claims: LoomCachedRecord[];
  statuses: LoomCachedRecord[];
  deliveries: LoomCachedRecord[];
  acceptances: LoomCachedRecord[];
  claimRejects: LoomCachedRecord[];
}

export interface LoomWorkflowTaskInvalidBuckets {
  tasks: LoomWorkflowStateInvalidRecord[];
  claims: LoomWorkflowStateInvalidRecord[];
  statuses: LoomWorkflowStateInvalidRecord[];
  deliveries: LoomWorkflowStateInvalidRecord[];
  acceptances: LoomWorkflowStateInvalidRecord[];
  claimRejects: LoomWorkflowStateInvalidRecord[];
}

export interface LoomWorkflowTaskStateFound {
  found: true;
  taskPinId: string;
  state: LoomDerivedTaskState;
  task: LoomCachedRecord;
  valid: LoomWorkflowTaskStateBuckets;
  invalid: LoomWorkflowTaskInvalidBuckets;
  latestStatus?: LoomCachedRecord;
  latestDelivery?: LoomCachedRecord;
  latestAcceptance?: LoomCachedRecord;
  paymentTxId?: string;
}

export interface LoomWorkflowTaskStateNotFound {
  found: false;
  code: 'task_not_found';
  message: string;
  taskPinId: string;
  state?: never;
  task?: never;
  valid: LoomWorkflowTaskStateBuckets;
  invalid: LoomWorkflowTaskInvalidBuckets;
  latestStatus?: never;
  latestDelivery?: never;
  latestAcceptance?: never;
  paymentTxId?: never;
}

export type LoomWorkflowTaskState =
  | LoomWorkflowTaskStateFound
  | LoomWorkflowTaskStateNotFound;

export interface BuildLoomWorkflowTaskStateOptions {
  includeUnrelatedInvalid?: boolean;
}

type Payload = Record<string, unknown>;

function payloadObject(record: LoomCachedRecord): Payload {
  return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Payload
    : {};
}

function stringField(record: LoomCachedRecord, key: string): string | undefined {
  const value = payloadObject(record)[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function createValidBuckets(): LoomWorkflowTaskStateBuckets {
  return {
    claims: [],
    statuses: [],
    deliveries: [],
    acceptances: [],
    claimRejects: [],
  };
}

function createInvalidBuckets(): LoomWorkflowTaskInvalidBuckets {
  return {
    tasks: [],
    claims: [],
    statuses: [],
    deliveries: [],
    acceptances: [],
    claimRejects: [],
  };
}

function compareRecords(left: LoomCachedRecord, right: LoomCachedRecord): number {
  return left.timestamp - right.timestamp || left.pinId.localeCompare(right.pinId);
}

function sortRecords(records: LoomCachedRecord[]): LoomCachedRecord[] {
  return [...records].sort(compareRecords);
}

function latestRecord(records: LoomCachedRecord[]): LoomCachedRecord | undefined {
  return sortRecords(records).at(-1);
}

function sortLatestFirst(records: LoomCachedRecord[]): LoomCachedRecord[] {
  return sortRecords(records).reverse();
}

function isAfter(left: LoomCachedRecord | undefined, right: LoomCachedRecord | undefined): boolean {
  return Boolean(left && right && compareRecords(left, right) > 0);
}

function invalid(
  record: LoomCachedRecord,
  code: string,
  message: string,
): LoomWorkflowStateInvalidRecord {
  return {
    record,
    reason: { code, message },
  };
}

function rejectInvalidPayload(record: LoomCachedRecord): LoomWorkflowStateInvalidRecord | undefined {
  if (record.payloadValid !== false) {
    return undefined;
  }
  return invalid(record, 'invalid_payload', `${record.protocol} payload is invalid and cannot affect workflow state.`);
}

function findTask(rawState: LoomRawCacheState, taskPinId: string, invalidBuckets: LoomWorkflowTaskInvalidBuckets): LoomCachedRecord | undefined {
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

function referencesTask(record: LoomCachedRecord, taskPinId: string): boolean {
  return stringField(record, 'taskPinId') === taskPinId;
}

function claimMismatch(record: LoomCachedRecord, claim: LoomCachedRecord | undefined): LoomWorkflowStateInvalidRecord | undefined {
  const claimPinId = stringField(record, 'claimPinId');
  if (!claimPinId) {
    return invalid(record, 'missing_claim', `${record.protocol} must reference a claim.`);
  }
  if (!claim || claim.pinId !== claimPinId) {
    return invalid(record, 'missing_claim', `${record.protocol} references an unknown claim ${claimPinId}.`);
  }
  return undefined;
}

function paymentTxId(record: LoomCachedRecord | undefined): string | undefined {
  if (!record) {
    return undefined;
  }
  const value = payloadObject(record).paymentTxId;
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function claimHasPayoutAddress(record: LoomCachedRecord): boolean {
  return Boolean(stringField(record, 'payoutAddress'));
}

function invalidTaskReference(record: LoomCachedRecord, taskPinId: string): LoomWorkflowStateInvalidRecord {
  return invalid(record, 'invalid_reference', `${record.protocol} must reference task ${taskPinId}.`);
}

function stateFromRecords(
  valid: LoomWorkflowTaskStateBuckets,
  latestStatus: LoomCachedRecord | undefined,
  latestDelivery: LoomCachedRecord | undefined,
  latestAcceptance: LoomCachedRecord | undefined,
): LoomDerivedTaskState {
  const latestClaimReject = latestRecord(valid.claimRejects);
  if (latestClaimReject) {
    return 'rejected';
  }

  if (
    latestAcceptance
    && (!latestDelivery || !isAfter(latestDelivery, latestAcceptance))
    && (!latestStatus || !isAfter(latestStatus, latestAcceptance))
  ) {
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

  return valid.claims.length > 0 ? 'claimed' : 'open';
}

export function buildLoomWorkflowTaskState(
  rawState: LoomRawCacheState,
  taskPinId: string,
  _options: BuildLoomWorkflowTaskStateOptions = {},
): LoomWorkflowTaskState {
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

  const claimsByPinId = new Map<string, LoomCachedRecord>();
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
    const validClaim = claim as LoomCachedRecord;
    if (status.globalMetaId !== validClaim.globalMetaId) {
      invalidBuckets.statuses.push(invalid(status, 'permission_denied', 'loom-status author must match the referenced claim author.'));
      continue;
    }
    valid.statuses.push(status);
  }

  const deliveriesByPinId = new Map<string, LoomCachedRecord>();
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
    const validClaim = claim as LoomCachedRecord;
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

  const latestStatus = latestRecord(valid.statuses);
  const latestDelivery = latestRecord(valid.deliveries);
  const latestAcceptance = latestRecord(valid.acceptances);

  return {
    found: true,
    taskPinId,
    state: stateFromRecords(valid, latestStatus, latestDelivery, latestAcceptance),
    task,
    valid,
    invalid: invalidBuckets,
    latestStatus,
    latestDelivery,
    latestAcceptance,
    paymentTxId: paymentTxId(latestAcceptance),
  };
}

export function findLatestValidDelivery(
  state: LoomWorkflowTaskState,
  deliveryPinId?: string,
): LoomCachedRecord | undefined {
  if (!state.found) {
    return undefined;
  }
  if (deliveryPinId) {
    return state.valid.deliveries.find((delivery) => delivery.pinId === deliveryPinId);
  }
  return latestRecord(state.valid.deliveries);
}

export function findValidClaimForDelivery(
  state: LoomWorkflowTaskState,
  deliveryPinId: string,
): LoomCachedRecord | undefined {
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
