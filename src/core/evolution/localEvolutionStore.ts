import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type {
  SkillActiveVariantRef,
  SkillEvolutionIndex,
  SkillExecutionAnalysis,
  SkillExecutionRecord,
  SkillVariantArtifact,
  SkillVariantSource,
} from './types';

const EVOLUTION_SCHEMA_VERSION = 1 as const;
export const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const KNOWN_INDEX_KEYS = new Set([
  'schemaVersion',
  'executions',
  'analyses',
  'artifacts',
  'activeVariants',
]);

let atomicWriteSequence = 0;
const indexUpdateQueues = new Map<string, Promise<void>>();

type StoredSkillEvolutionIndex = SkillEvolutionIndex & Record<string, unknown>;

function createEmptyIndex(): StoredSkillEvolutionIndex {
  return {
    schemaVersion: EVOLUTION_SCHEMA_VERSION,
    executions: [],
    analyses: [],
    artifacts: [],
    activeVariants: {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === 'string'))].sort();
}

function compareCodePointStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function normalizeSafeIdentifier(identifier: unknown, fieldName: string): string | null {
  if (typeof identifier !== 'string') {
    return null;
  }
  try {
    return validateSafeEvolutionIdentifier(identifier, fieldName);
  } catch {
    return null;
  }
}

function normalizeActiveVariantSource(value: unknown): SkillVariantSource | null {
  if (value === 'local' || value === 'remote') {
    return value;
  }
  return null;
}

export function parseSkillActiveVariantRef(value: unknown): SkillActiveVariantRef | null {
  if (typeof value === 'string') {
    const safeVariantId = normalizeSafeIdentifier(value, 'variantId');
    if (!safeVariantId) {
      return null;
    }
    return {
      source: 'local',
      variantId: safeVariantId,
    };
  }
  if (!isRecord(value)) {
    return null;
  }
  const source = normalizeActiveVariantSource(value.source);
  const safeVariantId = normalizeSafeIdentifier(value.variantId, 'variantId');
  if (!source || !safeVariantId) {
    return null;
  }
  return {
    source,
    variantId: safeVariantId,
  };
}

function normalizeActiveVariants(value: unknown): Record<string, SkillActiveVariantRef> {
  if (!isRecord(value)) {
    return {};
  }

  const entries: Array<[string, SkillActiveVariantRef]> = [];
  for (const [skillName, refValue] of Object.entries(value)) {
    const safeSkillName = normalizeSafeIdentifier(skillName, 'skillName');
    const normalizedRef = parseSkillActiveVariantRef(refValue);
    if (safeSkillName && normalizedRef) {
      entries.push([safeSkillName, normalizedRef]);
    }
  }

  return Object.fromEntries(entries.sort(([left], [right]) => compareCodePointStrings(left, right)));
}

