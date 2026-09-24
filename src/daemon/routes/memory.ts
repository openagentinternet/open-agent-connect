/**
 * /api/memory/* routes — the standalone memory-UI surface. Thin dispatch
 * onto handlers.memory; every response is a MetabotCommandResult JSON body
 * with HTTP 200, matching the schedule route style. GET verbs carry their
 * input in the query string; POST verbs take a JSON body where `from` selects
 * the bot and every other field is the entry payload (same shape the CLI
 * verbs read from --payload-file).
 */

import { commandFailed } from '../../core/contracts/commandResult';
import type { MetabotDaemonHttpHandlers, RouteHandler } from './types';

type MemoryHandlerGroup = NonNullable<MetabotDaemonHttpHandlers['memory']>;
type MemoryVerb = keyof MemoryHandlerGroup;

const GET_VERBS: Record<string, MemoryVerb> = {
  '/api/memory/list': 'list',
  '/api/memory/knowledge/list': 'knowledgeList',
  '/api/memory/impressions/list': 'impressionsList',
  '/api/memory/impressions/show': 'impressionsShow',
  '/api/memory/policy': 'policyGet',
  '/api/memory/hygiene/status': 'hygieneStatus',
  '/api/memory/hygiene/due': 'hygieneDue',
  '/api/memory/hygiene/config': 'hygieneConfigGet',
};

const POST_VERBS: Record<string, MemoryVerb> = {
  '/api/memory/search': 'search',
  '/api/memory/recall': 'recall',
  '/api/memory/add': 'add',
  '/api/memory/update': 'update',
  '/api/memory/delete': 'delete',
  '/api/memory/unarchive': 'unarchive',
  '/api/memory/knowledge/upsert': 'knowledgeUpsert',
  '/api/memory/knowledge/update': 'knowledgeUpdate',
  '/api/memory/knowledge/archive': 'knowledgeArchive',
  '/api/memory/knowledge/delete': 'knowledgeDelete',
  '/api/memory/policy': 'policySet',
  '/api/memory/hygiene/run': 'hygieneRun',
  '/api/memory/hygiene/config': 'hygieneConfigSet',
};

const DELETE_VERBS: Record<string, MemoryVerb> = {
  '/api/memory/policy': 'policyDelete',
};

/** Payload-carrying verbs that require one id inside the payload. */
const ID_REQUIRED: ReadonlySet<string> = new Set([
  'update',
  'delete',
  'unarchive',
  'knowledgeUpdate',
  'knowledgeArchive',
  'knowledgeDelete',
]);

/** Verbs whose handler input is the request body itself (plus from), not a
 *  wrapped payload. */
const RAW_INPUT_VERBS: ReadonlySet<string> = new Set(['hygieneRun']);

function queryToInput(url: URL): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  url.searchParams.forEach((value, key) => {
    input[key] = value;
  });
  return input;
}

function readLimit(value: unknown): number | 'invalid' | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 'invalid';
}

function validatePayload(verb: MemoryVerb, payload: Record<string, unknown>): void | { code: string; message: string } {
  if (ID_REQUIRED.has(verb) && typeof payload.id !== 'string') {
    return { code: 'invalid_payload', message: 'payload.id is required.' };
  }
  if (verb === 'add' && typeof payload.text !== 'string') {
    return { code: 'invalid_payload', message: 'payload.text is required.' };
  }
  if (verb === 'search' && typeof payload.query !== 'string') {
    return { code: 'invalid_payload', message: 'payload.query is required.' };
  }
  if (verb === 'knowledgeUpsert'
    && (typeof payload.topic !== 'string' || typeof payload.summary !== 'string')) {
    return { code: 'invalid_payload', message: 'payload.topic and payload.summary are required.' };
  }
  return undefined;
}

export const handleMemoryRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;
  if (!url.pathname.startsWith('/api/memory/')) {
    return false;
  }

  const method = req.method ?? 'GET';
  const verb = (method === 'POST'
    ? POST_VERBS[url.pathname]
    : method === 'GET'
      ? GET_VERBS[url.pathname]
      : method === 'DELETE'
        ? DELETE_VERBS[url.pathname]
        : undefined) as MemoryVerb | undefined;
  if (!verb) {
    const allowed = [
      GET_VERBS[url.pathname] ? 'GET' : null,
      POST_VERBS[url.pathname] ? 'POST' : null,
      DELETE_VERBS[url.pathname] ? 'DELETE' : null,
    ].filter(Boolean) as string[];
    if (allowed.length > 0) {
      context.sendMethodNotAllowed(allowed);
    } else {
      context.sendJson(200, commandFailed('unknown_command', `Unknown memory route: ${url.pathname}`));
    }
    return true;
  }

  const handler = handlers.memory?.[verb];
  if (!handler) {
    context.sendJson(501, {
      ok: false,
      code: 'not_implemented',
      message: `Memory handler is not configured: ${String(verb)}`,
    });
    return true;
  }

  let input: Record<string, unknown>;
  if (method === 'POST') {
    const body = await context.readJsonBody();
    if (RAW_INPUT_VERBS.has(verb)) {
      input = body;
    } else {
      const { from, ...payload } = body;
      const invalid = validatePayload(verb, payload);
      if (invalid) {
        context.sendJson(200, commandFailed(invalid.code, invalid.message));
        return true;
      }
      input = { ...(typeof from === 'string' ? { from } : {}), payload };
    }
  } else {
    input = queryToInput(url);
    if (verb === 'list' || verb === 'knowledgeList') {
      const limit = readLimit(input.limit);
      if (limit === 'invalid') {
        context.sendJson(200, commandFailed('invalid_flag', 'limit must be a positive integer.'));
        return true;
      }
      if (limit !== undefined) input.limit = limit;
    }
    if (verb === 'list') {
      // Query strings arrive as text; only an explicit true enables the
      // flags (any other value leaves them unset).
      for (const flag of ['includeDeleted', 'includeArchived']) {
        if (input[flag] === true || input[flag] === 'true') {
          input[flag] = true;
        } else {
          delete input[flag];
        }
      }
    }
    if (verb === 'impressionsShow'
      && (typeof input.subject !== 'string' || !input.subject.trim())) {
      context.sendJson(200, commandFailed('missing_subject', 'subject is required.'));
      return true;
    }
  }

  const dispatch = handler as (rawInput: Record<string, unknown>) => Promise<unknown>;
  const result = await dispatch(input);
  context.sendJson(200, result);
  return true;
};
