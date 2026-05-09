"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = createHttpServer;
const node_http_1 = __importDefault(require("node:http"));
const node_buffer_1 = require("node:buffer");
const commandResult_1 = require("../core/contracts/commandResult");
const config_1 = require("./routes/config");
const buzz_1 = require("./routes/buzz");
const chain_1 = require("./routes/chain");
const daemon_1 = require("./routes/daemon");
const chat_1 = require("./routes/chat");
const file_1 = require("./routes/file");
const identity_1 = require("./routes/identity");
const master_1 = require("./routes/master");
const network_1 = require("./routes/network");
const provider_1 = require("./routes/provider");
const services_1 = require("./routes/services");
const trace_1 = require("./routes/trace");
const ui_1 = require("./routes/ui");
const llm_1 = require("./routes/llm");
const bot_1 = require("./routes/bot");
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const ROUTES = [
    config_1.handleConfigRoutes,
    buzz_1.handleBuzzRoutes,
    chain_1.handleChainRoutes,
    daemon_1.handleDaemonRoutes,
    chat_1.handleChatRoutes,
    file_1.handleFileRoutes,
    identity_1.handleIdentityRoutes,
    master_1.handleMasterRoutes,
    network_1.handleNetworkRoutes,
    provider_1.handleProviderRoutes,
    services_1.handleServicesRoutes,
    trace_1.handleTraceRoutes,
    ui_1.handleUiRoutes,
    llm_1.handleLlmRoutes,
    bot_1.handleBotRoutes,
];
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
function createHttpServer(handlers = {}) {
    return node_http_1.default.createServer(async (req, res) => {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const context = {
            req,
            res,
            url: requestUrl,
            handlers,
            readJsonBody: () => readJsonBody(req),
            sendJson: (status, payload) => sendJson(res, status, payload),
            sendHtml: (status, html) => sendHtml(res, status, html),
            sendText: (status, body, contentType) => sendText(res, status, body, contentType),
            sendMethodNotAllowed: (allowed) => {
                res.setHeader('allow', allowed.join(', '));
                sendJson(res, 405, (0, commandResult_1.commandFailed)('method_not_allowed', `Expected ${allowed.join(' or ')}.`));
            },
        };
        try {
            for (const route of ROUTES) {
                const handled = await route(context);
                if (handled) {
                    return;
                }
            }
            context.sendJson(404, (0, commandResult_1.commandFailed)('not_found', `No route matched ${requestUrl.pathname}.`));
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (requestUrl.pathname.startsWith('/ui/')) {
                context.sendHtml(500, `<!doctype html><html><body><h1>Open Agent Connect UI Error</h1><pre>${message}</pre></body></html>`);
                return;
            }
            context.sendJson(500, (0, commandResult_1.commandFailed)('internal_error', message));
        }
    });
}
