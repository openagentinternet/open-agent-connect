import { type AskMasterConfig } from '../config/configTypes';
import type { MasterDirectoryItem } from './masterTypes';
export type MasterAutoFrictionMode = 'preview_confirm' | 'direct_send';
export interface MasterPayloadSafetySummary {
    isSensitive: boolean;
    reasons: string[];
}
export interface MasterAutoPolicyDecision {
    allowed: boolean;
    code: string | null;
    blockedReason: string | null;
    selectedFrictionMode: MasterAutoFrictionMode;
    requiresConfirmation: boolean;
    contextMode: AskMasterConfig['contextMode'];
    sensitivity: MasterPayloadSafetySummary;
    trustedTarget: boolean;
    confidence: number | null;
    policyReason: string | null;
}
export declare function evaluateMasterAutoPolicy(input: {
    config?: Partial<AskMasterConfig> | null;
    selectedMaster: MasterDirectoryItem | null;
    sensitivity?: Partial<MasterPayloadSafetySummary> | null;
    confidence?: number | null;
    traceAutoPrepareCount?: number | null;
    lastAutoAt?: number | null;
    now?: number | null;
}): MasterAutoPolicyDecision;
