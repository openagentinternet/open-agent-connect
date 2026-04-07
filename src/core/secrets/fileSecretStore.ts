import { promises as fs } from 'node:fs';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import type { LocalIdentitySecrets, SecretStore } from './secretStore';

async function ensureHotLayout(paths: MetabotPaths): Promise<void> {
  await fs.mkdir(paths.hotRoot, { recursive: true });
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

export function createFileSecretStore(homeDirOrPaths: string | MetabotPaths): SecretStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;

  return {
    paths,
    async ensureLayout() {
      await ensureHotLayout(paths);
      return paths;
    },
    async readIdentitySecrets<T extends LocalIdentitySecrets>() {
      await ensureHotLayout(paths);
      return readJsonFile<T>(paths.secretsPath);
    },
    async writeIdentitySecrets<T extends LocalIdentitySecrets>(value: T) {
      await ensureHotLayout(paths);
      await fs.writeFile(paths.secretsPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      return paths.secretsPath;
    },
    async deleteIdentitySecrets() {
      try {
        await fs.rm(paths.secretsPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT') {
          throw error;
        }
      }
    },
  };
}
