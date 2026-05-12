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

export const handleServicesRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/services/publish') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.services?.publish
      ? await handlers.services.publish(input)
      : commandFailed('not_implemented', 'Services publish handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/publish/skills') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const slug = url.searchParams.get('slug')?.trim();
    const result = handlers.services?.listPublishSkills
      ? await handlers.services.listPublishSkills(slug ? { slug } : {})
      : commandFailed('not_implemented', 'Services publish skills handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/my') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.services?.listMyServices
      ? await handlers.services.listMyServices({
          page: readPositiveInteger(url.searchParams.get('page'), 1),
          pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
          refresh: readBoolean(url.searchParams.get('refresh')),
        })
      : commandFailed('not_implemented', 'My services list handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/my/orders') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const serviceId = url.searchParams.get('serviceId')?.trim() ?? '';
    const result = handlers.services?.listMyServiceOrders
      ? await handlers.services.listMyServiceOrders({
          serviceId,
          page: readPositiveInteger(url.searchParams.get('page'), 1),
          pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
          refresh: readBoolean(url.searchParams.get('refresh')),
        })
      : commandFailed('not_implemented', 'My service orders handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/my/modify') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.services?.modifyMyService
      ? await handlers.services.modifyMyService(input)
      : commandFailed('not_implemented', 'My service modify handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/my/revoke') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.services?.revokeMyService
      ? await handlers.services.revokeMyService(input)
      : commandFailed('not_implemented', 'My service revoke handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/call') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.services?.call
      ? await handlers.services.call(input)
      : commandFailed('not_implemented', 'Services call handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/execute') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.services?.execute
      ? await handlers.services.execute(input)
      : commandFailed('not_implemented', 'Services execute handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/services/rate') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.services?.rate
      ? await handlers.services.rate(input)
      : commandFailed('not_implemented', 'Services rate handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
