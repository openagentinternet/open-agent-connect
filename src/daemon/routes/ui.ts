import { promises as fs } from 'node:fs';
import path from 'node:path';
import { buildHubPageDefinition } from '../../ui/pages/hub/app';
import { buildChatViewerPageDefinition } from '../../ui/pages/chat-viewer/app';
import { buildMyServicesPageDefinition } from '../../ui/pages/my-services/app';
import { buildPublishPageDefinition } from '../../ui/pages/publish/app';
import { buildRefundPageDefinition } from '../../ui/pages/refund/app';
import { buildTracePageDefinition } from '../../ui/pages/trace/app';
import { buildBotPageDefinition } from '../../ui/pages/bot/app';
import type { LocalUiPageDefinition } from '../../ui/pages/types';
import type { MetabotUiPageName, RouteHandler } from './types';
import { handleBundledMetaAppRoutes } from './uiMetaApps';

const UI_ROUTE_PREFIX = '/ui/';

const PAGE_BUILDERS: Record<MetabotUiPageName, () => LocalUiPageDefinition> = {
  'hub': buildHubPageDefinition,
  'publish': buildPublishPageDefinition,
  'my-services': buildMyServicesPageDefinition,
  'trace': buildTracePageDefinition,
  'refund': buildRefundPageDefinition,
  'chat-viewer': buildChatViewerPageDefinition,
  'bot': buildBotPageDefinition,
};

const NAV_ITEMS: Array<{ page: MetabotUiPageName; label: string }> = [
  { page: 'hub', label: 'Hub' },
  { page: 'bot', label: 'Bot' },
  { page: 'trace', label: 'Trace' },
  { page: 'refund', label: 'Refund' },
  { page: 'chat-viewer', label: 'Chat Viewer' },
];

const HIDDEN_UI_PAGES = new Set<MetabotUiPageName>(['publish', 'my-services']);

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

function renderNav(currentPage: MetabotUiPageName): string {
  return NAV_ITEMS.map((item) => {
    const label = item.page === currentPage ? `${item.label} *` : item.label;
    return `<a href="/ui/${item.page}">${escapeHtml(label)}</a>`;
  }).join('');
}

function resolveTemplatePath(page: MetabotUiPageName): string {
  const copiedAssetPath = path.resolve(__dirname, `../../ui/pages/${page}/index.html`);
  const sourceAssetPath = path.resolve(__dirname, `../../../src/ui/pages/${page}/index.html`);
  return fs.access(copiedAssetPath).then(() => copiedAssetPath).catch(() => sourceAssetPath) as unknown as string;
}

async function loadTemplate(page: MetabotUiPageName): Promise<string> {
  const copiedAssetPath = path.resolve(__dirname, `../../ui/pages/${page}/index.html`);
  try {
    return await fs.readFile(copiedAssetPath, 'utf8');
  } catch {
    const sourceAssetPath = path.resolve(__dirname, `../../../src/ui/pages/${page}/index.html`);
    return fs.readFile(sourceAssetPath, 'utf8');
  }
}

async function renderBuiltInPage(page: MetabotUiPageName): Promise<string> {
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

export const handleUiRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

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

  if (await handleBundledMetaAppRoutes(context)) {
    return true;
  }

  if (req.method !== 'GET') {
    context.sendMethodNotAllowed(['GET']);
    return true;
  }

  const page = url.pathname.slice(UI_ROUTE_PREFIX.length).trim() as MetabotUiPageName;
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
