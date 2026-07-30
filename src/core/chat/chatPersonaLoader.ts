import { promises as fs } from 'node:fs';
import type { MetabotPaths } from '../state/paths';
import type { ChatPersona } from './privateChatTypes';
import { withRuntimeMetabotPersonaFallback } from '../bot/metabotPersona';

interface ChatPersonaIdentity {
  name: string;
  globalMetaId: string;
}

async function readMdFile(filePath: string): Promise<string> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw.trim();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return '';
    }
    throw error;
  }
}

async function readRuntimeIdentity(filePath: string): Promise<ChatPersonaIdentity | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  const state = JSON.parse(raw) as unknown;
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null;
  const identity = (state as Record<string, unknown>).identity;
  if (!identity || typeof identity !== 'object' || Array.isArray(identity)) return null;
  const fields = identity as Record<string, unknown>;
  const name = typeof fields.name === 'string' ? fields.name.trim() : '';
  const globalMetaId = typeof fields.globalMetaId === 'string' ? fields.globalMetaId.trim() : '';
  return (name || globalMetaId) ? { name, globalMetaId } : null;
}

export async function loadChatPersona(paths: MetabotPaths): Promise<ChatPersona> {
  const [soul, goal, role, identity] = await Promise.all([
    readMdFile(paths.soulMdPath),
    readMdFile(paths.goalMdPath),
    readMdFile(paths.roleMdPath),
    readRuntimeIdentity(paths.runtimeStatePath),
  ]);
  const persona = withRuntimeMetabotPersonaFallback({ soul, goal, role });

  return {
    ...persona,
    ...(identity ? { identity } : {}),
  };
}
