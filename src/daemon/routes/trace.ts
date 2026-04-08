import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

const TRACE_ROUTE_PREFIX = '/api/trace/';

export const handleTraceRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (!url.pathname.startsWith(TRACE_ROUTE_PREFIX)) {
    return false;
  }

  if (req.method !== 'GET') {
    context.sendMethodNotAllowed(['GET']);
    return true;
  }

  const routeSuffix = decodeURIComponent(url.pathname.slice(TRACE_ROUTE_PREFIX.length)).trim();
  if (routeSuffix.endsWith('/watch')) {
    const traceId = routeSuffix.slice(0, -'/watch'.length).trim();
    const result = handlers.trace?.watchTrace
      ? await handlers.trace.watchTrace({ traceId })
      : '';
    if (!result) {
      context.sendJson(404, commandFailed('trace_not_found', `Trace watch not found: ${traceId}`));
      return true;
    }
    context.sendText(200, result, 'application/x-ndjson; charset=utf-8');
    return true;
  }

  const traceId = routeSuffix;
  const result = handlers.trace?.getTrace
    ? await handlers.trace.getTrace({ traceId })
    : commandFailed('not_implemented', 'Trace handler is not configured.');
  context.sendJson(200, result);
  return true;
};
