import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandFailed, commandSuccess, type MetabotCommandResult } from '../contracts/commandResult';
import { buildMetafileContentUrls } from '../files/metafileUrls';
import { normalizeMetaAppPinId } from '../metaapp/pinId';
import type { MetaAppGalleryRecord } from '../metaapp/types';
import { extractMetaAppZipArchive } from '../metaapp/zipArchive';

const METAAPP_PROTOCOL_PATH = '/protocols/metaapp';
const DEFAULT_MANAPI_BASE_URL = 'https://manapi.metaid.io';
const HTML_CONTENT_TYPE = 'text/html';
const ZIP_CONTENT_TYPE = 'application/zip';

type FetchResponse = {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
  };
  json?(): Promise<unknown>;
  arrayBuffer?(): Promise<ArrayBuffer>;
};

type FetchFn = (url: string) => Promise<FetchResponse>;

export interface ResolveMetaAppPinToRecordInput {
  pinId: string;
  fetch?: FetchFn;
  manApiBaseUrl?: string;
  makeTempDir?: () => Promise<string>;
  createPreviewSession?: (input: { artifactDir: string; indexFile: string }) => Promise<{
    previewId?: string;
    localPreviewUrl: string;
  }> | {
    previewId?: string;
    localPreviewUrl: string;
  };
  now?: () => number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
}

function normalizeBaseUrl(value: unknown): string {
  const normalized = normalizeText(value) || DEFAULT_MANAPI_BASE_URL;
  return normalized.replace(/\/+$/u, '') || DEFAULT_MANAPI_BASE_URL;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  const object = readObject(value);
  if (object) {
    return object;
  }
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  try {
    return readObject(JSON.parse(text));
  } catch {
    return null;
  }
}

function unwrapPinRecord(payload: unknown): Record<string, unknown> | null {
  const root = readObject(payload);
  if (!root) {
    return null;
  }
  const data = readObject(root.data);
  if (data) {
    return readObject(data.pin) ?? data;
  }
  if ('path' in root || 'contentSummary' in root || 'content' in root) {
    return root;
  }
  return null;
}

function normalizeTimestampMs(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? Math.trunc(value * 1000) : Math.trunc(value);
  }
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric < 10_000_000_000 ? Math.trunc(numeric * 1000) : Math.trunc(numeric);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}

