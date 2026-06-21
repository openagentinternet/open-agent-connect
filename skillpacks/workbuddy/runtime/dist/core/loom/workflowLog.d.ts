import type { ChainWriteNetwork } from '../chain/writePin';
import type { LoomFileUploadNetwork, LoomWorkflowStatusValue } from './workflowTypes';
type ProcessLogRecordChain = ChainWriteNetwork | string;
type ProcessLogFileChain = LoomFileUploadNetwork;
export interface LoomProcessLogCheck {
    command: string;
    status: 'passed' | 'failed' | 'skipped' | string;
    exitCode?: number;
    durationMs?: number;
    stdoutSummary?: string;
    stderrSummary?: string;
    summary?: string;
}
export interface LoomProcessLogCommit {
    sha: string;
    message: string;
}
export interface LoomProcessLogInput {
    directory?: string;
    fileName?: string;
    taskPinId?: string;
    claimPinId?: string;
    actor?: {
        slug?: string;
        globalMetaId?: string;
    };
    repo?: {
        uri?: string;
        branch?: string;
        workspacePath?: string;
    };
    roundNote?: string;
    llm?: {
        model?: string;
        sessionId?: string | null;
    };
    checks?: LoomProcessLogCheck[];
    git?: {
        changes?: string[];
        commits?: LoomProcessLogCommit[];
    };
    statusDecision?: {
        status?: LoomWorkflowStatusValue | string;
        summary?: string;
    };
    payloadPreview?: unknown;
    chainResult?: unknown;
    errors?: unknown[];
    rawLog?: string;
    maxBytes?: number;
}
export interface LoomProcessLogWriteResult {
    path: string;
    content: string;
}
export declare function selectProcessLogFileChain(recordChain: ProcessLogRecordChain, fileChain?: string): ProcessLogFileChain;
export declare function redactLoomProcessLog(input: unknown): string;
export declare function renderLoomProcessLog(input: LoomProcessLogInput): string;
export declare function writeLoomProcessLogFile(input: LoomProcessLogInput & {
    directory: string;
    fileName: string;
}): Promise<LoomProcessLogWriteResult>;
export {};
