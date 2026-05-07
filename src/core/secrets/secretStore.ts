import type { MetabotPaths } from '../state/paths';

export interface LocalIdentitySecrets extends Record<string, unknown> {
  mnemonic?: string;
  path?: string;
  privateKeyHex?: string;
  publicKey?: string;
  chatPublicKey?: string;
  /** Chain addresses keyed by network name. E.g. { mvc: "1...", btc: "1...", doge: "D..." } */
  addresses?: Record<string, string>;
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
