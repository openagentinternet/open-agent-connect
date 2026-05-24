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

export const handleProductsRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/products/skills') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const from = url.searchParams.get('from')?.trim();
    const result = handlers.products?.listPublishSkills
      ? await handlers.products.listPublishSkills(from ? { from } : {})
      : commandFailed('not_implemented', 'Product publish skills handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/products/publish') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.products?.publish
      ? await handlers.products.publish(input)
      : commandFailed('not_implemented', 'Product publish handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/products/buy') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.products?.buy
      ? await handlers.products.buy(input)
      : commandFailed('not_implemented', 'Product buy handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/products/owned') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.products?.listOwned
      ? await handlers.products.listOwned({
          ...(url.searchParams.get('from')?.trim() ? { from: url.searchParams.get('from')!.trim() } : {}),
          ...(url.searchParams.has('all') ? { all: readBoolean(url.searchParams.get('all')) } : {}),
          page: readPositiveInteger(url.searchParams.get('page'), 1),
          pageSize: readPositiveInteger(url.searchParams.get('pageSize'), 20),
          refresh: readBoolean(url.searchParams.get('refresh')),
        })
      : commandFailed('not_implemented', 'Owned products list handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
