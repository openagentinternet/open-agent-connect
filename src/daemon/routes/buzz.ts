import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleBuzzRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname !== '/api/buzz/post') {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const input = await context.readJsonBody();
  const result = handlers.buzz?.post
    ? await handlers.buzz.post(input)
    : commandFailed('not_implemented', 'Buzz post handler is not configured.');
  context.sendJson(200, result);
  return true;
};
