import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

/** `/api/surf/*` — the MetaWeb surf HTTP surface (status/run/enable/disable/budget). */
export const handleSurfRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/surf/')) {
    return false;
  }
  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }
  const verb = url.pathname.slice('/api/surf/'.length);
  const input = await context.readJsonBody();
  const group = handlers.surf;
  if (!group?.status || !group.run || !group.enable || !group.disable || !group.budget) {
    context.sendJson(200, commandFailed('not_implemented', 'Surf handlers are not configured.'));
    return true;
  }
  switch (verb) {
    case 'status': {
      context.sendJson(200, await group.status(input as { from?: string; limit?: number }));
      return true;
    }
    case 'run': {
      context.sendJson(200, await group.run(input as {
        from?: string;
        trigger?: 'manual-chat' | 'manual-ui' | 'pre-dream';
        wait?: boolean;
      }));
      return true;
    }
    case 'enable': {
      context.sendJson(200, await group.enable(input as { from?: string }));
      return true;
    }
    case 'disable': {
      context.sendJson(200, await group.disable(input as { from?: string }));
      return true;
    }
    case 'budget': {
      context.sendJson(200, await group.budget(input as { from?: string; budget?: number }));
      return true;
    }
    default:
      context.sendJson(200, commandFailed('unknown_command', `Unknown surf route: ${verb}`));
      return true;
  }
};
