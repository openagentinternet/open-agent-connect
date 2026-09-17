/**
 * Chain-write payload builders for the surf session's write tools. OAC port
 * of the IDBots commentPinAgentTools / agentpediaAgentTools write payloads,
 * unified behind the guarded `SurfChainWrite` primitive (surf/guard.ts).
 *
 * Payload design follows the same declarative-minimalism as the Q&A
 * protocols: only what a reader cannot derive is written, empty optional
 * fields are omitted entirely.
 */
import type { Signer } from '../signing/signer.js';
export declare const PAYCOMMENT_PATH = "/protocols/paycomment";
export declare const AGENTPEDIA_CHALLENGE_PATH = "/protocols/agentpedia/challenge";
export declare const SIMPLEBUZZ_PATH = "/protocols/simplebuzz";
export declare const SIMPLENOTE_PATH = "/protocols/simplenote";
export declare const SIMPLEQUESTION_PATH = "/protocols/simplequestion";
export declare const SIMPLEANSWER_PATH = "/protocols/simpleanswer";
export declare const PAYLIKE_PATH = "/protocols/paylike";
export declare const SURF_PROTOCOL_VERSION = "1.0.0";
export type SurfWriteNetwork = 'mvc' | 'doge' | 'btc';
export interface SurfChainWriteResult {
    pinId: string;
    txids: string[];
    totalCost: number;
    network: string;
}
/** Comment on ANY pin via paycomment — the thread-reply primitive. */
export declare function buildCommentPayload(input: {
    commentTo: string;
    content: string;
}): string;
/** Dispute one agentpedia revision (challenge event v1). */
export declare function buildAgentpediaChallengePayload(input: {
    targetRev: string;
    reason: 'vandalism' | 'copyright' | 'neutrality' | 'factual' | 'editwar' | 'other';
    detail: string;
    proposedOutcome?: 'revert-to' | 'protect' | 'transfer' | 'none';
    proposedRevertTo?: string;
}): string;
/** One buzz post. */
export declare function buildBuzzPayload(input: {
    content: string;
    contentType?: string;
    attachments?: string[];
}): string;
/** One simplenote article (on-chain 1.0.1 shape). */
export declare function buildSurfSimpleNotePayload(input: {
    title: string;
    content: string;
    contentType?: string;
    createTime: number;
}): string;
/** Like/dislike/cancel on any pin via paylike. */
export declare function buildLikePayload(input: {
    likeTo: string;
    isLike: 1 | -1 | 0;
}): string;
/**
 * Perform one chain write with a (chain-history-wrapped, surf-guard-wrapped)
 * signer. The daemon's `resolveActorWriteContext` signers already mirror
 * every write into the chain-history ledger — the receipts source the surf
 * reconciliation and isOwnPin checks read.
 */
export declare function surfSignerWrite(signer: Signer, input: {
    path: string;
    payload: string;
    network?: SurfWriteNetwork;
}): Promise<SurfChainWriteResult>;
/** Human-readable receipt lines shared by every surf write tool. */
export declare function formatSurfWriteReceipt(input: {
    label: string;
    result: SurfChainWriteResult;
    targetPinId?: string;
}): string;
