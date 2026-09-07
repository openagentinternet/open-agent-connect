import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

type QandaWriteVerb = 'question' | 'answer' | 'like';

export const handleQandaRoutes: RouteHandler = async (context) => {
  const { req, url } = context;

  const verbMatch = /^\/api\/qanda\/(question|answer|like)$/.exec(url.pathname);
  if (!verbMatch) {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const verb = verbMatch[1] as QandaWriteVerb;
  const handler = context.handlers.qanda?.[verb];
  const result = handler
    ? await handler(await context.readJsonBody())
    : commandFailed('not_implemented', `Q&A ${verb} handler is not configured.`);
  context.sendJson(200, result);
  return true;
};
