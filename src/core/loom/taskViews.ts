import type { LoomProtocolName } from './protocols';
import type { LoomCachedRecord, LoomRawCacheState } from './rawCache';

export interface LoomTaskListFilters {
  limit?: number;
  tag?: string;
  currency?: string;
}

function payloadObject(record: LoomCachedRecord): Record<string, unknown> {
  return record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload as Record<string, unknown>
    : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function getTaskPinId(record: LoomCachedRecord): string | undefined {
  return getString(payloadObject(record).taskPinId);
}

function getDeliveryPinId(record: LoomCachedRecord): string | undefined {
  return getString(payloadObject(record).deliveryPinId);
}

function getClaimPinId(record: LoomCachedRecord): string | undefined {
  return getString(payloadObject(record).claimPinId);
}

function pluralKey(protocol: Exclude<LoomProtocolName, 'task'>): 'claims' | 'statuses' | 'deliveries' | 'acceptances' | 'claimRejects' {
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

function createRelatedGroups(): Record<'claims' | 'statuses' | 'deliveries' | 'acceptances' | 'claimRejects', LoomCachedRecord[]> {
  return {
    claims: [],
    statuses: [],
    deliveries: [],
    acceptances: [],
    claimRejects: [],
  };
}

function relatedRecordsForTask(state: LoomRawCacheState, taskPinId: string) {
  const related = createRelatedGroups();
  const claimToTask = new Map<string, string>();
  const deliveryToTask = new Map<string, string>();

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

function recordMatchesFilters(record: LoomCachedRecord, filters: LoomTaskListFilters): boolean {
  const payload = payloadObject(record);
  if (filters.tag) {
    const tags = Array.isArray(payload.tags) ? payload.tags : [];
    if (!tags.includes(filters.tag)) {
      return false;
    }
  }
  if (filters.currency) {
    const bounty = payload.bounty && typeof payload.bounty === 'object' && !Array.isArray(payload.bounty)
      ? payload.bounty as Record<string, unknown>
      : {};
    if (bounty.currency !== filters.currency) {
      return false;
    }
  }
  return true;
}

export function listLoomTasksFromCache(state: LoomRawCacheState, filters: LoomTaskListFilters = {}) {
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

export function showLoomTaskFromCache(state: LoomRawCacheState, taskPinId: string) {
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
