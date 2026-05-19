import type { MetabotCommandResult } from '../contracts/commandResult';
import type { ChainWriteNetwork } from '../chain/writePin';
export type LoomFileUploadNetwork = 'mvc' | 'btc' | 'opcat';
export type LoomWorkflowStatusValue = 'started' | 'in_progress' | 'completed' | 'failed';
export type LoomDerivedTaskState = 'open' | 'claimed' | 'in_progress' | 'delivered' | 'revision_needed' | 'rejected' | 'accepted_paid' | 'failed';
export interface LoomWorkflowCommitRecord {
    sha: string;
    message: string;
    files: string[];
}
export interface LoomWorkflowStatusRecord {
    roundId: string;
    status: LoomWorkflowStatusValue;
    pinId?: string;
    processLogPath?: string;
    processLogUri?: string;
    llmSessionId?: string | null;
    commits: LoomWorkflowCommitRecord[];
    checksPassed?: boolean | null;
}
export interface LoomWorkflowState {
    version: 1;
    taskPinId: string;
    claimPinId: string;
    developerMetaBotSlug: string;
    requesterGlobalMetaId?: string;
    developerGlobalMetaId?: string;
    repoUri: string;
    baseBranch: string;
    upstreamRemote: string;
    forkRemote: string;
    forkRepo?: string;
    branchName: string;
    workspacePath: string;
    claim?: {
        pinId: string;
        txids?: string[];
    };
    statuses: LoomWorkflowStatusRecord[];
    delivery?: {
        pinId?: string;
        prUrl?: string;
        prTitle?: string;
    };
    acceptance?: {
        pinId?: string;
        paymentTxId?: string;
    };
    retry?: {
        acceptanceRequestPath?: string;
        acceptancePayloadPath?: string;
    };
    updatedAt: string;
}
export interface LoomWorkflowCommandResult<T> extends Promise<MetabotCommandResult<T>> {
}
export interface LoomProtocolWriteResult {
    pinId: string;
    txids?: string[];
    network?: ChainWriteNetwork | string;
    globalMetaId?: string;
    mvcAddress?: string;
}
