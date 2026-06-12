"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStandaloneBrowserServer = createStandaloneBrowserServer;
const node_http_1 = __importDefault(require("node:http"));
const node_buffer_1 = require("node:buffer");
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const agent_browser_host_contract_1 = require("@openagentinternet/agent-browser-host-contract");
const commandResult_1 = require("../../core/contracts/commandResult");
const http_1 = require("../http");
const page_1 = require("../page");
const adapter_1 = require("./adapter");
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const PREVIEW_ASSET_PREFIX = '/api/browser/preview-assets/';
function sendJson(res, status, payload) {
    const body = `${JSON.stringify(payload, null, 2)}\n`;
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': node_buffer_1.Buffer.byteLength(body),
        'cache-control': 'no-store',
    });
    res.end(body);
}
function sendHtml(res, status, html) {
    res.writeHead(status, {
        'content-type': 'text/html; charset=utf-8',
        'content-length': node_buffer_1.Buffer.byteLength(html),
        'cache-control': 'no-store',
    });
    res.end(html);
}
function sendText(res, status, body, contentType = 'text/plain; charset=utf-8') {
    res.writeHead(status, {
        'content-type': contentType,
        'content-length': node_buffer_1.Buffer.byteLength(body),
        'cache-control': 'no-store',
    });
    res.end(body);
}
async function readJsonBody(req) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of req) {
        const bufferChunk = node_buffer_1.Buffer.isBuffer(chunk) ? chunk : node_buffer_1.Buffer.from(String(chunk));
        totalBytes += bufferChunk.byteLength;
        if (totalBytes > JSON_BODY_LIMIT_BYTES) {
            throw new Error('Request body is too large.');
        }
        chunks.push(bufferChunk);
    }
    if (chunks.length === 0) {
        return {};
    }
    const raw = node_buffer_1.Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) {
        return {};
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Expected a JSON object request body.');
    }
    return parsed;
}
function isBrowserPagePath(pathname) {
    return pathname === '/'
        || pathname === '/browser'
        || pathname === '/ui/browser'
        || /^\/browser\/(?:metaid|metaapp)\/[^/?#]+$/u.test(pathname);
}
function parsePreviewAssetPath(pathname) {
    if (!pathname.startsWith(PREVIEW_ASSET_PREFIX)) {
        return null;
    }
    const rest = pathname.slice(PREVIEW_ASSET_PREFIX.length);
    const parts = rest.split('/').filter(Boolean);
    if (parts.length < 2) {
        return null;
    }
    try {
        const [previewId, ...assetParts] = parts.map((part) => decodeURIComponent(part));
        return {
            previewId,
            assetPath: assetParts.join('/'),
        };
    }
    catch {
        return null;
    }
}
async function serveSharedCss(res) {
    const candidates = [
        node_path_1.default.resolve(__dirname, '../../ui/shared.css'),
        node_path_1.default.resolve(__dirname, '../../../src/ui/shared.css'),
    ];
    for (const candidate of candidates) {
        try {
            const css = await node_fs_1.promises.readFile(candidate, 'utf8');
            sendText(res, 200, css, 'text/css; charset=utf-8');
            return true;
        }
        catch {
            // Try the next build/source candidate.
        }
    }
    return false;
}
function browserContextFromRuntime(result) {
    if (!result.ok) {
        return result;
    }
    return (0, commandResult_1.commandSuccess)({
        usingIdentities: result.data.actors
            .filter((actor) => actor.globalMetaId)
            .map((actor) => ({
            slug: actor.id,
            name: actor.label,
            globalMetaId: actor.globalMetaId ?? '',
            ...(actor.avatar ? { avatar: actor.avatar } : {}),
            isDefault: actor.id === result.data.defaultActor?.id,
        })),
        defaultUsingIdentity: result.data.defaultActor?.globalMetaId ? {
            slug: result.data.defaultActor.id,
            name: result.data.defaultActor.label,
            globalMetaId: result.data.defaultActor.globalMetaId,
            ...(result.data.defaultActor.avatar ? { avatar: result.data.defaultActor.avatar } : {}),
            isDefault: true,
        } : null,
        defaultUri: result.data.defaultUri,
    });
}
function toBrowserCommandResult(result) {
    if (result.ok) {
        return (0, agent_browser_host_contract_1.browserSuccess)(result.data);
    }
    const code = result.code ?? result.state;
    const message = result.message ?? 'Standalone Browser command failed.';
    const options = result.data ? { data: result.data } : undefined;
    if (result.state === 'waiting') {
        return (0, agent_browser_host_contract_1.browserWaiting)(code, message, {
            ...options,
            pollAfterMs: result.pollAfterMs,
        });
    }
    if (result.state === 'manual_action_required') {
        return (0, agent_browser_host_contract_1.browserManualActionRequired)(code, message, options);
    }
    return (0, agent_browser_host_contract_1.browserFailure)(code, message, options);
}
function createBrowserHandlers(adapter) {
    return {
        getRuntime: async (request = {}) => toBrowserCommandResult(await adapter.getRuntime(request)),
        getContext: async (request = {}) => toBrowserCommandResult(browserContextFromRuntime(await adapter.getRuntime(request))),
        resolve: async (request) => toBrowserCommandResult(await adapter.resolveResource(request)),
        getSettings: async (request = {}) => toBrowserCommandResult(await adapter.getSettings(request)),
        updateSettings: async (request) => toBrowserCommandResult(await adapter.updateSettings(request)),
        getCache: async (request = {}) => toBrowserCommandResult(await adapter.getCache(request)),
        clearCache: async (request) => toBrowserCommandResult(await adapter.clearCache(request)),
        runTrustedAction: async (request) => toBrowserCommandResult(await adapter.runTrustedAction(request)),
    };
}
function createStandaloneBrowserServer(input = {}) {
    const adapter = input.adapter ?? (0, adapter_1.createStandaloneBrowserHostAdapter)(input);
    const handlers = createBrowserHandlers(adapter);
    return node_http_1.default.createServer(async (req, res) => {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const method = req.method ?? 'GET';
        try {
            if (isBrowserPagePath(requestUrl.pathname)) {
                if (method !== 'GET') {
                    res.setHeader('allow', 'GET');
                    sendJson(res, 405, (0, commandResult_1.commandFailed)('method_not_allowed', 'Expected GET.'));
                    return;
                }
                sendHtml(res, 200, await (0, page_1.renderBrowserPageHtml)());
                return;
            }
            if (requestUrl.pathname === '/ui/shared.css') {
                if (method !== 'GET') {
                    res.setHeader('allow', 'GET');
                    sendJson(res, 405, (0, commandResult_1.commandFailed)('method_not_allowed', 'Expected GET.'));
                    return;
                }
                if (await serveSharedCss(res)) {
                    return;
                }
                sendJson(res, 404, (0, commandResult_1.commandFailed)('not_found', 'shared.css not found.'));
                return;
            }
            const previewAsset = parsePreviewAssetPath(requestUrl.pathname);
            if (previewAsset) {
                if (method !== 'GET') {
                    res.setHeader('allow', 'GET');
                    sendJson(res, 405, (0, commandResult_1.commandFailed)('method_not_allowed', 'Expected GET.'));
                    return;
                }
                const result = await adapter.resolvePreviewAsset(previewAsset);
                if (!result.ok) {
                    const failure = toBrowserCommandResult(result);
                    sendJson(res, (0, http_1.statusForBrowserResult)(failure), failure);
                    return;
                }
                sendText(res, 200, result.data.body, result.data.contentType);
                return;
            }
            const handled = await (0, http_1.handleBrowserApiRoutes)({
                method,
                url: requestUrl,
                handlers,
                readJsonBody: () => readJsonBody(req),
                sendJson: (status, payload) => sendJson(res, status, payload),
                sendMethodNotAllowed: (allowed) => {
                    res.setHeader('allow', allowed.join(', '));
                    sendJson(res, 405, (0, commandResult_1.commandFailed)('method_not_allowed', `Expected ${allowed.join(' or ')}.`));
                },
            });
            if (handled) {
                return;
            }
            sendJson(res, 404, (0, commandResult_1.commandFailed)('not_found', `No route matched ${requestUrl.pathname}.`));
        }
        catch (error) {
            sendJson(res, 500, (0, commandResult_1.commandFailed)('internal_error', error instanceof Error ? error.message : String(error)));
        }
    });
}
