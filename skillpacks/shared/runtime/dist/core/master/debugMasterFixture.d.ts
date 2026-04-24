import type { MasterRequestMessage } from './masterMessageSchema';
import type { MasterRunnerCompletedResult, MasterRunnerNeedMoreContextResult } from './masterProviderRuntime';
export declare function runOfficialDebugMaster(input: {
    request: MasterRequestMessage;
}): MasterRunnerCompletedResult | MasterRunnerNeedMoreContextResult;
