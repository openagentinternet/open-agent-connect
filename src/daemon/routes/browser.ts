import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function statusForBrowserResult(result: MetabotCommandResult<unknown>): number {
  if (result.ok) return 200;
  if (result.code === 'missing_uri' || result.code === 'invalid_browser_uri') return 400;
  if (result.code === 'browser_resource_not_found') return 404;
  if (result.code === 'browser_config_missing') return 500;
  return 400;
}

export const handleBrowserRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (url.pathname === '/api/browser/context') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const from = normalizeText(url.searchParams.get('from'));
    const result = handlers.browser?.getContext
      ? await handlers.browser.getContext(from ? { from } : {})
      : commandFailed('not_implemented', 'Browser context handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/resolve') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const uri = normalizeText(url.searchParams.get('uri'));
    if (!uri) {
      context.sendJson(400, commandFailed('missing_uri', 'uri query parameter is required.'));
      return true;
    }
    const from = normalizeText(url.searchParams.get('from'));
    const result = handlers.browser?.resolve
      ? await handlers.browser.resolve({ uri, ...(from ? { from } : {}) })
      : commandFailed('not_implemented', 'Browser resolve handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/settings') {
    if (req.method === 'GET') {
      const from = normalizeText(url.searchParams.get('from'));
      const result = handlers.browser?.getSettings
        ? await handlers.browser.getSettings(from ? { from } : {})
        : commandFailed('not_implemented', 'Browser settings handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    if (req.method === 'PUT') {
      const input = await context.readJsonBody();
      const from = normalizeText(url.searchParams.get('from')) || normalizeText(input.from);
      const result = handlers.browser?.updateSettings
        ? await handlers.browser.updateSettings({ ...input, ...(from ? { from } : {}) })
        : commandFailed('not_implemented', 'Browser settings update handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    context.sendMethodNotAllowed(['GET', 'PUT']);
    return true;
  }

  if (url.pathname === '/api/browser/cache') {
    if (req.method === 'GET') {
      const from = normalizeText(url.searchParams.get('from'));
      const result = handlers.browser?.getCache
        ? await handlers.browser.getCache(from ? { from } : {})
        : commandFailed('not_implemented', 'Browser cache handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    if (req.method === 'DELETE') {
      const input = await context.readJsonBody();
      const from = normalizeText(url.searchParams.get('from')) || normalizeText(input.from);
      const result = handlers.browser?.clearCache
        ? await handlers.browser.clearCache({ ...input, ...(from ? { from } : {}) })
        : commandFailed('not_implemented', 'Browser cache clear handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    context.sendMethodNotAllowed(['GET', 'DELETE']);
    return true;
  }

  return false;
};
