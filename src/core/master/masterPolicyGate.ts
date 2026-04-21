import {
  createDefaultConfig,
  normalizeAskMasterAutoPolicyConfig,
  type AskMasterConfig,
} from '../config/configTypes';
import { evaluateMasterAutoPolicy, type MasterPayloadSafetySummary } from './masterAutoPolicy';
import type { MasterDirectoryItem } from './masterTypes';

export type MasterPolicyAction =
  | 'manual_ask'
  | 'manual_requested'
  | 'suggest'
  | 'accept_suggest'
  | 'reject_suggest'
  | 'auto_candidate';

export type MasterPolicyFailureCode =
  | 'ask_master_disabled'
  | 'trigger_mode_disallows_suggest'
  | 'confirmation_required'
  | 'trigger_mode_disallows_auto'
  | 'auto_confidence_too_low'
  | 'auto_per_trace_limited'
  | 'auto_global_cooldown';

export interface MasterPolicyDecision {
  allowed: boolean;
  code: MasterPolicyFailureCode | null;
  blockedReason: string | null;
  requiresConfirmation: boolean;
  selectedFrictionMode: 'preview_confirm' | 'direct_send';
  contextMode: AskMasterConfig['contextMode'];
  policyReason: string | null;
  sensitivity: MasterPayloadSafetySummary;
  trustedTarget: boolean;
}

function normalizeConfig(config?: Partial<AskMasterConfig> | null): AskMasterConfig {
  const defaults = createDefaultConfig().askMaster;
  return {
    enabled: config?.enabled !== false,
    triggerMode: config?.triggerMode === 'manual'
      || config?.triggerMode === 'suggest'
      || config?.triggerMode === 'auto'
      ? config.triggerMode
      : defaults.triggerMode,
    confirmationMode: config?.confirmationMode === 'sensitive_only' || config?.confirmationMode === 'never'
      ? config.confirmationMode
      : defaults.confirmationMode,
    contextMode: config?.contextMode === 'compact' || config?.contextMode === 'full_task'
      ? config.contextMode
      : defaults.contextMode,
    trustedMasters: Array.isArray(config?.trustedMasters)
      ? [...config.trustedMasters]
      : [...defaults.trustedMasters],
    autoPolicy: normalizeAskMasterAutoPolicyConfig(config?.autoPolicy),
  };
}

function requiresSelectedMaster(action: MasterPolicyAction): boolean {
  return action === 'manual_ask'
    || action === 'suggest'
    || action === 'accept_suggest'
    || action === 'auto_candidate';
}

export function evaluateMasterPolicy(input: {
  config?: Partial<AskMasterConfig> | null;
  action: MasterPolicyAction;
  selectedMaster: MasterDirectoryItem | null;
  auto?: {
    sensitivity?: Partial<MasterPayloadSafetySummary> | null;
    confidence?: number | null;
    traceAutoPrepareCount?: number | null;
    lastAutoAt?: number | null;
    now?: number | null;
  };
}): MasterPolicyDecision {
  const config = normalizeConfig(input.config);
  if (input.action !== 'reject_suggest' && !config.enabled) {
    return {
      allowed: false,
      code: 'ask_master_disabled',
      blockedReason: 'Ask Master is disabled by local config.',
      requiresConfirmation: true,
      selectedFrictionMode: 'preview_confirm',
      contextMode: config.contextMode,
      policyReason: 'Ask Master is globally disabled.',
      sensitivity: {
        isSensitive: false,
        reasons: [],
      },
      trustedTarget: false,
    };
  }

  if (requiresSelectedMaster(input.action) && !input.selectedMaster) {
    return {
      allowed: false,
      code: null,
      blockedReason: 'No eligible Master was selected.',
      requiresConfirmation: config.confirmationMode !== 'never',
      selectedFrictionMode: config.confirmationMode === 'never' ? 'direct_send' : 'preview_confirm',
      contextMode: config.contextMode,
      policyReason: 'A Master target must be selected before continuing.',
      sensitivity: {
        isSensitive: false,
        reasons: [],
      },
      trustedTarget: false,
    };
  }

  if (input.action === 'suggest' && config.triggerMode === 'manual') {
    return {
      allowed: false,
      code: 'trigger_mode_disallows_suggest',
      blockedReason: 'Ask Master trigger mode is manual.',
      requiresConfirmation: config.confirmationMode !== 'never',
      selectedFrictionMode: config.confirmationMode === 'never' ? 'direct_send' : 'preview_confirm',
      contextMode: config.contextMode,
      policyReason: 'Trigger mode manual suppresses proactive suggestions.',
      sensitivity: {
        isSensitive: false,
        reasons: [],
      },
      trustedTarget: false,
    };
  }

  if (input.action === 'auto_candidate') {
    const autoDecision = evaluateMasterAutoPolicy({
      config,
      selectedMaster: input.selectedMaster,
      sensitivity: input.auto?.sensitivity,
      confidence: input.auto?.confidence,
      traceAutoPrepareCount: input.auto?.traceAutoPrepareCount,
      lastAutoAt: input.auto?.lastAutoAt,
      now: input.auto?.now,
    });
    return {
      allowed: autoDecision.allowed,
      code: autoDecision.code as MasterPolicyFailureCode | null,
      blockedReason: autoDecision.blockedReason,
      requiresConfirmation: autoDecision.requiresConfirmation,
      selectedFrictionMode: autoDecision.selectedFrictionMode,
      contextMode: autoDecision.contextMode,
      policyReason: autoDecision.policyReason,
      sensitivity: autoDecision.sensitivity,
      trustedTarget: autoDecision.trustedTarget,
    };
  }

  return {
    allowed: true,
    code: null,
    blockedReason: null,
    requiresConfirmation: config.confirmationMode !== 'never',
    selectedFrictionMode: config.confirmationMode === 'never' ? 'direct_send' : 'preview_confirm',
    contextMode: config.contextMode,
    policyReason: config.confirmationMode === 'never'
      ? 'Confirmation mode never allows immediate continuation.'
      : 'Current policy keeps Ask Master on the preview confirmation path.',
    sensitivity: {
      isSensitive: false,
      reasons: [],
    },
    trustedTarget: false,
  };
}
