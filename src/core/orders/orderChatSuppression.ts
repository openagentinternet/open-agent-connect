import type { A2ASessionStateStore } from '../a2a/sessionStateStore';
import type { A2ASessionRecord } from '../a2a/sessionTypes';
import type { SessionTraceRecord } from '../chat/sessionTrace';
import type { RuntimeStateStore } from '../state/runtimeStateStore';
import type { SellerOrderRecord, SellerOrderState } from './sellerOrderState';

// IDBots hasActiveOrderForPrivateChatSuppression parity
// (IDBots src/main/serviceOrderStore.ts): while an order with a peer is being
// negotiated/executed, the free-chat auto-reply stays silent so it cannot
// chime in between order-protocol messages and confuse the order flow. The
// suppression lifts on its own once every order with the peer reaches a
// terminal state.

// IDBots' active set ('awaiting_first_response', 'in_progress',
// 'rating_pending', 'refund_pending') mapped onto the OAC seller state
// machine: 'received'/'acknowledged' cover awaiting_first_response.
// 'completed', 'failed', and 'refunded' are not active (IDBots treats
// completed/refunded as settled and the failed-awaiting-refund branch is
// buyer-role only).
const SELLER_ORDER_STATES_ACTIVE_FOR_CHAT_SUPPRESSION: ReadonlySet<SellerOrderState> = new Set([
  'received',
  'acknowledged',
  'in_progress',
  'rating_pending',
  'refund_pending',
]);

// Caller sessions still waiting on the provider; matches the trace UI's
// ACTIVE_STATES. completed/remote_failed/timeout are terminal.
const CALLER_SESSION_STATES_WAITING_FOR_CHAT_SUPPRESSION: ReadonlySet<A2ASessionRecord['state']> = new Set([
  'requesting_remote',
  'remote_received',
  'remote_executing',
]);

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function isSellerOrderActiveForChatSuppression(
  order: Pick<SellerOrderRecord, 'state'>,
): boolean {
  return SELLER_ORDER_STATES_ACTIVE_FOR_CHAT_SUPPRESSION.has(order.state);
}

// IDBots buyer-role branch: refund_pending is still active, and a failed
// buyer order stays active until its refund is on the way (refund request
// pin, refund txid, or a refund completion timestamp).
export function isBuyerTraceOrderActiveForChatSuppression(
  order: NonNullable<SessionTraceRecord['order']>,
): boolean {
  const status = normalizeText(order.status);
  if (status === 'refund_pending') {
    return true;
  }
  if (status !== 'failed') {
    return false;
  }
  return !normalizeText(order.refundRequestPinId)
    && !normalizeText(order.refundTxid)
    && !order.refundCompletedAt;
}

// Builds the hasActiveOrderWithPeer dependency for the private-chat
// auto-reply orchestrator. Best effort: unreadable stores must not break
// chat replies, so read failures simply do not suppress.
export function createHasActiveOrderWithPeer(input: {
  runtimeStateStore: RuntimeStateStore;
  sessionStateStore: A2ASessionStateStore;
}): (peerGlobalMetaId: string) => Promise<boolean> {
  return async (peerGlobalMetaId) => {
    const peer = normalizeText(peerGlobalMetaId);
    if (!peer) {
      return false;
    }
    const [runtimeState, sessionState] = await Promise.all([
      input.runtimeStateStore.readState().catch(() => null),
      input.sessionStateStore.readState().catch(() => null),
    ]);

    // Seller side: an open order with this buyer.
    if (runtimeState?.sellerOrders.some((order) => (
      normalizeText(order.buyerGlobalMetaId) === peer
      && isSellerOrderActiveForChatSuppression(order)
    ))) {
      return true;
    }

    const traces = runtimeState?.traces ?? [];
    const findTrace = (traceId: string): SessionTraceRecord | null => (
      traces.find((entry) => entry.traceId === traceId) ?? null
    );

    // Buyer side: a caller session still waiting on this provider. Settled
    // orders and recorded deliveries do not count (runBuyerOrderDeadlineSweep
    // parity); the refund wait below re-covers them while they stay active.
    for (const session of sessionState?.sessions ?? []) {
      if (session.role !== 'caller') {
        continue;
      }
      if (normalizeText(session.providerGlobalMetaId) !== peer) {
        continue;
      }
      if (!CALLER_SESSION_STATES_WAITING_FOR_CHAT_SUPPRESSION.has(session.state)) {
        continue;
      }
      const trace = findTrace(session.traceId);
      if (trace) {
        const orderStatus = normalizeText(trace.order?.status);
        const orderSettled = orderStatus === 'failed'
          || orderStatus === 'refund_pending'
          || orderStatus === 'refunded'
          || Boolean(normalizeText(trace.order?.refundRequestPinId));
        const deliveryRecorded = normalizeText(trace.a2a?.publicStatus) === 'completed'
          || normalizeText(trace.a2a?.taskRunState) === 'completed';
        if (orderSettled || deliveryRecorded) {
          continue;
        }
      }
      return true;
    }

    // Buyer side: the refund of an order with this provider is still pending.
    return traces.some((trace) => {
      const order = trace.order;
      if (!order || normalizeText(order.role) !== 'buyer') {
        return false;
      }
      const orderProvider = normalizeText(trace.a2a?.providerGlobalMetaId)
        || normalizeText(trace.session.peerGlobalMetaId);
      if (orderProvider !== peer) {
        return false;
      }
      return isBuyerTraceOrderActiveForChatSuppression(order);
    });
  };
}
