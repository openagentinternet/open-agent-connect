import type { AskMasterConfig } from '../config/configTypes';

export interface TriggerObservation {
  now: number;
  traceId?: string | null;
  hostMode: string;
  workspaceId?: string | null;
  userIntent?: {
    explicitlyAskedForMaster?: boolean;
    explicitlyRejectedSuggestion?: boolean;
  };
  activity?: {
    recentUserMessages?: number;
    recentAssistantMessages?: number;
    recentToolCalls?: number;
    recentFailures?: number;
    repeatedFailureCount?: number;
    noProgressWindowMs?: number | null;
  };
  diagnostics?: {
    failingTests?: number;
    failingCommands?: number;
    repeatedErrorSignatures?: string[];
    uncertaintySignals?: string[];
  };
  workState?: {
    hasPlan?: boolean;
    todoBlocked?: boolean;
    diffChangedRecently?: boolean;
    onlyReadingWithoutConverging?: boolean;
  };
  directory?: {
    availableMasters?: number;
    trustedMasters?: number;
    onlineMasters?: number;
  };
  candidateMasterKindHint?: string | null;
}

export type TriggerDecision =
  | {
      action: 'no_action';
      reason: string;
    }
  | {
      action: 'suggest';
      reason: string;
      confidence: number;
      candidateMasterKind?: string | null;
    }
  | {
      action: 'auto_candidate';
      reason: string;
      confidence: number;
      candidateMasterKind?: string | null;
    }
  | {
      action: 'manual_requested';
      reason: string;
    };

export interface MasterTriggerMemoryState {
  suggestedTraceIds: string[];
  rejectedMasterKinds: string[];
  recentFailureSignatures: string[];
  manuallyRequestedMasterKinds: string[];
}

export interface CollectAndEvaluateMasterTriggerResult {
  collected: boolean;
  observation: NormalizedTriggerObservation | null;
  decision: TriggerDecision;
}

interface NormalizedTriggerObservation {
  now: number;
  traceId: string | null;
  hostMode: string;
  workspaceId: string | null;
  userIntent: {
    explicitlyAskedForMaster: boolean;
    explicitlyRejectedSuggestion: boolean;
  };
  activity: {
    recentUserMessages: number;
    recentAssistantMessages: number;
    recentToolCalls: number;
    recentFailures: number;
    repeatedFailureCount: number;
    noProgressWindowMs: number | null;
  };
  diagnostics: {
    failingTests: number;
    failingCommands: number;
    repeatedErrorSignatures: string[];
    uncertaintySignals: string[];
  };
  workState: {
    hasPlan: boolean;
    todoBlocked: boolean;
    diffChangedRecently: boolean;
    onlyReadingWithoutConverging: boolean;
  };
  directory: {
    availableMasters: number;
    trustedMasters: number;
    onlineMasters: number;
  };
  candidateMasterKindHint: string | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeInteger(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }

  return fallback;
}

function normalizeNullableInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const parsed = normalizeInteger(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const entry of value) {
    const text = normalizeText(entry);
    if (!text || seen.has(text)) {
      continue;
    }
    seen.add(text);
    normalized.push(text);
  }
  return normalized;
}

function normalizeObservation(input: TriggerObservation): NormalizedTriggerObservation {
  return {
    now: normalizeInteger(input.now, Date.now()),
    traceId: normalizeText(input.traceId) || null,
    hostMode: normalizeText(input.hostMode) || 'unknown',
    workspaceId: normalizeText(input.workspaceId) || null,
    userIntent: {
      explicitlyAskedForMaster: normalizeBoolean(input.userIntent?.explicitlyAskedForMaster),
      explicitlyRejectedSuggestion: normalizeBoolean(input.userIntent?.explicitlyRejectedSuggestion),
    },
    activity: {
      recentUserMessages: normalizeInteger(input.activity?.recentUserMessages),
      recentAssistantMessages: normalizeInteger(input.activity?.recentAssistantMessages),
      recentToolCalls: normalizeInteger(input.activity?.recentToolCalls),
      recentFailures: normalizeInteger(input.activity?.recentFailures),
      repeatedFailureCount: normalizeInteger(input.activity?.repeatedFailureCount),
      noProgressWindowMs: normalizeNullableInteger(input.activity?.noProgressWindowMs),
    },
    diagnostics: {
      failingTests: normalizeInteger(input.diagnostics?.failingTests),
      failingCommands: normalizeInteger(input.diagnostics?.failingCommands),
      repeatedErrorSignatures: normalizeStringArray(input.diagnostics?.repeatedErrorSignatures),
      uncertaintySignals: normalizeStringArray(input.diagnostics?.uncertaintySignals),
    },
    workState: {
      hasPlan: normalizeBoolean(input.workState?.hasPlan),
      todoBlocked: normalizeBoolean(input.workState?.todoBlocked),
      diffChangedRecently: normalizeBoolean(input.workState?.diffChangedRecently),
      onlyReadingWithoutConverging: normalizeBoolean(input.workState?.onlyReadingWithoutConverging),
    },
    directory: {
      availableMasters: normalizeInteger(input.directory?.availableMasters),
      trustedMasters: normalizeInteger(input.directory?.trustedMasters),
      onlineMasters: normalizeInteger(input.directory?.onlineMasters),
    },
    candidateMasterKindHint: normalizeText(input.candidateMasterKindHint) || null,
  };
}

