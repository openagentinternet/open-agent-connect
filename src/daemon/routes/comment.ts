import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleCommentRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname !== '/api/comment/pin') {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const input = await context.readJsonBody();
  const result = handlers.comment?.pin
    ? await handlers.comment.pin(input)
    : commandFailed('not_implemented', 'Comment pin handler is not configured.');
  context.sendJson(200, result);
  return true;
};