function normalizeIndex(value: unknown): StoredSkillEvolutionIndex {
  if (!isRecord(value)) {
    return createEmptyIndex();
  }

  const preservedUnknownFields: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    if (!KNOWN_INDEX_KEYS.has(key)) {
      preservedUnknownFields[key] = fieldValue;
    }
  }

  return {
    ...preservedUnknownFields,
    schemaVersion: EVOLUTION_SCHEMA_VERSION,
    executions: normalizeStringList(value.executions),
    analyses: normalizeStringList(value.analyses),
    artifacts: normalizeStringList(value.artifacts),
    activeVariants: normalizeActiveVariants(value.activeVariants),
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

function addIdentifier(values: string[], identifier: string): string[] {
  return normalizeStringList([...values, identifier]);
}

async function ensureEvolutionLayout(paths: MetabotPaths): Promise<void> {
  await fs.mkdir(paths.evolutionExecutionsRoot, { recursive: true });
  await fs.mkdir(paths.evolutionAnalysesRoot, { recursive: true });
  await fs.mkdir(paths.evolutionArtifactsRoot, { recursive: true });
}

export function validateSafeEvolutionIdentifier(identifier: string, fieldName: string): string {
  if (
    !identifier
    || identifier === '.'
    || identifier === '..'
    || path.isAbsolute(identifier)
    || !SAFE_IDENTIFIER_PATTERN.test(identifier)
  ) {
    throw new Error(`Invalid ${fieldName}: ${identifier}`);
  }
  return identifier;
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

export interface LocalEvolutionStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  readIndex(): Promise<SkillEvolutionIndex>;
  readArtifact(variantId: string): Promise<SkillVariantArtifact | null>;
  readAnalysis(analysisId: string): Promise<SkillExecutionAnalysis | null>;
  writeExecution(record: SkillExecutionRecord): Promise<string>;
  writeAnalysis(record: SkillExecutionAnalysis): Promise<string>;
  writeArtifact(record: SkillVariantArtifact): Promise<string>;
  setActiveVariantRef(skillName: string, ref: SkillActiveVariantRef): Promise<SkillEvolutionIndex>;
  setActiveVariant(skillName: string, variantId: string): Promise<SkillEvolutionIndex>;
  clearActiveVariant(skillName: string): Promise<SkillEvolutionIndex>;
}

export function createLocalEvolutionStore(homeDirOrPaths: string | MetabotPaths): LocalEvolutionStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const indexQueueKey = path.resolve(paths.evolutionIndexPath);

  async function updateIndex(
    updater: (current: StoredSkillEvolutionIndex) => StoredSkillEvolutionIndex
  ): Promise<SkillEvolutionIndex> {
    return queueIndexUpdate(indexQueueKey, async () => {
      await ensureEvolutionLayout(paths);
      const current = normalizeIndex(await readIndexFile(paths.evolutionIndexPath));
      const next = normalizeIndex(updater(current));
      await writeJsonAtomic(paths.evolutionIndexPath, next);
      return next;
    });
  }

  return {
    paths,
    async ensureLayout() {
      await ensureEvolutionLayout(paths);
      return paths;
    },
    async readIndex() {
      await getIndexQueue(indexQueueKey);
      await ensureEvolutionLayout(paths);
      return normalizeIndex(await readIndexFile(paths.evolutionIndexPath));
    },
    async readArtifact(variantId) {
      await ensureEvolutionLayout(paths);
      const safeVariantId = validateSafeEvolutionIdentifier(variantId, 'variantId');
      const filePath = path.join(paths.evolutionArtifactsRoot, `${safeVariantId}.json`);
      return readJsonFile<SkillVariantArtifact>(filePath);
    },
    async readAnalysis(analysisId) {
      await ensureEvolutionLayout(paths);
      const safeAnalysisId = validateSafeEvolutionIdentifier(analysisId, 'analysisId');
      const filePath = path.join(paths.evolutionAnalysesRoot, `${safeAnalysisId}.json`);
      return readJsonFile<SkillExecutionAnalysis>(filePath);
    },
    async writeExecution(record) {
      await ensureEvolutionLayout(paths);
      const executionId = validateSafeEvolutionIdentifier(record.executionId, 'executionId');
      const filePath = path.join(paths.evolutionExecutionsRoot, `${executionId}.json`);
      await writeJsonAtomic(filePath, record);
      await updateIndex((current) => ({
        ...current,
        executions: addIdentifier(current.executions, executionId),
      }));
      return filePath;
    },
    async writeAnalysis(record) {
      await ensureEvolutionLayout(paths);
      const analysisId = validateSafeEvolutionIdentifier(record.analysisId, 'analysisId');
      const filePath = path.join(paths.evolutionAnalysesRoot, `${analysisId}.json`);
      await writeJsonAtomic(filePath, record);
      await updateIndex((current) => ({
        ...current,
        analyses: addIdentifier(current.analyses, analysisId),
      }));
      return filePath;
    },
    async writeArtifact(record) {
      await ensureEvolutionLayout(paths);
      const variantId = validateSafeEvolutionIdentifier(record.variantId, 'variantId');
      const filePath = path.join(paths.evolutionArtifactsRoot, `${variantId}.json`);
      await writeJsonAtomic(filePath, record);
      await updateIndex((current) => ({
        ...current,
        artifacts: addIdentifier(current.artifacts, variantId),
      }));
      return filePath;
    },
    async setActiveVariantRef(skillName, ref) {
      const safeSkillName = validateSafeEvolutionIdentifier(skillName, 'skillName');
      const safeVariantId = validateSafeEvolutionIdentifier(ref.variantId, 'variantId');
      const safeSource = normalizeActiveVariantSource(ref.source);
      if (!safeSource) {
        throw new Error(`Invalid source: ${String(ref.source)}`);
      }
      return updateIndex((current) => ({
        ...current,
        activeVariants: normalizeActiveVariants({
          ...current.activeVariants,
          [safeSkillName]: {
            source: safeSource,
            variantId: safeVariantId,
          },
        }),
      }));
    },
    async setActiveVariant(skillName, variantId) {
      return this.setActiveVariantRef(skillName, {
        source: 'local',
        variantId,
      });
    },
    async clearActiveVariant(skillName) {
      const safeSkillName = validateSafeEvolutionIdentifier(skillName, 'skillName');
      return updateIndex((current) => {
        const activeVariants = { ...current.activeVariants };
        delete activeVariants[safeSkillName];
        return {
          ...current,
          activeVariants: normalizeActiveVariants(activeVariants),
        };
      });
    },
  };
}
