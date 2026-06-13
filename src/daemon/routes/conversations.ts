import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.floor(parsed);
}

function readLimit(value: string | null, fallback = 50): number {
  const parsed = readOptionalNumber(value);
  if (!parsed || parsed <= 0) return fallback;
  return Math.min(100, Math.max(1, parsed));
}

function sendCommandResult(
  context: Parameters<RouteHandler>[0],
  result: MetabotCommandResult<unknown>,
): void {
  context.sendJson(result.ok ? 200 : 400, result);
}

function requireLocal(context: Parameters<RouteHandler>[0]): string | null {
  const local = normalizeText(context.url.searchParams.get('local'));
  if (!local) {
    context.sendJson(400, commandFailed('missing_local', 'local query parameter is required.'));
    return null;
  }
  return local;
}

function sseEventName(event: unknown): string {
  const record = event && typeof event === 'object' && !Array.isArray(event)
    ? event as { type?: unknown }
    : {};
  return normalizeText(record.type) || 'conversation-update';
}

async function streamConversationEvents(
  context: Parameters<RouteHandler>[0],
  local: string,
): Promise<void> {
  const handler = context.handlers.conversations?.streamEvents;
  if (!handler) {
    context.sendJson(501, commandFailed('not_implemented', 'Conversation event handler is not configured.'));
    return;
  }

  const { req, res } = context;
  const abortController = new AbortController();
  const stream = await handler({ local, signal: abortController.signal });
  let closed = false;
  req.on('close', () => {
    closed = true;
    abortController.abort();
  });

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  for await (const event of stream) {
    if (closed) break;
    res.write(`event: ${sseEventName(event)}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  if (!closed) res.end();
}

export const handleConversationRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (
    url.pathname !== '/api/conversations'
    && url.pathname !== '/api/conversations/messages'
    && url.pathname !== '/api/conversations/events'
  ) {
    return false;
  }
  if (req.method !== 'GET') {
    context.sendMethodNotAllowed(['GET']);
    return true;
  }

  if (url.pathname === '/api/conversations') {
    const local = requireLocal(context);
    if (!local) return true;
    const result = handlers.conversations?.list
      ? await handlers.conversations.list({
          local,
          limit: readLimit(url.searchParams.get('limit')),
        })
      : commandFailed('not_implemented', 'Conversation list handler is not configured.');
    sendCommandResult(context, result);
    return true;
  }

  if (url.pathname === '/api/conversations/messages') {
    const local = requireLocal(context);
    if (!local) return true;
    const peer = normalizeText(url.searchParams.get('peer'));
    if (!peer) {
      context.sendJson(400, commandFailed('missing_peer', 'peer query parameter is required.'));
      return true;
    }
    const before = readOptionalNumber(url.searchParams.get('before'));
    const after = readOptionalNumber(url.searchParams.get('after'));
    const result = handlers.conversations?.messages
      ? await handlers.conversations.messages({
          local,
          peer,
          ...(before !== undefined ? { before } : {}),
          ...(after !== undefined ? { after } : {}),
          limit: readLimit(url.searchParams.get('limit')),
        })
      : commandFailed('not_implemented', 'Conversation messages handler is not configured.');
    sendCommandResult(context, result);
    return true;
  }

  if (url.pathname === '/api/conversations/events') {
    const local = requireLocal(context);
    if (!local) return true;
    await streamConversationEvents(context, local);
    return true;
  }

  return false;
};
