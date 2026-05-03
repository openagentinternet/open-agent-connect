import type {
  DelegationPolicyDecision,
  DelegationPolicyMode,
  DelegationPolicyReason,
} from './sessionTypes';

export interface EvaluateDelegationPolicyInput {
  policyMode?: unknown;
  estimatedCostAmount?: string | null;
  estimatedCostCurrency?: string | null;
}

const DEFAULT_POLICY_MODE: DelegationPolicyMode = 'confirm_all';
const PUBLIC_ENABLED_POLICY_MODES: ReadonlySet<DelegationPolicyMode> = new Set([
  'confirm_all',
  'confirm_paid_only',
  'auto_when_safe',
]);
export const DELEGATION_POLICY_REASON: Readonly<Record<string, DelegationPolicyReason>> = {
  confirmAllRequiresConfirmation: 'confirm_all_requires_confirmation',
  paidServiceRequiresConfirmation: 'paid_service_requires_confirmation',
  freeServiceAutoApproved: 'free_service_auto_approved',
  policyModeNotPubliclyEnabled: 'policy_mode_not_publicly_enabled',
};

function isDelegationPolicyMode(value: string): value is DelegationPolicyMode {
  return value === 'confirm_all'
    || value === 'confirm_paid_only'
    || value === 'auto_when_safe';
}

export function resolveDelegationPolicyMode(
  rawPolicyMode: unknown,
  fallback: DelegationPolicyMode = DEFAULT_POLICY_MODE,
): DelegationPolicyMode {
  if (typeof rawPolicyMode !== 'string') {
    return fallback;
  }
  const normalized = rawPolicyMode.trim().toLowerCase();
  if (isDelegationPolicyMode(normalized)) {
    return normalized;
  }
  return fallback;
}

function isExplicitZeroCostAmount(value: unknown): boolean {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    return false;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed === 0;
}

export function evaluateDelegationPolicy(
  input: EvaluateDelegationPolicyInput = {},
): DelegationPolicyDecision {
  const requestedPolicyMode = resolveDelegationPolicyMode(input.policyMode);
  const isPubliclyEnabled = PUBLIC_ENABLED_POLICY_MODES.has(requestedPolicyMode);

  if (!isPubliclyEnabled) {
    return {
      requiresConfirmation: true,
      policyMode: DEFAULT_POLICY_MODE,
      policyReason: DELEGATION_POLICY_REASON.policyModeNotPubliclyEnabled,
      requestedPolicyMode,
      confirmationBypassed: false,
      bypassReason: null,
    };
  }

  if (requestedPolicyMode === 'confirm_paid_only' || requestedPolicyMode === 'auto_when_safe') {
    if (isExplicitZeroCostAmount(input.estimatedCostAmount)) {
      return {
        requiresConfirmation: false,
        policyMode: requestedPolicyMode,
        policyReason: DELEGATION_POLICY_REASON.freeServiceAutoApproved,
        requestedPolicyMode,
        confirmationBypassed: true,
        bypassReason: 'free_service',
      };
    }

    return {
      requiresConfirmation: true,
      policyMode: requestedPolicyMode,
      policyReason: DELEGATION_POLICY_REASON.paidServiceRequiresConfirmation,
      requestedPolicyMode,
      confirmationBypassed: false,
      bypassReason: null,
    };
  }

  return {
    requiresConfirmation: true,
    policyMode: requestedPolicyMode,
    policyReason: DELEGATION_POLICY_REASON.confirmAllRequiresConfirmation,
    requestedPolicyMode,
    confirmationBypassed: false,
    bypassReason: null,
  };
}
