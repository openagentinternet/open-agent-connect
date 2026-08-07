"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerBrowserTabSink = registerBrowserTabSink;
exports.browserTabSinkCount = browserTabSinkCount;
exports.broadcastBrowserTabOpen = broadcastBrowserTabOpen;
exports.statusForBrowserResult = statusForBrowserResult;
exports.handleBrowserApiRoutes = handleBrowserApiRoutes;
const agent_browser_host_contract_1 = require("@openagentinternet/agent-browser-host-contract");
const browserTabSinks = new Set();
/** Register a sink. Returns an unregister function for cleanup. */
function registerBrowserTabSink(sink) {
    browserTabSinks.add(sink);
    return () => {
        browserTabSinks.delete(sink);
    };
}
/** Number of currently-subscribed Browser pages (used to report "no page open"). */
function browserTabSinkCount() {
    return browserTabSinks.size;
}
/**
 * Fan an open-tab request out to every subscribed Browser page. Never throws:
 * each sink is its own best-effort try/catch boundary. Returns the number of
 * pages reached.
 */
function broadcastBrowserTabOpen(uri) {
    let reached = 0;
    for (const sink of browserTabSinks) {
        try {
            sink({ type: 'agent-browser:open-tab', uri });
            reached += 1;
        }
        catch {
            /* a single failing sink must not block the others */
        }
    }
    return reached;
}
function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function statusForBrowserResult(result) {
    if (result.ok)
        return 200;
    if (result.state === 'waiting' || result.state === 'manual_action_required')
        return 200;
    if (result.code === 'missing_uri' || result.code === 'invalid_browser_uri')
        return 400;
    if (result.code === 'browser_resource_not_found')
        return 404;
    if (result.code === 'browser_config_missing')
        return 500;
    return 400;
}
function actorRouteInput(url, body) {
    const actorId = normalizeText(url.searchParams.get('actorId')) || normalizeText(body?.actorId);
    const from = normalizeText(url.searchParams.get('from')) || normalizeText(body?.from);
    return {
        ...(actorId ? { actorId } : {}),
        ...(from ? { from } : {}),
    };
}
async function handleBrowserApiRoutes(context) {
    const { method, url, handlers } = context;
    if (url.pathname === '/api/browser/runtime') {
        if (method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers?.getRuntime
            ? await handlers.getRuntime(actorRouteInput(url))
            : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser runtime handler is not configured.');
        context.sendJson(statusForBrowserResult(result), result);
        return true;
    }
    if (url.pathname === '/api/browser/context') {
        if (method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const result = handlers?.getContext
            ? await handlers.getContext(actorRouteInput(url))
            : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser context handler is not configured.');
        context.sendJson(statusForBrowserResult(result), result);
        return true;
    }
    if (url.pathname === '/api/browser/resolve') {
        if (method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const uri = normalizeText(url.searchParams.get('uri'));
        if (!uri) {
            context.sendJson(400, (0, agent_browser_host_contract_1.browserFailure)('missing_uri', 'uri query parameter is required.'));
            return true;
        }
        const result = handlers?.resolve
            ? await handlers.resolve({ uri, ...actorRouteInput(url) })
            : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser resolve handler is not configured.');
        context.sendJson(statusForBrowserResult(result), result);
        return true;
    }
    if (url.pathname === '/api/browser/settings') {
        if (method === 'GET') {
            const result = handlers?.getSettings
                ? await handlers.getSettings(actorRouteInput(url))
                : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser settings handler is not configured.');
            context.sendJson(statusForBrowserResult(result), result);
            return true;
        }
        if (method === 'PUT') {
            const input = await context.readJsonBody();
            const result = handlers?.updateSettings
                ? await handlers.updateSettings({ ...input, ...actorRouteInput(url, input) })
                : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser settings update handler is not configured.');
            context.sendJson(statusForBrowserResult(result), result);
            return true;
        }
        context.sendMethodNotAllowed(['GET', 'PUT']);
        return true;
    }
    if (url.pathname === '/api/browser/cache') {
        if (method === 'GET') {
            const result = handlers?.getCache
                ? await handlers.getCache(actorRouteInput(url))
                : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser cache handler is not configured.');
            context.sendJson(statusForBrowserResult(result), result);
            return true;
        }
        if (method === 'DELETE') {
            const input = await context.readJsonBody();
            const result = handlers?.clearCache
                ? await handlers.clearCache({ ...input, ...actorRouteInput(url, input) })
                : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser cache clear handler is not configured.');
            context.sendJson(statusForBrowserResult(result), result);
            return true;
        }
        context.sendMethodNotAllowed(['GET', 'DELETE']);
        return true;
    }
    if (url.pathname === '/api/browser/actions') {
        if (method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const resourceUri = normalizeText(input.resourceUri);
        const kind = normalizeText(input.kind);
        const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
            ? input.payload
            : undefined;
        const result = handlers?.runTrustedAction
            ? await handlers.runTrustedAction({
                ...actorRouteInput(url, input),
                resourceUri,
                kind: kind,
                ...(normalizeText(input.sessionId) ? { sessionId: normalizeText(input.sessionId) } : {}),
                ...(payload ? { payload } : {}),
            })
            : (0, agent_browser_host_contract_1.browserFailure)('not_implemented', 'Browser action handler is not configured.');
        context.sendJson(statusForBrowserResult(result), result);
        return true;
    }
    if (url.pathname === '/api/browser/metafile-upload') {
        if (method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const result = handlers?.metafileUpload
            ? await handlers.metafileUpload({ ...input, ...actorRouteInput(url, input) })
            : (0, agent_browser_host_contract_1.browserFailure)('unsupported_method', 'OAC Browser MetaFile upload requires a host-owned file picker.');
        context.sendJson(statusForBrowserResult(result), result);
        return true;
    }
    if (url.pathname === '/api/browser/tabs/open') {
        if (method !== 'POST') {
            context.sendMethodNotAllowed(['POST']);
            return true;
        }
        const input = await context.readJsonBody();
        const uri = normalizeText(input.uri);
        if (!uri) {
            context.sendJson(400, (0, agent_browser_host_contract_1.browserFailure)('missing_uri', 'uri is required to open a Browser tab.'));
            return true;
        }
        if (uri.startsWith('--')) {
            context.sendJson(400, (0, agent_browser_host_contract_1.browserFailure)('invalid_browser_uri', 'uri does not look like a Browser resource URI.'));
            return true;
        }
        // Fire-and-forget: fan out to every currently-open Browser page, which feeds
        // ABC's client-only AgentBrowserTabs.openTab. No tab id is returned because
        // tab ids are client-only (the daemon never learns them). Reaching zero
        // pages is not an error — the open is simply pending until a page connects.
        const reached = broadcastBrowserTabOpen(uri);
        const data = { ok: true, uri, pagesReached: reached };
        if (reached === 0)
            data.note = 'no Browser page currently open; open the Browser first';
        context.sendJson(200, (0, agent_browser_host_contract_1.browserSuccess)(data));
        return true;
    }
    return false;
}
