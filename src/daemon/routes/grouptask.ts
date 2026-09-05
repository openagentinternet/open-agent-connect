/**
 * /api/grouptask/* routes. Thin dispatch onto handlers.grouptask; every
 * response is a MetabotCommandResult JSON body with HTTP 200 (the result
 * envelope carries success/failure), matching the chat/buzz route style.
 */

import type { MetabotDaemonHttpHandlers, RouteHandler } from './types';

type GroupTaskHandlerGroup = NonNullable<MetabotDaemonHttpHandlers['grouptask']>;
type GroupTaskVerb = keyof GroupTaskHandlerGroup;

const POST_VERBS: Record<string, GroupTaskVerb> = {
  '/api/grouptask/create': 'create',
  '/api/grouptask/message': 'postMessage',
  '/api/grouptask/close': 'close',
  '/api/grouptask/reopen': 'reopen',
  '/api/grouptask/member/kick': 'kickMember',
  '/api/grouptask/member/status': 'setMemberStatus',
  '/api/grouptask/rename': 'rename',
  '/api/grouptask/pin': 'setPinned',
  '/api/grouptask/archive': 'setArchived',
  '/api/grouptask/invite': 'invite',
  '/api/grouptask/supervise': 'supervise',
  '/api/grouptask/deliverable/delete': 'deleteDeliverable',
  '/api/grouptask/relay/drain': 'relayDrain',
  '/api/grouptask/staffing/propose': 'staffingPropose',
  '/api/grouptask/staffing/decide': 'staffingDecide',
  '/api/grouptask/staffing/create': 'staffingCreate',
  '/api/grouptask/staffing/search': 'staffingSearch',
};

const GET_VERBS: Record<string, GroupTaskVerb> = {
  '/api/grouptask/list': 'list',
  '/api/grouptask/detail': 'detail',
  '/api/grouptask/messages': 'messages',
  '/api/grouptask/invites': 'invites',
  '/api/grouptask/collabs': 'collabs',
  '/api/grouptask/collab-messages': 'collabMessages',
  '/api/grouptask/health': 'health',
  '/api/grouptask/staffing/list': 'staffingList',
};

function queryToInput(url: URL): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  url.searchParams.forEach((value, key) => {
    input[key] = value;
  });
  return input;
}

export const handleGroupTaskRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/grouptask/')) {
    return false;
  }

  const postVerb = POST_VERBS[url.pathname];
  const getVerb = GET_VERBS[url.pathname];
  if (!postVerb && !getVerb) {
    return false;
  }

  const expectedMethod = postVerb ? 'POST' : 'GET';
  if (req.method !== expectedMethod) {
    context.sendMethodNotAllowed([expectedMethod]);
    return true;
  }

  const verb = (postVerb ?? getVerb) as GroupTaskVerb;
  const handler = handlers.grouptask?.[verb];
  if (!handler) {
    context.sendJson(501, {
      ok: false,
      code: 'not_implemented',
      message: `Group task handler is not configured: ${String(verb)}`,
    });
    return true;
  }

  const input = postVerb ? await context.readJsonBody() : queryToInput(url);
  const result = await handler(input);
  context.sendJson(200, result);
  return true;
};
