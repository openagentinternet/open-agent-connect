import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type {
  ImportedRemoteArtifactSidecar,
  RemoteEvolutionIndex,
  RemoteEvolutionIndexRow,
  SkillVariantArtifact,
} from './types';
import { SAFE_IDENTIFIER_PATTERN, validateSafeEvolutionIdentifier } from './localEvolutionStore';

const REMOTE_EVOLUTION_SCHEMA_VERSION = 1 as const;

let atomicWriteSequence = 0;
const indexUpdateQueues = new Map<string, Promise<void>>();

function createEmptyRemoteEvolutionIndex(): RemoteEvolutionIndex {
  return {
    schemaVersion: REMOTE_EVOLUTION_SCHEMA_VERSION,
    imports: [],
    byVariantId: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidIdentifier(identifier: string): boolean {
  return (
    !!identifier
    && identifier !== '.'
    && identifier !== '..'
    && !path.isAbsolute(identifier)
    && SAFE_IDENTIFIER_PATTERN.test(identifier)
  );
}

function normalizeRemoteIndexRow(variantId: string, value: unknown): RemoteEvolutionIndexRow | null {
  if (!isValidIdentifier(variantId) || !isRecord(value) || typeof value.pinId !== 'string') {
    return null;
  }
  return {
    variantId,
    pinId: value.pinId,
  };
}

function normalizeRemoteIndex(value: unknown): { index: RemoteEvolutionIndex; repaired: boolean } {
  if (!isRecord(value)) {
    return {
      index: createEmptyRemoteEvolutionIndex(),
      repaired: true,
    };
  }

  const incomingByVariantId = isRecord(value.byVariantId) ? value.byVariantId : {};
  const byVariantId: Record<string, RemoteEvolutionIndexRow> = {};
  let repaired = value.schemaVersion !== REMOTE_EVOLUTION_SCHEMA_VERSION || !isRecord(value.byVariantId);

  for (const [key, row] of Object.entries(incomingByVariantId)) {
    if (!isRecord(row)) {
      repaired = true;
      continue;
    }
    const rowVariantId = typeof row.variantId === 'string' ? row.variantId : key;
    const normalizedRow = normalizeRemoteIndexRow(rowVariantId, row);
    if (!normalizedRow) {
      repaired = true;
      continue;
    }
    if (rowVariantId !== key) {
      repaired = true;
    }
    if (Object.prototype.hasOwnProperty.call(byVariantId, normalizedRow.variantId)) {
      repaired = true;
    }
    byVariantId[normalizedRow.variantId] = normalizedRow;
  }

  const imports = Object.keys(byVariantId).sort();
  const incomingImports = Array.isArray(value.imports)
    ? value.imports.filter((entry): entry is string => typeof entry === 'string')
    : [];
  const incomingImportsNormalized = [...new Set(incomingImports)].sort();
  if (incomingImportsNormalized.length !== imports.length) {
    repaired = true;
  } else {
    for (let index = 0; index < imports.length; index += 1) {
      if (imports[index] !== incomingImportsNormalized[index]) {
        repaired = true;
        break;
      }
    }
  }

  return {
    index: {
      schemaVersion: REMOTE_EVOLUTION_SCHEMA_VERSION,
      imports,
      byVariantId,
    },
    repaired,
  };
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function readIndexFile(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || error instanceof SyntaxError) {
      return null;
    }
    throw error;
  }
}

function nextAtomicWriteSuffix(): string {
  atomicWriteSequence += 1;
  return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<string> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, filePath);
  return filePath;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function ensureRemoteEvolutionLayout(paths: MetabotPaths): Promise<void> {
  await fs.mkdir(paths.evolutionRemoteArtifactsRoot, { recursive: true });
}

function getIndexQueue(indexPath: string): Promise<void> {
  return indexUpdateQueues.get(indexPath) ?? Promise.resolve();
}

function queueIndexUpdate<T>(indexPath: string, task: () => Promise<T>): Promise<T> {
  const previous = getIndexQueue(indexPath);
  const run = previous.then(task, task);
  indexUpdateQueues.set(
    indexPath,
    run.then(
      () => undefined,
      () => undefined
    )
  );
  return run;
}

export interface RemoteEvolutionStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  readIndex(): Promise<RemoteEvolutionIndex>;
  readArtifact(variantId: string): Promise<SkillVariantArtifact | null>;
  readSidecar(variantId: string): Promise<ImportedRemoteArtifactSidecar | null>;
  writeImport(input: {
    artifact: SkillVariantArtifact;
    sidecar: ImportedRemoteArtifactSidecar;
  }): Promise<{
    artifactPath: string;
    metadataPath: string;
    index: RemoteEvolutionIndex;
  }>;
}

