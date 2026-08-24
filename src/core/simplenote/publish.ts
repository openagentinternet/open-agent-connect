/**
 * On-chain long-form note publishing via the simplenote protocol
 * (/protocols/simplenote, version 1.0.1 — docs/metaid_protocols
 * 02-content-app.md §1). OAC port of the IDBots postSimpleNoteAgentTools
 * core: payload shape verified against live pins
 * (title/subtitle/coverImg/contentType/content/encryption/createTime as
 * ms number/tags/attachments as metafile:// URIs).
 *
 * The upload seam is the shared gate chokepoint (core/files/chainUploadGate):
 * hosts inject wrapUploadWithGate(uploadLocalFileToChain, deps) so files
 * outside the session workspace require owner approval before publishing.
 */

import path from 'node:path';
import { existsSync } from 'node:fs';
import { markdownSelfLink } from '../metaweb/uri';
import type { Signer } from '../signing/signer';

export type SimpleNoteNetwork = 'mvc' | 'doge' | 'btc';

export interface SimpleNoteUploadFn {
  (input: { filePath: string; network: SimpleNoteNetwork }): Promise<{ metafileUri: string }>;
}

export interface PublishSimpleNoteInput {
  title: string;
  content: string;
  subtitle?: string;
  /** Cover image: local absolute file path (uploaded) or an existing metafile:// URI. */
  cover?: string;
  /** Extra files: local absolute paths and/or metafile:// URIs. */
  attachments?: string[];
  /** MIME type of the content field; default text/markdown. */
  contentType?: string;
  tags?: string[];
  /** Note write network; default mvc. DOGE notes still upload files on MVC. */
  network?: SimpleNoteNetwork;
}

export interface PublishSimpleNoteResult {
  pinId: string;
  txids: string[];
  totalCost: number;
  network: string;
  title: string;
  coverImg: string;
  attachments: string[];
}

export class SimpleNoteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SimpleNoteError';
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMetafileUri(value: string): boolean {
  return value.trim().toLowerCase().startsWith('metafile://');
}

/** Pure payload builder (exported for tests): the on-chain 1.0.1 shape. */
export function buildSimpleNotePayload(input: {
  title: string;
  content: string;
  subtitle?: string;
  coverImg?: string;
  contentType?: string;
  tags?: string[];
  attachments?: string[];
  createTime: number;
}): string {
  return JSON.stringify({
    title: input.title,
    subtitle: asString(input.subtitle),
    coverImg: asString(input.coverImg),
    contentType: asString(input.contentType) || 'text/markdown',
    content: input.content,
    encryption: '0',
    createTime: input.createTime,
    tags: (input.tags ?? []).map((tag) => asString(tag)).filter(Boolean),
    attachments: (input.attachments ?? []).filter(Boolean),
  });
}

/**
 * Resolve one cover/attachment reference to a metafile:// URI: local
 * absolute paths upload through the (gated) seam, existing metafile:// URIs
 * pass through, relative paths are rejected.
 */
export async function resolveSimpleNoteFileReference(input: {
  upload: SimpleNoteUploadFn;
  network: SimpleNoteNetwork;
  raw: string;
  field: string;
}): Promise<{ uri?: string; error?: string }> {
  const item = asString(input.raw);
  if (!item) return {};
  if (isMetafileUri(item)) return { uri: item };
  if (!path.isAbsolute(item)) {
    return {
      error: `post_simplenote requires ABSOLUTE local file paths for ${input.field}. Received a relative path: "${item}". Resolve it to an absolute path first, or pass an existing metafile:// URI.`,
    };
  }
  if (!existsSync(item)) {
    return { error: `post_simplenote ${input.field} file not found: ${item}` };
  }
  try {
    // File upload does not support DOGE; keep DOGE only for the note write.
    const uploadNetwork: SimpleNoteNetwork = input.network === 'doge' ? 'mvc' : input.network;
    const result = await input.upload({ filePath: item, network: uploadNetwork });
    const metafileUri = asString(result?.metafileUri);
    if (!metafileUri) {
      return { error: `post_simplenote failed to get a metafile URI for uploaded ${input.field}: ${item}` };
    }
    return { uri: metafileUri };
  } catch (error) {
    return { error: `post_simplenote failed to upload ${input.field} "${item}": ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** Publish one simplenote pin end to end (files → payload → chain write). */
export async function publishSimpleNote(
  signer: Signer,
  upload: SimpleNoteUploadFn,
  input: PublishSimpleNoteInput,
): Promise<PublishSimpleNoteResult> {
  const title = asString(input.title);
  const content = asString(input.content);
  if (!title || !content) {
    throw new SimpleNoteError('missing_field', 'post_simplenote requires both title and content (non-empty).');
  }
  const network: SimpleNoteNetwork = input.network ?? 'mvc';

  let coverImg = '';
  if (asString(input.cover)) {
    const cover = await resolveSimpleNoteFileReference({ upload, network, raw: input.cover ?? '', field: 'cover' });
    if (cover.error) throw new SimpleNoteError('cover_upload_failed', cover.error);
    coverImg = cover.uri ?? '';
  }
  const attachments: string[] = [];
  for (const raw of input.attachments ?? []) {
    if (!asString(raw)) continue;
    const resolved = await resolveSimpleNoteFileReference({ upload, network, raw, field: 'attachment' });
    if (resolved.error) throw new SimpleNoteError('attachment_upload_failed', resolved.error);
    if (resolved.uri) attachments.push(resolved.uri);
  }

  const chainWrite = await signer.writePin({
    operation: 'create',
    path: '/protocols/simplenote',
    encryption: '0',
    version: '1.0.1',
    contentType: 'application/json',
    payload: buildSimpleNotePayload({
      title,
      content,
      subtitle: input.subtitle,
      coverImg,
      contentType: input.contentType,
      tags: input.tags,
      attachments,
      createTime: Date.now(),
    }),
    network,
  });
  return {
    pinId: chainWrite.pinId,
    txids: Array.isArray(chainWrite.txids) ? chainWrite.txids : [],
    totalCost: chainWrite.totalCost,
    network: chainWrite.network,
    title,
    coverImg,
    attachments,
  };
}

/**
 * Human-readable success sheet. The view link follows the MetaWeb URI
 * convention (pin:// — never a Web2 viewer URL) so the model can quote it
 * verbatim. Exposed for tests.
 */
export function formatSimpleNoteResult(input: {
  pinId: string;
  txids: string[];
  totalCost: number;
  title: string;
  coverImg?: string;
  attachments: string[];
}): string {
  const lines: string[] = ['Note published on-chain.'];
  if (input.pinId) lines.push(`- pinId: ${input.pinId}`);
  if (input.txids.length) lines.push(`- txids: ${input.txids.join(', ')}`);
  lines.push(`- title: ${input.title}`);
  lines.push(`- cost: ${input.totalCost} sats`);
  if (input.coverImg) lines.push(`- cover: ${input.coverImg}`);
  for (const uri of input.attachments) lines.push(`- attachment: ${uri}`);
  if (input.pinId) {
    lines.push(`- view link: ${markdownSelfLink(`pin://${input.pinId}`)}`);
  }
  return lines.join('\n');
}
