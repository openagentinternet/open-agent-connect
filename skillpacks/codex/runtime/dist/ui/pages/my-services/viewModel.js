"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMyServicesPageViewModel = buildMyServicesPageViewModel;
exports.buildMyServicesPageViewModelRuntimeSource = buildMyServicesPageViewModelRuntimeSource;
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}
function stripQueryAndFragment(value) {
    return value.split(/[?#]/u)[0] ?? value;
}
function isHttpUrl(value) {
    return /^https?:\/\//iu.test(value);
}
function isLikelyServiceIconPinId(value) {
    return /^[0-9a-f]{64}(?:i\d+)?$/iu.test(value) || /^[A-Za-z0-9._:-]{8,256}$/u.test(value);
}
function extractServiceIconPinReference(value) {
    const raw = normalizeText(value);
    if (!raw || /^(data:|blob:)/iu.test(raw))
        return '';
    if (/^metafile:\/\//iu.test(raw)) {
        const pinId = stripQueryAndFragment(raw.slice('metafile://'.length).trim());
        return isLikelyServiceIconPinId(pinId) ? pinId : '';
    }
    const path = (() => {
        if (isHttpUrl(raw)) {
            try {
                return new URL(raw).pathname;
            }
            catch {
                return '';
            }
        }
        return raw;
    })();
    const prefixes = [
        '/content/',
        '/metafile-indexer/content/',
        '/metafile-indexer/thumbnail/',
        '/metafile-indexer/api/v1/files/content/',
        '/metafile-indexer/api/v1/files/accelerate/content/',
        '/metafile-indexer/api/v1/users/avatar/accelerate/',
    ];
    for (const prefix of prefixes) {
        if (path.toLowerCase().startsWith(prefix.toLowerCase())) {
            const pinId = decodeURIComponent(stripQueryAndFragment(path.slice(prefix.length).trim()));
            return isLikelyServiceIconPinId(pinId) ? pinId : '';
        }
    }
    const bare = stripQueryAndFragment(raw);
    if (!bare.includes('/') && !bare.includes('\\') && isLikelyServiceIconPinId(bare)) {
        return bare;
    }
    return '';
}
function isServiceIconContentReference(value) {
    const raw = normalizeText(value);
    if (!raw)
        return false;
    if (/^metafile:\/\//iu.test(raw))
        return true;
    const path = (() => {
        if (isHttpUrl(raw)) {
            try {
                return new URL(raw).pathname;
            }
            catch {
                return '';
            }
        }
        return raw;
    })();
    return [
        '/content/',
        '/metafile-indexer/content/',
        '/metafile-indexer/thumbnail/',
        '/metafile-indexer/api/v1/files/content/',
        '/metafile-indexer/api/v1/files/accelerate/content/',
        '/metafile-indexer/api/v1/users/avatar/accelerate/',
    ].some((prefix) => path.toLowerCase().startsWith(prefix.toLowerCase()));
}
function formatServiceIconRenderUri(value) {
    const raw = normalizeText(value);
    if (!raw)
        return '';
    if (/^(data:|blob:)/iu.test(raw))
        return raw;
    const pinRef = extractServiceIconPinReference(raw);
    if (pinRef)
        return `/api/file/avatar?ref=${encodeURIComponent(pinRef)}`;
    if (isServiceIconContentReference(raw))
        return '';
    return raw;
}
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function readArray(value) {
    return Array.isArray(value) ? value : [];
}
function formatCount(value) {
    const numeric = normalizeNumber(value);
    return Number.isFinite(numeric) ? String(Math.trunc(numeric)) : '0';
}
function formatTimestamp(value) {
    const raw = normalizeText(value);
    const numeric = Number(value);
    let date = null;
    if (Number.isFinite(numeric) && numeric > 0) {
        date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    }
    else if (raw) {
        const parsed = Date.parse(raw);
        if (Number.isFinite(parsed))
            date = new Date(parsed);
    }
    if (!date || !Number.isFinite(date.getTime()))
        return raw || 'Unknown';
    const pad = (part) => String(part).padStart(2, '0');
    return [
        `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    ].join(' ');
}
function formatPrice(record) {
    const price = normalizeText(record.price);
    const currency = normalizeText(record.currency);
    return [price, currency].filter(Boolean).join(' ') || 'No price';
}
function formatAmount(record) {
    const amount = normalizeText(record.paymentAmount);
    const currency = normalizeText(record.paymentCurrency);
    return [amount, currency].filter(Boolean).join(' ') || 'No payment';
}
function formatServiceInitials(displayName, serviceName) {
    const source = displayName || serviceName || 'Service';
    const words = source.split(/[\s_-]+/u).map((part) => part.trim()).filter(Boolean);
    const initials = words.length > 1
        ? `${words[0][0] ?? ''}${words[1][0] ?? ''}`
        : source.slice(0, 2);
    return initials.toUpperCase() || 'SV';
}
function formatRating(record) {
    const ratingAvg = normalizeNumber(record.ratingAvg);
    const ratingCount = normalizeNumber(record.ratingCount);
    if (!ratingCount || !ratingAvg)
        return 'No rating';
    const rounded = Number.isInteger(ratingAvg) ? String(ratingAvg) : ratingAvg.toFixed(1).replace(/\.0$/u, '');
    return `${rounded} / 5 · ${Math.trunc(ratingCount)}`;
}
function formatStatusLabel(value) {
    switch (normalizeText(value)) {
        case 'completed':
            return 'Completed';
        case 'refunded':
            return 'Refunded';
        default:
            return normalizeText(value) || 'Unknown';
    }
}
function formatOrderTime(record) {
    const status = normalizeText(record.status);
    const timestamp = status === 'refunded'
        ? record.refundCompletedAt || record.createdAt
        : record.deliveredAt || record.createdAt;
    return formatTimestamp(timestamp);
}
function formatOrderRating(record) {
    const rating = readObject(record.rating);
    const rate = normalizeNumber(rating.rate);
    if (!rate) {
        return { label: 'No rating', comment: '', pinId: '' };
    }
    return {
        label: `${Number.isInteger(rate) ? String(rate) : rate.toFixed(1)} / 5`,
        comment: normalizeText(rating.comment),
        pinId: normalizeText(rating.pinId),
    };
}
function formatPageLabel(page, noun) {
    const currentPage = Math.max(1, Math.trunc(normalizeNumber(page.page) || 1));
    const totalPages = Math.max(1, Math.trunc(normalizeNumber(page.totalPages) || 1));
    const total = Math.max(0, Math.trunc(normalizeNumber(page.total)));
    return `${currentPage} / ${totalPages} · ${total} ${noun}`;
}
function buildPagination(page) {
    const currentPage = Math.max(1, Math.trunc(normalizeNumber(page.page) || 1));
    const pageSize = Math.max(1, Math.trunc(normalizeNumber(page.pageSize) || 1));
    const total = Math.max(0, Math.trunc(normalizeNumber(page.total)));
    const totalPages = Math.max(1, Math.trunc(normalizeNumber(page.totalPages) || 1));
    return {
        page: currentPage,
        pageSize,
        total,
        totalPages,
        canPrevious: currentPage > 1,
        canNext: total > 0 && currentPage < totalPages,
    };
}
function buildServiceEntry(entry) {
    const record = readObject(entry);
    const currentPinId = normalizeText(record.currentPinId) || normalizeText(record.id);
    if (!currentPinId)
        return null;
    const displayName = normalizeText(record.displayName) || normalizeText(record.serviceName) || 'Service';
    const serviceName = normalizeText(record.serviceName) || 'unknown-service';
    const currency = normalizeText(record.currency);
    const creatorName = normalizeText(record.creatorMetabotName);
    const creatorSlug = normalizeText(record.creatorMetabotSlug);
    const priceLabel = formatPrice(record);
    return {
        key: currentPinId,
        id: normalizeText(record.id) || currentPinId,
        currentPinId,
        sourceServicePinId: normalizeText(record.sourceServicePinId) || currentPinId,
        title: displayName,
        serviceName,
        description: normalizeText(record.description),
        iconUri: formatServiceIconRenderUri(record.serviceIcon),
        iconLabel: formatServiceInitials(displayName, serviceName),
        skillLabel: normalizeText(record.providerSkill) || 'Unbound skill',
        outputTypeLabel: normalizeText(record.outputType) || 'text',
        priceLabel,
        creatorLabel: [creatorName, creatorSlug].filter(Boolean).join(' · ') || 'Unknown MetaBot',
        updatedAtLabel: formatTimestamp(record.updatedAt),
        metrics: [
            { label: 'Success', value: formatCount(record.successCount) },
            { label: 'Refunded', value: formatCount(record.refundCount) },
            { label: 'Gross', value: [normalizeText(record.grossRevenue) || '0', currency].filter(Boolean).join(' ') },
            { label: 'Net', value: [normalizeText(record.netIncome) || '0', currency].filter(Boolean).join(' ') },
            { label: 'Rating', value: formatRating(record) },
        ],
        canModify: record.canModify === true,
        canRevoke: record.canRevoke === true,
        blockedReason: normalizeText(record.blockedReason),
    };
}
function buildOrderEntry(entry) {
    const record = readObject(entry);
    const id = normalizeText(record.id);
    if (!id)
        return null;
    const paymentTxid = normalizeText(record.paymentTxid);
    const orderTxid = normalizeText(record.orderMessageTxid);
    const traceId = normalizeText(record.traceId);
    const sessionId = normalizeText(record.coworkSessionId);
    const rating = formatOrderRating(record);
    const runtimeLabel = [
        normalizeText(record.runtimeProvider),
        normalizeText(record.runtimeId),
        normalizeText(record.llmSessionId),
    ].filter(Boolean).join(' · ') || 'Runtime unavailable';
    return {
        key: id,
        statusLabel: formatStatusLabel(record.status),
        buyerLabel: normalizeText(record.counterpartyName) || normalizeText(record.counterpartyGlobalMetaid) || 'Unknown buyer',
        paymentLabel: [formatAmount(record), paymentTxid].filter(Boolean).join(' · '),
        paymentTxid,
        orderTxid,
        servicePinId: normalizeText(record.servicePinId),
        timeLabel: formatOrderTime(record),
        ratingLabel: rating.label,
        ratingComment: rating.comment,
        ratingPinId: rating.pinId,
        traceHref: traceId ? `/ui/trace?traceId=${encodeURIComponent(traceId)}` : '/ui/trace',
        traceLabel: traceId || 'Trace unavailable',
        sessionHref: sessionId ? `/ui/trace?sessionId=${encodeURIComponent(sessionId)}` : '',
        sessionLabel: sessionId || 'No session',
        runtimeLabel,
    };
}
function buildEditForm(selected, rawSelected) {
    if (!selected || !rawSelected)
        return null;
    return {
        serviceId: selected.currentPinId,
        displayName: selected.title,
        serviceName: selected.serviceName,
        description: selected.description,
        providerSkill: normalizeText(rawSelected.providerSkill),
        outputType: normalizeText(rawSelected.outputType) || 'text',
        price: normalizeText(rawSelected.price),
        currency: normalizeText(rawSelected.currency) || 'BTC',
        serviceIconUri: normalizeText(rawSelected.serviceIcon),
        serviceIconPreviewUri: formatServiceIconRenderUri(rawSelected.serviceIcon),
    };
}
function buildNotice(input) {
    const error = readObject(input.error);
    const errorMessage = normalizeText(error.message);
    if (errorMessage) {
        return {
            tone: 'error',
            title: 'My Services error',
            message: errorMessage,
            txids: [],
            pinId: '',
        };
    }
    const result = readObject(input.mutationResult);
    const txids = readArray(result.txids).map((entry) => normalizeText(entry)).filter(Boolean);
    const operation = normalizeText(result.operation);
    if (!operation && txids.length === 0 && !normalizeText(result.pinId)) {
        return null;
    }
    const operationLabel = operation === 'revoke'
        ? 'Revoke'
        : operation === 'modify'
            ? 'Modify'
            : 'Service';
    const warning = normalizeText(result.warning);
    if (warning) {
        return {
            tone: 'warning',
            title: `${operationLabel} warning`,
            message: warning,
            txids,
            pinId: normalizeText(result.pinId),
        };
    }
    return {
        tone: 'success',
        title: `${operationLabel} broadcast`,
        message: 'Local state has been updated after the chain write.',
        txids,
        pinId: normalizeText(result.pinId),
    };
}
function buildMyServicesPageViewModel(input) {
    const servicesPage = readObject(input.servicesPage);
    const rawServices = readArray(servicesPage.items);
    const services = rawServices
        .map((entry) => buildServiceEntry(entry))
        .filter((entry) => Boolean(entry));
    const selectedServiceId = normalizeText(input.selectedServiceId);
    const selectedIndex = selectedServiceId
        ? services.findIndex((service) => service.currentPinId === selectedServiceId || service.sourceServicePinId === selectedServiceId || service.id === selectedServiceId)
        : -1;
    const selectedService = selectedIndex >= 0 ? services[selectedIndex] : services[0] ?? null;
    const rawSelected = selectedIndex >= 0
        ? readObject(rawServices[selectedIndex])
        : selectedService
            ? readObject(rawServices[0])
            : null;
    const ordersPage = readObject(input.ordersPage);
    const orders = readArray(ordersPage.items)
        .map((entry) => buildOrderEntry(entry))
        .filter((entry) => Boolean(entry));
    return {
        services,
        selectedService,
        orders,
        editForm: buildEditForm(selectedService, rawSelected),
        notice: buildNotice({
            mutationResult: input.mutationResult ?? null,
            error: input.error ?? null,
        }),
        pageLabel: formatPageLabel(servicesPage, 'services'),
        orderPageLabel: formatPageLabel(ordersPage, 'orders'),
        pagination: buildPagination(servicesPage),
        orderPagination: buildPagination(ordersPage),
        emptyState: {
            title: 'No published services',
            message: 'Local MetaBot profiles have no active skill services yet.',
        },
        orderEmptyState: {
            title: 'No closed orders',
            message: 'Completed and refunded seller orders for this service will appear here.',
        },
        currencyOptions: ['BTC', 'SPACE', 'DOGE', 'BTC-OPCAT'],
        outputTypeOptions: ['text', 'image', 'video', 'audio', 'other'],
    };
}
function buildMyServicesPageViewModelRuntimeSource() {
    return [
        normalizeText,
        normalizeNumber,
        stripQueryAndFragment,
        isHttpUrl,
        isLikelyServiceIconPinId,
        extractServiceIconPinReference,
        isServiceIconContentReference,
        formatServiceIconRenderUri,
        readObject,
        readArray,
        formatCount,
        formatTimestamp,
        formatPrice,
        formatAmount,
        formatServiceInitials,
        formatRating,
        formatStatusLabel,
        formatOrderTime,
        formatOrderRating,
        formatPageLabel,
        buildPagination,
        buildServiceEntry,
        buildOrderEntry,
        buildEditForm,
        buildNotice,
        buildMyServicesPageViewModel,
    ].map((fn) => fn.toString()).join('\n\n');
}
