/**
 * Sponsored (traffic-mode, 代付) MVC pin-write orchestration.
 * Port of IDBots src/main/services/mvcSponsorCreatePin.ts onto OAC
 * primitives, mirroring src/core/files/mvcSponsorDirectUpload.ts idioms:
 * address-info preflight -> unsigned inscription draft (no fee deduction) ->
 * advisory quota check -> challenge -> bot signs the challenge ->
 * trafficAccount resolution -> pre -> sign user-owned inputs -> commit proof
 * -> commit, then pending-UTXO tracking + local spend journaling exactly like
 * the broadcast path.
 *
 * Fallback semantics (IDBots parity): service_unavailable / no_user_utxo /
 * insufficient_quota / insufficient_traffic fall back to the regular
 * self-paid write (result carries feeAssist metadata); pre_rejected /
 * commit_failed are hard failures carrying feeAssist diagnostics on
 * error.data.
 */
import type { DerivedIdentity } from '../identity/deriveIdentity';
import type { ChainWriteResult, NormalizedChainWriteRequest } from '../chain/writePin';
import type { ChainUtxo } from '../chain/adapters/types';
import type { ResolveSponsorWritePin } from '../signing/localMnemonicSigner';
import type { MvcSponsorAddressInfo, MvcSponsorChallenge, MvcSponsorCommitResult, MvcSponsorPreResult, MvcSponsorTrafficAccount } from './mvcSponsorV2Client';
import { type MvcSponsorTrafficDeps } from './feeAssist';
import type { TrafficAccountService } from '../traffic/trafficAccountService';
/** Reasons that fall back to the regular self-paid write (IDBots parity). */
export type MvcSponsorWritePinFallbackReason = 'service_unavailable' | 'no_user_utxo' | 'insufficient_quota' | 'insufficient_traffic';
/** Minimal sponsor-client surface used by the pin-write flow. */
export interface MvcSponsorWritePinClient {
    getAddressInfo(payload: {
        address: string;
    }): Promise<MvcSponsorAddressInfo>;
    getChallenge(): Promise<MvcSponsorChallenge>;
    preSponsor(payload: {
        address: string;
        txHex: string;
        challengeId: string;
        publicKey: string;
        signature: string;
        trafficAccount?: MvcSponsorTrafficAccount;
    }): Promise<MvcSponsorPreResult>;
    commitSponsor(payload: {
        orderId: string;
        signedTxHex: string;
        publicKey: string;
        signature: string;
        message?: string;
    }): Promise<MvcSponsorCommitResult>;
}
export interface MvcSponsorWritePinInput {
    request: NormalizedChainWriteRequest;
    identity: DerivedIdentity;
    sponsorClient: MvcSponsorWritePinClient;
    traffic: MvcSponsorTrafficDeps;
    /** Regular self-paid build+broadcast worker (the signer's existing body). */
    runSelfPaid: () => Promise<ChainWriteResult>;
    /** Test seam; defaults to the MVC chain adapter UTXO fetch. */
    fetchUtxos?: (address: string) => Promise<ChainUtxo[]>;
}
export declare function writeMvcSponsorPin(input: MvcSponsorWritePinInput): Promise<ChainWriteResult>;
/**
 * Build the signer's resolveSponsorWritePin hook bound to a shared traffic
 * account service. Returns null (unchanged self-paid behavior) unless the
 * stored traffic pin mode is 'traffic'; otherwise runs the sponsored flow
 * with a sponsor client pointed at the configured assist-service base URL.
 */
export declare function createTrafficSponsorWritePinResolver(input: {
    trafficAccountService: Pick<TrafficAccountService, 'getTrafficPinMode' | 'getConfiguredTrafficApiBase' | 'resolveSponsorTrafficAccount' | 'recordLocalTrafficSpend'>;
}): ResolveSponsorWritePin;
