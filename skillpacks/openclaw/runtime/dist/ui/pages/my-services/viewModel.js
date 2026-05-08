"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMyServicesPageViewModel = buildMyServicesPageViewModel;
exports.buildMyServicesPageViewModelRuntimeSource = buildMyServicesPageViewModelRuntimeSource;
function normalizeText(value) {
    if (typeof value === 'string') {
        return value.trim();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
    }
    return '';
}
function readObject(value) {
    return value && typeof value === 'object' ? value : {};
}
function pushRow(rows, label, value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return;
    }
    rows.push({ label, value: normalized });
}
function formatRatingStateLabel(record) {
    const ratingStatus = normalizeText(record.ratingStatus);
    const ratingValue = normalizeText(record.ratingValue);
    if (ratingStatus === 'rated_on_chain_followup_unconfirmed') {
        return ratingValue ? `已评价 · ${ratingValue}/5 · 回传未确认` : '已评价 · 回传未确认';
    }
    if (ratingStatus === 'rated_on_chain') {
        return ratingValue ? `已评价 · ${ratingValue}/5` : '已评价';
    }
    if (ratingStatus === 'sync_error') {
        return '评分同步异常';
    }
    return '未评价';
}
function formatLifecycleStateLabel(record) {
    switch (normalizeText(record.state)) {
        case 'received':
            return 'Received';
        case 'acknowledged':
            return 'Acknowledged';
        case 'in_progress':
            return 'In progress';
        case 'completed':
            return 'Completed';
        case 'rating_pending':
            return 'Rating pending';
        case 'failed':
            return 'Failed';
        case 'refund_pending':
            return 'Refund pending';
        case 'refunded':
            return 'Refunded';
        case 'ended':
            return 'Ended';
        default:
            return '';
    }
}
function formatOrderStateLabel(record) {
    const lifecycle = formatLifecycleStateLabel(record);
    const rating = formatRatingStateLabel(record);
    return [lifecycle, rating].filter(Boolean).join(' · ') || rating;
}
function formatPaymentLabel(record) {
    const amount = normalizeText(record.paymentAmount);
    const currency = normalizeText(record.paymentCurrency);
    const paymentTxid = normalizeText(record.paymentTxid);
    const amountLabel = [amount, currency].filter(Boolean).join(' ');
    return [amountLabel, paymentTxid].filter(Boolean).join(' · ') || '—';
}
function formatRuntimeLabel(record) {
    const runtimeProvider = normalizeText(record.runtimeProvider);
    const runtimeId = normalizeText(record.runtimeId);
    const llmSessionId = normalizeText(record.llmSessionId);
    const fallbackSelected = record.fallbackSelected === true ? 'fallback selected' : '';
    return [runtimeProvider, runtimeId, llmSessionId, fallbackSelected].filter(Boolean).join(' · ')
        || 'Runtime unavailable';
}
function buildMyServicesPageViewModel(input) {
    const providerSummary = readObject(input.providerSummary);
    const identity = readObject(providerSummary.identity);
    const presence = readObject(providerSummary.presence);
    const totals = readObject(providerSummary.totals);
    const serviceInventory = Array.isArray(providerSummary.services)
        ? providerSummary.services
            .map((entry) => {
            const record = readObject(entry);
            const servicePinId = normalizeText(record.servicePinId);
            const displayName = normalizeText(record.displayName) || normalizeText(record.serviceName) || 'Unnamed service';
            const serviceName = normalizeText(record.serviceName) || 'unknown-service';
            return {
                key: servicePinId || displayName,
                displayName,
                serviceName,
                availabilityLabel: record.available === true ? 'Available' : 'Offline',
                priceLabel: [
                    normalizeText(record.price),
                    normalizeText(record.currency),
                ].filter(Boolean).join(' ') || 'Unknown price',
                servicePinId: servicePinId || 'No chain pin yet',
                lastPublishAt: normalizeText(record.updatedAt) || 'Unknown',
            };
        })
            .filter((entry) => Boolean(entry.key))
        : [];
    const manualActionKeys = new Set(Array.isArray(providerSummary.manualActions)
        ? providerSummary.manualActions.map((entry) => normalizeText(readObject(entry).orderId)).filter(Boolean)
        : []);
    const recentOrders = Array.isArray(providerSummary.recentOrders)
        ? providerSummary.recentOrders
            .map((entry) => {
            const record = readObject(entry);
            const orderId = normalizeText(record.orderId);
            const traceId = normalizeText(record.traceId);
            const buyerName = normalizeText(record.buyerName);
            const buyerGlobalMetaId = normalizeText(record.buyerGlobalMetaId);
            return {
                key: orderId || traceId,
                serviceName: normalizeText(record.serviceName) || 'Unknown service',
                buyerLabel: [buyerName, buyerGlobalMetaId].filter(Boolean).join(' · ') || 'Unknown buyer',
                stateLabel: formatOrderStateLabel(record),
                statusDetail: normalizeText(record.publicStatus) || 'unknown',
                traceHref: traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '/ui/trace',
                traceLabel: traceId || 'Trace unavailable',
                paymentLabel: formatPaymentLabel(record),
                runtimeLabel: formatRuntimeLabel(record),
                refundRequestPinId: normalizeText(record.refundRequestPinId),
                refundTxid: normalizeText(record.refundTxid),
                refundFinalizePinId: normalizeText(record.refundFinalizePinId),
                refundBlockingReason: normalizeText(record.refundBlockingReason),
                createdAt: normalizeText(record.createdAt) || 'Unknown',
                requiresManualRefund: manualActionKeys.has(orderId),
                ratingCommentPreview: normalizeText(record.ratingComment),
                ratingPinId: normalizeText(record.ratingPinId),
            };
        })
            .filter((entry) => Boolean(entry.key))
        : [];
    const manualActions = Array.isArray(providerSummary.manualActions)
        ? providerSummary.manualActions
            .map((entry) => {
            const record = readObject(entry);
            const orderId = normalizeText(record.orderId);
            const traceId = normalizeText(record.traceId);
            return {
                key: orderId || traceId,
                kindLabel: normalizeText(record.kind) === 'refund' ? 'Refund confirmation' : 'Manual action',
                orderId: orderId || 'Unknown order',
                refundRequestPinId: normalizeText(record.refundRequestPinId) || 'Missing refund request pin',
                refundHref: orderId ? `/ui/refund?orderId=${encodeURIComponent(orderId)}` : '/ui/refund',
                traceHref: traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '/ui/trace',
            };
        })
            .filter((entry) => Boolean(entry.key))
        : [];
    const presenceRows = [];
    pushRow(presenceRows, 'Provider', identity.name);
    pushRow(presenceRows, 'GlobalMetaId', identity.globalMetaId);
    pushRow(presenceRows, 'Last Heartbeat', presence.lastHeartbeatAt);
    pushRow(presenceRows, 'Heartbeat Pin', presence.lastHeartbeatPinId);
    const serviceCount = normalizeText(totals.serviceCount);
    const activeServiceCount = normalizeText(totals.activeServiceCount);
    if (serviceCount || activeServiceCount) {
        presenceRows.push({
            label: 'Active Services',
            value: `${activeServiceCount || '0'} / ${serviceCount || '0'}`,
        });
    }
    return {
        presenceCard: {
            title: 'Provider Presence',
            statusLabel: presence.enabled === true ? 'Online' : 'Offline',
            actionLabel: presence.enabled === true ? 'Go offline' : 'Go online',
            rows: presenceRows,
        },
        serviceInventory,
        recentOrders,
        manualActions,
    };
}
function buildMyServicesPageViewModelRuntimeSource() {
    return [
        normalizeText,
        readObject,
        pushRow,
        formatRatingStateLabel,
        formatLifecycleStateLabel,
        formatOrderStateLabel,
        formatPaymentLabel,
        formatRuntimeLabel,
        buildMyServicesPageViewModel,
    ].map((fn) => fn.toString()).join('\n\n');
}
