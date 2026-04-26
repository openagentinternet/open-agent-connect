import { commandFailed, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readOptionalNumber(value: string | null): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.floor(numeric);
}

function sendConversationResult(
  context: Parameters<RouteHandler>[0],
  result: MetabotCommandResult<unknown>
): void {
  if (result.ok && result.state === 'success') {
    const data = result.data && typeof result.data === 'object'
      ? result.data as Record<string, unknown>
      : {};
    context.sendJson(200, {
      ok: true,
      ...data,
    });
    return;
  }

  context.sendJson(400, {
    ok: false,
    code: normalizeText(result.code) || 'conversation_failed',
    message: normalizeText(result.message) || 'Failed to load private chat conversation.',
  });
}

export const handleChatRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (url.pathname === '/api/chat/private/conversation') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const peer = normalizeText(url.searchParams.get('peer'));
    if (!peer) {
      context.sendJson(400, {
        ok: false,
        code: 'missing_peer',
        message: 'peer query parameter is required.',
      });
      return true;
    }

    const handler = handlers.chat?.privateConversation;
    if (!handler) {
      context.sendJson(501, {
        ok: false,
        code: 'not_implemented',
        message: 'Private chat conversation handler is not configured.',
      });
      return true;
    }

    const result = await handler({
      peer,
      afterIndex: readOptionalNumber(url.searchParams.get('afterIndex')),
      limit: readOptionalNumber(url.searchParams.get('limit')),
    });
    sendConversationResult(context, result);
    return true;
  }

  if (url.pathname !== '/api/chat/private') {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const input = await context.readJsonBody();
  const result = handlers.chat?.private
    ? await handlers.chat.private(input)
    : commandFailed('not_implemented', 'Chat private handler is not configured.');
  context.sendJson(200, result);
  return true;
};
