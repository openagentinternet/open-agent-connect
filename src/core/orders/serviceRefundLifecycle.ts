import type { SessionTraceRecord } from '../chat/sessionTrace';
import {
  DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS,
  isSelfDirectedPair,
} from './orderLifecycle';

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
  writeRefundRequest(
    traceId: string,
    context?: BuyerRefundRequestWriteContext,
  ): Promise<BuyerRefundRequestWriteResult | void>;
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

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string' && normalizeText(value) === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function normalizeRetryCount(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.trunc(numeric) : 0;
}

function isZeroPaymentAmount(value: unknown): boolean {
  const text = normalizeText(value);
  if (!text) {
    return false;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric === 0;
}

function isNonFreeBuyerRefundTrace(trace: SessionTraceRecord): boolean {
  const order = trace.order;
  if (!order) {
    return false;
  }
  return !isZeroPaymentAmount(order.paymentAmount);
}

function isSelfDirectedBuyerTrace(input: {
  trace: SessionTraceRecord;
  localGlobalMetaId?: string | null;
}): boolean {
  const trace = input.trace;
  if (isSelfDirectedPair({
    localGlobalMetaId: input.localGlobalMetaId,
    counterpartyGlobalMetaId: normalizeText(trace.a2a?.providerGlobalMetaId)
      || normalizeText(trace.session.peerGlobalMetaId),
  })) {
    return true;
  }
  return isSelfDirectedPair({
    localGlobalMetaId: trace.a2a?.callerGlobalMetaId,
    counterpartyGlobalMetaId: trace.a2a?.providerGlobalMetaId,
  });
}

function isDueRetry(order: NonNullable<SessionTraceRecord['order']>, nowMs: number): boolean {
  const nextRetryAt = normalizeTimestamp(order.nextRetryAt);
  return nextRetryAt === null || nextRetryAt <= nowMs;
}

function readFailureReason(trace: SessionTraceRecord): string {
  return normalizeText(trace.order?.failureReason) || 'delivery_timeout';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown refund request writer error.');
}

function resultTraceFromWriteResult(result: BuyerRefundRequestWriteResult | void): SessionTraceRecord | null {
  return result && result.trace ? result.trace : null;
}

function writeResultIsPending(result: BuyerRefundRequestWriteResult | void): boolean {
  const trace = resultTraceFromWriteResult(result);
  const status = normalizeText(result?.status) || normalizeText(trace?.order?.status);
  const refundRequestPinId = normalizeText(result?.refundRequestPinId)
    || normalizeText(trace?.order?.refundRequestPinId);
  return status === 'refund_pending' || Boolean(refundRequestPinId);
}

function retryFailureForTrace(input: {
  trace: SessionTraceRecord;
  nowMs: number;
  error: string;
}): BuyerRefundRequestLifecycleFailure {
  return {
    traceId: input.trace.traceId,
    error: input.error,
    retryCount: normalizeRetryCount(input.trace.order?.refundApplyRetryCount) + 1,
    nextRetryAt: input.nowMs + DEFAULT_REFUND_REQUEST_RETRY_DELAY_MS,
  };
}

function persistedFailureForTrace(input: {
  trace: SessionTraceRecord;
  fallbackTrace: SessionTraceRecord;
  nowMs: number;
  error: string;
}): BuyerRefundRequestLifecycleFailure {
  const persistedRetryCount = normalizeRetryCount(input.trace.order?.refundApplyRetryCount);
  const persistedNextRetryAt = normalizeTimestamp(input.trace.order?.nextRetryAt);
  const synthesized = retryFailureForTrace({
    trace: input.fallbackTrace,
    nowMs: input.nowMs,
    error: input.error,
  });
  return {
    traceId: input.trace.traceId,
    error: input.error,
    retryCount: persistedRetryCount || synthesized.retryCount,
    nextRetryAt: persistedNextRetryAt ?? synthesized.nextRetryAt,
  };
}

export function selectDueBuyerRefundRequests(input: SelectDueBuyerRefundRequestsInput): SessionTraceRecord[] {
  return input.traces.filter((trace) => {
    const order = trace.order;
    if (!order || normalizeText(order.role) !== 'buyer') {
      return false;
    }
    const status = normalizeText(order.status);
    if (status !== 'failed') {
      return false;
    }
    if (normalizeText(order.refundRequestPinId)) {
      return false;
    }
    if (!isNonFreeBuyerRefundTrace(trace)) {
      return false;
    }
    if (isSelfDirectedBuyerTrace({
      trace,
      localGlobalMetaId: input.localGlobalMetaId,
    })) {
      return false;
    }
    return isDueRetry(order, input.nowMs);
  });
}

export async function runBuyerRefundRequestLifecycle(
  input: RunBuyerRefundRequestLifecycleInput,
): Promise<BuyerRefundRequestLifecycleResult> {
  const selected = selectDueBuyerRefundRequests(input);
  const failures: BuyerRefundRequestLifecycleFailure[] = [];
  let succeeded = 0;

  for (const trace of selected) {
    try {
      const result = await input.writer.writeRefundRequest(trace.traceId, {
        trace,
        failureReason: readFailureReason(trace),
        nowMs: input.nowMs,
      });
      if (writeResultIsPending(result)) {
        succeeded += 1;
      } else {
        const resultTrace = resultTraceFromWriteResult(result);
        failures.push(persistedFailureForTrace({
          trace: resultTrace ?? trace,
          fallbackTrace: trace,
          nowMs: input.nowMs,
          error: readFailureReason(resultTrace ?? trace),
        }));
      }
    } catch (error) {
      failures.push(retryFailureForTrace({
        trace,
        nowMs: input.nowMs,
        error: errorMessage(error),
      }));
    }
  }

  return {
    attempted: selected.length,
    succeeded,
    failed: failures.length,
    selectedTraceIds: selected.map((trace) => trace.traceId),
    failures,
  };
}
