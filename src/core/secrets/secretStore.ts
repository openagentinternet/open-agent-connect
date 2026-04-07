import type { MetabotPaths } from '../state/paths';

export interface LocalIdentitySecrets extends Record<string, unknown> {
  mnemonic?: string;
  path?: string;
  privateKeyHex?: string;
  publicKey?: string;
  chatPublicKey?: string;
  mvcAddress?: string;
  btcAddress?: string;
  dogeAddress?: string;
  metaId?: string;
  globalMetaId?: string;
}

export interface SecretStore {
  paths: MetabotPaths;
  ensureLayout(): Promise<MetabotPaths>;
  readIdentitySecrets<T extends LocalIdentitySecrets>(): Promise<T | null>;
  writeIdentitySecrets<T extends LocalIdentitySecrets>(value: T): Promise<string>;
  deleteIdentitySecrets(): Promise<void>;
}
