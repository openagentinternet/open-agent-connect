/**
 * On-chain comment publishing via the paycomment protocol. OAC port of the
 * IDBots comment_pin semantics: any pin can be commented on (a buzz, a note,
 * a question, an answer, …) — the comment pin joins the target's public
 * thread. Payload-only write (no uploads), same posture as the paylike
 * reaction writer.
 */
import type { Signer } from '../signing/signer';
import { markdownSelfLink } from '../metaweb/uri';

export const PAYCOMMENT_PATH = '/protocols/paycomment';
const PAYCOMMENT_PROTOCOL_VERSION = '1.0.0';

export class CommentPublishError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'CommentPublishError';
    this.code = code;
  }
}

export interface PublishCommentPinInput {
  /** pinId of the pin being commented on. */
  pinId: string;
  /** Comment body — plain text or markdown, non-empty. */
  content: string;
  /** Write network; default mvc. */
  network?: string;
}

export interface PublishCommentPinResult {
  /** The comment pin's own id. */
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  /** The commented-on pin's id. */
  targetPinId: string;
  content: string;
}

/** Publish one paycomment pin (payload-only write, no upload). */
export async function publishCommentPin(
  signer: Signer,
  input: PublishCommentPinInput,
): Promise<PublishCommentPinResult> {
  const pinId = typeof input.pinId === 'string' ? input.pinId.trim() : '';
  if (!pinId) {
    throw new CommentPublishError('missing_field', 'comment_pin requires `pin_id` (non-empty pinId of the target pin).');
  }
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) {
    throw new CommentPublishError('missing_field', 'comment_pin requires non-empty `content`.');
  }
  const network = (typeof input.network === 'string' && input.network.trim()) || 'mvc';

  const chainWrite = await signer.writePin({
    operation: 'create',
    path: PAYCOMMENT_PATH,
    encryption: '0',
    version: PAYCOMMENT_PROTOCOL_VERSION,
    contentType: 'application/json',
    payload: JSON.stringify({ commentTo: pinId, content, contentType: 'text/markdown' }),
    network,
  });
  return {
    pinId: chainWrite.pinId,
    txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    targetPinId: pinId,
    content,
  };
}

/**
 * Human-readable success sheet for comment_pin. The view link follows the
 * MetaWeb URI convention (pin:// — never a Web2 viewer URL). Exposed for
 * tests.
 */
export function formatCommentPinResult(input: {
  commentPinId: string;
  txids: string[];
  totalCost: number;
  targetPinId: string;
}): string {
  const lines: string[] = [`Commented on pin ${input.targetPinId} — comment published on-chain.`];
  if (input.commentPinId) lines.push(`- comment pinId: ${input.commentPinId}`);
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- target pinId: ${input.targetPinId}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  if (input.commentPinId) {
    lines.push(`- view link: ${markdownSelfLink(`pin://${input.commentPinId}`)}`);
  }
  return lines.join('\n');
}
