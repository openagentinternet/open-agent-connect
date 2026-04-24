import type { MasterHostObservationFrame } from './masterContextTypes';
export interface MasterAskWorthinessAssessment {
    opportunityType: 'none' | 'stuck' | 'review_checkpoint' | 'wrapup_risk';
    stuckLevel: 'none' | 'weak' | 'strong' | 'critical';
    confidence: number;
    score: number;
    reasons: string[];
    candidateMasterKind: string | null;
    autoEligible: boolean;
}
export interface MasterStuckDetectorOptions {
    minNoProgressWindowMs?: number;
}
export declare function assessMasterAskWorthiness(observation: MasterHostObservationFrame, options?: MasterStuckDetectorOptions): MasterAskWorthinessAssessment;
