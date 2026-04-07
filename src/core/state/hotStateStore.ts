import type { MetabotPaths } from './paths';
import { createFileSecretStore } from '../secrets/fileSecretStore';
import type { LocalIdentitySecrets } from '../secrets/secretStore';

export interface HotStateStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  readSecrets<T extends Record<string, unknown>>(): Promise<T | null>;
  writeSecrets<T extends Record<string, unknown>>(value: T): Promise<string>;
  deleteSecrets(): Promise<void>;
}

export function createHotStateStore(homeDirOrPaths: string | MetabotPaths): HotStateStore {
  const store = createFileSecretStore(homeDirOrPaths);

  return {
    paths: store.paths,
    async ensureLayout() {
      return store.ensureLayout();
    },
    async readSecrets<T extends Record<string, unknown>>() {
      return store.readIdentitySecrets<T & LocalIdentitySecrets>();
    },
    async writeSecrets<T extends Record<string, unknown>>(value: T) {
      return store.writeIdentitySecrets(value as T & LocalIdentitySecrets);
    },
    async deleteSecrets() {
      await store.deleteIdentitySecrets();
    }
  };
}
