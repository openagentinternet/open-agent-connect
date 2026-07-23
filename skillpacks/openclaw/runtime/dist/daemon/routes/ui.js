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
const app_6 = require("../../ui/pages/bot/app");
const app_7 = require("../../ui/pages/conversations/app");
const app_8 = require("../../ui/pages/apps/app");
const app_9 = require("../../ui/pages/metaapps/app");
const app_10 = require("../../ui/pages/services/app");
const app_11 = require("../../ui/pages/settings/app");
const page_1 = require("../../browser/page");
const i18n_1 = require("../../ui/i18n");
const topbarChrome_1 = require("../../ui/topbarChrome");
const uiMetaApps_1 = require("./uiMetaApps");
const UI_ROUTE_PREFIX = '/ui/';
const UI_ASSET_CONTENT_TYPES = {
    '.svg': 'image/svg+xml; charset=utf-8',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
};
const UI_ASSET_ROUTES = [
    { prefix: '/ui/assets/platforms/', directory: 'platforms', label: 'Platform' },
    { prefix: '/ui/assets/chains/', directory: 'chains', label: 'Chain' },
];
const BARE_BROWSER_PIN_ID_PATTERN = /^[0-9a-f]{64}i\d+$/iu;
const BARE_BROWSER_DOMAIN_ALIAS_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const BARE_BROWSER_GLOBAL_META_ID_PATTERN = /^id[qpzryt]1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/iu;
const PAGE_BUILDERS = {
    'hub': () => (0, app_1.buildHubPageDefinition)(),
    'publish': () => (0, app_3.buildPublishPageDefinition)(),
    'my-services': (i18n) => (0, app_2.buildMyServicesPageDefinition)({ i18n }),
    'trace': () => (0, app_5.buildTracePageDefinition)(),
    'refund': () => (0, app_4.buildRefundPageDefinition)(),
    'bot': () => (0, app_6.buildBotPageDefinition)(),
    'conversations': app_7.buildConversationsPageDefinition,
    'services': app_10.buildServicesPageDefinition,
    'apps': app_8.buildAppsPageDefinition,
    'settings': app_11.buildSettingsPageDefinition,
    'metaapps': app_9.buildMetaAppsPageDefinition,
};
const NAV_ITEMS = [
    { page: 'bot', labelKey: 'nav.botPage' },
    { page: 'conversations', labelKey: 'nav.conversations' },
    { page: 'services', labelKey: 'nav.services' },
    { page: 'apps', labelKey: 'nav.apps' },
];
const HIDDEN_UI_PAGES = new Set();
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
function renderNav(currentPage, i18n) {
    return NAV_ITEMS.map((item) => {
        const activeClass = item.page === currentPage ? ' class="active"' : '';
        return `<a${activeClass} href="/ui/${item.page}" data-i18n-key="${item.labelKey}">${escapeHtml(i18n.t(item.labelKey))}</a>`;
    }).join('');
}
function injectTopbarChrome(html, i18n) {
    const withLogo = html.replace(/<a class="topbar-logo" href="\/ui\/hub">MetaBot<\/a>/, '<a class="topbar-logo" href="/ui/bot">Open Agent Connect</a>');
    return withLogo
        .replace('</nav>', `</nav>${(0, topbarChrome_1.renderTopbarControls)(i18n)}`)
        .replace('</main>', `</main>${(0, topbarChrome_1.renderTopbarSettingsModal)(i18n)}`);
}
function applyStaticI18n(html, i18n) {
    return html.replace(/(<[^>]*\sdata-i18n-key="([^"]+)"[^>]*>)([^<]*)(<\/[^>]+>)/g, (match, open, key, _text, close) => {
        const translated = i18n.t(key);
        return translated === key ? match : `${open}${escapeHtml(translated)}${close}`;
    });
}
function resolveTemplatePath(page) {
    const copiedAssetPath = node_path_1.default.resolve(__dirname, `../../ui/pages/${page}/index.html`);
    const sourceAssetPath = node_path_1.default.resolve(__dirname, `../../../src/ui/pages/${page}/index.html`);
    return node_fs_1.promises.access(copiedAssetPath).then(() => copiedAssetPath).catch(() => sourceAssetPath);
}
async function loadTemplate(page) {
    const templatePage = page === 'services'
        ? 'my-services'
        : page;
    const copiedAssetPath = node_path_1.default.resolve(__dirname, `../../ui/pages/${templatePage}/index.html`);
    try {
        return await node_fs_1.promises.readFile(copiedAssetPath, 'utf8');
    }
    catch {
        const sourceAssetPath = node_path_1.default.resolve(__dirname, `../../../src/ui/pages/${templatePage}/index.html`);
        return node_fs_1.promises.readFile(sourceAssetPath, 'utf8');
    }
}
function buildPageDefinition(page, i18n) {
    const builder = PAGE_BUILDERS[page];
    if (!builder) {
        throw new Error(`Local UI page is not registered: ${page}`);
    }
    return builder(i18n);
}
async function renderBuiltInPage(page, languagePreference) {
    const i18n = (0, i18n_1.createI18nContext)(languagePreference);
    const definition = buildPageDefinition(page, i18n);
    const template = await loadTemplate(page);
    // If the template manages its own layout (uses __PAGE_CONTENT__ directly),
    // inject only the page-specific content HTML. Otherwise fall back to the
    // legacy hero wrapper for templates that don't have __PAGE_CONTENT__.
    const content = definition.contentHtml ?? '';
    const script = `${(0, i18n_1.renderClientI18nScript)(i18n)}\n${definition.script}\n;\n${(0, topbarChrome_1.renderTopbarSettingsScript)()}`;
    const html = template
        .replace(/<html lang="en">/g, `<html lang="${escapeHtml(i18n.language)}">`)
        .replace(/__PAGE_TITLE__/g, escapeHtml(definition.title))
        .replace(/__PAGE_EYEBROW__/g, escapeHtml(definition.eyebrow))
        .replace(/__PAGE_HEADING__/g, escapeHtml(definition.heading))
        .replace(/__PAGE_DESCRIPTION__/g, escapeHtml(definition.description))
        .replace(/__PAGE_NAV__/g, renderNav(definition.page, i18n))
        .replace(/__PAGE_PANELS__/g, renderPanels(definition))
        .replace(/__PAGE_CONTENT__/g, content)
        .replace(/__PAGE_SCRIPT__/g, script);
    return applyStaticI18n(injectTopbarChrome(html, i18n), i18n);
}
function isBrowserPagePath(pathname) {
    return pathname === '/browser'
        || /^\/browser\/(?:metaid|metaapp|metafile|pin)\/[^/?#]+$/u.test(pathname)
        || /^\/browser\/map\/[^?#]+$/u.test(pathname);
}
function getBrowserLanguagePreference(req) {
    const header = req.headers['accept-language'];
    if (Array.isArray(header)) {
        const preferred = header.find((value) => typeof value === 'string' && value.trim().length > 0);
        return preferred ? preferred.trim() : null;
    }
    if (typeof header === 'string' && header.trim().length > 0) {
        return header.trim();
    }
    return null;
}
function normalizeBareBrowserResourceId(value) {
    return decodeURIComponent(value).trim().toLowerCase();
}
function canonicalBareBrowserPath(url) {
    const match = url.pathname.match(/^\/browser\/([^/?#]+)$/u);
    if (!match) {
        return null;
    }
    const resourceId = normalizeBareBrowserResourceId(match[1]);
    if (!resourceId) {
        return null;
    }
    if (BARE_BROWSER_PIN_ID_PATTERN.test(resourceId)) {
        return `/browser/pin/${encodeURIComponent(resourceId)}${url.search}`;
    }
    if (BARE_BROWSER_DOMAIN_ALIAS_PATTERN.test(resourceId) || BARE_BROWSER_GLOBAL_META_ID_PATTERN.test(resourceId)) {
        return `/browser/metaid/${encodeURIComponent(resourceId)}${url.search}`;
    }
    return null;
}
async function resolveTraceRedirectLocation(context, url) {
    const local = url.searchParams.get('local');
    const peer = url.searchParams.get('peer');
    // local+peer is the Conversations page's native deep-link shape, so pass it
    // straight through without needing the daemon resolver. Only legacy
    // traceId/sessionId params require the resolver (to translate them into a
    // local+peer pair via the unified session store).
    let baseTarget;
    if (local && peer) {
        baseTarget = `/ui/conversations?local=${encodeURIComponent(local)}&peer=${encodeURIComponent(peer)}`;
    }
    else if (context.handlers.ui?.resolveTraceTarget) {
        baseTarget = await context.handlers.ui.resolveTraceTarget({
            traceId: url.searchParams.get('traceId'),
            sessionId: url.searchParams.get('sessionId'),
            local,
            peer,
        });
    }
    else {
        baseTarget = '/ui/conversations';
    }
    const parsed = new URL(baseTarget, 'http://placeholder.local');
    const language = url.searchParams.get('lang');
    if (language) {
        parsed.searchParams.set('lang', language);
    }
    return `${parsed.pathname}${parsed.search}`;
}
async function serveBundledUiAsset(context) {
    const { req, url } = context;
    const route = UI_ASSET_ROUTES.find((candidate) => url.pathname.startsWith(candidate.prefix));
    if (!route) {
        return false;
    }
    if (req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    const filename = decodeURIComponent(url.pathname.slice(route.prefix.length));
    if (filename !== node_path_1.default.basename(filename)) {
        context.sendJson(400, { ok: false, state: 'failed', code: 'bad_request', message: `Invalid ${route.label.toLowerCase()} asset path.` });
        return true;
    }
    const ext = node_path_1.default.extname(filename).toLowerCase();
    const contentType = UI_ASSET_CONTENT_TYPES[ext];
    if (!contentType) {
        context.sendJson(404, { ok: false, state: 'failed', code: 'not_found', message: `${route.label} asset not found.` });
        return true;
    }
    const candidates = [
        node_path_1.default.resolve(__dirname, '../../ui/assets', route.directory, filename),
        node_path_1.default.resolve(__dirname, '../../../src/ui/assets', route.directory, filename),
    ];
    for (const candidate of candidates) {
        try {
            const body = await node_fs_1.promises.readFile(candidate);
            context.res.writeHead(200, { 'Content-Type': contentType });
            context.res.end(body);
            return true;
        }
        catch { /* try next */ }
    }
    context.sendJson(404, { ok: false, state: 'failed', code: 'not_found', message: `${route.label} asset not found.` });
    return true;
}
const handleUiRoutes = async (context) => {
    const { req, url, handlers } = context;
    const canonicalBareBrowser = canonicalBareBrowserPath(url);
    if (canonicalBareBrowser) {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        context.res.writeHead(302, { Location: canonicalBareBrowser });
        context.res.end();
        return true;
    }
    if (isBrowserPagePath(url.pathname)) {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const html = handlers.ui?.renderPage
            ? await handlers.ui.renderPage('browser')
            : await (0, page_1.renderBrowserPageHtml)(undefined, getBrowserLanguagePreference(req));
        context.sendHtml(200, html);
        return true;
    }
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
    if (await serveBundledUiAsset(context)) {
        return true;
    }
    if (await (0, uiMetaApps_1.handleBundledMetaAppRoutes)(context)) {
        return true;
    }
    if (url.pathname === '/ui/metaapps') {
        context.res.writeHead(302, {
            'Location': `/ui/apps${url.search}`,
            'Cache-Control': 'no-store',
        });
        context.res.end();
        return true;
    }
    // The Conversations page is the canonical surface for watching two bots
    // interact. The legacy `/ui/trace` route is kept only as a permanent
    // redirect so existing bookmarks and persisted links keep working: trace
    // params are translated into the conversations `local`+`peer` deep-link.
    if (url.pathname === '/ui/trace') {
        if (req.method !== 'GET') {
            context.sendMethodNotAllowed(['GET']);
            return true;
        }
        const location = await resolveTraceRedirectLocation(context, url);
        context.res.writeHead(302, {
            'Location': location,
            'Cache-Control': 'no-store',
        });
        context.res.end();
        return true;
    }
    if (req.method !== 'GET') {
        context.sendMethodNotAllowed(['GET']);
        return true;
    }
    const page = url.pathname.slice(UI_ROUTE_PREFIX.length).trim();
    if (page === 'browser') {
        const html = handlers.ui?.renderPage
            ? await handlers.ui.renderPage(page)
            : await (0, page_1.renderBrowserPageHtml)(undefined, getBrowserLanguagePreference(req));
        context.sendHtml(200, html);
        return true;
    }
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
        : await renderBuiltInPage(page, url.searchParams.get('lang'));
    context.sendHtml(200, html);
    return true;
};
exports.handleUiRoutes = handleUiRoutes;
