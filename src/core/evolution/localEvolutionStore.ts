import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type {
  SkillEvolutionIndex,
  SkillExecutionAnalysis,
  SkillExecutionRecord,
  SkillVariantArtifact,
} from './types';

const EVOLUTION_SCHEMA_VERSION = 1 as const;
const SAFE_IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]+$/;
const KNOWN_INDEX_KEYS = new Set([
  'schemaVersion',
  'executions',
  'analyses',
  'artifacts',
  'activeVariants',
]);

let atomicWriteSequence = 0;

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

function normalizeActiveVariants(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const entries: Array<[string, string]> = [];
  for (const [skillName, variantId] of Object.entries(value)) {
    if (typeof skillName === 'string' && typeof variantId === 'string') {
      entries.push([skillName, variantId]);
    }
  }

  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
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

function validateIdentifier(identifier: string, fieldName: string): string {
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

export interface LocalEvolutionStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  readIndex(): Promise<SkillEvolutionIndex>;
  writeExecution(record: SkillExecutionRecord): Promise<string>;
  writeAnalysis(record: SkillExecutionAnalysis): Promise<string>;
  writeArtifact(record: SkillVariantArtifact): Promise<string>;
  setActiveVariant(skillName: string, variantId: string): Promise<SkillEvolutionIndex>;
}

export function createLocalEvolutionStore(homeDirOrPaths: string | MetabotPaths): LocalEvolutionStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  let updateQueue: Promise<void> = Promise.resolve();

  function queueIndexUpdate<T>(task: () => Promise<T>): Promise<T> {
    const run = updateQueue.then(task, task);
    updateQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async function updateIndex(
    updater: (current: StoredSkillEvolutionIndex) => StoredSkillEvolutionIndex
  ): Promise<SkillEvolutionIndex> {
    return queueIndexUpdate(async () => {
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
      await updateQueue;
      await ensureEvolutionLayout(paths);
      return normalizeIndex(await readIndexFile(paths.evolutionIndexPath));
    },
    async writeExecution(record) {
      await ensureEvolutionLayout(paths);
      const executionId = validateIdentifier(record.executionId, 'executionId');
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
      const analysisId = validateIdentifier(record.analysisId, 'analysisId');
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
      const variantId = validateIdentifier(record.variantId, 'variantId');
      const filePath = path.join(paths.evolutionArtifactsRoot, `${variantId}.json`);
      await writeJsonAtomic(filePath, record);
      await updateIndex((current) => ({
        ...current,
        artifacts: addIdentifier(current.artifacts, variantId),
      }));
      return filePath;
    },
    async setActiveVariant(skillName, variantId) {
      const safeSkillName = validateIdentifier(skillName, 'skillName');
      const safeVariantId = validateIdentifier(variantId, 'variantId');
      return updateIndex((current) => ({
        ...current,
        activeVariants: normalizeActiveVariants({
          ...current.activeVariants,
          [safeSkillName]: safeVariantId,
        }),
      }));
    },
  };
}
