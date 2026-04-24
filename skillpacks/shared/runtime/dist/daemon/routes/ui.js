"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleUiRoutes = void 0;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const app_1 = require("../../ui/pages/hub/app");
const app_2 = require("../../ui/pages/my-services/app");
const app_3 = require("../../ui/pages/publish/app");
const app_4 = require("../../ui/pages/refund/app");
const app_5 = require("../../ui/pages/trace/app");
const uiMetaApps_1 = require("./uiMetaApps");
const UI_ROUTE_PREFIX = '/ui/';
const PAGE_BUILDERS = {
    'hub': app_1.buildHubPageDefinition,
    'publish': app_3.buildPublishPageDefinition,
    'my-services': app_2.buildMyServicesPageDefinition,
    'trace': app_5.buildTracePageDefinition,
    'refund': app_4.buildRefundPageDefinition,
};
const NAV_ITEMS = [
    { page: 'hub', label: 'Hub' },
    { page: 'publish', label: 'Publish' },
    { page: 'my-services', label: 'My Services' },
    { page: 'trace', label: 'Trace' },
    { page: 'refund', label: 'Refund' },
];
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
    const extraContent = definition.contentHtml
        ? `<section class="page-rich-content">${definition.contentHtml}</section>`
        : '';
    const content = `
    <main class="page">
      <section class="hero">
        <div class="eyebrow">${escapeHtml(definition.eyebrow)}</div>
        <h1>${escapeHtml(definition.heading)}</h1>
        <p class="hero-copy">${escapeHtml(definition.description)}</p>
        <div class="hero-meta">
          <div class="hero-chip">
            <strong data-online-count>0</strong>
            <span>Online services detected</span>
          </div>
          <div class="hero-chip">
            <strong data-trace-id>trace-ready</strong>
            <span>Latest visible trace</span>
          </div>
          <div class="hero-chip">
            <strong data-order-id>order-ready</strong>
            <span>Manual refund focus</span>
          </div>
        </div>
        <nav class="nav">${renderNav(definition.page)}</nav>
      </section>
      <section class="panels">${renderPanels(definition)}</section>
      ${extraContent}
    </main>
  `.trim();
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
    const html = handlers.ui?.renderPage
        ? await handlers.ui.renderPage(page)
        : await renderBuiltInPage(page);
    context.sendHtml(200, html);
    return true;
};
exports.handleUiRoutes = handleUiRoutes;