function normalizeConfig(config?: Partial<AskMasterConfig> | null): Pick<AskMasterConfig, 'enabled' | 'triggerMode' | 'trustedMasters'> {
  return {
    enabled: config?.enabled !== false,
    triggerMode: config?.triggerMode === 'suggest' || config?.triggerMode === 'auto'
      ? config.triggerMode
      : 'manual',
    trustedMasters: Array.isArray(config?.trustedMasters)
      ? normalizeStringArray(config?.trustedMasters)
      : [],
  };
}

function normalizeMemoryState(state?: Partial<MasterTriggerMemoryState> | null): MasterTriggerMemoryState {
  return {
    suggestedTraceIds: normalizeStringArray(state?.suggestedTraceIds).slice(-25),
    rejectedMasterKinds: normalizeStringArray(state?.rejectedMasterKinds).slice(-25),
    recentFailureSignatures: normalizeStringArray(state?.recentFailureSignatures).slice(-50),
    manuallyRequestedMasterKinds: normalizeStringArray(state?.manuallyRequestedMasterKinds).slice(-25),
  };
}

function determineCandidateMasterKind(observation: NormalizedTriggerObservation): string | null {
  if (observation.candidateMasterKindHint) {
    return observation.candidateMasterKindHint;
  }

  if (
    observation.activity.recentFailures > 0
    || observation.activity.repeatedFailureCount > 0
    || observation.diagnostics.failingTests > 0
    || observation.diagnostics.failingCommands > 0
    || observation.diagnostics.repeatedErrorSignatures.length > 0
    || observation.diagnostics.uncertaintySignals.length > 0
  ) {
    return 'debug';
  }

  return null;
}

function hasSuggestSignals(observation: NormalizedTriggerObservation): boolean {
  return observation.activity.repeatedFailureCount >= 2
    || observation.activity.recentFailures >= 2
    || observation.diagnostics.failingTests > 0
    || observation.diagnostics.failingCommands > 0
    || observation.diagnostics.repeatedErrorSignatures.length > 0
    || observation.diagnostics.uncertaintySignals.length > 0
    || observation.workState.todoBlocked
    || (
      observation.workState.onlyReadingWithoutConverging
      && (observation.activity.noProgressWindowMs ?? 0) >= 300_000
    );
}

function intersects(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((entry) => rightSet.has(entry));
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0.01, Math.min(0.99, value)) * 100) / 100;
}

function computeConfidence(
  config: Pick<AskMasterConfig, 'enabled' | 'triggerMode' | 'trustedMasters'>,
  observation: NormalizedTriggerObservation,
): number {
  let score = 0.35;
  if (observation.activity.repeatedFailureCount >= 2) score += 0.2;
  if (observation.activity.recentFailures >= 2) score += 0.1;
  if (observation.diagnostics.failingTests > 0) score += 0.1;
  if (observation.diagnostics.failingCommands > 0) score += 0.1;
  if (observation.diagnostics.repeatedErrorSignatures.length > 0) score += 0.1;
  if (observation.diagnostics.uncertaintySignals.length > 0) score += 0.05;
  if (observation.workState.todoBlocked) score += 0.05;
  if (
    observation.workState.onlyReadingWithoutConverging
    && (observation.activity.noProgressWindowMs ?? 0) >= 300_000
  ) {
    score += 0.05;
  }
  if (observation.directory.trustedMasters > 0 || config.trustedMasters.length > 0) {
    score += 0.05;
  }
  return roundConfidence(score);
}

export function createMasterTriggerMemoryState(): MasterTriggerMemoryState {
  return {
    suggestedTraceIds: [],
    rejectedMasterKinds: [],
    recentFailureSignatures: [],
    manuallyRequestedMasterKinds: [],
  };
}

export function mergeMasterTriggerMemoryStates(
  ...states: Array<Partial<MasterTriggerMemoryState> | null | undefined>
): MasterTriggerMemoryState {
  return normalizeMemoryState({
    suggestedTraceIds: states.flatMap((state) => normalizeMemoryState(state).suggestedTraceIds),
    rejectedMasterKinds: states.flatMap((state) => normalizeMemoryState(state).rejectedMasterKinds),
    recentFailureSignatures: states.flatMap((state) => normalizeMemoryState(state).recentFailureSignatures),
    manuallyRequestedMasterKinds: states.flatMap((state) => normalizeMemoryState(state).manuallyRequestedMasterKinds),
  });
}

