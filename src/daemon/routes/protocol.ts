import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

type ProtocolWriteVerb = 'publish' | 'update';

export const handleProtocolRoutes: RouteHandler = async (context) => {
  const { req, url } = context;

  const verbMatch = /^\/api\/protocol\/(publish|update)$/.exec(url.pathname);
  if (!verbMatch) {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const verb = verbMatch[1] as ProtocolWriteVerb;
  const handler = context.handlers.protocol?.[verb];
  const result = handler
    ? await handler(await context.readJsonBody())
    : commandFailed('not_implemented', `Protocol ${verb} handler is not configured.`);
  context.sendJson(200, result);
  return true;
};
