/**
 * Owner identity signer: the machine-wide human owner signs its own chain
 * writes (profile /info/* pins, group-task joins, asOwner posts) with the
 * mnemonic stored in `~/.metabot/owner/identity.json`. The owner home is NOT
 * a MetaBot profile home, so the secret store below is a read-only view that
 * only ever serves `readIdentitySecrets`.
 */
import type { ChainAdapterRegistry } from '../chain/adapters/types';
import type { SecretStore } from '../secrets/secretStore';
import { type ResolveSponsorWritePin } from '../signing/localMnemonicSigner';
import type { Signer } from '../signing/signer';
import { type OwnerIdentityRecord } from './ownerIdentity';
/**
 * Read-only SecretStore view over the owner identity record; the signer only
 * ever calls readIdentitySecrets. The owner home (~/.metabot/owner) is NOT a
 * profile home, so resolveMetabotPaths rejects it — the paths stub below
 * exists solely to satisfy the SecretStore interface.
 */
export declare function createOwnerSecretStore(systemHomeDir: string, owner: OwnerIdentityRecord): SecretStore;
/**
 * Signer over the owner mnemonic. `resolveSponsorWritePin` is the MVC traffic
 * (代付) hook: when present, owner writes bill the traffic account like Bot
 * writes; absent = the owner wallet self-pays.
 */
export declare function createOwnerSigner(input: {
    systemHomeDir: string;
    owner: OwnerIdentityRecord;
    adapters: ChainAdapterRegistry;
    resolveSponsorWritePin?: ResolveSponsorWritePin;
}): Signer;
