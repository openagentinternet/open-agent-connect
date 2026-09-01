"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHttpServer = createHttpServer;
const node_http_1 = __importDefault(require("node:http"));
const node_buffer_1 = require("node:buffer");
const node_events_1 = require("node:events");
const node_fs_1 = require("node:fs");
const promises_1 = require("node:fs/promises");
const commandResult_1 = require("../core/contracts/commandResult");
const config_1 = require("./routes/config");
const buzz_1 = require("./routes/buzz");
const simplenote_1 = require("./routes/simplenote");
const chain_1 = require("./routes/chain");
const daemon_1 = require("./routes/daemon");
const chat_1 = require("./routes/chat");
const grouptask_1 = require("./routes/grouptask");
const conversations_1 = require("./routes/conversations");
const file_1 = require("./routes/file");
const identity_1 = require("./routes/identity");
const network_1 = require("./routes/network");
const provider_1 = require("./routes/provider");
const metaapp_1 = require("./routes/metaapp");
const skills_1 = require("./routes/skills");
const services_1 = require("./routes/services");
const trace_1 = require("./routes/trace");
const ui_1 = require("./routes/ui");
const llm_1 = require("./routes/llm");
const bot_1 = require("./routes/bot");
const browser_1 = require("./routes/browser");
const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const LOCAL_DAEMON_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const ROUTES = [
    config_1.handleConfigRoutes,
    buzz_1.handleBuzzRoutes,
    simplenote_1.handleSimpleNoteRoutes,
    chain_1.handleChainRoutes,
    daemon_1.handleDaemonRoutes,
    chat_1.handleChatRoutes,
    grouptask_1.handleGroupTaskRoutes,
    conversations_1.handleConversationRoutes,
    file_1.handleFileRoutes,
    identity_1.handleIdentityRoutes,
    network_1.handleNetworkRoutes,
    provider_1.handleProviderRoutes,
    metaapp_1.handleMetaAppRoutes,
    skills_1.handleSkillRoutes,
    services_1.handleServicesRoutes,
    trace_1.handleTraceRoutes,
    browser_1.handleBrowserRoutes,
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
function normalizeHeaderValue(value) {
    if (Array.isArray(value))
        return String(value[0] ?? '').trim();
    return String(value ?? '').trim();
}
function readHostAuthority(value) {
    const raw = normalizeHeaderValue(value).toLowerCase();
    if (!raw)
        return '';
    try {
        return new URL(`http://${raw}`).host.toLowerCase();
    }
    catch {
        return raw;
    }
}
function readHostName(value) {
    const raw = normalizeHeaderValue(value);
    if (!raw)
        return '';
    try {
        return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    }
    catch {
        return raw.split(':')[0]?.replace(/^\[|\]$/g, '').toLowerCase() ?? '';
    }
}
function isLocalDaemonHostName(hostname) {
    return LOCAL_DAEMON_HOSTS.has(hostname.replace(/^\[|\]$/g, '').toLowerCase());
}
function isUnsafeMethod(method) {
    const normalized = String(method || 'GET').toUpperCase();
    return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}
function rejectLocalDaemonBoundary(req, url) {
    const hostName = readHostName(req.headers.host);
    if (hostName && !isLocalDaemonHostName(hostName)) {
        return {
            code: 'forbidden_host',
            message: 'Local daemon requests must use localhost or a loopback address.',
        };
    }
    if (!url.pathname.startsWith('/api/') || !isUnsafeMethod(req.method)) {
        return null;
    }
    const fetchSite = normalizeHeaderValue(req.headers['sec-fetch-site']).toLowerCase();
    if (fetchSite === 'cross-site') {
        return {
            code: 'forbidden_origin',
            message: 'Cross-site requests are not allowed for local daemon API writes.',
        };
    }
    const origin = normalizeHeaderValue(req.headers.origin);
    if (!origin)
        return null;
    try {
        const parsedOrigin = new URL(origin);
        const originHostName = parsedOrigin.hostname.replace(/^\[|\]$/g, '').toLowerCase();
        if (!['http:', 'https:'].includes(parsedOrigin.protocol) || !isLocalDaemonHostName(originHostName)) {
            return {
                code: 'forbidden_origin',
                message: 'Cross-origin requests are not allowed for local daemon API writes.',
            };
        }
        const requestAuthority = readHostAuthority(req.headers.host);
        if (requestAuthority && parsedOrigin.host.toLowerCase() !== requestAuthority) {
            return {
                code: 'forbidden_origin',
                message: 'Origin must match the local daemon host for API writes.',
            };
        }
    }
    catch {
        return {
            code: 'forbidden_origin',
            message: 'Invalid Origin header for local daemon API write.',
        };
    }
    return null;
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
async function readRawBody(req, maxBytes) {
    const chunks = [];
    let totalBytes = 0;
    const normalizedMaxBytes = Math.max(0, Math.floor(maxBytes));
    for await (const chunk of req) {
        const bufferChunk = node_buffer_1.Buffer.isBuffer(chunk) ? chunk : node_buffer_1.Buffer.from(String(chunk));
        totalBytes += bufferChunk.byteLength;
        if (totalBytes > normalizedMaxBytes) {
            throw new Error(`Request body is too large. Maximum size is ${normalizedMaxBytes} bytes.`);
        }
        chunks.push(bufferChunk);
    }
    return chunks.length ? node_buffer_1.Buffer.concat(chunks, totalBytes) : node_buffer_1.Buffer.alloc(0);
}
async function streamRawBodyToFile(req, filePath, maxBytes) {
    const normalizedMaxBytes = Math.max(0, Math.floor(maxBytes));
    const stream = (0, node_fs_1.createWriteStream)(filePath);
    const streamError = new Promise((_resolve, reject) => {
        stream.once('error', reject);
    });
    streamError.catch(() => { });
    let totalBytes = 0;
    try {
        for await (const chunk of req) {
            const bufferChunk = node_buffer_1.Buffer.isBuffer(chunk) ? chunk : node_buffer_1.Buffer.from(String(chunk));
            totalBytes += bufferChunk.byteLength;
            if (totalBytes > normalizedMaxBytes) {
                throw new Error(`Request body is too large. Maximum size is ${normalizedMaxBytes} bytes.`);
            }
            if (!stream.write(bufferChunk)) {
                await Promise.race([(0, node_events_1.once)(stream, 'drain'), streamError]);
            }
        }
        stream.end();
        await Promise.race([(0, node_events_1.once)(stream, 'finish'), streamError]);
        return { bytes: totalBytes };
    }
    catch (error) {
        stream.destroy();
        await (0, promises_1.rm)(filePath, { force: true }).catch(() => { });
        throw error;
    }
}
function createHttpServer(handlers = {}) {
    return node_http_1.default.createServer(async (req, res) => {
        const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
        const boundaryRejection = rejectLocalDaemonBoundary(req, requestUrl);
        if (boundaryRejection) {
            sendJson(res, 403, (0, commandResult_1.commandFailed)(boundaryRejection.code, boundaryRejection.message));
            return;
        }
        const context = {
            req,
            res,
            url: requestUrl,
            handlers,
            readJsonBody: () => readJsonBody(req),
            readRawBody: (maxBytes) => readRawBody(req, maxBytes),
            streamRawBodyToFile: (filePath, maxBytes) => streamRawBodyToFile(req, filePath, maxBytes),
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
