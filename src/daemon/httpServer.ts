import http from 'node:http';
import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { commandFailed } from '../core/contracts/commandResult';
import { handleConfigRoutes } from './routes/config';
import { handleBuzzRoutes } from './routes/buzz';
import { handleChainRoutes } from './routes/chain';
import { handleDaemonRoutes } from './routes/daemon';
import { handleChatRoutes } from './routes/chat';
import { handleConversationRoutes } from './routes/conversations';
import { handleFileRoutes } from './routes/file';
import { handleIdentityRoutes } from './routes/identity';
import { handleNetworkRoutes } from './routes/network';
import { handleProviderRoutes } from './routes/provider';
import { handleMetaAppRoutes } from './routes/metaapp';
import { handleServicesRoutes } from './routes/services';
import { handleTraceRoutes } from './routes/trace';
import { handleUiRoutes } from './routes/ui';
import { handleLlmRoutes } from './routes/llm';
import { handleBotRoutes } from './routes/bot';
import { handleBrowserRoutes } from './routes/browser';
import type { MetabotDaemonHttpHandlers, RouteContext, RouteHandler } from './routes/types';

const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const LOCAL_DAEMON_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

const ROUTES: RouteHandler[] = [
  handleConfigRoutes,
  handleBuzzRoutes,
  handleChainRoutes,
  handleDaemonRoutes,
  handleChatRoutes,
  handleConversationRoutes,
  handleFileRoutes,
  handleIdentityRoutes,
  handleNetworkRoutes,
  handleProviderRoutes,
  handleMetaAppRoutes,
  handleServicesRoutes,
  handleTraceRoutes,
  handleBrowserRoutes,
  handleUiRoutes,
  handleLlmRoutes,
  handleBotRoutes,
];

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = `${JSON.stringify(payload, null, 2)}\n`;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res: http.ServerResponse, status: number, html: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
}

function sendText(
  res: http.ServerResponse,
  status: number,
  body: string | Buffer,
  contentType = 'text/plain; charset=utf-8',
): void {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] ?? '').trim();
  return String(value ?? '').trim();
}

function readHostAuthority(value: string | string[] | undefined): string {
  const raw = normalizeHeaderValue(value).toLowerCase();
  if (!raw) return '';
  try {
    return new URL(`http://${raw}`).host.toLowerCase();
  } catch {
    return raw;
  }
}

function readHostName(value: string | string[] | undefined): string {
  const raw = normalizeHeaderValue(value);
  if (!raw) return '';
  try {
    return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return raw.split(':')[0]?.replace(/^\[|\]$/g, '').toLowerCase() ?? '';
  }
}

function isLocalDaemonHostName(hostname: string): boolean {
  return LOCAL_DAEMON_HOSTS.has(hostname.replace(/^\[|\]$/g, '').toLowerCase());
}

function isUnsafeMethod(method: string | undefined): boolean {
  const normalized = String(method || 'GET').toUpperCase();
  return normalized !== 'GET' && normalized !== 'HEAD' && normalized !== 'OPTIONS';
}

function rejectLocalDaemonBoundary(req: http.IncomingMessage, url: URL): { code: string; message: string } | null {
  const hostName = readHostName(req.headers.host);
  if (hostName && !isLocalDaemonHostName(hostName)) {
    return {
      code: 'forbidden_host',
      message: 'Local daemon requests must use localhost or a loopback address.',
    };
  }

  if (!url.pathname.startsWith('/api/') || !isUnsafeMethod(req.method)) {
    return null;
  }

  const fetchSite = normalizeHeaderValue(req.headers['sec-fetch-site']).toLowerCase();
  if (fetchSite === 'cross-site') {
    return {
      code: 'forbidden_origin',
      message: 'Cross-site requests are not allowed for local daemon API writes.',
    };
  }

  const origin = normalizeHeaderValue(req.headers.origin);
  if (!origin) return null;

  try {
    const parsedOrigin = new URL(origin);
    const originHostName = parsedOrigin.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['http:', 'https:'].includes(parsedOrigin.protocol) || !isLocalDaemonHostName(originHostName)) {
      return {
        code: 'forbidden_origin',
        message: 'Cross-origin requests are not allowed for local daemon API writes.',
      };
    }
    const requestAuthority = readHostAuthority(req.headers.host);
    if (requestAuthority && parsedOrigin.host.toLowerCase() !== requestAuthority) {
      return {
        code: 'forbidden_origin',
        message: 'Origin must match the local daemon host for API writes.',
      };
    }
  } catch {
    return {
      code: 'forbidden_origin',
      message: 'Invalid Origin header for local daemon API write.',
    };
  }

  return null;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += bufferChunk.byteLength;
    if (totalBytes > JSON_BODY_LIMIT_BYTES) {
      throw new Error('Request body is too large.');
    }
    chunks.push(bufferChunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected a JSON object request body.');
  }
  return parsed as Record<string, unknown>;
}

