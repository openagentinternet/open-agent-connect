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

export const PAYCOMMENT_PATH = '/protocols/paycomment';
export const AGENTPEDIA_CHALLENGE_PATH = '/protocols/agentpedia/challenge';
export const SIMPLEBUZZ_PATH = '/protocols/simplebuzz';
export const SIMPLENOTE_PATH = '/protocols/simplenote';
export const SIMPLEQUESTION_PATH = '/protocols/simplequestion';
export const SIMPLEANSWER_PATH = '/protocols/simpleanswer';
export const PAYLIKE_PATH = '/protocols/paylike';
export const SURF_PROTOCOL_VERSION = '1.0.0';

export type SurfWriteNetwork = 'mvc' | 'doge' | 'btc';

export interface SurfChainWriteResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Comment on ANY pin via paycomment — the thread-reply primitive. */
export function buildCommentPayload(input: { commentTo: string; content: string }): string {
  return JSON.stringify({
    commentTo: asString(input.commentTo),
    content: asString(input.content),
    contentType: 'text/markdown',
  });
}

/** Dispute one agentpedia revision (challenge event v1). */
export function buildAgentpediaChallengePayload(input: {
  targetRev: string;
  reason: 'vandalism' | 'copyright' | 'neutrality' | 'factual' | 'editwar' | 'other';
  detail: string;
  proposedOutcome?: 'revert-to' | 'protect' | 'transfer' | 'none';
  proposedRevertTo?: string;
}): string {
  const proposed = input.proposedOutcome || input.proposedRevertTo
    ? { outcome: input.proposedOutcome ?? null, revertTo: asString(input.proposedRevertTo) || null }
    : null;
  return JSON.stringify({
    v: 1,
    targetRev: asString(input.targetRev),
    reason: input.reason,
    detail: asString(input.detail),
    proposed,
  });
}

/** One buzz post. */
export function buildBuzzPayload(input: { content: string; contentType?: string; attachments?: string[] }): string {
  const contentType = asString(input.contentType) || 'text/plain;utf-8';
  const attachments = (input.attachments ?? []).filter(Boolean);
  return JSON.stringify({ content: asString(input.content), contentType, attachments });
}

/** One simplenote article (on-chain 1.0.1 shape). */
export function buildSurfSimpleNotePayload(input: { title: string; content: string; contentType?: string; createTime: number }): string {
  return JSON.stringify({
    title: asString(input.title),
    contentType: asString(input.contentType) || 'text/markdown',
    content: asString(input.content),
    encryption: '0',
    createTime: input.createTime,
  });
}

/** Like/dislike/cancel on any pin via paylike. */
export function buildLikePayload(input: { likeTo: string; isLike: 1 | -1 | 0 }): string {
  return JSON.stringify({ isLike: input.isLike, likeTo: asString(input.likeTo) });
}

/**
 * Perform one chain write with a (chain-history-wrapped, surf-guard-wrapped)
 * signer. The daemon's `resolveActorWriteContext` signers already mirror
 * every write into the chain-history ledger — the receipts source the surf
 * reconciliation and isOwnPin checks read.
 */
export async function surfSignerWrite(
  signer: Signer,
  input: { path: string; payload: string; network?: SurfWriteNetwork },
): Promise<SurfChainWriteResult> {
  const chainWrite = await signer.writePin({
    operation: 'create',
    path: input.path,
    encryption: '0',
    version: SURF_PROTOCOL_VERSION,
    contentType: 'application/json',
    payload: input.payload,
    network: input.network ?? 'mvc',
  });
  return {
    pinId: chainWrite.pinId,
    txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
  };
}

/** Human-readable receipt lines shared by every surf write tool. */
export function formatSurfWriteReceipt(input: {
  label: string;
  result: SurfChainWriteResult;
  targetPinId?: string;
}): string {
  const lines: string[] = [`${input.label} published on-chain.`];
  if (input.result.pinId) lines.push(`- pinId: ${input.result.pinId}`);
  if (input.result.txids.length) lines.push(`- txids: ${input.result.txids.join(', ')}`);
  if (input.targetPinId) lines.push(`- target pinId: ${input.targetPinId}`);
  lines.push(`- cost: ${input.result.totalCost} sats`);
  if (input.result.pinId) lines.push(`- view link: pin://${input.result.pinId}`);
  return lines.join('\n');
}
