import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { MetabotPaths } from '../state/paths';
import { resolveMetabotPaths } from '../state/paths';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import type { ChatStrategiesState, ChatStrategy } from './privateChatTypes';

export interface ChatStrategyStore {
  paths: MetabotPaths;
  read(): Promise<ChatStrategiesState>;
  write(state: ChatStrategiesState): Promise<void>;
  getStrategy(id: string): Promise<ChatStrategy | null>;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStrategiesState(value: unknown): ChatStrategiesState {
  if (!value || typeof value !== 'object') {
    return { strategies: [] };
  }
  const source = value as Record<string, unknown>;
  if (!Array.isArray(source.strategies)) {
    return { strategies: [] };
  }
  const strategies: ChatStrategy[] = [];
  for (const entry of source.strategies) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const id = normalizeText(raw.id);
    if (!id) continue;
    strategies.push({
      id,
      maxTurns: typeof raw.maxTurns === 'number' && Number.isFinite(raw.maxTurns)
        ? Math.max(1, Math.trunc(raw.maxTurns))
        : 30,
      maxIdleMs: typeof raw.maxIdleMs === 'number' && Number.isFinite(raw.maxIdleMs)
        ? Math.max(0, Math.trunc(raw.maxIdleMs))
        : 300_000,
      exitCriteria: normalizeText(raw.exitCriteria),
    });
  }
  return { strategies };
}

async function writeJsonFileAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let handle: fs.FileHandle | null = null;
  try {
    handle = await fs.open(tempPath, 'w');
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(tempPath, filePath);
    try {
      const directoryHandle = await fs.open(path.dirname(filePath), 'r');
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EBADF') {
        throw error;
      }
    }
  } catch (error) {
    if (handle) {
      await handle.close();
    }
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

export function createChatStrategyStore(
  homeDirOrPaths: string | MetabotPaths,
): ChatStrategyStore {
  const paths =
    typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;
  const chatStrategiesPath = paths.chatStrategiesPath;

  return {
    paths,

    async read() {
      await ensureRuntimeLayout(paths);
      try {
        const raw = await fs.readFile(chatStrategiesPath, 'utf8');
        return normalizeStrategiesState(JSON.parse(raw));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          return { strategies: [] };
        }
        if (error instanceof SyntaxError) {
          return { strategies: [] };
        }
        throw error;
      }
    },

    async write(state) {
      await ensureRuntimeLayout(paths);
      await writeJsonFileAtomically(chatStrategiesPath, normalizeStrategiesState(state));
    },

    async getStrategy(id) {
      const state = await this.read();
      const normalizedId = normalizeText(id).toLowerCase();
      return state.strategies.find(s => normalizeText(s.id).toLowerCase() === normalizedId) ?? null;
    },
  };
}
