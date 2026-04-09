import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleProviderRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/provider/summary') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.provider?.getSummary
      ? await handlers.provider.getSummary()
      : commandFailed('not_implemented', 'Provider summary handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/provider/presence') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.provider?.setPresence
      ? await handlers.provider.setPresence({
          enabled: input.enabled === true,
        })
      : commandFailed('not_implemented', 'Provider presence handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/provider/refund/confirm') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.provider?.confirmRefund
      ? await handlers.provider.confirmRefund({
          orderId: typeof input.orderId === 'string' ? input.orderId : '',
        })
      : commandFailed('not_implemented', 'Provider refund confirmation handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
