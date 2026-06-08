import { handleBrowserApiRoutes } from '../../browser/http';
import type { RouteHandler } from './types';

export const handleBrowserRoutes: RouteHandler = async (context) => handleBrowserApiRoutes({
  method: context.req.method ?? 'GET',
  url: context.url,
  handlers: context.handlers.browser,
  readJsonBody: context.readJsonBody,
  sendJson: context.sendJson,
  sendMethodNotAllowed: context.sendMethodNotAllowed,
});
