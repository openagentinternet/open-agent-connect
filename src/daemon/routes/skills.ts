import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteContext } from './types';

export const handleSkillRoutes = async (context: RouteContext): Promise<boolean> => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/skills/publish') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.skills?.publish
      ? await handlers.skills.publish(input)
      : commandFailed('not_implemented', 'Skills publish handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
