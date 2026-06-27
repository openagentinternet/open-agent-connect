import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function readPositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function readBoolean(value: string | null): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function readTrimmedQueryValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export const handleAppsRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/apps') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.apps?.list
      ? await handlers.apps.list({
        ...(readTrimmedQueryValue(url.searchParams.get('from')) ? { from: readTrimmedQueryValue(url.searchParams.get('from')) } : {}),
        ...(readTrimmedQueryValue(url.searchParams.get('cursor')) ? { cursor: readTrimmedQueryValue(url.searchParams.get('cursor')) } : {}),
        size: readPositiveInteger(url.searchParams.get('size'), 12),
        refresh: readBoolean(url.searchParams.get('refresh')),
      })
      : commandFailed('not_implemented', 'Apps list handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/apps/publish') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.apps?.publish
      ? await handlers.apps.publish(input)
      : commandFailed('not_implemented', 'Apps publish handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/apps/update') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.apps?.update
      ? await handlers.apps.update(input)
      : commandFailed('not_implemented', 'Apps update handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/apps/delete') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.apps?.delete
      ? await handlers.apps.delete(input)
      : commandFailed('not_implemented', 'Apps delete handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
