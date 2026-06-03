import type { SessionTraceRecord } from '../chat/sessionTrace';
import type { RuntimeState } from '../state/runtimeStateStore';
import {
  createSellerOrderRecord,
  transitionSellerOrderRecord,
  type SellerOrderRecord,
} from './sellerOrderState';
import type {
  ParsedServiceRefundFinalize,
  ParsedServiceRefundRequest,
} from './serviceRefundProtocol';

export interface ServiceRefundSyncIdentity {
  localMetabotId: number;
  localMetabotSlug: string;
  localGlobalMetaId: string;
}

export interface ServiceRefundSyncResult {
  nextState: RuntimeState;
  applied: {
    buyerRequests: number;
    sellerRequests: number;
    synthesizedSellerOrders: number;
    finalizations: number;
  };
  skipped: number;
  blocked: number;
}

export interface ApplyServiceRefundRequestsInput {
  state: RuntimeState;
  requests: ParsedServiceRefundRequest[];
  identity: ServiceRefundSyncIdentity;
  nowMs: number;
}

export interface ApplyServiceRefundFinalizationsInput {
  state: RuntimeState;
  finalizations: ParsedServiceRefundFinalize[];
  identity: ServiceRefundSyncIdentity;
  nowMs: number;
  verifyFinalize?: (finalize: ParsedServiceRefundFinalize) => boolean | Promise<boolean>;
}

interface UniqueMatch<T> {
  status: 'none' | 'found' | 'ambiguous';
  item: T | null;
}

interface RequestContext {
  pinId: string;
  serviceOrderPinId: string;
  servicePinId: string;
  paymentTxid: string;
  paymentAmount: string;
  paymentAsset: string;
  buyerGlobalMetaId: string;
  sellerGlobalMetaId: string;
  settlementKind: string;
  paymentChain: string;
  reason: string;
  payload: Record<string, unknown>;
}

