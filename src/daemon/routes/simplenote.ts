import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleSimpleNoteRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname !== '/api/simplenote/post') {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const input = await context.readJsonBody();
  const result = handlers.simplenote?.post
    ? await handlers.simplenote.post(input)
    : commandFailed('not_implemented', 'SimpleNote post handler is not configured.');
  context.sendJson(200, result);
  return true;
};
