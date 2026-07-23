import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildHubPageDefinition } from '../../ui/pages/hub/app';
import { buildMyServicesPageDefinition } from '../../ui/pages/my-services/app';
import { buildPublishPageDefinition } from '../../ui/pages/publish/app';
import { buildRefundPageDefinition } from '../../ui/pages/refund/app';
import { buildTracePageDefinition } from '../../ui/pages/trace/app';
import { buildBotPageDefinition } from '../../ui/pages/bot/app';
import { buildConversationsPageDefinition } from '../../ui/pages/conversations/app';
import { buildAppsPageDefinition } from '../../ui/pages/apps/app';
import { buildMetaAppsPageDefinition } from '../../ui/pages/metaapps/app';
import { buildServicesPageDefinition } from '../../ui/pages/services/app';
import { buildSettingsPageDefinition } from '../../ui/pages/settings/app';
import type { LocalUiPageDefinition } from '../../ui/pages/types';
import { renderBrowserPageHtml } from '../../browser/page';
import { createI18nContext, renderClientI18nScript } from '../../ui/i18n';
import type { I18nKey, LocalUiI18nContext } from '../../ui/i18n';
import {
  renderTopbarControls,
  renderTopbarSettingsModal,
  renderTopbarSettingsScript,
} from '../../ui/topbarChrome';
import type { MetabotUiPageName, RouteHandler } from './types';
import { handleBundledMetaAppRoutes } from './uiMetaApps';

const UI_ROUTE_PREFIX = '/ui/';
const UI_ASSET_CONTENT_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};
const UI_ASSET_ROUTES = [
  { prefix: '/ui/assets/platforms/', directory: 'platforms', label: 'Platform' },
  { prefix: '/ui/assets/chains/', directory: 'chains', label: 'Chain' },
] as const;
const BARE_BROWSER_PIN_ID_PATTERN = /^[0-9a-f]{64}i\d+$/iu;
const BARE_BROWSER_DOMAIN_ALIAS_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const BARE_BROWSER_GLOBAL_META_ID_PATTERN = /^id[qpzryt]1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]+$/iu;

type LocalUiPageBuilder = (i18n: LocalUiI18nContext) => LocalUiPageDefinition;

const PAGE_BUILDERS: Partial<Record<MetabotUiPageName, LocalUiPageBuilder>> = {
  'hub': () => buildHubPageDefinition(),
  'publish': () => buildPublishPageDefinition(),
  'my-services': (i18n) => buildMyServicesPageDefinition({ i18n }),
  'trace': () => buildTracePageDefinition(),
  'refund': () => buildRefundPageDefinition(),
  'bot': () => buildBotPageDefinition(),
  'conversations': buildConversationsPageDefinition,
  'services': buildServicesPageDefinition,
  'apps': buildAppsPageDefinition,
  'settings': buildSettingsPageDefinition,
  'metaapps': buildMetaAppsPageDefinition,
};

const NAV_ITEMS: Array<{ page: MetabotUiPageName; labelKey: I18nKey }> = [
  { page: 'bot', labelKey: 'nav.botPage' },
  { page: 'conversations', labelKey: 'nav.conversations' },
  { page: 'services', labelKey: 'nav.services' },
  { page: 'apps', labelKey: 'nav.apps' },
];

const HIDDEN_UI_PAGES = new Set<MetabotUiPageName>();

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderPanels(definition: LocalUiPageDefinition): string {
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

function renderNav(currentPage: MetabotUiPageName, i18n: LocalUiI18nContext): string {
  return NAV_ITEMS.map((item) => {
    const activeClass = item.page === currentPage ? ' class="active"' : '';
    return `<a${activeClass} href="/ui/${item.page}" data-i18n-key="${item.labelKey}">${escapeHtml(i18n.t(item.labelKey))}</a>`;
  }).join('');
}

function injectTopbarChrome(html: string, i18n: LocalUiI18nContext): string {
  const withLogo = html.replace(
    /<a class="topbar-logo" href="\/ui\/hub">MetaBot<\/a>/,
    '<a class="topbar-logo" href="/ui/bot">Open Agent Connect</a>',
  );
  return withLogo
    .replace('</nav>', `</nav>${renderTopbarControls(i18n)}`)
    .replace('</main>', `</main>${renderTopbarSettingsModal(i18n)}`);
}

function applyStaticI18n(html: string, i18n: LocalUiI18nContext): string {
  return html.replace(
    /(<[^>]*\sdata-i18n-key="([^"]+)"[^>]*>)([^<]*)(<\/[^>]+>)/g,
    (match: string, open: string, key: string, _text: string, close: string) => {
      const translated = i18n.t(key as I18nKey);
      return translated === key ? match : `${open}${escapeHtml(translated)}${close}`;
    },
  );
}

function resolveTemplatePath(page: MetabotUiPageName): string {
  const copiedAssetPath = path.resolve(__dirname, `../../ui/pages/${page}/index.html`);
  const sourceAssetPath = path.resolve(__dirname, `../../../src/ui/pages/${page}/index.html`);
  return fs.access(copiedAssetPath).then(() => copiedAssetPath).catch(() => sourceAssetPath) as unknown as string;
}

async function loadTemplate(page: MetabotUiPageName): Promise<string> {
  const templatePage = page === 'services'
    ? 'my-services'
    : page;
  const copiedAssetPath = path.resolve(__dirname, `../../ui/pages/${templatePage}/index.html`);
  try {
    return await fs.readFile(copiedAssetPath, 'utf8');
  } catch {
    const sourceAssetPath = path.resolve(__dirname, `../../../src/ui/pages/${templatePage}/index.html`);
    return fs.readFile(sourceAssetPath, 'utf8');
  }
}