export async function collectAndEvaluateMasterTrigger(input: {
  config?: Partial<AskMasterConfig> | null;
  suppression?: Partial<MasterTriggerMemoryState> | null;
  collectObservation: () => TriggerObservation | Promise<TriggerObservation>;
}): Promise<CollectAndEvaluateMasterTriggerResult> {
  const config = normalizeConfig(input.config);
  if (!config.enabled) {
    return {
      collected: false,
      observation: null,
      decision: {
        action: 'no_action',
        reason: 'Ask Master is disabled by local config.',
      },
    };
  }

  const collectedObservation = await input.collectObservation();
  const observation = normalizeObservation(collectedObservation);
  return {
    collected: true,
    observation,
    decision: evaluateMasterTrigger({
      config,
      observation,
      suppression: input.suppression,
    }),
  };
}

export function evaluateMasterTrigger(input: {
  config?: Partial<AskMasterConfig> | null;
  observation: TriggerObservation;
  suppression?: Partial<MasterTriggerMemoryState> | null;
}): TriggerDecision {
  const config = normalizeConfig(input.config);
  if (!config.enabled) {
    return {
      action: 'no_action',
      reason: 'Ask Master is disabled by local config.',
    };
  }

  const observation = normalizeObservation(input.observation);
  const suppression = normalizeMemoryState(input.suppression);
  if (observation.userIntent.explicitlyAskedForMaster) {
    return {
      action: 'manual_requested',
      reason: 'User explicitly requested Ask Master.',
    };
  }

  if (observation.userIntent.explicitlyRejectedSuggestion) {
    return {
      action: 'no_action',
      reason: 'User explicitly rejected Ask Master suggestion.',
    };
  }

  if (observation.directory.onlineMasters < 1 || observation.directory.availableMasters < 1) {
    return {
      action: 'no_action',
      reason: 'No online Master is currently available.',
    };
  }

  if (config.triggerMode === 'manual') {
    return {
      action: 'no_action',
      reason: 'Ask Master trigger mode is manual.',
    };
  }

  const candidateMasterKind = determineCandidateMasterKind(observation);
  if (observation.traceId && suppression.suggestedTraceIds.includes(observation.traceId)) {
    return {
      action: 'no_action',
      reason: 'This trace was already suggested for Ask Master.',
    };
  }

  if (candidateMasterKind && suppression.rejectedMasterKinds.includes(candidateMasterKind)) {
    return {
      action: 'no_action',
      reason: 'The same Master kind was rejected recently.',
    };
  }

  if (candidateMasterKind && suppression.manuallyRequestedMasterKinds.includes(candidateMasterKind)) {
    return {
      action: 'no_action',
      reason: 'A manual Ask Master was already requested for this Master kind.',
    };
  }

  if (intersects(observation.diagnostics.repeatedErrorSignatures, suppression.recentFailureSignatures)) {
    return {
      action: 'no_action',
      reason: 'This failure signature was already suggested recently.',
    };
  }

  if (!hasSuggestSignals(observation)) {
    return {
      action: 'no_action',
      reason: 'Current signals do not justify Ask Master yet.',
    };
  }

  const confidence = computeConfidence(config, observation);
  if (config.triggerMode === 'auto' && observation.directory.trustedMasters > 0 && confidence >= 0.9) {
    return {
      action: 'auto_candidate',
      reason: 'Repeated failures and a trusted Master make automatic Ask Master entry viable.',
      confidence,
      candidateMasterKind,
    };
  }

  return {
    action: 'suggest',
    reason: 'Repeated failures and low progress make Ask Master worthwhile.',
    confidence,
    candidateMasterKind,
  };
}

export function recordMasterTriggerOutcome(input: {
  state?: Partial<MasterTriggerMemoryState> | null;
  observation: TriggerObservation | NormalizedTriggerObservation;
  decision: TriggerDecision;
}): MasterTriggerMemoryState {
  const state = normalizeMemoryState(input.state);
  const observation = normalizeObservation(input.observation);
  const candidateMasterKind = normalizeText(
    ('candidateMasterKind' in input.decision ? input.decision.candidateMasterKind : '') || observation.candidateMasterKindHint
  ) || determineCandidateMasterKind(observation);

  const next = normalizeMemoryState(state);
  if (observation.userIntent.explicitlyRejectedSuggestion && candidateMasterKind) {
    next.rejectedMasterKinds = normalizeStringArray([
      ...next.rejectedMasterKinds,
      candidateMasterKind,
    ]).slice(-25);
  }

  if (input.decision.action === 'manual_requested' && candidateMasterKind) {
    next.manuallyRequestedMasterKinds = normalizeStringArray([
      ...next.manuallyRequestedMasterKinds,
      candidateMasterKind,
    ]).slice(-25);
  }

  if (input.decision.action === 'suggest' || input.decision.action === 'auto_candidate') {
    if (observation.traceId) {
      next.suggestedTraceIds = normalizeStringArray([
        ...next.suggestedTraceIds,
        observation.traceId,
      ]).slice(-25);
    }
    next.recentFailureSignatures = normalizeStringArray([
      ...next.recentFailureSignatures,
      ...observation.diagnostics.repeatedErrorSignatures,
    ]).slice(-50);
  }

  return next;
}
