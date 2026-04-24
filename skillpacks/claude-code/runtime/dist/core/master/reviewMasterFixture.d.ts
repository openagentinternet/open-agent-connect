import type { MasterRequestMessage } from './masterMessageSchema';
import type { MasterRunnerCompletedResult, MasterRunnerNeedMoreContextResult } from './masterProviderRuntime';
export declare function runOfficialReviewMaster(input: {
    request: MasterRequestMessage;
}): MasterRunnerCompletedResult | MasterRunnerNeedMoreContextResult;
