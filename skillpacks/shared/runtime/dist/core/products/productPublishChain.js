"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRODUCT_ORDER_PROTOCOL_PATH = exports.PRODUCT_LISTING_PROTOCOL_PATH = void 0;
exports.buildProductListingChainWrite = buildProductListingChainWrite;
exports.buildProductOrderChainWrite = buildProductOrderChainWrite;
exports.publishProductListingToChain = publishProductListingToChain;
exports.publishProductOrderToChain = publishProductOrderToChain;
exports.executeProductPurchase = executeProductPurchase;
const productPurchasePlanner_1 = require("./productPurchasePlanner");
const productOrderMessages_1 = require("./productOrderMessages");
const productValidation_1 = require("./productValidation");
exports.PRODUCT_LISTING_PROTOCOL_PATH = '/protocols/product-listing';
exports.PRODUCT_ORDER_PROTOCOL_PATH = '/protocols/product-order';
function normalizeNetwork(value) {
    return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'mvc';
}
function normalizeText(value) {
    if (typeof value === 'string')
        return value.trim();
    if (typeof value === 'number' && Number.isFinite(value))
        return String(value);
    return '';
}
function normalizeProductPaymentCurrency(value) {
    const normalized = normalizeText(value).toUpperCase();
    if (normalized === 'SPACE' || normalized === 'MVC' || normalized === 'BTC') {
        return normalized;
    }
    return '';
}
function resolveProductPaymentChain(currency) {
    return currency === 'BTC' ? 'btc' : 'mvc';
}
function buildProductTraceId(input) {
    const seller = normalizeText(input.sellerGlobalMetaId).replace(/[^a-z0-9_-]+/giu, '-').slice(0, 32) || 'seller';
    const listing = normalizeText(input.listingPinId).replace(/[^a-z0-9_-]+/giu, '-').slice(0, 32) || 'listing';
    return `trace-product-${seller}-${listing}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeErrorCodePrefix(message) {
    const prefix = normalizeText(message.split(':', 1)[0]);
    return /^[a-z][a-z0-9_]*$/u.test(prefix) ? prefix : '';
}
function failureFromError(error, fallbackCode) {
    const message = error instanceof Error ? error.message : String(error);
    const code = normalizeErrorCodePrefix(message) || fallbackCode;
    return {
        ok: false,
        code,
        message,
    };
}
function stableFailureFromError(error, code) {
    const message = error instanceof Error ? error.message : String(error);
    return {
        ok: false,
        code,
        message,
    };
}
function selectPlannedProduct(input) {
    const listingPinId = normalizeText(input.plan.product.listingPinId);
    return input.products.find((product) => normalizeText(product.listingPinId) === listingPinId) ?? null;
}
function resolveSellerPaymentAddress(input) {
    const identity = input.sellerIdentity;
    if (!identity)
        return '';
    if (input.paymentChain === 'btc') {
        return normalizeText(identity.addresses?.btc);
    }
    return normalizeText(identity.addresses?.mvc) || normalizeText(identity.mvcAddress);
}
function resolveOrderTxid(result) {
    return (normalizeText(result.orderTxid)
        || (Array.isArray(result.txids) ? normalizeText(result.txids[0]) : '')
        || normalizeText(result.pinId));
}
function buildProductListingPayload(input) {
    const result = (0, productValidation_1.validateProductListingPayload)(input);
    if (!result.ok) {
        throw new Error(`Invalid product listing payload: ${result.code}`);
    }
    return result.value;
}
function buildProductOrderPayload(input) {
    const result = (0, productValidation_1.validateProductOrderPayload)(input);
    if (!result.ok) {
        throw new Error(`Invalid product order payload: ${result.code}`);
    }
    const payload = {
        listingPinId: result.value.listingPinId,
        skuId: result.value.skuId,
    };
    if (input.settlementKind !== undefined) {
        payload.settlementKind = result.value.settlementKind;
    }
    payload.paymentTxid = result.value.paymentTxid;
    if (input.comment !== undefined) {
        payload.comment = result.value.comment;
    }
    return payload;
}
function buildProductListingChainWrite(input) {
    const payload = buildProductListingPayload(input.payload);
    return {
        operation: 'create',
        path: exports.PRODUCT_LISTING_PROTOCOL_PATH,
        payload: JSON.stringify(payload),
        contentType: 'application/json',
        network: normalizeNetwork(input.network),
    };
}
function buildProductOrderChainWrite(input) {
    const payload = buildProductOrderPayload(input.payload);
    return {
        operation: 'create',
        path: exports.PRODUCT_ORDER_PROTOCOL_PATH,
        payload: JSON.stringify(payload),
        contentType: 'application/json',
        network: normalizeNetwork(input.network),
    };
}
async function publishProductListingToChain(input) {
    const payload = buildProductListingPayload(input.payload);
    const chainWrite = await input.signer.writePin({
        operation: 'create',
        path: exports.PRODUCT_LISTING_PROTOCOL_PATH,
        payload: JSON.stringify(payload),
        contentType: 'application/json',
        network: normalizeNetwork(input.network),
    });
    return { payload, chainWrite };
}
async function publishProductOrderToChain(input) {
    const payload = buildProductOrderPayload(input.payload);
    const chainWrite = await input.signer.writePin({
        operation: 'create',
        path: exports.PRODUCT_ORDER_PROTOCOL_PATH,
        payload: JSON.stringify(payload),
        contentType: 'application/json',
        network: normalizeNetwork(input.network),
    });
    return { payload, chainWrite };
}
async function executeProductPurchase(input) {
    const planner = input.planner ?? productPurchasePlanner_1.planProductPurchase;
    const plan = planner({
        request: input.request,
        products: input.products,
    });
    if (!plan.ok) {
        return {
            ok: false,
            state: plan.state,
            code: plan.code,
            message: plan.message,
        };
    }
    if (plan.state !== 'ready') {
        return {
            ok: false,
            code: 'product_purchase_confirmation_required',
            message: 'Product purchase requires confirmation before payment.',
        };
    }
    const product = selectPlannedProduct({ products: input.products, plan });
    if (!product) {
        return {
            ok: false,
            code: 'cached_product_match_not_found',
            message: 'No cached online product matched this purchase request.',
        };
    }
    const currency = normalizeProductPaymentCurrency(plan.payment.currency);
    if (!currency) {
        return {
            ok: false,
            code: 'product_payment_unsupported_settlement',
            message: 'Only native SPACE/MVC and BTC product payments are supported.',
        };
    }
    const paymentChain = resolveProductPaymentChain(currency);
    const sellerIdentity = await input.resolveSellerIdentity({ product, plan });
    const sellerGlobalMetaId = normalizeText(sellerIdentity?.globalMetaId) || normalizeText(plan.seller.globalMetaId);
    if (!sellerGlobalMetaId) {
        return {
            ok: false,
            code: 'product_seller_identity_missing',
            message: 'Product seller identity is missing from listing owner metadata.',
        };
    }
    const toAddress = resolveSellerPaymentAddress({ sellerIdentity, paymentChain });
    if (!toAddress) {
        return {
            ok: false,
            code: 'product_seller_payment_address_missing',
            message: 'Product seller payment address is missing from seller identity metadata.',
        };
    }
    const traceId = normalizeText(input.traceId) || buildProductTraceId({
        sellerGlobalMetaId,
        listingPinId: plan.product.listingPinId,
    });
    const sessionId = normalizeText(input.sessionId) || null;
    let payment;
    try {
        payment = await input.paymentExecutor.execute({
            listingPinId: plan.product.listingPinId,
            skuId: plan.sku.skuId,
            sellerGlobalMetaId,
            toAddress,
            amount: plan.payment.amount,
            currency,
            paymentChain,
            settlementKind: 'native',
            traceId,
        });
    }
    catch (error) {
        return failureFromError(error, 'product_payment_failed');
    }
    const paymentTxid = normalizeText(payment.paymentTxid);
    if (!paymentTxid) {
        return {
            ok: false,
            code: 'payment_txid_missing',
            message: 'Paid product payment executor did not return a payment txid.',
        };
    }
    const orderPayload = {
        listingPinId: plan.product.listingPinId,
        skuId: plan.sku.skuId,
        settlementKind: 'native',
        paymentTxid,
    };
    const comment = normalizeText(input.request.comment);
    if (comment || input.request.comment === '') {
        orderPayload.comment = comment;
    }
    let published;
    try {
        published = await input.productOrderPublisher.publish({
            payload: orderPayload,
            network: normalizeText(input.network) || paymentChain,
        });
    }
    catch (error) {
        await input.productStateStore.upsertBuyerOrder({
            productOrderPinId: null,
            listingPinId: orderPayload.listingPinId,
            skuId: orderPayload.skuId,
            paymentTxid,
            productOrderPayload: orderPayload,
            sellerGlobalMetaId,
            buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
            traceId,
            sessionId,
            state: 'failed',
        });
        return stableFailureFromError(error, 'product_order_publish_failed');
    }
    const publishedPayloadValidation = (0, productValidation_1.validateProductOrderPayload)(published.payload);
    const persistedProductOrderPayload = publishedPayloadValidation.ok
        ? publishedPayloadValidation.value
        : orderPayload;
    const productOrderPinId = normalizeText(published.chainWrite.pinId);
    if (!productOrderPinId) {
        await input.productStateStore.upsertBuyerOrder({
            productOrderPinId: null,
            listingPinId: orderPayload.listingPinId,
            skuId: orderPayload.skuId,
            paymentTxid,
            productOrderPayload: persistedProductOrderPayload,
            sellerGlobalMetaId,
            buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
            traceId,
            sessionId,
            state: 'failed',
        });
        return {
            ok: false,
            code: 'product_order_pin_missing',
            message: 'Product-order chain writer did not return a product-order pin id.',
        };
    }
    const content = (0, productOrderMessages_1.buildProductOrderNotification)({
        productOrderPinId,
        listingPinId: orderPayload.listingPinId,
        skuId: orderPayload.skuId,
        paymentTxid,
        comment: orderPayload.comment,
    });
    let sent;
    try {
        sent = await input.simplemsgSender.send({
            toGlobalMetaId: sellerGlobalMetaId,
            productOrderPinId,
            listingPinId: orderPayload.listingPinId,
            skuId: orderPayload.skuId,
            paymentTxid,
            content,
        });
    }
    catch (error) {
        await input.productStateStore.upsertBuyerOrder({
            productOrderPinId,
            listingPinId: orderPayload.listingPinId,
            skuId: orderPayload.skuId,
            paymentTxid,
            productOrderPayload: persistedProductOrderPayload,
            sellerGlobalMetaId,
            buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
            traceId,
            sessionId,
            state: 'failed',
        });
        return stableFailureFromError(error, 'product_order_dispatch_failed');
    }
    const orderTxid = resolveOrderTxid(sent);
    if (!orderTxid) {
        await input.productStateStore.upsertBuyerOrder({
            productOrderPinId,
            listingPinId: orderPayload.listingPinId,
            skuId: orderPayload.skuId,
            paymentTxid,
            productOrderPayload: persistedProductOrderPayload,
            sellerGlobalMetaId,
            buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
            traceId,
            sessionId,
            state: 'failed',
        });
        return {
            ok: false,
            code: 'product_order_txid_missing',
            message: 'Product order simplemsg sender did not return an order txid.',
        };
    }
    await input.productStateStore.upsertBuyerOrder({
        productOrderPinId,
        listingPinId: orderPayload.listingPinId,
        skuId: orderPayload.skuId,
        paymentTxid,
        productOrderPayload: persistedProductOrderPayload,
        orderTxid,
        sellerGlobalMetaId,
        buyerGlobalMetaId: input.buyerIdentity.globalMetaId,
        traceId,
        sessionId,
        state: 'notified',
    });
    return {
        ok: true,
        data: {
            traceId,
            sessionId,
            productOrderPinId,
            paymentTxid,
            orderTxid,
            ...(normalizeText(input.localUiUrl) ? { localUiUrl: normalizeText(input.localUiUrl) } : {}),
            product: plan.product,
            sku: plan.sku,
            seller: {
                globalMetaId: sellerGlobalMetaId,
                name: normalizeText(sellerIdentity?.name) || normalizeText(plan.seller.name) || null,
            },
            payment: plan.payment,
        },
    };
}
