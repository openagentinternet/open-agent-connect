/**
 * /api/sessions/* routes — the local session directory (`metabot sessions *`
 * CLI surface over HTTP, local session adapters P1). `list` is the read
 * verb (GET, `?all=true` includes offline records); it also refreshes
 * machine-local presence from the passive discovery scans. All responses
 * are MetabotCommandResult JSON bodies with HTTP 200.
 */

import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleSessionsRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/sessions/')) {
    return false;
  }

  // GET /api/sessions/list — presence directory (discovery merged in).
  if (url.pathname === '/api/sessions/list') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const handler = handlers.sessions?.list;
    if (!handler) {
      context.sendJson(501, commandFailed('not_implemented', 'Sessions list handler is not configured.'));
      return true;
    }
    const all = url.searchParams.get('all') === 'true';
    context.sendJson(200, await handler({ all }));
    return true;
  }

  context.sendJson(404, commandFailed('not_found', `No route matched ${url.pathname}.`));
  return true;
};
