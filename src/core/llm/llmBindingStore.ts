import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveMetabotPaths } from '../state/paths';
import {
  normalizeLlmBindingsState,
  normalizeLlmBinding,
} from './llmTypes';
import type {
  LlmBinding,
  LlmBindingsState,
} from './llmTypes';

function resolveBindingsPath(homeDirOrPaths: string | { llmBindingsPath: string }): string {
  if (typeof homeDirOrPaths === 'object' && 'llmBindingsPath' in homeDirOrPaths) {
    return homeDirOrPaths.llmBindingsPath;
  }
  return resolveMetabotPaths(homeDirOrPaths as string).llmBindingsPath;
}

async function readJsonFile(filePath: string): Promise<LlmBindingsState> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { version: 1, bindings: [] };
    }
    throw error;
  }

  try {
    return normalizeLlmBindingsState(JSON.parse(raw));
  } catch {
    return { version: 1, bindings: [] };
  }
}

async function writeJsonFile(filePath: string, state: LlmBindingsState): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmpPath = filePath + '.tmp.' + Math.random().toString(36).slice(2, 8);
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, filePath);
}

export interface LlmBindingStore {
  read(): Promise<LlmBindingsState>;
  write(state: LlmBindingsState): Promise<LlmBindingsState>;
  upsertBinding(binding: LlmBinding): Promise<LlmBindingsState>;
  removeBinding(bindingId: string): Promise<LlmBindingsState>;
  updateLastUsed(bindingId: string, now: string): Promise<LlmBindingsState>;
  listByMetaBotSlug(slug: string): Promise<LlmBinding[]>;
  listEnabledByMetaBotSlug(slug: string): Promise<LlmBinding[]>;
}

export function createLlmBindingStore(homeDirOrPaths: string | { llmBindingsPath: string }): LlmBindingStore {
  const filePath = resolveBindingsPath(homeDirOrPaths);

  const store: LlmBindingStore = {
    async read() {
      return readJsonFile(filePath);
    },

    async write(state) {
      const normalized = normalizeLlmBindingsState(state);
      await writeJsonFile(filePath, normalized);
      return normalized;
    },

    async upsertBinding(binding) {
      const normalized = normalizeLlmBinding(binding);
      if (!normalized) {
        throw new Error('Invalid LlmBinding: missing id, metaBotSlug, llmRuntimeId, or role.');
      }

      const state = await readJsonFile(filePath);

      // Deduplicate by composite key (metaBotSlug, llmRuntimeId, role).
      const existingIndex = state.bindings.findIndex(
        (b) =>
          b.metaBotSlug === normalized.metaBotSlug &&
          b.llmRuntimeId === normalized.llmRuntimeId &&
          b.role === normalized.role,
      );

      if (existingIndex >= 0) {
        state.bindings[existingIndex] = normalized;
      } else {
        state.bindings.push(normalized);
      }

      state.version += 1;
      await writeJsonFile(filePath, state);
      return state;
    },

    async removeBinding(bindingId) {
      const state = await readJsonFile(filePath);
      state.bindings = state.bindings.filter((b) => b.id !== bindingId);
      state.version += 1;
      await writeJsonFile(filePath, state);
      return state;
    },

    async updateLastUsed(bindingId, now) {
      const state = await readJsonFile(filePath);
      const binding = state.bindings.find((b) => b.id === bindingId);
      if (binding) {
        binding.lastUsedAt = now;
        binding.updatedAt = now;
        state.version += 1;
      }
      await writeJsonFile(filePath, state);
      return state;
    },

    async listByMetaBotSlug(slug) {
      const state = await readJsonFile(filePath);
      return state.bindings.filter((b) => b.metaBotSlug === slug);
    },

    async listEnabledByMetaBotSlug(slug) {
      const state = await readJsonFile(filePath);
      return state.bindings.filter((b) => b.metaBotSlug === slug && b.enabled);
    },
  };

  return store;
}
