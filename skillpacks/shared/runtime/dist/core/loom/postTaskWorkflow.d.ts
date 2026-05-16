import { type MetabotCommandResult } from '../contracts/commandResult';
import { type LoomChainWriteRequest } from './chainRequest';
import { type LoomProtocolRecordWriteResult } from './workflowChain';
export interface LoomPostTaskWorkflowDryRunResult {
    dryRun: true;
    payload: Record<string, unknown>;
    request: LoomPostTaskWorkflowPreviewRequest;
}
export type LoomPostTaskWorkflowPreviewRequest = LoomChainWriteRequest & {
    from?: string;
    network?: string;
};
export type LoomTaskDraftDependencyResult = Record<string, unknown> | MetabotCommandResult<unknown>;
export interface LoomPostTaskWorkflowInput {
    from?: string;
    payload?: Record<string, unknown>;
    payloadFile?: string;
    wish?: string;
    chain?: string;
    dryRun?: boolean;
    readPayloadFile?: (payloadFile: string) => Promise<Record<string, unknown>>;
    draftTask?: (wish: string) => Promise<LoomTaskDraftDependencyResult>;
    writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
}
export declare function runLoomPostTaskWorkflow(input: LoomPostTaskWorkflowInput): Promise<MetabotCommandResult<LoomPostTaskWorkflowDryRunResult | LoomProtocolRecordWriteResult>>;
