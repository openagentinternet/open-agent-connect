import { type MetabotCommandResult } from '../contracts/commandResult';
import type { LoomCommandRunner } from './commandRunner';
import { type LoomProcessLogInput, type LoomProcessLogWriteResult } from './workflowLog';
import type { LoomWorkflowTaskState } from './workflowState';
import type { LoomWorkflowStore } from './workflowStore';
import type { LoomWorkflowCommitRecord, LoomWorkflowState, LoomWorkflowStatusValue } from './workflowTypes';
export interface LoomDevRoundLlmResult {
    sessionId?: string | null;
    status: string;
    output?: string;
    error?: string;
}
export interface LoomDevRoundWorkflowInput {
    from?: string;
    taskPinId: string;
    claimPinId: string;
    chain?: string;
    fileChain?: string;
    checks: string[];
    roundNote?: string;
    developerMetaBotSlug: string;
    developerGlobalMetaId: string;
    state: LoomWorkflowTaskState;
    workflowStore: LoomWorkflowStore;
    runner: LoomCommandRunner;
    executeLlmRound: (prompt: string, cwd: string) => Promise<LoomDevRoundLlmResult>;
    writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    uploadFile: (input: {
        filePath: string;
        network: string;
        contentType?: string;
    }) => Promise<{
        metafileUri?: string;
        uri?: string;
        pinId?: string;
        network?: string;
    }>;
    writeLogFile: (input: LoomProcessLogInput & {
        directory: string;
        fileName: string;
    }) => Promise<LoomProcessLogWriteResult>;
    now?: () => number;
    commitMessage?: string;
}
export interface LoomDevRoundPromptInput {
    task: Record<string, unknown>;
    workflow: LoomWorkflowState;
    checks: string[];
    roundNote?: string;
}
export interface LoomDevRoundWorkflowResult {
    taskPinId: string;
    claimPinId: string;
    status: LoomWorkflowStatusValue;
    branchName: string;
    workspacePath: string;
    processLogPath: string;
    processLogUri: string;
    statusPinId: string;
    commits: LoomWorkflowCommitRecord[];
    checksPassed: boolean | null;
    llmSessionId?: string | null;
}
export declare function buildLoomDevRoundPrompt(input: LoomDevRoundPromptInput): string;
export declare function runLoomDevRoundWorkflow(input: LoomDevRoundWorkflowInput): Promise<MetabotCommandResult<LoomDevRoundWorkflowResult>>;
