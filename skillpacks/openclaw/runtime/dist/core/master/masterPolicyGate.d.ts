import { type AskMasterConfig } from '../config/configTypes';
import { type MasterPayloadSafetySummary } from './masterAutoPolicy';
import type { MasterDirectoryItem } from './masterTypes';
export type MasterPolicyAction = 'manual_ask' | 'manual_requested' | 'suggest' | 'accept_suggest' | 'reject_suggest' | 'auto_candidate';
export type MasterPolicyFailureCode = 'ask_master_disabled' | 'trigger_mode_disallows_suggest' | 'confirmation_required' | 'trigger_mode_disallows_auto' | 'auto_confidence_too_low' | 'auto_per_trace_limited' | 'auto_global_cooldown';
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
export declare function evaluateMasterPolicy(input: {
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
}): MasterPolicyDecision;
