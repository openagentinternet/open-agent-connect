"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildProductCommercePageViewModel = buildProductCommercePageViewModel;
exports.buildProductCommercePageViewModelRuntimeSource = buildProductCommercePageViewModelRuntimeSource;
function readObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : {};
}
function readArray(value) {
    return Array.isArray(value) ? value : [];
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeInteger(value) {
    if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)) {
        return value;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && Number.isInteger(parsed) ? parsed : null;
}
function formatPrice(amount, currency) {
    const normalizedAmount = normalizeText(amount);
    const normalizedCurrency = normalizeText(currency).toUpperCase();
    return [normalizedAmount, normalizedCurrency].filter(Boolean).join(' ') || 'No price';
}
function formatTimestamp(value) {
    const numeric = Number(value);
    let date = null;
    if (Number.isFinite(numeric) && numeric > 0) {
        date = new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
    }
    else {
        const raw = normalizeText(value);
        if (raw) {
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed)) {
                date = new Date(parsed);
            }
        }
    }
    if (!date || !Number.isFinite(date.getTime())) {
        return '';
    }
    const pad = (part) => String(part).padStart(2, '0');
    return [
        `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
        `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    ].join(' ');
}
function formatOrderStateLabel(state) {
    switch (normalizeText(state)) {
        case 'created':
            return 'Created';
        case 'payment_pending':
            return 'Payment pending';
        case 'paid':
            return 'Paid';
        case 'notified':
            return 'Notified';
        case 'accepted':
            return 'Accepted';
        case 'fulfilling':
            return 'Fulfilling';
        case 'delivered':
            return 'Delivered';
        case 'failed':
            return 'Failed';
        case 'closed':
            return 'Closed';
        default:
            return 'Unknown';
    }
}
function formatBooleanLabel(value) {
    if (value === true)
        return 'Yes';
    if (value === false)
        return 'No';
    return 'Unknown';
}
function formatDeliverySummaryLabel(value) {
    const delivery = readObject(value);
    return normalizeText(delivery.label)
        || normalizeText(delivery.summary)
        || normalizeText(delivery.status)
        || normalizeText(delivery.deliveryPinId)
        || 'No delivery summary';
}
function isMetafileUri(value) {
    const normalized = normalizeText(value);
    return normalized.startsWith('metafile://') && normalized.length > 'metafile://'.length;
}
function extractMetafileRef(value) {
    const normalized = normalizeText(value);
    if (!isMetafileUri(normalized)) {
        return '';
    }
    return normalized
        .slice('metafile://'.length)
        .split(/[?#]/u)[0]
        .trim();
}
function normalizeMetafileUri(value) {
    return isMetafileUri(value) ? normalizeText(value) : '';
}
function mediaPreviewUriFromMetafileUri(value) {
    const ref = extractMetafileRef(value);
    return ref ? `/api/file/avatar?ref=${encodeURIComponent(ref)}` : '';
}
function isMetafilePayloadUri(value) {
    return isMetafileUri(value);
}
function isSupportedDescriptionContentType(value) {
    const normalized = normalizeText(value);
    return normalized === 'text/markdown' || normalized === 'text/html';
}
function isPositiveDecimalString(value) {
    const normalized = normalizeText(value);
    if (!normalized || /^\s/u.test(normalized) || /\s$/u.test(normalized))
        return false;
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(normalized))
        return false;
    return /[1-9]/u.test(normalized.replace('.', ''));
}
function validateProductListingPayload(input) {
    if (!isRecord(input)) {
        return { ok: false, message: 'Product listing payload must be an object.' };
    }
    if (!normalizeText(input.name)) {
        return { ok: false, message: 'name must be a non-empty string.' };
    }
    if (!normalizeText(input.title)) {
        return { ok: false, message: 'title must be a non-empty string.' };
    }
    if (!['virtual', 'physical'].includes(normalizeText(input.productType))) {
        return { ok: false, message: 'productType must be virtual or physical.' };
    }
    if (!isMetafilePayloadUri(input.coverImage)) {
        return { ok: false, message: 'coverImage must be a metafile URI.' };
    }
    if (input.galleryImages !== undefined &&
        (!Array.isArray(input.galleryImages) || input.galleryImages.some((uri) => !isMetafilePayloadUri(uri)))) {
        return { ok: false, message: 'galleryImages must contain only metafile URIs.' };
    }
    if (!isSupportedDescriptionContentType(input.descriptionContentType)) {
        return { ok: false, message: 'descriptionContentType must be text/markdown or text/html.' };
    }
    if (!normalizeText(input.description)) {
        return { ok: false, message: 'description must be a non-empty string.' };
    }
    if (!isRecord(input.fulfillment)) {
        return { ok: false, message: 'fulfillment must be an object.' };
    }
    if (!['digital_delivery', 'physical_shipping'].includes(normalizeText(input.fulfillment.fulfillmentType))) {
        return { ok: false, message: 'fulfillment.fulfillmentType must be digital_delivery or physical_shipping.' };
    }
    if (!['simplemsg', 'logistics'].includes(normalizeText(input.fulfillment.deliveryEndpoint))) {
        return { ok: false, message: 'fulfillment.deliveryEndpoint must be simplemsg or logistics.' };
    }
    if (!Array.isArray(input.fulfillment.fulfillmentSkills) || input.fulfillment.fulfillmentSkills.length === 0) {
        return { ok: false, message: 'fulfillment.fulfillmentSkills must contain at least one skill name.' };
    }
    if (input.fulfillment.fulfillmentSkills.some((skill) => typeof skill !== 'string' || skill.length === 0 || skill.trim() !== skill)) {
        return { ok: false, message: 'fulfillmentSkills must be non-empty strings.' };
    }
    if (!Array.isArray(input.skus) || input.skus.length === 0) {
        return { ok: false, message: 'skus must contain at least one SKU.' };
    }
    const skuIds = new Set();
    const skus = [];
    for (const item of input.skus) {
        if (!isRecord(item)) {
            return { ok: false, message: 'SKU must be an object.' };
        }
        const skuItem = item;
        const skuId = normalizeText(skuItem.skuId);
        const skuName = normalizeText(skuItem.name);
        const skuImage = skuItem.image;
        const skuDescriptionContentType = skuItem.descriptionContentType;
        const skuDescription = skuItem.description;
        const skuPrice = skuItem.price;
        if (!skuId || !skuName) {
            return { ok: false, message: 'SKU requires skuId and name.' };
        }
        if (!isMetafilePayloadUri(skuImage)) {
            return { ok: false, message: 'SKU image must be a metafile URI.' };
        }
        if (!isSupportedDescriptionContentType(skuDescriptionContentType)) {
            return { ok: false, message: 'SKU descriptionContentType must be text/markdown or text/html.' };
        }
        if (!normalizeText(skuDescription)) {
            return { ok: false, message: 'SKU description must be a non-empty string.' };
        }
        if (!isRecord(skuPrice) || !isPositiveDecimalString(skuPrice.amount) || !normalizeText(skuPrice.currency)) {
            return { ok: false, message: 'SKU price must have positive amount and currency.' };
        }
        const initialStock = normalizeInteger(skuItem.initialStock);
        if (initialStock === null || initialStock <= 0) {
            return { ok: false, message: 'SKU initialStock must be a positive integer.' };
        }
        if (skuIds.has(skuId)) {
            return { ok: false, message: 'SKU IDs must be unique within a listing.' };
        }
        skuIds.add(skuId);
        skus.push({
            skuId,
            name: skuName,
            image: skuImage,
            descriptionContentType: skuDescriptionContentType,
            description: skuDescription,
            price: {
                amount: normalizeText(skuPrice.amount),
                currency: normalizeText(skuPrice.currency).toUpperCase(),
            },
            initialStock,
        });
    }
    const payload = {
        name: normalizeText(input.name),
        title: normalizeText(input.title),
        productType: normalizeText(input.productType),
        coverImage: normalizeText(input.coverImage),
        descriptionContentType: normalizeText(input.descriptionContentType),
        description: normalizeText(input.description),
        fulfillment: {
            fulfillmentType: normalizeText(input.fulfillment.fulfillmentType),
            deliveryEndpoint: normalizeText(input.fulfillment.deliveryEndpoint),
            fulfillmentSkills: [...input.fulfillment.fulfillmentSkills],
        },
        skus,
    };
    if (Array.isArray(input.galleryImages) && input.galleryImages.length > 0) {
        payload.galleryImages = input.galleryImages.map((uri) => normalizeText(uri));
    }
    if (input.fulfillment.estimatedDeliverySeconds !== undefined) {
        payload.fulfillment.estimatedDeliverySeconds = normalizeInteger(input.fulfillment.estimatedDeliverySeconds) ?? undefined;
    }
    if (normalizeText(input.fulfillment.deliverableDescription)) {
        payload.fulfillment.deliverableDescription = normalizeText(input.fulfillment.deliverableDescription);
    }
    return { ok: true, value: payload };
}
function readSkillCatalog(input) {
    const skills = readArray(input).map((skill) => normalizeText(skill)).filter(Boolean);
    return [...new Set(skills)];
}
function assertPositiveIntegerStock(value) {
    const normalized = normalizeInteger(value);
    if (normalized === null || normalized <= 0) {
        throw new Error('SKU initialStock must be a positive integer.');
    }
    return normalized;
}
function readListingFormSkus(form) {
    if (Array.isArray(form.skus)) {
        return form.skus;
    }
    return [{
            skuId: form.skuId,
            name: form.skuName,
            image: form.skuImage,
            descriptionContentType: form.skuDescriptionContentType,
            description: form.skuDescription,
            price: {
                amount: form.priceAmount,
                currency: form.priceCurrency,
            },
            initialStock: form.initialStock,
        }];
}
function assertKnownFulfillmentSkills(selectedSkills, catalog) {
    const skills = readArray(selectedSkills).map((skill) => normalizeText(skill)).filter(Boolean);
    if (skills.length === 0) {
        throw new Error('fulfillmentSkills must contain at least one skill name.');
    }
    const unknownSkill = skills.find((skill) => catalog.length > 0 && !catalog.includes(skill));
    if (unknownSkill) {
        throw new Error(`Unknown fulfillment skill: ${unknownSkill}`);
    }
    return [...new Set(skills)];
}
function buildProductSkuViewModel(sku) {
    const row = readObject(sku);
    const price = readObject(row.price);
    return {
        skuId: normalizeText(row.skuId),
        name: normalizeText(row.name),
        priceLabel: formatPrice(price.amount, price.currency),
        stockLabel: normalizeInteger(row.initialStock) !== null ? String(normalizeInteger(row.initialStock)) : '',
        imagePreviewUri: mediaPreviewUriFromMetafileUri(row.image),
        descriptionLabel: normalizeText(row.description),
    };
}
function buildProductDirectoryRowViewModel(product) {
    const row = readObject(product);
    const listing = readObject(row.listing);
    const skus = readArray(row.skus || listing.skus);
    const firstSku = skus.length > 0 ? readObject(skus[0]) : {};
    const productType = normalizeText(row.productType || listing.productType);
    const fulfillment = readObject(row.fulfillment || listing.fulfillment);
    const fulfillmentType = normalizeText(fulfillment.fulfillmentType);
    const deliveryEndpoint = normalizeText(fulfillment.deliveryEndpoint);
    const canPurchase = row.online === true
        && productType === 'virtual'
        && fulfillmentType === 'digital_delivery'
        && deliveryEndpoint === 'simplemsg';
    const blockedReason = canPurchase
        ? ''
        : productType !== 'virtual'
            ? 'Physical products are not supported in Product V1.'
            : fulfillmentType !== 'digital_delivery'
                ? 'Only digital delivery products are supported in Product V1.'
                : deliveryEndpoint !== 'simplemsg'
                    ? 'Only simplemsg fulfillment endpoints are supported in Product V1.'
                    : 'Product seller is offline or unavailable.';
    return {
        listingPinId: normalizeText(row.listingPinId),
        title: normalizeText(row.title || listing.title),
        sellerLabel: normalizeText(row.sellerName || row.sellerLabel || row.providerName) || 'Unknown seller',
        onlineStateLabel: row.online === true ? 'Online' : 'Offline',
        skuCountLabel: `${skus.length || Number(row.skuCount) || 0} SKU${(skus.length || Number(row.skuCount) || 0) === 1 ? '' : 's'}`,
        firstPriceLabel: formatPrice(readObject(firstSku.price).amount, readObject(firstSku.price).currency),
        coverPreviewUri: mediaPreviewUriFromMetafileUri(listing.coverImage || row.coverImage),
        canPurchase,
        blockedReason,
    };
}
function buildProductOrderRowViewModel(order) {
    const row = readObject(order);
    const buyer = readObject(row.buyer);
    const seller = readObject(row.seller);
    return {
        orderId: normalizeText(row.orderId || row.id || row.productOrderPinId),
        productOrderPinId: normalizeText(row.productOrderPinId),
        listingPinId: normalizeText(row.listingPinId),
        skuId: normalizeText(row.skuId),
        roleLabel: normalizeText(row.role) === 'seller' ? 'Seller' : 'Buyer',
        stateLabel: formatOrderStateLabel(row.state),
        paymentTxid: normalizeText(row.paymentTxid),
        orderTxid: normalizeText(row.orderTxid),
        deliveryLabel: formatDeliverySummaryLabel(row.delivery),
        buyerLabel: normalizeText(buyer.name || buyer.globalMetaId || row.buyerMetaId),
        sellerLabel: normalizeText(seller.name || seller.globalMetaId || row.sellerMetaId),
        createdAtLabel: formatTimestamp(row.createdAt),
        updatedAtLabel: formatTimestamp(row.updatedAt),
    };
}
function buildOwnedListingViewModel(listing) {
    const row = readObject(listing);
    const payload = readObject(row.payload);
    const fulfillment = readObject(payload.fulfillment);
    const skills = readArray(row.fulfillmentSkills || fulfillment.fulfillmentSkills)
        .map((skill) => normalizeText(skill))
        .filter(Boolean);
    const skuCount = normalizeInteger(row.skuCount) ?? readArray(payload.skus).length;
    return {
        listingPinId: normalizeText(row.listingPinId),
        title: normalizeText(row.title || payload.title || row.name || payload.name),
        skuCountLabel: `${skuCount} SKU${skuCount === 1 ? '' : 's'}`,
        fulfillmentSkillsLabel: skills.join(', ') || 'No fulfillment skills',
        stateLabel: row.available === false || normalizeText(row.revokedAt) ? 'Revoked' : 'Available',
    };
}
function buildOrderInspectViewModel(detail) {
    const source = readObject(detail);
    if (!Object.keys(source).length) {
        return null;
    }
    const order = readObject(source.order);
    const sku = readObject(source.sku);
    const payment = readObject(source.payment);
    const fulfillment = readObject(source.fulfillment);
    const trace = readObject(source.trace);
    const delivery = readObject(source.delivery);
    const skills = readArray(fulfillment.fulfillmentSkills).map((skill) => normalizeText(skill)).filter(Boolean);
    const price = readObject(sku.price);
    const selectedSkuLabel = [
        normalizeText(sku.name),
        normalizeText(sku.skuId || order.skuId),
        formatPrice(price.amount, price.currency),
    ].filter(Boolean).join(' | ');
    return {
        orderId: normalizeText(order.orderId),
        productOrderPinId: normalizeText(order.productOrderPinId),
        listingPinId: normalizeText(order.listingPinId),
        skuId: normalizeText(order.skuId),
        roleLabel: normalizeText(order.role) === 'seller' ? 'Seller' : 'Buyer',
        stateLabel: formatOrderStateLabel(order.state),
        paymentVerificationLabel: formatBooleanLabel(payment.verified),
        paymentTxid: normalizeText(payment.paymentTxid || order.paymentTxid),
        fulfillmentSkillsLabel: skills.join(', ') || 'No fulfillment skills',
        selectedSkuLabel: selectedSkuLabel || normalizeText(order.skuId),
        traceLabel: normalizeText(trace.traceId),
        sessionLabel: normalizeText(trace.sessionId),
        traceUrl: normalizeText(trace.localUiUrl),
        deliveryPinId: normalizeText(delivery.deliveryPinId),
        deliverySummaryLabel: formatDeliverySummaryLabel(delivery.summary),
        failureReason: normalizeText(fulfillment.failureReason),
    };
}
function buildProductListingPreviewPayload(form, skillCatalog) {
    if (!normalizeText(form.name)) {
        throw new Error('name must be a non-empty string.');
    }
    if (!normalizeText(form.title)) {
        throw new Error('title must be a non-empty string.');
    }
    if (!isSupportedDescriptionContentType(form.descriptionContentType)) {
        throw new Error('descriptionContentType must be text/markdown or text/html.');
    }
    if (!normalizeText(form.description)) {
        throw new Error('description must be a non-empty string.');
    }
    const coverImage = normalizeMetafileUri(form.coverImage);
    if (!coverImage) {
        throw new Error('coverImage must be a metafile URI.');
    }
    const galleryImages = readArray(form.galleryImages);
    const normalizedGalleryImages = galleryImages.map((uri) => normalizeMetafileUri(uri)).filter(Boolean);
    if (galleryImages.length > 0 && normalizedGalleryImages.length !== galleryImages.length) {
        throw new Error('galleryImages must contain only metafile URIs.');
    }
    const selectedSkills = assertKnownFulfillmentSkills(form.fulfillmentSkills, skillCatalog);
    const formSkus = readListingFormSkus(form);
    if (formSkus.length === 0) {
        throw new Error('skus must contain at least one SKU.');
    }
    const skus = formSkus.map((item) => {
        const sku = readObject(item);
        const price = readObject(sku.price);
        const skuImage = normalizeMetafileUri(sku.image);
        if (!skuImage) {
            throw new Error('SKU image must be a metafile URI.');
        }
        return {
            skuId: normalizeText(sku.skuId),
            name: normalizeText(sku.name),
            image: skuImage,
            descriptionContentType: normalizeText(sku.descriptionContentType),
            description: normalizeText(sku.description),
            price: {
                amount: normalizeText(price.amount),
                currency: normalizeText(price.currency).toUpperCase(),
            },
            initialStock: assertPositiveIntegerStock(sku.initialStock),
        };
    });
    const payload = {
        name: normalizeText(form.name),
        title: normalizeText(form.title),
        productType: 'virtual',
        coverImage,
        descriptionContentType: normalizeText(form.descriptionContentType),
        description: normalizeText(form.description),
        fulfillment: {
            fulfillmentType: 'digital_delivery',
            deliveryEndpoint: 'simplemsg',
            fulfillmentSkills: selectedSkills,
        },
        skus,
    };
    if (normalizedGalleryImages.length > 0) {
        payload.galleryImages = normalizedGalleryImages;
    }
    const estimatedDeliverySeconds = normalizeInteger(form.estimatedDeliverySeconds);
    if (estimatedDeliverySeconds !== null) {
        payload.fulfillment.estimatedDeliverySeconds = estimatedDeliverySeconds;
    }
    const deliverableDescription = normalizeText(form.deliverableDescription);
    if (deliverableDescription) {
        payload.fulfillment.deliverableDescription = deliverableDescription;
    }
    const validation = validateProductListingPayload(payload);
    if (!validation.ok) {
        throw new Error(validation.message);
    }
    return validation.value;
}
function buildProductPurchasePreviewRequest(selection, selectedSku) {
    const listingPinId = normalizeText(selection.listingPinId);
    const skuId = normalizeText(selection.skuId);
    const spendCap = normalizeText(selection.spendCap);
    if (!listingPinId || !skuId || !spendCap) {
        throw new Error('listingPinId, skuId, and spendCap are required for a purchase preview.');
    }
    const comment = normalizeText(selection.comment);
    return {
        confirmed: false,
        listingPinId,
        skuId,
        spendCap: {
            amount: spendCap,
            currency: normalizeText(readObject(readObject(selectedSku).price).currency).toUpperCase() || 'SPACE',
        },
        policyMode: 'confirm_paid_only',
        ...(comment ? { comment } : {}),
    };
}
function buildProductCommercePageViewModel(input) {
    const skillCatalog = readSkillCatalog(input.skillCatalog);
    const products = readArray(input.products);
    const productRows = products.map(buildProductDirectoryRowViewModel);
    const selectedListing = readObject(input.selectedListing);
    const selectedSkuSource = readObject(input.selectedSku);
    const selectedProductRow = selectedListing.listingPinId
        ? productRows.find((row) => row.listingPinId === normalizeText(selectedListing.listingPinId)) ?? null
        : productRows[0] ?? null;
    const selectedSkuRows = readArray(selectedListing.skus || selectedSkuSource.skus).map(buildProductSkuViewModel);
    const selectedSkuForPurchase = readArray(selectedListing.skus || selectedSkuSource.skus)
        .find((sku) => normalizeText(readObject(sku).skuId) === normalizeText(input.purchaseSelection?.skuId))
        ?? readArray(selectedListing.skus || selectedSkuSource.skus)[0];
    const purchasePreviewRequest = input.purchaseSelection
        ? buildProductPurchasePreviewRequest(input.purchaseSelection, selectedSkuForPurchase)
        : null;
    const listingPreviewPayload = input.listingForm
        ? buildProductListingPreviewPayload(input.listingForm, skillCatalog)
        : null;
    const ownedListingRows = readArray(input.ownedListings).map(buildOwnedListingViewModel);
    const orderRows = readArray(input.orderRows).map(buildProductOrderRowViewModel);
    const orderInspect = input.orderInspect ? buildOrderInspectViewModel(input.orderInspect) : null;
    return {
        productRows,
        selectedProductRow,
        selectedSkuRows,
        purchasePreviewRequest,
        listingPreviewPayload,
        ownedListingRows,
        orderRows,
        orderInspect,
        fulfillmentLabel: skillCatalog.length > 0
            ? `All fulfillment skills available: ${skillCatalog.join(', ')}`
            : 'No fulfillment skills loaded',
    };
}
function buildProductCommercePageViewModelRuntimeSource() {
    return [
        readObject,
        readArray,
        isRecord,
        normalizeText,
        normalizeInteger,
        formatPrice,
        formatTimestamp,
        formatOrderStateLabel,
        formatBooleanLabel,
        formatDeliverySummaryLabel,
        isMetafileUri,
        extractMetafileRef,
        normalizeMetafileUri,
        mediaPreviewUriFromMetafileUri,
        isMetafilePayloadUri,
        isSupportedDescriptionContentType,
        isPositiveDecimalString,
        validateProductListingPayload,
        readSkillCatalog,
        assertPositiveIntegerStock,
        readListingFormSkus,
        assertKnownFulfillmentSkills,
        buildProductSkuViewModel,
        buildProductDirectoryRowViewModel,
        buildProductOrderRowViewModel,
        buildOwnedListingViewModel,
        buildOrderInspectViewModel,
        buildProductListingPreviewPayload,
        buildProductPurchasePreviewRequest,
        buildProductCommercePageViewModel,
    ].map((fn) => fn.toString()).join('\n\n');
}
