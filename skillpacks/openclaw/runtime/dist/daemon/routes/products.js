"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleProductsRoutes = void 0;
const commandResult_1 = require("../../core/contracts/commandResult");
function readPositiveInteger(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}
function readBoolean(value) {
    const normalized = (value ?? '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1' || normalized === 'yes';
}
const handleProductsRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/products/skills') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const from = url.searchParams.get('from')?.trim();
        const result = handlers.products?.listPublishSkills
            ? await handlers.products.listPublishSkills(from ? { from } : {})
            : (0, commandResult_1.commandFailed)('not_implemented', 'Product publish skills handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/products/publish') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.products?.publish
            ? await handlers.products.publish(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Product publish handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/products/buy') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.products?.buy
            ? await handlers.products.buy(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Product buy handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/products/owned') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.products?.listOwned
            ? await handlers.products.listOwned({
                ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
                ...(url.searchParams.has('all') ? { all: readBoolean(url.searchParams.get('all')) } : {}),
                page: readPositiveInteger(url.searchParams.get('page'), 1),
                pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
                refresh: readBoolean(url.searchParams.get('refresh')),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Owned products list handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/products/orders') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.products?.listOrders
            ? await handlers.products.listOrders({
                ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
                all: readBoolean(url.searchParams.get('all')),
                role: url.searchParams.get('role')?.trim() || 'buyer',
                ...(url.searchParams.get('state')?.trim() ? { state: url.searchParams.get('state').trim() } : {}),
                page: readPositiveInteger(url.searchParams.get('page'), 1),
                pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Product orders list handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/products/orders/inspect') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.products?.inspectOrder
            ? await handlers.products.inspectOrder({
                ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
                ...(url.searchParams.has('all') ? { all: readBoolean(url.searchParams.get('all')) } : {}),
                ...(url.searchParams.get('orderId')?.trim() ? { orderId: url.searchParams.get('orderId').trim() } : {}),
                ...(url.searchParams.get('productOrderPinId')?.trim() ? { productOrderPinId: url.searchParams.get('productOrderPinId').trim() } : {}),
                ...(url.searchParams.get('paymentTxid')?.trim() ? { paymentTxid: url.searchParams.get('paymentTxid').trim() } : {}),
                ...(url.searchParams.get('orderTxid')?.trim() ? { orderTxid: url.searchParams.get('orderTxid').trim() } : {}),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Product order inspection handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleProductsRoutes = handleProductsRoutes;
