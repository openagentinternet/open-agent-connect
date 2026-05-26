import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetaAppPreviewAsset, MetaAppPreviewSession } from './types';

const DEFAULT_TTL_MS = 30 * 60 * 1000;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

class MetaAppPreviewSessionError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'MetaAppPreviewSessionError';
    this.code = code;
  }
}

function normalizeRelativeAssetPath(assetPath: string | undefined, indexFile: string): string {
  const trimmed = typeof assetPath === 'string' ? assetPath.trim() : '';
  const relativePath = trimmed || indexFile;
  if (
    !relativePath
    || relativePath.includes('\\')
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
  ) {
    throw new MetaAppPreviewSessionError('invalid_preview_asset_path', 'Preview asset path must be relative.');
  }

  const normalized = path.posix.normalize(relativePath.replace(/^\.\//, ''));
  if (!normalized || normalized === '.' || normalized.split('/').includes('..')) {
    throw new MetaAppPreviewSessionError('invalid_preview_asset_path', 'Preview asset path cannot escape the artifact directory.');
  }
  return normalized;
}

function assertInsideArtifactDir(artifactDir: string, filePath: string): void {
  const relative = path.relative(artifactDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new MetaAppPreviewSessionError('invalid_preview_asset_path', 'Preview asset path cannot escape the artifact directory.');
  }
}

async function assertRealPathInsideArtifactDir(artifactDir: string, filePath: string): Promise<string> {
  let realArtifactDir: string;
  let realFilePath: string;
  try {
    [realArtifactDir, realFilePath] = await Promise.all([
      fs.realpath(artifactDir),
      fs.realpath(filePath),
    ]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR') {
      throw new MetaAppPreviewSessionError('preview_asset_not_found', 'Preview asset was not found.');
    }
    throw error;
  }

  assertInsideArtifactDir(realArtifactDir, realFilePath);
  return realFilePath;
}

function getSession(
  sessions: Map<string, MetaAppPreviewSession>,
  previewId: string,
  now: number,
): MetaAppPreviewSession {
  const session = sessions.get(previewId);
  if (!session) {
    throw new MetaAppPreviewSessionError('preview_session_not_found', 'Preview session was not found.');
  }
  if (session.expiresAt <= now) {
    sessions.delete(previewId);
    throw new MetaAppPreviewSessionError('preview_session_expired', 'Preview session has expired.');
  }
  return session;
}

export function inferMetaAppPreviewMimeType(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function createMetaAppPreviewSessionRegistry(input?: {
  now?: () => number;
  ttlMs?: number;
}): {
  create(input: { artifactDir: string; indexFile: string }): MetaAppPreviewSession;
  resolveAsset(input: { previewId: string; assetPath?: string }): Promise<MetaAppPreviewAsset>;
  pruneExpired(): void;
} {
  const now = input?.now ?? Date.now;
  const ttlMs = input?.ttlMs ?? DEFAULT_TTL_MS;
  const sessions = new Map<string, MetaAppPreviewSession>();

  return {
    create(sessionInput) {
      const createdAt = now();
      const artifactDir = path.resolve(sessionInput.artifactDir);
      const indexFile = normalizeRelativeAssetPath(sessionInput.indexFile, 'index.html');
      const previewId = `metaapp-preview-${randomUUID()}`;
      const session: MetaAppPreviewSession = {
        previewId,
        artifactDir,
        indexFile,
        createdAt,
        expiresAt: createdAt + ttlMs,
        localPreviewUrl: `/api/metaapp/preview-assets/${previewId}/`,
      };
      sessions.set(previewId, session);
      return session;
    },

    async resolveAsset(assetInput) {
      const session = getSession(sessions, assetInput.previewId, now());
      const assetPath = normalizeRelativeAssetPath(assetInput.assetPath, session.indexFile);
      const filePath = path.resolve(session.artifactDir, assetPath);
      assertInsideArtifactDir(session.artifactDir, filePath);
      const realFilePath = await assertRealPathInsideArtifactDir(session.artifactDir, filePath);

      let body: Buffer;
      try {
        body = await fs.readFile(realFilePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'EISDIR') {
          throw new MetaAppPreviewSessionError('preview_asset_not_found', 'Preview asset was not found.');
        }
        throw error;
      }

      return {
        previewId: session.previewId,
        assetPath,
        filePath,
        contentType: inferMetaAppPreviewMimeType(filePath),
        body,
      };
    },

    pruneExpired() {
      const currentTime = now();
      for (const [previewId, session] of sessions) {
        if (session.expiresAt <= currentTime) {
          sessions.delete(previewId);
        }
      }
    },
  };
}
