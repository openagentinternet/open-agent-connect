/**
 * /api/dream/* routes. Thin dispatch onto handlers.dream; every response is a
 * MetabotCommandResult JSON body with HTTP 200, matching the schedule route
 * style. Reads are GET (query string), the manual run is POST (JSON body).
 */

import { commandFailed } from '../../core/contracts/commandResult';
import type { MetabotDaemonHttpHandlers, RouteHandler } from './types';

type DreamHandlerGroup = NonNullable<MetabotDaemonHttpHandlers['dream']>;
type DreamVerb = keyof DreamHandlerGroup;

const GET_VERBS: Record<string, DreamVerb> = {
  '/api/dream/status': 'status',
  '/api/dream/due': 'due',
  '/api/dream/summaries': 'summaries',
  '/api/dream/self-identity': 'selfIdentity',
  '/api/dream/capabilities': 'capabilities',
};

const POST_VERBS: Record<string, DreamVerb> = {
  '/api/dream/run': 'run',
};

function queryToInput(url: URL): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  url.searchParams.forEach((value, key) => {
    input[key] = value;
  });
  return input;
}

export const handleDreamRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/dream/')) {
    return false;
  }

  const postVerb = POST_VERBS[url.pathname];
  const getVerb = GET_VERBS[url.pathname];
  if (!postVerb && !getVerb) {
    context.sendJson(200, commandFailed('unknown_command', `Unknown dream route: ${url.pathname}`));
    return true;
  }

  const expectedMethod = postVerb ? 'POST' : 'GET';
  if (req.method !== expectedMethod) {
    context.sendMethodNotAllowed([expectedMethod]);
    return true;
  }

  const verb = (postVerb ?? getVerb) as DreamVerb;
  const handler = handlers.dream?.[verb];
  if (!handler) {
    context.sendJson(501, {
      ok: false,
      code: 'not_implemented',
      message: `Dream handler is not configured: ${String(verb)}`,
    });
    return true;
  }

  const input = postVerb ? await context.readJsonBody() : queryToInput(url);
  if (postVerb && typeof input.date === 'string' && input.date.trim() && !/^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) {
    context.sendJson(200, commandFailed('invalid_flag', 'date must be YYYY-MM-DD.'));
    return true;
  }
  const dispatch = handler as (rawInput: Record<string, unknown>) => Promise<unknown>;
  const result = await dispatch(input);
  context.sendJson(200, result);
  return true;
};
