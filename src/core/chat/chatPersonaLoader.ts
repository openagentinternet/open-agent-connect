import { promises as fs } from 'node:fs';
import type { MetabotPaths } from '../state/paths';
import type { ChatPersona } from './privateChatTypes';

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

export async function loadChatPersona(paths: MetabotPaths): Promise<ChatPersona> {
  const [soul, goal, role] = await Promise.all([
    readMdFile(paths.soulMdPath),
    readMdFile(paths.goalMdPath),
    readMdFile(paths.roleMdPath),
  ]);
  return { soul, goal, role };
}
