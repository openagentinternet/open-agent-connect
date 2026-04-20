import type { AskMasterConfig } from '../config/configTypes';
import { evaluateMasterPolicy, type MasterPolicyDecision } from './masterPolicyGate';
import { buildMasterAskPreview, type MasterAskDraft } from './masterPreview';
import type { MasterDirectoryItem } from './masterTypes';

export interface PreparedAutoMasterAskPlan {
  draft: MasterAskDraft | Record<string, unknown>;
  preparedSafety: {
    isSensitive: boolean;
    reasons: string[];
  };
  policy: MasterPolicyDecision;
  autoReason: string | null;
  confidence: number | null;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeConfidence(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const parsed = Number.parseFloat(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export function prepareAutoMasterAskPlan(input: {
  draft: MasterAskDraft | Record<string, unknown>;
  resolvedTarget: MasterDirectoryItem;
  caller: {
    globalMetaId: string;
    name?: string | null;
    host: string;
  };
  config: AskMasterConfig;
  auto: {
    reason?: string | null;
    confidence?: number | null;
    traceAutoPrepareCount?: number | null;
    lastAutoAt?: number | null;
    now?: number | null;
  };
}): PreparedAutoMasterAskPlan {
  const prepared = buildMasterAskPreview({
    draft: input.draft,
    resolvedTarget: input.resolvedTarget,
    caller: input.caller,
    traceId: 'trace-master-auto-plan',
    requestId: 'request-master-auto-plan',
    confirmationMode: input.config.confirmationMode,
  });
  const confidence = normalizeConfidence(input.auto.confidence);
  const policy = evaluateMasterPolicy({
    config: input.config,
    action: 'auto_candidate',
    selectedMaster: input.resolvedTarget,
    auto: {
      sensitivity: prepared.preview.safety.sensitivity,
      confidence,
      traceAutoPrepareCount: input.auto.traceAutoPrepareCount,
      lastAutoAt: input.auto.lastAutoAt,
      now: input.auto.now,
    },
  });

  return {
    draft: input.draft,
    preparedSafety: prepared.preview.safety.sensitivity,
    policy,
    autoReason: normalizeText(input.auto.reason) || null,
    confidence,
  };
}
