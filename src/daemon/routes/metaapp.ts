import { Buffer } from 'node:buffer';
import { commandFailed } from '../../core/contracts/commandResult';
import type { MetabotCommandResult } from '../../core/contracts/commandResult';
import type { RouteContext } from './types';

const PREVIEW_ASSET_PREFIX = '/api/metaapp/preview-assets/';

function readPositiveInteger(value: string | null, fallback: number): number {
  const normalized = value?.trim();
  if (!normalized || !/^[1-9]\d*$/.test(normalized)) {
    return fallback;
  }
  return Number(normalized);
}

function readBoolean(value: string | null): boolean {
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function readTrimmedQueryValue(value: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isCommandResult(value: unknown): value is MetabotCommandResult<unknown> {
  return Boolean(value && typeof value === 'object' && 'ok' in value && 'state' in value);
}

function parsePreviewAssetPath(pathname: string): { previewId: string; assetPath?: string } | null {
  if (!pathname.startsWith(PREVIEW_ASSET_PREFIX)) {
    return null;
  }

  const raw = pathname.slice(PREVIEW_ASSET_PREFIX.length);
  const pieces = raw.split('/').filter(Boolean);
  if (pieces.length === 0) {
    return null;
  }

  const decoded: string[] = [];
  for (const piece of pieces) {
    try {
      const value = decodeURIComponent(piece);
      if (!value || value === '.' || value === '..' || value.includes('/') || value.includes('\\')) {
        return null;
      }
      decoded.push(value);
    } catch {
      return null;
    }
  }

  const [previewId, ...assetSegments] = decoded;
  return {
    previewId,
    ...(assetSegments.length > 0 ? { assetPath: assetSegments.join('/') } : {}),
  };
}

async function writePreviewAssetResponse(context: RouteContext, result: { body: Buffer | string; contentType: string }): Promise<void> {
  const body = typeof result.body === 'string' ? result.body : Buffer.from(result.body);
  context.res.writeHead(200, {
    'content-type': result.contentType,
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
  });
  context.res.end(body);
}

function previewAssetFailureStatus(result: MetabotCommandResult<unknown>): number {
  switch (result.code) {
    case 'preview_asset_not_found':
    case 'preview_session_not_found':
      return 404;
    case 'preview_session_expired':
      return 410;
    case 'invalid_preview_asset_path':
      return 400;
    default:
      return 500;
  }
}

export const handleMetaAppRoutes = async (context: RouteContext): Promise<boolean> => {
  const { req, url, handlers } = context;

  const previewAssetMatch = parsePreviewAssetPath(url.pathname);
  if (previewAssetMatch) {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const handler = handlers.metaapp?.previewAsset;
    const result = handler
      ? await handler(previewAssetMatch)
      : commandFailed('not_implemented', 'MetaApp preview asset handler is not configured.');

    if (isCommandResult(result)) {
      context.sendJson(result.ok ? 200 : previewAssetFailureStatus(result), result);
      return true;
    }

    await writePreviewAssetResponse(context, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/preview') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.preview
      ? await handlers.metaapp.preview(input)
      : commandFailed('not_implemented', 'MetaApp preview handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/publish') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.publish
      ? await handlers.metaapp.publish(input)
      : commandFailed('not_implemented', 'MetaApp publish handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/publish-project') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.publishProject
      ? await handlers.metaapp.publishProject(input)
      : commandFailed('not_implemented', 'MetaApp project publish handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/update') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.update
      ? await handlers.metaapp.update(input)
      : commandFailed('not_implemented', 'MetaApp update handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/update-project') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.updateProject
      ? await handlers.metaapp.updateProject(input)
      : commandFailed('not_implemented', 'MetaApp project update handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/list') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }
    const result = handlers.metaapp?.list
      ? await handlers.metaapp.list({
        ...(readTrimmedQueryValue(url.searchParams.get('from')) ? { from: readTrimmedQueryValue(url.searchParams.get('from')) } : {}),
        ...(readTrimmedQueryValue(url.searchParams.get('cursor')) ? { cursor: readTrimmedQueryValue(url.searchParams.get('cursor')) } : {}),
        size: readPositiveInteger(url.searchParams.get('size'), 12),
        refresh: readBoolean(url.searchParams.get('refresh')),
      })
      : commandFailed('not_implemented', 'MetaApp list handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/delete') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.delete
      ? await handlers.metaapp.delete(input)
      : commandFailed('not_implemented', 'MetaApp delete handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/share') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.share
      ? await handlers.metaapp.share(input)
      : commandFailed('not_implemented', 'MetaApp share handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapp/comment') {
    if (req.method !== 'POST') {
      context.sendMethodNotAllowed(['POST']);
      return true;
    }

    const input = await context.readJsonBody();
    const result = handlers.metaapp?.comment
      ? await handlers.metaapp.comment(input)
      : commandFailed('not_implemented', 'MetaApp comment handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  if (url.pathname === '/api/metaapps') {
    if (req.method !== 'GET') {
      context.sendMethodNotAllowed(['GET']);
      return true;
    }

    const handler = handlers.metaapp?.list;
    const result = handler
      ? await handler({
        ...(url.searchParams.get('from') ? { from: url.searchParams.get('from') as string } : {}),
        ...(readBoolean(url.searchParams.get('mine')) ? { mine: true } : {}),
        ...(readBoolean(url.searchParams.get('refresh')) ? { refresh: true } : {}),
        ...(url.searchParams.get('pinId') ? { pinId: url.searchParams.get('pinId') as string } : {}),
        ...(url.searchParams.get('firstPinId') ? { firstPinId: url.searchParams.get('firstPinId') as string } : {}),
      })
      : commandFailed('not_implemented', 'MetaApp list handler is not configured.');
    context.sendJson(200, result);
    return true;
  }

  return false;
};
