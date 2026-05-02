"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUiRoutes = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("../../ui/pages/hub/app");
const app_2 = require("../../ui/pages/chat-viewer/app");
const app_3 = require("../../ui/pages/my-services/app");
const app_4 = require("../../ui/pages/publish/app");
const app_5 = require("../../ui/pages/refund/app");
const app_6 = require("../../ui/pages/trace/app");
const app_7 = require("../../ui/pages/bot/app");
const uiMetaApps_1 = require("./uiMetaApps");
const UI_ROUTE_PREFIX = '/ui/';
const PAGE_BUILDERS = {
    'hub': app_1.buildHubPageDefinition,
    'publish': app_4.buildPublishPageDefinition,
    'my-services': app_3.buildMyServicesPageDefinition,
    'trace': app_6.buildTracePageDefinition,
    'refund': app_5.buildRefundPageDefinition,
    'chat-viewer': app_2.buildChatViewerPageDefinition,
    'bot': app_7.buildBotPageDefinition,
};
const NAV_ITEMS = [
    { page: 'hub', label: 'Hub' },
    { page: 'bot', label: 'Bot' },
    { page: 'trace', label: 'Trace' },
    { page: 'refund', label: 'Refund' },
    { page: 'chat-viewer', label: 'Chat Viewer' },
];
const HIDDEN_UI_PAGES = new Set(['publish', 'my-services']);
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function renderPanels(definition) {
    return definition.panels.map((panel) => {
        const items = Array.isArray(panel.items) && panel.items.length > 0
            ? `<ul>${panel.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
            : '';
        const action = panel.actionLabel && panel.actionHref
            ? `<a href="${escapeHtml(panel.actionHref)}">${escapeHtml(panel.actionLabel)}</a>`
            : '';
        return `<article class="panel"><h2>${escapeHtml(panel.title)}</h2><p>${escapeHtml(panel.body)}</p>${items}${action}</article>`;
    }).join('');
}
function renderNav(currentPage) {
    return NAV_ITEMS.map((item) => {
        const label = item.page === currentPage ? `${item.label} *` : item.label;
        return `<a href="/ui/${item.page}">${escapeHtml(label)}</a>`;
    }).join('');
}
function resolveTemplatePath(page) {
    const copiedAssetPath = node_path_1.default.resolve(__dirname, `../../ui/pages/${page}/index.html`);
    const sourceAssetPath = node_path_1.default.resolve(__dirname, `../../../src/ui/pages/${page}/index.html`);
    return node_fs_1.promises.access(copiedAssetPath).then(() => copiedAssetPath).catch(() => sourceAssetPath);
}
async function loadTemplate(page) {
    const copiedAssetPath = node_path_1.default.resolve(__dirname, `../../ui/pages/${page}/index.html`);
    try {
        return await node_fs_1.promises.readFile(copiedAssetPath, 'utf8');
    }
    catch {
        const sourceAssetPath = node_path_1.default.resolve(__dirname, `../../../src/ui/pages/${page}/index.html`);
        return node_fs_1.promises.readFile(sourceAssetPath, 'utf8');
    }
}
async function renderBuiltInPage(page) {
    const definition = PAGE_BUILDERS[page]();
    const template = await loadTemplate(page);
    // If the template manages its own layout (uses __PAGE_CONTENT__ directly),
    // inject only the page-specific content HTML. Otherwise fall back to the
    // legacy hero wrapper for templates that don't have __PAGE_CONTENT__.
    const content = definition.contentHtml ?? '';
    return template
        .replace(/__PAGE_TITLE__/g, escapeHtml(definition.title))
        .replace(/__PAGE_EYEBROW__/g, escapeHtml(definition.eyebrow))
        .replace(/__PAGE_HEADING__/g, escapeHtml(definition.heading))
        .replace(/__PAGE_DESCRIPTION__/g, escapeHtml(definition.description))
        .replace(/__PAGE_NAV__/g, renderNav(definition.page))
        .replace(/__PAGE_PANELS__/g, renderPanels(definition))
        .replace(/__PAGE_CONTENT__/g, content)
        .replace(/__PAGE_SCRIPT__/g, definition.script);
}
const handleUiRoutes = async (context) => {
    const { req, url, handlers } = context;
    if (!url.pathname.startsWith(UI_ROUTE_PREFIX)) {
        return false;
    }
    // Serve shared CSS
    if (url.pathname === '/ui/shared.css') {
        const candidates = [
            node_path_1.default.resolve(__dirname, '../../ui/shared.css'),
            node_path_1.default.resolve(__dirname, '../../../src/ui/shared.css'),
        ];
        for (const candidate of candidates) {
            try {
                const css = await node_fs_1.promises.readFile(candidate, 'utf8');
                context.res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
                context.res.end(css);
                return true;
            }
            catch { /* try next */ }
        }
        context.sendJson(404, { ok: false, state: 'failed', code: 'not_found', message: 'shared.css not found' });
        return true;
    }
    if (await (0, uiMetaApps_1.handleBundledMetaAppRoutes)(context)) {
        return true;
    }
    if (req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    const page = url.pathname.slice(UI_ROUTE_PREFIX.length).trim();
    if (!(page in PAGE_BUILDERS)) {
        context.sendJson(404, {
            ok: false,
            state: 'failed',
            code: 'not_found',
            message: `No UI page matched ${url.pathname}.`,
        });
        return true;
    }
    if (HIDDEN_UI_PAGES.has(page)) {
        context.sendJson(404, {
            ok: false,
            state: 'failed',
            code: 'not_found',
            message: `No UI page matched ${url.pathname}.`,
        });
        return true;
    }
    const html = handlers.ui?.renderPage
        ? await handlers.ui.renderPage(page)
        : await renderBuiltInPage(page);
    context.sendHtml(200, html);
    return true;
};
exports.handleUiRoutes = handleUiRoutes;
