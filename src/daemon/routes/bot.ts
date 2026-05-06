import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function normalizeLimit(value: string | null): number {
  const parsed = value ? Number.parseInt(value, 10) : 50;
  if (!Number.isFinite(parsed) || parsed <= 0) return 50;
  return Math.min(100, Math.max(1, parsed));
}

function normalizeSlug(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return '';
  }
}

function normalizeName(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const handleBotRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/bot/stats' && req.method === 'GET') {
    const result = handlers.bot?.getStats
      ? await handlers.bot.getStats()
      : commandFailed('not_implemented', 'MetaBot stats handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/profiles' && req.method === 'GET') {
    const result = handlers.bot?.listProfiles
      ? await handlers.bot.listProfiles()
      : commandFailed('not_implemented', 'MetaBot profile list handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/profiles' && req.method === 'POST') {
    const body = await context.readJsonBody();
    if (!normalizeName(body.name)) {
      context.sendJson(400, commandFailed('missing_name', 'MetaBot name is required.'));
      return true;
    }
    const result = handlers.bot?.createProfile
      ? await handlers.bot.createProfile(body)
      : commandFailed('not_implemented', 'MetaBot profile create handler not configured.');
    context.sendJson(result.ok ? 201 : 400, result);
    return true;
  }

  const walletMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/wallet$/);
  if (walletMatch && req.method === 'GET') {
    const slug = normalizeSlug(walletMatch[1]);
    const result = handlers.bot?.getWallet
      ? await handlers.bot.getWallet({ slug })
      : commandFailed('not_implemented', 'MetaBot wallet handler not configured.');
    context.sendJson(result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400, result);
    return true;
  }

  const backupMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)\/backup$/);
  if (backupMatch && req.method === 'GET') {
    const slug = normalizeSlug(backupMatch[1]);
    const result = handlers.bot?.getBackup
      ? await handlers.bot.getBackup({ slug })
      : commandFailed('not_implemented', 'MetaBot backup handler not configured.');
    context.sendJson(result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400, result);
    return true;
  }

  const profileMatch = url.pathname.match(/^\/api\/bot\/profiles\/([^/]+)$/);
  if (profileMatch && req.method === 'GET') {
    const slug = normalizeSlug(profileMatch[1]);
    const result = handlers.bot?.getProfile
      ? await handlers.bot.getProfile({ slug })
      : commandFailed('not_implemented', 'MetaBot profile handler not configured.');
    context.sendJson(result.ok ? 200 : 404, result);
    return true;
  }

  if (profileMatch && req.method === 'PUT') {
    const slug = normalizeSlug(profileMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.bot?.updateProfile
      ? await handlers.bot.updateProfile({ ...body, slug })
      : commandFailed('not_implemented', 'MetaBot profile update handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  if (profileMatch && req.method === 'DELETE') {
    const slug = normalizeSlug(profileMatch[1]);
    const result = handlers.bot?.deleteProfile
      ? await handlers.bot.deleteProfile({ slug })
      : commandFailed('not_implemented', 'MetaBot profile delete handler not configured.');
    const status = result.ok ? 200 : result.code === 'profile_not_found' ? 404 : 400;
    context.sendJson(status, result);
    return true;
  }

  if (url.pathname === '/api/bot/runtimes' && req.method === 'GET') {
    const result = handlers.bot?.listRuntimes
      ? await handlers.bot.listRuntimes()
      : commandFailed('not_implemented', 'MetaBot runtime handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/runtimes/discover' && req.method === 'POST') {
    const result = handlers.bot?.discoverRuntimes
      ? await handlers.bot.discoverRuntimes()
      : commandFailed('not_implemented', 'MetaBot runtime discovery handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/bot/sessions' && req.method === 'GET') {
    const slug = normalizeSlug(url.searchParams.get('slug') ?? '');
    const limit = normalizeLimit(url.searchParams.get('limit'));
    const result = handlers.bot?.listSessions
      ? await handlers.bot.listSessions({ ...(slug ? { slug } : {}), limit })
      : commandFailed('not_implemented', 'MetaBot session list handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
