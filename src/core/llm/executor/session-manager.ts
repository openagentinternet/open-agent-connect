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

function sessionPath(root: string, sessionId: string): string {
  if (!isSafeLlmSessionId(sessionId)) {
    throw new Error(`Invalid LLM session id: ${sessionId}`);
  }
  return path.join(root, `${sessionId}.json`);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return null;
  }
}

async function writeSession(root: string, record: LlmSessionRecord): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(sessionPath(root, record.sessionId), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
}

export function createFileSessionManager(sessionsRoot: string): SessionManager {
  return {
    async create(record) {
      await writeSession(sessionsRoot, record);
    },

    async update(sessionId, patch) {
      const current = await this.get(sessionId);
      if (!current) {
        throw new Error(`LLM session not found: ${sessionId}`);
      }
      await writeSession(sessionsRoot, { ...current, ...patch, sessionId });
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
      try {
        await fs.unlink(sessionPath(sessionsRoot, sessionId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    },
  };
}
