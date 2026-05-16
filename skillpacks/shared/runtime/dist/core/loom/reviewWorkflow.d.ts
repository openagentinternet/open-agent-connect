import { type MetabotCommandResult } from '../contracts/commandResult';
import { type LoomWorkflowTaskState } from './workflowState';
import type { LoomWorkflowStore } from './workflowStore';
export interface LoomWalletTransferInput {
    from?: string;
    toAddress: string;
    amountRaw: string;
    confirm: boolean;
}
export interface LoomReviewWorkflowBaseInput {
    from?: string;
    taskPinId: string;
    deliveryPinId: string;
    score: number;
    comment: string;
    chain?: string;
    requesterGlobalMetaId: string;
    state: LoomWorkflowTaskState;
    workflowStore: LoomWorkflowStore;
    writeChain: (request: Record<string, unknown>) => Promise<MetabotCommandResult<unknown>>;
    now?: () => number;
}
export interface LoomAcceptAndPayWorkflowInput extends LoomReviewWorkflowBaseInput {
    confirmPayment: boolean;
    walletTransfer: (input: LoomWalletTransferInput) => Promise<MetabotCommandResult<unknown>>;
}
export interface LoomReviewDeliveryWorkflowInput extends LoomReviewWorkflowBaseInput {
    verdict: 'rejected' | 'revision_needed';
    attachments?: string[];
}
export interface LoomReviewWorkflowResult {
    taskPinId: string;
    claimPinId: string;
    deliveryPinId: string;
    acceptancePinId: string;
    paymentTxId?: string;
    acceptancePayload: Record<string, unknown>;
    localPersistenceWarning?: LoomLocalPersistenceWarning;
}
interface LoomLocalPersistenceWarning {
    code: 'local_persistence_failed';
    message: string;
    error: {
        name?: string;
        message: string;
    };
}
export declare function buildLoomPaymentAmountRaw(bounty: unknown): string | undefined;
export declare function runLoomAcceptAndPayWorkflow(input: LoomAcceptAndPayWorkflowInput): Promise<MetabotCommandResult<LoomReviewWorkflowResult | Record<string, unknown>>>;
export declare function runLoomReviewDeliveryWorkflow(input: LoomReviewDeliveryWorkflowInput): Promise<MetabotCommandResult<LoomReviewWorkflowResult>>;
export {};
