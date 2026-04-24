import { promises as fs } from 'node:fs';
import { resolveMetabotPaths, type MetabotPaths } from '../state/paths';
import { ensureRuntimeLayout } from '../state/runtimeStateStore';
import type { LocalIdentitySecrets, SecretStore } from './secretStore';

const SECRET_FILE_MODE = 0o600;
const EMPTY_IDENTITY_SECRETS = {};

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as T;
    if (
      parsed
      && typeof parsed === 'object'
      && !Array.isArray(parsed)
      && Object.keys(parsed as Record<string, unknown>).length === 0
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function applySecretFileMode(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  try {
    await fs.chmod(filePath, SECRET_FILE_MODE);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'ENOTSUP' || code === 'EINVAL') {
      return;
    }
    throw error;
  }
}

async function writeIdentitySecretsFile(filePath: string, value: Record<string, unknown>): Promise<void> {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: SECRET_FILE_MODE,
  });
  await applySecretFileMode(filePath);
}

async function ensureIdentitySecretLayout(paths: MetabotPaths): Promise<void> {
  await ensureRuntimeLayout(paths);
  try {
    await fs.access(paths.identitySecretsPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
    await writeIdentitySecretsFile(paths.identitySecretsPath, EMPTY_IDENTITY_SECRETS);
    return;
  }
  await applySecretFileMode(paths.identitySecretsPath);
}

export function createFileSecretStore(homeDirOrPaths: string | MetabotPaths): SecretStore {
  const paths = typeof homeDirOrPaths === 'string' ? resolveMetabotPaths(homeDirOrPaths) : homeDirOrPaths;

  return {
    paths,
    async ensureLayout() {
      await ensureIdentitySecretLayout(paths);
      return paths;
    },
    async readIdentitySecrets<T extends LocalIdentitySecrets>() {
      await ensureIdentitySecretLayout(paths);
      return readJsonFile<T>(paths.identitySecretsPath);
    },
    async writeIdentitySecrets<T extends LocalIdentitySecrets>(value: T) {
      await ensureIdentitySecretLayout(paths);
      await writeIdentitySecretsFile(paths.identitySecretsPath, value);
      return paths.identitySecretsPath;
    },
    async deleteIdentitySecrets() {
      await ensureRuntimeLayout(paths);
      await writeIdentitySecretsFile(paths.identitySecretsPath, EMPTY_IDENTITY_SECRETS);
    },
  };
}
