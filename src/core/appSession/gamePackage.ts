/**
 * Game package loading: resolve `manifestUri` (metafile://<pinId>.zip) to
 * `game-manifest.json` + `adapter.js`, verify `adapterHash`, and cache the
 * extracted package under the daemon runtime root. The adapter hash is fixed
 * at session start and never changes during a match (docs/09 6.6).
 */

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { downloadMetaAppArchive } from '../metaapp/artifactDownload';
import { extractMetaAppZipArchive } from '../metaapp/zipArchive';
import { createAppSessionError, type GameManifest, type LoadedGamePackage } from './types';

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Normalize an adapter hash declaration: accepts `sha256:<hex>` or bare hex.
 * Returns the lowercase hex or null when malformed.
 */
export function normalizeAdapterHash(value: unknown): string | null {
  const text = normalizeText(value).toLowerCase();
  const hex = text.startsWith('sha256:') ? text.slice('sha256:'.length) : text;
  if (!/^[0-9a-f]{64}$/u.test(hex)) {
    return null;
  }
  return hex;
}

function safeJoinPackagePath(packageDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/\\/gu, '/').replace(/^\.\/+/u, '');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw new Error(`Invalid game package path: ${relativePath}`);
  }
  return path.join(packageDir, normalized);
}

async function readPackageFile(packageDir: string, relativePath: string, maxBytes: number): Promise<string> {
  const target = safeJoinPackagePath(packageDir, relativePath);
  const stats = await fs.stat(target);
  if (!stats.isFile()) {
    throw new Error(`Game package entry is not a file: ${relativePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`Game package entry exceeds the size limit: ${relativePath}`);
  }
  return fs.readFile(target, 'utf8');
}

export interface GamePackageLoader {
  load(input: { manifestUri: string }): Promise<LoadedGamePackage>;
}

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_ADAPTER_BYTES = 2 * 1024 * 1024;

/**
 * Load a game package from a metafile:// zip URI, verify its manifest and
 * adapter hash, and return the frozen package. The extraction cache is keyed
 * by the manifest URI hash so restores re-use the downloaded package while the
 * hash verification still runs on every load.
 */
export function createGamePackageLoader(input: {
  fetchImpl: typeof fetch;
  cacheRoot: string;
}): GamePackageLoader {
  const cacheRoot = path.resolve(input.cacheRoot);

  async function extractPackage(manifestUri: string, uriKey: string): Promise<{ packageDir: string }> {
    const packageDir = path.join(cacheRoot, uriKey);
    const markerPath = path.join(packageDir, '.extracted');
    try {
      await fs.access(markerPath);
      return { packageDir };
    } catch {
      // Fall through to download + extract.
    }
    await fs.mkdir(packageDir, { recursive: true });
    const archive = await downloadMetaAppArchive(input.fetchImpl, manifestUri);
    if (!archive) {
      throw new Error(`Game package could not be downloaded: ${manifestUri}`);
    }
    const tempDir = path.join(cacheRoot, `${uriKey}.tmp-${process.pid}-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    try {
      await extractMetaAppZipArchive({
        archive,
        outDir: tempDir,
        maxEntries: 200,
        maxUncompressedBytes: 32 * 1024 * 1024,
      });
      await fs.rm(packageDir, { recursive: true, force: true });
      await fs.rename(tempDir, packageDir);
      await fs.writeFile(markerPath, `${new Date().toISOString()}\n`, 'utf8');
    } catch (error) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
    return { packageDir };
  }

  return {
    async load(input) {
      const manifestUri = normalizeText(input.manifestUri);
      if (!manifestUri || !/^metafile:\/\//iu.test(manifestUri)) {
        throw createAppSessionError(
          'adapter_invalid',
          `manifestUri must be a metafile:// URI: ${manifestUri || '(empty)'}`,
        );
      }
      const uriKey = sha256Hex(manifestUri);
      const { packageDir } = await extractPackage(manifestUri, uriKey);

      let manifest: GameManifest;
      try {
        const rawManifest = await readPackageFile(packageDir, 'game-manifest.json', MAX_MANIFEST_BYTES);
        const parsed = JSON.parse(rawManifest) as Record<string, unknown>;
        const protocol = normalizeText(parsed.protocol);
        const gameId = normalizeText(parsed.gameId);
        const adapter = normalizeText(parsed.adapter);
        const adapterHash = normalizeAdapterHash(parsed.adapterHash);
        if (protocol !== 'agent-game/1') {
          throw new Error(`Unsupported game package protocol: ${protocol}`);
        }
        if (!gameId || !adapter || !adapterHash) {
          throw new Error('game-manifest.json is missing gameId, adapter, or adapterHash.');
        }
        manifest = {
          protocol,
          gameId,
          adapter,
          adapterHash,
          ...(normalizeText(parsed.appId) ? { appId: normalizeText(parsed.appId) } : {}),
          ...(normalizeText(parsed.rulesVersion) ? { rulesVersion: normalizeText(parsed.rulesVersion) } : {}),
          ...(normalizeText(parsed.turnModel) ? { turnModel: normalizeText(parsed.turnModel) } : {}),
          ...(normalizeText(parsed.informationModel) ? { informationModel: normalizeText(parsed.informationModel) } : {}),
          ...(Number.isInteger(parsed.maxPlayers) && Number(parsed.maxPlayers) > 0
            ? { maxPlayers: Number(parsed.maxPlayers) }
            : {}),
        };
      } catch (error) {
        if (error instanceof Error && (error as { code?: unknown }).code === 'adapter_invalid') {
          throw error;
        }
        throw createAppSessionError(
          'adapter_invalid',
          `Game manifest is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      let adapterCode: string;
      try {
        adapterCode = await readPackageFile(packageDir, manifest.adapter, MAX_ADAPTER_BYTES);
      } catch (error) {
        throw createAppSessionError(
          'adapter_invalid',
          `Game adapter is missing or invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const computedHash = sha256Hex(adapterCode);
      if (computedHash !== manifest.adapterHash) {
        throw createAppSessionError(
          'adapter_invalid',
          `adapterHash mismatch: manifest declares ${manifest.adapterHash}, computed ${computedHash}`,
        );
      }

      return {
        manifestUri,
        manifest,
        adapterCode,
        adapterHash: `sha256:${computedHash}`,
      };
    },
  };
}
