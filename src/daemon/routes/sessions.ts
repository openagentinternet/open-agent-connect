/**
 * /api/sessions/* routes — the local session directory and mail queue
 * (`metabot sessions *` CLI + `metabot mcp` server over HTTP, local session
 * adapters P1/P2a). `list` is a GET that also refreshes machine-local
 * presence from the passive discovery scans; register/inbox/message verbs
 * are POSTs (all localhost-only like the rest of the daemon). All responses
 * are MetabotCommandResult JSON bodies with HTTP 200.
 */

import { commandFailed } from '../../core/contracts/commandResult';
import type { MetabotDaemonHttpHandlers, RouteHandler } from './types';

type SessionsHandlerGroup = NonNullable<MetabotDaemonHttpHandlers['sessions']>;
type SessionsVerb = keyof SessionsHandlerGroup;

const POST_VERBS: Record<string, SessionsVerb> = {
  '/api/sessions/register': 'register',
  '/api/sessions/inbox/check': 'inboxCheck',
  '/api/sessions/inbox/pending': 'inboxPending',
  '/api/sessions/inbox/enqueue': 'inboxEnqueue',
  '/api/sessions/messages/status': 'messageStatus',
  '/api/sessions/bind': 'bind',
  '/api/sessions/unbind': 'unbind',
  '/api/sessions/messages/send': 'sendMessage',
};

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

  const verb = POST_VERBS[url.pathname];
  if (!verb) {
    context.sendJson(404, commandFailed('not_found', `No route matched ${url.pathname}.`));
    return true;
  }
  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }
  const handler = handlers.sessions?.[verb];
  if (!handler) {
    context.sendJson(501, {
      ok: false,
      code: 'not_implemented',
      message: `Sessions handler is not configured: ${String(verb)}`,
    });
    return true;
  }

  const input = await context.readJsonBody();
  const dispatch = handler as (rawInput: Record<string, unknown>) => Promise<unknown>;
  context.sendJson(200, await dispatch(input));
  return true;
};
