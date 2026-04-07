import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleChainRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname !== '/api/chain/write') {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const input = await context.readJsonBody();
  const result = handlers.chain?.write
    ? await handlers.chain.write(input)
    : commandFailed('not_implemented', 'Chain write handler is not configured.');
  context.sendJson(200, result);
  return true;
};
