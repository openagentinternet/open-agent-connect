import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { BrowserTrustedActionKind } from '../../core/browser/hostTypes';
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

function actorRouteInput(url: URL, body?: Record<string, unknown>): { actorId?: string; from?: string } {
  const actorId = normalizeText(url.searchParams.get('actorId')) || normalizeText(body?.actorId);
  const from = normalizeText(url.searchParams.get('from')) || normalizeText(body?.from);
  return {
    ...(actorId ? { actorId } : {}),
    ...(from ? { from } : {}),
  };
}

export const handleBrowserRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (url.pathname === '/api/browser/runtime') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const result = handlers.browser?.getRuntime
      ? await handlers.browser.getRuntime(actorRouteInput(url))
      : commandFailed('not_implemented', 'Browser runtime handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/context') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const result = handlers.browser?.getContext
      ? await handlers.browser.getContext(actorRouteInput(url))
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
    const result = handlers.browser?.resolve
      ? await handlers.browser.resolve({ uri, ...actorRouteInput(url) })
      : commandFailed('not_implemented', 'Browser resolve handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/settings') {
    if (req.method === 'GET') {
      const result = handlers.browser?.getSettings
        ? await handlers.browser.getSettings(actorRouteInput(url))
        : commandFailed('not_implemented', 'Browser settings handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    if (req.method === 'PUT') {
      const input = await context.readJsonBody();
      const result = handlers.browser?.updateSettings
        ? await handlers.browser.updateSettings({ ...input, ...actorRouteInput(url, input) })
        : commandFailed('not_implemented', 'Browser settings update handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    context.sendMethodNotAllowed(['GET', 'PUT']);
    return true;
  }

  if (url.pathname === '/api/browser/cache') {
    if (req.method === 'GET') {
      const result = handlers.browser?.getCache
        ? await handlers.browser.getCache(actorRouteInput(url))
        : commandFailed('not_implemented', 'Browser cache handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    if (req.method === 'DELETE') {
      const input = await context.readJsonBody();
      const result = handlers.browser?.clearCache
        ? await handlers.browser.clearCache({ ...input, ...actorRouteInput(url, input) })
        : commandFailed('not_implemented', 'Browser cache clear handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    context.sendMethodNotAllowed(['GET', 'DELETE']);
    return true;
  }

  if (url.pathname === '/api/browser/actions') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }
    const input = await context.readJsonBody();
    const resourceUri = normalizeText(input.resourceUri);
    const kind = normalizeText(input.kind);
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? input.payload as Record<string, unknown>
      : undefined;
    const result = handlers.browser?.runTrustedAction
      ? await handlers.browser.runTrustedAction({
        ...actorRouteInput(url, input),
        resourceUri,
        kind: kind as BrowserTrustedActionKind,
        ...(payload ? { payload } : {}),
      })
      : commandFailed('not_implemented', 'Browser action handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  return false;
};
