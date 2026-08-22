import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import { extractMetaAppZipArchive } from './zipArchive';

const MANIFEST_VERSION = 1;

export interface MetaAppArtifactDescriptor {
  metaAppPinId: string;
  contentReference: string;
  contentType: string;
  indexFile: string;
  modifyHistory?: string[] | null;
}

export interface MetaAppArtifactCacheEntry {
  cacheKey: string;
  artifactRoot: string;
  artifactDir: string;
  indexFile: string;
  manifestPath: string;
}

export interface MetaAppArtifactCacheStatsEntry {
  cacheKey: string;
  metaAppPinId: string;
  contentReference: string;
  contentType: string;
  indexFile: string;
  modifyHistory: string[] | null;
  latestModifyPinId: string | null;
  artifactDir: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
  sizeBytes: number;
}

export interface MetaAppArtifactCacheStats {
  cacheRoot: string;
  artifactsRoot: string;
  pinsRoot: string;
  artifactCount: number;
  pinRecordCount: number;
  totalBytes: number;
  artifacts: MetaAppArtifactCacheStatsEntry[];
}

export type MetaAppArtifactCacheClearInput =
  | { scope?: 'all' }
  | { scope: 'artifact'; cacheKey: string }
  | { scope: 'pin'; pinId: string };

export interface MetaAppArtifactCacheClearResult {
  clearedArtifacts: number;
  clearedPinRecords: number;
}

export interface MetaAppArtifactCacheStore {
  cacheRoot: string;
  artifactsRoot: string;
  pinsRoot: string;
  getArtifact(input: MetaAppArtifactDescriptor): Promise<MetaAppArtifactCacheEntry | null>;
  /** Look up a previously extracted package by MetaApp pinId (pin record + artifact). */
  getArtifactByPinId(pinId: string): Promise<MetaAppArtifactCacheEntry | null>;
  writeArtifact(input: MetaAppArtifactDescriptor & { archive: Buffer }): Promise<MetaAppArtifactCacheEntry>;
  getStats(): Promise<MetaAppArtifactCacheStats>;
  clear(input?: MetaAppArtifactCacheClearInput): Promise<MetaAppArtifactCacheClearResult>;
}

interface MetaAppArtifactCacheOptions {
  now?: () => number;
}

interface MetaAppArtifactManifest {
  version: 1;
  cacheKey: string;
  metaAppPinId: string;
  contentReference: string;
  contentType: string;
  indexFile: string;
  modifyHistory: string[] | null;
  latestModifyPinId: string | null;
  artifactPath: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number;
}

