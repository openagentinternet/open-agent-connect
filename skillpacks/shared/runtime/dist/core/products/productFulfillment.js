"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createProductServicePaymentVerifier = createProductServicePaymentVerifier;
exports.resolveProductOrderForSeller = resolveProductOrderForSeller;
exports.fulfillProductOrderForSeller = fulfillProductOrderForSeller;
const orderProtocol_1 = require("../a2a/protocol/orderProtocol");
const servicePaymentVerification_1 = require("../payments/servicePaymentVerification");
const productPublishChain_1 = require("./productPublishChain");
const productValidation_1 = require("./productValidation");
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized || null;
}
function normalizeOrderTxid(value) {
    const normalized = normalizeText(value).toLowerCase();
    return /^[0-9a-f]{64}$/u.test(normalized) ? normalized : null;
}
function normalizeNullableNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}
function now(input) {
    return input?.now ? input.now() : Date.now();
}
function failure(code, message, data) {
    return {
        ok: false,
        code,
        message,
        ...(data ? { data } : {}),
    };
}
function readPinId(pin, fallback = '') {
    return normalizeText(pin.pinId ?? pin.id ?? pin.pinID) || fallback;
}
function readPinCreatorGlobalMetaId(pin) {
    return normalizeNullableText(pin.creatorGlobalMetaId
        ?? pin.createGlobalMetaId
        ?? pin.globalMetaId
        ?? pin.createMetaId);
}
function readPinCreatorAddress(pin) {
    return normalizeNullableText(pin.createAddress ?? pin.creatorAddress ?? pin.mvcAddress);
}
function readPinTimestamp(pin) {
    return normalizeNullableNumber(pin.timestamp ?? pin.updatedAt);
}
function pinMetadata(input) {
    return {
        pinId: input.pinId,
        path: input.path,
        creatorGlobalMetaId: normalizeNullableText(input.creatorGlobalMetaId),
        creatorAddress: normalizeNullableText(input.creatorAddress),
        timestamp: input.timestamp ?? null,
    };
}
function chainPinMetadata(pin, pinId, path) {
    return pinMetadata({
        pinId,
        path,
        creatorGlobalMetaId: readPinCreatorGlobalMetaId(pin),
        creatorAddress: readPinCreatorAddress(pin),
        timestamp: readPinTimestamp(pin),
    });
}
function parseContentPayload(value) {
    if (typeof value !== 'string') {
        return value;
    }
    try {
        return JSON.parse(value);
    }
    catch {
        return value;
    }
}
function readChainPayload(pin) {
    if (pin.payload !== undefined)
        return parseContentPayload(pin.payload);
    if (pin.contentSummary !== undefined)
        return parseContentPayload(pin.contentSummary);
    return parseContentPayload(pin.content);
}
function validateOrderPin(pin, productOrderPinId) {
    if (!pin) {
        return failure('product_order_not_found', `Product-order pin was not found: ${productOrderPinId}`);
    }
    if (normalizeText(pin.path) !== productPublishChain_1.PRODUCT_ORDER_PROTOCOL_PATH) {
        return failure('invalid_product_order_protocol', 'Product-order pin did not use the product-order protocol path.');
    }
    const validation = (0, productValidation_1.validateProductOrderPayload)(readChainPayload(pin));
    if (!validation.ok) {
        return failure('invalid_product_order_protocol', validation.message, { validationCode: validation.code });
    }
    const pinId = readPinId(pin, productOrderPinId);
    return {
        ok: true,
        pinId,
        pin: chainPinMetadata(pin, pinId, productPublishChain_1.PRODUCT_ORDER_PROTOCOL_PATH),
        payload: validation.value,
        buyerGlobalMetaId: readPinCreatorGlobalMetaId(pin),
    };
}
function validateListingPin(pin, listingPinId) {
    if (!pin) {
        return failure('product_listing_not_found', `Product listing pin was not found: ${listingPinId}`);
    }
    if (normalizeText(pin.path) !== productPublishChain_1.PRODUCT_LISTING_PROTOCOL_PATH) {
        return failure('invalid_product_listing_protocol', 'Product listing pin did not use the product-listing protocol path.');
    }
    const validation = (0, productValidation_1.validateProductListingPayload)(readChainPayload(pin));
    if (!validation.ok) {
        return failure('invalid_product_listing_protocol', validation.message, { validationCode: validation.code });
    }
    const pinId = readPinId(pin, listingPinId);
    return {
        ok: true,
        pinId,
        pin: chainPinMetadata(pin, pinId, productPublishChain_1.PRODUCT_LISTING_PROTOCOL_PATH),
        payload: validation.value,
        sellerGlobalMetaId: readPinCreatorGlobalMetaId(pin),
        sellerMvcAddress: readPinCreatorAddress(pin),
    };
}
function readCachedOrderPayload(record) {
    const cachedPayload = record.productOrderPayload;
    const validation = (0, productValidation_1.validateProductOrderPayload)(cachedPayload);
    if (validation.ok) {
        return validation.value;
    }
    const payload = {
        listingPinId: record.listingPinId,
        skuId: record.skuId,
        settlementKind: 'native',
        paymentTxid: record.paymentTxid,
    };
    return (0, productValidation_1.validateProductOrderPayload)(payload).ok ? payload : payload;
}
function readCachedListing(input) {
    const lookup = input.lookup;
    if (!lookup)
        return null;
    const payload = lookup.item.payload;
    const sellerGlobalMetaId = lookup.source === 'directoryCache'
        ? lookup.item.sellerGlobalMetaId
        : null;
    const sellerMvcAddress = lookup.source === 'directoryCache'
        ? lookup.item.sellerMvcAddress
        : null;
    return {
        source: 'cache',
        pinId: lookup.item.listingPinId,
        pin: pinMetadata({
            pinId: lookup.item.listingPinId,
            path: productPublishChain_1.PRODUCT_LISTING_PROTOCOL_PATH,
            creatorGlobalMetaId: sellerGlobalMetaId,
            creatorAddress: sellerMvcAddress,
        }),
        payload,
        sellerGlobalMetaId,
        sellerMvcAddress,
        record: lookup.item,
    };
}
function sellerOwnsListing(input) {
    if (input.listing.record && 'localMetabotSlug' in input.listing.record) {
        return true;
    }
    const localGlobalMetaId = normalizeText(input.localSeller.globalMetaId);
    const listingGlobalMetaId = normalizeText(input.listing.sellerGlobalMetaId);
    if (localGlobalMetaId && listingGlobalMetaId) {
        return localGlobalMetaId === listingGlobalMetaId;
    }
    const localMvcAddress = normalizeText(input.localSeller.addresses?.mvc) || normalizeText(input.localSeller.mvcAddress);
    const listingMvcAddress = normalizeText(input.listing.sellerMvcAddress);
    return Boolean(localMvcAddress && listingMvcAddress && localMvcAddress === listingMvcAddress);
}
function resolvePaymentChain(currency) {
    return normalizeText(currency).toUpperCase() === 'BTC' ? 'btc' : 'mvc';
}
function resolveSellerPaymentAddress(input) {
    if (input.paymentChain === 'btc') {
        return normalizeText(input.seller.addresses?.btc);
    }
    return normalizeText(input.seller.addresses?.mvc) || normalizeText(input.seller.mvcAddress);
}
function isSupportedV1Fulfillment(payload) {
    return payload.productType === 'virtual' &&
        payload.fulfillment.fulfillmentType === 'digital_delivery' &&
        payload.fulfillment.deliveryEndpoint === 'simplemsg';
}
function sellerOrderSuccessFromRecord(input) {
    const deliveryPinId = normalizeNullableText(input.record.deliverySummary?.deliveryPinId ?? input.record.deliveryPinId);
    return {
        ok: true,
        duplicate: input.duplicate,
        delivered: input.delivered,
        pending: input.pending,
        data: {
            productOrderPinId: input.resolved.order.pinId,
            listingPinId: input.resolved.order.payload.listingPinId,
            skuId: input.resolved.order.payload.skuId,
            paymentTxid: input.resolved.order.payload.paymentTxid,
            orderTxid: normalizeNullableText(input.record.orderTxid) || input.orderTxid,
            result: normalizeText(input.record.deliverySummary?.result),
            deliveryPinId: input.pending ? null : deliveryPinId,
            ratingMessagePinId: null,
            fulfillmentState: input.pending ? 'fulfilling' : 'delivered',
        },
    };
}
function sellerOrderDuplicatePendingSuccess(input) {
    return sellerOrderSuccessFromRecord({
        record: input.record,
        resolved: input.resolved,
        orderTxid: input.record.orderTxid || '',
        duplicate: true,
        delivered: false,
        pending: true,
    });
}
function runnerExecute(runner, input) {
    return typeof runner === 'function' ? runner(input) : runner.execute(input);
}
async function persistSellerOrder(input) {
    await input.store.upsertSellerOrder({
        productOrderPinId: input.resolved.order.pinId,
        listingPinId: input.resolved.order.payload.listingPinId,
        skuId: input.resolved.order.payload.skuId,
        paymentTxid: input.resolved.order.payload.paymentTxid,
        orderTxid: input.orderTxid,
        buyerGlobalMetaId: input.buyerGlobalMetaId,
        fulfillmentSkills: input.fulfillmentSkills,
        paymentVerified: input.paymentVerified,
        selectedSku: input.resolved.selectedSku,
        fulfillmentState: input.fulfillmentState,
        deliveryPinId: input.deliveryPinId ?? null,
        deliverySummary: input.deliverySummary ?? null,
        failureReason: input.failureReason ?? null,
        state: input.state,
        localUpdatedAt: input.now,
        productOrderPayload: input.resolved.order.payload,
    });
}
function createProductServicePaymentVerifier(input) {
    return (paymentInput) => (0, servicePaymentVerification_1.verifyServiceOrderPayment)({
        adapters: input.adapters,
        paymentTxid: paymentInput.paymentTxid,
        paymentChain: paymentInput.paymentChain,
        settlementKind: paymentInput.settlementKind,
        paymentAddress: paymentInput.paymentAddress,
        amount: paymentInput.amount,
        currency: paymentInput.currency,
    });
}
async function resolveProductOrderForSeller(input) {
    const productOrderPinId = normalizeText(input.productOrderPinId);
    const orderTxid = normalizeNullableText(input.orderTxid);
    const buyerGlobalMetaId = normalizeNullableText(input.buyer?.globalMetaId);
    const cachedOrderLookup = await input.productStateStore.findSellerOrderByProductOrderPinId(productOrderPinId);
    let order;
    if (cachedOrderLookup?.source === 'sellerOrders') {
        order = {
            source: 'cache',
            pinId: cachedOrderLookup.item.productOrderPinId,
            pin: pinMetadata({
                pinId: cachedOrderLookup.item.productOrderPinId,
                path: productPublishChain_1.PRODUCT_ORDER_PROTOCOL_PATH,
                creatorGlobalMetaId: normalizeNullableText(cachedOrderLookup.item.buyerGlobalMetaId) || buyerGlobalMetaId,
            }),
            payload: readCachedOrderPayload(cachedOrderLookup.item),
            buyerGlobalMetaId: normalizeNullableText(cachedOrderLookup.item.buyerGlobalMetaId) || buyerGlobalMetaId,
            orderTxid: normalizeNullableText(cachedOrderLookup.item.orderTxid) || orderTxid,
            record: cachedOrderLookup.item,
        };
    }
    else {
        const chainOrder = validateOrderPin(await input.chainFetcher.fetchProductOrderPin(productOrderPinId), productOrderPinId);
        if (!chainOrder.ok) {
            return chainOrder;
        }
        order = {
            source: 'chain',
            pinId: chainOrder.pinId,
            pin: chainOrder.pin,
            payload: chainOrder.payload,
            buyerGlobalMetaId: chainOrder.buyerGlobalMetaId || buyerGlobalMetaId,
            orderTxid,
            record: await input.productStateStore.upsertSellerOrder({
                productOrderPinId: chainOrder.pinId,
                listingPinId: chainOrder.payload.listingPinId,
                skuId: chainOrder.payload.skuId,
                paymentTxid: chainOrder.payload.paymentTxid,
                orderTxid,
                buyerGlobalMetaId: chainOrder.buyerGlobalMetaId || buyerGlobalMetaId,
                state: 'created',
                fulfillmentState: 'created',
                paymentVerified: null,
                fulfillmentSkills: [],
                productOrderPayload: chainOrder.payload,
                localUpdatedAt: now(input),
            }),
        };
    }
    let listing = readCachedListing({
        lookup: await input.productStateStore.findListingByPinId(order.payload.listingPinId),
    });
    if (!listing) {
        const chainListing = validateListingPin(await input.chainFetcher.fetchProductListingPin(order.payload.listingPinId), order.payload.listingPinId);
        if (!chainListing.ok) {
            return chainListing;
        }
        listing = {
            source: 'chain',
            pinId: chainListing.pinId,
            pin: chainListing.pin,
            payload: chainListing.payload,
            sellerGlobalMetaId: chainListing.sellerGlobalMetaId,
            sellerMvcAddress: chainListing.sellerMvcAddress,
            record: null,
        };
        if (sellerOwnsListing({ listing, localSeller: input.localSeller })) {
            await input.productStateStore.upsertOwnedListing({
                listingPinId: chainListing.pinId,
                payload: chainListing.payload,
                available: true,
                localUpdatedAt: now(input),
            });
        }
        else {
            await input.productStateStore.upsertDirectoryItem({
                listingPinId: chainListing.pinId,
                payload: chainListing.payload,
                sellerGlobalMetaId: chainListing.sellerGlobalMetaId,
                sellerMvcAddress: chainListing.sellerMvcAddress,
                online: false,
                cachedAt: now(input),
            });
        }
    }
    if (!sellerOwnsListing({ listing, localSeller: input.localSeller })) {
        return failure('product_listing_not_owned', 'Referenced product listing does not belong to the local seller bot.');
    }
    const selectedSku = listing.payload.skus.find((sku) => sku.skuId === order.payload.skuId);
    if (!selectedSku) {
        return failure('product_sku_not_found', `Product SKU was not found in the referenced listing: ${order.payload.skuId}`);
    }
    return {
        ok: true,
        order,
        listing,
        selectedSku,
    };
}
async function fulfillProductOrderForSeller(input) {
    const orderTxid = normalizeOrderTxid(input.orderTxid);
    if (!orderTxid) {
        return failure('invalid_product_order_protocol', 'Product fulfillment requires a normalized 64-hex order txid before delivery.');
    }
    const resolved = await resolveProductOrderForSeller(input);
    if (!resolved.ok) {
        return resolved;
    }
    const fulfillmentSkills = [...resolved.listing.payload.fulfillment.fulfillmentSkills];
    const inboundBuyerGlobalMetaId = normalizeNullableText(input.buyer.globalMetaId);
    const resolvedBuyerGlobalMetaId = normalizeNullableText(resolved.order.buyerGlobalMetaId);
    if (inboundBuyerGlobalMetaId &&
        resolvedBuyerGlobalMetaId &&
        inboundBuyerGlobalMetaId !== resolvedBuyerGlobalMetaId) {
        return failure('product_buyer_mismatch', 'Inbound product-order buyer does not match the product-order pin creator.');
    }
    if (!isSupportedV1Fulfillment(resolved.listing.payload)) {
        return failure('product_unsupported_fulfillment', 'Product V1 seller fulfillment only supports virtual digital_delivery over simplemsg.');
    }
    const claim = await input.productStateStore.claimSellerOrderFulfillment({
        productOrderPinId: resolved.order.pinId,
        listingPinId: resolved.order.payload.listingPinId,
        skuId: resolved.order.payload.skuId,
        paymentTxid: resolved.order.payload.paymentTxid,
        productOrderPayload: resolved.order.payload,
        orderTxid,
        buyerGlobalMetaId: inboundBuyerGlobalMetaId || resolvedBuyerGlobalMetaId,
        fulfillmentSkills,
        selectedSku: resolved.selectedSku,
        localUpdatedAt: now(input),
    });
    if (claim.status === 'duplicate_delivered') {
        return sellerOrderSuccessFromRecord({
            record: claim.record,
            resolved,
            orderTxid,
            duplicate: true,
            delivered: true,
            pending: false,
        });
    }
    if (claim.status === 'in_progress') {
        return sellerOrderDuplicatePendingSuccess({
            record: claim.record,
            resolved,
        });
    }
    const paymentChain = resolvePaymentChain(resolved.selectedSku.price.currency);
    const paymentAddress = resolveSellerPaymentAddress({
        seller: input.localSeller,
        paymentChain,
    });
    const paymentVerification = await input.paymentVerifier({
        paymentTxid: resolved.order.payload.paymentTxid,
        paymentChain,
        settlementKind: resolved.order.payload.settlementKind ?? 'native',
        paymentAddress,
        amount: resolved.selectedSku.price.amount,
        currency: resolved.selectedSku.price.currency,
    });
    if (!paymentVerification.verified) {
        await persistSellerOrder({
            store: input.productStateStore,
            resolved,
            buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
            orderTxid,
            fulfillmentSkills,
            paymentVerified: false,
            fulfillmentState: 'failed',
            failureReason: 'product_payment_invalid',
            state: 'failed',
            now: now(input),
        });
        return failure('product_payment_invalid', 'Product payment could not be verified against the seller address and SKU price.', {
            failureKind: paymentVerification.failureKind ?? null,
        });
    }
    await persistSellerOrder({
        store: input.productStateStore,
        resolved,
        buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
        orderTxid,
        fulfillmentSkills,
        paymentVerified: true,
        fulfillmentState: 'fulfilling',
        state: 'fulfilling',
        now: now(input),
    });
    const context = {
        productOrder: {
            pinId: resolved.order.pinId,
            pin: resolved.order.pin,
            payload: resolved.order.payload,
            metadata: {
                buyerGlobalMetaId: resolved.order.buyerGlobalMetaId,
                orderTxid,
                source: resolved.order.source,
            },
        },
        productListing: {
            pinId: resolved.listing.pinId,
            pin: resolved.listing.pin,
            payload: resolved.listing.payload,
            metadata: {
                sellerGlobalMetaId: resolved.listing.sellerGlobalMetaId || normalizeNullableText(input.localSeller.globalMetaId),
                sellerMvcAddress: resolved.listing.sellerMvcAddress || normalizeNullableText(input.localSeller.mvcAddress),
                source: resolved.listing.source,
            },
        },
        selectedSku: resolved.selectedSku,
        buyer: input.buyer,
        orderA2AMetadata: input.orderA2AMetadata ?? {},
        payment: paymentVerification,
        fulfillmentSkills,
    };
    let runnerResult;
    try {
        runnerResult = await runnerExecute(input.fulfillmentRunner, {
            fulfillmentSkills,
            context,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await persistSellerOrder({
            store: input.productStateStore,
            resolved,
            buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
            orderTxid,
            fulfillmentSkills,
            paymentVerified: true,
            fulfillmentState: 'failed',
            failureReason: 'product_fulfillment_failed',
            state: 'failed',
            now: now(input),
        });
        return failure('product_fulfillment_failed', message || 'Product fulfillment failed.');
    }
    if (runnerResult.state !== 'completed') {
        const message = runnerResult.state === 'failed'
            ? runnerResult.message
            : runnerResult.question;
        await persistSellerOrder({
            store: input.productStateStore,
            resolved,
            buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
            orderTxid,
            fulfillmentSkills,
            paymentVerified: true,
            fulfillmentState: 'failed',
            failureReason: 'product_fulfillment_failed',
            state: 'failed',
            now: now(input),
        });
        return failure('product_fulfillment_failed', normalizeText(message) || 'Product fulfillment failed.');
    }
    const deliveredAt = now(input);
    const responseText = normalizeText(runnerResult.responseText);
    const deliveryContent = (0, orderProtocol_1.buildDeliveryMessage)({
        productOrderPinId: resolved.order.pinId,
        listingPinId: resolved.order.payload.listingPinId,
        skuId: resolved.order.payload.skuId,
        paymentTxid: resolved.order.payload.paymentTxid,
        result: responseText,
        deliveredAt,
    }, orderTxid);
    let deliveryWrite;
    try {
        deliveryWrite = await input.deliverySender.send({
            toGlobalMetaId: normalizeText(input.buyer.globalMetaId),
            orderTxid,
            productOrderPinId: resolved.order.pinId,
            content: deliveryContent,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await persistSellerOrder({
            store: input.productStateStore,
            resolved,
            buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
            orderTxid,
            fulfillmentSkills,
            paymentVerified: true,
            fulfillmentState: 'failed',
            failureReason: 'product_fulfillment_failed',
            state: 'failed',
            now: deliveredAt,
        });
        return failure('product_fulfillment_failed', message || 'Product delivery send failed.');
    }
    let ratingMessagePinId = null;
    if (input.requestRating !== false && resolved.listing.payload.productType === 'virtual') {
        let ratingWrite = null;
        try {
            ratingWrite = await input.deliverySender.send({
                toGlobalMetaId: normalizeText(input.buyer.globalMetaId),
                orderTxid,
                productOrderPinId: resolved.order.pinId,
                content: (0, orderProtocol_1.buildNeedsRatingMessage)(orderTxid, 'Please rate this product delivery when ready.'),
            });
        }
        catch {
            ratingWrite = null;
        }
        ratingMessagePinId = normalizeNullableText(ratingWrite?.pinId);
    }
    const deliveryPinId = normalizeNullableText(deliveryWrite.pinId);
    await persistSellerOrder({
        store: input.productStateStore,
        resolved,
        buyerGlobalMetaId: normalizeNullableText(input.buyer.globalMetaId) || resolved.order.buyerGlobalMetaId,
        orderTxid,
        fulfillmentSkills,
        paymentVerified: true,
        fulfillmentState: 'delivered',
        deliveryPinId,
        deliverySummary: {
            result: responseText,
            deliveryPinId,
            deliveredAt,
        },
        failureReason: null,
        state: 'delivered',
        now: deliveredAt,
    });
    return {
        ok: true,
        duplicate: false,
        delivered: true,
        pending: false,
        data: {
            productOrderPinId: resolved.order.pinId,
            listingPinId: resolved.order.payload.listingPinId,
            skuId: resolved.order.payload.skuId,
            paymentTxid: resolved.order.payload.paymentTxid,
            orderTxid,
            result: responseText,
            deliveryPinId,
            ratingMessagePinId,
            fulfillmentState: 'delivered',
        },
    };
}
