import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandFailed } from '../../core/contracts/commandResult';
import { LARGE_UPLOAD_MAX_BYTES } from '../../core/files/uploadLargeFile';
import type { RouteHandler } from './types';

const AVATAR_ROUTE_PATH = '/api/file/avatar';
const FILE_UPLOAD_ROUTE_PATH = '/api/file/upload';
const FILE_UPLOAD_LARGE_ROUTE_PATH = '/api/file/upload-large';
const FILE_UPLOAD_TEMP_PREFIX = 'oac-file-upload-';
const FILE_UPLOAD_DEFAULT_FILE_NAME = 'upload.bin';
const FILE_UPLOAD_MAX_LABEL = '50 MiB';
const DEFAULT_P2P_CONTENT_BASE = 'http://localhost:7281';
const AVATAR_FETCH_TIMEOUT_MS = 4500;
// Avatars rarely change. Cache the resolved bytes per pin id in-process and
// tell browsers to cache too, so switching conversations / reloading the page
// does not re-fetch every avatar from chain (each fetch was ~0.5-1s).
const AVATAR_CACHE_TTL_MS = 30 * 60 * 1000;
const AVATAR_BROWSER_CACHE_MAX_AGE = 30 * 60;
type AvatarCacheEntry = {
  body: Buffer;
  contentType: string;
  expiresAt: number;
};
const avatarContentCache = new Map<string, AvatarCacheEntry>();
const PIN_CONTENT_PATTERNS = [
  /^\/content\/([^/?#]+)/iu,
  /^\/metafile-indexer\/content\/([^/?#]+)/iu,
  /^\/metafile-indexer\/thumbnail\/([^/?#]+)/iu,
  /^\/metafile-indexer\/api\/v1\/files\/content\/([^/?#]+)/iu,
  /^\/metafile-indexer\/api\/v1\/files\/accelerate\/content\/([^/?#]+)/iu,
  /^\/metafile-indexer\/api\/v1\/users\/avatar\/accelerate\/([^/?#]+)/iu,
];
const EXTENSION_BEARING_METAFILE_PIN_PATTERN = /^([0-9a-f]{64}i0)(?:\.[a-z0-9][a-z0-9+-]{0,31})?$/iu;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeHeaderValue(value: string | string[] | undefined): string {
  return normalizeText(Array.isArray(value) ? value[0] : value);
}

function normalizeUploadFileName(value: string | null): string {
  const decoded = normalizeText(value);
  const baseName = path.basename(decoded).replace(/\0/gu, '').trim();
  return baseName || FILE_UPLOAD_DEFAULT_FILE_NAME;
}

function normalizeUploadContentType(value: string | string[] | undefined): string {
  const contentType = normalizeHeaderValue(value).split(';')[0]?.trim();
  return contentType || 'application/octet-stream';
}

function isRawFileUploadMode(url: URL): boolean {
  return normalizeText(url.searchParams.get('mode')).toLowerCase() === 'raw';
}

function stripQueryAndFragment(value: string): string {
  return value.split(/[?#]/u)[0] ?? value;
}

function normalizeMetafilePinReference(value: string): string {
  const stripped = stripQueryAndFragment(value).trim();
  const match = stripped.match(EXTENSION_BEARING_METAFILE_PIN_PATTERN);
  return match?.[1] ?? stripped;
}

function isLikelyPinId(value: string): boolean {
  return /^[0-9a-f]{64}(?:i\d+)?$/iu.test(value) || /^[A-Za-z0-9._:-]{8,256}$/u.test(value);
}

function extractAvatarPinId(reference: unknown): string {
  const normalized = normalizeText(reference);
  if (!normalized || normalized.startsWith('data:') || normalized.startsWith('blob:')) {
    return '';
  }
  if (/^metafile:\/\//iu.test(normalized)) {
    const pinId = normalizeMetafilePinReference(normalized.slice('metafile://'.length).trim());
    return isLikelyPinId(pinId) ? pinId : '';
  }

  const path = (() => {
    if (/^https?:\/\//iu.test(normalized)) {
      try {
        return new URL(normalized).pathname;
      } catch {
        return '';
      }
    }
    return normalized;
  })();

  for (const pattern of PIN_CONTENT_PATTERNS) {
    const match = path.match(pattern);
    if (match?.[1]) {
      const pinId = normalizeMetafilePinReference(decodeURIComponent(match[1]));
      return isLikelyPinId(pinId) ? pinId : '';
    }
  }

  const bare = normalizeMetafilePinReference(normalized);
  if (!bare.includes('/') && !bare.includes('\\') && isLikelyPinId(bare)) {
    return bare;
  }
  return '';
}

function avatarContentUrls(pinId: string): string[] {
  const encodedPinId = encodeURIComponent(pinId);
  const localBase = normalizeText(process.env.METABOT_P2P_LOCAL_BASE) || DEFAULT_P2P_CONTENT_BASE;
  return [
    `${localBase.replace(/\/+$/u, '')}/content/${encodedPinId}`,
    `https://file.metaid.io/metafile-indexer/content/${encodedPinId}`,
    `https://file.metaid.io/metafile-indexer/api/v1/users/avatar/accelerate/${encodedPinId}?process=thumbnail`,
    `https://file.metaid.io/metafile-indexer/api/v1/files/accelerate/content/${encodedPinId}?process=thumbnail`,
    `https://file.metaid.io/metafile-indexer/api/v1/files/content/${encodedPinId}`,
  ];
}

function isRejectedAvatarMime(contentType: string): boolean {
  return /^text\//iu.test(contentType) || /(?:application\/json|[+/]json)(?:\s*;|$)/iu.test(contentType);
}

async function fetchAvatarContent(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AVATAR_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      return null;
    }
    const contentType = normalizeText(response.headers.get('content-type')).split(';')[0]?.trim() || 'application/octet-stream';
    if (isRejectedAvatarMime(contentType)) {
      return null;
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (!body.length) {
      return null;
    }
    return { body, contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function serveAvatarRoute(context: Parameters<RouteHandler>[0]): Promise<boolean> {
  const { req, url } = context;
  if (url.pathname !== AVATAR_ROUTE_PATH) {
    return false;
  }
  if (req.method !== 'GET') {
    context.sendMethodNotAllowed(['GET']);
    return true;
  }

  const pinId = extractAvatarPinId(url.searchParams.get('ref'));
  if (!pinId) {
    context.sendJson(400, commandFailed('invalid_avatar_ref', 'A valid MetaID avatar pin reference is required.'));
    return true;
  }

  const sendAvatar = (body: Buffer, contentType: string) => {
    context.res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': `public, max-age=${AVATAR_BROWSER_CACHE_MAX_AGE}`,
    });
    context.res.end(body);
  };

  const cached = avatarContentCache.get(pinId);
  if (cached && cached.expiresAt > Date.now()) {
    sendAvatar(cached.body, cached.contentType);
    return true;
  }

  for (const contentUrl of avatarContentUrls(pinId)) {
    const resolved = await fetchAvatarContent(contentUrl);
    if (resolved) {
      avatarContentCache.set(pinId, {
        body: resolved.body,
        contentType: resolved.contentType,
        expiresAt: Date.now() + AVATAR_CACHE_TTL_MS,
      });
      sendAvatar(resolved.body, resolved.contentType);
      return true;
    }
  }

  context.sendJson(404, commandFailed('avatar_not_found', `Avatar content was not found for ${pinId}.`));
  return true;
}

async function serveRawFileUploadRoute(context: Parameters<RouteHandler>[0], isLargeUpload: boolean): Promise<void> {
  const { req, url, handlers } = context;
  const handler = isLargeUpload ? handlers.file?.uploadLarge : handlers.file?.upload;
  if (!handler) {
    context.sendJson(
      400,
      commandFailed(
        'not_implemented',
        isLargeUpload
          ? 'Large file upload handler is not configured.'
          : 'File upload handler is not configured.',
      ),
    );
    return;
  }

  const from = normalizeText(url.searchParams.get('from'));
  const fileName = normalizeUploadFileName(url.searchParams.get('fileName'));
  const contentType = normalizeUploadContentType(req.headers['content-type']);
  let tempDir = '';

  try {
    tempDir = await mkdtemp(path.join(os.tmpdir(), FILE_UPLOAD_TEMP_PREFIX));
    const filePath = path.join(tempDir, fileName);
    const { bytes } = await context.streamRawBodyToFile(filePath, LARGE_UPLOAD_MAX_BYTES);
    if (bytes === 0) {
      context.sendJson(400, commandFailed('file_upload_empty', 'File upload requires non-empty file data.'));
      return;
    }

    const input: Record<string, unknown> = {
      filePath,
      fileName,
      contentType,
    };
    if (from) {
      input.from = from;
    }
    const result = await handler(input);
    context.sendJson(200, result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/too large/iu.test(message)) {
      context.sendJson(
        413,
        commandFailed('file_upload_too_large', `File upload must be ${FILE_UPLOAD_MAX_LABEL} or smaller.`),
      );
      return;
    }
    throw error;
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  }
}

export const handleFileRoutes: RouteHandler = async (context) => {
  const { req, url, handlers } = context;

  if (await serveAvatarRoute(context)) {
    return true;
  }

  if (url.pathname !== FILE_UPLOAD_ROUTE_PATH && url.pathname !== FILE_UPLOAD_LARGE_ROUTE_PATH) {
    return false;
  }

  if (req.method !== 'POST') {
    context.sendMethodNotAllowed(['POST']);
    return true;
  }

  const isLargeUpload = url.pathname === FILE_UPLOAD_LARGE_ROUTE_PATH;
  if (isRawFileUploadMode(url)) {
    await serveRawFileUploadRoute(context, isLargeUpload);
    return true;
  }

  const input = await context.readJsonBody();
  const handler = isLargeUpload ? handlers.file?.uploadLarge : handlers.file?.upload;
  const result = handler
    ? await handler(input)
    : commandFailed(
        'not_implemented',
        isLargeUpload
          ? 'Large file upload handler is not configured.'
          : 'File upload handler is not configured.',
      );
  context.sendJson(200, result);
  return true;
};
