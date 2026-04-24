import type { AskMasterConfig } from '../config/configTypes';
import { type MasterPolicyDecision } from './masterPolicyGate';
import { type MasterAskDraft } from './masterPreview';
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
export declare function prepareAutoMasterAskPlan(input: {
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
}): PreparedAutoMasterAskPlan;
