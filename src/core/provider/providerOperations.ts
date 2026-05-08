import type { RuntimeState } from '../state/runtimeStateStore';
import type { SellerOrderRecord } from '../orders/sellerOrderState';

export interface SellerOrderSelector {
  orderId?: string | null;
  paymentTxid?: string | null;
}

export interface ProviderSellerOrderInspection {
  orderId: string;
  service: {
    name: string | null;
    servicePinId: string | null;
    currentServicePinId: string | null;
    providerSkill: string | null;
  };
  buyer: {
    globalMetaId: string | null;
    name: string | null;
  };
  status: {
    state: string | null;
    publicStatus: string | null;
    latestEvent: string | null;
    failureReason: string | null;
  };
  trace: {
    id: string | null;
    href: string | null;
  };
  payment: {
    txid: string | null;
    commitTxid: string | null;
    amount: string | null;
    currency: string | null;
    chain: string | null;
    settlementKind: string | null;
  };
  runtime: {
    runtimeId: string | null;
    provider: string | null;
    sessionId: string | null;
    fallbackSelected: boolean | null;
    a2aSessionId: string | null;
    a2aTaskRunId: string | null;
  };
  refund: {
    refundRequestPinId: string | null;
    refundRequestTxid: string | null;
    refundTxid: string | null;
    refundFinalizePinId: string | null;
    blockingReason: string | null;
    refundedAt: number | null;
    completedAt: number | null;
    manualActionRequired: boolean;
  };
  timestamps: {
    createdAt: number | null;
    updatedAt: number | null;
    receivedAt: number | null;
    acknowledgedAt: number | null;
    startedAt: number | null;
    deliveredAt: number | null;
    ratingRequestedAt: number | null;
  };
}

export interface SellerReceivedRefundItem {
  orderId: string;
  role: 'seller';
  serviceName: string;
  paymentTxid: string | null;
  paymentAmount: string | null;
  paymentCurrency: string | null;
  status: 'failed' | 'refund_pending' | 'refunded';
  failureReason: string | null;
  refundRequestPinId: string | null;
  refundRequestTxid: string | null;
  refundTxid: string | null;
  refundFinalizePinId: string | null;
  blockingReason: string | null;
  refundRequestedAt: number | null;
  refundCompletedAt: number | null;
  counterpartyGlobalMetaId: string | null;
  counterpartyName: string | null;
  traceId: string | null;
  traceHref: string | null;
  runtimeSessionId: string | null;
  manualActionRequired: boolean;
  createdAt: number;
  updatedAt: number;
}

function normalizeText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function isZeroAmount(value: unknown): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  const numeric = Number(text);
  return Number.isFinite(numeric) && numeric === 0;
}

export function sellerOrderRequiresManualAction(order: SellerOrderRecord): boolean {
  const state = normalizeText(order.state);
  if (state === 'refund_pending' && normalizeText(order.refundRequestPinId)) {
    return true;
  }
  if (
    state === 'failed'
    && normalizeText(order.paymentTxid)
    && !isZeroAmount(order.paymentAmount)
  ) {
    return true;
  }
  return false;
}

export function findSellerOrdersBySelector(
  state: RuntimeState,
  selector: SellerOrderSelector
): SellerOrderRecord[] {
  const orderId = normalizeText(selector.orderId);
  const paymentTxid = normalizeText(selector.paymentTxid);
  if (!orderId && !paymentTxid) {
    return [];
  }
  return state.sellerOrders.filter((order) => {
    if (orderId) {
      return normalizeText(order.id) === orderId;
    }
    return normalizeText(order.paymentTxid) === paymentTxid;
  });
}

export function findSellerOrderBySelector(
  state: RuntimeState,
  selector: SellerOrderSelector
): {
  status: 'missing_selector' | 'ambiguous_selector' | 'not_found' | 'ambiguous' | 'found';
  order: SellerOrderRecord | null;
  matches: SellerOrderRecord[];
} {
  const orderId = normalizeText(selector.orderId);
  const paymentTxid = normalizeText(selector.paymentTxid);
  if (!orderId && !paymentTxid) {
    return { status: 'missing_selector', order: null, matches: [] };
  }
  if (orderId && paymentTxid) {
    return { status: 'ambiguous_selector', order: null, matches: [] };
  }
  const matches = findSellerOrdersBySelector(state, { orderId, paymentTxid });
  if (matches.length === 0) {
    return { status: 'not_found', order: null, matches };
  }
  if (matches.length > 1) {
    return { status: 'ambiguous', order: null, matches };
  }
  return { status: 'found', order: matches[0], matches };
}

