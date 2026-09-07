/**
 * On-chain Q&A publishing via the simplequestion / simpleanswer / paylike
 * protocols (docs/metaid_protocols/08-qanda.md). OAC port of the IDBots
 * feat/metaweb-qa core: payload design follows declarative minimalism — only
 * what a reader cannot derive is required, no self-declared timestamps (block
 * time and indexer witness time are authoritative), and empty optional fields
 * are omitted entirely instead of written as empty strings/arrays.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { markdownSelfLink } from '../metaweb/uri';
import type { Signer } from '../signing/signer';

export type QandaNetwork = 'mvc' | 'doge' | 'btc';

export const SIMPLE_QUESTION_PATH = '/protocols/simplequestion';
export const SIMPLE_ANSWER_PATH = '/protocols/simpleanswer';
export const PAYLIKE_PATH = '/protocols/paylike';
export const QANDA_PROTOCOL_VERSION = '1.0.0';

export interface QandaUploadFn {
  (input: { filePath: string; network: QandaNetwork }): Promise<{ metafileUri: string }>;
}

export interface PublishSimpleQuestionInput {
  title: string;
  /** Optional question description/supplement (markdown). */
  content?: string;
  tags?: string[];
  /** MIME type of the content field; default text/markdown; ignored when content is empty. */
  contentType?: string;
  /** Files/images: local absolute file paths and/or metafile:// URIs. */
  attachments?: string[];
  /** Write network; default mvc. DOGE writes still upload files on MVC. */
  network?: QandaNetwork;
}

export interface PublishSimpleAnswerInput {
  /** pinId of the simplequestion pin being answered. */
  answerTo: string;
  content: string;
  tags?: string[];
  /** MIME type of the content field; written only when the caller passes it. */
  contentType?: string;
  attachments?: string[];
  network?: QandaNetwork;
}

export interface PublishLikePinInput {
  /** pinId of the target pin (any protocol). */
  pinId: string;
  /** 1 like, -1 dislike, 0 cancel the previous reaction. */
  isLike: 1 | -1 | 0;
  network?: QandaNetwork;
}

export interface PublishQandaResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
}

export class QandaPublishError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'QandaPublishError';
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMetafileUri(value: string): boolean {
  return value.trim().toLowerCase().startsWith('metafile://');
}

/**
 * Resolve one attachment reference: local absolute paths upload through the
 * (gated) seam, existing metafile:// URIs pass through, relative paths are
 * rejected. File upload does not support DOGE, so a DOGE write uploads on MVC.
 */
