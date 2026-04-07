import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainWriteRequest, ChainWriteResult } from '../chain/writePin';

export interface PrivateChatSignerIdentity {
  globalMetaId: string;
  chatPublicKey: string;
  privateKeyHex: string;
}

export interface Signer {
  getIdentity(): Promise<DerivedIdentity>;
  getPrivateChatIdentity(): Promise<PrivateChatSignerIdentity>;
  writePin(input: ChainWriteRequest): Promise<ChainWriteResult>;
}
