"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleServicesRoutes = void 0;
const node_crypto_1 = require("node:crypto");
const commandResult_1 = require("../../core/contracts/commandResult");
let warnedMissingExecuteApiToken = false;
function readExecuteApiToken() {
    return (process.env.OAC_EXECUTE_API_TOKEN ?? '').trim();
}
function readBearerCredential(value) {
    const raw = Array.isArray(value) ? value[0] : value;
    const match = String(raw ?? '').trim().match(/^bearer\s+(.+)$/i);
    return match?.[1]?.trim() ?? '';
}
function executeApiTokenMatches(provided, expected) {
    // Hash both sides first so the comparison is timing-safe regardless of the
    // configured token length (timingSafeEqual requires equal-length buffers).
    const providedHash = (0, node_crypto_1.createHash)('sha256').update(provided).digest();
    const expectedHash = (0, node_crypto_1.createHash)('sha256').update(expected).digest();
    return (0, node_crypto_1.timingSafeEqual)(providedHash, expectedHash);
}
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
const handleServicesRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (url.pathname === '/api/services/publish') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.publish
            ? await handlers.services.publish(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services publish handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/skills') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const from = url.searchParams.get('from')?.trim();
        const request = {
            ...(from ? { from } : {}),
            ...(url.searchParams.has('allowFallbackRuntime')
                ? { allowFallbackRuntime: readBoolean(url.searchParams.get('allowFallbackRuntime')) }
                : {}),
        };
        const result = handlers.services?.listPublishSkills
            ? await handlers.services.listPublishSkills(request)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services publish skills handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/owned') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.services?.listMyServices
            ? await handlers.services.listMyServices({
                ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
                ...(url.searchParams.has('all') ? { all: readBoolean(url.searchParams.get('all')) } : {}),
                page: readPositiveInteger(url.searchParams.get('page'), 1),
                pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
                refresh: readBoolean(url.searchParams.get('refresh')),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'My services list handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/owned/orders') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const serviceId = url.searchParams.get('serviceId')?.trim() ?? '';
        const result = handlers.services?.listMyServiceOrders
            ? await handlers.services.listMyServiceOrders({
                serviceId,
                ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
                ...(url.searchParams.has('all') ? { all: readBoolean(url.searchParams.get('all')) } : {}),
                page: readPositiveInteger(url.searchParams.get('page'), 1),
                pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
                refresh: readBoolean(url.searchParams.get('refresh')),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'My service orders handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/owned/modify') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.modifyMyService
            ? await handlers.services.modifyMyService(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'My service modify handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/owned/revoke') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.revokeMyService
            ? await handlers.services.revokeMyService(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'My service revoke handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/refunds') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const refundRequest = {
            ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
            ...(url.searchParams.has('all') ? { all: readBoolean(url.searchParams.get('all')) } : {}),
            kind: url.searchParams.get('kind')?.trim() || 'all',
        };
        if (readBoolean(url.searchParams.get('refresh'))) {
            const syncResult = handlers.services?.syncRefunds
                ? await handlers.services.syncRefunds(refundRequest)
                : (0, commandResult_1.commandFailed)('not_implemented', 'Services refund sync handler is not configured.');
            if (!syncResult.ok) {
                context.sendJson(200, syncResult);
                return true;
            }
        }
        const result = handlers.services?.listRefunds
            ? await handlers.services.listRefunds(refundRequest)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services refunds handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/refunds/sync') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.syncRefunds
            ? await handlers.services.syncRefunds({
                ...(typeof input.from === 'string' ? { from: input.from } : {}),
                ...(typeof input.kind === 'string' ? { kind: input.kind } : {}),
                ...(typeof input.all === 'boolean' ? { all: input.all } : {}),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services refund sync handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/refunds/settle') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.settleRefund
            ? await handlers.services.settleRefund({
                ...(typeof input.from === 'string' ? { from: input.from } : {}),
                ...(typeof input.orderId === 'string' ? { orderId: input.orderId } : {}),
                ...(typeof input.paymentTxid === 'string' ? { paymentTxid: input.paymentTxid } : {}),
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services refund settlement handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/orders/inspect') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers.services?.inspectOrder
            ? await handlers.services.inspectOrder({
                ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from').trim() } : {}),
                orderId: url.searchParams.get('orderId') ?? '',
                paymentTxid: url.searchParams.get('paymentTxid') ?? '',
            })
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services order inspection handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/call') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.call
            ? await handlers.services.call(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services call handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/execute') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        // Optional shared-secret gate for daemon-to-daemon execution. When the
        // provider daemon sets OAC_EXECUTE_API_TOKEN, callers must present it as
        // a bearer credential; without it the endpoint stays open for backwards
        // compatibility. The failure is returned as a command envelope (daemon
        // convention) so remote callers surface the distinct code.
        const executeApiToken = readExecuteApiToken();
        if (executeApiToken) {
            const credential = readBearerCredential(req.headers.authorization);
            if (!credential || !executeApiTokenMatches(credential, executeApiToken)) {
                context.sendJson(200, (0, commandResult_1.commandFailed)('execute_api_unauthorized', 'POST /api/services/execute requires a valid bearer token.'));
                return true;
            }
        }
        else if (!warnedMissingExecuteApiToken) {
            warnedMissingExecuteApiToken = true;
            console.warn('[services execute] OAC_EXECUTE_API_TOKEN is not set; the execute endpoint accepts unauthenticated remote execution requests.');
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.execute
            ? await handlers.services.execute(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services execute handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    if (url.pathname === '/api/services/rate') {
        if (req.method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers.services?.rate
            ? await handlers.services.rate(input)
            : (0, commandResult_1.commandFailed)('not_implemented', 'Services rate handler is not configured.');
        context.sendJson(200, result);
        return true;
    }
    return false;
};
exports.handleServicesRoutes = handleServicesRoutes;