export function createRemoteEvolutionStore(homeDirOrPaths: string | MetabotPaths): RemoteEvolutionStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const indexQueueKey = path.resolve(paths.evolutionRemoteIndexPath);

  async function readIndexWithRepair(): Promise<RemoteEvolutionIndex> {
    await ensureRemoteEvolutionLayout(paths);
    const parsed = await readIndexFile(paths.evolutionRemoteIndexPath);
    const normalized = normalizeRemoteIndex(parsed);
    if (parsed === null || normalized.repaired) {
      await writeJsonAtomic(paths.evolutionRemoteIndexPath, normalized.index);
    }
    return normalized.index;
  }

  return {
    paths,
    async ensureLayout() {
      await ensureRemoteEvolutionLayout(paths);
      return paths;
    },
    async readIndex() {
      await getIndexQueue(indexQueueKey);
      return readIndexWithRepair();
    },
    async readArtifact(variantId) {
      await ensureRemoteEvolutionLayout(paths);
      const safeVariantId = validateSafeEvolutionIdentifier(variantId, 'variantId');
      const artifactPath = path.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.json`);
      return readJsonFile<SkillVariantArtifact>(artifactPath);
    },
    async readSidecar(variantId) {
      await ensureRemoteEvolutionLayout(paths);
      const safeVariantId = validateSafeEvolutionIdentifier(variantId, 'variantId');
      const metadataPath = path.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.meta.json`);
      return readJsonFile<ImportedRemoteArtifactSidecar>(metadataPath);
    },
    async writeImport({ artifact, sidecar }) {
      return queueIndexUpdate(indexQueueKey, async () => {
        await ensureRemoteEvolutionLayout(paths);
        const safeVariantId = validateSafeEvolutionIdentifier(artifact.variantId, 'variantId');
        if (sidecar.variantId !== safeVariantId) {
          throw new Error(
            `Artifact variantId (${safeVariantId}) does not match sidecar variantId (${sidecar.variantId})`
          );
        }
        if (sidecar.skillName !== artifact.skillName) {
          throw new Error(
            `Artifact skillName (${artifact.skillName}) does not match sidecar skillName (${sidecar.skillName})`
          );
        }
        if (sidecar.scopeHash !== artifact.metadata.scopeHash) {
          throw new Error(
            `Artifact scopeHash (${artifact.metadata.scopeHash}) does not match sidecar scopeHash (${sidecar.scopeHash})`
          );
        }

        const artifactPath = path.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.json`);
        const metadataPath = path.join(paths.evolutionRemoteArtifactsRoot, `${safeVariantId}.meta.json`);
        if (await pathExists(artifactPath) || await pathExists(metadataPath)) {
          throw new Error(`Remote evolution artifact already imported for variantId: ${safeVariantId}`);
        }

        const currentIndex = await readIndexWithRepair();
        if (Object.prototype.hasOwnProperty.call(currentIndex.byVariantId, safeVariantId)) {
          throw new Error(`Remote evolution artifact already imported for variantId: ${safeVariantId}`);
        }

        await writeJsonAtomic(artifactPath, artifact);
        await writeJsonAtomic(metadataPath, sidecar);

        const byVariantId = {
          ...currentIndex.byVariantId,
          [safeVariantId]: {
            variantId: safeVariantId,
            pinId: sidecar.pinId,
          },
        };
        const nextIndex: RemoteEvolutionIndex = {
          schemaVersion: REMOTE_EVOLUTION_SCHEMA_VERSION,
          imports: Object.keys(byVariantId).sort(),
          byVariantId,
        };
        await writeJsonAtomic(paths.evolutionRemoteIndexPath, nextIndex);
        return {
          artifactPath,
          metadataPath,
          index: nextIndex,
        };
      });
    },
  };
}
