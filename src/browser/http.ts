import { commandFailed, type MetabotCommandResult } from '../core/contracts/commandResult';
import type {
  BrowserRuntimeSnapshot,
  BrowserTrustedActionInput,
  BrowserTrustedActionKind,
  BrowserTrustedActionResult,
} from '../core/browser/hostTypes';
import type { BrowserContextResult, BrowserResolveResult } from '../core/browser/types';

export type Awaitable<T> = T | Promise<T>;

export interface BrowserHttpHandlers {
  getRuntime?: (input?: { actorId?: string; from?: string }) => Awaitable<MetabotCommandResult<BrowserRuntimeSnapshot>>;
  getContext?: (input?: { actorId?: string; from?: string }) => Awaitable<MetabotCommandResult<BrowserContextResult>>;
  resolve?: (input: { uri: string; actorId?: string; from?: string }) => Awaitable<MetabotCommandResult<BrowserResolveResult>>;
  getSettings?: (input?: { actorId?: string; from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  updateSettings?: (input: { actorId?: string; from?: string; browser?: Record<string, unknown> } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  getCache?: (input?: { actorId?: string; from?: string }) => Awaitable<MetabotCommandResult<unknown>>;
  clearCache?: (input: { actorId?: string; from?: string; scope?: string; pinId?: string; cacheKey?: string } & Record<string, unknown>) => Awaitable<MetabotCommandResult<unknown>>;
  runTrustedAction?: (input: BrowserTrustedActionInput) => Awaitable<MetabotCommandResult<BrowserTrustedActionResult>>;
}

export interface BrowserHttpRouteContext {
  method: string;
  url: URL;
  handlers?: BrowserHttpHandlers;
  readJsonBody: () => Promise<Record<string, unknown>>;
  sendJson: (status: number, payload: unknown) => void;
  sendMethodNotAllowed: (allowed: string[]) => void;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function statusForBrowserResult(result: MetabotCommandResult<unknown>): number {
  if (result.ok) return 200;
  if (result.state === 'waiting' || result.state === 'manual_action_required') return 200;
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

export async function handleBrowserApiRoutes(context: BrowserHttpRouteContext): Promise<boolean> {
  const { method, url, handlers } = context;

  if (url.pathname === '/api/browser/runtime') {
    if (method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const result = handlers?.getRuntime
      ? await handlers.getRuntime(actorRouteInput(url))
      : commandFailed('not_implemented', 'Browser runtime handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/context') {
    if (method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const result = handlers?.getContext
      ? await handlers.getContext(actorRouteInput(url))
      : commandFailed('not_implemented', 'Browser context handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/resolve') {
    if (method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const uri = normalizeText(url.searchParams.get('uri'));
    if (!uri) {
      context.sendJson(400, commandFailed('missing_uri', 'uri query parameter is required.'));
      return true;
    }
    const result = handlers?.resolve
      ? await handlers.resolve({ uri, ...actorRouteInput(url) })
      : commandFailed('not_implemented', 'Browser resolve handler is not configured.');
    context.sendJson(statusForBrowserResult(result), result);
    return true;
  }

  if (url.pathname === '/api/browser/settings') {
    if (method === 'GET') {
      const result = handlers?.getSettings
        ? await handlers.getSettings(actorRouteInput(url))
        : commandFailed('not_implemented', 'Browser settings handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    if (method === 'PUT') {
      const input = await context.readJsonBody();
      const result = handlers?.updateSettings
        ? await handlers.updateSettings({ ...input, ...actorRouteInput(url, input) })
        : commandFailed('not_implemented', 'Browser settings update handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    context.sendMethodNotAllowed(['GET', 'PUT']);
    return true;
  }

  if (url.pathname === '/api/browser/cache') {
    if (method === 'GET') {
      const result = handlers?.getCache
        ? await handlers.getCache(actorRouteInput(url))
        : commandFailed('not_implemented', 'Browser cache handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    if (method === 'DELETE') {
      const input = await context.readJsonBody();
      const result = handlers?.clearCache
        ? await handlers.clearCache({ ...input, ...actorRouteInput(url, input) })
        : commandFailed('not_implemented', 'Browser cache clear handler is not configured.');
      context.sendJson(statusForBrowserResult(result), result);
      return true;
    }

    context.sendMethodNotAllowed(['GET', 'DELETE']);
    return true;
  }

  if (url.pathname === '/api/browser/actions') {
    if (method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }
    const input = await context.readJsonBody();
    const resourceUri = normalizeText(input.resourceUri);
    const kind = normalizeText(input.kind);
    const payload = input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload)
      ? input.payload as Record<string, unknown>
      : undefined;
    const result = handlers?.runTrustedAction
      ? await handlers.runTrustedAction({
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
}