export function buildProviderSellerOrderInspection(order: SellerOrderRecord): ProviderSellerOrderInspection {
  const traceId = normalizeText(order.traceId);
  return {
    orderId: normalizeText(order.id),
    service: {
      name: normalizeText(order.serviceName) || null,
      servicePinId: normalizeText(order.servicePinId) || null,
      currentServicePinId: normalizeText(order.currentServicePinId) || null,
      providerSkill: normalizeText(order.providerSkill) || null,
    },
    buyer: {
      globalMetaId: normalizeText(order.buyerGlobalMetaId) || null,
      name: null,
    },
    status: {
      state: normalizeText(order.state) || null,
      publicStatus: normalizeText(order.publicStatus) || null,
      latestEvent: normalizeText(order.latestEvent) || null,
      failureReason: normalizeText(order.failureReason) || null,
    },
    trace: {
      id: traceId || null,
      href: traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : null,
    },
    payment: {
      txid: normalizeText(order.paymentTxid) || null,
      commitTxid: normalizeText(order.paymentCommitTxid) || null,
      amount: normalizeText(order.paymentAmount) || null,
      currency: normalizeText(order.paymentCurrency) || null,
      chain: normalizeText(order.paymentChain) || null,
      settlementKind: normalizeText(order.settlementKind) || null,
    },
    runtime: {
      runtimeId: normalizeText(order.runtimeId) || null,
      provider: normalizeText(order.runtimeProvider) || null,
      sessionId: normalizeText(order.llmSessionId) || null,
      fallbackSelected: typeof order.fallbackSelected === 'boolean' ? order.fallbackSelected : null,
      a2aSessionId: normalizeText(order.a2aSessionId) || null,
      a2aTaskRunId: normalizeText(order.a2aTaskRunId) || null,
    },
    refund: {
      refundRequestPinId: normalizeText(order.refundRequestPinId) || null,
      refundRequestTxid: normalizeText(order.refundRequestTxid) || null,
      refundTxid: normalizeText(order.refundTxid) || null,
      refundFinalizePinId: normalizeText(order.refundFinalizePinId) || null,
      blockingReason: normalizeText(order.refundBlockingReason) || null,
      refundedAt: normalizeNumber(order.refundedAt),
      completedAt: normalizeNumber(order.refundCompletedAt),
      manualActionRequired: sellerOrderRequiresManualAction(order),
    },
    timestamps: {
      createdAt: normalizeNumber(order.createdAt),
      updatedAt: normalizeNumber(order.updatedAt),
      receivedAt: normalizeNumber(order.receivedAt),
      acknowledgedAt: normalizeNumber(order.acknowledgedAt),
      startedAt: normalizeNumber(order.startedAt),
      deliveredAt: normalizeNumber(order.deliveredAt),
      ratingRequestedAt: normalizeNumber(order.ratingRequestedAt),
    },
  };
}

export function buildSellerReceivedRefundItems(state: RuntimeState): SellerReceivedRefundItem[] {
  return state.sellerOrders
    .map((order) => {
      const status = normalizeText(order.state);
      if (status !== 'failed' && status !== 'refund_pending' && status !== 'refunded') {
        return null;
      }
      if (
        status === 'failed'
        && !normalizeText(order.refundRequestPinId)
        && !normalizeText(order.refundBlockingReason)
        && !sellerOrderRequiresManualAction(order)
      ) {
        return null;
      }
      const traceId = normalizeText(order.traceId);
      const createdAt = normalizeNumber(order.createdAt) ?? 0;
      const refundCompletedAt = normalizeNumber(order.refundCompletedAt) ?? normalizeNumber(order.refundedAt);
      const updatedAt = normalizeNumber(order.updatedAt)
        ?? refundCompletedAt
        ?? createdAt;
      const item: SellerReceivedRefundItem = {
        orderId: normalizeText(order.id),
        role: 'seller',
        serviceName: normalizeText(order.serviceName) || 'Unknown service',
        paymentTxid: normalizeText(order.paymentTxid) || null,
        paymentAmount: normalizeText(order.paymentAmount) || null,
        paymentCurrency: normalizeText(order.paymentCurrency) || null,
        status: status as SellerReceivedRefundItem['status'],
        failureReason: normalizeText(order.failureReason) || null,
        refundRequestPinId: normalizeText(order.refundRequestPinId) || null,
        refundRequestTxid: normalizeText(order.refundRequestTxid) || null,
        refundTxid: normalizeText(order.refundTxid) || null,
        refundFinalizePinId: normalizeText(order.refundFinalizePinId) || null,
        blockingReason: normalizeText(order.refundBlockingReason) || null,
        refundRequestedAt: null,
        refundCompletedAt,
        counterpartyGlobalMetaId: normalizeText(order.buyerGlobalMetaId) || null,
        counterpartyName: null,
        traceId: traceId || null,
        traceHref: traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : null,
        runtimeSessionId: normalizeText(order.llmSessionId) || null,
        manualActionRequired: sellerOrderRequiresManualAction(order),
        createdAt,
        updatedAt,
      };
      return item;
    })
    .filter((entry): entry is SellerReceivedRefundItem => Boolean(entry))
    .sort((left, right) => {
      const leftRank = left.status === 'refunded' ? 1 : 0;
      const rightRank = right.status === 'refunded' ? 1 : 0;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }
      const delta = right.updatedAt - left.updatedAt;
      if (delta !== 0) {
        return delta;
      }
      return left.orderId.localeCompare(right.orderId);
    });
}
