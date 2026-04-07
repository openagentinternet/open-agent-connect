import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleFileRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname !== '/api/file/upload') {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const input = await context.readJsonBody();
  const result = handlers.file?.upload
    ? await handlers.file.upload(input)
    : commandFailed('not_implemented', 'File upload handler is not configured.');
  context.sendJson(200, result);
  return true;
};
