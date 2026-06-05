import type { SessionTraceRecord } from '../chat/sessionTrace';
export interface BuyerRefundRequestWriteContext {
    trace: SessionTraceRecord;
    failureReason: string;
    nowMs: number;
}
export interface BuyerRefundRequestWriteResult {
    trace?: SessionTraceRecord | null;
    refundRequestPinId?: string | null;
    status?: string | null;
}
export interface BuyerRefundRequestWriter {
    writeRefundRequest(traceId: string, context?: BuyerRefundRequestWriteContext): Promise<BuyerRefundRequestWriteResult | void>;
}
export interface BuyerRefundRequestLifecycleFailure {
    traceId: string;
    error: string;
    retryCount: number;
    nextRetryAt: number;
}
export interface BuyerRefundRequestLifecycleResult {
    attempted: number;
    succeeded: number;
    failed: number;
    selectedTraceIds: string[];
    failures: BuyerRefundRequestLifecycleFailure[];
}
export interface SelectDueBuyerRefundRequestsInput {
    traces: SessionTraceRecord[];
    nowMs: number;
    localGlobalMetaId?: string | null;
}
export interface RunBuyerRefundRequestLifecycleInput extends SelectDueBuyerRefundRequestsInput {
    writer: BuyerRefundRequestWriter;
}
export declare function selectDueBuyerRefundRequests(input: SelectDueBuyerRefundRequestsInput): SessionTraceRecord[];
export declare function runBuyerRefundRequestLifecycle(input: RunBuyerRefundRequestLifecycleInput): Promise<BuyerRefundRequestLifecycleResult>;
