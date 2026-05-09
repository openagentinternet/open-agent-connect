import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleConfigRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname !== '/api/config') {
    return false;
  }

  if (req.method === 'GET') {
    const result = handlers.config?.get
      ? await handlers.config.get()
      : commandFailed('not_implemented', 'Config get handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  if (req.method === 'PUT') {
    const input = await context.readJsonBody();
    const result = handlers.config?.set
      ? await handlers.config.set(input)
      : commandFailed('not_implemented', 'Config set handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  context.sendMethodNotAllowed(['GET', 'PUT']);
  return true;
};
