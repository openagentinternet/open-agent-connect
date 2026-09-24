/**
 * /api/user/* routes — the machine-wide human owner identity (the `metabot
 * user *` CLI surface over HTTP, additive next to the Bot-profile
 * /api/identity/* routes). `who` is the read verb (GET); every write is POST,
 * so the local-daemon cross-site boundary guards them exactly like the
 * sibling write routes. All responses are MetabotCommandResult JSON bodies
 * with HTTP 200, matching the schedule route style.
 */

import { commandFailed } from '../../core/contracts/commandResult';
import type { MetabotDaemonHttpHandlers, RouteHandler } from './types';

type UserHandlerGroup = NonNullable<MetabotDaemonHttpHandlers['user']>;
type UserVerb = keyof UserHandlerGroup;

const POST_VERBS: Record<string, UserVerb> = {
  '/api/user/create': 'create',
  '/api/user/import': 'import',
  '/api/user/rename': 'rename',
  '/api/user/reveal': 'reveal',
  '/api/user/delete': 'delete',
};

function validateInput(verb: UserVerb, input: Record<string, unknown>): void | { code: string; message: string } {
  const trimmed = (key: string): string => (typeof input[key] === 'string' ? input[key].trim() : '');
  if (verb === 'import' && !trimmed('mnemonic')) {
    return { code: 'missing_mnemonic', message: 'mnemonic is required.' };
  }
  if (verb === 'rename' && !trimmed('name')) {
    return { code: 'missing_name', message: 'name is required.' };
  }
  return undefined;
}

export const handleUserRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/user/')) {
    return false;
  }

  // GET /api/user/who — the owner identity read (public fields only).
  if (url.pathname === '/api/user/who') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const handler = handlers.user?.who;
    if (!handler) {
      context.sendJson(501, commandFailed('not_implemented', 'User who handler is not configured.'));
      return true;
    }
    context.sendJson(200, await handler());
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
  const handler = handlers.user?.[verb];
  if (!handler) {
    context.sendJson(501, {
      ok: false,
      code: 'not_implemented',
      message: `User handler is not configured: ${String(verb)}`,
    });
    return true;
  }

  const input = await context.readJsonBody();
  const invalid = validateInput(verb, input);
  if (invalid) {
    context.sendJson(200, commandFailed(invalid.code, invalid.message));
    return true;
  }
  const dispatch = handler as (rawInput: Record<string, unknown>) => Promise<unknown>;
  context.sendJson(200, await dispatch(input));
  return true;
};
