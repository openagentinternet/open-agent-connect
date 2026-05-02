import { commandFailed } from '../../core/contracts/commandResult';
import type { RouteHandler } from './types';

export const handleLlmRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  // GET /api/llm/runtimes
  if (url.pathname === '/api/llm/runtimes' && req.method === 'GET') {
    const result = handlers.llm?.listRuntimes
      ? await handlers.llm.listRuntimes()
      : commandFailed('not_implemented', 'LLM runtime handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  // POST /api/llm/runtimes/discover
  if (url.pathname === '/api/llm/runtimes/discover' && req.method === 'POST') {
    const result = handlers.llm?.discoverRuntimes
      ? await handlers.llm.discoverRuntimes()
      : commandFailed('not_implemented', 'LLM discover handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  // GET /api/llm/bindings/:slug
  const bindingsSlugMatch = url.pathname.match(/^\/api\/llm\/bindings\/([^/]+)$/);
  if (bindingsSlugMatch && req.method === 'GET') {
    const slug = decodeURIComponent(bindingsSlugMatch[1]);
    const result = handlers.llm?.listBindings
      ? await handlers.llm.listBindings({ slug })
      : commandFailed('not_implemented', 'LLM bindings handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  // PUT /api/llm/bindings/:slug
  if (bindingsSlugMatch && req.method === 'PUT') {
    const slug = decodeURIComponent(bindingsSlugMatch[1]);
    const body = await context.readJsonBody();
    const result = handlers.llm?.upsertBindings
      ? await handlers.llm.upsertBindings({ slug, bindings: Array.isArray(body.bindings) ? body.bindings : [] })
      : commandFailed('not_implemented', 'LLM bindings handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  // DELETE /api/llm/bindings/:id
  const bindingIdMatch = url.pathname.match(/^\/api\/llm\/bindings\/([^/]+)\/delete$/);
  if (bindingIdMatch && req.method === 'DELETE') {
    const bindingId = decodeURIComponent(bindingIdMatch[1]);
    const result = handlers.llm?.removeBinding
      ? await handlers.llm.removeBinding({ bindingId })
      : commandFailed('not_implemented', 'LLM remove binding handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  // GET /api/llm/preferred-runtime/:slug
  const preferredMatch = url.pathname.match(/^\/api\/llm\/preferred-runtime\/([^/]+)$/);
  if (preferredMatch && req.method === 'GET') {
    const slug = decodeURIComponent(preferredMatch[1]);
    const result = handlers.llm?.getPreferredRuntime
      ? await handlers.llm.getPreferredRuntime({ slug })
      : commandFailed('not_implemented', 'LLM preferred runtime handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  // PUT /api/llm/preferred-runtime/:slug
  if (preferredMatch && req.method === 'PUT') {
    const slug = decodeURIComponent(preferredMatch[1]);
    const body = await context.readJsonBody();
    const runtimeId = typeof body.runtimeId === 'string' ? body.runtimeId : null;
    const result = handlers.llm?.setPreferredRuntime
      ? await handlers.llm.setPreferredRuntime({ slug, runtimeId })
      : commandFailed('not_implemented', 'LLM preferred runtime handler not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