interface FinalizeContext {
  pinId: string;
  refundRequestPinId: string;
  servicePinId: string;
  paymentTxid: string;
  refundTxid: string;
  paymentAmount: string;
  paymentAsset: string;
  buyerGlobalMetaId: string;
  sellerGlobalMetaId: string;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeLower(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function canonicalAsset(value: unknown): string {
  const asset = normalizeText(value).toUpperCase();
  return asset === 'MVC' ? 'SPACE' : asset;
}

function isZeroAmount(value: unknown): boolean {
  const numeric = Number(normalizeText(value));
  return Number.isFinite(numeric) && numeric === 0;
}

function inferPaymentChain(chain: unknown, asset: unknown): string {
  const explicit = normalizeLower(chain);
  if (explicit) return explicit;
  const currency = canonicalAsset(asset);
  if (currency === 'BTC') return 'btc';
  if (currency === 'DOGE') return 'doge';
  return 'mvc';
}

function inferSettlementKind(payload: Record<string, unknown>, amount: unknown): string {
  const explicit = normalizeLower(payload.settlementKind);
  if (explicit) return explicit;
  return isZeroAmount(amount) ? 'free' : 'native';
}

function requestBlockingReason(request: RequestContext): string | null {
  if (request.settlementKind === 'native' || request.settlementKind === 'free') {
    return null;
  }
  if (isZeroAmount(request.paymentAmount)) {
    return null;
  }
  return 'refund_settlement_unsupported';
}

function emptyCounters(state: RuntimeState): ServiceRefundSyncResult {
  return {
    nextState: state,
    applied: {
      buyerRequests: 0,
      sellerRequests: 0,
      synthesizedSellerOrders: 0,
      finalizations: 0,
    },
    skipped: 0,
    blocked: 0,
  };
}

function toRequestContext(request: ParsedServiceRefundRequest): RequestContext {
  const payload = request.payload as unknown as Record<string, unknown>;
  const paymentAmount = normalizeText(request.payload.paymentAmount);
  const paymentAsset = canonicalAsset(request.payload.paymentAsset);
  return {
    pinId: normalizeText(request.pinId),
    serviceOrderPinId: normalizeText(request.payload.serviceOrderPinId),
    servicePinId: normalizeText(request.payload.servicePinId),
    paymentTxid: normalizeText(request.payload.paymentTxid),
    paymentAmount,
    paymentAsset,
    buyerGlobalMetaId: normalizeText(request.payload.buyerGlobalMetaId),
    sellerGlobalMetaId: normalizeText(request.payload.sellerGlobalMetaId),
    settlementKind: inferSettlementKind(payload, paymentAmount),
    paymentChain: inferPaymentChain(payload.paymentChain, paymentAsset),
    reason: normalizeText(request.payload.reason),
    payload,
  };
}

function toFinalizeContext(finalize: ParsedServiceRefundFinalize): FinalizeContext {
  return {
    pinId: normalizeText(finalize.pinId),
    refundRequestPinId: normalizeText(finalize.payload.refundRequestPinId),
    servicePinId: normalizeText(finalize.payload.servicePinId),
    paymentTxid: normalizeText(finalize.payload.paymentTxid),
    refundTxid: normalizeText(finalize.payload.refundTxid),
    paymentAmount: normalizeText(finalize.payload.paymentAmount),
    paymentAsset: canonicalAsset(finalize.payload.paymentAsset),
    buyerGlobalMetaId: normalizeText(finalize.payload.buyerGlobalMetaId),
    sellerGlobalMetaId: normalizeText(finalize.payload.sellerGlobalMetaId),
  };
}

function uniqueByPriority<T>(
  entries: T[],
  priorities: Array<(entry: T) => boolean>,
): UniqueMatch<T> {
  for (const predicate of priorities) {
    const matches = entries
      .map((item) => ({ item }))
      .filter(({ item }) => predicate(item));
    if (matches.length === 1) {
      return { status: 'found', item: matches[0].item };
    }
    if (matches.length > 1) {
      return { status: 'ambiguous', item: null };
    }
  }
  return { status: 'none', item: null };
}

function traceParties(trace: SessionTraceRecord): { buyer: string; seller: string } {
  return {
    buyer: normalizeText(trace.a2a?.callerGlobalMetaId),
    seller: normalizeText(trace.a2a?.providerGlobalMetaId) || normalizeText(trace.session.peerGlobalMetaId),
  };
}

function traceServicePins(trace: SessionTraceRecord): string[] {
  return [
    normalizeText(trace.order?.serviceId),
    normalizeText(trace.a2a?.servicePinId),
  ].filter(Boolean);
}

function traceOrderPins(trace: SessionTraceRecord): string[] {
  return [
    normalizeText(trace.order?.serviceOrderPinId),
    normalizeText(trace.order?.orderPinId),
    normalizeText(trace.order?.orderReference),
    normalizeText(trace.order?.id),
  ].filter(Boolean);
}

function sellerOrderPins(order: SellerOrderRecord): string[] {
  return [
    normalizeText(order.serviceOrderPinId),
    normalizeText(order.orderPinId),
    normalizeText(order.orderMessageId),
    normalizeText(order.orderReference),
    normalizeText(order.id),
  ].filter(Boolean);
}

function isBuyerOrderTrace(trace: SessionTraceRecord): boolean {
  return Boolean(trace.order) && normalizeLower(trace.order?.role) === 'buyer';
}

function findBuyerTraceForRequest(
  traces: SessionTraceRecord[],
  request: RequestContext,
): UniqueMatch<SessionTraceRecord> {
  return uniqueByPriority(
    traces.filter(isBuyerOrderTrace),
    [
      (trace) => Boolean(request.pinId) && normalizeText(trace.order?.refundRequestPinId) === request.pinId,
      (trace) => Boolean(request.paymentTxid) && normalizeText(trace.order?.paymentTxid) === request.paymentTxid,
      (trace) => Boolean(request.serviceOrderPinId) && traceOrderPins(trace).includes(request.serviceOrderPinId),
      (trace) => {
        if (!request.servicePinId || !traceServicePins(trace).includes(request.servicePinId)) {
          return false;
        }
        const parties = traceParties(trace);
        return Boolean(request.buyerGlobalMetaId)
          && Boolean(request.sellerGlobalMetaId)
          && parties.buyer === request.buyerGlobalMetaId
          && parties.seller === request.sellerGlobalMetaId;
      },
    ],
  );
}

function findSellerOrderForRequest(
  orders: SellerOrderRecord[],
  request: RequestContext,
): UniqueMatch<SellerOrderRecord> {
  return uniqueByPriority(
    orders,
    [
      (order) => Boolean(request.pinId) && normalizeText(order.refundRequestPinId) === request.pinId,
      (order) => Boolean(request.paymentTxid) && normalizeText(order.paymentTxid) === request.paymentTxid,
      (order) => Boolean(request.serviceOrderPinId) && sellerOrderPins(order).includes(request.serviceOrderPinId),
      (order) => {
        const servicePins = [
          normalizeText(order.servicePinId),
          normalizeText(order.currentServicePinId),
        ].filter(Boolean);
        return Boolean(request.servicePinId)
          && servicePins.includes(request.servicePinId)
          && normalizeText(order.buyerGlobalMetaId) === request.buyerGlobalMetaId
          && normalizeText(order.providerGlobalMetaId) === request.sellerGlobalMetaId;
      },
    ],
  );
}

function findBuyerTraceForFinalize(
  traces: SessionTraceRecord[],
  finalize: FinalizeContext,
): UniqueMatch<SessionTraceRecord> {
  return uniqueByPriority(
    traces.filter(isBuyerOrderTrace),
    [
      (trace) => Boolean(finalize.refundRequestPinId) && normalizeText(trace.order?.refundRequestPinId) === finalize.refundRequestPinId,
      (trace) => Boolean(finalize.paymentTxid) && normalizeText(trace.order?.paymentTxid) === finalize.paymentTxid,
      (trace) => {
        if (!finalize.servicePinId || !traceServicePins(trace).includes(finalize.servicePinId)) {
          return false;
        }
        const parties = traceParties(trace);
        return Boolean(finalize.buyerGlobalMetaId)
          && Boolean(finalize.sellerGlobalMetaId)
          && parties.buyer === finalize.buyerGlobalMetaId
          && parties.seller === finalize.sellerGlobalMetaId;
      },
    ],
  );
}

function findSellerOrderForFinalize(
  orders: SellerOrderRecord[],
  finalize: FinalizeContext,
): UniqueMatch<SellerOrderRecord> {
  return uniqueByPriority(
    orders,
    [
      (order) => Boolean(finalize.refundRequestPinId) && normalizeText(order.refundRequestPinId) === finalize.refundRequestPinId,
      (order) => Boolean(finalize.paymentTxid) && normalizeText(order.paymentTxid) === finalize.paymentTxid,
      (order) => {
        const servicePins = [
          normalizeText(order.servicePinId),
          normalizeText(order.currentServicePinId),
        ].filter(Boolean);
        return Boolean(finalize.servicePinId)
          && servicePins.includes(finalize.servicePinId)
          && normalizeText(order.buyerGlobalMetaId) === finalize.buyerGlobalMetaId
          && normalizeText(order.providerGlobalMetaId) === finalize.sellerGlobalMetaId;
      },
    ],
  );
}

function patchBuyerRequestTrace(
  trace: SessionTraceRecord,
  request: RequestContext,
  nowMs: number,
): { trace: SessionTraceRecord; changed: boolean } {
  if (!trace.order) {
    return { trace, changed: false };
  }
  const alreadyApplied = normalizeText(trace.order.refundRequestPinId) === request.pinId;
  const nextStatus = trace.order.status === 'refunded' ? 'refunded' : 'refund_pending';
  const nextOrder = {
    ...trace.order,
    status: nextStatus,
    refundRequestPinId: request.pinId || trace.order.refundRequestPinId,
    refundRequestedAt: trace.order.refundRequestedAt ?? nowMs,
    failureReason: normalizeText(trace.order.failureReason) || request.reason || trace.order.failureReason,
    updatedAt: nowMs,
  };
  return {
    trace: { ...trace, order: nextOrder },
    changed: !alreadyApplied || trace.order.status !== nextStatus,
  };
}

function patchSellerRequestOrder(
  order: SellerOrderRecord,
  request: RequestContext,
  nowMs: number,
): { order: SellerOrderRecord; changed: boolean } {
  const alreadyApplied = normalizeText(order.refundRequestPinId) === request.pinId;
  const blockingReason = requestBlockingReason(request);
  const patch = {
    refundRequestPinId: request.pinId || order.refundRequestPinId,
    failureReason: normalizeText(order.failureReason) || request.reason || order.failureReason,
    paymentCurrency: request.paymentAsset || order.paymentCurrency,
    paymentChain: request.paymentChain || order.paymentChain,
    settlementKind: request.settlementKind || order.settlementKind,
    mrc20Ticker: normalizeText(request.payload.mrc20Ticker) || order.mrc20Ticker,
    mrc20Id: normalizeText(request.payload.mrc20Id) || order.mrc20Id,
    refundBlockingReason: blockingReason,
    latestEvent: 'refund_request_discovered',
    updatedAt: nowMs,
  };

  if (order.state === 'refunded' || order.state === 'ended') {
    return {
      order: createSellerOrderRecord({
        ...order,
        ...patch,
        state: order.state,
        createdAt: order.createdAt,
      }),
      changed: !alreadyApplied,
    };
  }

  const next = transitionSellerOrderRecord(order, {
    ...patch,
    state: 'refund_pending',
    updatedAt: nowMs,
  });
  return {
    order: next,
    changed: !alreadyApplied || order.state !== 'refund_pending',
  };
}

function synthesizeSellerOrder(
  request: RequestContext,
  identity: ServiceRefundSyncIdentity,
  nowMs: number,
): SellerOrderRecord {
  const serviceOrderPinId = request.serviceOrderPinId || request.pinId;
  const servicePinId = request.servicePinId || '';
  return createSellerOrderRecord({
    id: `seller-refund-${request.pinId}`,
    state: 'refund_pending',
    localMetabotId: identity.localMetabotId,
    localMetabotSlug: identity.localMetabotSlug,
    providerGlobalMetaId: request.sellerGlobalMetaId,
    buyerGlobalMetaId: request.buyerGlobalMetaId,
    servicePinId,
    currentServicePinId: servicePinId,
    serviceName: normalizeText(request.payload.serviceName) || 'Unknown service',
    providerSkill: normalizeText(request.payload.providerSkill),
    orderMessageId: serviceOrderPinId,
    orderPinId: serviceOrderPinId,
    orderReference: serviceOrderPinId,
    serviceOrderPinId,
    paymentTxid: request.paymentTxid,
    paymentAmount: request.paymentAmount,
    paymentCurrency: request.paymentAsset,
    paymentChain: request.paymentChain,
    settlementKind: request.settlementKind,
    mrc20Ticker: normalizeText(request.payload.mrc20Ticker),
    mrc20Id: normalizeText(request.payload.mrc20Id),
    traceId: `seller-refund-trace-${request.pinId}`,
    a2aSessionId: `seller-refund-session-${request.pinId}`,
    a2aTaskRunId: `seller-refund-run-${request.pinId}`,
    failureReason: request.reason,
    latestEvent: 'refund_request_discovered',
    refundRequestPinId: request.pinId,
    refundBlockingReason: requestBlockingReason(request),
    createdAt: nowMs,
    updatedAt: nowMs,
  });
}

function canSynthesizeSellerOrder(
  state: RuntimeState,
  request: RequestContext,
  identity: ServiceRefundSyncIdentity,
): boolean {
  return Boolean(request.pinId)
    && Boolean(request.sellerGlobalMetaId)
    && request.sellerGlobalMetaId === normalizeText(identity.localGlobalMetaId)
    && !state.sellerOrders.some((order) => normalizeText(order.refundRequestPinId) === request.pinId);
}

export function applyServiceRefundRequestsToState(
  input: ApplyServiceRefundRequestsInput,
): ServiceRefundSyncResult {
  const result = emptyCounters(input.state);
  let nextState = input.state;

  for (const parsedRequest of input.requests) {
    const request = toRequestContext(parsedRequest);
    if (!request.pinId) {
      result.skipped += 1;
      continue;
    }

    const buyerMatch = findBuyerTraceForRequest(nextState.traces, request);
    if (buyerMatch.status === 'ambiguous') {
      result.skipped += 1;
      continue;
    }

    const sellerMatch = findSellerOrderForRequest(nextState.sellerOrders, request);
    if (sellerMatch.status === 'ambiguous') {
      result.skipped += 1;
      continue;
    }

    if (buyerMatch.status === 'found' && buyerMatch.item) {
      const patched = patchBuyerRequestTrace(buyerMatch.item, request, input.nowMs);
      if (patched.changed) {
        nextState = {
          ...nextState,
          traces: nextState.traces.map((trace) => (
            trace.traceId === buyerMatch.item?.traceId ? patched.trace : trace
          )),
        };
        result.applied.buyerRequests += 1;
      }
    }

    if (sellerMatch.status === 'found' && sellerMatch.item) {
      const patched = patchSellerRequestOrder(sellerMatch.item, request, input.nowMs);
      if (patched.changed) {
        nextState = {
          ...nextState,
          sellerOrders: nextState.sellerOrders.map((order) => (
            order.id === sellerMatch.item?.id ? patched.order : order
          )),
        };
        result.applied.sellerRequests += 1;
      }
      continue;
    }

    if (canSynthesizeSellerOrder(nextState, request, input.identity)) {
      nextState = {
        ...nextState,
        sellerOrders: [
          synthesizeSellerOrder(request, input.identity, input.nowMs),
          ...nextState.sellerOrders,
        ],
      };
      result.applied.synthesizedSellerOrders += 1;
    } else if (buyerMatch.status === 'none') {
      result.skipped += 1;
    }
  }

  return { ...result, nextState };
}

function isNativeOrFree(settlementKind: unknown, amount: unknown): boolean {
  const normalized = normalizeLower(settlementKind);
  return normalized === 'native' || normalized === 'free' || (!normalized && isZeroAmount(amount));
}

function finalizeIsFree(finalize: FinalizeContext, trace?: SessionTraceRecord | null, order?: SellerOrderRecord | null): boolean {
  return isZeroAmount(finalize.paymentAmount)
    || normalizeLower(trace?.order?.settlementKind) === 'free'
    || normalizeLower(order?.settlementKind) === 'free';
}

function rowSettlementKind(trace?: SessionTraceRecord | null, order?: SellerOrderRecord | null): string {
  return normalizeLower(order?.settlementKind) || normalizeLower(trace?.order?.settlementKind) || 'native';
}

function patchBuyerFinalizeTrace(
  trace: SessionTraceRecord,
  finalize: FinalizeContext,
  nowMs: number,
): { trace: SessionTraceRecord; changed: boolean } {
  if (!trace.order) {
    return { trace, changed: false };
  }
  const alreadyApplied = normalizeText(trace.order.refundFinalizePinId) === finalize.pinId
    && trace.order.status === 'refunded';
  return {
    trace: {
      ...trace,
      order: {
        ...trace.order,
        status: 'refunded',
        refundTxid: finalize.refundTxid || trace.order.refundTxid,
        refundFinalizePinId: finalize.pinId || trace.order.refundFinalizePinId,
        refundCompletedAt: trace.order.refundCompletedAt ?? nowMs,
        refundedAt: trace.order.refundedAt ?? nowMs,
        refundBlockingReason: null,
        updatedAt: nowMs,
      },
    },
    changed: !alreadyApplied,
  };
}

function patchSellerFinalizeOrder(
  order: SellerOrderRecord,
  finalize: FinalizeContext,
  nowMs: number,
): { order: SellerOrderRecord; changed: boolean } {
  const alreadyApplied = normalizeText(order.refundFinalizePinId) === finalize.pinId
    && order.state === 'refunded';
  const patch = {
    refundTxid: finalize.refundTxid || order.refundTxid,
    refundFinalizePinId: finalize.pinId || order.refundFinalizePinId,
    refundCompletedAt: order.refundCompletedAt ?? nowMs,
    refundedAt: order.refundedAt ?? nowMs,
    refundBlockingReason: null,
    latestEvent: 'refund_finalized',
    updatedAt: nowMs,
  };
  if (order.state === 'refunded') {
    return {
      order: createSellerOrderRecord({
        ...order,
        ...patch,
        state: 'refunded',
        createdAt: order.createdAt,
      }),
      changed: !alreadyApplied,
    };
  }
  if (order.state === 'ended') {
    return {
      order: transitionSellerOrderRecord(order, {
        ...patch,
        state: 'refunded',
        updatedAt: nowMs,
      }),
      changed: true,
    };
  }
  const pending = order.state === 'refund_pending'
    ? order
    : transitionSellerOrderRecord(order, {
      state: 'refund_pending',
      updatedAt: nowMs,
    });
  return {
    order: transitionSellerOrderRecord(pending, {
      ...patch,
      state: 'refunded',
      updatedAt: nowMs,
    }),
    changed: !alreadyApplied,
  };
}

function blockBuyerFinalizeTrace(
  trace: SessionTraceRecord,
  reason: string,
  nowMs: number,
): SessionTraceRecord {
  if (!trace.order) return trace;
  return {
    ...trace,
    order: {
      ...trace.order,
      status: trace.order.status === 'refunded' ? 'refunded' : 'refund_pending',
      refundBlockingReason: reason,
      updatedAt: nowMs,
    },
  };
}

function blockSellerFinalizeOrder(
  order: SellerOrderRecord,
  reason: string,
  nowMs: number,
): SellerOrderRecord {
  if (order.state === 'refunded' || order.state === 'ended') {
    return createSellerOrderRecord({
      ...order,
      refundBlockingReason: reason,
      updatedAt: nowMs,
    });
  }
  return transitionSellerOrderRecord(order, {
    state: 'refund_pending',
    refundBlockingReason: reason,
    failureReason: normalizeText(order.failureReason) || reason,
    latestEvent: 'refund_finalize_blocked',
    updatedAt: nowMs,
  });
}

async function verifyPaidFinalize(
  finalize: ParsedServiceRefundFinalize,
  input: ApplyServiceRefundFinalizationsInput,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!input.verifyFinalize) {
    return { ok: false, reason: 'refund_finalize_verification_pending' };
  }
  try {
    const ok = await input.verifyFinalize(finalize);
    return ok ? { ok: true } : { ok: false, reason: 'refund_finalize_verification_failed' };
  } catch {
    return { ok: false, reason: 'refund_finalize_verification_failed' };
  }
}

export async function applyServiceRefundFinalizationsToState(
  input: ApplyServiceRefundFinalizationsInput,
): Promise<ServiceRefundSyncResult> {
  const result = emptyCounters(input.state);
  let nextState = input.state;

  for (const parsedFinalize of input.finalizations) {
    const finalize = toFinalizeContext(parsedFinalize);
    if (!finalize.pinId || !finalize.refundRequestPinId) {
      result.skipped += 1;
      continue;
    }

    const buyerMatch = findBuyerTraceForFinalize(nextState.traces, finalize);
    const sellerMatch = findSellerOrderForFinalize(nextState.sellerOrders, finalize);
    if (buyerMatch.status === 'ambiguous' || sellerMatch.status === 'ambiguous') {
      result.skipped += 1;
      continue;
    }
    if (buyerMatch.status === 'none' && sellerMatch.status === 'none') {
      result.skipped += 1;
      continue;
    }

    const matchedTrace = buyerMatch.item;
    const matchedOrder = sellerMatch.item;
    const freeFinalize = finalizeIsFree(finalize, matchedTrace, matchedOrder);
    const settlementKind = rowSettlementKind(matchedTrace, matchedOrder);
    if (!isNativeOrFree(settlementKind, finalize.paymentAmount)) {
      nextState = blockFinalizeMatches({
        state: nextState,
        trace: matchedTrace,
        order: matchedOrder,
        reason: 'refund_settlement_unsupported',
        nowMs: input.nowMs,
      });
      result.blocked += 1;
      continue;
    }
    if (!freeFinalize && !finalize.refundTxid) {
      nextState = blockFinalizeMatches({
        state: nextState,
        trace: matchedTrace,
        order: matchedOrder,
        reason: 'refund_finalize_txid_missing',
        nowMs: input.nowMs,
      });
      result.blocked += 1;
      continue;
    }
    if (!freeFinalize) {
      const verification = await verifyPaidFinalize(parsedFinalize, input);
      if (!verification.ok) {
        nextState = blockFinalizeMatches({
          state: nextState,
          trace: matchedTrace,
          order: matchedOrder,
          reason: verification.reason,
          nowMs: input.nowMs,
        });
        result.blocked += 1;
        continue;
      }
    }

    let changed = false;
    if (matchedTrace) {
      const patched = patchBuyerFinalizeTrace(matchedTrace, finalize, input.nowMs);
      changed = changed || patched.changed;
      nextState = {
        ...nextState,
        traces: nextState.traces.map((trace) => (
          trace.traceId === matchedTrace.traceId ? patched.trace : trace
        )),
      };
    }
    if (matchedOrder) {
      const patched = patchSellerFinalizeOrder(matchedOrder, finalize, input.nowMs);
      changed = changed || patched.changed;
      nextState = {
        ...nextState,
        sellerOrders: nextState.sellerOrders.map((order) => (
          order.id === matchedOrder.id ? patched.order : order
        )),
      };
    }
    if (changed) {
      result.applied.finalizations += 1;
    }
  }

  return { ...result, nextState };
}

function blockFinalizeMatches(input: {
  state: RuntimeState;
  trace: SessionTraceRecord | null;
  order: SellerOrderRecord | null;
  reason: string;
  nowMs: number;
}): RuntimeState {
  let nextState = input.state;
  if (input.trace) {
    nextState = {
      ...nextState,
      traces: nextState.traces.map((trace) => (
        trace.traceId === input.trace?.traceId
          ? blockBuyerFinalizeTrace(trace, input.reason, input.nowMs)
          : trace
      )),
    };
  }
  if (input.order) {
    nextState = {
      ...nextState,
      sellerOrders: nextState.sellerOrders.map((order) => (
        order.id === input.order?.id
          ? blockSellerFinalizeOrder(order, input.reason, input.nowMs)
          : order
      )),
    };
  }
  return nextState;
}