export async function resolveQandaFileReference(input: {
  upload: QandaUploadFn;
  network: QandaNetwork;
  raw: string;
  toolName: string;
  field: string;
}): Promise<{ uri?: string; error?: string }> {
  const item = asString(input.raw);
  if (!item) return {};
  if (isMetafileUri(item)) return { uri: item };
  if (!path.isAbsolute(item)) {
    return {
      error: `${input.toolName} requires ABSOLUTE local file paths for ${input.field}. Received a relative path: "${item}". Resolve it to an absolute path first, or pass an existing metafile:// URI.`,
    };
  }
  if (!existsSync(item)) {
    return { error: `${input.toolName} ${input.field} file not found: ${item}` };
  }
  try {
    const uploadNetwork: QandaNetwork = input.network === 'doge' ? 'mvc' : input.network;
    const result = await input.upload({ filePath: item, network: uploadNetwork });
    const metafileUri = asString(result?.metafileUri);
    if (!metafileUri) {
      return { error: `${input.toolName} failed to get a metafile URI for uploaded ${input.field}: ${item}` };
    }
    return { uri: metafileUri };
  } catch (error) {
    return {
      error: `${input.toolName} failed to upload ${input.field} "${item}": ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** Pure payload builder (exported for tests): only `title` is required. */
export function buildSimpleQuestionPayload(input: {
  title: string;
  content?: string;
  tags?: string[];
  contentType?: string;
  attachments?: string[];
}): string {
  const payload: Record<string, unknown> = { title: input.title };
  if (asString(input.content)) {
    payload.content = asString(input.content);
    payload.contentType = asString(input.contentType) || 'text/markdown';
  }
  const tags = (input.tags ?? []).map((tag) => asString(tag)).filter(Boolean);
  if (tags.length) payload.tags = tags;
  const attachments = (input.attachments ?? []).filter(Boolean);
  if (attachments.length) payload.attachments = attachments;
  return JSON.stringify(payload);
}

/** Pure payload builder (exported for tests): contentType rides only when passed. */
export function buildSimpleAnswerPayload(input: {
  answerTo: string;
  content: string;
  tags?: string[];
  contentType?: string;
  attachments?: string[];
}): string {
  const payload: Record<string, unknown> = { answerTo: input.answerTo, content: input.content };
  const contentType = asString(input.contentType);
  if (contentType) payload.contentType = contentType;
  const tags = (input.tags ?? []).map((tag) => asString(tag)).filter(Boolean);
  if (tags.length) payload.tags = tags;
  const attachments = (input.attachments ?? []).filter(Boolean);
  if (attachments.length) payload.attachments = attachments;
  return JSON.stringify(payload);
}

async function writeQandaPin(
  signer: Signer,
  input: { path: string; payload: string; network: QandaNetwork },
): Promise<PublishQandaResult> {
  const chainWrite = await signer.writePin({
    operation: 'create',
    path: input.path,
    encryption: '0',
    version: QANDA_PROTOCOL_VERSION,
    contentType: 'application/json',
    payload: input.payload,
    network: input.network,
  });
  return {
    pinId: chainWrite.pinId,
    txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
  };
}

async function resolveAttachmentList(input: {
  upload: QandaUploadFn;
  network: QandaNetwork;
  attachments?: string[];
  toolName: string;
}): Promise<string[]> {
  const attachments: string[] = [];
  for (const raw of input.attachments ?? []) {
    if (!asString(raw)) continue;
    const resolved = await resolveQandaFileReference({
      upload: input.upload,
      network: input.network,
      raw,
      toolName: input.toolName,
      field: 'attachment',
    });
    if (resolved.error) throw new QandaPublishError('attachment_upload_failed', resolved.error);
    if (resolved.uri) attachments.push(resolved.uri);
  }
  return attachments;
}

/** Publish one simplequestion pin end to end (files → payload → chain write). */
export async function publishSimpleQuestion(
  signer: Signer,
  upload: QandaUploadFn,
  input: PublishSimpleQuestionInput,
): Promise<PublishQandaResult & { title: string; attachments: string[] }> {
  const title = asString(input.title);
  if (!title) {
    throw new QandaPublishError('missing_field', 'post_simplequestion requires `title` (non-empty). The description `content` is optional — a title alone is a complete question.');
  }
  const network: QandaNetwork = input.network ?? 'mvc';
  const attachments = await resolveAttachmentList({
    upload,
    network,
    attachments: input.attachments,
    toolName: 'post_simplequestion',
  });
  const payload = buildSimpleQuestionPayload({
    title,
    content: input.content,
    tags: input.tags,
    contentType: input.contentType,
    attachments,
  });
  const result = await writeQandaPin(signer, { path: SIMPLE_QUESTION_PATH, payload, network });
  return { ...result, title, attachments };
}

/** Publish one simpleanswer pin end to end (files → payload → chain write). */
export async function publishSimpleAnswer(
  signer: Signer,
  upload: QandaUploadFn,
  input: PublishSimpleAnswerInput,
): Promise<PublishQandaResult & { questionPinId: string; content: string; attachments: string[] }> {
  const answerTo = asString(input.answerTo);
  const content = asString(input.content);
  if (!answerTo || !content) {
    throw new QandaPublishError('missing_field', 'post_simpleanswer requires both `answer_to` (pinId of the question pin) and `content` (non-empty).');
  }
  const network: QandaNetwork = input.network ?? 'mvc';
  const attachments = await resolveAttachmentList({
    upload,
    network,
    attachments: input.attachments,
    toolName: 'post_simpleanswer',
  });
  const payload = buildSimpleAnswerPayload({
    answerTo,
    content,
    tags: input.tags,
    contentType: input.contentType,
    attachments,
  });
  const result = await writeQandaPin(signer, { path: SIMPLE_ANSWER_PATH, payload, network });
  return { ...result, questionPinId: answerTo, content, attachments };
}

/** Publish one paylike reaction pin (no upload — reactions are payload-only). */
export async function publishLikePin(
  signer: Signer,
  input: PublishLikePinInput,
): Promise<PublishQandaResult & { targetPinId: string; isLike: 1 | -1 | 0 }> {
  const pinId = asString(input.pinId);
  if (!pinId) {
    throw new QandaPublishError('missing_field', 'like_pin requires `pin_id` (non-empty pinId of the target pin).');
  }
  const isLike = input.isLike;
  if (isLike !== 1 && isLike !== -1 && isLike !== 0) {
    throw new QandaPublishError('invalid_field', 'like_pin `is_like` must be exactly 1 (like), -1 (dislike), or 0 (cancel).');
  }
  const network: QandaNetwork = input.network ?? 'mvc';
  const result = await writeQandaPin(signer, {
    path: PAYLIKE_PATH,
    payload: JSON.stringify({ isLike, likeTo: pinId }),
    network,
  });
  return { ...result, targetPinId: pinId, isLike };
}

/**
 * Human-readable success sheet for post_simplequestion. The view link follows
 * the MetaWeb URI convention (pin:// — never a Web2 viewer URL). Exposed for
 * tests.
 */
export function formatSimpleQuestionResult(input: {
  pinId: string;
  txids: string[];
  totalCost: number;
  title: string;
  attachments: string[];
}): string {
  const lines: string[] = ['Question published on-chain.'];
  if (input.pinId) {
    lines.push(`- question pinId: ${input.pinId}`);
    lines.push('- others answer this question by referencing this pinId as `answer_to` in post_simpleanswer');
  }
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- title: ${input.title}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  for (const uri of input.attachments) lines.push(`- attachment: ${uri}`);
  if (input.pinId) {
    lines.push(`- view link: ${markdownSelfLink(`pin://${input.pinId}`)}`);
  }
  return lines.join('\n');
}

/**
 * Human-readable success sheet for post_simpleanswer. Exposed for tests.
 */
export function formatSimpleAnswerResult(input: {
  pinId: string;
  txids: string[];
  totalCost: number;
  questionPinId: string;
  attachments: string[];
  priorAnswerCount: number;
}): string {
  const lines: string[] = ['Answer published on-chain.'];
  if (input.pinId) lines.push(`- answer pinId: ${input.pinId}`);
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- question pinId: ${input.questionPinId}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  for (const uri of input.attachments) lines.push(`- attachment: ${uri}`);
  if (input.priorAnswerCount > 0) {
    lines.push(`- note: this is answer #${input.priorAnswerCount + 1} you published to this question from this host`);
  }
  if (input.pinId) {
    lines.push(`- view link: ${markdownSelfLink(`pin://${input.pinId}`)}`);
  }
  return lines.join('\n');
}

/**
 * Human-readable success sheet for like_pin. Exposed for tests.
 */
export function formatLikePinResult(input: {
  reactionPinId: string;
  txids: string[];
  totalCost: number;
  targetPinId: string;
  isLike: 1 | -1 | 0;
}): string {
  const action =
    input.isLike === 1 ? 'Liked' : input.isLike === -1 ? 'Disliked' : 'Canceled your reaction on';
  const lines: string[] = [`${action} pin ${input.targetPinId} — reaction published on-chain.`];
  if (input.reactionPinId) lines.push(`- reaction pinId: ${input.reactionPinId}`);
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- target pinId: ${input.targetPinId}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  if (input.reactionPinId) {
    lines.push(`- view link: ${markdownSelfLink(`pin://${input.reactionPinId}`)}`);
  }
  return lines.join('\n');
}
