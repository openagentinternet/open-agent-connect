import {
  handleBrowserApiRoutes,
  registerBrowserTabSink,
  type BrowserTabEventSink,
} from '../../browser/http';
import type { RouteHandler } from './types';

// The POST /api/browser/tabs/open route is handled by handleBrowserApiRoutes
// below (it fans out via broadcastBrowserTabOpen from the browser module). The
// SSE route here is the daemon->page transport: each connected Browser page
// subscribes, and the POST route broadcasts open-tab events through the shared
// sink registry. ABC tabs are client-only; this carries transport only.
export const handleBrowserRoutes: RouteHandler = async (context) => {
  const { req, url } = context;

  if (url.pathname === '/api/browser/events') {
    if (req.method === 'GET') {
      await streamBrowserTabEvents(context);
      return true;
    }
    context.sendMethodNotAllowed(['GET']);
    return true;
  }

  return handleBrowserApiRoutes({
    method: context.req.method ?? 'GET',
    url: context.url,
    handlers: context.handlers.browser,
    readJsonBody: context.readJsonBody,
    sendJson: context.sendJson,
    sendMethodNotAllowed: context.sendMethodNotAllowed,
  });
};

async function streamBrowserTabEvents(context: Parameters<RouteHandler>[0]): Promise<void> {
  const { req, res } = context;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');

  // Each SSE connection registers a sink that writes a single
  // `agent-browser:open-tab` event frame. The page-side listener (injected by
  // buildBrowserPageDefinition) consumes it and calls AgentBrowserTabs.openTab.
  const sink: BrowserTabEventSink = (event) => {
    try {
      res.write(`event: ${event.type}\n`);
      res.write(`data: ${JSON.stringify({ uri: event.uri })}\n\n`);
    } catch {
      /* a closed/broken connection is unregistered on req close below */
    }
  };
  const unregister = registerBrowserTabSink(sink);

  req.on('close', () => {
    unregister();
    try { res.end(); } catch { /* already ended */ }
  });
}
