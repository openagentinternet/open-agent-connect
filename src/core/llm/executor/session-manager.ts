import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LlmSessionRecord } from './types';

export interface SessionManager {
  create(record: LlmSessionRecord): Promise<void>;
  update(sessionId: string, patch: Partial<LlmSessionRecord>): Promise<void>;
  get(sessionId: string): Promise<LlmSessionRecord | null>;
  list(limit?: number): Promise<LlmSessionRecord[]>;
  delete(sessionId: string): Promise<void>;
}

export function isSafeLlmSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(sessionId);
}

let atomicWriteSequence = 0;
const sessionOperationQueues = new Map<string, Promise<void>>();

function sessionPath(root: string, sessionId: string): string {
  if (!isSafeLlmSessionId(sessionId)) {
    throw new Error(`Invalid LLM session id: ${sessionId}`);
  }
  return path.join(root, `${sessionId}.json`);
}

function nextAtomicWriteSuffix(): string {
  atomicWriteSequence += 1;
  return `${process.pid}.${Date.now()}.${atomicWriteSequence}`;
}

function queueSessionOperation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = sessionOperationQueues.get(filePath) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const pending = run.then(
    () => undefined,
    () => undefined,
  );
  sessionOperationQueues.set(filePath, pending);
  pending.then(() => {
    if (sessionOperationQueues.get(filePath) === pending) {
      sessionOperationQueues.delete(filePath);
    }
  }, () => undefined);
  return run;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    if (error instanceof SyntaxError) {
      throw new Error(`Malformed LLM session JSON: ${filePath}`);
    }
    throw error;
  }
}

async function writeSessionFile(filePath: string, record: LlmSessionRecord): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${nextAtomicWriteSuffix()}.tmp`;
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function createFileSessionManager(sessionsRoot: string): SessionManager {
  return {
    async create(record) {
      const filePath = sessionPath(sessionsRoot, record.sessionId);
      await queueSessionOperation(filePath, async () => {
        await writeSessionFile(filePath, record);
      });
    },

    async update(sessionId, patch) {
      const filePath = sessionPath(sessionsRoot, sessionId);
      await queueSessionOperation(filePath, async () => {
        const current = await readJsonFile<LlmSessionRecord>(filePath);
        if (!current) {
          throw new Error(`LLM session not found: ${sessionId}`);
        }
        await writeSessionFile(filePath, { ...current, ...patch, sessionId });
      });
    },

    async get(sessionId) {
      return readJsonFile<LlmSessionRecord>(sessionPath(sessionsRoot, sessionId));
    },

    async list(limit = 20) {
      try {
        const entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
        const records: LlmSessionRecord[] = [];
        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          const record = await readJsonFile<LlmSessionRecord>(path.join(sessionsRoot, entry.name));
          if (record) records.push(record);
        }
        records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return records.slice(0, Math.max(0, limit));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw error;
      }
    },

    async delete(sessionId) {
      const filePath = sessionPath(sessionsRoot, sessionId);
      await queueSessionOperation(filePath, async () => {
        try {
          await fs.unlink(filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      });
    },
  };
}
