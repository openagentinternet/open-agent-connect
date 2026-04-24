import type { DelegationPolicyDecision, DelegationPolicyMode, DelegationPolicyReason } from './sessionTypes';
export interface EvaluateDelegationPolicyInput {
    policyMode?: unknown;
    estimatedCostAmount?: string | null;
    estimatedCostCurrency?: string | null;
}
export declare const DELEGATION_POLICY_REASON: Readonly<Record<string, DelegationPolicyReason>>;
export declare function resolveDelegationPolicyMode(rawPolicyMode: unknown, fallback?: DelegationPolicyMode): DelegationPolicyMode;
export declare function evaluateDelegationPolicy(input?: EvaluateDelegationPolicyInput): DelegationPolicyDecision;
