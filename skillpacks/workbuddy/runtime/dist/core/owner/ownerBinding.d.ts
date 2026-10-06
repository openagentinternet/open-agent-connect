import type { MetabotInfoPublishTarget } from '../bot/metabotProfileManager';
import type { OwnerIdentityRecord } from './ownerIdentity';
export declare const OWNER_BINDING_PATH = "/info/owner";
export declare const OWNER_BINDING_MESSAGE_PREFIX = "metabot-owner-binding:";
export declare const OWNER_BINDING_ALGORITHM = "ecdsa-secp256k1-bitcoin-message";
export declare const OWNER_BINDING_VERSION = 1;
export interface OwnerBindingPayload {
    version: number;
    owner: string;
    ownerPublicKey: string;
    signedMessage: string;
    signature: string;
    algorithm: string;
}
export declare function buildOwnerBindingMessage(botGlobalMetaId: string): string;
export declare function buildOwnerBindingPayload(input: {
    ownerGlobalMetaId: string;
    ownerPublicKey: string;
    botGlobalMetaId: string;
    signature: string;
}): string;
export declare function parseOwnerBindingPayload(raw: string | null | undefined): OwnerBindingPayload | null;
/**
 * Sign an owner-binding statement with the owner identity's MVC key. Returns
 * the JSON payload ready to publish at /info/owner plus the signing details.
 */
export declare function signOwnerBinding(owner: Pick<OwnerIdentityRecord, 'mnemonic' | 'path' | 'globalMetaId'>, botGlobalMetaId: string): Promise<{
    payload: string;
    signature: string;
    publicKey: string;
    signedMessage: string;
}>;
/** Build the /info/owner publish target for a Bot owned by `owner`. */
export declare function buildOwnerBindingPublishTarget(owner: Pick<OwnerIdentityRecord, 'mnemonic' | 'path' | 'globalMetaId'>, botGlobalMetaId: string): Promise<MetabotInfoPublishTarget>;
/**
 * Verify an /info/owner payload against the GlobalMetaID of the Bot that
 * published it. Purely offline: no chain queries needed.
 */
export declare function verifyOwnerBinding(payloadRaw: string | null | undefined, expectedBotGlobalMetaId: string): boolean;