function resolvePaths(pathsOrHomeDir: string | MetabotPaths): MetabotPaths {
  return typeof pathsOrHomeDir === 'string' ? resolveMetabotPaths(pathsOrHomeDir) : pathsOrHomeDir;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeMetaAppModifyHistory(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const entries = value.map((item) => normalizeText(item)).filter(Boolean);
  return entries.length > 0 ? entries : null;
}

function latestModifyPinId(modifyHistory: string[] | null | undefined): string | null {
  return modifyHistory && modifyHistory.length > 0 ? modifyHistory[modifyHistory.length - 1] : null;
}

function normalizeDescriptor(input: MetaAppArtifactDescriptor): MetaAppArtifactDescriptor {
  return {
    metaAppPinId: normalizeText(input.metaAppPinId),
    contentReference: normalizeText(input.contentReference),
    contentType: normalizeText(input.contentType),
    indexFile: normalizeText(input.indexFile) || 'index.html',
    modifyHistory: normalizeMetaAppModifyHistory(input.modifyHistory),
  };
}

export function buildMetaAppArtifactCacheKey(input: Pick<MetaAppArtifactDescriptor, 'contentReference' | 'contentType' | 'indexFile'>): string {
  const descriptor = {
    contentReference: normalizeText(input.contentReference),
    contentType: normalizeText(input.contentType),
    indexFile: normalizeText(input.indexFile) || 'index.html',
  };
  return createHash('sha256').update(JSON.stringify(descriptor)).digest('hex');
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeManifest(value: unknown): MetaAppArtifactManifest | null {
  const raw = readObject(value);
  if (!raw || raw.version !== MANIFEST_VERSION) {
    return null;
  }

  const cacheKey = normalizeText(raw.cacheKey);
  const metaAppPinId = normalizeText(raw.metaAppPinId);
  const contentReference = normalizeText(raw.contentReference);
  const contentType = normalizeText(raw.contentType);
  const indexFile = normalizeText(raw.indexFile);
  const artifactPath = normalizeText(raw.artifactPath);
  const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : null;
  const updatedAt = typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : null;
  const lastUsedAt = typeof raw.lastUsedAt === 'number' && Number.isFinite(raw.lastUsedAt) ? raw.lastUsedAt : null;
  if (!cacheKey || !metaAppPinId || !contentReference || !contentType || !indexFile || !artifactPath || createdAt === null || updatedAt === null || lastUsedAt === null) {
    return null;
  }

  return {
    version: MANIFEST_VERSION,
    cacheKey,
    metaAppPinId,
    contentReference,
    contentType,
    indexFile,
    modifyHistory: normalizeMetaAppModifyHistory(raw.modifyHistory),
    latestModifyPinId: normalizeText(raw.latestModifyPinId) || null,
    artifactPath,
    createdAt,
    updatedAt,
    lastUsedAt,
  };
}

async function assertFileExists(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    throw error;
  }
}

async function findArtifactRootForIndexFile(rootDir: string, indexFile: string): Promise<string> {
  if (await assertFileExists(path.join(rootDir, indexFile))) {
    return rootDir;
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
  return await assertFileExists(path.join(nestedRoot, indexFile)) ? nestedRoot : rootDir;
}

function relativeArtifactPath(rootDir: string, artifactDir: string): string {
  const relative = path.relative(rootDir, artifactDir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('MetaApp artifact directory escaped the cache root.');
  }
  return relative;
}

function toEntry(input: {
  artifactsRoot: string;
  cacheKey: string;
  manifest: MetaAppArtifactManifest;
}): MetaAppArtifactCacheEntry {
  const artifactRoot = path.join(input.artifactsRoot, input.cacheKey);
  return {
    cacheKey: input.cacheKey,
    artifactRoot,
    artifactDir: path.join(artifactRoot, input.manifest.artifactPath),
    indexFile: input.manifest.indexFile,
    manifestPath: path.join(artifactRoot, 'manifest.json'),
  };
}

function pinCacheFilePath(pinsRoot: string, metaAppPinId: string): string {
  return path.join(pinsRoot, `${metaAppPinId}.json`);
}

function safeCacheKey(value: unknown): string {
  const text = normalizeText(value);
  if (!/^[a-f0-9]{64}$/i.test(text)) {
    throw new Error('Invalid MetaApp artifact cache key.');
  }
  return text.toLowerCase();
}

function safePinId(value: unknown): string {
  const text = normalizeText(value);
  if (!/^[A-Za-z0-9_.:-]+$/.test(text)) {
    throw new Error('Invalid MetaApp pin id.');
  }
  return text;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return false;
    }
    throw error;
  }
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function directorySize(rootDir: string): Promise<number> {
  const files = await listFilesRecursive(rootDir);
  let total = 0;
  for (const file of files) {
    const stat = await fs.stat(file).catch(() => null);
    if (stat?.isFile()) {
      total += stat.size;
    }
  }
  return total;
}

async function listPinRecordFiles(pinsRoot: string): Promise<string[]> {
  const entries = await fs.readdir(pinsRoot, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(pinsRoot, entry.name));
}

function cacheKeyFromPinRecord(value: unknown): string {
  const raw = readObject(value);
  return raw ? normalizeText(raw.cacheKey) : '';
}

export function createMetaAppArtifactCacheStore(
  pathsOrHomeDir: string | MetabotPaths,
  options: MetaAppArtifactCacheOptions = {},
): MetaAppArtifactCacheStore {
  const paths = resolvePaths(pathsOrHomeDir);
  const cacheRoot = path.join(paths.metabotRoot, 'cache', 'metaapps');
  const artifactsRoot = path.join(cacheRoot, 'artifacts');
  const pinsRoot = path.join(cacheRoot, 'pins');
  const now = options.now ?? Date.now;

  async function writePinRecord(input: MetaAppArtifactDescriptor & { cacheKey: string; artifactDir: string }): Promise<void> {
    const descriptor = normalizeDescriptor(input);
    if (!descriptor.metaAppPinId) {
      return;
    }
    await writeJsonFile(pinCacheFilePath(pinsRoot, descriptor.metaAppPinId), {
      version: MANIFEST_VERSION,
      metaAppPinId: descriptor.metaAppPinId,
      contentReference: descriptor.contentReference,
      contentType: descriptor.contentType,
      indexFile: descriptor.indexFile,
      modifyHistory: descriptor.modifyHistory ?? null,
      latestModifyPinId: latestModifyPinId(descriptor.modifyHistory),
      cacheKey: input.cacheKey,
      artifactDir: input.artifactDir,
      lastCheckedAt: now(),
      lastUsedAt: now(),
    });
  }

  return {
    cacheRoot,
    artifactsRoot,
    pinsRoot,

    async getArtifactByPinId(pinId) {
      let recordPath: string;
      try {
        recordPath = pinCacheFilePath(pinsRoot, safePinId(pinId));
      } catch {
        return null;
      }
      const record = readObject(await readJsonFile(recordPath));
      if (!record) {
        return null;
      }
      let cacheKey: string;
      try {
        cacheKey = safeCacheKey(record.cacheKey);
      } catch {
        return null;
      }
      const artifactRoot = path.join(artifactsRoot, cacheKey);
      const manifest = normalizeManifest(await readJsonFile(path.join(artifactRoot, 'manifest.json')));
      if (!manifest || manifest.cacheKey !== cacheKey) {
        return null;
      }
      const entry = toEntry({ artifactsRoot, cacheKey, manifest });
      if (!await assertFileExists(path.join(entry.artifactDir, manifest.indexFile))) {
        return null;
      }
      return entry;
    },

    async getArtifact(input) {
      const descriptor = normalizeDescriptor(input);
      const cacheKey = buildMetaAppArtifactCacheKey(descriptor);
      const artifactRoot = path.join(artifactsRoot, cacheKey);
      const manifestPath = path.join(artifactRoot, 'manifest.json');
      const manifest = normalizeManifest(await readJsonFile(manifestPath));
      if (
        !manifest
        || manifest.cacheKey !== cacheKey
        || manifest.contentReference !== descriptor.contentReference
        || manifest.contentType !== descriptor.contentType
        || manifest.indexFile !== descriptor.indexFile
      ) {
        return null;
      }

      const entry = toEntry({ artifactsRoot, cacheKey, manifest });
      if (!await assertFileExists(path.join(entry.artifactDir, descriptor.indexFile))) {
        return null;
      }

      const touched: MetaAppArtifactManifest = {
        ...manifest,
        metaAppPinId: descriptor.metaAppPinId || manifest.metaAppPinId,
        modifyHistory: descriptor.modifyHistory ?? null,
        latestModifyPinId: latestModifyPinId(descriptor.modifyHistory),
        lastUsedAt: now(),
      };
      await writeJsonFile(manifestPath, touched);
      await writePinRecord({ ...descriptor, cacheKey, artifactDir: entry.artifactDir });
      return entry;
    },

    async writeArtifact(input) {
      const descriptor = normalizeDescriptor(input);
      const cacheKey = buildMetaAppArtifactCacheKey(descriptor);
      const artifactRoot = path.join(artifactsRoot, cacheKey);
      const stagingRoot = path.join(artifactsRoot, `.staging-${cacheKey}-${randomUUID()}`);
      const payloadRoot = path.join(stagingRoot, 'payload');
      const createdAt = now();

      await fs.mkdir(artifactsRoot, { recursive: true });
      try {
        await extractMetaAppZipArchive({ archive: input.archive, outDir: payloadRoot });
        const artifactDir = await findArtifactRootForIndexFile(payloadRoot, descriptor.indexFile);
        if (!await assertFileExists(path.join(artifactDir, descriptor.indexFile))) {
          throw new Error('MetaApp artifact indexFile was not found after extraction.');
        }
        const artifactPath = relativeArtifactPath(stagingRoot, artifactDir);
        const manifest: MetaAppArtifactManifest = {
          version: MANIFEST_VERSION,
          cacheKey,
          metaAppPinId: descriptor.metaAppPinId,
          contentReference: descriptor.contentReference,
          contentType: descriptor.contentType,
          indexFile: descriptor.indexFile,
          modifyHistory: descriptor.modifyHistory ?? null,
          latestModifyPinId: latestModifyPinId(descriptor.modifyHistory),
          artifactPath,
          createdAt,
          updatedAt: createdAt,
          lastUsedAt: createdAt,
        };
        await writeJsonFile(path.join(stagingRoot, 'manifest.json'), manifest);
        await fs.rm(artifactRoot, { recursive: true, force: true });
        await fs.rename(stagingRoot, artifactRoot);
        const entry = toEntry({ artifactsRoot, cacheKey, manifest });
        await writePinRecord({ ...descriptor, cacheKey, artifactDir: entry.artifactDir });
        return entry;
      } catch (error) {
        await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
        throw error;
      }
    },

    async getStats() {
      const artifactEntries = await fs.readdir(artifactsRoot, { withFileTypes: true }).catch(() => []);
      const artifacts: MetaAppArtifactCacheStatsEntry[] = [];
      for (const entry of artifactEntries) {
        if (!entry.isDirectory() || entry.name.startsWith('.staging-')) {
          continue;
        }
        const manifest = normalizeManifest(await readJsonFile(path.join(artifactsRoot, entry.name, 'manifest.json')));
        if (!manifest) {
          continue;
        }
        const artifactRoot = path.join(artifactsRoot, manifest.cacheKey);
        artifacts.push({
          cacheKey: manifest.cacheKey,
          metaAppPinId: manifest.metaAppPinId,
          contentReference: manifest.contentReference,
          contentType: manifest.contentType,
          indexFile: manifest.indexFile,
          modifyHistory: manifest.modifyHistory,
          latestModifyPinId: manifest.latestModifyPinId,
          artifactDir: path.join(artifactRoot, manifest.artifactPath),
          createdAt: manifest.createdAt,
          updatedAt: manifest.updatedAt,
          lastUsedAt: manifest.lastUsedAt,
          sizeBytes: await directorySize(artifactRoot),
        });
      }
      const pinRecordFiles = await listPinRecordFiles(pinsRoot);
      return {
        cacheRoot,
        artifactsRoot,
        pinsRoot,
        artifactCount: artifacts.length,
        pinRecordCount: pinRecordFiles.length,
        totalBytes: await directorySize(cacheRoot),
        artifacts,
      };
    },

    async clear(input = { scope: 'all' }) {
      const scope = input.scope ?? 'all';
      if (scope === 'all') {
        const stats = await this.getStats();
        await fs.rm(cacheRoot, { recursive: true, force: true });
        return {
          clearedArtifacts: stats.artifactCount,
          clearedPinRecords: stats.pinRecordCount,
        };
      }

      let cacheKey = '';
      let extraPinFile: string | null = null;
      if (scope === 'pin') {
        const pinId = safePinId((input as { scope: 'pin'; pinId: string }).pinId);
        extraPinFile = pinCacheFilePath(pinsRoot, pinId);
        cacheKey = cacheKeyFromPinRecord(await readJsonFile(extraPinFile));
        if (!cacheKey) {
          await fs.rm(extraPinFile, { force: true }).catch(() => undefined);
          return { clearedArtifacts: 0, clearedPinRecords: 0 };
        }
      } else if (scope === 'artifact') {
        cacheKey = safeCacheKey((input as { scope: 'artifact'; cacheKey: string }).cacheKey);
      } else {
        throw new Error('Unsupported MetaApp artifact cache clear scope.');
      }

      cacheKey = safeCacheKey(cacheKey);
      const pinRecordFiles = await listPinRecordFiles(pinsRoot);
      let clearedPinRecords = 0;
      for (const file of pinRecordFiles) {
        if (cacheKeyFromPinRecord(await readJsonFile(file)) === cacheKey) {
          await fs.rm(file, { force: true });
          clearedPinRecords += 1;
        }
      }
      if (extraPinFile && !pinRecordFiles.includes(extraPinFile) && await pathExists(extraPinFile)) {
        await fs.rm(extraPinFile, { force: true });
        clearedPinRecords += 1;
      }

      const artifactRoot = path.join(artifactsRoot, cacheKey);
      const hadArtifact = await pathExists(artifactRoot);
      await fs.rm(artifactRoot, { recursive: true, force: true });
      return {
        clearedArtifacts: hadArtifact ? 1 : 0,
        clearedPinRecords,
      };
    },
  };
}