function normalizeIndexFile(value: unknown): string | null {
  const text = normalizeText(value) || 'index.html';
  if (!text || text.includes('\\') || path.posix.isAbsolute(text) || path.win32.isAbsolute(text)) {
    return null;
  }
  const normalized = path.posix.normalize(text.replace(/^\.\//u, ''));
  if (!normalized || normalized === '.' || normalized.split('/').includes('..')) {
    return null;
  }
  return normalized;
}

function isZipContent(contentType: string, contentReference: string): boolean {
  const normalizedType = contentType.toLowerCase();
  return normalizedType === ZIP_CONTENT_TYPE
    || normalizedType.includes('/zip')
    || normalizedType.includes('+zip')
    || contentReference.split(/[?#]/u, 1)[0].toLowerCase().endsWith('.zip');
}

function extractContentReference(value: unknown): string {
  const direct = normalizeText(value);
  if (direct) {
    return direct;
  }
  const object = readObject(value);
  if (!object) {
    return '';
  }
  return normalizeText(
    object.uri
    ?? object.url
    ?? object.metafileUri
    ?? object.metafile
    ?? object.pinId,
  );
}

function extractMetafilePinId(reference: string): string | null {
  if (!/^metafile:\/\//iu.test(reference)) {
    return null;
  }
  const withoutScheme = reference.slice('metafile://'.length).split(/[?#]/u, 1)[0] ?? '';
  if (!withoutScheme || withoutScheme.includes('/') || withoutScheme.includes('\\')) {
    return null;
  }
  const withoutExtension = withoutScheme.replace(/\.[A-Za-z0-9]+$/u, '');
  return withoutExtension || null;
}

function downloadUrlsForReference(reference: string): string[] {
  const metafilePinId = extractMetafilePinId(reference);
  if (metafilePinId) {
    const urls = buildMetafileContentUrls(metafilePinId);
    return [urls.accelerateUrl, urls.contentUrl, urls.legacyContentUrl];
  }
  if (/^https?:\/\//iu.test(reference)) {
    return [reference];
  }
  return [];
}

async function downloadZipArchive(input: {
  fetch: FetchFn;
  contentReference: string;
}): Promise<Buffer | null> {
  const urls = downloadUrlsForReference(input.contentReference);
  for (const url of urls) {
    const response = await input.fetch(url).catch(() => null);
    if (!response?.ok || !response.arrayBuffer) {
      continue;
    }
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > 0) {
      return body;
    }
  }
  return null;
}

async function defaultMakeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'metabot-browser-metaapp-'));
}

async function defaultCreatePreviewSession(input: { artifactDir: string; indexFile: string }): Promise<{ localPreviewUrl: string }> {
  return {
    localPreviewUrl: `file://${path.join(input.artifactDir, input.indexFile)}`,
  };
}

async function findArtifactRootForIndexFile(rootDir: string, indexFile: string): Promise<string> {
  const directPath = path.join(rootDir, indexFile);
  try {
    const stat = await fs.stat(directPath);
    if (stat.isFile()) {
      return rootDir;
    }
  } catch {
    // Try the common packaged-app shape where all entries are under one root folder.
  }

  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const directories = entries.filter((entry) => (
    entry.isDirectory()
    && entry.name !== '__MACOSX'
    && !entry.name.startsWith('.')
  ));
  if (directories.length !== 1) {
    return rootDir;
  }
  const nestedRoot = path.join(rootDir, directories[0].name);
  try {
    const stat = await fs.stat(path.join(nestedRoot, indexFile));
    return stat.isFile() ? nestedRoot : rootDir;
  } catch {
    return rootDir;
  }
}

function buildRecord(input: {
  pinId: string;
  manApiBaseUrl: string;
  pinRecord: Record<string, unknown>;
  protocol: Record<string, unknown>;
  contentReference: string;
  sourceContentType: string;
  rendererContentType: string;
  indexFile: string;
  localPreviewUrl?: string;
  now: number;
}): MetaAppGalleryRecord {
  const title = normalizeText(input.protocol.title ?? input.protocol.name ?? input.protocol.appName ?? input.protocol.app_name)
    || input.pinId;
  const appName = normalizeText(input.protocol.appName ?? input.protocol.app_name) || title;
  const ownerGlobalMetaId = normalizeText(
    input.pinRecord.ownerGlobalMetaId
    ?? input.pinRecord.globalMetaId
    ?? input.pinRecord.global_meta_id
    ?? input.pinRecord.metaid
    ?? input.pinRecord.metaId,
  );
  const ownerAddress = normalizeText(input.pinRecord.ownerAddress ?? input.pinRecord.address);
  const version = normalizeText(input.protocol.version) || '1.0.0';

  return {
    pinId: input.pinId,
    firstPinId: normalizeText(input.protocol.firstPinId ?? input.protocol.first_pin_id) || input.pinId,
    operation: 'create',
    title,
    appName,
    prompt: normalizeText(input.protocol.prompt) || undefined,
    icon: normalizeText(input.protocol.icon) || undefined,
    coverImg: normalizeText(input.protocol.coverImg ?? input.protocol.cover_img ?? input.protocol.cover) || undefined,
    intro: normalizeText(input.protocol.intro) || undefined,
    version,
    runtime: normalizeText(input.protocol.runtime) || 'browser',
    indexFile: input.indexFile,
    code: normalizeText(input.protocol.code) || input.contentReference,
    content: input.contentReference,
    contentType: input.rendererContentType,
    codeType: normalizeText(input.protocol.codeType ?? input.protocol.code_type) || input.sourceContentType,
    tags: Array.isArray(input.protocol.tags)
      ? input.protocol.tags.map((tag) => normalizeText(tag)).filter(Boolean)
      : [],
    ownerGlobalMetaId,
    ownerAddress,
    network: normalizeText(input.protocol.network ?? input.protocol.chain) || 'mvc',
    metawebUrl: `${input.manApiBaseUrl}/pin/${encodeURIComponent(input.pinId)}`,
    localUiUrl: input.localPreviewUrl,
    runUrl: input.localPreviewUrl,
    updatedAt: normalizeTimestampMs(input.pinRecord.timestamp ?? input.pinRecord.updatedAt ?? input.pinRecord.updated_at, input.now),
    source: 'indexer',
    raw: {
      source: 'manapi',
      pin: input.pinRecord,
      protocol: input.protocol,
      sourceContentType: input.sourceContentType,
    },
  };
}

export async function resolveMetaAppPinToRecord(input: ResolveMetaAppPinToRecordInput): Promise<MetabotCommandResult<MetaAppGalleryRecord>> {
  const pinId = normalizeMetaAppPinId(input.pinId);
  if (!pinId) {
    return commandFailed('invalid_browser_uri', 'metaapp:// requires a 64-hex pinId ending in i0.');
  }

  const fetchImpl = input.fetch ?? globalThis.fetch;
  if (!fetchImpl) {
    return commandFailed('browser_resolve_failed', 'A fetch implementation is required to resolve MetaApp pins.');
  }

  const manApiBaseUrl = normalizeBaseUrl(input.manApiBaseUrl);
  const pinUrl = `${manApiBaseUrl}/pin/${encodeURIComponent(pinId)}`;

  try {
    const response = await fetchImpl(pinUrl);
    if (!response.ok || !response.json) {
      return commandFailed(
        response.status === 404 ? 'browser_resource_not_found' : 'browser_resolve_failed',
        response.status === 404 ? 'MetaApp pin was not found.' : `MetaApp pin lookup failed with HTTP ${response.status}.`,
      );
    }

    const pinRecord = unwrapPinRecord(await response.json());
    if (!pinRecord) {
      return commandFailed('browser_resolve_failed', 'MetaApp pin lookup returned an invalid response.');
    }

    const protocolPath = normalizeText(pinRecord.path);
    if (protocolPath !== METAAPP_PROTOCOL_PATH) {
      return commandFailed(
        'browser_protocol_mismatch',
        `Pin path ${protocolPath || '(empty)'} is not a MetaApp protocol pin.`,
        { data: { expectedPath: METAAPP_PROTOCOL_PATH, actualPath: protocolPath || null } },
      );
    }

    const protocol = parseJsonObject(pinRecord.contentSummary ?? pinRecord.contentBody ?? pinRecord.content);
    if (!protocol) {
      return commandFailed('browser_resolve_failed', 'MetaApp protocol contentSummary is not valid JSON.');
    }

    const contentReference = extractContentReference(protocol.content ?? protocol.code ?? protocol.metafile ?? protocol.file);
    const sourceContentType = normalizeText(protocol.contentType ?? protocol.content_type ?? protocol.codeType ?? protocol.code_type)
      || ZIP_CONTENT_TYPE;
    const indexFile = normalizeIndexFile(protocol.indexFile ?? protocol.index_file);
    if (!indexFile) {
      return commandFailed('browser_resolve_failed', 'MetaApp indexFile must be a relative path inside the app package.');
    }
    if (!contentReference) {
      return commandFailed('browser_resolve_failed', 'MetaApp protocol is missing a content reference.');
    }

    let localPreviewUrl: string | undefined;
    let rendererContentType = sourceContentType;
    if (isZipContent(sourceContentType, contentReference)) {
      const archive = await downloadZipArchive({ fetch: fetchImpl, contentReference });
      if (!archive) {
        return commandFailed('browser_resolve_failed', 'MetaApp ZIP content could not be downloaded.');
      }

      const tempDir = await (input.makeTempDir ?? defaultMakeTempDir)();
      await extractMetaAppZipArchive({ archive, outDir: tempDir });
      const artifactDir = await findArtifactRootForIndexFile(tempDir, indexFile);
      const previewSession = await (input.createPreviewSession ?? defaultCreatePreviewSession)({
        artifactDir,
        indexFile,
      });
      localPreviewUrl = previewSession.localPreviewUrl;
      rendererContentType = HTML_CONTENT_TYPE;
    }

    return commandSuccess(buildRecord({
      pinId,
      manApiBaseUrl,
      pinRecord,
      protocol,
      contentReference,
      sourceContentType,
      rendererContentType,
      indexFile,
      localPreviewUrl,
      now: (input.now ?? Date.now)(),
    }));
  } catch (error) {
    return commandFailed('browser_resolve_failed', error instanceof Error ? error.message : String(error));
  }
}
