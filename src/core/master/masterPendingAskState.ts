import { promises as fs } from 'node:fs';
import { ensureHotLayout } from '../state/runtimeStateStore';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { MasterRequestMessage } from './masterMessageSchema';

export interface PendingMasterAskRecord {
  traceId: string;
  requestId: string;
  createdAt: number;
  updatedAt: number;
  confirmationState: 'awaiting_confirmation' | 'sent';
  requestJson: string;
  request: MasterRequestMessage;
  target: Record<string, unknown>;
  preview: Record<string, unknown>;
  messagePinId?: string | null;
  sentAt?: number | null;
}

export interface PendingMasterAskState {
  items: PendingMasterAskRecord[];
}

export interface PendingMasterAskStateStore {
  paths: MetabotPaths;
  statePath: string;
  read(): Promise<PendingMasterAskState>;
  write(nextState: PendingMasterAskState): Promise<PendingMasterAskState>;
  update(
    updater: (currentState: PendingMasterAskState) => PendingMasterAskState | Promise<PendingMasterAskState>
  ): Promise<PendingMasterAskState>;
  get(traceId: string): Promise<PendingMasterAskRecord>;
  put(record: PendingMasterAskRecord): Promise<PendingMasterAskRecord>;
}

function createEmptyState(): PendingMasterAskState {
  return {
    items: [],
  };
}

function normalizeState(value: PendingMasterAskState | null): PendingMasterAskState {
  if (!value || typeof value !== 'object') {
    return createEmptyState();
  }

  return {
    items: Array.isArray(value.items) ? value.items : [],
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

export function createPendingMasterAskStateStore(homeDirOrPaths: string | MetabotPaths): PendingMasterAskStateStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const statePath = paths.masterPendingAskStatePath;

  return {
    paths,
    statePath,
    async read() {
      await ensureHotLayout(paths);
      return normalizeState(await readJsonFile<PendingMasterAskState>(statePath));
    },
    async write(nextState) {
      await ensureHotLayout(paths);
      const normalized = normalizeState(nextState);
      await fs.writeFile(statePath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');
      return normalized;
    },
    async update(updater) {
      const current = await this.read();
      const next = await updater(current);
      return this.write(next);
    },
    async get(traceId) {
      const state = await this.read();
      const record = state.items.find((entry) => entry.traceId === traceId);
      if (!record) {
        throw new Error(`Pending Ask Master record not found: ${traceId}`);
      }
      return record;
    },
    async put(record) {
      await this.update((current) => ({
        items: [
          record,
          ...current.items.filter((entry) => entry.traceId !== record.traceId),
        ],
      }));
      return record;
    },
  };
}
