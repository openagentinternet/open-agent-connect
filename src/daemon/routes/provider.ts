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

  if (url.pathname === '/api/provider/refunds/initiated') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.provider?.getInitiatedRefunds
      ? await handlers.provider.getInitiatedRefunds()
      : commandFailed('not_implemented', 'Provider initiated refunds handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/provider/refunds') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.provider?.getRefunds
      ? await handlers.provider.getRefunds()
      : commandFailed('not_implemented', 'Provider refunds handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/provider/order') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const result = handlers.provider?.inspectOrder
      ? await handlers.provider.inspectOrder({
          orderId: url.searchParams.get('orderId') ?? '',
          paymentTxid: url.searchParams.get('paymentTxid') ?? '',
        })
      : commandFailed('not_implemented', 'Provider order inspection handler is not configured.');
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

  if (url.pathname === '/api/provider/refund/settle') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.provider?.settleRefund
      ? await handlers.provider.settleRefund({
          orderId: typeof input.orderId === 'string' ? input.orderId : '',
          paymentTxid: typeof input.paymentTxid === 'string' ? input.paymentTxid : '',
        })
      : commandFailed('not_implemented', 'Provider refund settlement handler is not configured.');
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
