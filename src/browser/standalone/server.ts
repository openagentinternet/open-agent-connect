import http from 'node:http';
import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  browserFailure,
  browserManualActionRequired,
  browserSuccess,
  browserWaiting,
  type BrowserCommandResult,
  type BrowserTrustedActionResult as ContractBrowserTrustedActionResult,
} from '@openagentinternet/agent-browser-host-contract';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../../core/contracts/commandResult';
import type { BrowserRuntimeSnapshot } from '../../core/browser/hostTypes';
import type { BrowserContextResult } from '../../core/browser/types';
import type { BrowserHttpHandlers } from '../http';
import { handleBrowserApiRoutes, statusForBrowserResult } from '../http';
import { renderBrowserPageHtml } from '../page';
import {
  createStandaloneBrowserHostAdapter,
  type CreateStandaloneBrowserHostAdapterInput,
  type StandaloneBrowserHostAdapter,
} from './adapter';

const JSON_BODY_LIMIT_BYTES = 1024 * 1024;
const PREVIEW_ASSET_PREFIX = '/api/browser/preview-assets/';

export interface CreateStandaloneBrowserServerInput extends CreateStandaloneBrowserHostAdapterInput {
  adapter?: StandaloneBrowserHostAdapter;
}

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

function isBrowserPagePath(pathname: string): boolean {
  return pathname === '/'
    || pathname === '/browser'
    || pathname === '/ui/browser'
    || /^\/browser\/(?:metaid|metaapp)\/[^/?#]+$/u.test(pathname);
}

function parsePreviewAssetPath(pathname: string): { previewId: string; assetPath: string } | null {
  if (!pathname.startsWith(PREVIEW_ASSET_PREFIX)) {
    return null;
  }
  const rest = pathname.slice(PREVIEW_ASSET_PREFIX.length);
  const parts = rest.split('/').filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  try {
    const [previewId, ...assetParts] = parts.map((part) => decodeURIComponent(part));
    return {
      previewId,
      assetPath: assetParts.join('/'),
    };
  } catch {
    return null;
  }
}

async function serveSharedCss(res: http.ServerResponse): Promise<boolean> {
  const candidates = [
    path.resolve(__dirname, '../../ui/shared.css'),
    path.resolve(__dirname, '../../../src/ui/shared.css'),
  ];
  for (const candidate of candidates) {
    try {
      const css = await fs.readFile(candidate, 'utf8');
      sendText(res, 200, css, 'text/css; charset=utf-8');
      return true;
    } catch {
      // Try the next build/source candidate.
    }
  }
  return false;
}

function browserContextFromRuntime(
  result: MetabotCommandResult<BrowserRuntimeSnapshot>,
): MetabotCommandResult<BrowserContextResult> {
  if (!result.ok) {
    return result as MetabotCommandResult<BrowserContextResult>;
  }
  return commandSuccess({
    usingIdentities: result.data.actors
      .filter((actor) => actor.globalMetaId)
      .map((actor) => ({
        slug: actor.id,
        name: actor.label,
        globalMetaId: actor.globalMetaId ?? '',
        ...(actor.avatar ? { avatar: actor.avatar } : {}),
        isDefault: actor.id === result.data.defaultActor?.id,
      })),
    defaultUsingIdentity: result.data.defaultActor?.globalMetaId ? {
      slug: result.data.defaultActor.id,
      name: result.data.defaultActor.label,
      globalMetaId: result.data.defaultActor.globalMetaId,
      ...(result.data.defaultActor.avatar ? { avatar: result.data.defaultActor.avatar } : {}),
      isDefault: true,
    } : null,
    defaultUri: result.data.defaultUri,
  });
}

function toBrowserCommandResult<TInput, TOutput = TInput>(result: MetabotCommandResult<TInput>): BrowserCommandResult<TOutput> {
  if (result.ok) {
    return browserSuccess(result.data as unknown as TOutput);
  }

  const code = result.code ?? result.state;
  const message = result.message ?? 'Standalone Browser command failed.';
  const options = result.data ? { data: result.data } : undefined;
  if (result.state === 'waiting') {
    return browserWaiting(code, message, {
      ...options,
      pollAfterMs: result.pollAfterMs,
    });
  }
  if (result.state === 'manual_action_required') {
    return browserManualActionRequired(code, message, options);
  }
  return browserFailure(code, message, options);
}

function createBrowserHandlers(adapter: StandaloneBrowserHostAdapter): BrowserHttpHandlers {
  return {
    getRuntime: async (request = {}) => toBrowserCommandResult(await adapter.getRuntime(request)),
    getContext: async (request = {}) => toBrowserCommandResult(browserContextFromRuntime(await adapter.getRuntime(request))),
    resolve: async (request) => toBrowserCommandResult(await adapter.resolveResource(request)),
    getSettings: async (request = {}) => toBrowserCommandResult(await adapter.getSettings(request)),
    updateSettings: async (request) => toBrowserCommandResult(await adapter.updateSettings(request)),
    getCache: async (request = {}) => toBrowserCommandResult(await adapter.getCache(request)),
    clearCache: async (request) => toBrowserCommandResult(await adapter.clearCache(request)),
    runTrustedAction: async (request) => toBrowserCommandResult<
      Awaited<ReturnType<StandaloneBrowserHostAdapter['runTrustedAction']>> extends MetabotCommandResult<infer T> ? T : never,
      ContractBrowserTrustedActionResult
    >(await adapter.runTrustedAction(
      request as Parameters<StandaloneBrowserHostAdapter['runTrustedAction']>[0],
    )),
  };
}

export function createStandaloneBrowserServer(input: CreateStandaloneBrowserServerInput = {}): http.Server {
  const adapter = input.adapter ?? createStandaloneBrowserHostAdapter(input);
  const handlers = createBrowserHandlers(adapter);

  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const method = req.method ?? 'GET';

    try {
      if (isBrowserPagePath(requestUrl.pathname)) {
        if (method !== 'GET') {
          res.setHeader('allow', 'GET');
          sendJson(res, 405, commandFailed('method_not_allowed', 'Expected GET.'));
          return;
        }
        sendHtml(res, 200, await renderBrowserPageHtml());
        return;
      }

      if (requestUrl.pathname === '/ui/shared.css') {
        if (method !== 'GET') {
          res.setHeader('allow', 'GET');
          sendJson(res, 405, commandFailed('method_not_allowed', 'Expected GET.'));
          return;
        }
        if (await serveSharedCss(res)) {
          return;
        }
        sendJson(res, 404, commandFailed('not_found', 'shared.css not found.'));
        return;
      }

      const previewAsset = parsePreviewAssetPath(requestUrl.pathname);
      if (previewAsset) {
        if (method !== 'GET') {
          res.setHeader('allow', 'GET');
          sendJson(res, 405, commandFailed('method_not_allowed', 'Expected GET.'));
          return;
        }
        const result = await adapter.resolvePreviewAsset(previewAsset);
        if (!result.ok) {
          const failure = toBrowserCommandResult(result);
          sendJson(res, statusForBrowserResult(failure), failure);
          return;
        }
        sendText(res, 200, result.data.body, result.data.contentType);
        return;
      }

      const handled = await handleBrowserApiRoutes({
        method,
        url: requestUrl,
        handlers,
        readJsonBody: () => readJsonBody(req),
        sendJson: (status, payload) => sendJson(res, status, payload),
        sendMethodNotAllowed: (allowed) => {
          res.setHeader('allow', allowed.join(', '));
          sendJson(res, 405, commandFailed('method_not_allowed', `Expected ${allowed.join(' or ')}.`));
        },
      });
      if (handled) {
        return;
      }

      sendJson(res, 404, commandFailed('not_found', `No route matched ${requestUrl.pathname}.`));
    } catch (error) {
      sendJson(res, 500, commandFailed('internal_error', error instanceof Error ? error.message : String(error)));
    }
  });
}
