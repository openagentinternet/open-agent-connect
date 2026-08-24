/**
 * Deliverable verification (IDBots verifyPinSources + re-verify loop parity):
 * confirm that a deliverable's pin actually exists on-chain before the
 * acceptance summary vouches for it. The primary source is the metaso-p2p
 * pin read (GET /api/metaweb/pin/:pinId); indexer lag is absorbed by the
 * engine's 10-minute re-verification pass rather than by blocking ingest.
 */
import type { GroupTaskStore } from './store';
export type PinVerifyResult = 'found' | 'not_found' | 'error';
export type PinVerifier = (pinId: string) => Promise<PinVerifyResult>;
/** Extract a bare chain pin id (64 hex + i<n>) from a deliverable URI. */
export declare function extractDeliverablePinId(uri: string | null | undefined): string | null;
/** metaso-p2p pin existence check; envelope code 0 = found, 40400 = missing. */
export declare function createMetasoPinVerifier(options?: {
    baseUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
}): PinVerifier;
export interface DeliverableVerificationReport {
    checked: number;
    confirmed: number;
    stillUnconfirmed: number;
}
/**
 * Verify every unconfirmed deliverable row of a task. Confirmed pins flip
 * `confirmation` to confirmed and `pending` rows to `delivered` (IDBots
 * parity: verification is what "delivers" a deliverable); errors keep the
 * row unconfirmed for the next re-verification pass.
 */
export declare function verifyTaskDeliverables(store: GroupTaskStore, taskId: number, verifier: PinVerifier, options?: {
    now?: () => number;
    log?: (message: string) => void;
}): Promise<DeliverableVerificationReport>;
