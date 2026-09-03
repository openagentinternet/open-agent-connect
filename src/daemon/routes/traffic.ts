import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function readNonNegativeInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.floor(numeric) : undefined;
}

function readPositiveInteger(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : undefined;
}

function readTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Traffic (流量 account-quota gas credit) routes. All owner-scoped: the
 * machine-wide owner identity binds the account, so no actor selection ever
 * applies. Every verb is a POST with a JSON body — the CLI verbs in
 * src/cli/commands/traffic.ts are thin clients over these.
 */
export const handleTrafficRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/traffic/')) {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  // POST /api/traffic/status
  if (url.pathname === '/api/traffic/status') {
    const result = handlers.traffic?.status
      ? await handlers.traffic.status()
      : commandFailed('not_implemented', 'Traffic status handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/mode — body { mode?: 'traffic' | 'selfpay' }; no mode = get.
  if (url.pathname === '/api/traffic/mode') {
    const body = await context.readJsonBody();
    const mode = readTrimmedString(body.mode);
    const result = mode
      ? handlers.traffic?.setMode
        ? await handlers.traffic.setMode({ mode })
        : commandFailed('not_implemented', 'Traffic mode handler is not configured.')
      : handlers.traffic?.getMode
        ? await handlers.traffic.getMode()
        : commandFailed('not_implemented', 'Traffic mode handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/balance
  if (url.pathname === '/api/traffic/balance') {
    const result = handlers.traffic?.getBalance
      ? await handlers.traffic.getBalance()
      : commandFailed('not_implemented', 'Traffic balance handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/ledger — body { cursor?: number|string, limit?: number|string }.
  if (url.pathname === '/api/traffic/ledger') {
    const body = await context.readJsonBody();
    const cursor = readNonNegativeInteger(body.cursor);
    const limit = readPositiveInteger(body.limit);
    const result = handlers.traffic?.getLedger
      ? await handlers.traffic.getLedger({
          ...(cursor ? { cursor } : {}),
          ...(limit ? { limit } : {}),
        })
      : commandFailed('not_implemented', 'Traffic ledger handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/usage
  if (url.pathname === '/api/traffic/usage') {
    const result = handlers.traffic?.getUsage
      ? await handlers.traffic.getUsage()
      : commandFailed('not_implemented', 'Traffic usage handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/claim
  if (url.pathname === '/api/traffic/claim') {
    const result = handlers.traffic?.claim
      ? await handlers.traffic.claim()
      : commandFailed('not_implemented', 'Traffic claim handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/redeem — body { code: string }.
  if (url.pathname === '/api/traffic/redeem') {
    const body = await context.readJsonBody();
    const result = handlers.traffic?.redeem
      ? await handlers.traffic.redeem({ code: readTrimmedString(body.code) })
      : commandFailed('not_implemented', 'Traffic redeem handler is not configured.');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  // POST /api/traffic/api-base — body { action?: 'get'|'set'|'reset', value?: string }.
  if (url.pathname === '/api/traffic/api-base') {
    const body = await context.readJsonBody();
    const action = readTrimmedString(body.action) || 'get';
    const result = action === 'get'
      ? handlers.traffic?.getApiBase
        ? await handlers.traffic.getApiBase()
        : commandFailed('not_implemented', 'Traffic api-base handler is not configured.')
      : action === 'set'
        ? handlers.traffic?.setApiBase
          ? await handlers.traffic.setApiBase({ apiBase: readTrimmedString(body.value) })
          : commandFailed('not_implemented', 'Traffic api-base handler is not configured.')
        : action === 'reset'
          ? handlers.traffic?.resetApiBase
            ? await handlers.traffic.resetApiBase()
            : commandFailed('not_implemented', 'Traffic api-base handler is not configured.')
          : commandFailed('invalid_argument', 'action must be "get", "set", or "reset".');
    context.sendJson(result.ok ? 200 : 400, result);
    return true;
  }

  return false;
};