async function readRawBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  const normalizedMaxBytes = Math.max(0, Math.floor(maxBytes));

  for await (const chunk of req) {
    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    totalBytes += bufferChunk.byteLength;
    if (totalBytes > normalizedMaxBytes) {
      throw new Error(`Request body is too large. Maximum size is ${normalizedMaxBytes} bytes.`);
    }
    chunks.push(bufferChunk);
  }

  return chunks.length ? Buffer.concat(chunks, totalBytes) : Buffer.alloc(0);
}

async function streamRawBodyToFile(
  req: http.IncomingMessage,
  filePath: string,
  maxBytes: number,
): Promise<{ bytes: number }> {
  const normalizedMaxBytes = Math.max(0, Math.floor(maxBytes));
  const stream = createWriteStream(filePath);
  const streamError = new Promise<never>((_resolve, reject) => {
    stream.once('error', reject);
  });
  streamError.catch(() => {});
  let totalBytes = 0;

  try {
    for await (const chunk of req) {
      const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += bufferChunk.byteLength;
      if (totalBytes > normalizedMaxBytes) {
        throw new Error(`Request body is too large. Maximum size is ${normalizedMaxBytes} bytes.`);
      }
      if (!stream.write(bufferChunk)) {
        await Promise.race([once(stream, 'drain'), streamError]);
      }
    }

    stream.end();
    await Promise.race([once(stream, 'finish'), streamError]);
    return { bytes: totalBytes };
  } catch (error) {
    stream.destroy();
    await rm(filePath, { force: true }).catch(() => {});
    throw error;
  }
}

export function createHttpServer(handlers: MetabotDaemonHttpHandlers = {}): http.Server {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const boundaryRejection = rejectLocalDaemonBoundary(req, requestUrl);
    if (boundaryRejection) {
      sendJson(res, 403, commandFailed(boundaryRejection.code, boundaryRejection.message));
      return;
    }

    const context: RouteContext = {
      req,
      res,
      url: requestUrl,
      handlers,
      readJsonBody: () => readJsonBody(req),
      readRawBody: (maxBytes) => readRawBody(req, maxBytes),
      streamRawBodyToFile: (filePath, maxBytes) => streamRawBodyToFile(req, filePath, maxBytes),
      sendJson: (status, payload) => sendJson(res, status, payload),
      sendHtml: (status, html) => sendHtml(res, status, html),
      sendText: (status, body, contentType) => sendText(res, status, body, contentType),
      sendMethodNotAllowed: (allowed) => {
        res.setHeader('allow', allowed.join(', '));
        sendJson(res, 405, commandFailed('method_not_allowed', `Expected ${allowed.join(' or ')}.`));
      },
    };

    try {
      for (const route of ROUTES) {
        const handled = await route(context);
        if (handled) {
          return;
        }
      }

      context.sendJson(404, commandFailed('not_found', `No route matched ${requestUrl.pathname}.`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (requestUrl.pathname.startsWith('/ui/')) {
        context.sendHtml(500, `<!doctype html><html><body><h1>Open Agent Connect UI Error</h1><pre>${message}</pre></body></html>`);
        return;
      }
      context.sendJson(500, commandFailed('internal_error', message));
    }
  });
}
