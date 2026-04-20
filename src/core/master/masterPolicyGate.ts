import { createDefaultConfig, type AskMasterConfig } from '../config/configTypes';
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
  | 'confirmation_required';

export interface MasterPolicyDecision {
  allowed: boolean;
  code: MasterPolicyFailureCode | null;
  blockedReason: string | null;
  requiresConfirmation: boolean;
  contextMode: AskMasterConfig['contextMode'];
}

function normalizeConfig(config?: Partial<AskMasterConfig> | null): AskMasterConfig {
  const defaults = createDefaultConfig().askMaster;
  return {
    enabled: config?.enabled !== false,
    triggerMode: config?.triggerMode === 'suggest' || config?.triggerMode === 'auto'
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
  };
}

function requiresSelectedMaster(action: MasterPolicyAction): boolean {
  return action === 'manual_ask'
    || action === 'suggest'
    || action === 'accept_suggest';
}

export function evaluateMasterPolicy(input: {
  config?: Partial<AskMasterConfig> | null;
  action: MasterPolicyAction;
  selectedMaster: MasterDirectoryItem | null;
}): MasterPolicyDecision {
  const config = normalizeConfig(input.config);
  if (input.action !== 'reject_suggest' && !config.enabled) {
    return {
      allowed: false,
      code: 'ask_master_disabled',
      blockedReason: 'Ask Master is disabled by local config.',
      requiresConfirmation: true,
      contextMode: config.contextMode,
    };
  }

  if (requiresSelectedMaster(input.action) && !input.selectedMaster) {
    return {
      allowed: false,
      code: null,
      blockedReason: 'No eligible Master was selected.',
      requiresConfirmation: config.confirmationMode !== 'never',
      contextMode: config.contextMode,
    };
  }

  if (input.action === 'suggest' && config.triggerMode === 'manual') {
    return {
      allowed: false,
      code: 'trigger_mode_disallows_suggest',
      blockedReason: 'Ask Master trigger mode is manual.',
      requiresConfirmation: config.confirmationMode !== 'never',
      contextMode: config.contextMode,
    };
  }

  if (input.action === 'auto_candidate') {
    if (config.triggerMode !== 'auto') {
      return {
        allowed: false,
        code: null,
        blockedReason: 'Ask Master trigger mode does not allow auto candidate.',
        requiresConfirmation: config.confirmationMode !== 'never',
        contextMode: config.contextMode,
      };
    }

    return {
        allowed: false,
        code: null,
        blockedReason: 'Auto Ask Master is not exposed in the phase-2 host flow.',
        requiresConfirmation: config.confirmationMode !== 'never',
        contextMode: config.contextMode,
    };
  }

  return {
    allowed: true,
    code: null,
    blockedReason: null,
    requiresConfirmation: config.confirmationMode !== 'never',
    contextMode: config.contextMode,
  };
}