function buildPageDefinition(page: MetabotUiPageName, i18n: LocalUiI18nContext): LocalUiPageDefinition {
  const builder = PAGE_BUILDERS[page];
  if (!builder) {
    throw new Error(`Local UI page is not registered: ${page}`);
  }
  return builder(i18n);
}

async function renderBuiltInPage(page: MetabotUiPageName, languagePreference?: string | null): Promise<string> {
  const i18n = createI18nContext(languagePreference);
  const definition = buildPageDefinition(page, i18n);
  const template = await loadTemplate(page);
  // If the template manages its own layout (uses __PAGE_CONTENT__ directly),
  // inject only the page-specific content HTML. Otherwise fall back to the
  // legacy hero wrapper for templates that don't have __PAGE_CONTENT__.
  const content = definition.contentHtml ?? '';
  const script = `${renderClientI18nScript(i18n)}\n${definition.script}\n;\n${renderTopbarSettingsScript()}`;
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

function isBrowserPagePath(pathname: string): boolean {
  return pathname === '/browser'
    || /^\/browser\/(?:metaid|metaapp|metafile|pin)\/[^/?#]+$/u.test(pathname)
    || /^\/browser\/map\/[^?#]+$/u.test(pathname);
}

function getBrowserLanguagePreference(req: Parameters<RouteHandler>[0]['req']): string | null {
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

function normalizeBareBrowserResourceId(value: string): string {
  return decodeURIComponent(value).trim().toLowerCase();
}

function canonicalBareBrowserPath(url: URL): string | null {
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

async function resolveTraceRedirectLocation(context: Parameters<RouteHandler>[0], url: URL): Promise<string> {
  const local = url.searchParams.get('local');
  const peer = url.searchParams.get('peer');
  // local+peer is the Conversations page's native deep-link shape, so pass it
  // straight through without needing the daemon resolver. Only legacy
  // traceId/sessionId params require the resolver (to translate them into a
  // local+peer pair via the unified session store).
  let baseTarget: string;
  if (local && peer) {
    baseTarget = `/ui/conversations?local=${encodeURIComponent(local)}&peer=${encodeURIComponent(peer)}`;
  } else if (context.handlers.ui?.resolveTraceTarget) {
    baseTarget = await context.handlers.ui.resolveTraceTarget({
      traceId: url.searchParams.get('traceId'),
      sessionId: url.searchParams.get('sessionId'),
      local,
      peer,
    });
  } else {
    baseTarget = '/ui/conversations';
  }
  const parsed = new URL(baseTarget, 'http://placeholder.local');
  const language = url.searchParams.get('lang');
  if (language) {
    parsed.searchParams.set('lang', language);
  }
  return `${parsed.pathname}${parsed.search}`;
}

async function serveBundledUiAsset(context: Parameters<RouteHandler>[0]): Promise<boolean> {
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
  if (filename !== path.basename(filename)) {
    context.sendJson(400, { ok: false, state: 'failed', code: 'bad_request', message: `Invalid ${route.label.toLowerCase()} asset path.` });
    return true;
  }

  const ext = path.extname(filename).toLowerCase();
  const contentType = UI_ASSET_CONTENT_TYPES[ext];
  if (!contentType) {
    context.sendJson(404, { ok: false, state: 'failed', code: 'not_found', message: `${route.label} asset not found.` });
    return true;
  }

  const candidates = [
    path.resolve(__dirname, '../../ui/assets', route.directory, filename),
    path.resolve(__dirname, '../../../src/ui/assets', route.directory, filename),
  ];
  for (const candidate of candidates) {
    try {
      const body = await fs.readFile(candidate);
      context.res.writeHead(200, { 'Content-Type': contentType });
      context.res.end(body);
      return true;
    } catch { /* try next */ }
  }

  context.sendJson(404, { ok: false, state: 'failed', code: 'not_found', message: `${route.label} asset not found.` });
  return true;
}

export const handleUiRoutes: RouteHandler = async (context) => {
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
      : await renderBrowserPageHtml(undefined, getBrowserLanguagePreference(req));
    context.sendHtml(200, html);
    return true;
  }

  if (!url.pathname.startsWith(UI_ROUTE_PREFIX)) {
    return false;
  }

  // Serve shared CSS
  if (url.pathname === '/ui/shared.css') {
    const candidates = [
      path.resolve(__dirname, '../../ui/shared.css'),
      path.resolve(__dirname, '../../../src/ui/shared.css'),
    ];
    for (const candidate of candidates) {
      try {
        const css = await fs.readFile(candidate, 'utf8');
        context.res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
        context.res.end(css);
        return true;
      } catch { /* try next */ }
    }
    context.sendJson(404, { ok: false, state: 'failed', code: 'not_found', message: 'shared.css not found' });
    return true;
  }

  if (await serveBundledUiAsset(context)) {
    return true;
  }

  if (await handleBundledMetaAppRoutes(context)) {
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

  const page = url.pathname.slice(UI_ROUTE_PREFIX.length).trim() as MetabotUiPageName;
  if (page === 'browser') {
    const html = handlers.ui?.renderPage
      ? await handlers.ui.renderPage(page)
      : await renderBrowserPageHtml(undefined, getBrowserLanguagePreference(req));
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
